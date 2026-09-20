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
    for (const type of ['change', 'schedule']) {
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

// Mounts one module into an empty <iframe>. `scope` is 'server' (the module's
// own page) or 'room' (a room panel, with `roomId`). Returns { destroy, send }.
export function mountModule({ module, frame, scope, roomId = null, guestToken = null, entry, onTitle, onResize, bar = null, onBar }) {
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

  const handlers = {
    async hello() {
      contextInfo = await api('GET', url('/context', scope));
      return {
        user: contextInfo.user,
        permissions: contextInfo.permissions,
        module: contextInfo.module,
        context: { scope, roomId },
        theme: readTheme(),
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
      })).filter((i) => i.id && i.label);
      if (bar) {
        bar.textContent = '';
        for (const item of clean) {
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
    if (e.source !== frame.contentWindow) return; // only our own frame
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
  const hostWin = frame.ownerDocument.defaultView || window;
  hostWin.addEventListener('message', onMessage);

  // Live changes: one stream per scope the frame can see.
  function send(event, data) {
    frame.contentWindow?.postMessage({ tavern: 1, tk: secret, event, data }, '*');
  }
  // A room's pane hears that room and the server; a module's server page hears the server and
  // the viewer's rooms (see the stream's scopes on the server).
  const leaveStream = joinStream(scope === 'room' ? roomId : null, guestToken, (type, d) => {
    if (d.module !== module.id) return;
    if (type === 'change') send('change', { key: d.key, value: d.value, version: d.version, deleted: d.deleted, by: d.by, scope: d.scope, roomId: d.roomId });
    else send('schedule', { key: d.key, payload: d.payload, scope: d.scope });
  });

  // No same-origin: an opaque origin, no cookies, no Tavern DOM. allow-forms lets a
  // module's own <form> fire its submit event (a sandboxed frame without it
  // swallows the submit, so a Save button appears to do nothing); the frame's
  // policy sets form-action 'none', so nothing can actually be submitted anywhere.
  frame.setAttribute('sandbox', 'allow-scripts allow-forms');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.src = `/m/${encodeURIComponent(module.id)}/${encodeURIComponent(module.version)}/${entry}?tk=${secret}`;

  return {
    send,
    destroy() {
      hostWin.removeEventListener('message', onMessage);
      leaveStream();
      frame.removeAttribute('src');
    },
  };
}
