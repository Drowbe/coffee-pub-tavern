// The Names migration's frame (documentation/plans/plan-names.md, "The migration"): renames stored keys, files and
// folders from the old words (room, tenant, table, ...) to the environment's, space's and the rest's own names, one
// recorded part per step of that plan. This file is the frame only: the version, the record of parts, the copy
// into pre-names/ and the refusal of a newer backup. The parts themselves land with the steps that need them
// (names-environment for the host; names-table, names-roles, names-spaces, names-pointers, names-objects,
// names-asides for an environment; names-copies-removed, last in both, deletes the copies again) and are added to
// HOST_PARTS and ENVIRONMENT_PARTS below, in the order they run.
//
// An environment's record lives in its own app.json: `version` goes from 1 to NAMES_VERSION with the first part
// that runs, and `migrations: [{ id, at, moved }]` gains one entry per part. The host's lives in host.json the
// same way (`migrations` only: host.json has never had a version). A recorded part never runs again.
//
// Before a part writes anything, every JSON file it will rewrite (and the record file itself) is copied into
// <environment>/pre-names/<part>/ (the host's into DATA_DIR/pre-names-host/<part>/, so that a single-environment
// install's own pre-names/ and the host's never share a folder when the pre-environment move carries DATA_DIR's
// contents into an environment's folder), keeping their paths. Folders a part only moves are listed in `moved`.
// A part stages its writes and moves; nothing is committed until the whole part has run without an error and every
// write and move has been checked, and any error stops the start with the file named. Before each folder moves, the
// move is noted beside the copy (pre-names/<part>.moved.json), so an attempt that stops part-way (a failed write,
// or the process killed between two moves) leaves the next start's attempt able to record every folder the part
// moved, not only its own.
//
// A record naming a part this server does not know is from a newer Magpie: the start (or, for an environment built
// later, that environment) is refused with the file and the part named, the same way a restore refuses such a
// backup (backupRefusal below).
//
// A part is { id, files(dir) -> [relative paths of the JSON files it will rewrite], run(ctx) -> nothing, copies? }
// (copies: false keeps no copy first; only the part that deletes the copies uses it).
// ctx: { dir, copyRoot (where this part's originals were copied), read(rel) (parsed JSON, or undefined when the file
// is not there), write(rel, value), move(fromRel, toRel), remove(rel) (a folder deleted), ranThisStart (the ids of
// the parts that ran before it in this start), wait() (not recorded now; it runs again on the next start) }. write
// only takes a path files() listed (or the record file), since only those were copied first. write, move and remove
// are staged and applied after run returns. A part must be idempotent by shape: run over data it has
// already changed, it changes nothing.
'use strict';

const fs = require('fs');
const path = require('path');

const NAMES_VERSION = 2; // app.json's version once the first names part has run
const ENVIRONMENT_RECORD = 'app.json';
const LEGACY_ENVIRONMENT_RECORD = 'tavern.json'; // Store renames this to app.json; a part runs against the new name
const HOST_RECORD = 'host.json';
const ENVIRONMENT_COPY_DIR = 'pre-names';
const HOST_COPY_DIR = 'pre-names-host';
const { isDeepStrictEqual } = require('util');

// `reason` is 'newer' (the data records a part this server does not know), 'unreadable' (the environment's app.json
// is there but is not valid JSON) or 'failed' (a part could not finish).
class MigrationError extends Error {
  constructor(message, file, reason = 'failed') {
    super(message);
    this.name = 'MigrationError';
    this.file = file || null;
    this.reason = reason;
  }
}

// names-environment (plan-names step 2): the host's own words. DATA_DIR/tenants/ becomes environments/,
// tenants-deleted/ becomes environments-deleted/, and host.json's `tenants` becomes `environments`, in the same
// place among its keys; everything else in host.json is kept as it is. Over a host already in the new shape
// (by an earlier run, or by hand) it changes nothing.
const HOST_FOLDERS = [['tenants', 'environments'], ['tenants-deleted', 'environments-deleted']];
const environmentPart = {
  id: 'names-environment',
  files: () => [HOST_RECORD],
  run(ctx) {
    const host = ctx.read(HOST_RECORD);
    if (host && typeof host === 'object' && !Array.isArray(host) && Object.prototype.hasOwnProperty.call(host, 'tenants')) {
      const had = host.environments;
      if (Array.isArray(had) && had.length && !isDeepStrictEqual(had, host.tenants)) {
        const file = path.join(ctx.dir, HOST_RECORD);
        throw new MigrationError(`it lists environments under both "tenants" and "environments", and they differ, so it cannot tell which to keep. Nothing was changed: remove the out-of-date key from ${file} and start again (a copy of the file as it was is in ${ctx.copyRoot}).`, file);
      }
      const next = {};
      for (const [key, value] of Object.entries(host)) {
        if (key === 'environments') continue;
        next[key === 'tenants' ? 'environments' : key] = value;
      }
      ctx.write(HOST_RECORD, next);
    }
    for (const [from, to] of HOST_FOLDERS) {
      if (fs.existsSync(path.join(ctx.dir, from))) ctx.move(from, to);
    }
  },
};

// names-table (plan-names step 3): the call is no longer "the table". app.json's settings.tableName (the call's
// display name, "The Table") and settings.room (the call's base name, 'table') are removed; nothing else in app.json
// changes, and the keys around them keep their order. A call's name is now worked out, never stored (decision 14).
// The Lobby's description, when it is still exactly the one every install was seeded with ("Everyone at the
// table."), becomes the new seed ("Where everyone meets."); a description anyone wrote is left as it is. Over data
// with neither (a new install, or one already migrated) it writes nothing.
const TABLE_SETTINGS = ['tableName', 'room'];
const OLD_LOBBY_DESCRIPTION = 'Everyone at the table.';
const NEW_LOBBY_DESCRIPTION = 'Where everyone meets.';
const tablePart = {
  id: 'names-table',
  files: () => [ENVIRONMENT_RECORD],
  run(ctx) {
    const app = ctx.read(ENVIRONMENT_RECORD);
    const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
    if (!isObject(app)) return;
    let next = app;
    if (isObject(app.settings) && TABLE_SETTINGS.some((key) => Object.prototype.hasOwnProperty.call(app.settings, key))) {
      next = { ...next, settings: Object.fromEntries(Object.entries(app.settings).filter(([key]) => !TABLE_SETTINGS.includes(key))) };
    }
    if (Array.isArray(app.rooms) && app.rooms.some((r) => isObject(r) && r.id === 'lobby' && r.description === OLD_LOBBY_DESCRIPTION)) {
      next = { ...next, rooms: app.rooms.map((r) => (isObject(r) && r.id === 'lobby' && r.description === OLD_LOBBY_DESCRIPTION ? { ...r, description: NEW_LOBBY_DESCRIPTION } : r)) };
    }
    if (next !== app) ctx.write(ENVIRONMENT_RECORD, next);
  },
};

