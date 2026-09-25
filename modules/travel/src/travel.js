// The Travel module's page: a trip's itinerary, day by day, for one room. The trip and its items live in the module's
// store (see travel-lib-plan.js); this page draws them into the markup in travel.html by cloning its templates and
// filling their [data-slot] and [data-icon] hooks, and then only toggles the state classes and data attributes that
// CONTRACT.md lists. It never builds markup from strings and sets no style (one exception: the item menu is placed
// under the button that opened it). Items other modules hold come in as pointers, drawn from their cards.
(async () => {
  'use strict';

  // This module runs in a frame (the SDK is a global) or in the page (its SDK is handed to its script); either way
  // it looks elements up in host.root, never in document, so it works in both.
  const host = (document.currentScript && document.currentScript.host) || window.host;
  const root = host.root;
  const $ = (id) => root.getElementById(id);
  const { ymd, parseYmd } = host.util;

  let info;
  try {
    info = await host.ready();
  } catch (err) {
    $('msg').textContent = 'Planner could not start: ' + err.message;
    return;
  }
  if (info.context.scope !== 'room') {
    $('msg').textContent = 'A trip belongs to a space. Open the space, then Planner there; the dashboard lists your trips.';
    return;
  }

  /*__LIB__*/

  const canEdit = host.can('edit');
  const plan = createPlan(host);
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
    hosted: Boolean(host.bar), // the host draws the quick-add bar, so the days' own add rows step aside
    deleteArmed: null,
    expanded: new Set(), // item ids whose card's "More" is open
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
    if (!iconWait.has(name)) iconWait.set(name, host.ui.icon(name).then((svg) => { iconSvg.set(name, svg); return svg; }).catch(() => { iconSvg.set(name, ''); return ''; }));
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
  // A stored time ("22:30") the way the server shows times (host.util.time: "10:30 PM" on the default 12-hour clock).
  const tt = (t) => (t ? host.util.time(t) : '');
  const hm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const lengthText = gapText; // "8 h 15 min", "45 min"
  // When a timed item arrives, on the environment's clock, with the day when it is not the day it leaves ("2:00 AM the next day").
  // `sep` goes between the time and the day: the narrow time column puts the day on a line of its own ("\n").
  const arriveText = (item, sep = ' ') => { const a = arrivalOf(item); return a ? [tt(a.time), laterText(a.days)].filter(Boolean).join(sep) : ''; };
  // One letter, or two when another traveller of the room starts with the same one.
  const initial = (key) => {
    const name = nameOf(key);
    const first = (name[0] || '?').toUpperCase();
    const clash = state.people.some((p) => p.key !== key && (p.name[0] || '').toUpperCase() === first);
    return clash ? first + (name[1] || '').toLowerCase() : first;
  };
  const timeOf = (card) => (cardWhen(card) || {}).time || '';
  const planRef = (id) => host.refs.make('plan', id);
  const tripRef = () => host.refs.make('trip', 'main');
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
    const arrive = arriveText(item);
    const duration = lengthText(item.minutes);
    const where = item.place || item.address;
    const badge = el.querySelector('.badge [data-icon]');
    if (badge && c.badge && !badge.dataset.icon) setIcon(badge, c.badge);
    if (c.card === 'flight') {
      put(el, { title: [item.operator, item.number].filter(Boolean).join(' ') || item.title, fromCode: item.fromCode, toCode: item.toCode, from: item.from, to: item.to, time: tt(item.time), arrival: arrive, duration, seat: item.seat, gate: item.gate, travelClass: item.travelClass });
    } else if (c.card === 'train') {
      put(el, { title: [item.operator, item.number].filter(Boolean).join(' ') || item.title, from: item.from, to: item.to, time: tt(item.time), arrival: arrive, platform: item.platform ? `Platform ${item.platform}` : '', seat: [item.carriage && `Coach ${item.carriage}`, item.seat && `Seat ${item.seat}`].filter(Boolean).join(' · '), duration, confirm: item.confirm });
    } else if (c.card === 'transit') {
      const to = item.to || item.dropoff || '';
      put(el, { kicker: [c.kicker, item.operator].filter(Boolean).join(' · '), title: item.title, time: tt(item.time), to, confirm: item.confirm });
      const go = el.querySelector('.go');
      if (go && !item.time && !to && !item.confirm) go.hidden = true;
    } else if (c.card === 'hotel' && span !== 'end' && span !== 'middle') {
      const nights = stayNights(item);
      put(el, { kicker: c.kicker, title: item.title, address: where, nights: words(nights, 'night', 'nights'), checkin: [item.date && dayShort(item.date), tt(item.time)].filter(Boolean).join(' · '), checkout: item.checkOut ? [dayShort(item.checkOut), tt(item.checkOutTime)].filter(Boolean).join(' · ') : 'Not set', roomType: item.roomType, guests: words(item.guests, 'guest', 'guests'), confirm: item.confirm });
    } else if (span === 'end') {
      put(el, { title: item.title, address: where, time: tt(item.checkOutTime), nights: words(stayNights(item), 'night', 'nights') });
    } else if (span === 'middle') {
      put(el, { title: `Staying at ${item.title}` });
    } else if (c.card === 'meal') {
      setIcon(el.querySelector('.badge [data-icon]'), c.badge);
      put(el, { kicker: c.kicker, title: item.title, address: where, partySize: item.partySize ? `Table for ${item.partySize}` : '', reservationName: item.reservationName ? `under ${item.reservationName}` : '', time: tt(item.time), minutes: duration });
    } else if (c.card === 'activity') {
      setIcon(el.querySelector('.badge [data-icon]'), c.badge);
      put(el, { kicker: c.kicker, title: item.title, address: where, minutes: duration, admissionCount: words(item.admissionCount, 'ticket', 'tickets'), confirm: item.confirm });
    } else if (c.card === 'show') {
      put(el, { kicker: c.kicker, title: item.title, address: where, gate: item.gate ? `Gate ${item.gate}` : '', confirm: item.confirm, admissionCount: item.admissionCount ? String(item.admissionCount) : '', time: tt(item.time) });
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
    moreInto(el, item);
    roundTripInto(el, item);
    if (!canEdit) el.querySelector('.menu-btn')?.remove();
    return el;
  }

  // A leg of a round trip: a line under its card with the other leg's day ("Round trip · Return Fri, Oct 9"), and on a return placed
  // before its outbound, a warning (it is allowed).
  function roundTripInto(el, item) {
    if (item.kind !== 'journey') return;
    const out = plan.outboundFor(item);
    const other = out || plan.returnFor(item.id);
    if (!other) return;
    const mark = clone('tpl-card-roundtrip');
    fill(mark, {
      'roundtrip-text': `Round trip · ${out ? 'Outbound' : 'Return'} ${other.date ? dayShort(other.date) : 'not on a day yet'}`,
      'roundtrip-warn': out && returnBefore(item, out) ? 'Return is before the outbound' : '',
    });
    el.insertBefore(mark, el.querySelector(':scope > .card-more'));
  }
  // The item as its card shows it: a return shows its outbound's booking reference, cost and payer (the outbound holds them).
  const withBooking = (item) => {
    const out = item.kind === 'journey' ? plan.outboundFor(item) : null;
    return out ? { ...item, confirm: out.confirm, cost: out.cost, paidBy: out.paidBy } : item;
  };

  // What the card's own face has no place for, folded under it: the note, who is on it, the booking reference, the
  // terminal, the cost... Only what the item has and the template did not show (a slot of that name); "More" opens it,
  // and a card someone opened stays open through redraws.
  function moreInto(el, item) {
    if (item.kind === 'link' || item.kind === 'lane') return;
    const has = (name) => Boolean(slot(el, name));
    const rows = [];
    const add = (label, value, slotName) => { if (value && !(slotName && has(slotName))) rows.push([label, value]); };
    add('Note', item.notes, 'body');
    if (item.owners && item.owners.length && !has('owners')) rows.push(['Who', item.owners.map(nameOf).join(', ')]);
    add('Booking', item.confirm, 'confirm');
    add('Terminal', item.terminal, 'terminal');
    add('Platform', item.platform, 'platform');
    add('Coach', item.carriage, 'carriage');
    add('Seat', item.seat, 'seat');
    add('Class', item.travelClass, 'travelClass');
    add('Pick up', item.pickup, 'pickup');
    add('Drop off', item.dropoff, 'dropoff');
    add('Room', item.roomType, 'roomType');
    add('Guests', words(item.guests, 'guest', 'guests'), 'guests');
    add('Reservation', item.reservationName, 'reservationName');
    add('Address', item.address, 'address');
    if (item.cost) rows.push(['Cost', `${host.util.money(item.cost, (plan.trip || {}).currency || undefined)}${item.paidBy ? ` · paid by ${nameOf(item.paidBy)}` : ''}`]);
    if (!rows.length) return;
    const more = clone('tpl-card-more');
    more.open = state.expanded.has(item.id);
    const dl = more.querySelector('dl');
    for (const [label, value] of rows) {
      const dt = document.createElement('dt'); dt.textContent = label;
      const dd = document.createElement('dd'); dd.textContent = value;
      dl.append(dt, dd);
    }
    more.addEventListener('toggle', () => { if (more.open) state.expanded.add(item.id); else state.expanded.delete(item.id); });
    el.append(more);
  }

  // `entry` is { item, span } (a stay is drawn on each night it covers; only its first day is the real item). On the line
  // (`line`: at a joint between days, not in a day) the same card is drawn with no time: a time means nothing there.
  function buildEntry(entry, line) {
    const item = withBooking(entry.item);
    const { span } = entry;
    entry = { ...entry, item };
    const card = item.ref ? plan.cards.get(host.util.refKey(item.ref)) : null;
    const c = cardOf(item, card);
    const row = clone('tpl-row');
    row.dataset.id = item.id;
    row.dataset.kind = item.kind;
    row.dataset.type = c.family;
    row.classList.toggle('done', item.done);
    if (item.kind === 'journey') { const leg = plan.outboundFor(item) ? 'return' : plan.returnFor(item.id) ? 'outbound' : ''; if (leg) row.dataset.leg = leg; }
    let time = tt(item.time);
    let sub = '';
    if (item.kind === 'link') { time = tt(timeOf(card)); sub = ''; }
    else if (item.kind === 'stay') { time = span === 'end' ? tt(item.checkOutTime) : span === 'middle' ? '' : tt(item.time); sub = span === 'end' ? 'check out' : span === 'middle' ? '' : 'check in'; }
    else if (item.kind === 'journey') sub = item.time && item.minutes ? `→ ${arriveText(item, '\n')}` : '';
    else sub = lengthText(item.minutes);
    if (line) { time = ''; sub = ''; }
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
    const range = times.length ? (times.length > 1 && times[0] !== times[times.length - 1] ? `${tt(times[0])} – ${tt(times[times.length - 1])}` : tt(times[0])) : '';
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
    { id: 'travel-day', label: 'Travel day', icon: 'suitcase-rolling', color: '#0ea5e9' },
    { id: 'free-day', label: 'Free day', icon: 'sun', color: '#f59e0b' },
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
      if (bounds && bounds.start.day === day) rows.push(buildMarker('trip-start', tt(bounds.start.time), describe(itemOf(bounds.start.id) || {})));
    } else {
      // An arrival after the plan's last day (a journey home overnight) ends the trip under the last day, with its own date.
      const last = day === days[days.length - 1];
      const after = bounds && bounds.end.day > days[days.length - 1];
      const endDate = after ? parseYmd(bounds.end.day).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
      if (bounds && (bounds.end.day === day || (last && after))) rows.push(buildMarker('trip-end', [endDate, tt(bounds.end.time)].filter(Boolean).join('\n'), describe(itemOf(bounds.end.id) || {})));
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
    el.id = `day-${day}`;
    el.dataset.day = day;
    el.dataset.index = String(index + 1);
    el.classList.toggle('today', day === ymd(new Date()));
    const all = entriesFor(day, days, by);
    // A marker with no time is about the whole day ("Travel day", "Free day"): a tag in the day's header, not a row.
    const tags = all.filter((e) => e.item.kind === 'block' && !e.item.time);
    const entries = all.filter((e) => !tags.includes(e));
    const head = clone('tpl-day-head');
    if (!canEdit) hide(head.querySelector('[data-action="day-menu"]'), true);
    const d = parseYmd(day);
    fill(head, { daynum: String(d.getDate()), daymonth: `${d.toLocaleDateString([], { weekday: 'short' })} · ${d.toLocaleDateString([], { month: 'short' })}`, position: dayLabel(day, days).position, summary: daySummary(entries) });
    const tagBox = head.querySelector('.day-tags');
    hide(tagBox, !tags.length);
    for (const { item } of tags) {
      const type = markerType(item.type);
      const tag = clone('tpl-day-tag');
      tag.dataset.id = item.id;
      tag.dataset.type = item.type;
      if (!canEdit) tag.disabled = true;
      colourPill(tag, type);
      setIcon(tag.querySelector('[data-icon]'), type.icon);
      fill(tag, { title: item.title || type.label });
      tag.title = item.notes || '';
      tagBox.append(tag);
    }
    el.prepend(head);
    const list = el.querySelector('.timeline');
    if (!entries.length) {
      // An empty day is one button that opens the day's add menu (the same action as the header's "..."); a viewer
      // who cannot edit gets the plain sentence. The word follows the pointer, not the width.
      if (canEdit) {
        const empty = clone('tpl-day-empty-add');
        const b = empty.querySelector('.day-empty-add');
        b.textContent = `Nothing planned yet. ${matchMedia('(pointer: coarse)').matches ? 'Tap' : 'Click'} to add.`;
        b.title = `Add to ${dayShort(day)}`;
        list.append(empty);
      } else {
        const empty = clone('tpl-day-empty');
        empty.textContent = 'Nothing planned yet.';
        list.append(empty);
      }
    }
    // The plan's own ends, and where the trip itself starts and ends (the first and last booked item). Markers are drawn, never stored:
    // they have no id, no menu and no handle, and are not counted as something planned.
    entries.forEach((entry, i) => {
      const prev = entries[i - 1];
      const covers = (e) => e && (e.span === 'middle' || e.span === 'end');
      if (i && !covers(entry) && !covers(prev)) { const leg = buildLeg(entry.item); if (leg) list.append(leg); }
      list.append(buildEntry(entry));
    });
    if (!entries.length) el.classList.add('is-empty');
    // The days the trip itself covers (from the first booked item to the last) are marked, for their badge.
    const b = state.bounds;
    if (b && day >= b.start.day && day <= b.end.day) el.classList.add('in-trip');
    const add = el.querySelector('.add-row');
    add.dataset.day = day;
    add.setAttribute('aria-label', `Add to ${dayShort(day)}`);
    // With the host's bar the days' add rows hide: the bar is the quick way to add.
    add.classList.toggle('hosted', state.hosted);
    if (!canEdit) add.remove();
    // What other modules hold on this day that the plan could take in.
    const box = el.querySelector('.suggestions');
    const list2 = box.querySelector('.suggestions-list');
    const mine = canEdit ? plan.suggestions.filter((c) => (cardWhen(c) || {}).day === day) : [];
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
  // The items at a joint on the line (`after` is the day before it; '' is the head, before the first day): a marker as its
  // pill, anything else as the card it would be in a day. Then the + where a new one goes (`withJoint`; a hidden day's joint
  // has no + of its own, the badge standing in for the day has it).
  function buildBetween(after, withJoint = true) {
    const mine = plan.atJoint(after);
    const out = [];
    if (mine.length) {
      const list = document.createElement('ol');
      list.className = 'timeline between';
      list.dataset.after = after;
      list.append(...mine.map((item) => (item.kind === 'lane' ? buildLane(item) : buildEntry({ item }, true))));
      out.push(list);
    }
    if (canEdit && withJoint) {
      const joint = clone('tpl-joint');
      joint.dataset.after = after;
      out.push(joint);
    }
    return out;
  }
  // Where a joint is, in words, for a menu: "Before the first day", "Between Oct 1 and Oct 2", "After the last day".
  function jointLabel(after) {
    const days = plan.days();
    if (after === '' || !days.includes(after)) return 'Before the first day';
    const at = days.indexOf(after);
    if (at === days.length - 1) return 'After the last day';
    const short = (d) => parseYmd(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `Between ${short(after)} and ${short(days[at + 1])}`;
  }
  // A place as a menu value and back: a day is `d:<date>`, a joint `j:<after>` (`j:` the head).
  const placeValue = (place) => (place && place.after !== null && place.after !== undefined ? `j:${place.after}` : `d:${(place && place.date) || ''}`);
  const parsePlace = (value) => (String(value).startsWith('j:') ? { after: value.slice(2) } : { date: value.slice(2) || null });
  // The places an item can be, in line order (the head, day 1, the joint after it, day 2...), as a select's options. A
  // between-days marker sees only the joints.
  function placeOptions(select, { jointsOnly } = {}) {
    const was = select.value;
    select.replaceChildren();
    const add = (value, label) => { const o = document.createElement('option'); o.value = value; o.textContent = label; select.append(o); };
    const days = plan.days();
    add('j:', jointLabel(''));
    days.forEach((d) => {
      if (!jointsOnly) add(`d:${d}`, dayShort(d));
      add(`j:${d}`, jointLabel(d));
    });
    select.value = [...select.options].some((o) => o.value === was) ? was : 'j:';
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
  // The joint a + stands at: a joint says so; a badge for hidden days is at the joint before its first hidden day.
  function jointOfButton(button) {
    const joint = button.closest('.joint');
    if (joint) return joint.dataset.after;
    const gap = button.closest('.gap');
    const allDays = plan.days();
    return (gap && allDays[allDays.indexOf(gap.dataset.from) - 1]) || '';
  }
  // The "..." on a day and the + on a joint: everything that can be added there, the same kinds the editor's tiles offer,
  // each opening the editor at that place with the kind chosen; then the markers (a time block on a day, a between-days
  // marker on the line, added at once). A hidden-days badge also offers to show the days. The type-to-add row and the
  // host's bar are the fast path; this is the plain one.
  function openAddMenu(button, place, { gap } = {}) {
    const onLine = place.after !== undefined;
    const items = [];
    const withTile = (tile) => { openEditor('item', null, place); applyType(tile); };
    const add = (tile, label, icon) => items.push({ id: tile, label, icon, onClick: () => withTile(tile) });
    for (const t of JOURNEY_TILES) add(t, `Add a ${KICKERS[t].toLowerCase()}`, BADGES[t]);
    items.push({ separator: true });
    add('hotel', 'Add a stay', 'bed');
    items.push({ separator: true });
    for (const t of STOP_TILES) add(t, `Add a ${KICKERS[t].toLowerCase()}`, BADGES[t]);
    items.push({ separator: true });
    add('note', 'Add a note', 'note-sticky');
    // On a day, a marker with no time marks the whole day (a tag in its header), added at once; the timed ones below open the editor.
    if (!onLine) {
      items.push({ separator: true });
      for (const t of blockTypes()) {
        items.push({ id: `mark:${t.id}`, label: `Mark the day: ${t.label.toLowerCase()}`, icon: t.icon, iconColor: t.color || undefined, onClick: () => attempt(() => plan.addItem({ kind: 'block', type: t.id, title: t.label, date: place.date, time: null, minutes: null })) });
      }
      items.push({ separator: true });
    }
    for (const t of blockTypes()) {
      items.push({
        id: `${onLine ? 'lane' : 'block'}:${t.id}`,
        label: onLine ? `Add ${t.label.toLowerCase()}` : `Add ${t.label.toLowerCase()} at a time`,
        icon: t.icon,
        iconColor: t.color || undefined,
        onClick: () => (onLine ? attempt(() => plan.addItem({ kind: 'lane', type: t.id, title: t.label, after: place.after })) : withTile(`block:${t.id}`)),
      });
    }
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
    host.menu.show({ id: `add-${placeValue(place)}`, anchor: button, items });
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
      if (i === 0) wrap.append(...buildBetween(''));
      wrap.append(buildDay(day, i, days, by));
      // A hidden day's own joint has nowhere meaningful to point (its day is not shown) and only piles up on
      // the gap badge standing in for it; the badge's own + already opens the same menu for the run. What is at
      // that joint is still drawn, after the badge, so nothing on the line disappears with the day.
      wrap.append(...buildBetween(day, !(hiding && empties.has(day))));
      const below = timelineMarkers(day, 'after', days, by);
      if (below) wrap.append(below);
    });
    if (canEdit) wrap.append(buildEdge('after'));
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
        const when = w ? `${parseYmd(w.day).toLocaleDateString([], { month: 'short', day: 'numeric' })}${w.time ? ' ' + tt(w.time) : ''}` : '';
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
  const dayTime = (i) => [i.date ? parseYmd(i.date).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) : 'no day yet', tt(i.time)].filter(Boolean).join(' ');

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
        // A round trip is one row: both days, and the route both ways ("LHR ⇄ JFK").
        const back = kind === 'journey' ? plan.returnFor(i.id) : null;
        const ends = back && i.fromCode && i.toCode ? [i.fromCode, i.toCode] : [i.from, i.to];
        const route = back ? (ends[0] && ends[1] ? `${ends[0]} ⇄ ${ends[1]}` : ends.filter(Boolean).join(' ⇄ ')) : [i.from, i.to].filter(Boolean).join(' → ');
        const line = kind === 'stay'
          ? [i.checkOut && i.date ? `${dayShort(i.date)} – ${dayShort(i.checkOut)}` : dayTime(i), nights ? `${nights} night${nights === 1 ? '' : 's'}` : '', i.place || i.address].filter(Boolean).join(' · ')
          : [dayTime(i), back ? dayTime(back) : '', route].filter(Boolean).join(' · ');
        row(ul, { icon: kind === 'stay' ? 'bed' : cardOf(i).badge || 'route', title: i.title, sub: line, code: i.confirm, button: 'Open', id: i.id });
      }
    }
  }

  // Money: what was spent, who is owed what, and the fewest payments that settle it.
  const money = (n) => {
    return host.util.money(n, (plan.trip || {}).currency || undefined); // the trip's currency, else the server's
  };
  function renderMoney() {
    const body = $('body');
    body.replaceChildren();
    const costs = costItems(plan.list());
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
  const viewSwitch = host.ui.viewSwitch({
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
    if (!host.header) return;
    const items = [];
    if (state.view === 'days') items.push({ id: 'toggle-empty', icon: 'eye-slash', title: state.hideEmpty ? 'Show empty days' : 'Hide empty days', on: state.hideEmpty });
    if (canEdit) items.push({ id: 'edit-trip', icon: 'pen', title: 'Edit trip' });
    const sig = JSON.stringify(items);
    if (sig === headerSig) return;
    headerSig = sig;
    let hosted = false;
    try {
      hosted = await host.header.set(items);
    } catch (err) {
      hosted = false;
    }
    $('app').classList.toggle('hosted-header', Boolean(hosted));
  }
  if (host.header) {
    host.on('header', (e) => {
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
    if (!host.refs || !host.refs.linksTo) return;
    let changed = false;
    if (!asked.has('trip')) {
      asked.add('trip');
      try { state.tripLinks = await host.refs.linksTo(tripRef()); changed = true; } catch (err) { state.tripLinks = []; }
    }
    for (const item of plan.list().slice(0, 60)) {
      if (asked.has(item.id)) continue;
      asked.add(item.id);
      try {
        const cards = await host.refs.linksTo(planRef(item.id));
        if (cards.length) { state.links.set(item.id, cards); changed = true; }
      } catch (err) { /* nothing links to it */ }
    }
    if (changed) redraw();
  }
  if (host.on) host.on('links', () => { asked.clear(); state.links.clear(); loadLinks().catch(() => {}); });

  // --- the item menu, and moving ------------------------------------------------------------------------------

  // Where an item is, as the menu's Move to value: its joint on the line, or its day.
  const placeOf = (item) => { const j = plan.jointOf(item); return j === null ? { date: plan.dayOf(item) } : { after: j }; };
  function openMenu(id, button) {
    const menu = $('item-menu');
    state.menuFor = id;
    const item = plan.list().find((i) => i.id === id);
    if (!item) return;
    const select = $('menu-day');
    placeOptions(select, { jointsOnly: item.kind === 'lane' });
    select.value = placeValue(placeOf(item));
    const follow = menu.querySelector('[data-action="follow"]');
    hide(follow, item.kind !== 'link');
    // A link that cannot be read has nothing to edit.
    hide(menu.querySelector('[data-action="edit"]'), item.kind === 'link' && Boolean(linkState(item.ref && plan.cards.get(host.util.refKey(item.ref)))));
    fill(follow, { 'follow-label': item.follow ? 'Stop following its result' : 'Follow its result' });
    // A time block can change its type; it is removed rather than deleted.
    const isBlock = item.kind === 'block' || item.kind === 'lane';
    // Back to the line: for an item on a day (not a marker between days, which is never on one).
    hide(menu.querySelector('[data-action="to-line"]'), plan.jointOf(item) !== null);
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
    // Under the button, or above it when there is no room below (the last card of the plan, near the pane's bottom).
    let top = Math.round(b.bottom - app.top + 4);
    if (top + menu.offsetHeight > app.height - 8) top = Math.max(8, Math.round(b.top - app.top - menu.offsetHeight - 4));
    menu.style.top = `${top}px`;
    menu.style.left = `${Math.max(8, Math.min(Math.round(b.right - app.left - menu.offsetWidth), Math.round(app.width - menu.offsetWidth - 8)))}px`;
  }
  const closeMenu = () => { $('item-menu').hidden = true; state.menuFor = null; };

  // Deleting a leg of a round trip asks which: both legs, only this one (only the outbound: the return keeps the booking details),
  // or neither. Anchored to the button that asked. False when the item is not a leg of a round trip.
  function askDeleteLegs(id, anchor, before) {
    const item = plan.list().find((i) => i.id === id);
    if (!item || item.kind !== 'journey') return false;
    const isReturn = Boolean(plan.outboundFor(item));
    if (!isReturn && !plan.returnFor(id)) return false;
    const run = (both) => () => { if (before) before(); attempt(() => plan.removeLeg(id, both)); };
    host.menu.show({
      id: `delete-legs-${id}`,
      anchor,
      items: [
        { id: 'both', label: 'Delete both legs', icon: 'trash', danger: true, onClick: run(true) },
        { id: 'this', label: 'Delete only this leg', icon: 'trash', hint: isReturn ? 'The outbound stays.' : 'The return stays, with the booking details.', onClick: run(false) },
        { id: 'cancel', label: 'Cancel', icon: 'xmark', onClick: () => {} },
      ],
    });
    return true;
  }

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
      return void attempt(() => plan.nudgeItem(id, action === 'earlier' ? -1 : 1));
    }
    if (action === 'follow') {
      const item = plan.list().find((i) => i.id === id);
      closeMenu();
      return void attempt(() => plan.updateItem(id, { follow: !(item && item.follow) }));
    }
    if (action === 'to-line') {
      // Off its day, onto the line at the joint before that day: near where it was, no longer decided.
      const item = plan.list().find((i) => i.id === id);
      closeMenu();
      if (!item) return;
      const days = plan.days();
      const after = days[days.indexOf(plan.dayOf(item)) - 1] || '';
      return void attempt(() => plan.moveToJoint(id, after, 1e6));
    }
    if (action === 'delete') {
      if (askDeleteLegs(id, b, closeMenu)) return;
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
    const place = parsePlace(e.target.value);
    closeMenu();
    if (!id) return;
    attempt(() => (place.after !== undefined ? plan.moveToJoint(id, place.after, 1e6) : plan.moveTo(id, place.date, 1e6)));
  });
  root.addEventListener('click', (e) => { if (!$('item-menu').hidden && !e.target.closest('#item-menu, [data-action="move-menu"]')) closeMenu(); });

  // --- dragging (desktop) --------------------------------------------------------------------------------------

  let dragId = null;
  let lastTarget = null;
  // While anything is over the plan, every joint opens into a drop zone on the line (.days.dragging-line). Closing them
  // moves everything below the first joint up, so it must not happen between the last "over" and the drop: a drop
  // is hit-tested against the layout the pointer saw. `leave` (which the drop is sent right after) closes them a tick later.
  const openJoints = () => { const days = root.querySelector('.days'); if (days) days.classList.add('dragging-line'); };
  const closeJoints = () => { for (const d of root.querySelectorAll('.days.dragging-line')) d.classList.remove('dragging-line'); };
  const clearDrop = (keepJoints) => {
    if (lastTarget) lastTarget.removeAttribute('data-drop');
    lastTarget = null;
    for (const d of root.querySelectorAll('.day2.drop-target, .joint.drop-target, .timeline.between.drop-target')) d.classList.remove('drop-target');
    for (const d of root.querySelectorAll('.row.entry.dragging')) d.classList.remove('dragging');
    if (!keepJoints) closeJoints();
  };
  // Where a point on the page is on the plan: at a joint on the line (`after`; `el` is the list of items there or the + itself) or
  // on a day (`date`; `el` the day), and either way the entry under the pointer and whether the pointer is in its top or bottom
  // half. Null off both.
  function spotFrom(el, clientY) {
    if (!el || !el.closest) return null;
    const half = (row) => { const r = row.getBoundingClientRect(); return clientY < r.top + r.height / 2 ? 'before' : 'after'; };
    const line = el.closest('.joint, .timeline.between');
    if (line) {
      const row = el.closest('.timeline.between .row.entry');
      return { after: line.dataset.after, el: line, row, where: row ? half(row) : null };
    }
    const dayEl = el.closest('.day2');
    if (!dayEl) return null;
    const row = el.closest('.day2 .row.entry');
    return { date: dayEl.dataset.day, el: dayEl, row, where: row ? half(row) : null };
  }
  // Light a spot as the drop target, with the entry under the pointer and the side the item would go on.
  function showSpot(spot, movingId) {
    if (!spot) return;
    spot.el.classList.add('drop-target');
    if (spot.row && spot.row.dataset.id !== movingId) { spot.row.dataset.drop = spot.where; lastTarget = spot.row; }
  }
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
    openJoints();
  });
  root.addEventListener('dragend', () => {
    for (const li of root.querySelectorAll('.row.entry.dragging, .row.entry[draggable="true"]')) { li.classList.remove('dragging'); li.draggable = false; }
    dragId = null;
    clearDrop();
  });
  root.addEventListener('dragover', (e) => {
    if (!dragId) return;
    const spot = spotFrom(e.target, e.clientY);
    if (!spot) return;
    e.preventDefault();
    clearDrop(true);
    openJoints();
    showSpot(spot, dragId);
  });
  root.addEventListener('drop', (e) => {
    if (!dragId) return;
    e.preventDefault();
    const spot = spotFrom(e.target, e.clientY);
    const id = dragId;
    clearDrop();
    if (spot) attempt(() => moveOwn(id, spot));
  });

  // Where an item of the plan is put when it is dropped. At a joint on the line: among the items there, before or after the one
  // under the pointer, else last. On a day: an item with no time is placed in the order of the day's untimed ones; an item with a
  // time keeps it when it goes to another day, and, dropped between two others on the same day, takes the end of the item before it
  // as its time (nothing changes if that one has no time). A marker between days only ever goes to a joint.
  function moveOwn(id, spot) {
    const item = plan.list().find((i) => i.id === id);
    if (!item || !spot) return null;
    const overId = spot.row && spot.row.dataset.id !== id ? spot.row.dataset.id : null;
    if (spot.after !== undefined) {
      const others = plan.atJoint(spot.after).filter((i) => i.id !== id);
      const at = overId ? others.findIndex((i) => i.id === overId) : -1;
      return plan.moveToJoint(id, spot.after, at >= 0 ? at + (spot.where === 'after' ? 1 : 0) : others.length);
    }
    if (item.kind === 'lane') return null;
    const date = spot.date;
    const sameDay = plan.dayOf(item) === date;
    if (item.time) {
      if (!sameDay || !overId) return sameDay ? null : plan.moveTo(id, date, 1e6);
      const rows = [...spot.el.querySelectorAll('.row.entry')].filter((r) => r.dataset.id !== id);
      const prevRow = spot.where === 'after' ? spot.row : rows[rows.indexOf(spot.row) - 1];
      const prev = prevRow && plan.list().find((i) => i.id === prevRow.dataset.id);
      if (!prev || !prev.time) return null;
      const end = minutesOfDay(prev.time) + (prev.minutes || 30);
      return end < 24 * 60 ? plan.updateItem(id, { time: hm(end) }) : null;
    }
    const dayUntimed = sortDay(plan.sortable().filter((i) => !i.time && plan.dayOf(i) === date && i.id !== id));
    let index = dayUntimed.length;
    if (overId) {
      const at = dayUntimed.findIndex((i) => i.id === overId);
      if (at >= 0) index = at + (spot.where === 'after' ? 1 : 0);
    }
    return plan.moveTo(id, date, index);
  }

  // A pointer a shared plan may hold: a private item is copied to the room first (title, position and address, through a module that
  // offers to save a place), and the copy's pointer is used.
  async function sharedRef(ref) {
    if (ref.scope !== 'person') return ref;
    const card = await host.refs.resolve(ref);
    if (!card || card.error) throw new Error('That private item could not be read.');
    let add = null;
    try { add = (await host.actions.list()).find((a) => a.name === 'addPlace' && a.input && a.input.title); } catch (err) { add = null; }
    if (!add) throw new Error('That item is private to you. Share it to the space first, then use the shared copy.');
    const out = await host.actions.request(add.action, { title: card.title, ...(card.subtitle ? { address: card.subtitle } : {}), ...(card.place ? { lat: card.place.lat, lng: card.place.lng } : {}) }, { wait: true });
    if (out.status === 'done' && out.result && out.result.ok && out.result.ref) return out.result.ref;
    throw new Error('It could not be shared to the space.');
  }

  // Something dropped on the plan, by the pointer drag every module's items share: one of this plan's own items (pressed on its
  // body) moves to the day or the joint it lands on; another module's item or card is put there.
  if (host.refs && host.refs.dropTarget && canEdit) {
    const ownRef = (ref) => Boolean(ref) && ref.module === info.module.id && ref.kind === 'plan';
    const isLane = (ref) => { const it = plan.list().find((i) => i.id === ref.id); return Boolean(it) && it.kind === 'lane'; };
    // The pointer is in this module's own coordinates, a box in the page's.
    const pageY = (pt) => pt.y + host.rootElement.getBoundingClientRect().top;
    const spotAt = (pt) => spotFrom(host.refs.elementAt(pt), pageY(pt));
    // A marker between days is only ever on the line, so for it the joint nearest the pointer is the spot wherever the pointer is.
    const laneSpot = (pt, id) => {
      const y = pageY(pt);
      let best = null;
      for (const j of root.querySelectorAll('.joint')) {
        const r = j.getBoundingClientRect();
        const d = Math.abs(y - (r.top + r.height / 2));
        if (!best || d < best.d) best = { joint: j, d };
      }
      if (!best) return null;
      const spot = spotAt(pt);
      const inJoint = Boolean(spot) && spot.after === best.joint.dataset.after && Boolean(spot.row) && spot.row.dataset.id !== id;
      return { after: best.joint.dataset.after, el: best.joint, row: inJoint ? spot.row : null, where: inJoint ? spot.where : null };
    };
    const foreign = (ref, dragged) => (ref ? ref.module !== info.module.id : Boolean(dragged && dragged.card));
    host.refs.dropTarget({
      over: (pt, ref, dragged) => {
        clearDrop(true);
        if (!ownRef(ref) && !foreign(ref, dragged)) return closeJoints();
        openJoints();
        if (ownRef(ref)) {
          const me = root.querySelector(`.row.entry[data-id="${ref.id}"]`);
          if (me) me.classList.add('dragging');
          showSpot(isLane(ref) ? laneSpot(pt, ref.id) : spotAt(pt), ref.id);
          return;
        }
        const spot = spotAt(pt);
        if (spot) spot.el.classList.add('drop-target');
      },
      leave: () => { clearDrop(true); setTimeout(closeJoints, 0); },
      drop: (ref, pt, dragged) => {
        const spot = ownRef(ref) && isLane(ref) ? laneSpot(pt, ref.id) : spotAt(pt);
        clearDrop();
        if (!spot) return;
        if (ownRef(ref)) { attempt(() => moveOwn(ref.id, spot)); return; }
        if (!foreign(ref, dragged)) return;
        const place = spot.after !== undefined ? { after: spot.after } : { date: spot.date };
        const target = spot.row && spot.row.dataset.id ? planRef(spot.row.dataset.id) : null;
        attempt(async () => {
          // What can be done with it here is the shared decision (host.refs.dropMenu). This module's own offer puts it
          // on the day, or at the joint on the line: a pointer as a link, a card carried by the drag (an answer) as an item of
          // its own kind. The modules around add whatever they offer for an item of that kind, filled from the day and the
          // entry under the pointer. A private item (someone's own, in their profile) cannot be pointed at from a shared plan,
          // nor handed to another module here: only they could open it. So it is shared first, as a copy in the room, by
          // whichever module offers to save a place, and the plan points at the copy; nothing else is offered for it.
          const own = [{
            id: 'add',
            label: place.date ? `Put it on ${dayShort(place.date)}` : `Put it here, ${jointLabel(place.after).toLowerCase()}`,
            run: async (ctx) => (ref
              ? plan.addLink(await sharedRef(ref), place)
              : plan.addItem(plan.fromSuggestion({ title: ctx.card.title, kind: ctx.card.kind, content: ctx.card.text, place: ctx.card.place && ctx.card.place.name, ...place }))),
          }];
          if (ref && ref.scope === 'person') {
            const card = await host.refs.resolve(ref);
            if (!card || card.error) throw new Error('That private item could not be read.');
            await own[0].run({ card });
            return note('');
          }
          const chosen = await host.refs.dropMenu(dragged, pt, { context: { ...(place.date ? { date: place.date } : {}), ...(target ? { target } : {}) }, own, remember: target ? 'item' : place.date ? 'day' : 'joint' });
          note(chosen && chosen.id !== 'add' ? `${chosen.label}: done` : '');
        });
      },
    });
  }

  // An item of the trip can be dragged out to another module (a task links to it): pressing its body and moving. The
  // handle is the other drag (reordering), so a press there is left alone.
  if (host.refs && host.refs.draggable) {
    host.refs.draggable(root, (target) => {
      const li = target.closest && target.closest('.row.entry');
      if (!li || !li.dataset.id || target.closest('.rail, .menu-btn, button, input, select, textarea, a')) return null;
      const item = plan.list().find((i) => i.id === li.dataset.id);
      return item ? { kind: 'plan', id: item.id, label: item.title || 'Trip item' } : null;
    });
  }

  // An item that follows another module's item (a poll): when that item reports how it turned out, keep the result on
  // the item and, when it says which day, put a stop there. Whichever page records it first does it, once.
  if (host.events && host.events.subscribe) {
    host.events.subscribe(async (e) => {
      const summary = e.data && typeof e.data.summary === 'string' ? e.data.summary.slice(0, 200) : '';
      if (!e.ref || !summary) return;
      const k = host.util.refKey(e.ref);
      for (const item of plan.list().filter((i) => i.kind === 'link' && i.follow && i.ref && host.util.refKey(i.ref) === k)) {
        const fired = Number(e.id) || Date.now();
        if (item.fired === fired) continue;
        try { await plan.updateItem(item.id, { result: summary, fired }); } catch (err) { continue; }
        const date = e.data.date && /^\d{4}-\d{2}-\d{2}$/.test(String(e.data.date)) ? String(e.data.date) : null;
        try {
          if (e.data.pick && e.data.pick.module) await plan.addLink(e.data.pick, { date });
          else if (date) await plan.addItem({ kind: 'stop', title: summary, date, notes: `From ${item.title || 'a linked item'}` });
        } catch (err) { /* the result is kept either way */ }
      }
    });
  }

  // --- the editor ---------------------------------------------------------------------------------------------

  // A placeholder for the title of each kind of thing.
  const TITLES = { flight: 'Flight to Lisbon', train: 'Train to Porto', ferry: 'Ferry to the island', bus: 'Bus to the airport', car: 'Rental car', taxi: 'Taxi to the hotel', rideshare: 'Ride to the airport', shuttle: 'Shuttle to the airport', hotel: 'Hotel Avenida', restaurant: 'Dinner at Cervejaria Ramiro', cafe: 'Coffee at the pier', bar: 'Drinks at the rooftop', sight: 'Belem Tower', museum: 'The tile museum', tour: 'Walking tour', show: 'Fado night', note: 'Remember to...' };
  // The earliest a stay can check out: the day after it checks in (the editor's day), or any day while it has none. A date of its
  // own rather than a list of the trip's days, so a stay can check out after the trip's last day, and it follows the check-in.
  function checkoutMin() {
    const input = $('f-checkout');
    if (!input) return;
    const { date } = parsePlace($('f-date').value);
    input.min = date ? ymd(new Date(parseYmd(date).getFullYear(), parseYmd(date).getMonth(), parseYmd(date).getDate() + 1)) : '';
  }
  // A length in the editor is hours and minutes side by side; stored, it stays whole minutes.
  const setLength = (hoursId, minutesId, total) => { const p = splitMinutes(total); $(hoursId).value = p.hours ?? ''; $(minutesId).value = p.minutes ?? ''; };
  const lengthOf = (hoursId, minutesId) => (shown(minutesId) ? joinMinutes(num(hoursId), num(minutesId)) : null);
  // A length typed past the longest an item can have (7 days), which would otherwise be cut when stored.
  const tooLong = (hoursId, minutesId) => shown(minutesId) && (num(hoursId) || 0) * 60 + (num(minutesId) || 0) > MAX_MINUTES;
  // Under a journey's departure: when it arrives, from its departure time and how long it takes.
  function showArrival() {
    arrivalInto('f-arrives', 'f-time', 'f-hours', 'f-minutes');
    arrivalInto('f-back-arrives', 'f-back-time', 'f-back-hours', 'f-back-minutes');
  }
  function arrivalInto(outId, timeId, hoursId, minutesId) {
    const out = $(outId);
    if (!out) return;
    const t = $(timeId).value;
    const m = lengthOf(hoursId, minutesId);
    const a = t && m && !tooLong(hoursId, minutesId) ? arrivalOf({ time: t, minutes: m }) : null;
    out.textContent = a ? `Arrives ${[tt(a.time), laterText(a.days)].filter(Boolean).join(' ')}` : '';
    out.hidden = !a;
  }
  // What the shared fields are called for each kind of thing: a stay checks in, a flight departs, a taxi picks up.
  const FIELD_WORDS = {
    hotel: { date: 'Check in', time: 'Check-in time' },
    flight: { date: 'Departure day', time: 'Departure time', length: 'Flight time', operator: 'Airline', number: 'Flight number', from: 'Departs from', to: 'Arrives at' },
    train: { date: 'Departure day', time: 'Departure time', length: 'Travel time', operator: 'Train company', number: 'Train number', from: 'Departs from', to: 'Arrives at' },
    ferry: { date: 'Departure day', time: 'Departure time', length: 'Travel time', from: 'Departs from', to: 'Arrives at' },
    bus: { date: 'Departure day', time: 'Departure time', length: 'Travel time', from: 'Departs from', to: 'Arrives at' },
    shuttle: { date: 'Departure day', time: 'Departure time', length: 'Travel time', from: 'Departs from', to: 'Arrives at' },
    car: { date: 'Pick-up day', time: 'Pick-up time', operator: 'Rental company' },
    taxi: { time: 'Pick-up time', length: 'Travel time', from: 'Pick up at', to: 'Drop off at' },
    rideshare: { time: 'Pick-up time', length: 'Travel time', from: 'Pick up at', to: 'Drop off at' },
  };
  const FIELD_DEFAULTS = { date: 'When', time: 'Time', length: 'How long', operator: 'Company', number: 'Number', from: 'From', to: 'To' };
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
    placeOptions($('f-date'), { jointsOnly: key === 'lane' }); // a marker between days is only ever at a joint on the line
    const noLength = ['block:meet-up', 'block:leave-by'].includes(tile); // a moment, not a stretch of time
    const lengthLabel = $('f-minutes').closest('label');
    if (lengthLabel) lengthLabel.hidden = noLength;
    // The same fields in each kind's own words (a stay's day is its check-in, a flight's time its departure).
    const labels = { ...FIELD_DEFAULTS, ...(FIELD_WORDS[key] || {}) };
    for (const [name, id] of [['date', 'f-date-label'], ['time', 'f-time-label'], ['length', 'f-minutes-label'], ['operator', 'f-operator-label'], ['number', 'f-number-label'], ['from', 'f-from-label'], ['to', 'f-to-label'], ['time', 'f-back-time-label'], ['length', 'f-back-minutes-label'], ['number', 'f-back-number-label'], ['from', 'f-back-from-label'], ['to', 'f-back-to-label']]) if ($(id)) $(id).textContent = labels[name];
    roundTripShown();
    showArrival();
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

  // `place` for a new item: `{ date }` a day, `{ after }` a joint on the line; none is the head of the line.
  function openEditor(mode, item, place) {
    if (!canEdit) return;
    const isLink = Boolean(item && item.kind === 'link');
    state.editing = { mode, id: item ? item.id : null, place: place || null, version: item ? plan.versionOf(item.id) : null, tile: 'sight', isLink };
    $('editor').replaceChildren(clone(mode === 'trip' ? 'tpl-editor-trip' : 'tpl-editor2'));
    $('f-error').hidden = true;
    if (mode === 'trip') {
      const t = plan.trip || {};
      $('editor-title').textContent = plan.trip ? 'Edit the trip' : 'Plan a trip';
      $('f-title').value = t.title || '';
      $('f-destination').value = t.destination || '';
      $('f-start').value = t.start || '';
      $('f-end').value = t.end || '';
      host.ui.currencySelect($('f-currency'), { value: t.currency || '', empty: true }); // "" is the server's currency
      $('f-notes').value = t.notes || '';
      $('f-by').textContent = '';
    } else {
      addBlockTiles();
      $('editor-title').textContent = item ? 'Edit' : 'Add to the plan';
      hide($('f-types'), Boolean(item) && isLink);
      hide($('f-delete'), !item);
      applyType(item ? tileOf(item) || 'sight' : 'sight');
      $('f-date').value = placeValue(item ? placeOf(item) : place);
      checkoutMin();
      const v = item || {};
      setVal('f-checkout', v.checkOut);
      setVal('f-checkOutTime', v.checkOutTime);
      $('f-time').value = v.time || '';
      setLength('f-hours', 'f-minutes', v.minutes);
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
      setLength('f-travelHours', 'f-travelMinutes', v.travelMinutes);
      openReturn(item);
      showArrival();
      $('f-by').textContent = item && item.by ? `Added by ${item.by}` : '';
    }
    hydrate($('editor'));
    $('editor').hidden = false;
    $('f-title').focus();
  }
  // Either leg of a round trip opens the one editor with both legs; the outbound's fields are the main ones.
  const openItemEditor = (id) => {
    const item = plan.list().find((i) => i.id === id);
    if (!item) return;
    openEditor('item', plan.outboundFor(item) || item);
    if (state.editing) state.editing.openedId = id;
  };

  // --- a round trip in the editor ---
  // The switch shows the return's fields; an existing pair fills them from its return.
  const roundTripOn = () => Boolean($('f-roundtrip')) && shown('f-roundtrip') && $('f-roundtrip').checked;
  function roundTripShown() {
    const ed = state.editing;
    if (!$('f-roundtrip') || !ed) return;
    const on = roundTripOn();
    hide($('f-return'), !on);
    hide($('f-booking-both'), !on);
    hide($('f-roundtrip-note'), !ed.removeReturn);
    $('f-roundtrip-note').textContent = ed.removeReturn ? 'The return leg is deleted when you save.' : '';
    $('f-back-title').placeholder = backTitle();
  }
  // A return's title when none is given: "Flight to London", else "Return: <the outbound's title>".
  function backTitle() {
    const kicker = KICKERS[state.editing && fromTile(state.editing.tile).mode] || 'Return';
    const to = $('f-back-to').value.trim() || $('f-back-toCode').value.trim();
    return to ? `${kicker} to ${to}` : `Return: ${$('f-title').value.trim() || 'the outbound'}`;
  }
  function openReturn(item) {
    const ed = state.editing;
    const back = item && item.kind === 'journey' ? plan.returnFor(item.id) : null;
    ed.backId = back ? back.id : null;
    ed.backVersion = back ? plan.versionOf(back.id) : null;
    ed.removeReturn = false;
    placeOptions($('f-back-date'));
    $('f-roundtrip').checked = Boolean(back);
    if (back) {
      $('f-back-title').value = back.title;
      $('f-back-date').value = placeValue(placeOf(back));
      $('f-back-time').value = back.time || '';
      setLength('f-back-hours', 'f-back-minutes', back.minutes);
      for (const f of ['number', 'fromCode', 'toCode', 'from', 'to', 'seat']) setVal(`f-back-${f}`, back[f]);
    }
    const extra = item ? plan.extraReturns(item.id) : [];
    hide($('f-extra'), !extra.length);
    roundTripShown();
  }
  // Turning the switch on for a new return fills it from the outbound, the ends swapped, on the trip's last day (or the outbound's
  // own when that is later). Turning it off on an existing pair asks first; the return is deleted when the editor saves.
  function roundTripSwitched(input) {
    const ed = state.editing;
    if (!ed) return;
    if (input.checked) {
      ed.removeReturn = false;
      if (!ed.backId && !$('f-back-from').value && !$('f-back-to').value && !$('f-back-fromCode').value && !$('f-back-toCode').value) {
        $('f-back-from').value = $('f-to').value;
        $('f-back-to').value = $('f-from').value;
        $('f-back-fromCode').value = $('f-toCode').value;
        $('f-back-toCode').value = $('f-fromCode').value;
        const days = plan.days();
        const { date } = parsePlace($('f-date').value);
        const last = days[days.length - 1];
        $('f-back-date').value = placeValue({ date: date && last && date > last ? date : last || date });
      }
      return roundTripShown();
    }
    if (!ed.backId) return roundTripShown();
    input.checked = true; // until the question is answered
    host.menu.show({
      id: 'remove-return',
      anchor: input.closest('label'),
      items: [
        { id: 'remove', label: 'Remove the return leg', hint: 'It is deleted when you save.', icon: 'trash', danger: true, onClick: () => { input.checked = false; ed.removeReturn = true; roundTripShown(); } },
        { id: 'keep', label: 'Keep it', icon: 'xmark', onClick: () => {} },
      ],
    });
  }
  // The return's own fields, from the editor. It shares the outbound's way of travelling, company, class and people.
  function returnFields(out) {
    return {
      kind: 'journey',
      confirm: '', // the outbound holds the booking details
      cost: null,
      paidBy: '',
      category: 'travel',
      mode: out.mode,
      title: $('f-back-title').value.trim() || backTitle(),
      ...placeFields(parsePlace($('f-back-date').value)),
      time: $('f-back-time').value || null,
      minutes: lengthOf('f-back-hours', 'f-back-minutes'),
      number: get('f-back-number'),
      seat: get('f-back-seat'),
      fromCode: get('f-back-fromCode'),
      toCode: get('f-back-toCode'),
      from: get('f-back-from'),
      to: get('f-back-to'),
      operator: out.operator || '',
      travelClass: out.travelClass || '',
      owners: out.owners || [],
    };
  }
  // Whether a patch would change what is stored for an item.
  const changes = (item, patch) => JSON.stringify(cleanItem({ ...item, ...patch, id: item.id })) !== JSON.stringify(item);
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
      if (tooLong('f-hours', 'f-minutes') || tooLong('f-travelHours', 'f-travelMinutes') || (roundTripOn() && tooLong('f-back-hours', 'f-back-minutes'))) return fail('A length can be at most 7 days (168 hours).');
      const common = {
        title: $('f-title').value.trim(),
        ...placeFields(parsePlace($('f-date').value)),
        notes: $('f-notes').value.trim(),
        owners: [...$('f-owners').querySelectorAll('input:checked')].map((i) => i.value),
        travelMode: shown('f-travelMode') ? chosenMode() : null,
        travelMinutes: lengthOf('f-travelHours', 'f-travelMinutes'),
        cost: num('f-cost'),
      };
      common.paidBy = common.cost ? $('f-paidBy').value : '';
      let fields;
      if (ed.isLink) {
        fields = { ...common, kind: 'link', time: $('f-time').value || null, minutes: lengthOf('f-hours', 'f-minutes') };
      } else {
        const t = fromTile(ed.tile, item);
        // A round trip stays a journey other than a car: its return is removed first, with the switch.
        if (ed.backId && !ed.removeReturn && !roundTripOn()) return fail('Only a journey other than a car can be a round trip. Choose one, or turn off Round trip first.');
        if (t.kind === 'lane') { common.date = null; common.travelMode = null; common.travelMinutes = null; common.owners = []; common.cost = null; common.paidBy = ''; }
        // A time block or a marker between days can be left untitled in the form (the type's own label is its
        // placeholder, shown greyed until someone types over it): store that label as the real title rather than
        // leaving the field empty, so the item has a real name anywhere it is shown generically (Assistant's
        // context picker, a ref search, a backlink), not just in this module's own rendering, which already
        // falls back to the type's label on its own.
        if ((t.kind === 'lane' || t.kind === 'block') && !common.title) common.title = markerType(t.type).label;
        fields = { ...common, ...t, time: shown('f-time') ? $('f-time').value || null : t.kind === 'stay' && item ? item.time : null, minutes: ['block:meet-up', 'block:leave-by'].includes(ed.tile) || ed.tile.startsWith('lane:') ? null : lengthOf('f-hours', 'f-minutes') };
        if (t.kind === 'journey') {
          for (const f of ['operator', 'number', 'from', 'to', 'pickup', 'dropoff', 'terminal', 'platform', 'carriage', 'seat', 'travelClass']) fields[f] = get(`f-${f}`);
          fields.fromCode = get('f-fromCode');
          fields.toCode = get('f-toCode');
          fields.gate = get('f-gate');
          fields.confirm = get('f-confirm');
          // The editor always saves the main leg as a first leg (a return whose outbound is gone becomes a one-way journey).
          fields.legOf = null;
        } else if (t.kind === 'stay') {
          fields.checkOut = $('f-checkout').value || null;
          if (fields.checkOut && !fields.date) return fail('Choose the day it checks in.');
          if (fields.checkOut && fields.checkOut <= fields.date) return fail('Check out is on or before check in.');
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
      const round = fields.kind === 'journey' && roundTripOn();
      const back = round ? returnFields(fields) : null;
      if (item) {
        // Each leg that changed is written with its own version; a conflict is shown on that leg. Someone changed it since this
        // editor opened (the change has already arrived): do not write over it.
        let conflicted = false;
        const write = async (id, version, patch) => {
          const cur = plan.list().find((i) => i.id === id);
          if (!cur || !changes(cur, patch)) return;
          try {
            if (plan.versionOf(id) !== version) throw Object.assign(new Error('changed'), { conflict: true });
            await plan.updateItem(id, patch);
          } catch (err) {
            if (!err.conflict) throw err;
            state.conflicts.set(id, { patch });
            conflicted = true;
          }
        };
        await write(item.id, ed.version, fields);
        if (round && ed.backId && plan.list().some((i) => i.id === ed.backId)) await write(ed.backId, ed.backVersion, { ...back, legOf: item.id });
        else if (round) await plan.addItem({ ...back, legOf: item.id });
        else if (ed.backId && ed.removeReturn) await plan.removeItem(ed.backId);
        if (conflicted) { closeEditor(); return redraw(); }
      } else if (round) {
        await plan.addRoundTrip(fields, back);
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
  // A journey's arrival follows its departure and length as they are typed; a stay's checkout follows its check-in day.
  $('editor').addEventListener('input', (e) => {
    if (['f-time', 'f-hours', 'f-minutes', 'f-back-time', 'f-back-hours', 'f-back-minutes'].includes(e.target.id)) showArrival();
    if (['f-title', 'f-back-to', 'f-back-toCode'].includes(e.target.id) && $('f-back-title')) $('f-back-title').placeholder = backTitle();
  });
  $('editor').addEventListener('change', (e) => {
    if (e.target.id === 'f-date') checkoutMin();
    if (e.target.id === 'f-roundtrip') roundTripSwitched(e.target);
  });
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
    if (b.id === 'f-extra-delete') {
      const ed = state.editing;
      const extra = ed && ed.id ? plan.extraReturns(ed.id) : [];
      hide($('f-extra'), true);
      if (extra.length) attempt(() => plan.removeItem(extra[extra.length - 1].id));
      return;
    }
    if (b.id === 'f-delete') {
      const ed = state.editing;
      if (!ed || !ed.id) return;
      if (askDeleteLegs(ed.openedId || ed.id, b, closeEditor)) return;
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
    } else if (action === 'move-menu' && (li || b.dataset.id)) {
      openMenu(li ? li.dataset.id : b.dataset.id, b); // a row's "...", or a day tag itself
    } else if (action === 'remove-link' && li) {
      const id = li.dataset.id;
      attempt(() => plan.removeItem(id));
    } else if (action === 'open') {
      const item = li ? plan.list().find((i) => i.id === li.dataset.id) : null;
      const ref = item && item.ref ? item.ref : b.dataset.ref ? JSON.parse(b.dataset.ref) : null;
      if (ref) host.refs.open(ref).catch((err) => note(err.message));
    } else if (action === 'edit-item') {
      openItemEditor(b.dataset.id);
    } else if (action === 'edit-leg' && li) {
      openItemEditor(li.dataset.id);
    } else if (action === 'day-menu') {
      const dayEl = b.closest('.day2');
      if (dayEl) openAddMenu(b, { date: dayEl.dataset.day });
    } else if (action === 'gap-add') {
      openAddMenu(b, { after: jointOfButton(b) }, { gap: Boolean(b.closest('.gap')) });
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
      if (s && day) attempt(async () => { await plan.addLink(JSON.parse(s.dataset.ref), { date: day.dataset.day }); await plan.suggest(); });
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
    if (!text) return openEditor('item', null, { date: form.dataset.day });
    const parsed = host.util.parseWhen ? host.util.parseWhen(text) : { title: text };
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
  if (host.bar) {
    host.bar.set(canEdit ? [{ id: 'add', type: 'quickadd', label: 'Add to the plan', placeholder: 'Add to the trip: lunch at noon' }] : []).catch(() => { state.hosted = false; redraw(); });
    host.on('bar', (e) => {
      if (e.id !== 'add' || !canEdit) return;
      if (!plan.days().length) return openEditor('trip');
      const day = defaultDay();
      if (!e.value) return openEditor('item', null, { date: day });
      const parsed = host.util.parseWhen ? host.util.parseWhen(e.value) : { title: e.value };
      const named = parsed.date && plan.days().includes(parsed.date) ? parsed.date : day;
      attempt(() => plan.addItem({ kind: 'stop', title: parsed.title || e.value, date: named, time: parsed.time || null }));
    });
  }

  // The pane's width, not the window's: a bundled module runs in the page, so a media query would follow the window. The
  // stylesheet keys its narrow layout on `.app.narrow`. A frame can report no width while it is laid out, so wait for one.
  const fit = () => {
    const w = host.rootElement.clientWidth;
    if (w) { $('app').classList.toggle('narrow', w < 720); $('app').classList.toggle('tiny', w < 480); }
  };
  fit();
  new ResizeObserver(fit).observe(host.rootElement);

  plan.provide();
  plan.subscribe(() => { if (state.loaded) redraw(); });
  // What the plan points at can change or go where it lives without telling this page, so look again now and then and when the
  // page comes back into view (until the server announces it).
  const look = () => { if (state.loaded) plan.refreshCards().catch(() => {}); };
  const lookTimer = setInterval(() => { if (!host.rootElement.isConnected) clearInterval(lookTimer); else look(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) look(); });
  render();
  try {
    await plan.load();
    state.people = await host.people().catch(() => []);
    try { useMarkerTypes(await host.settings.get()); } catch (err) { useMarkerTypes(null); }
    host.settings.onChange((v) => { useMarkerTypes(v); if (state.loaded) redraw(); });
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
