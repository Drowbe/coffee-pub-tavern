// The settings a module declares (module.json `settings`) and the values people choose for them. A setting has a
// scope that says who chooses it and where it is kept: the whole `server` (an admin), one `room` (an admin or that
// room's moderators), or each `person` (themselves). Tavern draws the forms and keeps the values; a module only
// reads them. Values are plain data (a yes/no, a choice, a number or a short text), never secrets. Persists to
// DATA_DIR/modules/settings.json.

'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const SCOPES = ['server', 'room', 'person'];
const { cleanRows } = require('./setting-list');
const TYPES = ['boolean', 'choice', 'number', 'text', 'url', 'file', 'files', 'list'];

class SettingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// One value made to fit its definition, or a SettingError saying why not.
function cleanValue(def, raw) {
  if (def.type === 'boolean') {
    if (typeof raw !== 'boolean') throw new SettingError(`${def.label} must be on or off`);
    return raw;
  }
  if (def.type === 'choice') {
    if (!def.options.some((o) => o.value === raw)) throw new SettingError(`${def.label} must be one of its choices`);
    return raw;
  }
  if (def.type === 'number') {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new SettingError(`${def.label} must be a number`);
    if ((def.min !== undefined && raw < def.min) || (def.max !== undefined && raw > def.max)) throw new SettingError(`${def.label} must be between ${def.min ?? 'any'} and ${def.max ?? 'any'}`);
    return raw;
  }
  if (def.type === 'url') {
    if (typeof raw !== 'string') throw new SettingError(`${def.label} must be an address`);
    const t = raw.trim();
    if (!t) return '';
    let u;
    try { u = new URL(t); } catch { throw new SettingError(`${def.label} must be a web address`); }
    if (!/^https?:$/.test(u.protocol) || t.length > 500) throw new SettingError(`${def.label} must be an http or https address`);
    if (u.username || u.password) throw new SettingError(`${def.label} must not contain a user name or password`);
    if (def.httpsOnly && u.protocol !== 'https:') throw new SettingError(`${def.label} must be an https address`);
    if (def.pathEnds && !u.pathname.toLowerCase().endsWith(def.pathEnds.toLowerCase())) throw new SettingError(`${def.label} must be the address of a ${def.pathEnds} file`);
    return t;
  }
  if (def.type === 'list') {
    try {
      return cleanRows(raw, def);
    } catch (err) {
      throw new SettingError(`${def.label} ${err.message}`);
    }
  }
  if (def.type === 'files') {
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    if (list.length > 20 || list.some((n) => typeof n !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(n))) throw new SettingError(`${def.label} must be a list of file names`);
    return [...new Set(list)];
  }
  if (def.type === 'file') {
    if (typeof raw !== 'string' || (raw !== '' && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(raw))) throw new SettingError(`${def.label} must be the name of a file`);
    return raw;
  }
  if (typeof raw !== 'string') throw new SettingError(`${def.label} must be text`);
  const text = raw.replace(/\p{Cc}/gu, ' ').trim();
  if (text.length > def.maxLength) throw new SettingError(`${def.label} is too long`);
  return text;
}

class ModuleSettings extends EventEmitter {
  constructor(modulesDir) {
    super();
    this.setMaxListeners(0);
    this.file = path.join(modulesDir, 'settings.json');
    this.data = { server: {}, rooms: {}, people: {} };
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && typeof raw === 'object') this.data = { server: raw.server || {}, rooms: raw.rooms || {}, people: raw.people || {} };
    } catch {
      // nothing yet
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  // Where a scope's values for one module are kept.
  bucket(moduleId, scope, ctx, create = false) {
    let holder;
    if (scope === 'server') holder = this.data.server;
    else if (scope === 'room') holder = (this.data.rooms[ctx.roomId] ||= {});
    else holder = (this.data.people[ctx.userKey] ||= {});
    if (!holder[moduleId] && create) holder[moduleId] = {};
    return holder[moduleId] || {};
  }

  // What is chosen for a scope, and the default for what is not: { key: value } for the settings of that scope.
  values(manifest, scope, ctx) {
    const stored = this.bucket(manifest.id, scope, ctx);
    const out = {};
    for (const def of manifest.settings || []) if (def.scope === scope) out[def.key] = def.key in stored ? stored[def.key] : def.default;
    for (const def of manifest.settings || []) {
      // A choice that grew out of another setting starts as the option that keeps what was already set.
      const dif = def.scope === scope && def.type === 'choice' && def.defaultIfSet;
      if (dif && !(def.key in stored) && typeof stored[dif.key] === 'string' && stored[dif.key]) out[def.key] = dif.value;
    }
    for (const def of manifest.settings || []) if (def.scope === scope && def.type === 'files' && typeof out[def.key] === 'string') out[def.key] = out[def.key] ? [out[def.key]] : []; // from when it was one file
    return out;
  }

  // Everything a module sees for this viewer: server, room and person values together.
  effective(manifest, { roomId, userKey }) {
    return {
      ...this.values(manifest, 'server', {}),
      ...(roomId ? this.values(manifest, 'room', { roomId }) : Object.fromEntries((manifest.settings || []).filter((d) => d.scope === 'room').map((d) => [d.key, d.default]))),
      ...(userKey ? this.values(manifest, 'person', { userKey }) : Object.fromEntries((manifest.settings || []).filter((d) => d.scope === 'person').map((d) => [d.key, d.default]))),
    };
  }

  // Set some values of one scope. Only keys the module declares for that scope are taken; the rest are refused.
  set(manifest, scope, ctx, values, by) {
    if (!SCOPES.includes(scope)) throw new SettingError('no such kind of setting');
    const defs = (manifest.settings || []).filter((d) => d.scope === scope);
    const clean = {};
    for (const [key, raw] of Object.entries(values && typeof values === 'object' ? values : {})) {
      const def = defs.find((d) => d.key === key);
      if (!def) throw new SettingError(`${manifest.name} has no ${scope} setting "${key}"`);
      clean[key] = cleanValue(def, raw);
    }
    const bucket = this.bucket(manifest.id, scope, ctx, true);
    const changed = Object.keys(clean).filter((k) => JSON.stringify(bucket[k]) !== JSON.stringify(clean[k]));
    Object.assign(bucket, clean);
    if (changed.length) {
      this.save();
      this.emit('change', { module: manifest.id, scope, roomId: ctx.roomId || null, userKey: ctx.userKey || null, keys: changed, by: by || null });
    }
    return { values: this.values(manifest, scope, ctx), changed };
  }

  forgetModule(moduleId) {
    delete this.data.server[moduleId];
    for (const r of Object.values(this.data.rooms)) delete r[moduleId];
    for (const p of Object.values(this.data.people)) delete p[moduleId];
    this.save();
  }

  forgetRoom(roomId) {
    if (this.data.rooms[roomId]) {
      delete this.data.rooms[roomId];
      this.save();
    }
  }
}

module.exports = { ModuleSettings, SettingError, cleanValue, SETTING_SCOPES: SCOPES, SETTING_TYPES: TYPES };