// names-roles (plan-names step 4): the role values. users[].role `admin` becomes `owner`, except the host admin's
// stand-in account (hostAdmin: true), which is always `admin` (whatever it was set to); `user` becomes `member`.
// settings.roles, the Roles grid's changes per role, has its `user` key renamed `member` (and an `admin` key, which
// no build ever wrote but hand-made data could hold, `owner`), in the same place among its keys. An invite's `role`,
// which no build wrote either, is renamed the same way if it is there. A value in the new shape is left alone, so
// over migrated or new data it writes nothing. settings.roles holding both `user` and `member`, and differing, is
// refused rather than guessed at.
const OLD_ROLE_VALUES = { admin: 'owner', user: 'member' };
const rolesPart = {
  id: 'names-roles',
  files: () => [ENVIRONMENT_RECORD],
  run(ctx) {
    const app = ctx.read(ENVIRONMENT_RECORD);
    const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
    if (!isObject(app)) return;
    let next = app;
    const renamedValue = (role) => (typeof role === 'string' && Object.prototype.hasOwnProperty.call(OLD_ROLE_VALUES, role) ? OLD_ROLE_VALUES[role] : role);
    if (Array.isArray(app.users)) {
      const roleOf = (u) => (u.hostAdmin === true ? 'admin' : renamedValue(u.role));
      if (app.users.some((u) => isObject(u) && 'role' in u && roleOf(u) !== u.role)) {
        next = { ...next, users: app.users.map((u) => (isObject(u) && 'role' in u && roleOf(u) !== u.role ? { ...u, role: roleOf(u) } : u)) };
      }
    }
    const roles = isObject(app.settings) && isObject(app.settings.roles) ? app.settings.roles : null;
    if (roles && Object.keys(roles).some((key) => Object.prototype.hasOwnProperty.call(OLD_ROLE_VALUES, key))) {
      for (const [from, to] of Object.entries(OLD_ROLE_VALUES)) {
        if (from in roles && to in roles && !isDeepStrictEqual(roles[from], roles[to])) {
          const file = path.join(ctx.dir, ENVIRONMENT_RECORD);
          throw new MigrationError(`its settings.roles has both "${from}" and "${to}", and they differ, so it cannot tell which to keep. Nothing was changed: remove the out-of-date key from ${file} and start again (a copy of the file as it was is in ${ctx.copyRoot}).`, file);
        }
      }
      const renamed = {};
      for (const [key, value] of Object.entries(roles)) {
        const to = renamedValue(key);
        if (to !== key && to in roles) continue; // the same value is there under the new name already
        renamed[to] = value;
      }
      next = { ...next, settings: { ...app.settings, roles: renamed } };
    }
    if (Array.isArray(app.invites) && app.invites.some((i) => isObject(i) && renamedValue(i.role) !== i.role)) {
      next = { ...next, invites: app.invites.map((i) => (isObject(i) && renamedValue(i.role) !== i.role ? { ...i, role: renamedValue(i.role) } : i)) };
    }
    if (next !== app) ctx.write(ENVIRONMENT_RECORD, next);
  },
};

