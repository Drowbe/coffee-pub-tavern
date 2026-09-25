// Per-module data: a small key-value store for each module, per scope (the
// whole environment, one space, or one person), with a version on every key and a change event
// on every write so the server can push updates live. See
// documentation/architecture/architecture-modules.md.
//
// Files live under DATA_DIR/modules/<id>/data/: environment.json, space-<id>.json and person-<key>.json.
// Each is loaded once, kept in memory, and rewritten whole on a change -- a
// module's data is small by design (a 5 MB cap per module).

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { StoreError } = require('./store');
const { word } = require('./words');

const KEY_RE = /^[A-Za-z0-9_.:/-]{1,128}$/;
const SPACE_RE = /^[a-z0-9]{4,16}$/;
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

  // scopeKey is 'environment', 'space:<space id>' or 'person:<key>'.
  fileFor(id, scopeKey) {
    const base = path.join(this.dir, id, 'data');
    if (scopeKey === 'environment') return path.join(base, 'environment.json');
    const m = /^space:(.+)$/.exec(scopeKey);
    if (m && SPACE_RE.test(m[1])) return path.join(base, `space-${m[1]}.json`);
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

  // Every scope this module has a data file for: 'environment', 'space:<id>' and 'person:<key>'.
  scopesOf(id) {
    let names = [];
    try { names = fs.readdirSync(path.join(this.dir, id, 'data')); } catch { return []; }
    const out = [];
    for (const n of names.sort()) {
      if (n === 'environment.json') out.push('environment');
      const m = /^space-(.+)\.json$/.exec(n);
      if (m && SPACE_RE.test(m[1])) out.push(`space:${m[1]}`);
      const p = /^person-(.+)\.json$/.exec(n);
      if (p && PERSON_RE.test(p[1])) out.push(`person:${p[1]}`);
    }
    return out;
  }

  // A module's author renamed a key prefix (storage.renamed in module.json): every key starting with `from`, in every
  // scope, moves to the same key starting with `to`, keeping its value, version, time and who wrote it. A key whose new
  // name is already taken is never overwritten: both are left as they are, and counted in `kept`. Answers
  // { moved, kept, scopes } (the number of keys moved, of keys left because the new name was taken, and of scope files
  // rewritten). Nothing to move writes nothing, so running it again over its own result changes nothing. No change
  // events are sent: it runs when the module is installed or updated, before its pages ask again.
  renamePrefix(id, from, to) {
    let moved = 0;
    let kept = 0;
    let scopes = 0;
    for (const scopeKey of this.scopesOf(id)) {
      const map = this.load(id, scopeKey);
      const next = new Map();
      let changed = false;
      for (const [key, entry] of map) {
        if (!key.startsWith(from)) { next.set(key, entry); continue; }
        const newKey = to + key.slice(from.length);
        if (map.has(newKey) || next.has(newKey) || !KEY_RE.test(newKey)) { next.set(key, entry); kept += 1; continue; }
        next.set(newKey, entry);
        moved += 1;
        changed = true;
      }
      if (!changed) continue;
      this.persist(id, scopeKey, next);
      this.cache.set(`${id}|${scopeKey}`, next);
      scopes += 1;
    }
    return { moved, kept, scopes };
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
      throw new StoreError(`this ${word('module')}'s storage is full (${LIMITS.moduleBytes / (1024 * 1024)} MB)`, 413);
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
