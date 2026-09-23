// What passes between modules besides pointers: events (a module says something happened) and
// actions (a module asks another to do something). The host is only the transport. It does not know
// what any event or action means: modules declare them in module.json, an admin approves who may
// hear and who may ask, and this file keeps them until someone can act on them.
//
// Modules are front-end only, so nothing here runs a module. An event is kept (a short while) for
// modules that were not open when it happened to catch up on; an action request waits in the
// providing module's queue until a person has that module open, whose page claims it, does it under
// its own rules, and reports back. Persists to DATA_DIR/modules/bus.json.

'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const LIMITS = {
  events: 500, // kept in all
  eventAgeMs: 14 * 24 * 60 * 60 * 1000,
  actions: 500,
  actionAgeMs: 7 * 24 * 60 * 60 * 1000,
  claimMs: 60 * 1000, // a claimed request nobody completed can be claimed again after this
  dataBytes: 2000,
};

class ModuleBus extends EventEmitter {
  constructor(modulesDir) {
    super();
    this.setMaxListeners(0);
    this.file = path.join(modulesDir, 'bus.json');
    this.state = { seq: 0, events: [], actions: [] };
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && Array.isArray(raw.events) && Array.isArray(raw.actions)) this.state = { seq: Number(raw.seq) || 0, events: raw.events, actions: raw.actions };
    } catch {
      // nothing yet
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state));
    fs.renameSync(tmp, this.file);
  }

  prune() {
    const now = Date.now();
    this.state.events = this.state.events.filter((e) => now - e.at < LIMITS.eventAgeMs).slice(-LIMITS.events);
    this.state.actions = this.state.actions.filter((a) => now - a.at < LIMITS.actionAgeMs).slice(-LIMITS.actions);
  }

  // --- events ---------------------------------------------------------------

  publish({ module, name, ref, data, scopeKey, by }) {
    const text = data === undefined ? '' : JSON.stringify(data);
    if (text.length > LIMITS.dataBytes) return null;
    const event = { id: ++this.state.seq, at: Date.now(), module, name, ref: ref || null, data: text ? JSON.parse(text) : null, scopeKey, by };
    this.state.events.push(event);
    this.prune();
    this.save();
    this.emit('event', event);
    return event;
  }

  // What happened in a scope after event `after`, oldest first.
  eventsAfter(scopeKey, after) {
    return this.state.events.filter((e) => e.scopeKey === scopeKey && e.id > after);
  }

  latestEvent(scopeKey) {
    const list = this.state.events.filter((e) => e.scopeKey === scopeKey);
    return list.length ? list[list.length - 1].id : this.state.seq;
  }

  // --- actions --------------------------------------------------------------

  request({ from, provider, action, input, scopeKey, by, local }) {
    const request = { id: ++this.state.seq, at: Date.now(), from, provider, action, input, scopeKey, by, ...(local ? { local: true } : {}), status: 'pending', claimedAt: 0, result: null };
    this.state.actions.push(request);
    this.prune();
    this.save();
    this.emit('action', request);
    return request;
  }

  actionById(id) {
    return this.state.actions.find((a) => a.id === id) || null;
  }

  // Requests waiting for the provider in a scope (or claimed too long ago to be still going).
  pending(provider, scopeKey) {
    const now = Date.now();
    return this.state.actions.filter((a) => a.provider === provider && a.scopeKey === scopeKey
      && (a.status === 'pending' || (a.status === 'claimed' && now - a.claimedAt > LIMITS.claimMs)));
  }

  // One page takes a request; the others that saw it too are told no. Returns the request or null.
  claim(id, provider, scopeKey) {
    const a = this.actionById(id);
    const now = Date.now();
    if (!a || a.provider !== provider || a.scopeKey !== scopeKey) return null;
    if (!(a.status === 'pending' || (a.status === 'claimed' && now - a.claimedAt > LIMITS.claimMs))) return null;
    a.status = 'claimed';
    a.claimedAt = now;
    this.save();
    return a;
  }

  complete(id, provider, scopeKey, result) {
    const a = this.actionById(id);
    if (!a || a.provider !== provider || a.scopeKey !== scopeKey || a.status === 'done') return null;
    a.status = 'done';
    a.result = result;
    this.save();
    this.emit('actionDone', a);
    return a;
  }

  dropModule(id) {
    this.state.events = this.state.events.filter((e) => e.module !== id);
    this.state.actions = this.state.actions.filter((a) => a.provider !== id && a.from !== id);
    this.save();
  }
}

module.exports = { ModuleBus, BUS_LIMITS: LIMITS };
