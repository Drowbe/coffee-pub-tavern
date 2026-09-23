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
      && (ref.scope === 'server' || ref.scope === 'person' || (ref.scope === 'room' && typeof ref.room === 'string' && ref.room.length <= 64));
    return ok ? { module: ref.module, kind: ref.kind, id: ref.id, scope: ref.scope, ...(ref.scope === 'room' ? { room: ref.room } : {}) } : null;
  }

  // What a drag carries, as one shape: { ref, card }. Takes what dropTarget hands a module, or a bare pointer.
  function normalizeDragged(dragged) {
    if (!dragged) return { ref: null, card: null };
    if (typeof dragged.module === 'string' && typeof dragged.id === 'string') return { ref: cleanRef(dragged), card: null };
    const ref = dragged.ref ? cleanRef(dragged.ref) : null;
    const card = !ref && dragged.card && typeof dragged.card.title === 'string' ? dragged.card : null;
    return { ref, card };
  }

  // The drop fill rules (see plan-drop.md, "The drop context"). For each `name: type` an action takes:
  //   ref:<module>:<kind>  the dropped pointer, when it is that kind
  //   ref                  the dropped pointer; a second one, or one named `target`, the target's own item under the pointer
  //   date / datetime      the day (and time) under the pointer, else the card's own date
  //   string  title/kind   the card's title / kind
  //   text    notes/body/content/text   the card's text, when the drag carried one
  //   number  lat/lng      the spot under the pointer (a map), else the card's own place
  // Returns the input, or null: a required input could not be filled, or nothing of the dropped item was used.
  const TEXT_FIELDS = ['notes', 'body', 'content', 'text'];
  function fillFor(action, dragged, context) {
    const d = normalizeDragged(dragged);
    const ctx = context || {};
    const card = ctx.card || d.card || {};
    const place = ctx.place || card.place || null;
    const input = {};
    let used = false;
    let refsGiven = 0;
    for (const [field, type] of Object.entries((action && action.input) || {})) {
      const t = String(type);
      const optional = t.endsWith('?');
      const base = optional ? t.slice(0, -1) : t;
      let value;
      if (base.startsWith('ref:')) {
        if (d.ref && base === `ref:${d.ref.module}:${d.ref.kind}`) { value = d.ref; used = true; }
      } else if (base === 'ref') {
        if (d.ref && field !== 'target' && refsGiven === 0) { value = d.ref; used = true; refsGiven += 1; }
        else if (ctx.target) value = ctx.target;
      } else if (base === 'date') {
        if (ctx.date) value = ctx.date;
        else if (card.date) { value = card.date; used = true; }
      } else if (base === 'datetime') {
        if (ctx.date) value = ctx.time ? `${ctx.date}T${ctx.time}` : ctx.date;
        else if (card.date) { value = card.date; used = true; }
      } else if (base === 'string') {
        if (field === 'title' && card.title) { value = String(card.title); used = true; }
        else if (field === 'kind' && card.kind) { value = String(card.kind); used = true; }
      } else if (base === 'text') {
        if (TEXT_FIELDS.includes(field) && card.text) { value = String(card.text); used = true; }
      } else if (base === 'number') {
        if (place && field === 'lat') { value = place.lat; if (!ctx.place) used = true; }
        else if (place && field === 'lng') { value = place.lng; if (!ctx.place) used = true; }
      }
      if (value === undefined) {
        if (!optional) return null;
        continue;
      }
      input[field] = value;
    }
    return used ? input : null;
  }
  // Why fillFor said no, for the drag trace.
  function whyNot(action, dragged, context) {
    const d = normalizeDragged(dragged);
    const ctx = context || {};
    for (const [field, type] of Object.entries((action && action.input) || {})) {
      const t = String(type);
      if (t.endsWith('?')) continue;
      const one = fillFor({ input: { [field]: t + '?' } }, d, ctx);
      const filledAlone = one && field in one;
      // A required input fillFor could not fill on its own is the reason; a plain `ref` or `title` counts as "used" itself.
      if (!filledAlone && !(t === 'ref' && ctx.target) ) return `needs ${field} (${t})`;
    }
    return 'nothing of the dropped item would be used';
  }

  // Text made safe to put in HTML.
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  // A small, safe subset of Markdown, to plain HTML: headings (# to ###), **bold**, *italic* or _italic_, `code`,
  // fenced ``` code blocks, unordered (-, *) and ordered (1.) lists, [text](url) links (http/https only; anything
  // else is left as plain text), paragraphs on a blank line, a single line break within one. Everything is escaped
  // first (via `esc`), so no HTML in the text itself ever reaches the page. This is the one place a module (or the
  // room page, for chat) may set innerHTML from what a person or an AI wrote, because the safety happens in here;
  // everywhere else, text still goes in with textContent. Used for an AI's replies and for chat messages, both text
  // nobody here wrote themselves.
  function markdown(text) {
    const inline = (s) => esc(s)
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      // A bare address the text didn't wrap in [text](...) itself: linked as it stands.
      .replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)"'])/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(?:\*|_)([^*_\n]+)(?:\*|_)/g, '<em>$1</em>');
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let para = [];
    let list = null; // { tag: 'ul' | 'ol', items: [] }
    let quote = null; // lines inside a > quote, raw (not yet inlined)
    let code = null; // lines inside a ``` fence, raw (not yet escaped)
    const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
    const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; } };
    const flushQuote = () => { if (quote) { out.push(`<blockquote>${quote.map(inline).join('<br>')}</blockquote>`); quote = null; } };
    for (const line of lines) {
      if (code) {
        if (/^\s*```\s*$/.test(line)) { out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null; }
        else code.push(line);
        continue;
      }
      if (/^\s*```/.test(line)) { flushPara(); flushList(); flushQuote(); code = []; continue; }
      if (!line.trim()) { flushPara(); flushList(); flushQuote(); continue; }
      const q = /^\s*>\s?(.*)$/.exec(line);
      if (q) { flushPara(); flushList(); if (!quote) quote = []; quote.push(q[1]); continue; }
      flushQuote();
      const h = /^(#{1,3})\s+(.+)$/.exec(line);
      if (h) { flushPara(); flushList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
      const ol = /^\s*\d+[.)]\s+(.+)$/.exec(line);
      const ul = !ol && /^\s*[-*]\s+(.+)$/.exec(line);
      if (ol || ul) {
        const tag = ol ? 'ol' : 'ul';
        if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
        list.items.push((ol || ul)[1]);
        continue;
      }
      flushList();
      para.push(line);
    }
    flushPara();
    flushList();
    flushQuote();
    if (code) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); // an unclosed fence: show what there was
    return out.join('');
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
.tv-menu { position: fixed; z-index: 9999; min-width: 180px; max-width: 320px; padding: 4px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text); box-shadow: 0 8px 24px rgba(0,0,0,.45); font: 13px system-ui, sans-serif; }
.tv-menu-item { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; width: 100%; padding: 7px 10px; border: 0; border-radius: 6px; background: none; color: inherit; font: inherit; text-align: left; text-decoration: none; cursor: pointer; box-sizing: border-box; }
.tv-menu-item:hover, .tv-menu-item:focus-visible { background: color-mix(in srgb, var(--accent) 14%, transparent); outline: none; }
.tv-menu-item:disabled { color: var(--text-dim); cursor: default; }
.tv-menu-item.danger { color: var(--danger); }
.tv-menu-item.danger:hover, .tv-menu-item.danger:focus-visible { background: color-mix(in srgb, var(--danger) 14%, transparent); }
.tv-menu-icon { flex: none; display: inline-flex; width: 1em; }
.tv-menu-icon svg { width: 1em; height: 1em; fill: currentColor; }
.tv-menu-label { flex: 1; min-width: 0; }
.tv-menu-hint { flex-basis: 100%; margin-top: 1px; color: var(--text-dim); font-size: 12px; }
.tv-menu-sep { height: 1px; margin: 4px 6px; background: var(--border); }
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

  // A menu's own icons, cached per module instance the same way a module drawing its own would (see
  // assistant.js and others): a menu opened often should not re-fetch the same SVG every time.
  const menuIconSvg = new Map();
  const menuIconWait = new Map();
  function menuIcon(name, style) {
    const key = `${style || 'solid'}:${name}`;
    if (menuIconSvg.has(key)) return Promise.resolve(menuIconSvg.get(key));
    if (!menuIconWait.has(key)) menuIconWait.set(key, call('icons.svg', { name, style: style || 'solid' }).then((svg) => { menuIconSvg.set(key, svg); return svg; }).catch(() => { menuIconSvg.set(key, ''); return ''; }));
    return menuIconWait.get(key);
  }

  // Only one tavern.menu is ever open at once (per module): { id, cleanup }.
  let openMenu = null;
  function closeMenu() {
    if (!openMenu) return;
    const { cleanup } = openMenu;
    openMenu = null;
    cleanup();
  }
  function showMenu({ id, items, at, anchor, className, maxWidth } = {}) {
    const reopening = openMenu && openMenu.id === id;
    closeMenu();
    if (reopening) return { close: closeMenu }; // the same trigger clicked again: toggle off, do not reopen
    const list = (items || []).filter(Boolean);
    if (!list.length) return { close: closeMenu };
    ensureUiStyles();
    const menu = document.createElement('div');
    menu.className = `tv-menu${className ? ` ${className}` : ''}`;
    menu.setAttribute('role', 'menu');
    if (maxWidth) menu.style.maxWidth = `${maxWidth}px`;
    const rows = [];
    for (const item of list) {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'tv-menu-sep';
        sep.setAttribute('role', 'separator');
        menu.appendChild(sep);
        continue;
      }
      // A real link (item.href) is an <a>, not a button: a menu item that just goes somewhere keeps the
      // browser's own affordances (hover preview, middle-click a new tab, copy link address) rather than
      // faking navigation from a click handler.
      const b = item.href ? document.createElement('a') : document.createElement('button');
      b.className = `tv-menu-item${item.danger ? ' danger' : ''}`;
      b.setAttribute('role', 'menuitem');
      if (item.href) {
        b.href = item.href;
        b.target = item.target || '_blank';
        b.rel = 'noopener';
      } else {
        b.type = 'button';
      }
      if (item.disabled) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
      if (item.icon) {
        const ic = document.createElement('span');
        ic.className = 'tv-menu-icon';
        if (item.iconColor) ic.style.color = item.iconColor;
        b.appendChild(ic);
        menuIcon(item.icon, item.regular ? 'regular' : 'solid').then((svg) => { if (svg) ic.innerHTML = svg; });
      }
      const label = document.createElement('span');
      label.className = 'tv-menu-label';
      label.textContent = item.label;
      b.appendChild(label);
      if (item.hint) {
        const h = document.createElement('div');
        h.className = 'tv-menu-hint';
        h.textContent = item.hint;
        b.appendChild(h);
      }
      if (!item.disabled && (item.onClick || item.href)) {
        b.addEventListener('click', async () => {
          let result;
          if (item.onClick) {
            try {
              result = await item.onClick(item, b);
            } catch (err) {
              console.error(err);
            }
          }
          if (result !== false) closeMenu(); // exactly `false` means the item armed itself and changed its own row; anything else closes (a plain href item just closes, letting the click through to the link)
        });
      }
      menu.appendChild(b);
      rows.push(b);
    }
    (env.root === document ? document.body : env.root).appendChild(menu);
    // Positioned like tavern.actions.pick's own menu and the date picker's popover: clamped inside the
    // module's own root, by a point (a drop's own coordinates) or under an element (a "..." button),
    // flipped above it when there is no room below.
    const box = env.rootElement.getBoundingClientRect();
    const w = env.rootElement.clientWidth || 400;
    const h = env.rootElement.clientHeight || 400;
    let x = (at && at.x) || 0;
    let y = (at && at.y) || 0;
    if (anchor && anchor.getBoundingClientRect) {
      const r = anchor.getBoundingClientRect();
      x = r.left - box.left;
      y = r.bottom - box.top + 4;
      if (y + menu.offsetHeight > h) y = r.top - box.top - menu.offsetHeight - 4;
    }
    x = Math.max(4, Math.min(x, w - menu.offsetWidth - 4));
    y = Math.max(4, Math.min(y, h - menu.offsetHeight - 4));
    menu.style.left = `${box.left + x}px`;
    menu.style.top = `${box.top + y}px`;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); } };
    const onOutside = (e) => { if (!menu.contains(e.target) && e.target !== anchor) closeMenu(); };
    document.addEventListener('keydown', onKey, true);
    env.root.addEventListener('pointerdown', onOutside, true);
    openMenu = {
      id,
      cleanup: () => {
        menu.remove();
        document.removeEventListener('keydown', onKey, true);
        env.root.removeEventListener('pointerdown', onOutside, true);
        if (anchor && anchor.focus) { try { anchor.focus(); } catch (err) { /* not focusable */ } }
      },
    };
    const first = rows.find((b) => !b.disabled);
    if (first) first.focus();
    return { close: closeMenu };
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
      esc,
      // A small, safe subset of Markdown to HTML (see the function above): headings, **bold**, *italic*, `code`,
      // fenced code, lists, [text](url) and bare https:// links, > quotes, paragraphs. The one place a module may
      // set innerHTML from text nobody here wrote, because the safety is already done inside it.
      markdown,
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
      // Places on the earth, for the modules that have them (a place, a map): coordinates checked and read, and the link
      // that opens a spot in the person's own maps app. Pure, so a check can run it without a browser.
      geo: (() => {
        const inRange = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
        const round6 = (n) => Math.round(n * 1e6) / 1e6;
        // Text on one line, without control characters, at most `max` long.
        const oneLine = (s, max) => String(s == null ? '' : s).replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
        // A latitude or longitude typed in a field (`max` is 90 or 180): a number in range, or null.
        const coord = (text, max) => {
          const t = String(text == null ? '' : text).trim().replace(',', '.');
          if (!/^[-+]?\d{1,3}(\.\d+)?$/.test(t)) return null;
          const n = Number(t);
          return Math.abs(n) <= max ? n : null;
        };
        // What was typed or pasted: a pair of coordinates ("38.7075, -9.1364"), or a map link that carries them (a geo: link,
        // ?ll= or ?q= or ?mlat=&mlon=, /@lat,lng, #map=zoom/lat/lng, !3dLAT!4dLNG). { lat, lng } or null.
        const parsePoint = (text) => {
          const t = String(text == null ? '' : text).trim();
          if (!t) return null;
          const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';
          const pair = (re) => {
            const m = t.match(re);
            if (!m) return null;
            const lat = Number(m[1]);
            const lng = Number(m[2]);
            return inRange(lat, lng) ? { lat: round6(lat), lng: round6(lng) } : null;
          };
          if (/^[-+]?\d/.test(t) && !/[a-z]/i.test(t)) return pair(new RegExp(`^${NUM}\\s*[,;\\s]\\s*${NUM}$`));
          return (
            pair(new RegExp(`^geo:${NUM},${NUM}`, 'i')) ||
            pair(new RegExp(`[?&](?:ll|q|query|center|sll)=${NUM}(?:,|%2C)\\s*${NUM}`, 'i')) ||
            pair(new RegExp(`[?&]mlat=${NUM}&(?:amp;)?mlon=${NUM}`, 'i')) ||
            pair(new RegExp(`!3d${NUM}!4d${NUM}`)) ||
            pair(new RegExp(`/@${NUM},${NUM}`)) ||
            pair(new RegExp(`#map=\\d{1,2}(?:\\.\\d+)?/${NUM}/${NUM}`))
          );
        };
        const fmt = (n) => (Math.round(n * 1e5) / 1e5).toFixed(5);
        // "38.70750, -9.13640"
        const coordsText = (lat, lng) => `${fmt(lat)}, ${fmt(lng)}`;
        // The link that opens a spot in the person's own maps app: the platform's own link on Apple devices (`apple`
        // true), a geo: link on Android, which hands it to the maps app, and an ordinary web link everywhere else. A
        // desktop browser has nothing registered for geo:, so it would open nothing (Windows shows a blank page).
        // Directions are that app's business.
        const android = () => typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '');
        const mapsLink = (lat, lng, name, apple) => {
          const n = oneLine(name, 80).replace(/[()]/g, ' ');
          if (apple) return `https://maps.apple.com/?ll=${lat},${lng}&q=${encodeURIComponent(n || 'Place')}`;
          if (android()) return `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(n || 'Place')})`;
          return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
        };
        // The same for a place with only a name or an address: the maps app searches for it.
        const mapsSearch = (text, apple) => {
          const q = encodeURIComponent(oneLine(text, 160));
          if (apple) return `https://maps.apple.com/?q=${q}`;
          if (android()) return `geo:0,0?q=${q}`;
          return `https://www.openstreetmap.org/search?query=${q}`;
        };
        return { inRange, round6, oneLine, coord, parsePoint, coordsText, mapsLink, mapsSearch };
      })(),
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
      // A view or filter switch, drawn in the toolbar (see tavern.toolbar.set) -- its most common tool, so
      // this is the one built for every module rather than each writing its own diffing and event wiring.
      // { id, options: [{ id, label?, icon?, regular?, iconOnly? }], value, onChange }: an option needs a
      // label, an icon, or both (see tavern.toolbar.set's 'tabs' item for what each does). Draws once, then
      // only redraws when the value or the options actually change (call set() every render; it no-ops
      // when nothing did). Returns { set(value, options?), destroy() }.
      viewSwitch: ({ id, options, value, onChange }) => {
        let sig = '';
        let current = value;
        let opts = options;
        const off = tavern.on('toolbar', (e) => {
          if (e.id !== id) return;
          current = e.value;
          onChange(e.value);
        });
        const draw = () => {
          const s = `${current}|${JSON.stringify(opts)}`;
          if (s === sig) return;
          sig = s;
          tavern.toolbar.set([{ type: 'tabs', id, value: current, options: opts }]).catch(() => {});
        };
        draw();
        return {
          set(newValue, newOptions) {
            current = newValue;
            if (newOptions) opts = newOptions;
            draw();
          },
          destroy: off,
        };
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

    // Files an admin placed for this module (a `file` setting names one). `url(name)` is the address to read it from,
    // range requests included, for a module running in the page (a frame cannot fetch).
    files: {
      url: (name) => call('files.url', { name }),
    },

    // AI, asked of the server (declare the `ai` hook; the admin approves it like the others). The admin chooses the service and
    // keeps its key on the server; a page never sees either. `available()` -> { available, why } (say why a button is hidden);
    // `ask({ task, question, items })` where task is 'summarise', 'ask' or 'tags' and items are pointers ({ module, kind, scope, id }),
    // read by the server as the person asking. Answers: { text, cards, used, tags, tokens }. `text` holds the model's words with a
    // line {{card:0}} where each card goes; `cards` are checked ({ icon, title, content, tags, place, date, links, sources }, sources
    // as pointers). Nothing is kept by the server. The model has no tools and nothing it says is run.
    ai: {
      available: () => call('ai.available'),
      ask: (o) => call('ai.ask', { task: o && o.task, question: o && o.question, items: o && o.items }),
    },

    // Pictures people add (a module declares `uploads` in module.json). The server checks each from its own bytes and takes out
    // what rides along (text, thumbnails, maker notes); a photo's position is dropped unless `keepPosition` is true. Make the
    // picture the size you want first (about 2000 px on the long edge) and a thumbnail (about 400 px) in the page.
    //   put(blob, { name, keepPosition, scope })  -> { id, name, type, size, by, at, taken, camera, hasPosition, position, hasThumb }
    //   thumb(id, blob, { scope })                the thumbnail for a file you put
    //   list({ scope }), remove(id, { scope }), url(id, { thumb, scope })  (the address to use as an <img> source)
    // `hasPosition` says the photo carried one, so you can offer to keep it (put it again with keepPosition). Remove a file when
    // you remove the item that shows it.
    uploads: {
      put: (file, o) => call('uploads.put', { file, name: o && o.name, keepPosition: !!(o && o.keepPosition), scope: o && o.scope }),
      inspect: (file, o) => call('uploads.inspect', { head: file, scope: o && o.scope }), // -> { type, taken, camera, hasPosition, position }: read before you resize, which loses them
      thumb: (id, file, o) => call('uploads.thumb', { id, file, scope: o && o.scope }),
      list: (o) => call('uploads.list', { scope: o && o.scope }),
      remove: (id, o) => call('uploads.remove', { id, scope: o && o.scope }),
      url: (id, o) => call('uploads.url', { id, thumb: !!(o && o.thumb), scope: o && o.scope }),
    },

    // The module's settings, as chosen for this viewer here: { key: value }, with the module's own default for what
    // nobody has chosen. Declared in module.json (`settings`); Tavern draws the forms (an admin's for the server, a
    // room's moderators' for a room, each person's own) and keeps the values. `onChange(fn)` calls fn(values) when any of
    // them changes.
    settings: {
      get: () => call('settings.get'),
      onChange: (fn) => tavern.on('settings', () => call('settings.get').then(fn).catch(() => {})),
    },

    // Place search, asked of the server (for a module whose manifest declares `geocoder`). `search(q, near)` answers
    // { results: [{ key, title, sub, lat, lng, from }], configured, credit }; `used(key)` marks a result as picked.
    geocode: {
      search: (q, near) => call('geocode.search', { q, lat: near && near.lat, lon: near && near.lon }),
      used: (key) => call('geocode.used', { key }),
    },

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
        const personal = o && o.scope === 'person';
        const server = !personal && !otherRoom && ((o && o.scope === 'server') || ctx.scope !== 'room');
        const ref = { module: info && info.module && info.module.id, kind, id: String(id), scope: personal ? 'person' : server ? 'server' : 'room' };
        if (!server && !personal) ref.room = otherRoom || ctx.roomId;
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
      // element is: { kind, id, label, ...the options make() takes } for one of your items, or, for something
      // you have not stored (an answer's card), { card: { title, kind?, content?, place?, date? }, label? }, or null. The drag
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
            // One of this module's items ({ kind, id, ... }), or a card it has not stored ({ card: { title, ... } }).
            const { kind, id, card, label, ...where } = down.item;
            const payload = card ? { card, label: label || card.title } : { ref: tavern.refs.make(kind, id, where), label };
            call('refs.ptrStart', { ...payload, ...local(e) }).catch(() => {});
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
      // `ref` is the pointer dragged, or null; the third argument is what was dragged in full, { ref } or
      // { card } (a card carried by a module with nothing stored), for dropMenu.
      dropTarget: (handlers) => tavern.on('refsdrag', (e) => {
        const ref = e.ref && cleanRef(e.ref);
        const dragged = { ref, card: (!ref && e.card && typeof e.card.title === 'string') ? e.card : null };
        const point = { x: e.x, y: e.y };
        if (e.type !== 'over') tavern.refs.trace(`drag ${e.type} received (${ref ? ref.module + ':' + ref.kind : dragged.card ? 'a card' : 'no valid pointer'})`);
        if (e.type === 'over') handlers.over && handlers.over(point, ref, dragged);
        else if (e.type === 'leave') handlers.leave && handlers.leave();
        else if (e.type === 'drop') {
          handlers.leave && handlers.leave();
          handlers.drop && handlers.drop(ref, point, dragged);
        }
      }),
      // The fill rules: what a drop can fill of an action's inputs, from what was dragged and what is under
      // the pointer (the drop context: { card, target?, date?, time?, place? }). Returns the input to request
      // the action with, or null when a required input cannot be filled or nothing of the dropped item was
      // used (an action unrelated to the item is never offered just because a day was under the pointer).
      // Pure: tools/check-drop.mjs runs it against every case.
      fillFor: (action, dragged, context) => fillFor(action, dragged, context),
      // What the modules around this one can do with what was dropped: [{ id, label, hint, action, input }],
      // each ready to request. `dragged` is what dropTarget gave ({ ref } or { card }); `context` is what
      // this module says is under the pointer. Resolves the ref into a card unless context.card is given.
      offersFor: async (dragged, context) => {
        const d = normalizeDragged(dragged);
        const ctx = { ...(context || {}) };
        if (!ctx.card) {
          if (d.ref) {
            const card = await tavern.refs.resolve(d.ref);
            if (!card || card.error) throw new Error((card && card.error) || 'that item is not available');
            ctx.card = card;
          } else ctx.card = d.card || {};
        }
        let list = [];
        try { list = await tavern.actions.list(d.ref ? { accepts: `${d.ref.module}:${d.ref.kind}` } : {}); } catch (err) { list = []; }
        const offers = [];
        for (const a of list) {
          // What the action says the item must have (a position, a date, text): declared as `needs` on the action.
          const lacks = (a.needs || []).find((f) => !ctx.card[f]);
          if (lacks) { tavern.refs.trace(`drop: ${a.action} not offered (the item has no ${lacks})`); continue; }
          // An action of the module the item came from, taking it only as a plain ref, makes something of its own item
          // elsewhere (a task from a task): not what a drop means. Taking it by its exact kind (link this task to...) is.
          if (d.ref && a.module === d.ref.module && !Object.values(a.input || {}).some((t) => String(t).replace(/\?$/, '') === `ref:${d.ref.module}:${d.ref.kind}`)) {
            tavern.refs.trace(`drop: ${a.action} not offered (its own module's, and it takes the item only as any ref)`);
            continue;
          }
          const input = fillFor(a, d, ctx);
          if (!input) { tavern.refs.trace(`drop: ${a.action} not offered (${whyNot(a, d, ctx)})`); continue; }
          offers.push({ id: a.action, label: a.label, hint: a.moduleName, action: a, input });
        }
        return offers;
      },
      // The one decision, shared by every module: what dropping this here can do. Shows the module's own
      // offers (`own`, first: [{ id, label, hint?, run(ctx), when?(ctx) }], an offer whose `when` says no
      // for this card is left out) and every action the modules around it can fill from the drop context,
      // lets the person choose (actions.pick, with `remember` as its key alongside the dropped kind), and
      // runs it. Resolves to the offer taken, or null if dismissed; throws when nothing can be done, or it failed.
      dropMenu: async (dragged, point, { context, own, remember, wait } = {}) => {
        const d = normalizeDragged(dragged);
        const ctx = { ...(context || {}) };
        // The card first, once, so the module's own offers and the actions' fill see the same one.
        if (!ctx.card) {
          if (d.ref) {
            const card = await tavern.refs.resolve(d.ref);
            if (!card || card.error) throw new Error((card && card.error) || 'that item is not available');
            ctx.card = card;
          } else ctx.card = d.card || {};
        }
        const offers = (own || []).filter((o) => o && (!o.when || o.when(ctx)));
        offers.push(...await tavern.refs.offersFor(d, ctx));
        tavern.refs.trace(`drop offers: ${offers.map((o) => o.label).join(' | ') || 'none'}`);
        if (!offers.length) throw new Error('Nothing can be done with that here.');
        const kind = d.ref ? `${d.ref.module}:${d.ref.kind}` : 'card';
        const chosen = await tavern.actions.pick(offers, point, remember ? { remember: `${kind}:${remember}` } : undefined);
        if (!chosen) return null;
        if (chosen.run) await chosen.run(ctx);
        else {
          const out = await tavern.actions.request(chosen.action.action, chosen.input, { wait: wait !== false });
          if (out.status === 'done' && out.result && out.result.ok === false) throw new Error(out.result.error || 'it could not be done');
        }
        return chosen;
      },
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
            result = { ok: true, ref: out && out.ref, ...(out && out.data !== undefined ? { data: out.data } : {}) };
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
    // toolbar and the chat box). set([{ id, label, icon, primary, disabled, overflow }]);
    // a click arrives as the 'bar' event with the button's id. More than 5 items (or any
    // item marked `overflow: true`) collapse into a host-drawn "..." at the end.
    bar: {
      // An item { id, type: 'quickadd', placeholder, label } is a text field with a small + button instead; the
      // 'bar' event then carries { id, value }, the text typed (empty if none). A quickadd item is never
      // pushed into the "..." -- it is exempt from the overflow count.
      set: (items) => call('bar.set', { items }),
    },

    // Icon buttons in the module's titlebar, ahead of the pane's own buttons and set off by a pipe:
    // set([{ id, icon, title, on, regular, disabled, overflow }]), where `icon` is a Font Awesome name (solid, or
    // regular with `regular: true`) and `on` marks the current choice. A click arrives as the 'header'
    // event with the button's id. Resolves true when the host drew them, false when it has no titlebar
    // to draw in (a module's server page), in which case keep the controls in the page. More than 5 items
    // (or any item marked `overflow: true`, e.g. a destructive one you always want tucked away) collapse
    // into a host-drawn "..." at the end -- the same idea as tavern.menu.show, but for the host's own chrome.
    header: {
      set: (items) => call('header.set', { items }),
    },

    // An optional row under the titlebar, above the content: a small kit of reusable tools about the
    // module's current state -- a view switch, a filter, a progress bar, a slider -- not window-level
    // actions (those are the titlebar) and not the module's primary inputs (those are the action bar).
    // It is not a second row of titlebar icons: use 'button' sparingly, for the one action that goes with
    // the toolbar's own state, not a place to relocate the titlebar's row. 'tabs' can carry an icon per
    // option when the icon itself is meaningful (Places' Mine/This room/Everyone, say) -- that is different
    // from a button row standing in for a titlebar. set([item, ...]) where item is one of:
    //   { type: 'text', text }                                             -- plain dim label
    //   { type: 'tabs', id, value, options: [{ id, label?, icon?, regular?, iconOnly? }] } -- a segmented
    //       switch; give label, icon, or both per option (iconOnly hides the label, kept for aria-label
    //       and the tooltip). A click arrives as the 'toolbar' event { id, value: optionId }
    //   { type: 'progress', value, label? }                               -- a read-only bar, value 0-100
    //   { type: 'slider', id, value, min?, max?, step?, label?, disabled? } -- a range input; moving it
    //       arrives as the 'toolbar' event { id, value } (min 0, max 100, step 1 unless given)
    //   { type: 'button', id, label?, icon?, on?, primary?, disabled?, overflow? } (the default type) --
    //       a click arrives as the 'toolbar' event { id }
    //   { separator: true }                                                -- a vertical divider
    // Only 'button' items count toward the 5-item cap and collapse into a host-drawn "..."; text, tabs,
    // progress and slider items always show. Resolves true when the host drew it, false when it has
    // nowhere to (a module's server page), same as header.set.
    toolbar: {
      set: (items) => call('toolbar.set', { items }),
    },

    // A menu of actions -- the shared shape for a row's "..." button, a right-click, a joint's +, anything
    // that is "here are some things you could do, pick one." Not for a single yes/no drop decision with
    // nothing more to say afterward (see tavern.actions.pick for that).
    //
    // show({ id, items, at, anchor, className, maxWidth }): items are [{ id?, label, icon?, iconColor?,
    // regular?, hint?, disabled?, danger?, separator?, href?, target?, onClick? }] (separator: true
    // ignores every other field and draws a divider; iconColor is a CSS color for that item's own icon,
    // for a fixed set of kinds people tell apart by color elsewhere in the module -- most menus don't need
    // it). An item that just goes somewhere gives `href` instead of `onClick` -- a real link (target
    // "_blank" unless given), not a click handler faking navigation, so hovering, copying and opening in a
    // new tab all still work. Position with `at: { x, y }` (a drop's own coordinates) or `anchor` (an element to open
    // under, like the button that opened it) -- give one, not both. `onClick(item)` runs on a click; unless
    // it returns exactly `false`, or a promise that resolves to exactly `false`, the menu closes afterward --
    // an item that needs to arm itself first ("Really delete?") returns false and changes its own label by
    // calling show() again with the same id.
    //
    // Only one of these is ever open at a time (per module): showing one closes whatever else was open
    // first. Showing the same id again while it is already open closes it instead of reopening it, so a
    // "..." button toggles rather than always opening a fresh copy. Returns { close }.
    menu: {
      show({ id, items, at, anchor, className, maxWidth } = {}) {
        return showMenu({ id, items, at, anchor, className, maxWidth });
      },
      close: () => closeMenu(),
    },

    // Layout: ask the host for a size, and set the title shown above the module.
    resize: (size) => call('resize', size),
    setTitle: (title) => call('setTitle', { title }),

    // Events: 'bar' ({ id }) when an action bar button is clicked, 'header' ({ id }) for a titlebar icon,
    // 'toolbar' ({ id, value? }) for a toolbar item, 'change' ({ key, value, version, deleted, scope, by })
    // whenever stored data changes, 'schedule' ({ key, payload }) when a schedule fires, 'theme' (the new theme).
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

  // `esc` and `markdown` need no per-module env, so the room page (which loads this file directly for the modules
  // it hosts in the page, not as a module itself) can use the very same rendering Chat and every module share,
  // rather than a second copy. See tavern.util.markdown above for what this covers.
  global.tavernText = { esc, markdown };
})(window);
