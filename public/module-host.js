// The page side of a module frame. A module runs in a sandboxed iframe and can
// only talk to this page (see public/sdk/tavern.js); this file answers those
// calls by making the real, authenticated requests, and pushes live changes
// back into the frame. Used by the server-page shell (module.js) and by the
// room's floating panels (room.js).

import { api } from '/brand.js';

// The design tokens a module's frame receives (see design-theme.md).
const THEME_TOKENS = [
  '--bg', '--bg-section', '--bg-card', '--bg-input', '--border', '--text', '--text-dim', '--accent', '--on-accent',
  '--accent-hover', '--primary-hover', '--secondary', '--secondary-text', '--secondary-hover', '--header-bg',
  '--header-text', '--icon-hover', '--danger', '--ok', '--surface', '--surface-hover', '--shade',
];

export function readTheme() {
  const styles = getComputedStyle(document.documentElement);
  const theme = {};
  for (const token of THEME_TOKENS) {
    const value = styles.getPropertyValue(token).trim();
    if (value) theme[token] = value;
  }
  return theme;
}

// One live stream per page (and room) is shared by every module frame on it. Browsers allow only a
// few long-lived connections to one site, so a stream per module would starve everything else once
// a handful of modules were open. See GET /api/modules/stream in server/index.js.
const streams = new Map(); // "<room>|<guest>" -> { source, subs }
function joinStream(room, guest, onEvent) {
  const key = `${room || ''}|${guest || ''}`;
  let s = streams.get(key);
  if (!s) {
    const p = new URLSearchParams();
    if (room) p.set('room', room);
    if (guest) p.set('guest', guest);
    const source = new EventSource(`/api/modules/stream?${p}`);
    s = { source, subs: new Set() };
    for (const type of ['change', 'schedule', 'links', 'bus', 'action']) {
      source.addEventListener(type, (ev) => {
        let data;
        try {
          data = JSON.parse(ev.data);
        } catch {
          return; // ignore a malformed event
        }
        for (const fn of s.subs) fn(type, data);
      });
    }
    streams.set(key, s);
  }
  s.subs.add(onEvent);
  return () => {
    s.subs.delete(onEvent);
    if (!s.subs.size) {
      s.source.close();
      streams.delete(key);
    }
  };
}

// --- dragging an item from one module onto another ---------------------------------------------
// A drag that starts in one module frame does not reliably carry its data into another, so the host
// brokers it. The source says a drag of a pointer began (tavern.refs.drag), the host puts an invisible
// layer over every other module frame on the page for the length of the drag, and the layer, being in
// the host's own page, receives the drag. It tells the frame under it where the pointer is and, on a
// drop, which pointer was dropped, in the frame's own coordinates. The frame decides what that means
// (and Tavern still checks the pointer when it is resolved). Nothing else crosses.
const mounted = new Set(); // every module frame the host has on this page: { frame, module, send }
let activeDrag = null; // { source, ref, layers, timer }

const REF_SHAPE = (r) => r && typeof r.module === 'string' && typeof r.kind === 'string' && typeof r.id === 'string'
  && /^[a-z][a-z0-9-]{1,31}$/.test(r.module) && /^[a-z][a-z0-9-]{0,23}$/.test(r.kind) && /^[A-Za-z0-9_-]{1,64}$/.test(r.id)
  && (r.scope === 'server' || (r.scope === 'room' && typeof r.room === 'string' && r.room.length <= 64));

function endDrag() {
  if (!activeDrag) return;
  clearTimeout(activeDrag.timer);
  for (const { el, target } of activeDrag.layers) {
    el.remove();
    target.send('refsdrag', { type: 'leave' });
  }
  activeDrag = null;
}

