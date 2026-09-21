// The Travel module's page: a trip's itinerary, day by day, for one room. The trip and its items live in the module's
// store (see travel-lib-plan.js); this page draws them into the markup in travel.html by cloning its templates and
// filling their [data-slot] and [data-icon] hooks, and then only toggles the state classes and data attributes that
// CONTRACT.md lists. It never builds markup from strings and sets no style (one exception: the item menu is placed
// under the button that opened it). Items other modules hold come in as pointers, drawn from their cards.
(async () => {
  'use strict';

  // This module runs in a frame (the SDK is a global) or in the page (its SDK is handed to its script); either way
  // it looks elements up in tavern.root, never in document, so it works in both.
  const tavern = (document.currentScript && document.currentScript.tavern) || window.tavern;
  const root = tavern.root;
  const $ = (id) => root.getElementById(id);
  const { ymd, parseYmd } = tavern.util;

  let info;
  try {
    info = await tavern.ready();
  } catch (err) {
    $('msg').textContent = 'Travel could not start: ' + err.message;
    return;
  }
  if (info.context.scope !== 'room') {
    $('msg').textContent = 'A trip belongs to a room. Open the room, then Travel from its panes; the dashboard lists your trips.';
    return;
  }

  /*__LIB__*/

  const canEdit = tavern.can('edit');
  const plan = createPlan(tavern);
  const CAT = { do: 'things', eat: 'food', stay: 'stay', travel: 'travel', other: 'other' };
  const CAT_LABEL = { do: 'Things to do', eat: 'Food', stay: 'Stay', travel: 'Travel', other: 'Other' };
  const CAT_ICON = { do: 'ticket', eat: 'utensils', stay: 'bed', travel: 'plane', other: 'note-sticky' };

  const state = {
    view: 'days',
    loaded: false,
    people: [], // [{ key, name }] of this room
    links: new Map(), // plan item id -> cards of what other modules link to it
    tripLinks: [], // cards of what other modules link to the trip itself
    conflicts: new Map(), // item id -> { patch }: my edit that met someone else's change
    editing: null, // { mode: 'item' | 'trip', id, kind, day }
    menuFor: null, // item id
    currentDay: null, // the day in view (where a quick add goes)
    hosted: Boolean(tavern.bar), // the host draws the quick-add bar, so the days' own add rows step aside
    deleteArmed: null,
  };
  const nameOf = (key) => (state.people.find((p) => p.key === key) || {}).name || 'Someone';

  // --- small helpers -----------------------------------------------------------------------------------------

  const clone = (id) => $(id).content.firstElementChild.cloneNode(true);
  const parts = (id) => [...$(id).content.children].map((n) => n.cloneNode(true));
  const hide = (node, yes) => { if (node) node.hidden = Boolean(yes); };
  // The place line has an icon and a text of its own: set the text and hide the line when there is none.
  const setPlace = (el, text) => { fill(el, { 'place-text': text }); hide(slot(el, 'place'), !text); };
  const slot = (el, name) => el.querySelector(`[data-slot="${name}"]`);
  // Set a slot's text, or hide the slot when there is nothing to show.
  function fill(el, values) {
    for (const [name, v] of Object.entries(values)) {
      const node = slot(el, name);
      if (!node) continue;
      if (v === null || v === undefined || v === '') { node.hidden = true; continue; }
      node.hidden = false;
      node.textContent = String(v);
    }
  }

  // Icons come as inline SVG from the SDK, fetched once each; an element with data-icon gets its icon when it arrives.
  const iconSvg = new Map();
  const iconWait = new Map();
  function wantIcon(name) {
    if (iconSvg.has(name)) return Promise.resolve(iconSvg.get(name));
    if (!iconWait.has(name)) iconWait.set(name, tavern.ui.icon(name).then((svg) => { iconSvg.set(name, svg); return svg; }).catch(() => { iconSvg.set(name, ''); return ''; }));
    return iconWait.get(name);
  }
  function hydrate(scope) {
    for (const el of scope.querySelectorAll('[data-icon]')) {
      const name = el.dataset.icon;
      if (!name || el.dataset.shown === name) continue;
      if (iconSvg.has(name)) { el.innerHTML = iconSvg.get(name); el.dataset.shown = name; } else wantIcon(name).then(() => hydrate(scope));
    }
  }
  const setIcon = (node, name) => { if (node) { node.dataset.icon = name || ''; delete node.dataset.shown; node.textContent = ''; } };

  const dayShort = (d) => parseYmd(d).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  const hm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const lengthText = (m) => (m ? (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) : ''}` : `${m} min`) : '');
  // One letter, or two when another traveller of the room starts with the same one.
  const initial = (key) => {
    const name = nameOf(key);
    const first = (name[0] || '?').toUpperCase();
    const clash = state.people.some((p) => p.key !== key && (p.name[0] || '').toUpperCase() === first);
    return clash ? first + (name[1] || '').toLowerCase() : first;
  };
  const timeOf = (card) => (cardWhen(card) || {}).time || '';
  const planRef = (id) => tavern.refs.make('plan', id);
  const tripRef = () => tavern.refs.make('trip', 'main');
  const note = (text) => { $('note').textContent = text || ''; hide($('note'), !text); };

  // The time cell: the start in bold, then whatever goes after it.
  function setTime(cell, start, after) {
    cell.textContent = '';
    if (start) { const b = document.createElement('b'); b.textContent = start; cell.append(b); }
    if (after) cell.append(document.createTextNode(after));
  }

  // --- one item ----------------------------------------------------------------------------------------------

  function ownersInto(el, item) {
    const box = slot(el, 'owners');
    if (!box) return;
    box.textContent = '';
    hide(box, !item.owners.length);
    for (const key of item.owners) { const o = clone('tpl-owner'); o.textContent = initial(key); box.append(o); }
    box.setAttribute('title', item.owners.map(nameOf).join(', '));
  }
  function linksInto(el, item) {
    const box = slot(el, 'links');
    if (!box) return;
    box.textContent = '';
    const cards = state.links.get(item.id) || [];
    hide(box, !cards.length);
    for (const c of cards) {
      const l = clone('tpl-link');
      setIcon(l.querySelector('[data-icon]'), c.module && c.module.icon);
      fill(l, { kind: c.kindName || (c.module && c.module.name), title: c.title });
      box.append(l);
    }
  }

  // `entry` is { item, span } (a stay is drawn on each night it covers; only its first day is the real item).
  function buildItem(entry) {
    const { item, span } = entry;
    const card = item.ref ? plan.cards.get(tavern.util.refKey(item.ref)) : null;
    const el = clone(`tpl-item-${item.kind}`);
    el.dataset.id = item.id;
    el.dataset.kind = item.kind;
    if (item.kind !== 'link') el.dataset.cat = CAT[item.category] || 'other';
    if (item.kind === 'stay' && span) el.dataset.span = span;
    el.classList.toggle('done', item.done);
    const time = slot(el, 'time');

    if (item.kind === 'link') {
      const gone = !card || card.error;
      setIcon(slot(el, 'source').querySelector('[data-icon]'), gone ? 'link-slash' : card.module.icon);
      fill(el, { module: gone ? 'another module' : card.module.name, title: item.title || (gone ? 'No longer available' : card.title), body: item.result ? `Result: ${item.result}` : gone ? '' : card.subtitle });
      setTime(time, timeOf(card), '');
      const open = el.querySelector('[data-action="open"]');
      hide(open, gone || !card.open);
    } else if (item.kind === 'stay') {
      fill(el, { title: span === 'middle' ? `Staying at ${item.title}` : item.title, code: item.confirm });
      setPlace(el, span === 'middle' ? '' : item.place || item.address);
      setTime(time, span === 'end' || span === 'middle' ? '' : item.time || '', span === 'end' ? 'check out' : span === 'middle' ? '' : 'check in');
    } else if (item.kind === 'journey') {
      const arrive = item.time && item.minutes ? `→ ${hm(minutesOfDay(item.time) + item.minutes)}` : '';
      fill(el, { title: item.title, from: item.from, to: item.to, code: item.confirm });
      setTime(time, item.time || '', arrive);
    } else if (item.kind === 'note') {
      fill(el, { title: item.title, body: item.notes });
      setTime(time, item.time || '', '');
    } else {
      fill(el, { title: item.title });
      setPlace(el, item.place || item.address);
      setTime(time, item.time || '', lengthText(item.minutes));
      const cat = slot(el, 'category');
      if (cat) {
        cat.className = `cat cat-${CAT[item.category] || 'other'}`;
        setIcon(cat.querySelector('[data-icon]'), CAT_ICON[item.category]);
        fill(cat, { 'category-label': CAT_LABEL[item.category] });
      }
    }
    if (span === 'middle') for (const n of el.querySelectorAll('.item-meta, .item-sub, .route')) n.remove();
    if (span === 'middle' || span === 'end') el.querySelector('.item-handle')?.remove();
    if (!canEdit) { el.querySelector('.item-handle')?.remove(); el.querySelector('.item-menu')?.remove(); }
    ownersInto(el, item);
    linksInto(el, item);
    if (state.conflicts.has(item.id)) {
      el.classList.add('conflict');
      const bar = clone('tpl-conflict');
      fill(bar, { text: 'Someone changed this while you were editing.' });
      el.append(bar);
    }
    return el;
  }

  // --- the days ----------------------------------------------------------------------------------------------

  // The entries of a day: its items in order, and the stays that cover it.
  function entriesFor(day, days, by) {
    const list = by.get(day) || [];
    const out = list.map((item) => ({ item, span: item.kind === 'stay' && item.checkOut && item.checkOut > day ? 'start' : undefined }));
    // The nights a stay covers (and its check-out) sit at the top of the day, like a banner, before the day's own items.
    const covering = [];
    for (const s of plan.list().filter((i) => i.kind === 'stay' && i.date && i.checkOut)) {
      if (day > s.date && day <= s.checkOut) covering.push({ item: s, span: day === s.checkOut ? 'end' : 'middle' });
    }
    return [...covering, ...out];
  }

  function buildDay(day, index, days, by) {
    const el = clone('tpl-day');
    const ideas = day === null;
    el.id = ideas ? 'day-ideas' : `day-${day}`;
    el.dataset.day = ideas ? '' : day;
    if (!ideas) el.dataset.index = String(index + 1);
    el.classList.toggle('today', !ideas && day === ymd(new Date()));
    const entries = ideas ? (by.get(null) || []).map((item) => ({ item })) : entriesFor(day, days, by);
    fill(el, { date: ideas ? 'Ideas' : dayShort(day), position: ideas ? 'not on a day yet' : dayLabel(day, days).position.toLowerCase(), count: entries.length || '' });
    const list = el.querySelector('.items');
    if (!entries.length) {
      const empty = clone('tpl-day-empty');
      empty.textContent = ideas ? 'Ideas with no day yet wait here.' : 'Nothing planned yet. Add something below.';
      list.append(empty);
    }
    entries.forEach((entry, i) => {
      list.append(buildItem(entry));
      const next = entries[i + 1];
      const gap = next && !entry.span && !next.span ? gapMinutes(entry.item, next.item) : null;
      if (gap) { const g = clone('tpl-gap'); g.textContent = gapText(gap); list.append(g); }
    });
    const add = el.querySelector('.add-row');
    add.dataset.day = ideas ? '' : day;
    add.setAttribute('aria-label', `Add to ${ideas ? 'ideas' : dayShort(day)}`);
    // With the host's bar the days' add rows hide; the Ideas one stays, the only quick way to add an idea.
    add.classList.toggle('hosted', state.hosted && !ideas);
    if (!canEdit) add.remove();
    // What other modules hold on this day that the plan could take in.
    const box = el.querySelector('.suggestions');
    const list2 = box.querySelector('.suggestions-list');
    const mine = canEdit && !ideas ? plan.suggestions.filter((c) => (cardWhen(c) || {}).day === day) : [];
    hide(box, !mine.length);
    for (const c of mine) {
      const s = clone('tpl-suggestion');
      s.dataset.ref = JSON.stringify(c.ref);
      setIcon(s.querySelector('[data-icon]'), c.module.icon);
      fill(s, { title: c.title, module: c.module.name });
      list2.append(s);
    }
    return el;
  }

  function renderDays() {
    const days = plan.days();
    const by = plan.byDay();
    const wrap = document.createElement('div');
    wrap.id = 'days';
    wrap.className = 'days';
    days.forEach((day, i) => wrap.append(buildDay(day, i, days, by)));
    if ((by.get(null) || []).length) wrap.append(buildDay(null, days.length, days, by));
    $('body').replaceChildren(wrap);
  }

  function renderStrip() {
    const strip = $('daystrip');
    strip.replaceChildren();
    const today = ymd(new Date());
    for (const day of plan.days()) {
      const chip = clone('tpl-daychip');
      chip.dataset.day = day;
      chip.classList.toggle('today', day === today);
      fill(chip, { weekday: parseYmd(day).toLocaleDateString([], { weekday: 'short' }), day: parseYmd(day).getDate() });
      strip.append(chip);
    }
  }

  // --- the other views ---------------------------------------------------------------------------------------

  function openDecisions() {
    return state.tripLinks.filter((c) => c.done !== true);
  }
  function renderDecisions() {
    const body = $('body');
    body.replaceChildren();
    const groups = new Map();
    for (const c of openDecisions()) {
      const k = c.kindName || (c.module && c.module.name) || 'Other';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    }
    if (!groups.size) {
      const empty = clone('tpl-day-empty');
      empty.textContent = 'Nothing is waiting on anyone. Things linked to this trip that are still open appear here.';
      const ul = document.createElement('ul');
      ul.className = 'decisions';
      ul.append(empty);
      body.append(ul);
      return;
    }
    for (const [kind, cards] of groups) {
      const [title, list] = parts('tpl-decisions');
      title.textContent = kind;
      list.replaceChildren();
      for (const c of cards) {
        const row = clone('tpl-decision');
        setIcon(row.querySelector('[data-icon]'), c.module && c.module.icon);
        const w = cardWhen(c);
        const when = w ? `${parseYmd(w.day).toLocaleDateString([], { month: 'short', day: 'numeric' })}${w.time ? ' ' + w.time : ''}` : '';
        fill(row, { title: c.title, sub: [when, c.subtitle].filter(Boolean).join(' · ') });
        const btn = row.querySelector('[data-action="open"]');
        btn.textContent = 'Open';
        btn.dataset.ref = JSON.stringify(c.ref);
        hide(btn, !c.open);
        list.append(row);
      }
      body.append(title, list);
    }
  }

  // A list row in the style of the Decisions rows: an icon, a title and a line under it, and optionally a button.
  function row(list, { icon, title, sub, code, button, id }) {
    const r = clone('tpl-decision');
    setIcon(r.querySelector('[data-icon]'), icon);
    fill(r, { title, sub, code });
    const btn = r.querySelector('[data-action="open"]');
    if (button) { btn.textContent = button; btn.dataset.action = 'edit-item'; btn.dataset.id = id; } else btn.remove();
    list.append(r);
  }
  function section(body, title) {
    const [t, ul] = parts('tpl-decisions');
    t.textContent = title;
    ul.replaceChildren();
    body.append(t, ul);
    return ul;
  }
  const nothing = (body, text) => { const ul = document.createElement('ul'); ul.className = 'decisions'; const e = clone('tpl-day-empty'); e.textContent = text; ul.append(e); body.append(ul); };
  const dayTime = (i) => [i.date ? parseYmd(i.date).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) : 'no day yet', i.time].filter(Boolean).join(' ');

  // Bookings: the stays and journeys with their reference codes, in date order.
  function renderBookings() {
    const body = $('body');
    body.replaceChildren();
    const list = bookings(plan.list());
    if (!list.length) return nothing(body, 'No stays or journeys yet. Add one to a day and it is listed here with its booking reference.');
    for (const [kind, title] of [['stay', 'Stays'], ['journey', 'Journeys']]) {
      const mine = list.filter((i) => i.kind === kind);
      if (!mine.length) continue;
      const ul = section(body, title);
      for (const i of mine) {
        const nights = stayNights(i);
        const line = kind === 'stay'
          ? [dayTime(i), nights ? `${nights} night${nights === 1 ? '' : 's'}` : '', i.place || i.address].filter(Boolean).join(' · ')
          : [dayTime(i), [i.from, i.to].filter(Boolean).join(' → ')].filter(Boolean).join(' · ');
        row(ul, { icon: kind === 'stay' ? 'bed' : 'plane', title: i.title, sub: line, code: i.confirm, button: 'Open', id: i.id });
      }
    }
  }

  // Money: what was spent, who is owed what, and the fewest payments that settle it.
  const money = (n) => {
    const c = (plan.trip || {}).currency;
    try { return c ? new Intl.NumberFormat([], { style: 'currency', currency: c }).format(n) : n.toFixed(2); } catch (err) { return `${n.toFixed(2)} ${c}`; }
  };
  function renderMoney() {
    const body = $('body');
    body.replaceChildren();
    const costs = plan.list().filter((i) => i.cost);
    if (!costs.length) return nothing(body, 'Nothing has a cost yet. Give a stop, stay or journey a cost and who paid, and it is shared out here.');
    const keys = state.people.map((p) => p.key);
    const b = balances(costs, keys);
    const totals = section(body, `Total ${money(b.total)}`);
    for (const k of Object.keys(b.net)) {
      const n = b.net[k];
      row(totals, { icon: 'user', title: nameOf(k), sub: `paid ${money(b.paid[k])} · share ${money(b.share[k])} · ${n > 0 ? `is owed ${money(n)}` : n < 0 ? `owes ${money(-n)}` : 'all square'}` });
    }
    const settle = section(body, 'Settle up');
    if (!b.payments.length) row(settle, { icon: 'check', title: 'Everyone is square', sub: '' });
    for (const p of b.payments) row(settle, { icon: 'right-left', title: `${nameOf(p.from)} pays ${nameOf(p.to)}`, sub: money(p.amount) });
    const list = section(body, 'Costs');
    for (const i of costs.sort((x, y) => String(x.date).localeCompare(String(y.date)))) {
      row(list, { icon: 'receipt', title: i.title, sub: `${dayTime(i)} · paid by ${i.paidBy ? nameOf(i.paidBy) : 'nobody yet'}${i.owners.length ? ' · shared by ' + i.owners.map(nameOf).join(', ') : ' · shared by everyone'}`, button: money(i.cost), id: i.id });
    }
  }

  // --- the page ----------------------------------------------------------------------------------------------

  const facts = (trip) => {
    const days = plan.days();
    const parts2 = [[days.length, days.length === 1 ? 'day' : 'days'], [state.people.length, state.people.length === 1 ? 'traveller' : 'travellers'], [openDecisions().length, 'open']];
    return parts2.filter(([n]) => n).map(([n, label]) => [n, label]);
  };

  function renderHeader() {
    const trip = plan.trip;
    const head = $('trip');
    const days = plan.days();
    fill(head, { title: trip.title || trip.destination || 'Trip' });
    const a = parseYmd(trip.start);
    const b = parseYmd(trip.end || trip.start);
    const part = (d, o) => d.toLocaleDateString([], o);
    const same = a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
    const dates = trip.end && trip.end !== trip.start
      ? `${part(a, { weekday: 'short' })} ${a.getDate()}${same ? '' : ' ' + part(a, { month: 'short' })} – ${part(b, { weekday: 'short' })} ${b.getDate()} ${part(b, { month: 'short' })} ${b.getFullYear()}`
      : `${part(a, { weekday: 'short' })} ${a.getDate()} ${part(a, { month: 'short' })} ${a.getFullYear()}`;
    fill(head, { dates });
    const summary = slot(head, 'summary');
    summary.replaceChildren();
    for (const [n, label] of facts(trip)) {
      const s = document.createElement('span');
      const b2 = document.createElement('b');
      b2.textContent = String(n);
      s.append(b2, document.createTextNode(` ${label}`));
      summary.append(s);
    }
    for (const btn of head.querySelectorAll('[data-view]')) btn.classList.toggle('on', btn.dataset.view === state.view);
    const count = slot(head, 'decisions-count');
    count.textContent = String(openDecisions().length);
    hide(count, !openDecisions().length);
    hide(head.querySelector('[data-action="edit-trip"]'), !canEdit);
    void days;
  }

  // Keep what someone is typing in an add row through a redraw.
  function keepInputs() {
    const kept = [...root.querySelectorAll('.add-row')].map((f) => [f.dataset.day, f.elements.title.value]).filter(([, v]) => v);
    const active = root.activeElement && root.activeElement.closest && root.activeElement.closest('.add-row');
    return { kept, focus: active ? active.dataset.day : null, at: active ? active.elements.title.selectionStart : 0 };
  }
  function restoreInputs({ kept, focus, at }) {
    for (const [day, value] of kept) {
      const f = [...root.querySelectorAll('.add-row')].find((x) => x.dataset.day === day);
      if (f) f.elements.title.value = value;
    }
    if (focus !== null) {
      const f = [...root.querySelectorAll('.add-row')].find((x) => x.dataset.day === focus);
      if (f) { f.elements.title.focus(); try { f.elements.title.setSelectionRange(at, at); } catch (err) { /* not a text field */ } }
    }
  }

  let scrolled = false;
  function render() {
    const app = $('app');
    app.hidden = false;
    $('msg').hidden = true;
    if (!state.loaded) {
      $('trip').hidden = true;
      $('daystrip').hidden = true;
      $('body').replaceChildren(clone('tpl-state-loading'));
      return;
    }
    if (!plan.trip || !plan.days().length) {
      $('trip').hidden = true;
      $('daystrip').hidden = true;
      const s = clone('tpl-state-empty-trip');
      if (!canEdit) s.querySelector('[data-action="create-trip"]').remove();
      $('body').replaceChildren(s);
      return;
    }
    $('trip').hidden = false;
    const kept = keepInputs();
    const scroller = $('body');
    const top = scroller.scrollTop;
    renderHeader();
    if (state.view !== 'days') {
      $('daystrip').hidden = true;
      ({ decisions: renderDecisions, bookings: renderBookings, money: renderMoney })[state.view]();
    } else {
      $('daystrip').hidden = false;
      renderStrip();
      renderDays();
    }
    hydrate(root === document ? document.body : root);
    restoreInputs(kept);
    if (scrolled) scroller.scrollTop = top;
    else if (state.view === 'days') {
      scrolled = true;
      const today = $(`day-${ymd(new Date())}`) || $(`day-${plan.days()[0]}`);
      if (today) today.scrollIntoView({ inline: 'center', block: 'start' });
      markCurrent(today ? today.dataset.day : null);
    }
    loadLinks().catch(() => {});
  }
  let queued = false;
  const redraw = () => { if (queued) return; queued = true; Promise.resolve().then(() => { queued = false; render(); }); };

  function markCurrent(day) {
    if (day) state.currentDay = day;
    for (const c of root.querySelectorAll('.daychip')) c.classList.toggle('current', c.dataset.day === day);
  }
  $('body').addEventListener('scroll', () => {
    const days = [...root.querySelectorAll('.day[data-day]')].filter((d) => d.dataset.day);
    const top = $('body').getBoundingClientRect().top;
    const first = days.find((d) => d.getBoundingClientRect().bottom > top + 24);
    if (first) markCurrent(first.dataset.day);
  }, { passive: true });

  // What other modules link to each item and to the trip (only asked for what is shown, and once).
  const asked = new Set();
  async function loadLinks() {
    if (!tavern.refs || !tavern.refs.linksTo) return;
    let changed = false;
    if (!asked.has('trip')) {
      asked.add('trip');
      try { state.tripLinks = await tavern.refs.linksTo(tripRef()); changed = true; } catch (err) { state.tripLinks = []; }
    }
    for (const item of plan.list().slice(0, 60)) {
      if (asked.has(item.id)) continue;
      asked.add(item.id);
      try {
        const cards = await tavern.refs.linksTo(planRef(item.id));
        if (cards.length) { state.links.set(item.id, cards); changed = true; }
      } catch (err) { /* nothing links to it */ }
    }
    if (changed) redraw();
  }
  if (tavern.on) tavern.on('links', () => { asked.clear(); state.links.clear(); loadLinks().catch(() => {}); });

  // --- the item menu, and moving ------------------------------------------------------------------------------

  function menuDays() {
    return [...plan.days().map((d) => [d, dayShort(d)]), ['', 'Ideas (no day yet)']];
  }
  function openMenu(id, button) {
    const menu = $('item-menu');
    state.menuFor = id;
    const item = plan.list().find((i) => i.id === id);
    if (!item) return;
    const select = $('menu-day');
    select.replaceChildren(...menuDays().map(([value, label]) => { const o = document.createElement('option'); o.value = value; o.textContent = label; return o; }));
    select.value = plan.dayOf(item) || '';
    hide(menu.querySelector('[data-action="to-ideas"]'), !plan.dayOf(item));
    const follow = menu.querySelector('[data-action="follow"]');
    hide(follow, item.kind !== 'link');
    fill(follow, { 'follow-label': item.follow ? 'Stop following its result' : 'Follow its result' });
    const del = menu.querySelector('[data-action="delete"]');
    del.lastChild.textContent = ' Delete';
    state.deleteArmed = null;
    menu.hidden = false;
    const app = $('app').getBoundingClientRect();
    const b = button.getBoundingClientRect();
    menu.style.top = `${Math.round(b.bottom - app.top + 4)}px`;
    menu.style.left = `${Math.max(8, Math.min(Math.round(b.right - app.left - menu.offsetWidth), Math.round(app.width - menu.offsetWidth - 8)))}px`;
  }
  const closeMenu = () => { $('item-menu').hidden = true; state.menuFor = null; };

  async function attempt(fn) {
    note('');
    try {
      await fn();
    } catch (err) {
      note(err.conflict ? 'Someone changed that first; the newer version is shown.' : err.message);
    }
  }

  $('item-menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    const id = state.menuFor;
    if (!b || !id) return;
    const action = b.dataset.action;
    if (action === 'edit') { closeMenu(); return openItemEditor(id); }
    if (action === 'earlier' || action === 'later') { closeMenu(); return void attempt(() => plan.nudgeItem(id, action === 'earlier' ? -1 : 1)); }
    if (action === 'follow') {
      const item = plan.list().find((i) => i.id === id);
      closeMenu();
      return void attempt(() => plan.updateItem(id, { follow: !(item && item.follow) }));
    }
    if (action === 'to-ideas') { closeMenu(); return void attempt(() => plan.moveTo(id, null, 1e6)); }
    if (action === 'delete') {
      if (state.deleteArmed !== id) { state.deleteArmed = id; b.lastChild.textContent = ' Really delete?'; return; }
      closeMenu();
      return void attempt(() => plan.removeItem(id));
    }
  });
  $('menu-day').addEventListener('change', (e) => {
    const id = state.menuFor;
    const date = e.target.value || null;
    closeMenu();
    if (id) attempt(() => plan.moveTo(id, date, 1e6));
  });
  root.addEventListener('click', (e) => { if (!$('item-menu').hidden && !e.target.closest('#item-menu, [data-action="move-menu"]')) closeMenu(); });

  // --- dragging (desktop) --------------------------------------------------------------------------------------

  let dragId = null;
  let lastTarget = null;
  const clearDrop = () => {
    if (lastTarget) lastTarget.removeAttribute('data-drop');
    lastTarget = null;
    for (const d of root.querySelectorAll('.day.drop-target')) d.classList.remove('drop-target');
  };
  // The handle is the only drag source: an item becomes draggable only while it is pressed.
  root.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.item-handle');
    if (handle && canEdit) handle.closest('.item').draggable = true;
  });
  root.addEventListener('dragstart', (e) => {
    const li = e.target.closest && e.target.closest('.item[draggable="true"]');
    if (!li) return;
    dragId = li.dataset.id;
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
  });
  root.addEventListener('dragend', () => {
    for (const li of root.querySelectorAll('.item.dragging, .item[draggable="true"]')) { li.classList.remove('dragging'); li.draggable = false; }
    dragId = null;
    clearDrop();
  });
  root.addEventListener('dragover', (e) => {
    if (!dragId) return;
    const day = e.target.closest && e.target.closest('.day');
    if (!day) return;
    e.preventDefault();
    clearDrop();
    day.classList.add('drop-target');
    const over = e.target.closest('.item');
    if (over && over.dataset.id !== dragId) {
      const r = over.getBoundingClientRect();
      over.dataset.drop = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
      lastTarget = over;
    }
  });
  root.addEventListener('drop', (e) => {
    if (!dragId) return;
    e.preventDefault();
    const day = e.target.closest('.day');
    if (!day) return;
    const date = day.dataset.day || null;
    const over = e.target.closest('.item');
    const id = dragId;
    const dayUntimed = sortDay(plan.sortable().filter((i) => !i.time && plan.dayOf(i) === date && i.id !== id));
    let index = dayUntimed.length;
    if (over && over.dataset.id !== id) {
      const at = dayUntimed.findIndex((i) => i.id === over.dataset.id);
      if (at >= 0) index = at + (over.dataset.drop === 'after' ? 1 : 0);
    }
    clearDrop();
    attempt(() => plan.moveTo(id, date, index));
  });

  // Something from another module dropped on a day: put it on that day.
  if (tavern.refs && tavern.refs.dropTarget && canEdit) {
    const dayAt = (pt) => { const el = tavern.refs.elementAt(pt); return el && el.closest ? el.closest('.day') : null; };
    tavern.refs.dropTarget({
      over: (pt, ref) => {
        clearDrop();
        const day = ref && ref.module !== info.module.id ? dayAt(pt) : null;
        if (day) day.classList.add('drop-target');
      },
      leave: clearDrop,
      drop: (ref, pt) => {
        clearDrop();
        const day = ref && ref.module !== info.module.id ? dayAt(pt) : null;
        if (!day) return;
        const date = day.dataset.day || null;
        const over = tavern.refs.elementAt(pt);
        const li = over && over.closest ? over.closest('.item') : null;
        const target = li && li.dataset.id ? planRef(li.dataset.id) : null;
        attempt(async () => {
          // What can be done with it here: put it on the day, and (dropped on an item) whatever other modules offer to
          // do with an item of that kind and this one, filled from what is under the drop (the day, the item).
          const offers = [{ id: 'add', label: date ? `Put it on ${dayShort(date)}` : 'Keep it with the ideas', run: () => plan.addLink(ref, date) }];
          let actions = [];
          try { actions = await tavern.actions.list({ accepts: ref.module + ':' + ref.kind }); } catch (err) { actions = []; }
          for (const a of actions) {
            const input = {};
            let ok = true;
            let dropped = false;
            for (const [field, type] of Object.entries(a.input)) {
              const optional = type.endsWith('?');
              const base = optional ? type.slice(0, -1) : type;
              if (base === 'ref:' + ref.module + ':' + ref.kind) { input[field] = ref; dropped = true; } else if (base === 'ref' && target) input[field] = target; else if (base === 'date' && date) input[field] = date; else if (!optional) ok = false;
            }
            if (ok && dropped && target) offers.push({ id: a.action, label: a.label, hint: a.moduleName, run: () => tavern.actions.request(a.action, input) });
          }
          const chosen = await tavern.actions.pick(offers, pt, { remember: `${ref.module}:${ref.kind}:${target ? 'item' : 'day'}` });
          if (chosen) await chosen.run();
          note('');
        });
      },
    });
  }

  // An item of the trip can be dragged out to another module (a task links to it): pressing its body and moving. The
  // handle is the other drag (reordering), so a press there is left alone.
  if (tavern.refs && tavern.refs.draggable) {
    tavern.refs.draggable(root, (target) => {
      const li = target.closest && target.closest('.item');
      if (!li || !li.dataset.id || target.closest('.item-handle, .item-menu, button, input, select, textarea, a')) return null;
      const item = plan.list().find((i) => i.id === li.dataset.id);
      return item ? { kind: 'plan', id: item.id, label: item.title || 'Trip item' } : null;
    });
  }

  // An item that follows another module's item (a poll): when that item reports how it turned out, keep the result on
  // the item and, when it says which day, put a stop there. Whichever page records it first does it, once.
  if (tavern.events && tavern.events.subscribe) {
    tavern.events.subscribe(async (e) => {
      const summary = e.data && typeof e.data.summary === 'string' ? e.data.summary.slice(0, 200) : '';
      if (!e.ref || !summary) return;
      const k = tavern.util.refKey(e.ref);
      for (const item of plan.list().filter((i) => i.kind === 'link' && i.follow && i.ref && tavern.util.refKey(i.ref) === k)) {
        const fired = Number(e.id) || Date.now();
        if (item.fired === fired) continue;
        try { await plan.updateItem(item.id, { result: summary, fired }); } catch (err) { continue; }
        const date = e.data.date && /^\d{4}-\d{2}-\d{2}$/.test(String(e.data.date)) ? String(e.data.date) : null;
        try {
          if (e.data.pick && e.data.pick.module) await plan.addLink(e.data.pick, date);
          else if (date) await plan.addItem({ kind: 'stop', title: summary, date, notes: `From ${item.title || 'a linked item'}` });
        } catch (err) { /* the result is kept either way */ }
      }
    });
  }

  // --- the editor ---------------------------------------------------------------------------------------------

  const KIND_TABS = ['stop', 'stay', 'journey', 'note'];
  function showKind(kind) {
    for (const b of $('f-kinds').querySelectorAll('[data-kind]')) b.classList.toggle('on', b.dataset.kind === kind);
    for (const el of $('form').querySelectorAll('[data-kinds]')) el.hidden = !el.dataset.kinds.split(/\s+/).includes(kind);
    state.editing.kind = kind;
  }
  function dayOptions(select, { ideas, after }) {
    select.replaceChildren();
    if (ideas) { const o = document.createElement('option'); o.value = ''; o.textContent = 'Not on a day yet'; select.append(o); }
    for (const d of plan.days()) {
      if (after && d <= after) continue;
      const o = document.createElement('option');
      o.value = d;
      o.textContent = dayShort(d);
      select.append(o);
    }
  }
  function ownerBoxes(selected) {
    const box = $('f-owners');
    box.replaceChildren();
    for (const p of state.people) {
      const label = document.createElement('label');
      label.className = 'check';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = p.key;
      input.checked = selected.includes(p.key);
      label.append(input, document.createTextNode(` ${p.name}`));
      box.append(label);
    }
  }
  function paidByOptions(selected) {
    const select = $('f-paidby');
    select.replaceChildren(...[{ key: '', name: 'Nobody yet' }, ...state.people].map((p) => { const o = document.createElement('option'); o.value = p.key; o.textContent = p.name; return o; }));
    select.value = selected || '';
  }
  const val = (id) => $(id).value.trim();
  function openEditor(mode, item, day) {
    if (!canEdit) return;
    state.editing = { mode, id: item ? item.id : null, kind: 'stop', day: day || null, version: item ? plan.versionOf(item.id) : null };
    $('f-error').hidden = true;
    $('f-delete').hidden = mode === 'trip' || !item;
    if (mode === 'trip') {
      const t = plan.trip || {};
      $('editor-title').textContent = plan.trip ? 'Edit the trip' : 'Plan a trip';
      hide($('f-kinds'), true);
      showKind('trip');
      $('f-title').value = t.title || '';
      $('f-destination').value = t.destination || '';
      $('f-start').value = t.start || '';
      $('f-end').value = t.end || '';
      $('f-currency').value = t.currency || '';
      $('f-notes').value = t.notes || '';
      $('f-by').textContent = '';
    } else {
      const kind = item ? (item.kind === 'link' ? 'stop' : item.kind) : 'stop';
      $('editor-title').textContent = item ? 'Edit' : 'Add to the plan';
      hide($('f-kinds'), Boolean(item));
      showKind(kind);
      dayOptions($('f-date'), { ideas: true });
      $('f-date').value = item ? item.date || '' : day || '';
      $('f-time').value = item ? item.time || '' : '';
      $('f-minutes').value = item && item.minutes ? item.minutes : '';
      dayOptions($('f-checkout'), { ideas: true, after: item ? item.date : day });
      $('f-checkout').value = item ? item.checkOut || '' : '';
      $('f-title').value = item ? item.title : '';
      $('f-from').value = item ? item.from : '';
      $('f-to').value = item ? item.to : '';
      $('f-category').value = item ? item.category : 'do';
      $('f-place').value = item ? item.place : '';
      $('f-address').value = item ? item.address : '';
      $('f-confirm').value = item ? item.confirm : '';
      $('f-notes').value = item ? item.notes : '';
      $('f-cost').value = item && item.cost ? item.cost : '';
      paidByOptions(item ? item.paidBy : info.user.key);
      $('f-done').checked = item ? item.done : false;
      ownerBoxes(item ? item.owners : []);
      $('f-by').textContent = item && item.by ? `Added by ${item.by}` : '';
    }
    $('editor').hidden = false;
    $('f-title').focus();
  }
  const openItemEditor = (id) => { const item = plan.list().find((i) => i.id === id); if (item) openEditor('item', item); };
  const closeEditor = () => { $('editor').hidden = true; state.editing = null; };
  $('f-cancel').addEventListener('click', closeEditor);
  $('editor').addEventListener('click', (e) => { if (e.target === $('editor')) closeEditor(); });
  $('f-kinds').addEventListener('click', (e) => { const b = e.target.closest('[data-kind]'); if (b && KIND_TABS.includes(b.dataset.kind)) showKind(b.dataset.kind); });
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!$('editor').hidden) closeEditor(); else closeMenu(); } });

  async function saveEditor() {
    const ed = state.editing;
    if (!ed) return;
    const fail = (text) => { $('f-error').textContent = text; $('f-error').hidden = false; };
    $('f-error').hidden = true;
    $('f-save').disabled = true;
    try {
      if (ed.mode === 'trip') {
        if (!$('f-start').value) return fail('Give the trip a first day.');
        if ($('f-end').value && $('f-end').value < $('f-start').value) return fail('The last day is before the first.');
        await plan.saveTrip({ title: val('f-title'), destination: val('f-destination'), start: $('f-start').value, end: $('f-end').value || $('f-start').value, currency: val('f-currency'), notes: $('f-notes').value.trim() });
        scrolled = false;
        plan.suggest().catch(() => {});
        return closeEditor();
      }
      const kind = ed.kind;
      const item = ed.id ? plan.list().find((i) => i.id === ed.id) : null;
      if (kind !== 'link' && !val('f-title')) return fail('Give it a title.');
      const fields = {
        kind: item && item.kind === 'link' ? 'link' : kind,
        title: val('f-title'),
        date: $('f-date').value || null,
        time: kind === 'note' ? null : $('f-time').value || null,
        minutes: kind === 'stop' && $('f-minutes').value ? Number($('f-minutes').value) : null,
        checkOut: kind === 'stay' ? $('f-checkout').value || null : null,
        category: kind === 'stay' ? 'stay' : kind === 'journey' ? 'travel' : kind === 'note' ? 'other' : $('f-category').value,
        place: val('f-place'),
        address: val('f-address'),
        confirm: val('f-confirm'),
        from: val('f-from'),
        to: val('f-to'),
        notes: $('f-notes').value.trim(),
        done: $('f-done').checked,
        cost: $('f-cost').value ? Number($('f-cost').value) : null,
        paidBy: $('f-cost').value ? $('f-paidby').value : '',
        owners: [...$('f-owners').querySelectorAll('input:checked')].map((i) => i.value),
      };
      if (item) {
        try {
          // Someone changed it since this editor opened (the change has already arrived): do not write over it.
          if (plan.versionOf(item.id) !== ed.version) throw Object.assign(new Error('changed'), { conflict: true });
          await plan.updateItem(item.id, fields);
        } catch (err) {
          if (!err.conflict) throw err;
          state.conflicts.set(item.id, { patch: fields });
          closeEditor();
          return redraw();
        }
      } else {
        await plan.addItem(fields);
      }
      closeEditor();
    } catch (err) {
      fail(err.message);
    } finally {
      $('f-save').disabled = false;
    }
  }
  $('form').addEventListener('submit', (e) => { e.preventDefault(); saveEditor(); });
  let deleteArmedInEditor = false;
  $('f-delete').addEventListener('click', async () => {
    const ed = state.editing;
    if (!ed || !ed.id) return;
    if (!deleteArmedInEditor) {
      deleteArmedInEditor = true;
      $('f-delete').textContent = 'Really delete?';
      setTimeout(() => { deleteArmedInEditor = false; $('f-delete').textContent = 'Delete'; }, 4000);
      return;
    }
    deleteArmedInEditor = false;
    $('f-delete').textContent = 'Delete';
    const id = ed.id;
    closeEditor();
    attempt(() => plan.removeItem(id));
  });

  // --- clicks and adding ---------------------------------------------------------------------------------------

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action], [data-view]');
    if (!b) return;
    if (b.dataset.view) {
      state.view = b.dataset.view;
      scrolled = state.view !== 'days';
      return redraw();
    }
    const action = b.dataset.action;
    const li = b.closest('.item');
    if (action === 'goto-day') {
      const target = $(`day-${b.dataset.day}`);
      if (target) { target.scrollIntoView({ inline: 'center', block: 'start' }); markCurrent(b.dataset.day); }
    } else if (action === 'move-menu' && li) {
      openMenu(li.dataset.id, b);
    } else if (action === 'open') {
      const item = li ? plan.list().find((i) => i.id === li.dataset.id) : null;
      const ref = item && item.ref ? item.ref : b.dataset.ref ? JSON.parse(b.dataset.ref) : null;
      if (ref) tavern.refs.open(ref).catch((err) => note(err.message));
    } else if (action === 'edit-item') {
      openItemEditor(b.dataset.id);
    } else if (action === 'edit-trip' || action === 'create-trip') {
      openEditor('trip');
    } else if (action === 'use-theirs' && li) {
      state.conflicts.delete(li.dataset.id);
      redraw();
    } else if (action === 'keep-mine' && li) {
      const c = state.conflicts.get(li.dataset.id);
      if (!c) return;
      attempt(async () => { await plan.updateItem(li.dataset.id, c.patch); state.conflicts.delete(li.dataset.id); redraw(); });
    } else if (action === 'add-suggestion') {
      const s = b.closest('.suggestion');
      const day = b.closest('.day');
      if (s && day) attempt(async () => { await plan.addLink(JSON.parse(s.dataset.ref), day.dataset.day || null); await plan.suggest(); });
    }
  });

  // The add row: a title (and a time, if typed: "dinner at 7pm") on that day.
  root.addEventListener('submit', (e) => {
    const form = e.target.closest('.add-row');
    if (!form) return;
    e.preventDefault();
    const text = form.elements.title.value.trim();
    if (!text) return openEditor('item', null, form.dataset.day || null);
    const parsed = tavern.util.parseWhen ? tavern.util.parseWhen(text) : { title: text };
    form.elements.title.value = '';
    attempt(() => plan.addItem({ kind: 'stop', title: parsed.title || text, date: form.dataset.day || null, time: parsed.time || null }));
  });

  // --- what other modules may ask, and the first load ---------------------------------------------------------

  // The shared bar at the bottom of the pane (as the To-do, Polls and Calendar have): what is typed becomes a stop on the day
  // in view, or on the day it names when that is a day of the trip.
  const defaultDay = () => {
    const days = plan.days();
    const today = ymd(new Date());
    return days.includes(state.currentDay) ? state.currentDay : days.includes(today) ? today : days[0] || null;
  };
  if (tavern.bar) {
    tavern.bar.set(canEdit ? [{ id: 'add', type: 'quickadd', label: 'Add to the plan', placeholder: 'Add to the trip: lunch at noon' }] : []).catch(() => { state.hosted = false; redraw(); });
    tavern.on('bar', (e) => {
      if (e.id !== 'add' || !canEdit) return;
      if (!plan.days().length) return openEditor('trip');
      const day = defaultDay();
      if (!e.value) return openEditor('item', null, day);
      const parsed = tavern.util.parseWhen ? tavern.util.parseWhen(e.value) : { title: e.value };
      const named = parsed.date && plan.days().includes(parsed.date) ? parsed.date : day;
      attempt(() => plan.addItem({ kind: 'stop', title: parsed.title || e.value, date: named, time: parsed.time || null }));
    });
  }

  // The pane's width, not the window's: a bundled module runs in the page, so a media query would follow the window. The
  // stylesheet keys its narrow layout on `.app.narrow`. A frame can report no width while it is laid out, so wait for one.
  const fit = () => {
    const w = tavern.rootElement.clientWidth;
    if (w) $('app').classList.toggle('narrow', w < 720);
  };
  fit();
  new ResizeObserver(fit).observe(tavern.rootElement);

  plan.provide();
  plan.subscribe(() => { if (state.loaded) redraw(); });
  render();
  try {
    await plan.load();
    state.people = await tavern.people().catch(() => []);
    state.loaded = true;
    // Warm the icons the page draws, so the first draw is not empty.
    await Promise.all([...new Set([...root.querySelectorAll('template')].flatMap((t) => [...t.content.querySelectorAll('[data-icon]')].map((n) => n.dataset.icon)).concat(Object.values(CAT_ICON), [...root.querySelectorAll('[data-icon]')].map((n) => n.dataset.icon)))].filter(Boolean).map(wantIcon));
    redraw();
    plan.suggest().catch(() => {});
    hydrate(root === document ? document.body : root);
  } catch (err) {
    $('app').hidden = true;
    $('msg').hidden = false;
    $('msg').textContent = 'The trip could not load: ' + err.message;
  }
})();
