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
    $('msg').textContent = 'Planner could not start: ' + err.message;
    return;
  }
  if (info.context.scope !== 'room') {
    $('msg').textContent = 'A trip belongs to a room. Open the room, then Planner from its panes; the dashboard lists your trips.';
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
    markerTypes: [],
    hideEmpty: (() => { try { return localStorage.getItem('planner-hide-empty') === '1'; } catch (err) { return false; } })(), // per person, off by default
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

  // --- one entry of a day: a row with its card ---------------------------------------------------------------------

  const LEG_MODES = Object.keys(LEG_ICONS);
  function ownersInto(el, item) {
    const box = slot(el, 'owners');
    if (!box) return;
    box.textContent = '';
    hide(box, !item.owners.length);
    for (const key of item.owners) { const o = clone('tpl-owner'); o.textContent = initial(key); box.append(o); }
    box.setAttribute('title', item.owners.map(nameOf).join(', '));
  }
  const words = (n, one, many) => (n ? `${n} ${n === 1 ? one : many}` : '');
  // Fill the slots named in `values`; a slot with no value hides, and so does a wrapper whose only content it was.
  function put(el, values) {
    fill(el, values);
    for (const w of el.querySelectorAll('[data-slot$="-wrap"]')) {
      const name = w.dataset.slot.replace(/-wrap$/, '');
      const inner = slot(el, name === 'class' ? 'travelClass' : name);
      w.hidden = !inner || inner.hidden;
    }
  }

  // Why a linked item cannot be drawn from its card: 'gone' (deleted), 'hidden' (this viewer may not see it), 'unavailable'
  // (it could not be read just now), or '' when it can.
  const linkState = (card) => (card && card.error ? card.state || 'unavailable' : '');

  // The card for an item, by its type (see cardOf in the model), filled by slot name.
  function buildCard(entry, kind, card) {
    const { item, span } = entry;
    const c = cardOf(item, card);
    const el = clone(`tpl-card-${span === 'middle' ? 'hotel-mid' : span === 'end' ? 'hotel-out' : c.card}`);
    const arrive = item.time && item.minutes ? hm(minutesOfDay(item.time) + item.minutes) : '';
    const duration = lengthText(item.minutes);
    const where = item.place || item.address;
    const badge = el.querySelector('.badge [data-icon]');
    if (badge && c.badge && !badge.dataset.icon) setIcon(badge, c.badge);
    if (c.card === 'flight') {
      put(el, { title: [item.operator, item.number].filter(Boolean).join(' ') || item.title, fromCode: item.fromCode, toCode: item.toCode, from: item.from, to: item.to, time: item.time, arrival: arrive, duration, seat: item.seat, gate: item.gate, travelClass: item.travelClass });
    } else if (c.card === 'train') {
      put(el, { title: [item.operator, item.number].filter(Boolean).join(' ') || item.title, from: item.from, to: item.to, time: item.time, arrival: arrive, platform: item.platform ? `Platform ${item.platform}` : '', seat: [item.carriage && `Car ${item.carriage}`, item.seat && `Seat ${item.seat}`].filter(Boolean).join(' · '), duration, confirm: item.confirm });
    } else if (c.card === 'transit') {
      const to = item.to || item.dropoff || '';
      put(el, { kicker: [c.kicker, item.operator].filter(Boolean).join(' · '), title: item.title, time: item.time, to, confirm: item.confirm });
      const go = el.querySelector('.go');
      if (go && !item.time && !to && !item.confirm) go.hidden = true;
    } else if (c.card === 'hotel' && span !== 'end' && span !== 'middle') {
      const nights = stayNights(item);
      put(el, { kicker: c.kicker, title: item.title, address: where, nights: words(nights, 'night', 'nights'), checkin: [item.date && dayShort(item.date), item.time].filter(Boolean).join(' · '), checkout: item.checkOut ? dayShort(item.checkOut) : '', roomType: item.roomType, guests: words(item.guests, 'guest', 'guests'), confirm: item.confirm });
    } else if (span === 'end') {
      put(el, { title: item.title, address: where, time: item.checkOutTime || '', nights: words(stayNights(item), 'night', 'nights') });
    } else if (span === 'middle') {
      put(el, { title: `Staying at ${item.title}` });
    } else if (c.card === 'meal') {
      setIcon(el.querySelector('.badge [data-icon]'), c.badge);
      put(el, { kicker: c.kicker, title: item.title, address: where, partySize: item.partySize ? `Table for ${item.partySize}` : '', reservationName: item.reservationName ? `under ${item.reservationName}` : '', time: item.time, minutes: duration });
    } else if (c.card === 'activity') {
      setIcon(el.querySelector('.badge [data-icon]'), c.badge);
      put(el, { kicker: c.kicker, title: item.title, address: where, minutes: duration, admissionCount: words(item.admissionCount, 'ticket', 'tickets'), confirm: item.confirm });
    } else if (c.card === 'show') {
      put(el, { kicker: c.kicker, title: item.title, address: where, gate: item.gate ? `Gate ${item.gate}` : '', confirm: item.confirm, admissionCount: item.admissionCount ? String(item.admissionCount) : '', time: item.time });
    } else if (c.card === 'block') {
      const type = markerType(item.type);
      el.dataset.type = item.type;
      setIcon(el.querySelector('.mk-icon [data-icon]'), type.icon);
      colourPill(el, type);
      put(el, { title: item.title || type.label, minutes: duration, body: item.notes });
    } else if (c.card === 'note') {
      put(el, { title: item.title, body: item.notes });
    } else if (c.card === 'place') {
      put(el, { title: card.title || item.title, address: card.subtitle });
    } else {
      // What the linked item says now (never a copy kept here), or, when it cannot be read, why: it is gone, or this viewer may not
      // see it. Either way nothing opens an editor for it, and it can be removed from the plan.
      const stateOf = linkState(card);
      const broken = Boolean(stateOf);
      setIcon(el.querySelector('.src [data-icon]'), broken ? 'link-slash' : (card && card.module && card.module.icon) || 'link');
      const shown = stateOf === 'hidden' ? 'An item you cannot see' : stateOf ? item.title || 'An item' : (card && card.title) || item.title;
      put(el, { module: broken || !card ? 'another module' : (card.module && card.module.name) || 'another module', title: shown, sub: broken ? '' : item.result ? `Result: ${item.result}` : card ? card.subtitle : '', state: stateOf === 'hidden' ? 'Not available to you' : stateOf === 'gone' ? 'No longer available' : stateOf === 'unavailable' ? 'Could not be read right now' : '' });
      if (broken) el.classList.add(stateOf === 'hidden' ? 'hidden' : 'gone');
      hide(el.querySelector('[data-action="open"]'), broken || !card || !card.open);
      hide(el.querySelector('[data-action="remove-link"]'), !broken || !canEdit);
    }
    ownersInto(el, item);
    if (!canEdit) el.querySelector('.menu-btn')?.remove();
    return el;
  }

  // `entry` is { item, span } (a stay is drawn on each night it covers; only its first day is the real item).
  function buildEntry(entry) {
    const { item, span } = entry;
    const card = item.ref ? plan.cards.get(tavern.util.refKey(item.ref)) : null;
    const c = cardOf(item, card);
    const row = clone('tpl-row');
    row.dataset.id = item.id;
    row.dataset.kind = item.kind;
    row.dataset.type = c.family;
    row.classList.toggle('done', item.done);
    let time = item.time || '';
    let sub = '';
    if (item.kind === 'link') { time = timeOf(card); sub = ''; }
    else if (item.kind === 'stay') { time = span === 'end' ? item.checkOutTime || '' : span === 'middle' ? '' : item.time || ''; sub = span === 'end' ? 'check out' : span === 'middle' ? '' : 'check in'; }
    else if (item.kind === 'journey') sub = item.time && item.minutes ? `→ ${hm(minutesOfDay(item.time) + item.minutes)}` : '';
    else sub = lengthText(item.minutes);
    fill(row, { time, sub });
    row.querySelector('.slot').append(buildCard(entry, item.kind, card));
    if (state.conflicts.has(item.id)) {
      row.classList.add('conflict');
      const bar = clone('tpl-conflict');
      fill(bar, { text: 'Someone changed this while you were editing.' });
      row.querySelector('.slot').append(bar);
    }
    return row;
  }

  // The way to a stop, drawn between it and the one before when the person has said how (and how long).
  function buildLeg(item) {
    if (!item.travelMode || item.travelMode === 'none' || !LEG_MODES.includes(item.travelMode)) return null;
    const row = clone('tpl-leg-row');
    row.dataset.id = item.id;
    const button = row.querySelector('.leg');
    button.dataset.mode = item.travelMode;
    setIcon(button.querySelector('[data-icon]'), LEG_ICONS[item.travelMode]);
    fill(row, { minutes: item.travelMinutes ? lengthText(item.travelMinutes) : '', dist: '' });
    if (!canEdit) button.disabled = true;
    return row;
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

  // "10:05 – 23:30 · 6 stops · 1 h 24 min getting around": the first and last time, how many stops, and the time spent getting between them.
  function daySummary(entries) {
    const own = entries.filter((e) => (!e.span || e.span === 'start') && e.item.kind !== 'block');
    const times = own.map((e) => e.item.time).filter(Boolean).sort();
    const range = times.length ? (times.length > 1 && times[0] !== times[times.length - 1] ? `${times[0]} – ${times[times.length - 1]}` : times[0]) : '';
    const around = own.reduce((sum, e) => sum + (e.item.travelMode && e.item.travelMode !== 'none' && e.item.travelMinutes ? e.item.travelMinutes : 0), 0);
    return [range, words(own.length, 'stop', 'stops'), around ? `${lengthText(around)} getting around` : ''].filter(Boolean).join(' · ');
  }

  // The marker types (a setting an admin edits): the four automatic ones and the time blocks people add. Until it is read, or if it
  // cannot be, these stand.
  const AUTOMATIC = ['planning-start', 'planning-end', 'trip-start', 'trip-end'];
  const DEFAULT_MARKER_TYPES = [
    { id: 'planning-start', label: 'Planning starts', icon: 'flag', color: '#3b82f6' },
    { id: 'planning-end', label: 'Planning ends', icon: 'flag-checkered', color: '#8b5cf6' },
    { id: 'trip-start', label: 'Trip starts', icon: 'plane-departure', color: '#22c55e' },
    { id: 'trip-end', label: 'Trip ends', icon: 'plane-arrival', color: '#f97316' },
    { id: 'free-time', label: 'Free time', icon: 'face-smile', color: '#14b8a6' },
    { id: 'rest', label: 'Rest', icon: 'moon', color: '#6366f1' },
    { id: 'buffer', label: 'Buffer', icon: 'hourglass-half', color: '#a3a3a3' },
    { id: 'meet-up', label: 'Meet-up', icon: 'users', color: '#ec4899' },
    { id: 'leave-by', label: 'Leave by', icon: 'clock', color: '#eab308' },
  ];
  const markerType = (id) => state.markerTypes.find((t) => t.id === id) || DEFAULT_MARKER_TYPES.find((t) => t.id === id) || { id, label: id, icon: 'clock', color: '#888888' };
  const blockTypes = () => state.markerTypes.filter((t) => !AUTOMATIC.includes(t.id));
  function useMarkerTypes(values) {
    const list = values && Array.isArray(values.markers) && values.markers.length ? values.markers : DEFAULT_MARKER_TYPES;
    state.markerTypes = list.filter((t) => t && typeof t.id === 'string' && /^#[0-9a-f]{6}$/i.test(t.color || ''));
    if (!state.markerTypes.length) state.markerTypes = DEFAULT_MARKER_TYPES;
  }
  // A marker's one colour: on the pill as a custom property, which gives the border and both cells.
  const colourPill = (el, type) => { if (el) el.style.setProperty('--marker', type.color); };
  function buildMarker(kind, time, sub) {
    const type = markerType(kind);
    const row = clone('tpl-row-marker');
    row.dataset.marker = kind;
    setIcon(row.querySelector('.markercard [data-icon]'), type.icon);
    // `mdate` repeats `time` (a date, for these plan-wide markers) inside the pill: on a phone, where the pill
    // is the whole row and .when's own column has nowhere to sit beside it, the stylesheet shows this instead
    // and hides .when, so the date stays with the box it is about rather than stranded above it.
    fill(row, { time, mdate: time, title: type.label, sub });
    colourPill(row.querySelector('.markerpill'), type);
    return row;
  }
  // The markers of the whole plan, on the main timeline between the day blocks (not inside a day): the plan's ends above the first day
  // and below the last, and the trip's start above the day it begins and its end below the day it ends.
  function timelineMarkers(day, position, days, by) {
    const bounds = state.bounds;
    const rows = [];
    const dateText = (d) => parseYmd(d).toLocaleDateString([], { weekday: 'short', day: 'numeric' });
    const itemOf = (id) => plan.list().find((i) => i.id === id);
    if (position === 'before') {
      if (day === days[0]) rows.push(buildMarker('planning-start', dateText(day), 'the plan begins'));
      if (bounds && bounds.start.day === day) rows.push(buildMarker('trip-start', bounds.start.time, describe(itemOf(bounds.start.id) || {})));
    } else {
      if (bounds && bounds.end.day === day) rows.push(buildMarker('trip-end', bounds.end.time, describe(itemOf(bounds.end.id) || {})));
      if (day === days[days.length - 1]) rows.push(buildMarker('planning-end', dateText(day), 'the plan ends'));
    }
    if (!rows.length) return null;
    const list = document.createElement('ol');
    list.className = 'timeline ends';
    list.dataset.ends = position;
    list.append(...rows);
    return list;
  }

  // A short name for an item, for a marker's line.
  const describe = (item) => (item.kind === 'journey' && [item.operator, item.number].filter(Boolean).join(' ')) || item.title;

  function buildDay(day, index, days, by) {
    const el = clone('tpl-day2');
    const ideas = day === null;
    el.id = ideas ? 'day-ideas' : `day-${day}`;
    el.dataset.day = ideas ? '' : day;
    if (!ideas) el.dataset.index = String(index + 1);
    el.classList.toggle('today', !ideas && day === ymd(new Date()));
    const entries = ideas ? (by.get(null) || []).map((item) => ({ item })) : entriesFor(day, days, by);
    const head = clone('tpl-day-head');
    if (ideas) fill(head, { daynum: '', daymonth: 'Ideas', position: 'Ideas', summary: 'not on a day yet' });
    else {
      const d = parseYmd(day);
      fill(head, { daynum: String(d.getDate()), daymonth: `${d.toLocaleDateString([], { weekday: 'short' })} · ${d.toLocaleDateString([], { month: 'short' })}`, position: dayLabel(day, days).position, summary: daySummary(entries) });
    }
    el.prepend(head);
    const list = el.querySelector('.timeline');
    if (!entries.length) {
      const empty = clone('tpl-day-empty');
      empty.textContent = ideas ? 'Ideas with no day yet wait here.' : 'Nothing planned yet. Add something below.';
      list.append(empty);
    }
    // The plan's own ends, and where the trip itself starts and ends (the first and last booked item). Markers are drawn, never stored:
    // they have no id, no menu and no handle, and are not counted as something planned.
    entries.forEach((entry, i) => {
      const prev = entries[i - 1];
      const covers = (e) => e && (e.span === 'middle' || e.span === 'end');
      if (i && !covers(entry) && !covers(prev)) { const leg = buildLeg(entry.item); if (leg) list.append(leg); }
      list.append(buildEntry(entry));
    });
    if (!ideas && !entries.length) el.classList.add('is-empty');
    // The days the trip itself covers (from the first booked item to the last) are marked, for their badge.
    const b = state.bounds;
    if (!ideas && b && day >= b.start.day && day <= b.end.day) el.classList.add('in-trip');
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

  // Days with nothing on them (a stay that covers a night counts; markers do not).
  const emptyDays = () => { const days = plan.days(); const by = plan.byDay(); return new Set(days.filter((d) => !entriesFor(d, days, by).length)); };

  // A marker between the days (a `lane`), on the plan's line.
  function buildLane(item) {
    const type = markerType(item.type);
    const row = clone('tpl-row-lane');
    row.dataset.id = item.id;
    row.dataset.type = item.type;
    setIcon(row.querySelector('.mk-icon [data-icon]'), type.icon);
    fill(row, { title: item.title || type.label, body: item.notes });
    colourPill(row.querySelector('.markerpill'), type);
    if (!canEdit) row.querySelector('.menu-btn')?.remove();
    return row;
  }
  // The markers between two days (`after` is the day before them; none is before the first day), and the + where a new one goes.
  function buildBetween(after) {
    const mine = plan.lanes().filter((l) => (l.after || null) === after);
    const out = [];
    if (mine.length) {
      const list = document.createElement('ol');
      list.className = 'timeline between';
      list.dataset.after = after || '';
      list.append(...mine.map(buildLane));
      out.push(list);
    }
    if (canEdit) {
      const joint = clone('tpl-joint');
      joint.dataset.after = after || '';
      out.push(joint);
    }
    return out;
  }

  // The badge for a run of hidden days: how many, and a + for what can be added there.
  function buildGap(run) {
    const el = clone('tpl-gap');
    el.dataset.from = run[0];
    el.dataset.to = run[run.length - 1];
    fill(el, { count: String(run.length) });
    const count = slot(el, 'count');
    if (count) count.title = `${run.length} day${run.length === 1 ? '' : 's'} between`;
    if (!canEdit) hide(el.querySelector('[data-action="gap-add"]'), true);
    return el;
  }
  // The menu on a gap's +: a time block of each type on the first hidden day, or show the days.
  function openGapMenu(button) {
    // Where a marker would go: after this day (none: before the first day). A joint says so; a badge for hidden days is at the joint
    // before its first hidden day.
    const gap = button.closest('.gap');
    const joint = button.closest('.joint');
    const allDays = plan.days();
    const after = joint ? joint.dataset.after || null : allDays[allDays.indexOf(gap.dataset.from) - 1] || null;
    const items = blockTypes().map((t) => ({
      id: `add-${t.id}`,
      label: `Add ${t.label.toLowerCase()}`,
      icon: t.icon,
      iconColor: t.color || undefined,
      onClick: () => attempt(() => plan.addItem({ kind: 'lane', type: t.id, title: t.label, after })),
    }));
    if (gap) {
      items.push({
        id: 'show-days',
        label: 'Show these days',
        icon: 'eye',
        onClick: () => {
          state.hideEmpty = false;
          try { localStorage.setItem('planner-hide-empty', '0'); } catch (err) { /* not remembered */ }
          redraw();
        },
      });
    }
    tavern.menu.show({ id: `gap-${after || 'start'}`, anchor: button, items });
  }

  // The button (and its small form) to add days before the first day or after the last.
  function buildEdge(where) {
    const el = clone('tpl-dayedge');
    el.dataset.edge = where;
    fill(el, { label: where === 'before' ? 'Add days before' : 'Add days after' });
    const input = el.querySelector('input[name="count"]');
    input.max = String(Math.max(1, Math.min(30, MAX_DAYS - plan.days().length)));
    el.querySelector('.edge-form').noValidate = true; // too many is said in the page's note, not by the browser
    return el;
  }
  // Moving the plan's first day back or its last day forward, through the same save as Edit trip.
  function addDays(where, count) {
    const trip = plan.trip;
    const room = MAX_DAYS - plan.days().length;
    if (!(count >= 1)) return;
    if (count > room) { note(room > 0 ? `A plan can be at most ${MAX_DAYS} days long, so at most ${room} more can be added.` : `A plan can be at most ${MAX_DAYS} days long.`); return; }
    const shift = (day, n) => { const d = parseYmd(day); return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)); };
    const start = where === 'before' ? shift(trip.start, -count) : trip.start;
    const end = where === 'after' ? shift(trip.end || trip.start, count) : trip.end || trip.start;
    attempt(async () => { await plan.saveTrip({ ...trip, start, end }); scrolled = true; });
  }

  function renderDays() {
    const days = plan.days();
    const by = plan.byDay();
    const wrap = document.createElement('div');
    wrap.id = 'days';
    wrap.className = 'days';
    state.bounds = tripBounds(plan.list());
    const empties = emptyDays();
    // Empty days can be hidden, unless every day is empty (then there would be nothing to show).
    const hiding = state.hideEmpty && empties.size > 0 && empties.size < days.length;
    $('app').classList.toggle('hide-empty', hiding);
    if (canEdit) wrap.append(buildEdge('before'));
    // One badge for each run of hidden days, standing in for them on the line.
    const runs = new Map(); // first hidden day of a run -> the days in it
    if (hiding) {
      let run = null;
      for (const d of days) {
        if (empties.has(d)) { if (!run) { run = []; runs.set(d, run); } run.push(d); } else run = null;
      }
    }
    days.forEach((day, i) => {
      const above = timelineMarkers(day, 'before', days, by);
      if (above) wrap.append(above);
      if (runs.has(day)) wrap.append(buildGap(runs.get(day)));
      if (i === 0) wrap.append(...buildBetween(null));
      wrap.append(buildDay(day, i, days, by));
      // A hidden day's own joint has nowhere meaningful to point (its day is not shown) and only piles up on
      // the gap badge standing in for it; the badge's own + already opens the same menu for the run.
      if (!(hiding && empties.has(day))) wrap.append(...buildBetween(day));
      const below = timelineMarkers(day, 'after', days, by);
      if (below) wrap.append(below);
    });
    if (canEdit) wrap.append(buildEdge('after'));
    if ((by.get(null) || []).length) wrap.append(buildDay(null, days.length, days, by));
    $('body').replaceChildren(wrap);
  }

  function renderStrip() {
    const strip = $('daystrip');
    strip.replaceChildren();
    const today = ymd(new Date());
    const empties = emptyDays();
    const bounds = tripBounds(plan.list());
    for (const day of plan.days()) {
      const chip = clone('tpl-daychip');
      chip.dataset.day = day;
      chip.classList.toggle('is-empty', empties.has(day));
      chip.classList.toggle('in-trip', Boolean(bounds) && day >= bounds.start.day && day <= bounds.end.day);
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

  // The four views are the toolbar's view switch. Hide/Show empty days and Edit trip are not a view --
  // they're the trip's own actions, and stay icons in the titlebar when the host has one (a pane, or a
  // module's own window); on the server page there is none, and the buttons stay in the page.
  const VIEWS = [
    { id: 'days', label: 'Days' },
    { id: 'decisions', label: 'Decisions' },
    { id: 'bookings', label: 'Bookings' },
    { id: 'money', label: 'Money' },
  ];
  const viewSwitch = tavern.ui.viewSwitch({
    id: 'view',
    options: VIEWS,
    value: state.view,
    onChange: (id) => {
      state.view = id;
      scrolled = state.view !== 'days';
      redraw();
    },
  });
  let headerSig = '';
  async function syncHeader() {
    if (!tavern.header) return;
    const items = [];
    if (state.view === 'days') items.push({ id: 'toggle-empty', icon: 'eye-slash', title: state.hideEmpty ? 'Show empty days' : 'Hide empty days', on: state.hideEmpty });
    if (canEdit) items.push({ id: 'edit-trip', icon: 'pen', title: 'Edit trip' });
    const sig = JSON.stringify(items);
    if (sig === headerSig) return;
    headerSig = sig;
    let hosted = false;
    try {
      hosted = await tavern.header.set(items);
    } catch (err) {
      hosted = false;
    }
    $('app').classList.toggle('hosted-header', Boolean(hosted));
  }
  if (tavern.header) {
    tavern.on('header', (e) => {
      if (e.id === 'toggle-empty') {
        state.hideEmpty = !state.hideEmpty;
        try { localStorage.setItem('planner-hide-empty', state.hideEmpty ? '1' : '0'); } catch (err) { /* not remembered */ }
        return redraw();
      }
      if (e.id === 'edit-trip') return openEditor('trip');
    });
  }

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
    const openCount = openDecisions().length;
    viewSwitch.set(state.view, VIEWS.map((v) => (v.id === 'decisions' && openCount ? { ...v, label: `Decisions (${openCount} open)` } : v)));
    hide(head.querySelector('[data-action="edit-trip"]'), !canEdit);
    const toggle = head.querySelector('[data-action="toggle-empty"]');
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(state.hideEmpty));
      const label = state.hideEmpty ? 'Show empty days' : 'Hide empty days';
      toggle.title = label;
      toggle.setAttribute('aria-label', label);
      hide(toggle, state.view !== 'days');
    }
    void days;
    syncHeader();
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
      $('stripbar').hidden = true;
      $('body').replaceChildren(clone('tpl-state-loading'));
      return;
    }
    if (!plan.trip || !plan.days().length) {
      $('trip').hidden = true;
      $('stripbar').hidden = true;
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
      $('stripbar').hidden = true;
      ({ decisions: renderDecisions, bookings: renderBookings, money: renderMoney })[state.view]();
    } else {
      $('stripbar').hidden = false;
      renderStrip();
      renderDays();
    }
    hydrate(root === document ? document.body : root);
    restoreInputs(kept);
    if (scrolled) { scroller.scrollTop = top; if (state.view === 'days' && state.currentDay) markCurrent(state.currentDay); }
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
    for (const d of root.querySelectorAll('.day2[data-day]')) d.classList.toggle('current', Boolean(day) && d.dataset.day === day);
    // keep the chosen chip in view inside the strip (the strip alone scrolls, never the page)
    const strip = $('daystrip');
    const chip = strip && strip.querySelector('.daychip.current');
    if (chip) {
      const left = chip.offsetLeft - strip.offsetLeft;
      if (left < strip.scrollLeft || left + chip.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollTo({ left: left - (strip.clientWidth - chip.offsetWidth) / 2 });
    }
  }
  // The arrows beside the day strip: a page of days at a time; each is disabled at its end.
  function stripArrows() {
    const strip = $('daystrip');
    if (!strip) return;
    const prev = root.querySelector('[data-action="strip-prev"]');
    const next = root.querySelector('[data-action="strip-next"]');
    if (prev) prev.disabled = strip.scrollLeft <= 1;
    if (next) next.disabled = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 1;
  }
  $('daystrip').addEventListener('scroll', stripArrows, { passive: true });
  new ResizeObserver(stripArrows).observe($('daystrip'));
  $('body').addEventListener('scroll', () => {
    const days = [...root.querySelectorAll('.day2[data-day]')].filter((d) => d.dataset.day);
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
  // The joints on the line where a marker between days can be: before the first day, and after each day.
  function menuJoints() {
    return [['start', 'Before the first day'], ...plan.days().map((d, i) => [d, `After Day ${i + 1} (${dayShort(d)})`])];
  }
  function openMenu(id, button) {
    const menu = $('item-menu');
    state.menuFor = id;
    const item = plan.list().find((i) => i.id === id);
    if (!item) return;
    const select = $('menu-day');
    select.replaceChildren(...menuDays().map(([value, label]) => { const o = document.createElement('option'); o.value = value; o.textContent = label; return o; }));
    if (item.kind === 'lane') {
      select.replaceChildren(...menuJoints().map(([value, label]) => { const o = document.createElement('option'); o.value = value; o.textContent = label; return o; }));
      select.value = item.after || 'start';
    } else select.value = plan.dayOf(item) || '';
    const follow = menu.querySelector('[data-action="follow"]');
    hide(follow, item.kind !== 'link');
    // A link that cannot be read has nothing to edit.
    hide(menu.querySelector('[data-action="edit"]'), item.kind === 'link' && Boolean(linkState(item.ref && plan.cards.get(tavern.util.refKey(item.ref)))));
    fill(follow, { 'follow-label': item.follow ? 'Stop following its result' : 'Follow its result' });
    // A time block can change its type; it is removed rather than deleted.
    const isBlock = item.kind === 'block' || item.kind === 'lane';
    const isLane = item.kind === 'lane';
    hide(menu.querySelector('[data-action="to-ideas"]'), isLane || !plan.dayOf(item));
    const typeLabel = menu.querySelector('[data-block-only]');
    hide(typeLabel, !isBlock);
    if (isBlock) {
      const types = $('menu-type');
      types.replaceChildren(...blockTypes().map((t) => { const o = document.createElement('option'); o.value = t.id; o.textContent = t.label; return o; }));
      if (![...types.options].some((o) => o.value === item.type)) { const o = document.createElement('option'); o.value = item.type; o.textContent = markerType(item.type).label; types.append(o); }
      types.value = item.type;
    }
    const del = menu.querySelector('[data-action="delete"]');
    fill(del, { 'delete-label': isBlock ? 'Remove' : 'Delete' });
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
    if (action === 'earlier' || action === 'later') {
      closeMenu();
      const item = plan.list().find((i) => i.id === id);
      if (item && item.kind === 'lane') {
        // A marker between days moves to the joint before or after.
        const joints = [null, ...plan.days()];
        const at = joints.indexOf(item.after || null) + (action === 'earlier' ? -1 : 1);
        if (at < 0 || at >= joints.length) return;
        return void attempt(() => plan.updateItem(id, { after: joints[at] }));
      }
      return void attempt(() => plan.nudgeItem(id, action === 'earlier' ? -1 : 1));
    }
    if (action === 'follow') {
      const item = plan.list().find((i) => i.id === id);
      closeMenu();
      return void attempt(() => plan.updateItem(id, { follow: !(item && item.follow) }));
    }
    if (action === 'to-ideas') { closeMenu(); return void attempt(() => plan.moveTo(id, null, 1e6)); }
    if (action === 'delete') {
      if (state.deleteArmed !== id) { const block = ['block', 'lane'].includes((plan.list().find((i) => i.id === id) || {}).kind); state.deleteArmed = id; fill(b, { 'delete-label': block ? 'Really remove?' : 'Really delete?' }); return; }
      closeMenu();
      return void attempt(() => plan.removeItem(id));
    }
  });
  $('menu-type').addEventListener('change', (e) => {
    const id = state.menuFor;
    const type = e.target.value;
    closeMenu();
    if (id && type) attempt(() => plan.updateItem(id, { type }));
  });
  $('menu-day').addEventListener('change', (e) => {
    const id = state.menuFor;
    const date = e.target.value || null;
    const moving = plan.list().find((i) => i.id === id);
    closeMenu();
    if (moving && moving.kind === 'lane') return void attempt(() => plan.updateItem(id, { after: e.target.value === 'start' ? null : date }));
    if (id) attempt(() => plan.moveTo(id, date, 1e6));
  });
  root.addEventListener('click', (e) => { if (!$('item-menu').hidden && !e.target.closest('#item-menu, [data-action="move-menu"]')) closeMenu(); });

  // --- dragging (desktop) --------------------------------------------------------------------------------------

  let dragId = null;
  let lastTarget = null;
  const clearDrop = () => {
    if (lastTarget) lastTarget.removeAttribute('data-drop');
    lastTarget = null;
    for (const d of root.querySelectorAll('.day2.drop-target, .joint.drop-target')) d.classList.remove('drop-target');
    // A marker between days being dragged: the line shows every joint as a place to drop, and the days dim.
    for (const d of root.querySelectorAll('.days.dragging-lane')) d.classList.remove('dragging-lane');
    for (const d of root.querySelectorAll('.row.lane.dragging')) d.classList.remove('dragging');
  };
  // The handle is the only drag source: an item becomes draggable only while it is pressed.
  root.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.rail');
    if (handle && canEdit) { const row = handle.closest('.row.entry'); if (row) row.draggable = true; }
  });
  root.addEventListener('dragstart', (e) => {
    const li = e.target.closest && e.target.closest('.row.entry[draggable="true"]');
    if (!li) return;
    dragId = li.dataset.id;
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
  });
  root.addEventListener('dragend', () => {
    for (const li of root.querySelectorAll('.row.entry.dragging, .row.entry[draggable="true"]')) { li.classList.remove('dragging'); li.draggable = false; }
    dragId = null;
    clearDrop();
  });
  root.addEventListener('dragover', (e) => {
    if (!dragId) return;
    const day = e.target.closest && e.target.closest('.day2');
    if (!day) return;
    e.preventDefault();
    clearDrop();
    day.classList.add('drop-target');
    const over = e.target.closest('.row.entry');
    if (over && over.dataset.id !== dragId) {
      const r = over.getBoundingClientRect();
      over.dataset.drop = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
      lastTarget = over;
    }
  });
  root.addEventListener('drop', (e) => {
    if (!dragId) return;
    e.preventDefault();
    const day = e.target.closest('.day2');
    if (!day) return;
    const over = e.target.closest('.row.entry');
    const id = dragId;
    const where = over && over.dataset.drop;
    clearDrop();
    attempt(() => moveOwn(id, day, over, where));
  });

  // Where an item of the plan is put when it is dropped on a day, before or after another item. An item with no time is placed in the
  // order of the day's untimed ones; an item with a time keeps it when it goes to another day, and, dropped between two others on
  // the same day, takes the end of the item before it as its time (nothing changes if that one has no time).
  function moveOwn(id, dayEl, overEl, where) {
    const item = plan.list().find((i) => i.id === id);
    if (!item || item.kind === 'lane') return null; // a marker between days moves from its menu
    const date = dayEl.dataset.day || null;
    const sameDay = plan.dayOf(item) === date;
    if (item.time) {
      if (!sameDay || !overEl || overEl.dataset.id === id) return sameDay ? null : plan.moveTo(id, date, 1e6);
      const rows = [...dayEl.querySelectorAll('.row.entry')].filter((r) => r.dataset.id !== id);
      const prevRow = where === 'after' ? overEl : rows[rows.indexOf(overEl) - 1];
      const prev = prevRow && plan.list().find((i) => i.id === prevRow.dataset.id);
      if (!prev || !prev.time) return null;
      const end = minutesOfDay(prev.time) + (prev.minutes || 30);
      return end < 24 * 60 ? plan.updateItem(id, { time: hm(end) }) : null;
    }
    const dayUntimed = sortDay(plan.sortable().filter((i) => !i.time && plan.dayOf(i) === date && i.id !== id));
    let index = dayUntimed.length;
    if (overEl && overEl.dataset.id !== id) {
      const at = dayUntimed.findIndex((i) => i.id === overEl.dataset.id);
      if (at >= 0) index = at + (where === 'after' ? 1 : 0);
    }
    return plan.moveTo(id, date, index);
  }

  // A pointer a shared plan may hold: a private item is copied to the room first (title, position and address, through a module that
  // offers to save a place), and the copy's pointer is used.
  async function sharedRef(ref) {
    if (ref.scope !== 'person') return ref;
    const card = await tavern.refs.resolve(ref);
    if (!card || card.error) throw new Error('That private item could not be read.');
    let add = null;
    try { add = (await tavern.actions.list()).find((a) => a.name === 'addPlace' && a.input && a.input.title); } catch (err) { add = null; }
    if (!add) throw new Error('That item is private to you. Share it to the room first, then use the shared copy.');
    const out = await tavern.actions.request(add.action, { title: card.title, ...(card.subtitle ? { address: card.subtitle } : {}), ...(card.place ? { lat: card.place.lat, lng: card.place.lng } : {}) }, { wait: true });
    if (out.status === 'done' && out.result && out.result.ok && out.result.ref) return out.result.ref;
    throw new Error('It could not be shared to the room.');
  }

  // Something from another module dropped on a day: put it on that day.
  if (tavern.refs && tavern.refs.dropTarget && canEdit) {
    const dayAt = (pt) => { const el = tavern.refs.elementAt(pt); return el && el.closest ? el.closest('.day2') : null; };
    // One of this plan's own items, pressed on its body and dragged (the pointer drag every module's items share).
    const ownRef = (ref) => Boolean(ref) && ref.module === info.module.id && ref.kind === 'plan';
    const laneOf = (ref) => { const it = plan.list().find((i) => i.id === ref.id); return it && it.kind === 'lane' ? it : null; };
    // The joint nearest the pointer (the pointer is in this module's own coordinates, a box in the page's), and the marker under it, if
    // it is in that joint: which half of it the pointer is in says before or after.
    const laneSpot = (pt, id) => {
      const y = pt.y + tavern.rootElement.getBoundingClientRect().top;
      let best = null;
      for (const j of root.querySelectorAll('.joint')) {
        const r = j.getBoundingClientRect();
        const d = Math.abs(y - (r.top + r.height / 2));
        if (!best || d < best.d) best = { joint: j, d };
      }
      if (!best) return null;
      const after = best.joint.dataset.after || '';
      const el = tavern.refs.elementAt(pt);
      const row = el && el.closest ? el.closest('.row.lane') : null;
      const inJoint = row && row.dataset.id !== id && row.parentElement && row.parentElement.dataset.after === after;
      let where = null;
      if (inJoint) { const r = row.getBoundingClientRect(); where = y < r.top + r.height / 2 ? 'before' : 'after'; }
      return { joint: best.joint, after: after || null, row: inJoint ? row : null, where };
    };
    // Put a marker at a joint, and among the markers already there.
    function moveLane(id, spot) {
      const others = plan.lanes().filter((l) => l.id !== id && (l.after || null) === spot.after);
      const order = laneOrder(others, spot.row ? spot.row.dataset.id : null, spot.where);
      return plan.updateItem(id, { after: spot.after, order });
    }
    // The row under the pointer, and whether the pointer is in its top or bottom half (the pointer is in this module's own
    // coordinates, a row's box in the page's).
    const rowAt = (pt) => {
      const el = tavern.refs.elementAt(pt);
      const row = el && el.closest ? el.closest('.row.entry') : null;
      if (!row) return { row: null, where: null };
      const r = row.getBoundingClientRect();
      const y = pt.y + tavern.rootElement.getBoundingClientRect().top;
      return { row, where: y < r.top + r.height / 2 ? 'before' : 'after' };
    };
    tavern.refs.dropTarget({
      over: (pt, ref) => {
        clearDrop();
        if (ownRef(ref) && laneOf(ref)) {
          // A marker between days looks for the nearest joint on the line, and, over another marker there, before or after it.
          const days = root.querySelector('.days');
          if (days) days.classList.add('dragging-lane');
          const me = root.querySelector(`.row.lane[data-id="${ref.id}"]`);
          if (me) me.classList.add('dragging');
          const spot = laneSpot(pt, ref.id);
          if (!spot) return;
          spot.joint.classList.add('drop-target');
          if (spot.row) { spot.row.dataset.drop = spot.where; lastTarget = spot.row; }
          return;
        }
        if (ownRef(ref)) {
          const day = dayAt(pt);
          if (!day) return;
          day.classList.add('drop-target');
          const { row, where } = rowAt(pt);
          if (row && row.dataset.id !== ref.id) { row.dataset.drop = where; lastTarget = row; }
          return;
        }
        const day = ref && ref.module !== info.module.id ? dayAt(pt) : null;
        if (day) day.classList.add('drop-target');
      },
      leave: clearDrop,
      drop: (ref, pt) => {
        if (ownRef(ref) && laneOf(ref)) {
          const spot = laneSpot(pt, ref.id);
          clearDrop();
          if (spot) attempt(() => moveLane(ref.id, spot));
          return;
        }
        clearDrop();
        if (ownRef(ref)) {
          const day = dayAt(pt);
          if (!day) return;
          const { row, where } = rowAt(pt);
          attempt(() => moveOwn(ref.id, day, row, where));
          return;
        }
        const day = ref && ref.module !== info.module.id ? dayAt(pt) : null;
        if (!day) return;
        const date = day.dataset.day || null;
        const over = tavern.refs.elementAt(pt);
        const li = over && over.closest ? over.closest('.row.entry') : null;
        const target = li && li.dataset.id ? planRef(li.dataset.id) : null;
        attempt(async () => {
          // What can be done with it here: put it on the day, and (dropped on an item) whatever other modules offer to
          // do with an item of that kind and this one, filled from what is under the drop (the day, the item).
          // A private item (someone's own, in their profile) cannot be pointed at from a shared plan: only they could open it. So it
          // is shared first, as a copy in the room, by whichever module offers to save a place, and the plan points at the copy.
          const offers = [{ id: 'add', label: date ? `Put it on ${dayShort(date)}` : 'Keep it with the ideas', run: async () => plan.addLink(await sharedRef(ref), date) }];
          let actions = [];
          try { actions = await tavern.actions.list({ accepts: ref.module + ':' + ref.kind }); } catch (err) { actions = []; }
          for (const a of ref.scope === 'person' ? [] : actions) {
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
      const li = target.closest && target.closest('.row.entry');
      if (!li || !li.dataset.id || target.closest('.rail, .menu-btn, button, input, select, textarea, a')) return null;
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

  // A placeholder for the title of each kind of thing.
  const TITLES = { flight: 'Flight to Lisbon', train: 'Train to Porto', ferry: 'Ferry to the island', bus: 'Bus to the airport', car: 'Rental car', hotel: 'Hotel Avenida', restaurant: 'Dinner at Cervejaria Ramiro', cafe: 'Coffee at the pier', bar: 'Drinks at the rooftop', sight: 'Belem Tower', museum: 'The tile museum', tour: 'Walking tour', show: 'Fado night', note: 'Remember to...' };
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
    const select = $('f-paidBy');
    select.replaceChildren(...[{ key: '', name: 'Nobody yet' }, ...state.people].map((p) => { const o = document.createElement('option'); o.value = p.key; o.textContent = p.name; return o; }));
    select.value = selected || '';
  }
  // The value of a field, or '' when the chosen type does not show it (so a field that is hidden is never saved).
  const shown = (id) => { const w = $(id) && $(id).closest('[data-types]'); return !w || w.classList.contains('on-type'); };
  const get = (id) => (shown(id) ? $(id).value.trim() : '');
  const num = (id) => (shown(id) && $(id).value ? Number($(id).value) : null);
  const setVal = (id, v) => { const el = $(id); if (!el) return; if (el.tagName === 'SELECT' && v && ![...el.options].some((o) => o.value === String(v))) { const o = document.createElement('option'); o.value = String(v); o.textContent = String(v); el.append(o); } el.value = v == null ? '' : String(v); };

  // Choosing a kind of thing shows the fields it needs (each field wrapper lists its types in data-types).
  function applyType(tile) {
    const ed = state.editing;
    if (!ed) return;
    ed.tile = tile;
    const key = tile.startsWith('block:') ? 'block' : tile.startsWith('lane:') ? 'lane' : tile; // every marker shows the same fields
    for (const el of $('form').querySelectorAll('[data-types]')) el.classList.toggle('on-type', el.dataset.types.split(/\s+/).includes(key));
    $('f-title').required = key !== 'block' && key !== 'lane'; // a marker's label is optional: the type names it
    const dateRow = $('f-date').closest('.editor-row');
    if (dateRow) dateRow.hidden = key === 'lane'; // a marker between days has no day of its own
    const noLength = ['block:meet-up', 'block:leave-by'].includes(tile); // a moment, not a stretch of time
    const lengthLabel = $('f-minutes').closest('label');
    if (lengthLabel) lengthLabel.hidden = noLength;
    if ($('f-time-label')) $('f-time-label').textContent = key === 'hotel' ? 'Check in' : 'Time'; // the same field; a stay's own words for it
    for (const b of $('form').querySelectorAll('.tile')) b.classList.toggle('on', b.dataset.type === tile);
    $('f-title').placeholder = key === 'block' ? markerType(tile.slice(6)).label : key === 'lane' ? markerType(tile.slice(5)).label : TITLES[tile] || '';
  }
  // The marker tiles, one for each type that is not automatic: 'Time' ones inside a day, and 'Between days' ones on the line.
  function addBlockTiles() {
    addTileGroup('Time', 'block');
    addTileGroup('Between days', 'lane');
  }
  function addTileGroup(name, prefix) {
    const types = blockTypes();
    const box = $('f-types');
    if (!box || !types.length) return;
    const group = document.createElement('div');
    group.className = 'typegroup';
    const title = document.createElement('div');
    title.className = 'typegroup-title';
    title.textContent = name;
    const tiles = document.createElement('div');
    tiles.className = 'tiles';
    for (const t of types) {
      const b = document.createElement('button');
      b.className = 'tile';
      b.type = 'button';
      b.dataset.type = `${prefix}:${t.id}`;
      const ic = document.createElement('span');
      ic.className = 'ic';
      ic.dataset.icon = t.icon;
      const label = document.createElement('span');
      label.textContent = t.label;
      b.append(ic, label);
      b.style.setProperty('--marker', t.color);
      tiles.append(b);
    }
    group.append(title, tiles);
    box.append(group);
  }
  const chosenMode = () => { const on = $('f-travelMode') && $('f-travelMode').querySelector('.mode.on'); return on ? on.dataset.mode : null; };

  function openEditor(mode, item, day) {
    if (!canEdit) return;
    const isLink = Boolean(item && item.kind === 'link');
    state.editing = { mode, id: item ? item.id : null, day: day || null, version: item ? plan.versionOf(item.id) : null, tile: 'sight', isLink };
    $('editor').replaceChildren(clone(mode === 'trip' ? 'tpl-editor-trip' : 'tpl-editor2'));
    $('f-error').hidden = true;
    if (mode === 'trip') {
      const t = plan.trip || {};
      $('editor-title').textContent = plan.trip ? 'Edit the trip' : 'Plan a trip';
      $('f-title').value = t.title || '';
      $('f-destination').value = t.destination || '';
      $('f-start').value = t.start || '';
      $('f-end').value = t.end || '';
      $('f-currency').value = t.currency || '';
      $('f-notes').value = t.notes || '';
      $('f-by').textContent = '';
    } else {
      addBlockTiles();
      $('editor-title').textContent = item ? 'Edit' : 'Add to the plan';
      hide($('f-types'), Boolean(item) && isLink);
      hide($('f-delete'), !item);
      applyType(item ? tileOf(item) || 'sight' : 'sight');
      dayOptions($('f-date'), { ideas: true });
      $('f-date').value = item ? item.date || '' : day || '';
      dayOptions($('f-checkout'), { ideas: true, after: item ? item.date : day });
      const v = item || {};
      setVal('f-checkout', v.checkOut);
      setVal('f-checkOutTime', v.checkOutTime);
      $('f-time').value = v.time || '';
      $('f-minutes').value = v.minutes || '';
      $('f-title').value = item ? item.title : '';
      for (const f of ['operator', 'number', 'fromCode', 'toCode', 'from', 'to', 'pickup', 'dropoff', 'terminal', 'platform', 'carriage', 'seat', 'roomType', 'partySize', 'reservationName', 'admissionCount', 'guests']) setVal(`f-${f}`, v[f]);
      setVal('f-travelClass', v.travelClass);
      setVal('f-gate', v.gate);
      setVal('f-gate-show', v.gate);
      setVal('f-address', v.address);
      setVal('f-address-stop', v.address);
      setVal('f-confirm', v.confirm);
      $('f-notes').value = v.notes || '';
      $('f-cost').value = v.cost || '';
      paidByOptions(item ? item.paidBy : info.user.key);
      ownerBoxes(v.owners || []);
      for (const b of $('f-travelMode').querySelectorAll('.mode')) b.classList.toggle('on', b.dataset.mode === v.travelMode);
      setVal('f-travelMinutes', v.travelMinutes);
      $('f-by').textContent = item && item.by ? `Added by ${item.by}` : '';
    }
    hydrate($('editor'));
    $('editor').hidden = false;
    $('f-title').focus();
  }
  const openItemEditor = (id) => { const item = plan.list().find((i) => i.id === id); if (item) openEditor('item', item); };
  const closeEditor = () => { $('editor').hidden = true; $('editor').replaceChildren(); state.editing = null; };
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
        await plan.saveTrip({ title: $('f-title').value.trim(), destination: $('f-destination').value.trim(), start: $('f-start').value, end: $('f-end').value || $('f-start').value, currency: $('f-currency').value.trim(), notes: $('f-notes').value.trim() });
        scrolled = false;
        plan.suggest().catch(() => {});
        return closeEditor();
      }
      const item = ed.id ? plan.list().find((i) => i.id === ed.id) : null;
      if (!ed.isLink && !ed.tile.startsWith('block:') && !ed.tile.startsWith('lane:') && !$('f-title').value.trim()) return fail('Give it a title.');
      const common = {
        title: $('f-title').value.trim(),
        date: $('f-date').value || null,
        notes: $('f-notes').value.trim(),
        owners: [...$('f-owners').querySelectorAll('input:checked')].map((i) => i.value),
        travelMode: shown('f-travelMode') ? chosenMode() : null,
        travelMinutes: num('f-travelMinutes'),
        cost: num('f-cost'),
      };
      common.paidBy = common.cost ? $('f-paidBy').value : '';
      let fields;
      if (ed.isLink) {
        fields = { ...common, kind: 'link', time: $('f-time').value || null, minutes: num('f-minutes') };
      } else {
        const t = fromTile(ed.tile, item);
        if (t.kind === 'lane') { common.date = null; common.travelMode = null; common.travelMinutes = null; common.owners = []; common.cost = null; common.paidBy = ''; }
        // A time block or a marker between days can be left untitled in the form (the type's own label is its
        // placeholder, shown greyed until someone types over it): store that label as the real title rather than
        // leaving the field empty, so the item has a real name anywhere it is shown generically (Assistant's
        // context picker, a ref search, a backlink), not just in this module's own rendering, which already
        // falls back to the type's label on its own.
        if ((t.kind === 'lane' || t.kind === 'block') && !common.title) common.title = markerType(t.type).label;
        fields = { ...common, ...t, ...(t.kind === 'lane' ? { after: item && item.kind === 'lane' ? item.after : null } : {}), time: shown('f-time') ? $('f-time').value || null : t.kind === 'stay' && item ? item.time : null, minutes: ['block:meet-up', 'block:leave-by'].includes(ed.tile) || ed.tile.startsWith('lane:') ? null : num('f-minutes') };
        if (t.kind === 'journey') {
          for (const f of ['operator', 'number', 'from', 'to', 'pickup', 'dropoff', 'terminal', 'platform', 'carriage', 'seat', 'travelClass']) fields[f] = get(`f-${f}`);
          fields.fromCode = get('f-fromCode');
          fields.toCode = get('f-toCode');
          fields.gate = get('f-gate');
          fields.confirm = get('f-confirm');
        } else if (t.kind === 'stay') {
          fields.checkOut = $('f-checkout').value || null;
          fields.checkOutTime = get('f-checkOutTime') || null;
          fields.address = get('f-address');
          fields.roomType = get('f-roomType');
          fields.guests = num('f-guests');
          fields.confirm = get('f-confirm');
        } else if (t.kind === 'stop') {
          fields.address = get('f-address-stop');
          fields.partySize = num('f-partySize');
          fields.reservationName = get('f-reservationName');
          fields.admissionCount = num('f-admissionCount');
          fields.gate = get('f-gate-show');
          fields.confirm = get('f-confirm');
        }
      }
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
      const save = $('f-save');
      if (save) save.disabled = false;
    }
  }

  // The dialog's buttons, by delegation (its form is made afresh each time it opens).
  $('editor').addEventListener('submit', (e) => { e.preventDefault(); saveEditor(); });
  let deleteArmedInEditor = false;
  $('editor').addEventListener('click', (e) => {
    if (e.target === $('editor')) return closeEditor();
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'f-cancel') return closeEditor();
    if (b.classList.contains('tile')) return applyType(b.dataset.type);
    if (b.classList.contains('mode')) {
      const was = b.classList.contains('on');
      for (const m of $('f-travelMode').querySelectorAll('.mode')) m.classList.remove('on');
      if (!was) b.classList.add('on');
      return;
    }
    if (b.id === 'f-delete') {
      const ed = state.editing;
      if (!ed || !ed.id) return;
      if (!deleteArmedInEditor) {
        deleteArmedInEditor = true;
        b.textContent = 'Really delete?';
        setTimeout(() => { deleteArmedInEditor = false; if (b.isConnected) b.textContent = 'Delete'; }, 4000);
        return;
      }
      deleteArmedInEditor = false;
      const id = ed.id;
      closeEditor();
      attempt(() => plan.removeItem(id));
    }
  });

  // --- clicks and adding ---------------------------------------------------------------------------------------

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const action = b.dataset.action;
    const li = b.closest('.row.entry, .leg-row');
    if (action === 'strip-prev' || action === 'strip-next') {
      const strip = $('daystrip');
      strip.scrollBy({ left: (action === 'strip-next' ? 1 : -1) * Math.max(120, strip.clientWidth * 0.7) });
    } else if (action === 'goto-day') {
      const target = $(`day-${b.dataset.day}`);
      if (target) { target.scrollIntoView({ inline: 'center', block: 'start' }); markCurrent(b.dataset.day); }
    } else if (action === 'move-menu' && li) {
      openMenu(li.dataset.id, b);
    } else if (action === 'remove-link' && li) {
      const id = li.dataset.id;
      attempt(() => plan.removeItem(id));
    } else if (action === 'open') {
      const item = li ? plan.list().find((i) => i.id === li.dataset.id) : null;
      const ref = item && item.ref ? item.ref : b.dataset.ref ? JSON.parse(b.dataset.ref) : null;
      if (ref) tavern.refs.open(ref).catch((err) => note(err.message));
    } else if (action === 'edit-item') {
      openItemEditor(b.dataset.id);
    } else if (action === 'edit-leg' && li) {
      openItemEditor(li.dataset.id);
    } else if (action === 'gap-add') {
      openGapMenu(b);
    } else if (action === 'toggle-empty') {
      state.hideEmpty = !state.hideEmpty;
      try { localStorage.setItem('planner-hide-empty', state.hideEmpty ? '1' : '0'); } catch (err) { /* not remembered */ }
      redraw();
    } else if (action === 'edge-open') {
      const edge = b.closest('.dayedge');
      hide(b, true);
      hide(edge.querySelector('.edge-form'), false);
      edge.querySelector('input[name="count"]').focus();
    } else if (action === 'edge-cancel') {
      const edge = b.closest('.dayedge');
      hide(edge.querySelector('.edge-form'), true);
      hide(edge.querySelector('[data-action="edge-open"]'), false);
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
      const day = b.closest('.day2');
      if (s && day) attempt(async () => { await plan.addLink(JSON.parse(s.dataset.ref), day.dataset.day || null); await plan.suggest(); });
    }
  });

  // The small form on a day edge: how many days to add.
  root.addEventListener('submit', (e) => {
    const form = e.target.closest('.edge-form');
    if (!form) return;
    e.preventDefault();
    note('');
    addDays(form.closest('.dayedge').dataset.edge, Number(form.elements.count.value));
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
  // What the plan points at can change or go where it lives without telling this page, so look again now and then and when the
  // page comes back into view (until the server announces it).
  const look = () => { if (state.loaded) plan.refreshCards().catch(() => {}); };
  const lookTimer = setInterval(() => { if (!tavern.rootElement.isConnected) clearInterval(lookTimer); else look(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) look(); });
  render();
  try {
    await plan.load();
    state.people = await tavern.people().catch(() => []);
    try { useMarkerTypes(await tavern.settings.get()); } catch (err) { useMarkerTypes(null); }
    tavern.settings.onChange((v) => { useMarkerTypes(v); if (state.loaded) redraw(); });
    state.loaded = true;
    // Warm the icons the page draws, so the first draw is not empty.
    await Promise.all([...new Set([...root.querySelectorAll('template')].flatMap((t) => [...t.content.querySelectorAll('[data-icon]')].map((n) => n.dataset.icon)).concat(Object.values(CAT_ICON), Object.values(BADGES), Object.values(LEG_ICONS), ['link-slash'], [...root.querySelectorAll('[data-icon]')].map((n) => n.dataset.icon)))].filter(Boolean).map(wantIcon));
    redraw();
    plan.suggest().catch(() => {});
    hydrate(root === document ? document.body : root);
  } catch (err) {
    $('app').hidden = true;
    $('msg').hidden = false;
    $('msg').textContent = 'The trip could not load: ' + err.message;
  }
})();
