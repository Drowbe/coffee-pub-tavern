/*
 * Tavern module SDK. A module includes this from its own pages:
 *
 *   <script src="/sdk/tavern.js"></script>
 *
 * A module runs in a sandboxed frame with no access to Tavern's pages,
 * cookies or network. Everything it can do goes through the calls here; the
 * page hosting the frame (public/module-host.js) makes the real requests on
 * its behalf and the server checks every one. See
 * documentation/api/api-module-sdk.md.
 *
 * Every call returns a promise. tavern.ready() resolves once the host has
 * answered, with who is looking, where the module is showing, and the theme.
 */
(function () {
  'use strict';

  // The drag data type a pointer to a module's item travels under (see tavern.refs).
  const REF_MIME = 'application/x-tavern-ref';

  const pending = new Map();
  const listeners = new Map();
  let seq = 0;
  let info = null;

  function call(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      window.parent.postMessage({ tavern: 1, id, method, params }, '*');
      setTimeout(() => {
        if (!pending.delete(id)) return;
        reject(new Error('Tavern did not answer'));
      }, 30000);
    });
  }

  function emit(event, data) {
    for (const fn of listeners.get(event) || []) {
      try {
        fn(data);
      } catch (err) {
        console.error(err);
      }
    }
  }

  // The host puts a secret in this frame's address and in every message it sends.
  const secret = new URLSearchParams(window.location.search).get('tk');

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.tavern !== 1 || m.tk !== secret) return;
    if (m.id !== undefined) {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.error) {
        const err = new Error(m.error.message || 'failed');
        err.status = m.error.status;
        err.current = m.error.current;
        p.reject(err);
      } else {
        p.resolve(m.result);
      }
    } else if (m.event) {
      if (m.event === 'theme') applyTheme(m.data);
      emit(m.event, m.data);
    }
  });

  // The theme arrives as CSS custom properties; setting them on :root lets a
  // module's plain CSS follow the theme (var(--bg), var(--text) ...).
  function applyTheme(theme) {
    if (!theme) return;
    for (const [name, value] of Object.entries(theme)) document.documentElement.style.setProperty(name, value);
  }

  const readyPromise = call('hello').then((result) => {
    info = result;
    applyTheme(result.theme);
    return result;
  });

  // Scope: 'context' (the default) is wherever the module is showing, the whole
  // server on its page and one room in a room panel. A room panel may also ask
  // for 'server'.
  const opts = (o) => ({ scope: (o && o.scope) || 'context' });

  const tavern = {
    // Resolves with { user, context, permissions, theme, module }.
    ready: () => readyPromise,

    // Whether the viewer has one of this module's own permissions (by its
    // short key in module.json, such as "edit").
    can: (permission) => Boolean(info && info.permissions && info.permissions[permission]),

    get user() {
      return info && info.user;
    },
    get context() {
      return info && info.context;
    },

    storage: {
      get: (key, o) => call('storage.get', { key, ...opts(o) }),
      // set(key, value, { version }) -- pass the version you read to detect a
      // change made since; a conflict rejects with error.status 409 and
      // error.current holding what is stored now.
      set: (key, value, o) => call('storage.set', { key, value, version: o && o.version, ...opts(o) }),
      delete: (key, o) => call('storage.delete', { key, version: o && o.version, ...opts(o) }),
      list: (prefix, o) => call('storage.list', { prefix: prefix || '', ...opts(o) }),
    },

    // The rooms the viewer belongs to that have this module on, on a module's server page:
    // [{ id, name, icon, svg }] (`svg` is the room's icon as inline SVG, since a module cannot
    // load the icon font). Read stored data across them with storage.list(prefix, { scope: 'rooms' }),
    // which returns each item with its `roomId`; 'change' events for those rooms carry `roomId` too.
    rooms: () => call('rooms'),

    // Refs: pointing at another module's items without reaching into its data. A module lists what
    // it shares (produces) and what it wants to link to (consumes) in module.json; an admin approves
    // the latter. A pointer is { module, kind, id, scope: 'room' | 'server', room? }: store it, never
    // a copy of the item. resolve() asks Tavern for the item's card (title, subtitle, when, end,
    // allDay, done, module) or an { error, status } when it is gone or the viewer may not see it, so
    // a pointer is only ever as revealing as the viewer's own access.
    refs: {
      // A pointer to one of this module's own items, for a drag or to store.
      make: (kind, id, o) => {
        const ctx = (info && info.context) || {};
        // { room } names another room's item (a module's server page showing the rooms it belongs to).
        const otherRoom = o && o.room;
        const server = !otherRoom && ((o && o.scope === 'server') || ctx.scope !== 'room');
        const ref = { module: info && info.module && info.module.id, kind, id: String(id), scope: server ? 'server' : 'room' };
        if (!server) ref.room = otherRoom || ctx.roomId;
        return ref;
      },
      // One pointer, or a list, to cards. A list keeps its order.
      resolve: async (refs) => {
        const list = Array.isArray(refs) ? refs : [refs];
        // Tavern answers up to 50 at a time.
        const cards = [];
        for (let i = 0; i < list.length; i += 50) cards.push(...await call('refs.resolve', { refs: list.slice(i, i + 50) }));
        return Array.isArray(refs) ? cards : cards[0];
      },
      // Items this module may link to (kinds it consumes), matching the text, in this place
      // or (from a room) { scope: 'server' }. Each is a card with its pointer in card.ref.
      search: (text, o) => call('refs.search', { q: text || '', ...opts(o) }),
      // Start a drag carrying a pointer to one of this module's items: call it from a dragstart handler.
      drag: (event, kind, id, o) => {
        const ref = tavern.refs.make(kind, id, o);
        event.dataTransfer.setData(REF_MIME, JSON.stringify(ref));
        if (o && o.label) event.dataTransfer.setData('text/plain', String(o.label));
        event.dataTransfer.effectAllowed = 'copyLink';
        return ref;
      },
      // Whether a drag over this module carries a pointer (call preventDefault on dragover to accept it).
      accepts: (event) => Array.from((event.dataTransfer && event.dataTransfer.types) || []).includes(REF_MIME),
      // The pointer dropped, checked for shape, or null. It says nothing about whether the viewer may
      // see the item: resolve() does that.
      parse: (event) => {
        try {
          const ref = JSON.parse(event.dataTransfer.getData(REF_MIME));
          const ok = ref && typeof ref.module === 'string' && typeof ref.kind === 'string' && typeof ref.id === 'string' && /^[a-z][a-z0-9-]{1,31}$/.test(ref.module) && /^[a-z][a-z0-9-]{0,23}$/.test(ref.kind)
            && /^[A-Za-z0-9_-]{1,64}$/.test(ref.id) && (ref.scope === 'server' || (ref.scope === 'room' && typeof ref.room === 'string' && ref.room.length <= 64));
          return ok ? { module: ref.module, kind: ref.kind, id: ref.id, scope: ref.scope, ...(ref.scope === 'room' ? { room: ref.room } : {}) } : null;
        } catch (err) {
          return null;
        }
      },
    },

    // Ask Tavern to run something later, on your behalf. Needs "schedule" (and
    // "notify" for a notification) in the manifest's hooks. `at` is a time
    // (ms since 1970 or an ISO string); `key` names the schedule so setting it
    // again replaces it. When it fires the module is told (event "schedule")
    // if open, and `notify`, if given, is delivered.
    schedule: (spec) => call('schedule', spec),
    cancelSchedule: (key, o) => call('cancelSchedule', { key, ...opts(o) }),

    // { to: 'room' | 'server' | a user key, title, body }. Needs the "notify" hook.
    notify: (spec) => call('notify', spec),

    // The module's action bar: buttons the host draws along the bottom of the
    // module (in the room's bottom row when docked, lined up with the video
    // toolbar and the chat box). set([{ id, label, icon, primary, disabled }]);
    // a click arrives as the 'bar' event with the button's id.
    bar: {
      set: (items) => call('bar.set', { items }),
    },

    // Icon buttons in the module's titlebar, ahead of the pane's own buttons and set off by a pipe:
    // set([{ id, icon, title, on, regular, disabled }]), where `icon` is a Font Awesome name (solid, or
    // regular with `regular: true`) and `on` marks the current choice. A click arrives as the 'header'
    // event with the button's id. Resolves true when the host drew them, false when it has no titlebar
    // to draw in (a module's server page), in which case keep the controls in the page.
    header: {
      set: (items) => call('header.set', { items }),
    },

    // Layout: ask the host for a size, and set the title shown above the module.
    resize: (size) => call('resize', size),
    setTitle: (title) => call('setTitle', { title }),

    // Events: 'bar' ({ id }) when an action bar button is clicked, 'change' ({ key, value, version, deleted, scope, by }) whenever
    // stored data changes, 'schedule' ({ key, payload }) when a schedule fires,
    // 'theme' (the new theme).
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event).delete(fn);
    },
  };

  window.tavern = tavern;
})();