function beginDrag(source, ref) {
  endDrag();
  const layers = [];
  for (const target of mounted) {
    if (target === source) continue;
    const rect = target.frame.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const doc = target.frame.ownerDocument;
    const el = doc.createElement('div');
    el.style.cssText = `position:fixed;z-index:2147483000;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;background:transparent`;
    const at = (e) => ({ x: Math.round(e.clientX - rect.left), y: Math.round(e.clientY - rect.top) });
    el.addEventListener('dragenter', (e) => e.preventDefault());
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'link';
      target.send('refsdrag', { type: 'over', ...at(e), ref });
    });
    el.addEventListener('dragleave', () => target.send('refsdrag', { type: 'leave' }));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      target.send('refsdrag', { type: 'drop', ...at(e), ref });
      endDrag();
    });
    // A click on the layer means no drag is going on (a module cannot keep the layers up).
    el.addEventListener('pointerdown', endDrag);
    doc.body.appendChild(el);
    layers.push({ el, target });
  }
  activeDrag = { source, ref, layers, timer: setTimeout(endDrag, 20000) };
}

// A trace of a drag on screen, for finding out where one stops: open Tavern once with ?debug=1 (?debug=0
// turns it off). Every step, in the module that starts the drag, in the host and in the module under it,
// adds a line at the bottom left of the page.
try {
  const flag = new URLSearchParams(location.search).get('debug');
  if (flag === '1') localStorage.setItem('tavern.debug', '1');
  else if (flag === '0') localStorage.removeItem('tavern.debug');
} catch {
  // no storage: no trace
}
const debugOn = () => {
  try {
    return localStorage.getItem('tavern.debug') === '1';
  } catch {
    return false;
  }
};
const traceLines = [];
function trace(text) {
  if (!debugOn()) return;
  traceLines.push(`${new Date().toLocaleTimeString([], { hour12: false })} ${text}`);
  if (traceLines.length > 12) traceLines.shift();
  console.log('[tavern]', text);
  let box = document.getElementById('tavern-debug');
  if (!box) {
    box = document.createElement('pre');
    box.id = 'tavern-debug';
    box.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483002;margin:0;padding:8px 10px;max-width:60vw;max-height:40vh;overflow:auto;background:rgba(0,0,0,.85);color:#9f9;font:11px/1.35 monospace;border-radius:6px;pointer-events:none';
    document.body.appendChild(box);
  }
  box.textContent = traceLines.join('\n');
}

// A drag driven by the pointer instead of the browser's drag and drop, which is unreliable between
// sandboxed frames. The source frame (tavern.refs.draggable) tells the host when a drag begins, where
// the pointer is as it moves, and where it lets go, in its own coordinates; the host turns those into
// the page's, finds the module frame under the pointer, and forwards over, leave and drop to it in
// that frame's coordinates, drawing a small label at the pointer meanwhile.
let ptrDrag = null; // { source, ref, label, ghost, over, timer, doc }

function ptrEnd() {
  if (!ptrDrag) return;
  clearTimeout(ptrDrag.timer);
  ptrDrag.ghost.remove();
  if (ptrDrag.over) ptrDrag.over.send('refsdrag', { type: 'leave' });
  ptrDrag = null;
}

// The module frame in the same window as the source that is under a point of the page, and where in it.
function ptrTarget(px, py) {
  for (const target of mounted) {
    if (target === ptrDrag.source || target.frame.ownerDocument !== ptrDrag.doc) continue;
    const r = target.frame.getBoundingClientRect();
    if (px >= r.left && px < r.right && py >= r.top && py < r.bottom) return { target, x: Math.round(px - r.left), y: Math.round(py - r.top) };
  }
  return null;
}

function ptrPoint(x, y) {
  const r = ptrDrag.source.frame.getBoundingClientRect();
  return { px: r.left + x, py: r.top + y };
}

function ptrBegin(source, ref, label, x, y) {
  trace(`host: drag begins from ${source.module.id} (${ref.kind} ${ref.id}) at ${x},${y}; ${[...mounted].filter((t) => t !== source).map((t) => t.module.id).join(', ') || 'no other module frames'} to drop on`);
  ptrEnd();
  endDrag();
  const doc = source.frame.ownerDocument;
  const ghost = doc.createElement('div');
  ghost.textContent = String(label || '').slice(0, 40);
  ghost.style.cssText = 'position:fixed;z-index:2147483001;pointer-events:none;padding:3px 9px;border-radius:6px;background:#c8873a;color:#1a1206;font:600 12px sans-serif;max-width:220px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;box-shadow:0 4px 14px rgba(0,0,0,.4)';
  doc.body.appendChild(ghost);
  ptrDrag = { source, ref, label, ghost, over: null, doc, timer: setTimeout(ptrEnd, 60000) };
  ptrMove(x, y);
}