// names-spaces (plan-names step 5a): a space is no longer a `room`, and the environment's own scope is no longer
// `server`. Every key, file and folder the host keeps for an environment:
//   app.json          rooms -> spaces, users[].rooms -> users[].spaces, invites[].rooms -> invites[].spaces,
//                     settings.serverName -> settings.environmentName (each in its own place among its keys)
//   chat.json         rooms -> spaces
//   images/           rooms/ -> spaces/ (the spaces' pictures), and each person's <key>/rooms/ -> <key>/spaces/
//   modules/registry.json   each module's allRooms -> allSpaces, rooms -> spaces
//   modules/settings.json   { server, rooms, people } -> { environment, spaces, people }
//   modules/<id>/data/      server.json -> environment.json, room-<id>.json -> space-<id>.json (moved, not rewritten:
//                           a module's own values are its own until names-objects)
//   modules/<id>/uploads/   server/ -> environment/, room-<id>/ -> space-<id>/
//   modules/links.json, bus.json, schedules.json, notifications.json, activity.json: the host's own records of
//                     modules, with scope keys room:<id> -> space:<id> and server -> environment, a pointer's scope
//                     room -> space (its `room` -> `space`) and server -> environment, roomId -> spaceId, and a
//                     notification's scope and a schedule's notify.to likewise.
// Asides stayed rows in `spaces` with `ephemeral` until names-asides (step 8, below). A key in both its old and new name that
// differ is refused rather than guessed at; over data already in the new shape it writes nothing and moves nothing.
const SPACE_FILES = ['chat.json', 'modules/registry.json', 'modules/settings.json', 'modules/links.json', 'modules/bus.json', 'modules/schedules.json', 'modules/notifications.json', 'modules/activity.json'];
const IMAGE_FOLDERS_NOT_PEOPLE = ['rooms', 'spaces', 'site', 'guest', 'default'];
const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// A scope key the host keeps (module data, uploads, the bus, schedules, the activity log) in its new name.
const newScopeKey = (k) => (k === 'server' ? 'environment' : typeof k === 'string' && k.startsWith('room:') ? `space:${k.slice(5)}` : k);
// A pointer ({ module, kind, id, scope, room? }) in its new shape; anything else as it is.
function newPointer(p) {
  if (!isPlainObject(p) || typeof p.module !== 'string' || typeof p.kind !== 'string' || typeof p.id !== 'string') return p;
  if (p.scope === 'server') return { ...p, scope: 'environment' };
  if (p.scope !== 'room') return p;
  const out = {};
  for (const [k, v] of Object.entries(p)) {
    if (k === 'scope') out.scope = 'space';
    else if (k === 'room') out.space = v;
    else if (k !== 'space') out[k] = v;
  }
  return out;
}
// Every pointer inside a host record, wherever it sits (a bus event's ref, an action's input and result).
function newPointersIn(value) {
  if (Array.isArray(value)) return value.map(newPointersIn);
  if (!isPlainObject(value)) return value;
  const p = newPointer(value);
  if (p !== value) return p;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, newPointersIn(v)]));
}
function spacesPart() {
  return {
    id: 'names-spaces',
    files: () => [ENVIRONMENT_RECORD, ...SPACE_FILES],
    run(ctx) {
      // One key renamed where it stands, the others kept in their order. Both names present and different: refused.
      const renameKey = (obj, from, to, where, file) => {
        if (!isPlainObject(obj) || !has(obj, from)) return obj;
        if (has(obj, to) && !isDeepStrictEqual(obj[from], obj[to]) && !(Array.isArray(obj[to]) ? obj[to].length === 0 : isPlainObject(obj[to]) && !Object.keys(obj[to]).length)) {
          const full = path.join(ctx.dir, file);
          throw new MigrationError(`its ${where} has both "${from}" and "${to}", and they differ, so it cannot tell which to keep. Nothing was changed: remove the out-of-date key from ${full} and start again (a copy of the file as it was is in ${ctx.copyRoot}).`, full);
        }
        const out = {};
        for (const [k, v] of Object.entries(obj)) {
          if (k === to) continue;
          out[k === from ? to : k] = v;
        }
        return out;
      };
      const writeIfChanged = (rel, before, after) => { if (!isDeepStrictEqual(before, after)) ctx.write(rel, after); };

      const app = ctx.read(ENVIRONMENT_RECORD);
      if (isPlainObject(app)) {
        let next = renameKey(app, 'rooms', 'spaces', 'top level', ENVIRONMENT_RECORD);
        if (Array.isArray(next.users)) next = { ...next, users: next.users.map((u, n) => renameKey(u, 'rooms', 'spaces', `users[${n}]`, ENVIRONMENT_RECORD)) };
        if (Array.isArray(next.invites)) next = { ...next, invites: next.invites.map((i, n) => renameKey(i, 'rooms', 'spaces', `invites[${n}]`, ENVIRONMENT_RECORD)) };
        if (isPlainObject(next.settings)) next = { ...next, settings: renameKey(next.settings, 'serverName', 'environmentName', 'settings', ENVIRONMENT_RECORD) };
        writeIfChanged(ENVIRONMENT_RECORD, app, next);
      }

      const chat = ctx.read('chat.json');
      if (isPlainObject(chat)) writeIfChanged('chat.json', chat, renameKey(chat, 'rooms', 'spaces', 'top level', 'chat.json'));

      const registry = ctx.read('modules/registry.json');
      if (isPlainObject(registry) && isPlainObject(registry.modules)) {
        const modules = Object.fromEntries(Object.entries(registry.modules).map(([id, e]) => [id, renameKey(renameKey(e, 'allRooms', 'allSpaces', `module "${id}"`, 'modules/registry.json'), 'rooms', 'spaces', `module "${id}"`, 'modules/registry.json')]));
        writeIfChanged('modules/registry.json', registry, { ...registry, modules });
      }

      const settings = ctx.read('modules/settings.json');
      if (isPlainObject(settings)) {
        writeIfChanged('modules/settings.json', settings, renameKey(renameKey(settings, 'server', 'environment', 'top level', 'modules/settings.json'), 'rooms', 'spaces', 'top level', 'modules/settings.json'));
      }

      const links = ctx.read('modules/links.json');
      if (Array.isArray(links)) writeIfChanged('modules/links.json', links, links.map((l) => (isPlainObject(l) ? { ...l, from: newPointer(l.from), to: newPointer(l.to) } : l)));

      const bus = ctx.read('modules/bus.json');
      if (isPlainObject(bus)) {
        const place = (e) => (isPlainObject(e) ? newPointersIn({ ...e, ...(has(e, 'scopeKey') ? { scopeKey: newScopeKey(e.scopeKey) } : {}) }) : e);
        writeIfChanged('modules/bus.json', bus, { ...bus, ...(Array.isArray(bus.events) ? { events: bus.events.map(place) } : {}), ...(Array.isArray(bus.actions) ? { actions: bus.actions.map(place) } : {}) });
      }

      const newTo = (to) => (to === 'room' ? 'space' : to === 'server' ? 'environment' : to);
      const schedules = ctx.read('modules/schedules.json');
      if (Array.isArray(schedules)) {
        writeIfChanged('modules/schedules.json', schedules, schedules.map((s, n) => {
          if (!isPlainObject(s)) return s;
          let out = renameKey(s, 'roomId', 'spaceId', `schedule ${n}`, 'modules/schedules.json');
          if (has(out, 'scopeKey')) {
            const scopeKey = newScopeKey(out.scopeKey);
            out = { ...out, scopeKey, ...(typeof out.module === 'string' && typeof out.key === 'string' ? { id: `${out.module}|${scopeKey}|${out.key}` } : {}) };
          }
          if (isPlainObject(out.notify) && has(out.notify, 'to')) out = { ...out, notify: { ...out.notify, to: newTo(out.notify.to) } };
          return out;
        }));
      }

      const notifications = ctx.read('modules/notifications.json');
      if (isPlainObject(notifications)) {
        writeIfChanged('modules/notifications.json', notifications, Object.fromEntries(Object.entries(notifications).map(([who, list]) => [who, Array.isArray(list) ? list.map((n, i) => {
          if (!isPlainObject(n)) return n;
          const out = renameKey(n, 'roomId', 'spaceId', `notification ${i} of ${who}`, 'modules/notifications.json');
          return has(out, 'scope') ? { ...out, scope: newTo(out.scope) } : out;
        }) : list])));
      }

      const activity = ctx.read('modules/activity.json');
      if (Array.isArray(activity)) writeIfChanged('modules/activity.json', activity, activity.map((a) => (isPlainObject(a) && has(a, 'scope') ? { ...a, scope: newScopeKey(a.scope) } : a)));

      // The folders and files that only move. One already there under its new name as well is refused before anything
      // moves or is written, since the part cannot tell which of the two holds what is current.
      const list = (rel) => { try { return fs.readdirSync(path.join(ctx.dir, rel), { withFileTypes: true }); } catch { return []; } };
      const moves = [];
      const move = (from, to) => moves.push([from, to]);
      if (fs.existsSync(path.join(ctx.dir, 'images', 'rooms'))) move('images/rooms', 'images/spaces');
      for (const d of list('images')) {
        if (!d.isDirectory() || IMAGE_FOLDERS_NOT_PEOPLE.includes(d.name)) continue;
        if (fs.existsSync(path.join(ctx.dir, 'images', d.name, 'rooms'))) move(`images/${d.name}/rooms`, `images/${d.name}/spaces`);
      }
      for (const d of list('modules')) {
        if (!d.isDirectory() || d.name.startsWith('.')) continue;
        for (const f of list(`modules/${d.name}/data`)) {
          if (!f.isFile()) continue;
          if (f.name === 'server.json') move(`modules/${d.name}/data/server.json`, `modules/${d.name}/data/environment.json`);
          else if (/^room-[a-z0-9]{4,16}\.json$/.test(f.name)) move(`modules/${d.name}/data/${f.name}`, `modules/${d.name}/data/space-${f.name.slice(5)}`);
        }
        for (const f of list(`modules/${d.name}/uploads`)) {
          if (!f.isDirectory()) continue;
          if (f.name === 'server') move(`modules/${d.name}/uploads/server`, `modules/${d.name}/uploads/environment`);
          else if (/^room-[a-z0-9]{4,16}$/.test(f.name)) move(`modules/${d.name}/uploads/${f.name}`, `modules/${d.name}/uploads/space-${f.name.slice(5)}`);
        }
      }
      for (const [from, to] of moves) {
        if (!fs.existsSync(path.join(ctx.dir, to))) continue;
        const full = path.join(ctx.dir, to);
        throw new MigrationError(`${path.join(ctx.dir, from)} and ${full} are both there, so it cannot tell which to keep. Nothing was changed: remove the out-of-date one and start again (a copy of the JSON files as they were is in ${ctx.copyRoot}).`, full);
      }
      for (const [from, to] of moves) ctx.move(from, to);
    },
  };
}

