// How often a module may do things through Tavern for one person: saved data, published events, asked actions,
// notifications and schedules, each a count per minute per module and person. A module that is busy for a good
// reason (moving twenty items) stays well under these; one that loops or floods is told to slow down (429). In memory,
// so a restart clears it. It limits what goes through Tavern's API; a module running in the page can also do things
// Tavern never hears of, which is why running one there is the admin's warned choice.

'use strict';

const WINDOW_MS = 60 * 1000;
const LIMITS = { write: 240, event: 60, action: 60, notify: 20, schedule: 60 };

class ModuleLimits {
  constructor() {
    this.hits = new Map(); // "module|who|kind" -> recent times
    this.told = new Map(); // "module|who|kind" -> when the admin's log was last told
  }

  // Count one; { ok: true }, or { ok: false, retrySeconds, first } when over the limit (`first`: the first refusal in a while,
  // so the log is not filled with one line per refusal).
  take(module, who, kind) {
    const max = LIMITS[kind];
    if (!max) return { ok: true };
    const key = `${module}|${who}|${kind}`;
    const now = Date.now();
    const recent = (this.hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= max) {
      this.hits.set(key, recent);
      const first = now - (this.told.get(key) || 0) > WINDOW_MS;
      if (first) this.told.set(key, now);
      return { ok: false, retrySeconds: Math.max(1, Math.ceil((WINDOW_MS - (now - recent[0])) / 1000)), first };
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.length || now - v[v.length - 1] > WINDOW_MS) this.hits.delete(k);
    return { ok: true };
  }
}

module.exports = { ModuleLimits, MODULE_LIMITS: LIMITS };
