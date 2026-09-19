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

// Mounts one module into an empty <iframe>. `scope` is 'server' (the module's
// own page) or 'room' (a room panel, with `roomId`). Returns { destroy, send }.
export function mountModule({ module, frame, scope, roomId = null, guestToken = null, entry, onTitle, onResize }) {
  const base = `/api/modules/${encodeURIComponent(module.id)}`;
  const sources = [];
  let contextInfo = null;

  const q = (sc) => {
    const p = new URLSearchParams();
    if (sc === 'room') { p.set('scope', 'room'); p.set('room', roomId); } else { p.set('scope', 'server'); }
    if (guestToken) p.set('guest', guestToken);
    return p;
  };
  // 'context' means wherever this frame is showing; a room panel may also ask for 'server'.
  const scopeOf = (requested) => {
    if (!requested || requested === 'context') return scope;
    if (requested === 'server' || requested === 'room') {
      if (requested === 'room' && scope !== 'room') throw Object.assign(new Error('this module is not in a room'), { status: 400 });
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
      return (await api('GET', url('/data', scopeOf(s), { prefix }))).items;
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
    async resize(size) {
      if (onResize) onResize(size || {});
      return true;
    },
    async setTitle({ title }) {
      if (onTitle) onTitle(String(title || '').slice(0, 80));
      return true;
    },
  };

  function reply(id, message) {
    frame.contentWindow?.postMessage({ tavern: 1, id, ...message }, '*');
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
  window.addEventListener('message', onMessage);

  // Live changes: one stream per scope the frame can see.
  function send(event, data) {
    frame.contentWindow?.postMessage({ tavern: 1, event, data }, '*');
  }
  function listen(sc) {
    const source = new EventSource(url('/events', sc));
    source.addEventListener('change', (ev) => {
      try {
        const change = JSON.parse(ev.data);
        send('change', { key: change.key, value: change.value, version: change.version, deleted: change.deleted, by: change.by, scope: sc });
      } catch {
        // ignore a malformed event
      }
    });
    source.addEventListener('schedule', (ev) => {
      try {
        send('schedule', { ...JSON.parse(ev.data), scope: sc });
      } catch {
        // ignore a malformed event
      }
    });
    sources.push(source);
  }
  listen(scope);
  if (scope === 'room' && module.scope?.includes('server') && !guestToken) listen('server');

  frame.setAttribute('sandbox', 'allow-scripts'); // no same-origin: an opaque origin, no cookies, no Tavern DOM
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.src = `/m/${encodeURIComponent(module.id)}/${encodeURIComponent(module.version)}/${entry}`;

  return {
    send,
    destroy() {
      window.removeEventListener('message', onMessage);
      for (const s of sources) s.close();
      frame.removeAttribute('src');
    },
  };
}
