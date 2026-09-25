// The links between modules' objects: "this task points at that event". A module stores its own
// pointers; this registry is where the host learns of them, so that the item pointed at can ask what
// points at it (backlinks) without the host knowing anything about tasks, events or polls. It holds
// only pointers ({ module, kind, id, scope, space? }), never an item's content, and every answer is
// filtered to what the asking person may see. Persists to DATA_DIR/modules/links.json.

'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const LIMITS = { perItem: 20, total: 20000 };

const key = (r) => [r.module, r.kind, r.id, r.scope, r.space || ''].join('|');
const plain = (r) => ({ module: r.module, kind: r.kind, id: r.id, scope: r.scope, ...(r.scope === 'space' ? { space: r.space } : {}) });

class ModuleLinks extends EventEmitter {
  constructor(modulesDir) {
    super();
    this.setMaxListeners(0);
    this.file = path.join(modulesDir, 'links.json');
    this.items = [];
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(raw)) this.items = raw.filter((l) => l && l.from && l.to);
    } catch {
      // none yet
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.items));
    fs.renameSync(tmp, this.file);
  }

  // Replace everything `from` points at with `tos`. Returns every pointer whose links changed.
  set(from, tos, by) {
    const fk = key(from);
    const before = this.items.filter((l) => key(l.from) === fk);
    const kept = this.items.filter((l) => key(l.from) !== fk);
    const seen = new Set();
    const added = [];
    for (const to of tos.slice(0, LIMITS.perItem)) {
      const tk = key(to);
      if (seen.has(tk) || tk === fk) continue;
      seen.add(tk);
      added.push({ from: plain(from), to: plain(to), by, at: Date.now() });
    }
    if (kept.length + added.length > LIMITS.total) return [];
    const same = before.length === added.length && before.every((l) => seen.has(key(l.to)));
    if (same) return [];
    this.items = [...kept, ...added];
    this.save();
    const changed = [plain(from), ...before.map((l) => l.to), ...added.map((l) => l.to)];
    this.emit('change', { refs: changed });
    return changed;
  }

  // What points at `ref`, and what `ref` points at.
  to(ref) {
    const k = key(ref);
    return this.items.filter((l) => key(l.to) === k).map((l) => l.from);
  }

  from(ref) {
    const k = key(ref);
    return this.items.filter((l) => key(l.from) === k).map((l) => l.to);
  }

  // A module was uninstalled with its data: its links, both ways, go too.
  dropModule(id) {
    const left = this.items.filter((l) => l.from.module !== id && l.to.module !== id);
    if (left.length === this.items.length) return;
    this.items = left;
    this.save();
  }
}

module.exports = { ModuleLinks, objectKey: key };
