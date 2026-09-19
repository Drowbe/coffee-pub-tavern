// The hooks a module may ask Tavern to run for it: schedules (do something
// later) and notifications (tell people). A module never runs code on the
// server; it declares the hooks in its manifest, the admin approves them, and
// this file does the work. See documentation/architecture/architecture-modules.md.
//
// Schedules and each person's notifications persist under DATA_DIR/modules/
// (schedules.json, notifications.json), so a restart loses nothing.

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { StoreError } = require('./store');

const LIMITS = {
  schedulesPerModule: 500,
  notificationsPerUser: 50,
  lateFireMs: 6 * 60 * 60 * 1000, // a schedule missed by more than this while the server was off is dropped
  pastGraceMs: 5 * 60 * 1000, // scheduling for a moment ago is fine; longer ago is a mistake
  horizonMs: 366 * 24 * 60 * 60 * 1000,
  title: 100,
  body: 400,
};

const clean = (value, max) => String(value ?? '').replace(/\p{Cc}/gu, ' ').trim().slice(0, max);

function toMillis(at) {
  const ms = typeof at === 'number' ? at : Date.parse(String(at));
  return Number.isFinite(ms) ? Math.round(ms) : null;
}

class ModuleHooks extends EventEmitter {
  constructor(modulesDir, { resolveRecipients }) {
    super();
    this.setMaxListeners(0);
    this.dir = modulesDir;
    this.resolveRecipients = resolveRecipients; // ({ module, scopeKey, roomId }, to) -> [user keys]
    this.schedulesFile = path.join(modulesDir, 'schedules.json');
    this.notificationsFile = path.join(modulesDir, 'notifications.json');
    this.schedules = this.read(this.schedulesFile, []);
    if (!Array.isArray(this.schedules)) this.schedules = [];
    this.notifications = this.read(this.notificationsFile, {});
    this.timer = null;
  }

  read(file, fallback) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      return raw && typeof raw === 'object' ? raw : fallback;
    } catch {
      return fallback;
    }
  }

  write(file, value) {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value));
    fs.renameSync(tmp, file);
  }

  start(intervalMs = 10000) {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.timer.unref?.();
    this.tick();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  // --- schedules ----------------------------------------------------------

  id(module, scopeKey, key) {
    return `${module}|${scopeKey}|${key}`;
  }

  // ctx: { manifest, scope, scopeKey, roomId, by }
  schedule(ctx, spec) {
    const key = clean(spec?.key, 128);
    if (!/^[A-Za-z0-9_.:/-]{1,128}$/.test(key)) throw new StoreError('a schedule key is 1 to 128 letters, digits and . _ : / -');
    const at = toMillis(spec?.at);
    const now = Date.now();
    if (at === null) throw new StoreError('"at" must be a time (milliseconds or an ISO date)');
    if (at < now - LIMITS.pastGraceMs) throw new StoreError('that time has already passed');
    if (at > now + LIMITS.horizonMs) throw new StoreError('that is more than a year away');
    const payload = spec.payload;
    if (payload !== undefined && JSON.stringify(payload).length > 4000) throw new StoreError('a schedule payload is at most 4 KB');
    let notify = null;
    if (spec.notify) {
      if (!ctx.manifest.hooks.notify) throw new StoreError('this module did not ask for the notify hook', 403);
      notify = {
        to: clean(spec.notify.to, 40) || (ctx.scope === 'room' ? 'room' : 'server'),
        title: clean(spec.notify.title, LIMITS.title),
        body: clean(spec.notify.body, LIMITS.body),
      };
      if (!notify.title) throw new StoreError('a notification needs a title');
    }
    const id = this.id(ctx.manifest.id, ctx.scopeKey, key);
    const mine = this.schedules.filter((s) => s.module === ctx.manifest.id);
    if (!mine.some((s) => s.id === id) && mine.length >= LIMITS.schedulesPerModule) throw new StoreError('this module has too many schedules', 413);
    this.schedules = this.schedules.filter((s) => s.id !== id);
    this.schedules.push({ id, module: ctx.manifest.id, scopeKey: ctx.scopeKey, roomId: ctx.roomId, key, at, payload, notify, by: ctx.by });
    this.write(this.schedulesFile, this.schedules);
    return { key, at };
  }

  cancel(ctx, key) {
    const id = this.id(ctx.manifest.id, ctx.scopeKey, key);
    const before = this.schedules.length;
    this.schedules = this.schedules.filter((s) => s.id !== id);
    if (this.schedules.length !== before) this.write(this.schedulesFile, this.schedules);
    return { key, cancelled: before !== this.schedules.length };
  }

  // Forget everything a module scheduled (on uninstall without keeping data).
  forget(module) {
    this.schedules = this.schedules.filter((s) => s.module !== module);
    this.write(this.schedulesFile, this.schedules);
  }

  tick(now = Date.now()) {
    const due = this.schedules.filter((s) => s.at <= now);
    if (!due.length) return;
    this.schedules = this.schedules.filter((s) => s.at > now);
    this.write(this.schedulesFile, this.schedules);
    for (const s of due) {
      if (now - s.at > LIMITS.lateFireMs) continue; // missed while the server was off, and too late to matter
      if (s.notify) this.deliver({ module: s.module, scopeKey: s.scopeKey, roomId: s.roomId }, s.notify, { by: 'schedule' });
      this.emit('fire', { module: s.module, scopeKey: s.scopeKey, key: s.key, payload: s.payload, at: s.at });
    }
  }

  // --- notifications ------------------------------------------------------

  // ctx: { module, scopeKey, roomId }; note: { to, title, body }
  deliver(ctx, note, { by = '' } = {}) {
    const title = clean(note.title, LIMITS.title);
    if (!title) throw new StoreError('a notification needs a title');
    const recipients = this.resolveRecipients(ctx, note.to);
    const at = Date.now();
    let count = 0;
    for (const userKey of recipients) {
      const list = (this.notifications[userKey] ||= []);
      const n = {
        id: `${at.toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        module: ctx.module,
        scope: ctx.scopeKey === 'server' ? 'server' : 'room',
        roomId: ctx.roomId || null,
        title,
        body: clean(note.body, LIMITS.body),
        at,
        read: false,
        by,
      };
      list.unshift(n);
      if (list.length > LIMITS.notificationsPerUser) list.length = LIMITS.notificationsPerUser;
      this.emit('notification', { userKey, notification: n });
      count += 1;
    }
    if (count) this.write(this.notificationsFile, this.notifications);
    return count;
  }

  list(userKey) {
    return (this.notifications[userKey] || []).slice();
  }

  markRead(userKey, { module = null, id = null } = {}) {
    let changed = false;
    for (const n of this.notifications[userKey] || []) {
      if (n.read) continue;
      if ((module && n.module === module) || (id && n.id === id) || (!module && !id)) {
        n.read = true;
        changed = true;
      }
    }
    if (changed) this.write(this.notificationsFile, this.notifications);
  }

  // Drop a module's notifications (on uninstall).
  dropModule(module) {
    for (const list of Object.values(this.notifications)) {
      for (let i = list.length - 1; i >= 0; i -= 1) if (list[i].module === module) list.splice(i, 1);
    }
    this.write(this.notificationsFile, this.notifications);
  }
}

module.exports = { ModuleHooks, LIMITS };