// names-pointers (plan-names decision 12, brought forward from step 7's names-objects so that links saved before
// step 5c still resolve once the host stops accepting the old pointer scopes): a module stores pointers to objects
// inside its own values, which the host cannot read by meaning, so every JSON file under modules/<id>/data/ (any
// depth) is searched, through every value at any depth, for exactly the old pointer's shape, and each one found is
// rewritten to the new shape: an object with string `module`, `kind` and `id`, and either `scope: 'server'`
// (becoming `scope: 'environment'`) or `scope: 'room'` with a string `room` (becoming `scope: 'space'` and
// `space`). Its other keys stay, in their places. By shape, never by module: anything else, a module's own object
// that merely has a `scope` key among them, is left exactly as it was. A file with no old pointer is neither
// listed, copied nor written; a file that is not valid JSON is left alone (the module never read it either). Over
// data already in the new shape it writes nothing. The host's own record of the bus (modules/bus.json) is searched
// the same way, by shape, through its events and actions: an event's `data` is a module's own values, carried as they
// were published, so one published before step 5c can hold an old pointer (names-spaces rewrote the host's own fields
// there, but data published after it, until 5c, still came in the old shape). Step 7's other renames (refs to
// objects, card to summary) are names-objects', below.
const isOldPointer = (v) => isPlainObject(v) && typeof v.module === 'string' && typeof v.kind === 'string' && typeof v.id === 'string'
  && (v.scope === 'server' || (v.scope === 'room' && typeof v.room === 'string'));
function oldPointersRewritten(value) {
  if (Array.isArray(value)) return value.map(oldPointersRewritten);
  if (!isPlainObject(value)) return value;
  if (isOldPointer(value)) return newPointer(value);
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, oldPointersRewritten(v)]));
}
const hasOldPointer = (value) => (Array.isArray(value) ? value.some(hasOldPointer) : isPlainObject(value) && (isOldPointer(value) || Object.values(value).some(hasOldPointer)));
// The module data files, and the bus record, holding at least one old pointer (relative paths).
function filesWithOldPointers(dir) {
  const out = [];
  const list = (rel) => { try { return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return []; } };
  const walk = (rel) => {
    for (const e of list(rel)) {
      if (e.name.startsWith('.')) continue;
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (e.isFile() && e.name.endsWith('.json')) {
        let value;
        try { value = JSON.parse(fs.readFileSync(path.join(dir, child), 'utf8')); } catch { continue; }
        if (hasOldPointer(value)) out.push(child);
      }
    }
  };
  for (const d of list('modules')) if (d.isDirectory() && !d.name.startsWith('.')) walk(`modules/${d.name}/data`);
  out.sort();
  try {
    if (hasOldPointer(JSON.parse(fs.readFileSync(path.join(dir, 'modules', 'bus.json'), 'utf8')))) out.push('modules/bus.json');
  } catch { /* no bus record, or one the bus itself could not read either */ }
  return out;
}
const pointersPart = {
  id: 'names-pointers',
  files: (dir) => filesWithOldPointers(dir),
  run(ctx) {
    for (const rel of filesWithOldPointers(ctx.dir)) {
      const value = ctx.read(rel);
      const next = oldPointersRewritten(value);
      if (!isDeepStrictEqual(value, next)) ctx.write(rel, next);
    }
  },
};

