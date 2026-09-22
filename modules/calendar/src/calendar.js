// Calendar module. One file of code for every place it shows: the server's own
// page, a room's docked pane or floating panel, and a window of its own. On the
// server page it holds the server's events and shows, read-only, the events of every
// room the viewer belongs to (each marked with its room's icon); in a room it holds
// that room's events and shows the server's beside them. The SDK (window.tavern) is injected by Tavern.
(async function () {
  'use strict';

  // This module runs in a frame (the SDK is a global) or in the page (its SDK is handed to its script);
  // either way it looks elements up in tavern.root, never in document, so it works in both.
  const tavern = (document.currentScript && document.currentScript.tavern) || window.tavern;
  const root = tavern.root;

  const $ = (id) => root.getElementById(id);
  const { esc, ymd, parseYmd } = tavern.util;

  let info;
  try {
    info = await tavern.ready();
  } catch (err) {
    $('msg').textContent = 'The calendar could not start: ' + err.message;
    return;
  }
  const inRoom = info.context.scope === 'room';
  // The person's own choice of the view to open on (Settings > Module settings).
  let prefs = {};
  try { prefs = await tavern.settings.get(); } catch (err) { prefs = {}; }
  const canEdit = tavern.can('edit');
  const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (err) { return undefined; } })();

  // Every event we know of, by "<scope>:<id>". `scope` is where it is stored: 'room'
  // (this room, or the server on the server page -- the frame's own context) or
  // 'server' (shown read-only in a room).
  const events = new Map();
  const roomInfo = new Map(); // room id -> { id, name, icon, svg }, on the server page
  const hiddenRooms = new Set(); // rooms filtered out on the server page
  let cursor = new Date();
  cursor = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  let view = ['month', 'week', 'both', 'list'].includes(prefs.defaultView) ? prefs.defaultView : 'month';
  let anchor = new Date(); // the day the week view is built around
  let editing = null; // { scope, id, version } while the editor is open

  /*__LIB__*/

  // Every occurrence of every event that touches [from, to), soonest first: one that began earlier
  // and runs into the range counts too.
  function inRange(from, to) {
    const out = [];
    for (const x of events.values()) {
      if (x.scope === 'rooms' && hiddenRooms.has(x.roomId)) continue;
      const dur = durationOf(x.ev);
      for (const start of occurrences(x.ev, new Date(from.getTime() - dur), to)) {
        const end = endOf(x.ev, start);
        if (end > from || start >= from) out.push({ x, start, end });
      }
    }
    return out.sort((a, b) => a.start - b.start);
  }

  // --- loading and live updates --------------------------------------------

  // scope 'rooms' is another room's event on the server page: read-only, kept by room and id.
  const keyOf = (scope, id, roomId) => (scope === 'rooms' ? `rooms:${roomId}:${id}` : `${scope}:${id}`);
  function remember(scope, item, roomId) {
    if (!item.key.startsWith('event:') || !item.value) return;
    const id = item.key.slice(6);
    const key = keyOf(scope, id, roomId);
    events.set(key, { key, scope, roomId, id, version: item.version, ev: item.value });
  }

  // A room's icon (inline SVG from Tavern) with its name for a tooltip.
  const roomIcon = (x) => {
    const r = x.scope === 'rooms' ? roomInfo.get(x.roomId) : null;
    return r && r.svg ? `<span class="ri" title="${esc(r.name)}">${r.svg}</span>` : '';
  };
  async function load() {
    events.clear();
    for (const item of await tavern.storage.list('event:')) remember('room', item);
    if (inRoom) {
      try {
        for (const item of await tavern.storage.list('event:', { scope: 'server' })) remember('server', item);
      } catch (err) {
        // guests and people without server access see just the room's events
      }
    } else if (info.context.scope === 'server') {
      // Every room the viewer belongs to that has the calendar on.
      try {
        for (const r of await tavern.rooms()) roomInfo.set(r.id, r);
        for (const item of await tavern.storage.list('event:', { scope: 'rooms' })) remember('rooms', item, item.roomId);
      } catch (err) {
        // no rooms is fine: just the server's own events
      }
    }
  }
  tavern.on('change', (e) => {
    if (!e.key.startsWith('event:')) return;
    const scope = e.scope === 'rooms' ? 'rooms' : e.scope === 'server' && inRoom ? 'server' : 'room';
    const id = e.key.slice(6);
    if (e.deleted) events.delete(keyOf(scope, id, e.roomId));
    else remember(scope, { key: e.key, value: e.value, version: e.version }, e.roomId);
    if (editing && editing.scope === scope && editing.id === id && e.by !== info.user.key) {
      showError('This event was just changed by someone else. Close and reopen it to see the change.');
    }
    render();
  });

  // --- drawing -------------------------------------------------------------

  const isCompact = () => $('app').classList.contains('compact');

  function chipHtml({ x, start, cont }) {
    // A multi-day event shows its time on the first day and an arrow on the days after.
    const label = cont ? '\u2192 ' + x.ev.title : (x.ev.allDay ? '' : timeText(start) + ' ') + x.ev.title;
    return `<button class="chip ${x.scope === 'server' && inRoom ? 'server' : ''}" data-open="${esc(x.key)}" title="${esc(x.ev.title)}">${roomIcon(x)}${x.ev.repeat ? '<span class="rep">&#8635;</span>' : ''}${esc(label)}</button>`;
  }

  function monthGrid() {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
    const gridEnd = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + 42);
    const byDay = new Map();
    for (const occ of inRange(gridStart, gridEnd)) {
      // Every day the occurrence covers, within the grid.
      const firstDay = startOfDay(occ.start);
      const lastDay = startOfDay(new Date(Math.max(occ.end.getTime() - 1, occ.start.getTime())));
      for (let d = firstDay < gridStart ? gridStart : firstDay; d <= lastDay && d < gridEnd; d = addDays(d, 1)) {
        const k = ymd(d);
        if (!byDay.has(k)) byDay.set(k, []);
        byDay.get(k).push({ ...occ, cont: d > firstDay });
      }
    }
    const today = ymd(new Date());
    let html = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div class="dow">${d}</div>`).join('');
    for (let i = 0; i < 42; i += 1) {
      const day = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      const list = byDay.get(ymd(day)) || [];
      const shown = isCompact() ? list : list.slice(0, 3);
      html += `<div class="day ${day.getMonth() !== cursor.getMonth() ? 'other' : ''} ${ymd(day) === today ? 'today' : ''}" data-day="${ymd(day)}">
        <span class="n">${day.getDate()}</span><div class="chips">${shown.map(chipHtml).join('')}</div>
        ${shown.length < list.length ? `<span class="more">+${list.length - shown.length} more</span>` : ''}</div>`;
    }
    return `<div class="month">${html}</div>`;
  }

  // Occurrences as a list grouped by day.
  function listHtml(occs, emptyText, floor) {
    if (!occs.length) return `<p class="empty">${emptyText}</p>`;
    const groups = new Map();
    for (const occ of occs) {
      // An event that began before the list does starts it on the list's first day.
      const k = ymd(occ.start < floor ? floor : occ.start);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(occ);
    }
    return `<div class="list">${[...groups.values()].map((g) => `<div class="group"><h4>${esc(dayHeading(g[0].start < floor ? floor : g[0].start))}</h4>${g.map(({ x, start, end }) => `
      <button class="item" data-open="${esc(x.key)}"><span class="when">${esc(whenText(x.ev, start, end))}</span>
        <span class="what"><strong>${esc(x.ev.title)}${x.ev.repeat ? `<span class="tag">${esc(REPEAT_NAMES[x.ev.repeat.every] || 'repeats')}</span>` : ''}${x.scope === 'server' && inRoom ? '<span class="tag">server</span>' : ''}${x.scope === 'rooms' && roomInfo.get(x.roomId) ? `<span class="tag room">${roomIcon(x)} ${esc(roomInfo.get(x.roomId).name)}</span>` : ''}</strong>${x.ev.desc ? `<span>${esc(x.ev.desc.slice(0, 120))}</span>` : ''}</span></button>`).join('')}</div>`).join('')}</div>`;
  }

  function monthList() {
    const from = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const to = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    return listHtml(inRange(from, to), `Nothing in ${cursor.toLocaleDateString([], { month: 'long' })}.${canEdit ? ' Add an event to get started.' : ''}`, from);
  }

  function upcomingList() {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + 90 * DAY);
    return listHtml(inRange(from, to).slice(0, 300), `Nothing coming up.${canEdit ? ' Add an event to get started.' : ''}`, from);
  }

  // The seven days (Sunday first, like the month grid) around the anchor day, each with its events in full.
  const weekStart = () => new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - anchor.getDay());
  function weekHtml() {
    const start = weekStart();
    const byDay = new Map();
    for (const occ of inRange(start, addDays(start, 7))) {
      const firstDay = startOfDay(occ.start);
      const lastDay = startOfDay(new Date(Math.max(occ.end.getTime() - 1, occ.start.getTime())));
      for (let d = firstDay < start ? start : firstDay; d <= lastDay && d < addDays(start, 7); d = addDays(d, 1)) {
        const k = ymd(d);
        if (!byDay.has(k)) byDay.set(k, []);
        byDay.get(k).push({ ...occ, cont: d > firstDay });
      }
    }
    const today = ymd(new Date());
    let html = '';
    for (let i = 0; i < 7; i += 1) {
      const day = addDays(start, i);
      const list = byDay.get(ymd(day)) || [];
      html += `<div class="day ${ymd(day) === today ? 'today' : ''}" data-day="${ymd(day)}"><span class="n">${esc(day.toLocaleDateString([], { weekday: 'short' }))} <b>${day.getDate()}</b></span><div class="chips">${list.map(chipHtml).join('')}</div></div>`;
    }
    return `<div class="week">${html}</div>`;
  }
  function weekTitle() {
    const s = weekStart();
    const e = addDays(s, 6);
    const m = (d) => d.toLocaleDateString([], { month: 'short' });
    return s.getMonth() === e.getMonth() ? `${m(s)} ${s.getDate()} \u2013 ${e.getDate()}, ${e.getFullYear()}` : `${m(s)} ${s.getDate()} \u2013 ${m(e)} ${e.getDate()}, ${e.getFullYear()}`;
  }

  // Month / Week / Month + list / List is the toolbar's view switch.
  const VIEWS = [
    { id: 'month', label: 'Month' },
    { id: 'week', label: 'Week' },
    { id: 'both', label: 'Month + list' },
    { id: 'list', label: 'List' },
  ];
  const viewSwitch = tavern.ui.viewSwitch({
    id: 'view',
    options: VIEWS,
    value: view,
    onChange: (id) => { view = id; render(); },
  });

  function render() {
    const compact = isCompact();
    const showNav = view !== 'list';
    $('prev').hidden = $('next').hidden = !showNav;
    viewSwitch.set(view);
    renderFilters();
    $('title').textContent = view === 'week' ? weekTitle() : view === 'list' ? 'Next 90 days' : cursor.toLocaleDateString([], { month: 'long', year: 'numeric' });
    if (view === 'week') {
      $('body').innerHTML = weekHtml();
    } else if (view === 'list') {
      $('body').innerHTML = upcomingList();
    } else if (compact || view === 'both') {
      // A narrow pane, or the Month + list view, shows the month on top and that month's events beneath.
      $('body').innerHTML = `<div class="stack">${monthGrid()}<div><h3 class="list-title">This month</h3>${monthList()}</div></div>`;
    } else {
      $('body').innerHTML = monthGrid();
    }
  }

  // On the server page, a row of the viewer's rooms to show or hide.
  function renderFilters() {
    const box = $('filters');
    box.hidden = roomInfo.size === 0;
    if (box.hidden) return;
    box.innerHTML = [...roomInfo.values()].map((r) => `<button type="button" class="filter ${hiddenRooms.has(r.id) ? '' : 'on'}" data-room="${esc(r.id)}" title="${hiddenRooms.has(r.id) ? 'Show' : 'Hide'} ${esc(r.name)}"><span class="ri">${r.svg || ''}</span> ${esc(r.name)}</button>`).join('');
  }
  $('filters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-room]');
    if (!b) return;
    if (hiddenRooms.has(b.dataset.room)) hiddenRooms.delete(b.dataset.room); else hiddenRooms.add(b.dataset.room);
    render();
  });

  // --- the editor -----------------------------------------------------------

  function showError(text) {
    $('f-error').textContent = text;
    $('f-error').hidden = !text;
  }

  function syncForm() {
    const all = $('f-allday').checked;
    $('f-time-wrap').hidden = all;
    $('f-end-wrap').hidden = all;
    $('f-until-wrap').hidden = $('f-repeat').value === '';
  }
  $('f-allday').addEventListener('change', syncForm);
  $('f-repeat').addEventListener('change', syncForm);

  function remindHint() {
    $('f-remind-hint').textContent = $('f-remind').value === ''
      ? ''
      : (inRoom ? 'Everyone in this room' : 'Everyone on the server') + ' gets a notification, if they are allowed to see the calendar.';
  }
  $('f-remind').addEventListener('change', remindHint);

  // --- the date pickers ------------------------------------------------------
  // The shared picker from the SDK; the end and repeat-until fields can be cleared, and the picker on either
  // shows the event's span.
  const span = () => [$('f-date').value, $('f-end-date').value];
  const pickers = [
    tavern.ui.datePicker($('f-date'), { range: span }),
    tavern.ui.datePicker($('f-end-date'), { range: span, clearable: true }),
    tavern.ui.datePicker($('f-until'), { range: span, clearable: true }),
  ];

  // --- what links to an event, and being opened from a link -----------------------
  // Other modules (a to-do, say) can point at an event. Tavern tells this module what points at it
  // (tavern.refs.linksTo), only what the viewer may see, and a link to an event can ask for it to be
  // shown (tavern.refs.onOpen). Nothing here knows which modules those are.

  const whereFor = (x) => (x.scope === 'rooms' ? { room: x.roomId } : x.scope === 'server' && inRoom ? { scope: 'server' } : undefined);
  let backlinksFor = null; // the event key the shown backlinks are for
  async function showBacklinks(x) {
    backlinksFor = x ? x.key : null;
    $('f-links-wrap').hidden = true;
    if (!x || !tavern.refs || !tavern.refs.linksTo) return;
    let cards = [];
    try {
      cards = await tavern.refs.linksTo(tavern.refs.make('event', x.id, whereFor(x)));
    } catch (err) {
      cards = [];
    }
    if (backlinksFor !== x.key) return; // the editor moved on
    $('f-links').innerHTML = cards.map((c) => (c.open
      ? `<button type="button" class="link" data-ref="${esc(JSON.stringify(c.ref))}"><b>${esc(c.kindName || c.module.name)}</b> ${esc(c.title)}</button>`
      : `<span class="link"><b>${esc(c.kindName || c.module.name)}</b> ${esc(c.title)}</span>`)).join('');
    $('f-links-wrap').hidden = cards.length === 0;
  }
  $('f-links').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ref]');
    if (b && tavern.refs) tavern.refs.open(JSON.parse(b.dataset.ref)).catch((err) => showError(err.message));
  });
  // Opened at a place in the page (from the dashboard's month: "day=2026-09-24"): show that month with that day marked.
  if (tavern.page && tavern.page.onHash) {
    tavern.page.onHash((hash) => {
      const m = /(?:^|&)day=(\d{4}-\d{2}-\d{2})(?:&|$)/.exec(hash);
      if (!m) return;
      const d = parseYmd(m[1]);
      if (Number.isNaN(d.getTime())) return;
      cursor = new Date(d.getFullYear(), d.getMonth(), 1);
      anchor = d;
      view = 'month';
      render();
      const cell = root.querySelector(`.day[data-day="${m[1]}"]`);
      if (cell) {
        cell.classList.add('pick');
        cell.scrollIntoView({ block: 'center' });
        setTimeout(() => cell.classList.remove('pick'), 2500);
      }
    });
  }
  if (tavern.refs && tavern.refs.onOpen) {
    tavern.refs.onOpen((ref) => {
      const x = events.get(keyOf('room', ref.id)) || events.get(keyOf('server', ref.id)) || events.get(keyOf('rooms', ref.id, ref.room));
      if (!x) return;
      const d = startOf(x.ev);
      cursor = new Date(d.getFullYear(), d.getMonth(), 1);
      anchor = d;
      view = 'month';
      render();
      openEditor(x);
    });
    tavern.on('links', (e) => {
      if (e.ref && e.ref.kind === 'event' && editing && events.get(backlinksFor) && events.get(backlinksFor).id === e.ref.id) showBacklinks(events.get(backlinksFor));
    });
  }

  function openEditor(x, day, prefill) {
    const readOnly = !canEdit || (x && ((x.scope === 'server' && inRoom) || x.scope === 'rooms'));
    const ev = x ? x.ev : { title: '', allDay: false, start: '', end: null, desc: '', remind: null, repeat: null };
    editing = x ? { scope: x.scope, id: x.id, version: x.version } : { scope: 'room', id: null, version: null };
    showError('');
    const from = x && x.scope === 'rooms' && roomInfo.get(x.roomId) ? ` (${roomInfo.get(x.roomId).name})` : '';
    $('editor-title').textContent = x ? (readOnly ? ev.title + from : 'Edit event') : 'New event';
    $('f-title').value = ev.title;
    $('f-allday').checked = Boolean(ev.allDay);
    const start = x ? startOf(ev) : null;
    $('f-date').value = start ? ymd(start) : day || ymd(new Date());
    $('f-time').value = start && !ev.allDay ? `${pad(start.getHours())}:${pad(start.getMinutes())}` : '19:00';
    // The end: a date and time for a timed event, the last day for an all-day one.
    const endAt = ev.end && !ev.allDay ? new Date(ev.end) : null;
    $('f-end-date').value = ev.end ? (ev.allDay ? ev.end : ymd(endAt)) : '';
    $('f-end').value = endAt ? `${pad(endAt.getHours())}:${pad(endAt.getMinutes())}` : '';
    $('f-desc').value = ev.desc || '';
    $('f-remind').value = ev.remind === null || ev.remind === undefined ? '' : String(ev.remind);
    // A quick add fills in what it understood: the title, and a time when one was typed.
    if (!x && prefill) {
      if (prefill.title) $('f-title').value = prefill.title;
      if (prefill.time) { $('f-time').value = prefill.time; $('f-allday').checked = false; }
    }
    $('f-repeat').value = ev.repeat ? ev.repeat.every : '';
    $('f-until').value = ev.repeat && ev.repeat.until ? ev.repeat.until : '';
    for (const id of ['f-title', 'f-date', 'f-time', 'f-end-date', 'f-end', 'f-allday', 'f-desc', 'f-remind', 'f-repeat', 'f-until']) $(id).disabled = readOnly;
    $('f-save').hidden = readOnly;
    $('f-delete').hidden = readOnly || !x;
    $('f-delete').textContent = 'Delete';
    $('f-cancel').textContent = readOnly ? 'Close' : 'Cancel';
    syncForm();
    remindHint();
    pickers.forEach((p) => p.refresh());
    showBacklinks(x || null);
    $('editor').hidden = false;
    $(readOnly ? 'f-cancel' : 'f-title').focus();
  }
  function closeEditor() {
    pickers.forEach((p) => p.close());
    backlinksFor = null;
    $('editor').hidden = true;
    editing = null;
  }
  $('f-cancel').addEventListener('click', closeEditor);
  $('editor').addEventListener('click', (e) => { if (e.target === $('editor')) closeEditor(); });

  // A reminder is a schedule Tavern runs for us: at the right time it sends the
  // notification, and for a repeating event Tavern schedules the next one itself,
  // so reminders keep coming while this page is closed. It stops if the event
  // changes or goes away.
  async function applyReminder(id, ev) {
    const key = 'remind:' + id;
    const stop = () => tavern.cancelSchedule(key);
    try {
      if (ev.remind === null || ev.remind === undefined) return await stop();
      const lead = ev.remind * 60 * 1000;
      const nineAm = ev.allDay ? 9 * 60 * 60 * 1000 : 0; // an all-day event reminds relative to 9:00
      const now = Date.now();
      // The first occurrence whose reminder is not already in the past.
      const next = occurrences(ev, new Date(now + lead - 4 * 60 * 1000 - nineAm), new Date(now + 400 * DAY))[0];
      if (!next) return await stop();
      const at = next.getTime() + nineAm - lead;
      const until = ev.repeat && ev.repeat.until ? endOfDay(parseYmd(ev.repeat.until)).getTime() : null;
      if (until !== null && at > until) return await stop();
      const label = ev.remind === 0 ? 'Starting now' : ev.remind === 15 ? 'Starts in 15 minutes' : ev.remind === 60 ? 'Starts in an hour' : 'Starts tomorrow';
      await tavern.schedule({
        key,
        at,
        payload: { id },
        notify: { title: ev.title, body: label },
        repeat: ev.repeat ? { every: ev.repeat.every, until, tz: TZ } : undefined,
      });
    } catch (err) {
      showError('Saved, but the reminder could not be set: ' + err.message);
      throw err;
    }
  }

  async function save() {
    if (!editing) return;
    showError('');
    const title = $('f-title').value.trim();
    const date = $('f-date').value;
    if (!title || !date) return showError('A title and a date are needed.');
    const allDay = $('f-allday').checked;
    let start = date;
    let end = null;
    const endDate = $('f-end-date').value;
    if (allDay) {
      // An all-day event's end is its last day.
      if (endDate && endDate < date) return showError('The end is before the start.');
      if (endDate && endDate > date) end = endDate;
    } else {
      const time = $('f-time').value || '19:00';
      const s = new Date(`${date}T${time}`);
      if (Number.isNaN(s.getTime())) return showError('That time is not valid.');
      start = s.toISOString();
      // An end date, an end time, or both. Missing one takes the start's.
      if (endDate || $('f-end').value) {
        const t = new Date(`${endDate || date}T${$('f-end').value || time}`);
        if (Number.isNaN(t.getTime())) return showError('That end is not valid.');
        if (t < s) return showError('The end is before the start.');
        if (t > s) end = t.toISOString();
      }
    }
    const remind = $('f-remind').value === '' ? null : Number($('f-remind').value);
    let repeat = null;
    if ($('f-repeat').value) {
      const until = $('f-until').value || null;
      if (until && until < date) return showError('"Until" is before the first date.');
      repeat = { every: $('f-repeat').value, until };
    }
    const id = editing.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const ev = { id, title, allDay, start, end, desc: $('f-desc').value.trim(), remind, repeat, by: info.user.name };
    $('f-save').disabled = true;
    try {
      const saved = await tavern.storage.set('event:' + id, ev, editing.id ? { version: editing.version } : {});
      remember('room', { key: 'event:' + id, value: ev, version: saved.version });
      let reminderFailed = false;
      try { await applyReminder(id, ev); } catch (err) { reminderFailed = true; }
      render();
      if (!reminderFailed) closeEditor();
      else editing = { scope: 'room', id, version: saved.version };
    } catch (err) {
      showError(err.status === 409 ? 'Someone changed this event since you opened it. Close it and open it again.' : err.message);
    } finally {
      $('f-save').disabled = false;
    }
  }
  // Save on the button, and on Enter in a field. (The frame's own form-submit is
  // not relied on, so this works wherever a sandboxed frame blocks submitting.)
  $('f-save').addEventListener('click', save);
  $('form').addEventListener('submit', (e) => { e.preventDefault(); save(); });
  $('form').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return;
    e.preventDefault();
    save();
  });

  let deleteArmed = false;
  $('f-delete').addEventListener('click', async () => {
    if (!editing || !editing.id) return;
    if (!deleteArmed) {
      deleteArmed = true;
      const current = events.get(keyOf(editing.scope, editing.id));
      $('f-delete').textContent = current && current.ev.repeat ? 'Delete every one?' : 'Really delete?';
      setTimeout(() => { deleteArmed = false; $('f-delete').textContent = 'Delete'; }, 4000);
      return;
    }
    deleteArmed = false;
    try {
      await tavern.storage.delete('event:' + editing.id);
      try { await tavern.cancelSchedule('remind:' + editing.id); } catch (err) { /* nothing to cancel */ }
      events.delete(keyOf(editing.scope, editing.id));
      closeEditor();
      render();
    } catch (err) {
      showError(err.message);
    }
  });

  // --- wiring ---------------------------------------------------------------

  // Previous and next step a month, or a week in the week view; the month and the week follow each other.
  const step = (n) => {
    if (view === 'week') anchor = addDays(anchor, 7 * n);
    else anchor = new Date(cursor.getFullYear(), cursor.getMonth() + n, 1);
    cursor = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    render();
  };
  $('prev').addEventListener('click', () => step(-1));
  $('next').addEventListener('click', () => step(1));
  $('today').addEventListener('click', () => { anchor = new Date(); cursor = new Date(anchor.getFullYear(), anchor.getMonth(), 1); render(); });
  $('add').addEventListener('click', () => openEditor(null));
  // The host draws the Add button in the module's action bar (in the room's bottom row when
  // docked); the button in the header stays only for a host without one.
  if (tavern.bar) {
    $('add').classList.add('hosted');
    tavern.bar.set(canEdit ? [{ id: 'add', type: 'quickadd', label: 'Add event', placeholder: 'Add an event: lunch fri at noon' }] : []).catch(() => $('add').classList.remove('hosted'));
    tavern.on('bar', (e) => {
      if (e.id !== 'add' || !canEdit) return;
      const q = e.value ? tavern.util.parseWhen(e.value) : {};
      openEditor(null, q.date, q);
    });
  }
  // An event can be dragged onto another module that links to events (a to-do, say): it carries a
  // pointer to the event, and the other module asks Tavern for what it may show.
  if (tavern.refs && tavern.refs.draggable) {
    tavern.refs.draggable($('body'), (target) => {
      const open = target.closest('[data-open]');
      const x = open && events.get(open.dataset.open);
      return x ? { kind: 'event', id: x.id, label: x.ev.title, ...whereFor(x) } : null;
    });
  }
  // --- what a drop can do ---------------------------------------------------
  // An item dropped from another module on a day, or on an event, offers what can be done with it. Some
  // of that is this module's own (make an event of it); the rest is whatever other modules say they can do
  // with an item of that kind and can be filled in from what this module has (the day, an event's pointer).
  // Nothing here names the module the item came from. More than one choice: the person is asked.
  let noteTimer = 0;
  function note(text, bad) {
    $('note').textContent = text;
    $('note').classList.toggle('bad', Boolean(bad));
    $('note').hidden = false;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { $('note').hidden = true; }, 4000);
  }
  async function createEventOn(title, date) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const ev = { id, title: String(title).slice(0, 120), allDay: true, start: date, end: null, desc: '', remind: null, repeat: null, by: info.user.name };
    const saved = await tavern.storage.set('event:' + id, ev, {});
    remember('room', { key: 'event:' + id, value: ev, version: saved.version });
    render();
    return { ref: tavern.refs.make('event', id) };
  }
  const dropSpot = (pt) => {
    const el = tavern.refs.elementAt(pt);
    if (!el) return null;
    const open = el.closest('[data-open]');
    const x = open && events.get(open.dataset.open);
    if (x) return { el: open, event: x, day: ymd(startOf(x.ev)) };
    const cell = el.closest('[data-day]');
    return cell ? { el: cell, event: null, day: cell.dataset.day } : null;
  };
  const clearDrop = () => { for (const e of root.querySelectorAll('.drop')) e.classList.remove('drop'); };
  async function offersFor(ref, spot, card) {
    const offers = [];
    if (spot.day && !spot.event) offers.push({ id: 'create', label: 'Add to the calendar as an event', hint: shortDay(parseYmd(spot.day)), run: () => createEventOn(card.title || ref.kind, spot.day) });
    let list = [];
    try { list = await tavern.actions.list({ accepts: ref.module + ':' + ref.kind }); } catch (err) { list = []; }
    for (const a of list) {
      const input = {};
      let ok = true;
      let dropped = false;
      for (const [field, type] of Object.entries(a.input)) {
        const optional = type.endsWith('?');
        const base = optional ? type.slice(0, -1) : type;
        if (base === 'ref:' + ref.module + ':' + ref.kind) { input[field] = ref; dropped = true; }
        else if (base === 'ref' && spot.event) input[field] = tavern.refs.make('event', spot.event.id, whereFor(spot.event));
        else if (base === 'date') input[field] = spot.day;
        else if (!optional) ok = false;
      }
      if (ok && dropped) offers.push({ id: a.action, label: a.label, hint: a.moduleName, run: () => tavern.actions.request(a.action, input).then(() => ({})) });
    }
    return offers;
  }
  if (tavern.refs && tavern.refs.dropTarget && tavern.actions) {
    tavern.refs.dropTarget({
      over: (pt, ref) => {
        clearDrop();
        if (!ref || ref.module === info.module.id || !canEdit) return;
        const spot = dropSpot(pt);
        if (spot) spot.el.classList.add('drop');
      },
      leave: clearDrop,
      drop: async (ref, pt) => {
        clearDrop();
        if (!ref || !canEdit) return;
        const spot = dropSpot(pt);
        tavern.refs.trace(spot ? 'drop on ' + (spot.event ? 'event ' + spot.event.id : 'day ' + spot.day) : 'drop: nothing under the pointer');
        if (!spot) return;
        try {
          const card = (await tavern.refs.resolve(ref)) || {};
          if (card.error) return note(card.error, true);
          const offers = await offersFor(ref, spot, card);
          tavern.refs.trace('offers: ' + offers.map((o) => o.label).join(' | '));
          if (!offers.length) return note('Nothing can be done with that here.', true);
          const chosen = await tavern.actions.pick(offers, pt, { remember: ref.module + ':' + ref.kind + ':' + (spot.event ? 'event' : 'day') });
          if (!chosen) return;
          await chosen.run();
          note(chosen.label + ': done');
        } catch (err) {
          note(err.message, true);
        }
      },
    });
  }
  // What other modules may ask of this one: put something on the calendar.
  if (tavern.actions && tavern.actions.provide) {
    tavern.actions.provide({
      createEvent: async (input) => {
        if (!canEdit) throw new Error('this person cannot add events here');
        return createEventOn(input.title, input.date);
      },
    });
  }
  $('body').addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    if (open) {
      const x = events.get(open.dataset.open);
      if (x) openEditor(x);
      return;
    }
    const day = e.target.closest('[data-day]');
    if (day && canEdit) openEditor(null, day.dataset.day);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('editor').hidden) closeEditor();
  });

  // A frame can report no width while it is still being laid out, so wait for a real
  // one before choosing the compact layout.
  const fit = () => {
    const w = tavern.rootElement.clientWidth;
    if (!w) return;
    $('app').classList.toggle('compact', w < 520);
  };
  new ResizeObserver(() => { fit(); render(); }).observe(tavern.rootElement);

  $('add').hidden = !canEdit;
  try {
    await load();
  } catch (err) {
    $('msg').textContent = 'The calendar could not load: ' + err.message;
    return;
  }
  $('msg').hidden = true;
  $('app').hidden = false;
  fit();
  render();

  // An event that has passed is announced once, for the modules that follow it (a task that is done when the
  // event is over, say). Whoever has the calendar open first after it ends announces it, marking the event so
  // nobody repeats it; moving the event clears the mark. Repeating events are not announced, and neither is
  // one that ended more than a week ago (so opening an old calendar announces nothing from long ago).
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const announcing = new Set();
  async function announceEnded() {
    if (!tavern.events || !canEdit) return;
    const now = Date.now();
    let sent = 0;
    for (const x of [...events.values()]) {
      if (x.scope !== 'room' || x.ev.repeat || x.ev.announced || announcing.has(x.id) || sent >= 5) continue;
      const ends = startOf(x.ev).getTime() + durationOf(x.ev);
      if (ends > now || now - ends > WEEK) continue;
      announcing.add(x.id);
      sent += 1;
      const ev = { ...x.ev, announced: true };
      try {
        const saved = await tavern.storage.set('event:' + x.id, ev, { version: x.version });
        remember('room', { key: 'event:' + x.id, value: ev, version: saved.version });
        const day = startOf(ev).toLocaleDateString([], { month: 'short', day: 'numeric' });
        await tavern.events.publish('ended', { ref: tavern.refs.make('event', x.id, whereFor(x)), data: { summary: (ev.title + ', ' + day).slice(0, 200) } });
      } catch (err) {
        // someone else announced it first, or nobody may hear it: the event is fine either way
      } finally {
        announcing.delete(x.id);
      }
    }
  }
  announceEnded();
  setInterval(announceEnded, 60000);
})();
