// Per-module data: a small key-value store for each module, per scope (the
// whole server, or one room), with a version on every key and a change event
// on every write so the server can push updates live. See
// documentation/architecture/architecture-modules.md.
//
// Files live under DATA_DIR/modules/<id>/data/: server.json and room-<id>.json.
// Each is loaded once, kept in memory, and rewritten whole on a change -- a
// module's data is small by design (a 5 MB cap per module).

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { StoreError } = require('./store');

const KEY_RE = /^[A-Za-z0-9_.:/-]{1,128}$/;
const ROOM_RE = /^[a-z0-9]{4,16}$/;
const PERSON_RE = /^[a-z0-9]{4,40}$/; // a person's key
const LIMITS = {
  valueBytes: 60 * 1024, // one key's value, serialized
  moduleBytes: 5 * 1024 * 1024, // everything one module has stored
};

class ModuleData extends EventEmitter {
  constructor(modulesDir) {
    super();
    this.setMaxListeners(0);
    this.dir = modulesDir;
    this.cache = new Map(); // "id|scopeKey" -> Map(key -> { value, version, updatedAt, by })
  }

  // scopeKey is 'server' or 'room:<room id>'.
  fileFor(id, scopeKey) {
    const base = path.join(this.dir, id, 'data');
    if (scopeKey === 'server') return path.join(base, 'server.json');
    const m = /^room:(.+)$/.exec(scopeKey);
    if (m && ROOM_RE.test(m[1])) return path.join(base, `room-${m[1]}.json`);
    const p = /^person:(.+)$/.exec(scopeKey);
    if (p && PERSON_RE.test(p[1])) return path.join(base, `person-${p[1]}.json`);
    throw new StoreError('bad scope');
  }

  load(id, scopeKey) {
    const cacheKey = `${id}|${scopeKey}`;
    let map = this.cache.get(cacheKey);
    if (map) return map;
    map = new Map();
    try {
      const raw = JSON.parse(fs.readFileSync(this.fileFor(id, scopeKey), 'utf8'));
      for (const [k, v] of Object.entries(raw)) if (v && typeof v === 'object' && 'value' in v) map.set(k, v);
    } catch {
      // nothing stored yet
    }
    this.cache.set(cacheKey, map);
    return map;
  }

  serialize(map) {
    return JSON.stringify(Object.fromEntries(map));
  }

  persist(id, scopeKey, map) {
    const file = this.fileFor(id, scopeKey);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, this.serialize(map));
    fs.renameSync(tmp, file);
  }

  // Bytes this module has on disk for data, so the cap can be checked.
  usage(id) {
    const base = path.join(this.dir, id, 'data');
    try {
      return fs.readdirSync(base).reduce((sum, f) => sum + (fs.statSync(path.join(base, f)).size || 0), 0);
    } catch {
      return 0;
    }
  }

  // Drop cached scopes for a module (after its data was deleted).
  forget(id) {
    for (const key of [...this.cache.keys()]) if (key.startsWith(`${id}|`)) this.cache.delete(key);
  }

  cleanKey(key) {
    if (typeof key !== 'string' || !KEY_RE.test(key)) throw new StoreError('a key is 1 to 128 letters, digits and . _ : / -');
    return key;
  }

  list(id, scopeKey, prefix = '') {
    const out = [];
    for (const [key, entry] of this.load(id, scopeKey)) {
      if (key.startsWith(prefix)) out.push({ key, ...entry });
    }
    return out.sort((a, b) => (a.key < b.key ? -1 : 1));
  }

  get(id, scopeKey, key) {
    const entry = this.load(id, scopeKey).get(this.cleanKey(key));
    return entry ? { key, ...entry } : null;
  }

  // Last write wins per key. If the caller says which version it read
  // (`expected`) and someone wrote since, that is a conflict, not an overwrite.
  put(id, scopeKey, key, value, { expected = null, by = '' } = {}) {
    this.cleanKey(key);
    if (value === undefined) throw new StoreError('a value is required');
    const map = this.load(id, scopeKey);
    const existing = map.get(key);
    if (expected !== null && expected !== undefined && (existing?.version || 0) !== expected) {
      const err = new StoreError('someone changed this since you read it', 409);
      err.current = existing ? { key, ...existing } : null;
      throw err;
    }
    const serializedValue = JSON.stringify(value);
    if (serializedValue === undefined || serializedValue.length > LIMITS.valueBytes) {
      throw new StoreError(`a value can be at most ${LIMITS.valueBytes / 1024} KB`, 413);
    }
    const entry = { value, version: (existing?.version || 0) + 1, updatedAt: new Date().toISOString(), by: String(by).slice(0, 40) };
    const next = new Map(map);
    next.set(key, entry);
    const before = this.usage(id);
    const oldSize = (() => { try { return fs.statSync(this.fileFor(id, scopeKey)).size; } catch { return 0; } })();
    if (before - oldSize + this.serialize(next).length > LIMITS.moduleBytes) {
      throw new StoreError(`this module's storage is full (${LIMITS.moduleBytes / (1024 * 1024)} MB)`, 413);
    }
    this.persist(id, scopeKey, next);
    this.cache.set(`${id}|${scopeKey}`, next);
    const change = { module: id, scopeKey, key, ...entry, deleted: false };
    this.emit('change', change);
    return { key, ...entry };
  }

  remove(id, scopeKey, key, { expected = null, by = '' } = {}) {
    this.cleanKey(key);
    const map = this.load(id, scopeKey);
    const existing = map.get(key);
    if (!existing) return { key, deleted: true, version: 0 };
    if (expected !== null && expected !== undefined && existing.version !== expected) {
      const err = new StoreError('someone changed this since you read it', 409);
      err.current = { key, ...existing };
      throw err;
    }
    const next = new Map(map);
    next.delete(key);
    this.persist(id, scopeKey, next);
    this.cache.set(`${id}|${scopeKey}`, next);
    const change = { module: id, scopeKey, key, value: null, version: existing.version + 1, updatedAt: new Date().toISOString(), by: String(by).slice(0, 40), deleted: true };
    this.emit('change', change);
    return { key, deleted: true, version: change.version };
  }
}

module.exports = { ModuleData, LIMITS: { ...LIMITS } };