// names-objects (plan-names step 7: host.refs becomes host.objects, a card an object's summary, the manifest's
// refs.produces[].card its summary, the AI's items and cards its objects and summaries). None of these names is stored
// by the host: links.json, bus.json, schedules.json and notifications.json hold pointers ({ module, kind, id, scope,
// space? }, their names unchanged) and a module's own values, never a summary; a summary is made afresh on every
// request; an installed module's module.json is its author's original, which is never rewritten (one still saying
// `card` is kept but can't run until its author updates it, and a bundled one updates itself on start); and a
// module's own keys that say item or card (the Planner's `item:` keys) are the module's to rename (decision 19). So
// the part moves and rewrites nothing. It is still recorded, like every part, so that data from after step 7 is
// refused by a build from before it rather than read by one that expects the old manifest names.
const objectsPart = {
  id: 'names-objects',
  files: () => [],
  run() {},
};

// names-asides (plan-names step 8): an aside is no longer an `ephemeral` row among the spaces but its own record,
// app.json's `asides`. The rows in `spaces` with `ephemeral` set are dropped rather than moved: an aside lives only
// while someone is in it, and anyone still in one when the server upgrades is back in a space after the reload. Every
// other space loses the three keys only an aside ever used (`ephemeral`, `origin` and `private`, which every space
// carried as false, null and false), each in place, the rest of the row and its order kept. Nothing else changes: an
// aside never had chat history, pictures, modules or settings of its own. Over data already in the new shape (no
// such row, no such key) it writes nothing.
const ASIDE_ONLY_KEYS = ['ephemeral', 'origin', 'private'];
const asidesPart = {
  id: 'names-asides',
  files: () => [ENVIRONMENT_RECORD],
  run(ctx) {
    const app = ctx.read(ENVIRONMENT_RECORD);
    if (!isPlainObject(app) || !Array.isArray(app.spaces)) return;
    const spaces = app.spaces
      .filter((r) => !(isPlainObject(r) && r.ephemeral))
      .map((r) => (isPlainObject(r) && ASIDE_ONLY_KEYS.some((k) => has(r, k)) ? Object.fromEntries(Object.entries(r).filter(([k]) => !ASIDE_ONLY_KEYS.includes(k))) : r));
    if (!isDeepStrictEqual(spaces, app.spaces)) ctx.write(ENVIRONMENT_RECORD, { ...app, spaces });
  },
};

// names-copies-removed (plan-names step 10, decision 18): the copies every earlier part kept are deleted, the
// environment's pre-names/ (or the host's pre-names-host/) as a whole, now that the Studio alias is gone. It keeps no
// copy of its own (`copies: false`). When any other part ran in the same start (data upgraded straight from before
// the rename), the copies that start made are kept for one more start: the part waits, unrecorded, and deletes them
// on the next start, so data never loses its originals in the very start that changed it. With no copies there it
// only records itself.
const copiesRemovedPart = (copyDir) => ({
  id: 'names-copies-removed',
  copies: false,
  files: () => [],
  run(ctx) {
    if (ctx.ranThisStart.length) return ctx.wait();
    if (fs.existsSync(path.join(ctx.dir, copyDir))) ctx.remove(copyDir);
    return undefined;
  },
});

// Every part this server knows, in the order they run; each step of the plan adds its own to the end of its list.
const HOST_PARTS = [environmentPart, copiesRemovedPart(HOST_COPY_DIR)];
const ENVIRONMENT_PARTS = [tablePart, rolesPart, spacesPart(), pointersPart, objectsPart, asidesPart, copiesRemovedPart(ENVIRONMENT_COPY_DIR)];

// What a person asking for a refused environment is told (plan-names.md, "The migration"); the file and the detail
// go to the log and the host console only.
const REFUSED_NEWER = "This environment's data is from a newer version of Magpie.";
const REFUSED_FAILED = "This environment's data could not be updated. The host admin has been told.";
const REFUSED_UNREADABLE = "This environment's data could not be read. The host admin has been told.";
const refusalSentence = (err) => (err && err.reason === 'newer' ? REFUSED_NEWER : err && err.reason === 'unreadable' ? REFUSED_UNREADABLE : REFUSED_FAILED);

// Any error on the way through a migration, as a MigrationError naming a file: an environment with a permissions
// problem is refused like any other, never an uncaught crash.
function asMigrationError(err, file, what) {
  if (err instanceof MigrationError) return err;
  return new MigrationError(`${what || 'The names migration stopped'} at ${file}: ${err && err.message ? err.message : err}`, file);
}

function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return undefined;
    throw new MigrationError(`Could not read ${file}: ${err.message}`, file);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new MigrationError(`Could not read ${file}: it is not valid JSON (${err.message}).`, file);
  }
}

