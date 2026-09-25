// The hooks a module may ask the host to run for it: schedules (do something
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

// --- repeating schedules ----------------------------------------------------
// A schedule may repeat: { every: 'day' | 'week' | '2weeks' | 'month' | 'year', until, tz }.
// The next time keeps the same wall-clock time in the given time zone (so an
// evening event stays in the evening across a daylight saving change); a
// monthly or yearly repeat keeps the day of the month, or the last day of a
// shorter month. Without a valid zone it steps in UTC.
const EVERY = ['day', 'week', '2weeks', 'month', 'year'];

function zoneOk(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function zonedParts(ms, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(new Date(ms)).map((p) => [p.type, Number(p.value)]),
  );
  return { y: parts.year, mo: parts.month - 1, d: parts.day, h: parts.hour, mi: parts.minute, s: parts.second };
}

// The UTC time at which the wall clock in `tz` reads y-mo-d h:mi:s.
function fromZoned({ y, mo, d, h, mi, s }, tz) {
  const guess = Date.UTC(y, mo, d, h, mi, s);
  const offsetAt = (t) => {
    const p = zonedParts(t, tz);
    return Date.UTC(p.y, p.mo, p.d, p.h, p.mi, p.s) - t;
  };
  let utc = guess - offsetAt(guess);
  utc = guess - offsetAt(utc); // settle across a daylight saving edge
  return utc;
}

function nextOccurrence(at, repeat) {
  const tz = repeat.tz && zoneOk(repeat.tz) ? repeat.tz : 'UTC';
  const p = zonedParts(at, tz);
  if (repeat.every === 'day' || repeat.every === 'week' || repeat.every === '2weeks') {
    const days = repeat.every === 'day' ? 1 : repeat.every === 'week' ? 7 : 14;
    const d = new Date(Date.UTC(p.y, p.mo, p.d + days));
    return fromZoned({ y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: p.h, mi: p.mi, s: p.s }, tz);
  }
  const months = repeat.every === 'year' ? 12 : 1;
  const first = new Date(Date.UTC(p.y, p.mo + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return fromZoned({ y: first.getUTCFullYear(), mo: first.getUTCMonth(), d: Math.min(repeat.day || p.d, lastDay), h: p.h, mi: p.mi, s: p.s }, tz);
}

function cleanRepeat(spec, at) {
  if (!spec) return null;
  if (!EVERY.includes(spec.every)) throw new StoreError(`repeat.every must be one of ${EVERY.join(', ')}`);
  const until = spec.until === undefined || spec.until === null ? null : toMillis(spec.until);
  if (spec.until !== undefined && spec.until !== null && until === null) throw new StoreError('repeat.until must be a time');
  if (until !== null && until < at) throw new StoreError('repeat.until is before the first time');
  const tz = typeof spec.tz === 'string' && zoneOk(spec.tz) ? spec.tz : null;
  // Remember the day of the month it started on, so a repeat on the 31st goes
  // back to the 31st after a short month instead of staying on the 28th.
  const day = zonedParts(at, tz || 'UTC').d;
  return { every: spec.every, until, tz, day };
}

function toMillis(at) {
  const ms = typeof at === 'number' ? at : Date.parse(String(at));
  return Number.isFinite(ms) ? Math.round(ms) : null;
}

class ModuleHooks extends EventEmitter {
  constructor(modulesDir, { resolveRecipients }) {
    super();
    this.setMaxListeners(0);
    this.dir = modulesDir;
    this.resolveRecipients = resolveRecipients; // ({ module, scopeKey, spaceId }, to) -> [user keys]
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

  // ctx: { manifest, scope, scopeKey, spaceId, by }
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
        to: clean(spec.notify.to, 40) || (ctx.scope === 'space' ? 'space' : 'environment'),
        title: clean(spec.notify.title, LIMITS.title),
        body: clean(spec.notify.body, LIMITS.body),
      };
      if (!notify.title) throw new StoreError('a notification needs a title');
    }
    const repeat = cleanRepeat(spec.repeat, at);
    const id = this.id(ctx.manifest.id, ctx.scopeKey, key);
    const mine = this.schedules.filter((s) => s.module === ctx.manifest.id);
    if (!mine.some((s) => s.id === id) && mine.length >= LIMITS.schedulesPerModule) throw new StoreError('this module has too many schedules', 413);
    this.schedules = this.schedules.filter((s) => s.id !== id);
    this.schedules.push({ id, module: ctx.manifest.id, scopeKey: ctx.scopeKey, spaceId: ctx.spaceId, key, at, payload, notify, repeat, by: ctx.by });
    this.write(this.schedulesFile, this.schedules);
    return { key, at, repeat: Boolean(repeat) };
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
      if (s.repeat) this.requeue(s, now);
      if (now - s.at > LIMITS.lateFireMs) continue; // missed while the server was off, and too late to matter
      if (s.notify) this.deliver({ module: s.module, scopeKey: s.scopeKey, spaceId: s.spaceId }, s.notify, { by: 'schedule' });
      this.emit('fire', { module: s.module, scopeKey: s.scopeKey, key: s.key, payload: s.payload, at: s.at });
    }
    if (due.some((s) => s.repeat)) this.write(this.schedulesFile, this.schedules);
  }

  // A repeating schedule that just fired is scheduled again, at its next time
  // after now (skipping ones the server slept through), unless it has ended.
  requeue(s, now) {
    let at = s.at;
    for (let i = 0; i < 1000 && at <= now; i += 1) at = nextOccurrence(at, s.repeat);
    if (at <= now || (s.repeat.until !== null && at > s.repeat.until)) return;
    this.schedules.push({ ...s, at });
  }

  // --- notifications ------------------------------------------------------

  // ctx: { module, scopeKey, spaceId }; note: { to, title, body }
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
        scope: ctx.scopeKey === 'environment' ? 'environment' : 'space',
        spaceId: ctx.spaceId || null,
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

module.exports = { ModuleHooks, LIMITS, nextOccurrence };
