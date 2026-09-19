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

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    const m = e.data;
    if (!m || m.tavern !== 1) return;
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