// The same, but an unreadable file is simply not a record (answers null), for the newer-data check that runs even
// when no part is due. An environment's unreadable app.json is refused before this (refuseUnreadable); host.json's
// own reading stays HostRegistry's business.
function readRecordLeniently(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
// A message as a whole sentence, so another can follow it: a message from the file system or a part often has no
// full stop of its own.
const endSentence = (text) => { const t = String(text).trim(); return /[.!?]$/.test(t) ? t : `${t}.`; };

// A path a part named, as one spelling ("./a//b.json" and "a/b.json" are the same file), kept inside `dir`.
function normalRel(rel) {
  return path.posix.normalize(String(rel).replace(/\\/g, '/')).replace(/^(\.\/)+/, '');
}
function inside(dir, rel) {
  const full = path.resolve(dir, normalRel(rel));
  if (full === dir || !full.startsWith(dir + path.sep)) throw new MigrationError(`A names migration part named a path outside ${dir}: ${rel}`, full);
  return full;
}

// The ids a record (a parsed app.json or host.json) says have run.
function recordedParts(record) {
  if (!record || !Array.isArray(record.migrations)) return [];
  return record.migrations.map((m) => (m && typeof m.id === 'string' ? m.id : null)).filter(Boolean);
}

// The parts a record says have run that this server does not know: a record from a newer Magpie.
function unknownParts(record, parts = ENVIRONMENT_PARTS) {
  const known = new Set(parts.map((p) => p.id));
  return recordedParts(record).filter((id) => !known.has(id));
}

const NEWER_BACKUP = 'This backup is from a newer version of Magpie.';
const UNREADABLE_BACKUP = "This backup's data can't be read, so nothing was restored.";

// A restore's check, over a backup's entries ([[name, Buffer]], in zip order): the files that would actually land
// (a later entry of the same name overwrites an earlier one, and "./app.json" is app.json). The environment's data
// (app.json, or the older tavern.json when there is no app.json, the one Store would read) must be readable: valid
// JSON holding an object, the way a start refuses unreadable data (decision 23); a backup with neither starts fresh,
// as a new environment does. Then app.json and tavern.json both are checked for a part from a newer Magpie. Answers
// the refusal sentence, or null.
function backupRefusal(entries, parts = ENVIRONMENT_PARTS) {
  const landing = new Map();
  for (const [name, data] of entries) landing.set(normalRel(String(name).replace(/^\/+/, '')), data);
  const dataName = landing.has(ENVIRONMENT_RECORD) ? ENVIRONMENT_RECORD : landing.has(LEGACY_ENVIRONMENT_RECORD) ? LEGACY_ENVIRONMENT_RECORD : null;
  if (dataName) {
    let value;
    try { value = JSON.parse(Buffer.from(landing.get(dataName)).toString('utf8')); } catch { return UNREADABLE_BACKUP; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return UNREADABLE_BACKUP;
  }
  for (const name of [ENVIRONMENT_RECORD, LEGACY_ENVIRONMENT_RECORD]) {
    if (!landing.has(name)) continue;
    let record = null;
    try { record = JSON.parse(Buffer.from(landing.get(name)).toString('utf8')); } catch { record = null; }
    if (unknownParts(record, parts).length) return NEWER_BACKUP;
  }
  return null;
}

function refuseUnreadable(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw new MigrationError(`Could not read ${file} (${err.message}), so this environment will not be opened: nothing was changed. Fix or restore this file, then start again.`, file, 'unreadable');
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw new MigrationError(`${file} is not valid JSON (${err.message}), so this environment will not be opened: nothing was changed. Fix or restore this file, then start again.`, file, 'unreadable');
  }
  // Valid JSON that is not an object ([], null, a number, a string) is no environment's data either.
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MigrationError(`${file} is not an environment's data (it holds ${describeJson(value)}, not an object), so this environment will not be opened: nothing was changed. Fix or restore this file, then start again.`, file, 'unreadable');
  }
}
const describeJson = (value) => (value === null ? 'null' : Array.isArray(value) ? 'a list' : `a ${typeof value}`);

function refuseNewer(file, record, parts) {
  const unknown = unknownParts(record, parts);
  if (!unknown.length) return;
  throw new MigrationError(`${file} records the migration part "${unknown[0]}", which this version of Magpie does not know: this data is from a newer version of Magpie, so it will not be opened here.`, file, 'newer');
}

// Runs every part `parts` lists that `dir`'s record does not, in order, and records each. Answers the ids it ran.
// `copyDir` is where the originals go (under `dir`), `versioned` whether the record carries app.json's version.
function runParts(dir, { parts, recordName, copyDir, versioned, log }) {
  dir = path.resolve(dir);
  const recordFile = path.join(dir, recordName);
  // Data from a newer Magpie is refused whether or not any part is due here.
  refuseNewer(recordFile, readRecordLeniently(recordFile), parts);
  // No parts due: nothing further is read or written.
  if (!parts.length) return [];
  const record = readJson(recordFile);
  const done = new Set(recordedParts(record));
  const pending = parts.filter((p) => !done.has(p.id));
  if (!pending.length) return [];

  // A directory with no record yet is new: there is no old-format data in it to move, and whatever builds it
  // next (Store, HostRegistry) writes the current shape. The parts are recorded as run, moving nothing, so they
  // never run over data that was never old.
  if (record === undefined) {
    const fresh = { ...(versioned ? { version: NAMES_VERSION } : {}), migrations: pending.map((p) => ({ id: p.id, at: new Date().toISOString(), moved: [] })) };
    commit(dir, new Map([[recordName, fresh]]), []);
    return pending.map((p) => p.id);
  }

  const ran = [];
  for (const part of pending) {
    // What the part will rewrite, plus the record itself (the record entry below rewrites it).
    let files;
    try {
      files = [...new Set([recordName, ...(part.files(dir) || [])].map(normalRel))];
    } catch (err) {
      throw new MigrationError(`The names migration part "${part.id}" could not list its files in ${dir}: ${err.message}`, err.file || dir);
    }
    const listed = new Set(files);

    // The copy, before anything is written. A copy already there is the original from an earlier attempt that
    // stopped part-way, and is kept rather than overwritten with what that attempt left behind. A part that keeps no
    // copy (`copies: false`, the one that deletes them) skips this.
    const keepsCopy = part.copies !== false;
    const copyRoot = path.join(dir, copyDir, part.id);
    for (const rel of keepsCopy ? files : []) {
      const from = inside(dir, rel);
      const to = inside(copyRoot, rel);
      if (!fs.existsSync(from) || fs.existsSync(to)) continue;
      try {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
        fs.chmodSync(to, 0o600); // the copy holds what the original does (password hashes, keys): private to the server's user
      } catch (err) {
        throw new MigrationError(`Could not copy ${from} to ${to} before migrating it: ${err.message}`, from);
      }
    }

    // The part runs against staged writes and moves; nothing on disk changes until it has finished.
    const writes = new Map();
    const moves = [];
    const removes = [];
    let waiting = false;
    const ctx = {
      dir,
      copyRoot,
      ranThisStart: [...ran], // the parts that ran before this one in this same start
      wait: () => { waiting = true; }, // not recorded this start; the part runs again on the next
      remove: (rel) => { inside(dir, rel); removes.push(normalRel(rel)); }, // a folder deleted, after the moves
      read: (rel) => {
        const key = normalRel(rel);
        return writes.has(key) ? structuredClone(writes.get(key)) : readJson(inside(dir, key));
      },
      write: (rel, value) => {
        const key = normalRel(rel);
        const file = inside(dir, key);
        if (!listed.has(key)) throw new MigrationError(`it wrote ${key}, which its files() did not list, so no copy of it was kept first`, file);
        writes.set(key, value);
      },
      move: (fromRel, toRel) => { inside(dir, fromRel); inside(dir, toRel); moves.push([normalRel(fromRel), normalRel(toRel)]); },
    };
    try {
      part.run(ctx);
    } catch (err) {
      const file = err.file || recordFile;
      throw new MigrationError(`The names migration part "${part.id}" stopped at ${file}: ${err.message}`, file);
    }
    if (waiting) continue;

    // The record entry rides with the part's own writes, written last. `moved` is every folder this part has moved:
    // this attempt's, after any an earlier attempt moved before it stopped (its note, below).
    const notePath = path.join(dir, copyDir, `${part.id}.moved.json`);
    const earlier = readMovedNote(dir, notePath);
    const moved = mergeMoved(earlier, moves.filter(([fromRel]) => fs.existsSync(inside(dir, fromRel))).map(([from, to]) => ({ from, to })));
    const current = writes.has(recordName) ? writes.get(recordName) : (readJson(recordFile) || {});
    const next = { ...current };
    if (versioned) next.version = NAMES_VERSION;
    next.migrations = [...(Array.isArray(current.migrations) ? current.migrations : []), { id: part.id, at: new Date().toISOString(), moved }];
    writes.delete(recordName);
    writes.set(recordName, next);
    try {
      commit(dir, writes, moves, { removes, copyRoot: keepsCopy ? copyRoot : null, noteMoves: (pairs) => writeMovedNote(notePath, mergeMoved(earlier, pairs)) });
    } catch (err) {
      if (err instanceof MigrationError) throw new MigrationError(`The names migration part "${part.id}" was not applied: ${err.message}`, err.file);
      throw err;
    }
    try { fs.rmSync(notePath, { force: true }); } catch { /* the record now lists these moves; a note left behind is harmless */ }
    log(`Names migration: ran "${part.id}" in ${dir}${moved.length ? ` (moved ${moved.length})` : ''}${keepsCopy ? `; originals in ${copyRoot}` : ''}${removes.length ? `; removed ${removes.map((rel) => path.join(dir, rel)).join(', ')}` : ''}.`);
    ran.push(part.id);
  }
  return ran;
}

