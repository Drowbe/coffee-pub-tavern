/*
 * Tavern module SDK. A module includes this from its own pages:
 *
 *   <script src="/sdk/tavern.js"></script>
 *
 * A module runs either in a sandboxed frame, with no access to Tavern's pages, cookies or network, or
 * (when the admin has chosen that for it, and for the modules that ship with Tavern) in the page itself,
 * in a container of its own. Either way everything it can do goes through the calls here; the page
 * hosting it (public/module-host.js) makes the real requests on its behalf and the server checks every
 * one. A module in the page is not confined: it could bypass this. See documentation/api/api-module-sdk.md.
 *
 * The API is built by createTavern(env): in a frame this file boots it over postMessage; the page host
 * calls it directly for a module running in the page.
 *
 * Every call returns a promise. tavern.ready() resolves once the host has
 * answered, with who is looking, where the module is showing, and the theme.
 */
(function (global) {
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

  const UI_CSS = `
.tv-datefield { display: flex; gap: 4px; align-items: center; }
.tv-datefield input { flex: 1; min-width: 0; }
.tv-datefield input::-webkit-calendar-picker-indicator { display: none; }
.tv-dp-btn { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: 1px solid var(--border); border-radius: 6px; background: var(--secondary); color: var(--secondary-text); cursor: pointer; }
.tv-dp-btn:hover { background: var(--secondary-hover); }
.tv-dow-hint { display: block; min-height: 14px; color: var(--accent); font-size: 11px; font-weight: 600; }
.tv-dp { position: fixed; z-index: 9999; width: 252px; padding: 8px; background: var(--bg-section); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.45); font: 13px system-ui, sans-serif; color: var(--text); }
.tv-dp-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 6px; }
.tv-dp-head button, .tv-dp-foot button { border: 0; border-radius: 6px; padding: 3px 9px; background: var(--secondary); color: var(--secondary-text); font: inherit; cursor: pointer; }
.tv-dp-head button:hover, .tv-dp-foot button:hover { background: var(--secondary-hover); }
.tv-dp-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.tv-dp-dow { padding: 2px 0; text-align: center; color: var(--text-dim); font-size: 10px; text-transform: uppercase; }
.tv-dp-day { height: 30px; border: 1px solid transparent; border-radius: 6px; background: none; color: var(--text); font: inherit; cursor: pointer; }
.tv-dp-day:hover { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); }
.tv-dp-day.other { color: var(--text-dim); opacity: .55; }
.tv-dp-day.inrange { background: color-mix(in srgb, var(--accent) 18%, transparent); }
.tv-dp-day.today { border-color: var(--accent); }
.tv-dp-day.sel { background: var(--accent); color: var(--on-accent); font-weight: 700; }
.tv-dp-foot { display: flex; justify-content: space-between; margin-top: 6px; }
`;

  // env: { call(method, params) -> Promise, root, rootElement, elementAt({x, y}), localPoint(clientX, clientY),
  // applyTheme(theme) }.
  // Returns { tavern, emit }: `emit` is how the host pushes an event to the module.
  function createTavern(env) {
  const listeners = new Map();
  let info = null;
  const call = env.call;

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

  const readyPromise = call('hello').then((result) => {
    info = result;
    if (env.applyTheme) env.applyTheme(result.theme);
    return result;
  });

  // Scope: 'context' (the default) is wherever the module is showing, the whole
  // server on its page and one room in a room panel. A room panel may also ask
  // for 'server'.
  const opts = (o) => ({ scope: (o && o.scope) || 'context' });

  // The shared interface's styles, added once to wherever the module's elements live, in the theme's colours.
  let uiStyles = false;
  function ensureUiStyles() {
    if (uiStyles) return;
    uiStyles = true;
    const s = document.createElement('style');
    s.textContent = UI_CSS;
    (env.root === document ? document.head : env.root).appendChild(s);
  }

  const tavern = {
    // Resolves with { user, context, permissions, theme, module }.
    ready: () => readyPromise,

    // Where the module's page is: `root` is what to look elements up in (document.getElementById becomes
    // tavern.root.getElementById: in a frame it is the document, in the page it is the module's own
    // shadow root) and `rootElement` the element whose size is the module's (the frame's document element, or
    // its container). Use these rather than document, so the module runs in either place.
    root: env.root,
    rootElement: env.rootElement,

    // Small helpers more than one module needs, so each does not carry its own copy.
    util: {
      // Text made safe to put in HTML.
      esc: (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
      // A new id for something a module stores: short, and unlikely to repeat.
      id: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      // A pointer's identity as one string, for keeping and comparing them.
      refKey: (r) => [r.module, r.kind, r.id, r.scope, r.room || ''].join('|'),
      // Dates as "2026-09-24" (a local day): text from a Date, and back.
      ymd: (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      // Pull a date and a time out of what someone typed, and leave the rest as the title:
      // "meet with bob sep 29 at 7pm" gives { title: "meet with bob", date: "2026-09-29", time: "19:00" }. Understands
      // today, tomorrow, weekdays ("fri", "next fri"), "sep 29" and "29 sep", "9/29" and "2026-09-29"; times as
      // "7pm", "7:30 pm", "19:00", "at 7". A date already passed this year means next year. Anything it does
      // not recognise stays in the title; date and time are only there when found.
      parseWhen: (text, now) => {
        const base = now || new Date();
        let t = ' ' + String(text || '').trim() + ' ';
        const out = {};
        const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        const ymd = tavern.util.ymd;
        const fix = (m, d, y) => {
          let year = y || base.getFullYear();
          let date = new Date(year, m, d);
          if (date.getMonth() !== m) return null;
          const today = new Date(base.getFullYear(), base.getMonth(), base.getDate());
          if (!y && date < today) date = new Date(year + 1, m, d);
          return ymd(date);
        };
        const take = (re, fn) => { const m = re.exec(t); if (!m) return false; const v = fn(m); if (v === null || v === undefined) return false; t = t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length); return v; };
        // time first, so "7" in "at 7" is not read as a day
        let time = null;
        take(/\s(?:at\s+)?(noon|midday|midnight)\b/i, (m) => { time = /midnight/i.test(m[1]) ? '00:00' : '12:00'; return true; })
          || take(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i, (m) => { let h = Number(m[1]); const mi = Number(m[2] || 0); if (h < 1 || h > 12 || mi > 59) return null; const pm = m[3].toLowerCase() === 'pm'; h = (h % 12) + (pm ? 12 : 0); time = String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0'); return true; })
          || take(/\s(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/, (m) => { time = m[1].padStart(2, '0') + ':' + m[2]; return true; })
          || take(/\sat\s+(\d{1,2})\b(?!\s*[/-])/i, (m) => { const h = Number(m[1]); if (h < 1 || h > 23) return null; time = String((h < 7 ? h + 12 : h)).padStart(2, '0') + ':00'; return true; });
        let date = null;
        const set = (v) => { date = v; return Boolean(v); };
        take(/\s(\d{4})-(\d{2})-(\d{2})\b/, (m) => set(fix(Number(m[2]) - 1, Number(m[3]), Number(m[1]))))
          || take(/\s(?:on\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?/i, (m) => set(fix(months.indexOf(m[1].toLowerCase().slice(0, 3)), Number(m[2]), m[3] ? Number(m[3]) : 0)))
          || take(/\s(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i, (m) => set(fix(months.indexOf(m[2].toLowerCase().slice(0, 3)), Number(m[1]), 0)))
          || take(/\s(?:on\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (m) => set(fix(Number(m[1]) - 1, Number(m[2]), m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : 0)))
          || take(/\s(today|tonight)\b/i, () => set(ymd(base)))
          || take(/\stomorrow\b/i, () => set(ymd(new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1))))
          || take(/\s(?:on\s+|next\s+|this\s+)?(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b/i, (m) => { const want = days.indexOf(m[1].toLowerCase().slice(0, 3)); let ahead = (want - base.getDay() + 7) % 7; if (ahead === 0 || /next\s/i.test(m[0])) ahead = ahead === 0 ? 7 : ahead + (want > base.getDay() ? 7 : 0); return set(ymd(new Date(base.getFullYear(), base.getMonth(), base.getDate() + ahead))); });
        if (date) out.date = date;
        if (time) out.time = time;
        out.title = t.replace(/\s+/g, ' ').trim().replace(/\s+(on|at|by|for|from)$/i, '').replace(/^(on|at|by)\s+/i, '').trim();
        if (!out.title) out.title = String(text || '').trim();
        return out;
      },
      parseYmd: (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); },
    },

    // Interface the modules share, drawn the same everywhere and following the theme.
    ui: {
      // A Font Awesome icon ("circle-right", style "solid", "regular" or "brands") as inline SVG text, coloured by
      // the text colour, for a module that cannot load the icon font. Resolves to the SVG, or rejects if there is no such icon.
      icon: (name, style) => call('icons.svg', { name, style: style || 'solid' }),
      // A date picker for a date field: a small month grid under it, weekdays across the top, so the day a date
      // falls on is visible while choosing. The typed field keeps working; a button opens the grid and the
      // weekday of what is in the field shows under it. Works on <input type="date"> and
      // <input type="datetime-local"> (which keeps its time, or takes 12:00 when it has none).
      // datePicker(input, { range: () => [from, to], clearable }): highlight a span of days, and offer Clear.
      // Returns { close, destroy }.
      datePicker: (input, o) => {
        const options = o || {};
        const u = tavern.util;
        ensureUiStyles();
        const wrap = document.createElement('span');
        wrap.className = 'tv-datefield';
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tv-dp-btn';
        btn.title = 'Pick a date';
        btn.setAttribute('aria-label', 'Pick a date');
        btn.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M4 0v2H2.5A1.5 1.5 0 0 0 1 3.5v10A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-10A1.5 1.5 0 0 0 13.5 2H12V0h-1.5v2h-5V0zM2.5 5h11v8.5h-11z"/></svg>';
        wrap.appendChild(btn);
        const hint = document.createElement('span');
        hint.className = 'tv-dow-hint';
        wrap.parentNode.insertBefore(hint, wrap.nextSibling);
        const dayOf = () => String(input.value || '').slice(0, 10);
        const showDow = () => { hint.textContent = dayOf() ? u.parseYmd(dayOf()).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }) : ''; };
        input.addEventListener('input', showDow);
        input.addEventListener('change', showDow);
        showDow();
        let pop = null;
        const close = () => { if (pop) pop.remove(); pop = null; document.removeEventListener('keydown', key, true); env.root.removeEventListener('pointerdown', away, true); };
        const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
        const away = (e) => { if (pop && !pop.contains(e.target) && !wrap.contains(e.target)) close(); };
        const open = () => {
          if (pop) return close();
          const seed = dayOf() || u.ymd(new Date());
          let month = new Date(u.parseYmd(seed).getFullYear(), u.parseYmd(seed).getMonth(), 1);
          pop = document.createElement('div');
          pop.className = 'tv-dp';
          const draw = () => {
            const start = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay());
            const [from, to] = options.range ? options.range() : [];
            const today = u.ymd(new Date());
            let cells = '';
            for (let i = 0; i < 42; i += 1) {
              const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
              const k = u.ymd(d);
              cells += `<button type="button" class="tv-dp-day${d.getMonth() !== month.getMonth() ? ' other' : ''}${k === today ? ' today' : ''}${k === dayOf() ? ' sel' : ''}${from && to && k >= from && k <= to ? ' inrange' : ''}" data-day="${k}">${d.getDate()}</button>`;
            }
            pop.innerHTML = `<div class="tv-dp-head"><button type="button" data-dp="prev" aria-label="Previous month">&lsaquo;</button><strong>${u.esc(month.toLocaleDateString([], { month: 'long', year: 'numeric' }))}</strong><button type="button" data-dp="next" aria-label="Next month">&rsaquo;</button></div>
              <div class="tv-dp-grid">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((n) => `<span class="tv-dp-dow">${n}</span>`).join('')}${cells}</div>
              <div class="tv-dp-foot"><button type="button" data-dp="today">Today</button>${options.clearable ? '<button type="button" data-dp="clear">Clear</button>' : '<span></span>'}</div>`;
          };
          pop.addEventListener('click', (e) => {
            e.stopPropagation();
            const set = (day) => {
              input.value = !day ? '' : input.type === 'datetime-local' ? day + 'T' + ((input.value.split('T')[1]) || '12:00') : day;
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              close();
            };
            const day = e.target.closest('[data-day]');
            if (day) return set(day.dataset.day);
            const nav = e.target.closest('[data-dp]');
            if (!nav) return;
            if (nav.dataset.dp === 'prev') month = new Date(month.getFullYear(), month.getMonth() - 1, 1);
            else if (nav.dataset.dp === 'next') month = new Date(month.getFullYear(), month.getMonth() + 1, 1);
            else if (nav.dataset.dp === 'today') return set(u.ymd(new Date()));
            else if (nav.dataset.dp === 'clear') return set('');
            draw();
          });
          draw();
          (env.root === document ? document.body : env.root).appendChild(pop);
          // Under the field, by the page's coordinates, kept on screen.
          const r = input.getBoundingClientRect();
          const box = env.rootElement.getBoundingClientRect();
          const w = env.rootElement.clientWidth || 400;
          pop.style.top = r.bottom + 4 + 'px';
          pop.style.left = box.left + Math.max(8, Math.min(r.left - box.left, w - 252 - 8)) + 'px';
          document.addEventListener('keydown', key, true);
          env.root.addEventListener('pointerdown', away, true);
        };
        btn.addEventListener('click', open);
        return { close, refresh: () => { close(); showDow(); }, destroy: () => { close(); hint.remove(); wrap.parentNode.insertBefore(input, wrap); wrap.remove(); } };
      },
    },

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

    // The people of the room this panel is in: [{ key, name }] (empty outside a room panel). For choosing a person
    // ("whose is it"): store their `key`, never the name.
    people: () => call('people'),

    // Refs: pointing at another module's items without reaching into its data. A module lists what
    // it shares (produces) and what it wants to link to (consumes) in module.json; an admin approves
    // the latter. A pointer is { module, kind, id, scope: 'room' | 'server', room? }: store it, never
    // a copy of the item. resolve() asks Tavern for the item's card (title, subtitle, when, end,
    // allDay, done, module) or an { error, status } when it is gone or the viewer may not see it, so
    // a pointer is only ever as revealing as the viewer's own access.
    // The module's own page. `open(hash)` asks the host to open it at a place in it ("day=2026-09-24": letters,
    // digits and = & _ . : , - only), which a widget uses for a click that means "show me this in full";
    // `onHash(fn)` is called on the page with that place when it is opened that way (and again if it changes).
    page: {
      open: (hash) => call('page.open', { hash }),
      onHash: (fn) => tavern.on('pagehash', (e) => fn(e.hash)),
    },

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
      // A line on the page's drag trace, when tracing is on (open Tavern with ?debug=1); does nothing otherwise.
      trace: (msg) => {
        if (info && info.debug) call('refs.trace', { msg: String(msg).slice(0, 160) }).catch(() => {});
      },
      // The element of this module under a point given by dropTarget (its own coordinates), or null.
      elementAt: (pt) => env.elementAt(pt),
      // Make items draggable onto other modules: `root` holds them, and `resolve(target)` says what the pressed
      // element is: { kind, id, label, ...the options make() takes } for one of your items, or null. The drag
      // is driven by the pointer (press, move a few pixels, let go), not the browser's drag and drop, which is
      // unreliable between sandboxed frames; the host shows the label at the pointer and hands the drop to
      // the module under it (see dropTarget). Mouse and pen; on a touch screen search is the way to link.
      draggable: (root, resolve) => {
        const say = (msg) => tavern.refs.trace(msg);
        // The pointer in the module's own coordinates (a frame's are already; in the page they are shifted).
        const local = (e) => (env.localPoint ? env.localPoint(e.clientX, e.clientY) : { x: e.clientX, y: e.clientY });
        say('draggable ready');
        let down = null;
        let dragging = false;
        let sent = 0;
        root.addEventListener('pointerdown', (e) => {
          if (e.button !== 0 || e.pointerType === 'touch' || e.target.closest('input, textarea, select')) return;
          const item = resolve(e.target);
          say(item ? `pressed ${item.kind} ${item.id}` : 'pressed something that is not draggable');
          if (!item) return;
          down = { id: e.pointerId, x: e.clientX, y: e.clientY, item, el: e.target };
          // Follow the pointer from the first press, even when it leaves this module's frame at once.
          try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* it is followed while inside */ }
        });
        window.addEventListener('pointermove', (e) => {
          if (!down || e.pointerId !== down.id) return;
          if (!dragging) {
            if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) return;
            dragging = true;
            say('moved far enough: telling the page a drag began');
            const { kind, id, label, ...where } = down.item;
            call('refs.ptrStart', { ref: tavern.refs.make(kind, id, where), label, ...local(e) }).catch(() => {});
            return;
          }
          const now = Date.now();
          if (now - sent < 30) return;
          sent = now;
          call('refs.ptrMove', local(e)).catch(() => {});
        });
        const finish = (e, dropped) => {
          if (!down || e.pointerId !== down.id) return;
          say(dragging ? (dropped ? 'released: sending the drop' : 'pointer cancelled') : 'released without dragging');
          if (dragging) {
            if (dropped) call('refs.ptrDrop', local(e)).catch(() => {});
            else call('refs.dragEnd', {}).catch(() => {});
            // The release would otherwise count as a click on the item.
            const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
            window.addEventListener('click', stop, { capture: true, once: true });
            setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 100);
          }
          down = null;
          dragging = false;
        };
        window.addEventListener('pointerup', (e) => finish(e, true));
        window.addEventListener('pointercancel', (e) => finish(e, false));
      },
      // Receive a pointer dragged from another module on the same page. over(point, ref) as it moves across
      // this module, leave() when it goes, drop(ref, point) when it is let go; the point is { x, y } in
      // this module's own page, for document.elementFromPoint. Call this rather than (or as well as)
      // listening for dragover and drop yourself: a drag between two module frames reaches only this.
      dropTarget: (handlers) => tavern.on('refsdrag', (e) => {
        const ref = e.ref && cleanRef(e.ref);
        const point = { x: e.x, y: e.y };
        if (e.type !== 'over') tavern.refs.trace(`drag ${e.type} received (${ref ? ref.module + ':' + ref.kind : 'no valid pointer'})`);
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
      // { accepts: "module:kind" } keeps the ones that take a pointer to that kind of item; { self: true } also
      // lists this module's own, marked own: true.
      list: (o) => call('actions.list', { accepts: o && o.accepts, self: Boolean(o && o.self) }),
      // A small menu at a point (in your own coordinates, as a drop gives it) to let the person choose what to
      // do: pick([{ label, hint? }], point) resolves to the chosen item, or null if they dismiss it. With a single
      // item there is nothing to ask, and it resolves to it at once. With { remember: "some key" } the choice is
      // kept (in this browser, per module) and offered first, marked "last used", the next time the same key is
      // asked; give each item an `id` (its label is used if not) so the choice survives wording changes.
      pick: (items, at, o) => new Promise((resolve) => {
        let list = (items || []).filter(Boolean);
        const memory = o && o.remember ? `tavern:pick:${(info && info.module && info.module.id) || ''}:${String(o.remember).slice(0, 120)}` : '';
        const idOf = (it) => String(it.id || it.label);
        if (memory && list.length > 1) {
          let last = '';
          try { last = localStorage.getItem(memory) || ''; } catch (err) { last = ''; }
          const at0 = list.findIndex((it) => idOf(it) === last);
          if (at0 > 0) list = [{ ...list[at0], hint: list[at0].hint ? list[at0].hint + ' \u00b7 last used' : 'Last used' }, ...list.filter((_, i) => i !== at0)];
          else if (at0 === 0) list = [{ ...list[0], hint: list[0].hint ? list[0].hint + ' \u00b7 last used' : 'Last used' }, ...list.slice(1)];
        }
        const remember = (it) => { if (!memory || !it) return it; try { localStorage.setItem(memory, idOf(it)); } catch (err) { /* not kept */ } return it; };
        if (list.length < 2) return resolve(list[0] || null);
        const host = tavern.rootElement;
        const menu = document.createElement('div');
        menu.setAttribute('role', 'menu');
        menu.style.cssText = 'position:fixed;z-index:9999;min-width:200px;max-width:320px;padding:4px;border-radius:8px;border:1px solid var(--border,#555);background:var(--bg-card,#2a231d);color:var(--text,#f1e8dc);box-shadow:0 8px 24px rgba(0,0,0,.45);font:14px system-ui,sans-serif';
        const done = (v) => { menu.remove(); document.removeEventListener('keydown', key, true); env.root.removeEventListener('pointerdown', away, true); resolve(remember(v)); };
        const key = (e) => { if (e.key === 'Escape') done(null); };
        const away = (e) => { if (!menu.contains(e.target)) done(null); };
        for (const item of list) {
          const b = document.createElement('button');
          b.type = 'button';
          b.setAttribute('role', 'menuitem');
          b.style.cssText = 'display:block;width:100%;text-align:left;padding:7px 10px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;cursor:pointer';
          b.textContent = item.label;
          if (item.hint) { const h = document.createElement('div'); h.textContent = item.hint; h.style.cssText = 'font-size:12px;opacity:.65'; b.appendChild(h); }
          b.addEventListener('mouseenter', () => { b.style.background = 'rgba(255,255,255,.1)'; });
          b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; });
          b.addEventListener('click', () => done(item));
          menu.appendChild(b);
        }
        // Inside the module's own root (a shadow root in the page), placed by the page's coordinates.
        (env.root === document ? document.body : env.root).appendChild(menu);
        const box = host.getBoundingClientRect();
        const w = host.clientWidth || 400;
        const h = host.clientHeight || 400;
        menu.style.left = box.left + Math.max(4, Math.min(((at && at.x) || 0), w - menu.offsetWidth - 4)) + 'px';
        menu.style.top = box.top + Math.max(4, Math.min(((at && at.y) || 0), h - menu.offsetHeight - 4)) + 'px';
        document.addEventListener('keydown', key, true);
        env.root.addEventListener('pointerdown', away, true);
        const first = menu.querySelector('button');
        if (first) first.focus();
      }),
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
      // An item { id, type: 'quickadd', placeholder, label } is a text field with a small + button instead; the
      // 'bar' event then carries { id, value }, the text typed (empty if none).
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

  return { tavern, emit };
  }

  // A Tavern page that hosts modules includes this file with data-tavern-host, to build SDKs for modules
  // that run in the page; anywhere else, inside a frame, it boots for the module in that frame.
  const hostPage = Boolean(document.currentScript && document.currentScript.hasAttribute('data-tavern-host'));
  if (!hostPage && global.parent !== global) {
    // In a sandboxed frame: talk to the page that hosts it.
    const pending = new Map();
    let seq = 0;
    const call = (method, params) => new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      global.parent.postMessage({ tavern: 1, id, method, params }, '*');
      setTimeout(() => {
        if (!pending.delete(id)) return;
        reject(new Error('Tavern did not answer'));
      }, 30000);
    });
    // The theme arrives as CSS custom properties; setting them on :root lets a module's plain CSS follow
    // the theme (var(--bg), var(--text) ...).
    const applyTheme = (theme) => {
      if (!theme) return;
      for (const [name, value] of Object.entries(theme)) document.documentElement.style.setProperty(name, value);
    };
    const built = createTavern({
      call,
      root: document,
      rootElement: document.documentElement,
      elementAt: (pt) => document.elementFromPoint(pt.x, pt.y),
      applyTheme,
    });
    global.tavern = built.tavern;
    // The host puts a secret in this frame's address and in every message it sends.
    const secret = new URLSearchParams(global.location.search).get('tk');
    global.addEventListener('message', (e) => {
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
        built.emit(m.event, m.data);
      }
    });
  } else {
    // In the page: the host builds one per module running in the page.
    global.createTavern = createTavern;
  }
})(window);
