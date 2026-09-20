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

  // A pointer checked for shape, or null. Says nothing about whether the viewer may see the item.
  function cleanRef(ref) {
    const ok = ref && typeof ref.module === 'string' && typeof ref.kind === 'string' && typeof ref.id === 'string'
      && /^[a-z][a-z0-9-]{1,31}$/.test(ref.module) && /^[a-z][a-z0-9-]{0,23}$/.test(ref.kind) && /^[A-Za-z0-9_-]{1,64}$/.test(ref.id)
      && (ref.scope === 'server' || (ref.scope === 'room' && typeof ref.room === 'string' && ref.room.length <= 64));
    return ok ? { module: ref.module, kind: ref.kind, id: ref.id, scope: ref.scope, ...(ref.scope === 'room' ? { room: ref.room } : {}) } : null;
  }

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

  // An "open this item" from the host can arrive before the module has said what to do with one.
  let pendingOpen = null;

  function emit(event, data) {
    if (event === 'refopen' && !(listeners.get(event) && listeners.get(event).size)) pendingOpen = data;
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
      // The kinds of other modules' items this module may link to: [{ module, moduleName, icon, kind, name, open }].
      // A module written after this one appears here with no change to this one, so use it (and the
      // cards' own module and kind) rather than naming other modules in your code.
      kinds: () => call('refs.kinds', {}),
      // Show an item in the module that owns it (its pane opens, and it is asked to show the item). The
      // card says whether it can: card.open.
      open: (ref) => call('refs.open', { ref }),
      // For a module that owns items: called when someone asks to see one of them (tavern.refs.open from
      // another module): open it. The pointer is checked for shape and points at one of your own items.
      onOpen: (fn) => {
        const off = tavern.on('refopen', (e) => {
          const ref = e && e.ref && cleanRef(e.ref);
          if (ref) fn(ref);
        });
        if (pendingOpen) {
          const p = pendingOpen;
          pendingOpen = null;
          setTimeout(() => { const ref = p.ref && cleanRef(p.ref); if (ref) fn(ref); }, 0);
        }
        return off;
      },
      // Tell Tavern what one of your items points at (`from` is a pointer to it, from make(); `to` is the
      // list of pointers it now points at, replacing the last), so the items pointed at can ask what points
      // at them. Only pointers are kept, and only what the viewer may see is ever shown.
      setLinks: (from, to) => call('refs.setLinks', { from, to }),
      // What points at one of your items (its kind must have "backlinks": true in module.json), and what
      // one points at: cards. The 'links' event says when to ask again.
      linksTo: (ref) => call('refs.links', { ref, dir: 'to' }),
      linksFrom: (ref) => call('refs.links', { ref, dir: 'from' }),
      // Items this module may link to (kinds it consumes), matching the text, in this place
      // or (from a room) { scope: 'server' }. Each is a card with its pointer in card.ref.
      search: (text, o) => call('refs.search', { q: text || '', ...opts(o) }),
      // Start a drag carrying a pointer to one of this module's items: call it from a dragstart handler.
      drag: (event, kind, id, o) => {
        const ref = tavern.refs.make(kind, id, o);
        event.dataTransfer.setData(REF_MIME, JSON.stringify(ref));
        if (o && o.label) event.dataTransfer.setData('text/plain', String(o.label));
        event.dataTransfer.effectAllowed = 'copyLink';
        // Tell the host, which brokers the drop onto the other modules on the page (see dropTarget).
        call('refs.dragStart', { ref }).catch(() => {});
        event.target.addEventListener('dragend', () => call('refs.dragEnd', {}).catch(() => {}), { once: true });
        return ref;
      },
      // Receive a pointer dragged from another module on the same page. over(point, ref) as it moves across
      // this module, leave() when it goes, drop(ref, point) when it is let go; the point is { x, y } in
      // this module's own page, for document.elementFromPoint. Call this rather than (or as well as)
      // listening for dragover and drop yourself: a drag between two module frames reaches only this.
      dropTarget: (handlers) => tavern.on('refsdrag', (e) => {
        const ref = e.ref && cleanRef(e.ref);
        const point = { x: e.x, y: e.y };
        if (e.type === 'over') handlers.over && handlers.over(point, ref);
        else if (e.type === 'leave') handlers.leave && handlers.leave();
        else if (e.type === 'drop') {
          handlers.leave && handlers.leave();
          handlers.drop && handlers.drop(ref, point);
        }
      }),
      // Whether a drag over this module carries a pointer (call preventDefault on dragover to accept it).
      accepts: (event) => Array.from((event.dataTransfer && event.dataTransfer.types) || []).includes(REF_MIME),
      // The pointer dropped, checked for shape, or null. It says nothing about whether the viewer may
      // see the item: resolve() does that.
      parse: (event) => {
        try {
          return cleanRef(JSON.parse(event.dataTransfer.getData(REF_MIME)));
        } catch (err) {
          return null;
        }
      },
    },

    // Events: a module says something happened, and other modules that were approved to hear it can react.
    // Neither side names the other. Declare what you publish in module.json (events.publishes: [{ name,
    // kind, label }]) and what you want to hear (events.subscribes: ["*"] or ["module:name"], approved by
    // the admin). By convention an event named `closed`, `done`, `completed` or `finished` means the item it
    // points at is finished.
    events: {
      // publish('closed', { ref, data }): `ref` (optional) is a pointer to one of your own items, `data` a small
      // plain object (under 2 KB) that means something to whoever listens.
      publish: (name, o) => call('events.publish', { name, ref: o && o.ref, data: o && o.data }),
      // Hear events: handler({ id, at, module, name, ref, data }) for each, in order, including those that
      // happened while this module was not open (from where it last got to; a module hears nothing from
      // before its first subscribe). More than one person may have the module open, so handle an event so
      // that doing it twice is harmless.
      subscribe: (handler) => {
        const CURSOR = '_cursor:events';
        let cursor = null;
        let chain = Promise.resolve();
        const deliver = (e) => {
          chain = chain.then(async () => {
            if (cursor !== null && e.id <= cursor) return;
            try {
              await handler(e);
            } catch (err) {
              console.error(err);
            }
            cursor = e.id;
            try {
              await tavern.storage.set(CURSOR, { id: cursor });
            } catch (err) {
              // read-only here: the cursor is kept for this visit only
            }
          });
        };
        const off = tavern.on('bus', deliver);
        (async () => {
          let saved = null;
          try {
            const item = await tavern.storage.get(CURSOR);
            saved = item && item.value && item.value.id;
          } catch (err) {
            saved = null;
          }
          const r = await call('events.since', { after: saved == null ? 'now' : saved });
          if (saved == null) {
            if (cursor === null || cursor < r.latest) cursor = r.latest;
            try {
              await tavern.storage.set(CURSOR, { id: cursor });
            } catch (err) {
              // read-only here
            }
          } else if (cursor === null || cursor < saved) {
            cursor = saved;
          }
          for (const e of r.events) deliver(e);
        })().catch((err) => console.error(err));
        return off;
      },
    },

    // Actions: one module asks another to do something, without either naming the other in Tavern. A module
    // lists what it can do in module.json (actions.provides: [{ name, label, input: { title: 'string',
    // due: 'date?' } }]; field types are string, text, date, datetime, boolean, number and ref, and a
    // trailing ? means optional) and what it wants to ask for (actions.uses: ["*"] or ["module:name"],
    // approved by the admin).
    actions: {
      // What this module may ask for here: [{ action, module, moduleName, icon, name, label, input }]. Offer
      // whichever you can fill in from what you have (an action that takes a `title`, say), and do not name modules.
      list: () => call('actions.list', {}),
      // Ask for one. Tavern checks the input against what the action takes and queues it for the module
      // that owns it, which carries it out the next time a person has it open (or at once if one does).
      // With { wait: true } this waits a few seconds for the answer: { status, result: { ok, ref?, error? } }.
      request: async (action, input, o) => {
        const queued = await call('actions.request', { action, input });
        if (!(o && o.wait)) return queued;
        for (let i = 0; i < 10; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          const s = await call('actions.status', { id: queued.id });
          if (s.status === 'done') return s;
        }
        return { status: 'queued', id: queued.id };
      },
      // Carry out the actions this module provides: provide({ createTask: async (input, { from, by }) => ({ ref }) }).
      // Called for each request, once (only one page takes it), under the rules of whoever has the module open.
      provide: (handlers) => {
        let chain = Promise.resolve();
        const run = async (a) => {
          const fn = handlers[a.name];
          if (!fn) return;
          let claim;
          try {
            claim = await call('actions.claim', { id: a.id });
          } catch (err) {
            return;
          }
          if (!claim || !claim.ok) return;
          let result;
          try {
            const out = await fn(claim.action.input, { from: claim.action.from, by: claim.action.by });
            result = { ok: true, ref: out && out.ref };
          } catch (err) {
            result = { ok: false, error: String((err && err.message) || err) };
          }
          try {
            await call('actions.complete', { id: a.id, result });
          } catch (err) {
            // the requester can still see it was claimed
          }
        };
        const queue = (a) => { chain = chain.then(() => run(a)); };
        tavern.on('action', queue);
        call('actions.pending', {}).then((list) => list.forEach(queue)).catch(() => {});
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