// The note of folders an attempt was about to move ([{ from, to }], relative to the directory), written before each
// move and kept beside the part's copy until the part is recorded. Read back, it answers only the moves that really
// happened: the folder gone from where it was and present where it was going (a move noted but never made, or put
// back, is left out).
function readMovedNote(dir, file) {
  let list;
  try {
    list = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter((m) => m && typeof m.from === 'string' && typeof m.to === 'string')
    .map(({ from, to }) => ({ from, to }))
    .filter(({ from, to }) => { try { return !fs.existsSync(inside(dir, from)) && fs.existsSync(inside(dir, to)); } catch { return false; } });
}
function writeMovedNote(file, list) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.names-tmp`, serialize(list), { mode: 0o600 });
  fs.renameSync(`${file}.names-tmp`, file);
}
function mergeMoved(earlier, later) {
  const seen = new Set();
  return [...earlier, ...later].filter((m) => { const k = `${m.from}\n${m.to}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// Applies one part's staged writes and moves. Everything is checked first (each value serialises, no write lands
// on a folder, each move's target is free and no two moves share one), then every write goes to a temporary file
// beside its target; only when all of that has succeeded does anything live change: the folders move, then the
// writes are renamed into place. A move whose source is already gone is skipped (it ran before). The last write
// in `writes` is renamed last (the record, when a part commits).
// `noteMoves(pairs)`, when given, is told before each folder moves every move made so far and the one about to be
// made ([{ from, to }], relative), so a process that stops between two moves has them on disk.
// `copyRoot` is where the part's originals were copied (pre-names/<part>/, or pre-names-host/<part>/ for the host),
// named when a late write fails.
function commit(dir, writes, moves, { removes = [], noteMoves = null, copyRoot = null } = {}) {
  const texts = [];
  for (const [rel, value] of writes) {
    const file = inside(dir, rel);
    let text;
    try { text = serialize(value); } catch (err) { throw new MigrationError(`Could not write ${file}: ${err.message}`, file); }
    if (typeof value === 'undefined') throw new MigrationError(`Could not write ${file}: there is nothing to write.`, file);
    if (fs.existsSync(file) && !fs.statSync(file).isFile()) throw new MigrationError(`Could not write ${file}: a folder is there.`, file);
    texts.push([file, text]);
  }
  const targets = new Set();
  const due = [];
  for (const [fromRel, toRel] of moves) {
    const from = inside(dir, fromRel);
    const to = inside(dir, toRel);
    if (!fs.existsSync(from)) continue;
    if (fs.existsSync(to) || targets.has(to)) throw new MigrationError(`Could not move ${from} to ${to}: ${to} is already there.`, to);
    targets.add(to);
    due.push([from, to, normalRel(fromRel), normalRel(toRel)]);
  }
  // Staged: every write to a temporary file beside its target. A failure here removes them and changes nothing.
  const temps = [];
  const dropTemps = () => { for (const file of temps) { try { fs.rmSync(`${file}.names-tmp`, { force: true }); } catch { /* best effort */ } } };
  try {
    for (const [file, text] of texts) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      temps.push(file);
      fs.writeFileSync(`${file}.names-tmp`, text, { mode: 0o600 }); // what a part writes is the environment's (or host's) data: private
      fs.chmodSync(`${file}.names-tmp`, 0o600); // also when an old temporary file was left there by a stopped attempt
    }
  } catch (err) {
    const file = temps[temps.length - 1] || dir;
    dropTemps();
    throw new MigrationError(`Could not write ${file}: ${err.message}`, file);
  }
  // The folders move first, so a move that fails (a read-only parent, say) has changed no live JSON: the moves
  // already made are put back, the staged files removed, and the error names the folder. A folder that cannot be
  // put back is named too, since then something was changed after all.
  const done = [];
  const undo = (what, file) => {
    const stuck = [];
    for (const entry of done.reverse()) { try { fs.renameSync(entry[1], entry[0]); } catch { stuck.push(entry); } }
    dropTemps();
    const tail = !stuck.length ? ' Nothing was changed.'
      : ` ${stuck.length === 1 ? 'This folder was moved and could not be put back, so it is' : 'These folders were moved and could not be put back, so they are'} still at the new place: ${stuck.map(([a, b]) => `${b} (was ${a})`).join(', ')}.`;
    return new MigrationError(`${endSentence(what)}${tail}`, file);
  };
  for (const entry of due) {
    const [from, to] = entry;
    if (noteMoves) {
      try {
        noteMoves([...done, entry].map(([, , fromRel, toRel]) => ({ from: fromRel, to: toRel })));
      } catch (err) {
        throw undo(`Could not note the move of ${from} to ${to} before making it (${err.message}), so no folder was left moved`, from);
      }
    }
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from, to);
      done.push(entry);
    } catch (err) {
      throw undo(`Could not move ${from} to ${to}: ${err.message}`, from);
    }
  }
  // Then the folders a part deletes (the copies, in names-copies-removed), before the record says it ran: one that
  // stops part-way is not recorded, and the next start deletes what is left.
  for (const rel of removes) {
    const target = inside(dir, rel);
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch (err) {
      throw undo(`Could not delete ${target}: ${err.message}`, target);
    }
  }
  // Then the writes are renamed into place, the record last. A failure this late leaves the originals in
  // pre-names/ and no record, so the part runs again on the next start.
  const order = temps; // in staging order; runParts stages the record as the last write
  for (let k = 0; k < order.length; k += 1) {
    const file = order[k];
    try {
      fs.renameSync(`${file}.names-tmp`, file);
    } catch (err) {
      for (const rest of order.slice(k)) { try { fs.rmSync(`${rest}.names-tmp`, { force: true }); } catch { /* best effort */ } }
      throw new MigrationError(`Could not write ${file}: ${err.message}.${copyRoot ? ` The originals are in ${copyRoot}.` : ''}`, file);
    }
  }
}