function ptrMove(x, y) {
  if (!ptrDrag) return;
  const { px, py } = ptrPoint(x, y);
  ptrDrag.ghost.style.left = `${px + 12}px`;
  ptrDrag.ghost.style.top = `${py + 12}px`;
  const hit = ptrTarget(px, py);
  if (ptrDrag.over && (!hit || hit.target !== ptrDrag.over)) {
    ptrDrag.over.send('refsdrag', { type: 'leave' });
    ptrDrag.over = null;
  }
  if (hit && ptrDrag.over !== hit.target) trace(`host: pointer is over ${hit.target.module.id} at ${hit.x},${hit.y}`);
  if (hit) {
    ptrDrag.over = hit.target;
    hit.target.send('refsdrag', { type: 'over', x: hit.x, y: hit.y, ref: ptrDrag.ref });
  }
}

function ptrDrop(x, y) {
  if (!ptrDrag) {
    trace('host: released, but no drag was in progress');
    return;
  }
  const { px, py } = ptrPoint(x, y);
  const hit = ptrTarget(px, py);
  trace(hit ? `host: released over ${hit.target.module.id} at ${hit.x},${hit.y}: dropping` : `host: released at page ${Math.round(px)},${Math.round(py)}, over no module frame`);
  if (hit) hit.target.send('refsdrag', { type: 'drop', x: hit.x, y: hit.y, ref: ptrDrag.ref });
  ptrDrag.over = null; // the drop already ended it for the target
  ptrEnd();
}