// One environment's directory, before Store reads app.json (buildEnvironment calls this first). Throws a
// MigrationError naming the file when a part cannot finish, or when the data is from a newer Magpie.
function migrateEnvironment(dir, options = {}) {
  try {
    return migrateEnvironmentUnwrapped(dir, options);
  } catch (err) {
    throw asMigrationError(err, dir);
  }
}
function migrateEnvironmentUnwrapped(dir, { parts = ENVIRONMENT_PARTS, log = console.log } = {}) {
  const recordFile = path.join(dir, ENVIRONMENT_RECORD);
  const legacyFile = path.join(dir, LEGACY_ENVIRONMENT_RECORD);
  // An environment's record that is there but cannot be read is refused, whether or not any part is due: Store
  // would otherwise start it as empty and, on its first save, write a new app.json over everything in it. The
  // older tavern.json counts only while app.json is missing (Store reads it only then). A missing file is a new
  // environment, and starts fresh.
  refuseUnreadable(fs.existsSync(recordFile) ? recordFile : legacyFile);
  // An install not started since app.json was called tavern.json keeps its record there until Store renames it.
  if (!fs.existsSync(recordFile)) refuseNewer(legacyFile, readRecordLeniently(legacyFile), parts);
  // Store's own older rename (tavern.json -> app.json) is done here first when a part is about to run, so the
  // part and its record see the file by its current name.
  if (parts.length && !fs.existsSync(recordFile) && fs.existsSync(legacyFile)) {
    try {
      fs.renameSync(legacyFile, recordFile);
    } catch (err) {
      throw new MigrationError(`Could not rename ${legacyFile} to ${recordFile} before migrating it: ${err.message}`, legacyFile);
    }
  }
  return runParts(dir, { parts, recordName: ENVIRONMENT_RECORD, copyDir: ENVIRONMENT_COPY_DIR, versioned: true, log });
}

// The host's own part, once at startup before any environment is built, and only on a hosted server (a
// single-environment install has no host.json and never gets one).
function migrateHost(dataDir, { parts = HOST_PARTS, log = console.log } = {}) {
  try {
    return runParts(dataDir, { parts, recordName: HOST_RECORD, copyDir: HOST_COPY_DIR, versioned: false, log });
  } catch (err) {
    throw asMigrationError(err, dataDir);
  }
}

// What a start does with an environment whose data was refused (a MigrationError from buildEnvironment): a
// single-environment install stops (there is nothing else to run); on a hosted server that one environment is
// skipped, logged with its file, and answers 503 when asked for (it is built again on each request, so a restore
// of a good backup brings it back), while every other environment and the console keep running. Answers true when
// the start goes on.
function refusedAtStartup(err, { hosted, log = console.error, stop = (code) => process.exit(code) } = {}) {
  if (!(err instanceof MigrationError)) throw err;
  if (!hosted) {
    log(err.message);
    stop(1);
    return false;
  }
  log(`${endSentence(err.message)} This environment is skipped and answers 503 until its data is restored or fixed; the others run as usual.`);
  return true;
}

module.exports = {
  NAMES_VERSION, HOST_PARTS, ENVIRONMENT_PARTS, ENVIRONMENT_COPY_DIR, HOST_COPY_DIR, NEWER_BACKUP, UNREADABLE_BACKUP,
  MigrationError, migrateEnvironment, migrateHost, recordedParts, unknownParts, backupRefusal, refusedAtStartup,
  REFUSED_NEWER, REFUSED_FAILED, REFUSED_UNREADABLE, refusalSentence, asMigrationError,
};