// Mounts one module: into an empty <iframe> (`frame`; sandboxed, with only the SDK to reach the page), or,
// for a module that runs in the page, into an empty element (`container`), where it lives in a shadow
// root of its own, beside the page's own elements, with the page's power (see the run modes in
// documentation/architecture/architecture-modules.md).
//
// Mounts one module into an empty <iframe>. `scope` is 'server' (the module's
// own page) or 'room' (a room panel, with `roomId`). Returns { destroy, send }.
export function mountModule({ module, frame = null, container = null, scope, roomId = null, guestToken = null, entry, onTitle, onResize, bar = null, onBar, header = null, onOpenRef = null }) {
  const base = `/api/modules/${encodeURIComponent(module.id)}`;
  let contextInfo = null;

  const q = (sc) => {
    const p = new URLSearchParams();
    if (sc === 'room') { p.set('scope', 'room'); p.set('room', roomId); } else if (sc === 'rooms') p.set('scope', 'rooms'); else { p.set('scope', 'server'); }
    if (guestToken) p.set('guest', guestToken);
    return p;
  };
  // 'context' means wherever this frame is showing; a room panel may also ask for 'server'.
  const scopeOf = (requested) => {
    if (!requested || requested === 'context') return scope;
    if (requested === 'server' || requested === 'room' || requested === 'rooms') {
      if (requested === 'room' && scope !== 'room') throw Object.assign(new Error('this module is not in a room'), { status: 400 });
      // 'rooms' is the server page reading every room the viewer belongs to (read-only)
      if (requested === 'rooms' && (scope !== 'server' || !module.scope?.includes('room'))) throw Object.assign(new Error('only a module\'s server page can read across rooms'), { status: 400 });
      return requested;
    }
    throw Object.assign(new Error('bad scope'), { status: 400 });
  };
  const url = (path, sc, extra = {}) => {
    const p = q(sc);
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
    return `${base}${path}?${p}`;
  };

  // The place this module is in, for the bus routes: a room's pane is in its room, a page in the server.
  const busPlaceBody = () => (scope === 'room' ? { scope: 'room', room: roomId } : { scope: 'server' });
  const busGuest = () => (guestToken ? `?guest=${encodeURIComponent(guestToken)}` : '');
  const busQuery = (extra) => {
    const p = new URLSearchParams({ ...extra, ...busPlaceBody() });
    if (guestToken) p.set('guest', guestToken);
    return p;
  };

  // This module, as the drag brokering sees it (its `send` is defined below).
  const pageMode = Boolean(container);
  // `frame` in the drag brokering below is whichever element holds the module: its frame, or its container.
  const mine = { frame: pageMode ? container : frame, module, send: (event, data) => send(event, data) };

  // Events for the module before its page has said hello wait until it has.
  let ready = false;
  const queued = [];
  const deliver = (event, data) => {
    if (ready) send(event, data);
    else queued.push([event, data]);
  };

  const handlers = {
    async hello() {
      contextInfo = await api('GET', url('/context', scope));
      ready = true;
      setTimeout(() => { for (const [event, data] of queued.splice(0)) send(event, data); }, 50);
      return {
        user: contextInfo.user,
        permissions: contextInfo.permissions,
        module: contextInfo.module,
        context: { scope, roomId },
        theme: readTheme(),
        debug: debugOn(),
      };
    },
    async 'storage.get'({ key, scope: s }) {
      try {
        return (await api('GET', url(`/data/${encodeURIComponent(key)}`, scopeOf(s)))).item;
      } catch (err) {
        if (err.status === 404) return null;
        throw err;
      }
    },
    async 'storage.set'({ key, value, version, scope: s }) {
      return (await api('PUT', url(`/data/${encodeURIComponent(key)}`, scopeOf(s)), { value, version })).item;
    },
    async 'storage.delete'({ key, version, scope: s }) {
      return api('DELETE', url(`/data/${encodeURIComponent(key)}`, scopeOf(s), { version }));
    },
    async 'storage.list'({ prefix, scope: s }) {
      const sc = scopeOf(s);
      if (sc === 'rooms') return (await api('GET', url('/rooms-data', sc, { prefix }))).items;
      return (await api('GET', url('/data', sc, { prefix }))).items;
    },
    // Refs: cards for pointers to other modules' items, and a search for items this module may link to.
    // Always asked on this module's behalf (`from`), so the server can check it was approved for them.
    async 'refs.resolve'({ refs }) {
      const q = guestToken ? `?guest=${encodeURIComponent(guestToken)}` : '';
      return (await api('POST', `/api/refs/resolve${q}`, { from: module.id, refs: Array.isArray(refs) ? refs.slice(0, 50) : [] })).cards;
    },
    // The kinds of other modules' items this module may link to, so it need not know them by name.
    async 'refs.kinds'() {
      const p = new URLSearchParams({ from: module.id });
      if (guestToken) p.set('guest', guestToken);
      return (await api('GET', `/api/refs/kinds?${p}`)).kinds;
    },
    // Show an item in the module that owns it (the page decides how: a pane, a page).
    async 'refs.open'({ ref }) {
      if (!REF_SHAPE(ref)) throw Object.assign(new Error('that is not a valid reference'), { status: 400 });
      if (!onOpenRef) throw Object.assign(new Error('nothing here can open it'), { status: 400 });
      return Boolean(await onOpenRef({ module: ref.module, kind: ref.kind, id: ref.id, scope: ref.scope, ...(ref.scope === 'room' ? { room: ref.room } : {}) }));
    },
    // Tell Tavern what one of this module's items points at (all of it: the list replaces the last).
    async 'refs.setLinks'({ from, to }) {
      if (!REF_SHAPE(from)) throw Object.assign(new Error('that is not a valid reference'), { status: 400 });
      const q = guestToken ? `?guest=${encodeURIComponent(guestToken)}` : '';
      return api('POST', `/api/refs/links${q}`, { module: module.id, from, to: (Array.isArray(to) ? to : []).filter(REF_SHAPE).slice(0, 20) });
    },
    // What points at one of this module's items ('to'), or what it points at ('from'): cards.
    async 'refs.links'({ ref, dir }) {
      if (!REF_SHAPE(ref)) throw Object.assign(new Error('that is not a valid reference'), { status: 400 });
      const p = new URLSearchParams({ from: module.id, ref: JSON.stringify(ref), dir: dir === 'from' ? 'from' : 'to' });
      if (guestToken) p.set('guest', guestToken);
      return (await api('GET', `/api/refs/links?${p}`)).cards;
    },
    // Events and actions between modules (see the SDK's tavern.events and tavern.actions). Always in this
    // module's own place, and always on its behalf: the server checks what it declared and was approved for.
    async 'events.publish'({ name, ref, data }) {
      return api('POST', `/api/bus/publish${busGuest()}`, { module: module.id, name, ref, data, ...busPlaceBody() });
    },
    async 'events.since'({ after }) {
      return api('GET', `/api/bus/events?${busQuery({ module: module.id, after: String(after ?? 0) })}`);
    },
    async 'actions.list'({ accepts, self } = {}) {
      const extra = {};
      if (typeof accepts === 'string' && accepts) extra.accepts = accepts.slice(0, 80);
      if (self) extra.self = '1';
      return (await api('GET', `/api/bus/actions?${busQuery({ from: module.id, ...extra })}`)).actions;
    },
    async 'actions.request'({ action, input }) {
      return api('POST', `/api/bus/actions/request${busGuest()}`, { from: module.id, action, input, ...busPlaceBody() });
    },
    async 'actions.pending'() {
      return (await api('GET', `/api/bus/actions/pending?${busQuery({ module: module.id })}`)).actions;
    },
    async 'actions.claim'({ id }) {
      return api('POST', `/api/bus/actions/claim${busGuest()}`, { module: module.id, id, ...busPlaceBody() });
    },
    async 'actions.complete'({ id, result }) {
      return api('POST', `/api/bus/actions/complete${busGuest()}`, { module: module.id, id, result, ...busPlaceBody() });
    },
    async 'actions.status'({ id }) {
      return api('GET', `/api/bus/actions/status?${busQuery({ from: module.id, id: String(id) })}`);
    },
    async 'refs.search'({ q, scope: s }) {
      const sc = scopeOf(s);
      if (sc === 'rooms') throw Object.assign(new Error('search one place at a time'), { status: 400 });
      const p = new URLSearchParams({ from: module.id, q: String(q || '').slice(0, 100), scope: sc });
      if (sc === 'room') p.set('room', roomId);
      if (guestToken) p.set('guest', guestToken);
      return (await api('GET', `/api/refs/search?${p}`)).cards;
    },
    async rooms() {
      return (await api('GET', url('/rooms-data', 'rooms', { info: 1 }))).rooms;
    },
    async schedule(spec) {
      return api('POST', url('/schedule', scopeOf(spec?.scope)), { ...spec, scope: undefined });
    },
    async cancelSchedule({ key, scope: s }) {
      return api('DELETE', url(`/schedule/${encodeURIComponent(key)}`, scopeOf(s)));
    },
    async notify(spec) {
      return api('POST', url('/notify', scopeOf(spec?.scope)), { ...spec, scope: undefined });
    },
    // The module's action bar: the host draws the buttons into `bar` and sends
    // clicks back as a 'bar' event.
    async 'bar.set'({ items }) {
      const clean = (Array.isArray(items) ? items : []).slice(0, 6).map((i) => ({
        id: String(i?.id ?? '').slice(0, 40),
        label: String(i?.label ?? '').slice(0, 30),
        icon: /^[a-z0-9-]{1,40}$/.test(i?.icon || '') ? i.icon : '',
        primary: Boolean(i?.primary),
        disabled: Boolean(i?.disabled),
        // An item can be a quick-add: a text field with a small + button. What is typed comes back with the click.
        input: i?.type === 'quickadd',
        placeholder: String(i?.placeholder ?? '').slice(0, 60),
      })).filter((i) => i.id && (i.label || i.input));
      if (bar) {
        bar.textContent = '';
        for (const item of clean) {
          if (item.input) {
            const form = document.createElement('form');
            form.className = 'quick-add';
            const field = document.createElement('input');
            field.type = 'text';
            field.maxLength = 200;
            field.placeholder = item.placeholder;
            field.setAttribute('aria-label', item.placeholder || 'Quick add');
            const go = document.createElement('button');
            go.type = 'submit';
            go.className = 'btn btn-primary quick-add-go';
            go.setAttribute('aria-label', item.label || 'Add');
            go.title = item.label || 'Add';
            go.disabled = item.disabled;
            const plus = document.createElement('i');
            plus.className = 'fa-solid fa-plus fa-fw';
            plus.setAttribute('aria-hidden', 'true');
            go.appendChild(plus);
            form.append(field, go);
            form.addEventListener('submit', (e) => {
              e.preventDefault();
              send('bar', { id: item.id, value: field.value.trim() });
              field.value = '';
            });
            bar.appendChild(form);
            continue;
          }
          const b = document.createElement('button');
          b.type = 'button';
          b.className = `btn${item.primary ? ' btn-primary' : ''}`;
          b.disabled = item.disabled;
          if (item.icon) {
            const i = document.createElement('i');
            i.className = `fa-solid fa-${item.icon} fa-fw`;
            i.setAttribute('aria-hidden', 'true');
            b.append(i, ' ');
          }
          b.append(item.label);
          b.addEventListener('click', () => send('bar', { id: item.id }));
          bar.appendChild(b);
        }
        bar.hidden = clean.length === 0;
      }
      if (onBar) onBar(clean.length > 0);
      return true;
    },
    // Icon buttons in the module's titlebar, before the pane's own buttons and set off by a pipe. Only a
    // host with a titlebar (a pane, or a module's own window) has room for them: the answer says which,
    // so a module can keep its own controls in the page when it is not.
    async 'header.set'({ items }) {
      if (!header) return false;
      const clean = (Array.isArray(items) ? items : []).slice(0, 6).map((i) => ({
        id: String(i?.id ?? '').slice(0, 40),
        title: String(i?.title ?? '').slice(0, 40),
        icon: /^[a-z0-9-]{1,40}$/.test(i?.icon || '') ? i.icon : '',
        regular: Boolean(i?.regular),
        on: Boolean(i?.on),
        disabled: Boolean(i?.disabled),
      })).filter((i) => i.id && i.icon);
      header.textContent = '';
      for (const item of clean) {
        const b = header.ownerDocument.createElement('button');
        b.type = 'button';
        b.className = `msg-btn${item.on ? ' on' : ''}`;
        b.title = item.title;
        b.setAttribute('aria-label', item.title || item.id);
        b.setAttribute('aria-pressed', String(item.on));
        b.disabled = item.disabled;
        const i = header.ownerDocument.createElement('i');
        i.className = `fa-${item.regular ? 'regular' : 'solid'} fa-${item.icon} fa-fw`;
        i.setAttribute('aria-hidden', 'true');
        b.appendChild(i);
        b.addEventListener('click', () => send('header', { id: item.id }));
        header.appendChild(b);
      }
      if (clean.length) {
        const pipe = header.ownerDocument.createElement('span');
        pipe.className = 'header-pipe';
        header.appendChild(pipe);
      }
      return true;
    },
    // A drag of a pointer to one of this module's items began or ended (see tavern.refs.drag).
    async 'refs.dragStart'({ ref }) {
      if (!REF_SHAPE(ref)) throw Object.assign(new Error('that is not a valid reference'), { status: 400 });
      beginDrag(mine, { module: ref.module, kind: ref.kind, id: ref.id, scope: ref.scope, ...(ref.scope === 'room' ? { room: ref.room } : {}) });
      return true;
    },
    async 'refs.dragEnd'() {
      if (activeDrag && activeDrag.source === mine) endDrag();
      if (ptrDrag && ptrDrag.source === mine) ptrEnd();
      return true;
    },
    // A line for the on-screen trace (see the top of this file), from a module that was told tracing is on.
    async 'refs.trace'({ msg }) {
      trace(`${module.id}: ${String(msg).slice(0, 160)}`);
      return true;
    },
    // The pointer-driven drag (see tavern.refs.draggable): begin, move, and let go.
    async 'refs.ptrStart'({ ref, label, x, y }) {
      if (!REF_SHAPE(ref)) throw Object.assign(new Error('that is not a valid reference'), { status: 400 });
      ptrBegin(mine, { module: ref.module, kind: ref.kind, id: ref.id, scope: ref.scope, ...(ref.scope === 'room' ? { room: ref.room } : {}) }, label, Number(x) || 0, Number(y) || 0);
      return true;
    },
    async 'refs.ptrMove'({ x, y }) {
      if (ptrDrag && ptrDrag.source === mine) ptrMove(Number(x) || 0, Number(y) || 0);
      return true;
    },
    async 'refs.ptrDrop'({ x, y }) {
      if (ptrDrag && ptrDrag.source === mine) ptrDrop(Number(x) || 0, Number(y) || 0);
      return true;
    },
    async resize(size) {
      if (onResize) onResize(size || {});
      return true;
    },
    async setTitle({ title }) {
      if (onTitle) onTitle(String(title || '').slice(0, 80));
      return true;
    },
  };

  // Each frame has its own secret, handed to it in its address. Messages to the frame carry it, and
  // the SDK ignores any that do not, so another frame that can reach this one cannot pose as the host.
  // (Checking who sent a message is not enough: when the call has been popped out, this code runs in
  // a different window from the frame's parent.)
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');

  function reply(id, message) {
    frame.contentWindow?.postMessage({ tavern: 1, tk: secret, id, ...message }, '*');
  }

  async function onMessage(e) {
    if (pageMode || e.source !== frame.contentWindow) return; // only our own frame
    const m = e.data;
    if (!m || m.tavern !== 1 || typeof m.id !== 'number' || typeof m.method !== 'string') return;
    const handler = handlers[m.method];
    if (!handler) return reply(m.id, { error: { message: `unknown call ${m.method}`, status: 400 } });
    try {
      reply(m.id, { result: await handler(m.params || {}) });
    } catch (err) {
      reply(m.id, { error: { message: err.message, status: err.status, current: err.current } });
    }
  }
  // A frame's messages arrive in the window it lives in, which is not this one
  // when the call has been popped out.
  const hostWin = (pageMode ? container : frame).ownerDocument.defaultView || window;
  if (!pageMode) hostWin.addEventListener('message', onMessage);
  mounted.add(mine);

  // Live changes: one stream per scope the frame can see. For a module in the page, an event goes
  // straight to its SDK.
  let sdkEmit = null;
  function send(event, data) {
    if (pageMode) {
      if (sdkEmit) sdkEmit(event, data);
      return;
    }
    frame.contentWindow?.postMessage({ tavern: 1, tk: secret, event, data }, '*');
  }
  // A room's pane hears that room and the server; a module's server page hears the server and
  // the viewer's rooms (see the stream's scopes on the server).
  const leaveStream = joinStream(scope === 'room' ? roomId : null, guestToken, (type, d) => {
    if (type !== 'bus' && type !== 'action' && d.module !== module.id) return;
    if (type === 'change') send('change', { key: d.key, value: d.value, version: d.version, deleted: d.deleted, by: d.by, scope: d.scope, roomId: d.roomId });
    else if (type === 'links') send('links', { ref: d.ref });
    else if (type === 'bus') {
      // An event some module published: only the modules the server named may hear it, in their own place.
      if (Array.isArray(d.subscribers) && d.subscribers.includes(module.id) && d.scope === (scope === 'room' ? 'room' : 'server')) send('bus', { id: d.id, at: d.at, module: d.module, name: d.name, ref: d.ref, data: d.data });
    } else if (type === 'action') {
      // A request for this module to do something.
      if (d.provider === module.id && d.scope === (scope === 'room' ? 'room' : 'server')) send('action', { id: d.id, name: d.name, from: d.from, by: d.by });
    }
    else send('schedule', { key: d.key, payload: d.payload, scope: d.scope });
  });

  // No same-origin: an opaque origin, no cookies, no Tavern DOM. allow-forms lets a
  // module's own <form> fire its submit event (a sandboxed frame without it
  // swallows the submit, so a Save button appears to do nothing); the frame's
  // policy sets form-action 'none', so nothing can actually be submitted anywhere.
  if (!pageMode) {
    frame.setAttribute('sandbox', 'allow-scripts allow-forms');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.src = `/m/${encodeURIComponent(module.id)}/${encodeURIComponent(module.version)}/${entry}?tk=${secret}`;
  } else {
    startInPage().catch((err) => {
      container.textContent = `This module could not start: ${err.message}`;
    });
  }

  // A module running in the page: its styles, markup and script come from the server in parts, into a
  // shadow root on the container. Its page-wide selectors (html, body) mean the container, the theme
  // reaches it because CSS variables inherit into a shadow root, and it gets its own SDK, whose calls
  // go straight to the handlers above instead of through a frame. Nothing stops the module reaching
  // beyond that: it runs with the page's power.
  async function startInPage() {
    const scopeCss = (text) => text.replace(/:root\s*\{[^}]*\}/g, '').replace(/(^|[\s,}])(html|body)(?=[\s,{.:[])/g, '$1:host');
    const base = `/m/${encodeURIComponent(module.id)}/${encodeURIComponent(module.version)}/${entry}`;
    const text = async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url} ${res.status}`);
      return res.text();
    };
    const [sdkCss, css, body] = await Promise.all([text('/sdk/tavern.css'), text(`${base}?part=css`), text(`${base}?part=body`)]);
    const root = container.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = scopeCss(sdkCss) + '\n' + scopeCss(css);
    root.appendChild(style);
    const tpl = document.createElement('template');
    tpl.innerHTML = body;
    root.appendChild(tpl.content);
    const call = (method, params) => {
      const handler = handlers[method];
      if (!handler) return Promise.reject(Object.assign(new Error(`unknown call ${method}`), { status: 400 }));
      return Promise.resolve().then(() => handler(params || {}));
    };
    const built = window.createTavern({
      call,
      root,
      rootElement: container,
      // The pointer in the page's coordinates, in the module's own.
      localPoint: (x, y) => {
        const r = container.getBoundingClientRect();
        return { x: x - r.left, y: y - r.top };
      },
      // Points from the SDK are in the module's own coordinates; a shadow root wants the page's.
      elementAt: (pt) => {
        const r = container.getBoundingClientRect();
        return root.elementFromPoint(pt.x + r.left, pt.y + r.top);
      },
    });
    sdkEmit = built.emit;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${base}?part=js&v=${encodeURIComponent(module.version)}`;
      script.tavern = built.tavern; // the module reads it from document.currentScript when it starts
      script.onload = () => { script.remove(); resolve(); };
      script.onerror = () => { script.remove(); reject(new Error('its script did not load')); };
      document.head.appendChild(script);
    });
  }

  return {
    send,
    // For tests: start a brokered drag of `ref` from this module, as its SDK would.
    beginDragForTest: (ref) => beginDrag(mine, ref),
    // For tests: run the pointer-driven drag from this module as its SDK would (steps: start, move, drop).
    ptrForTest: (step, ref, label, x, y) => (step === 'start' ? ptrBegin(mine, ref, label, x, y) : step === 'move' ? ptrMove(x, y) : ptrDrop(x, y)),
    deliver,
    destroy() {
      if (!pageMode) hostWin.removeEventListener('message', onMessage);
      sdkEmit = null;
      mounted.delete(mine);
      if (activeDrag && (activeDrag.source === mine || activeDrag.layers.some((l) => l.target === mine))) endDrag();
      if (ptrDrag && ptrDrag.source === mine) ptrEnd();
      leaveStream();
      if (pageMode) container.shadowRoot?.replaceChildren();
      else frame.removeAttribute('src');
    },
  };
}
