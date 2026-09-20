// Calendar module. One file of code for every place it shows: the server's own
// page, a room's docked pane or floating panel, and a window of its own. On the
// server page it holds the server's events and shows, read-only, the events of every
// room the viewer belongs to (each marked with its room's icon); in a room it holds
// that room's events and shows the server's beside them. The SDK (window.tavern) is injected by Tavern.
(async function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  let info;
  try {
    info = await tavern.ready();
  } catch (err) {
    $('msg').textContent = 'The calendar could not start: ' + err.message;
    return;
  }
  const inRoom = info.context.scope === 'room';
  const canEdit = tavern.can('edit');
  const DAY = 24 * 60 * 60 * 1000;
  const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (err) { return undefined; } })();

  // Every event we know of, by "<scope>:<id>". `scope` is where it is stored: 'room'
  // (this room, or the server on the server page -- the frame's own context) or
  // 'server' (shown read-only in a room).
  const events = new Map();
  const roomInfo = new Map(); // room id -> { id, name, icon, svg }, on the server page
  const hiddenRooms = new Set(); // rooms filtered out on the server page
  let cursor = new Date();
  cursor = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  let view = 'month';
  let editing = null; // { scope, id, version } while the editor is open

  // --- dates ---------------------------------------------------------------

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  function startOf(ev) {
    return ev.allDay ? parseYmd(ev.start) : new Date(ev.start);
  }
  const timeText = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const shortDay = (d) => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

  // An event runs from `start` to `end`, which may be days later. A timed event's end is a date and
  // time; an all-day event's end is the last day (inclusive). Neither: it lasts as long as it lasts
  // on the one day it starts.
  function durationOf(ev) {
    if (ev.allDay) return ev.end ? Math.max(0, parseYmd(ev.end) - parseYmd(ev.start)) + DAY : DAY;
    return ev.end ? Math.max(0, new Date(ev.end) - new Date(ev.start)) : 0;
  }
  // When one occurrence (starting at `start`) ends: a moment, exclusive.
  const endOf = (ev, start) => new Date(start.getTime() + durationOf(ev));

  function whenText(ev, start, end) {
    const last = new Date(end.getTime() - (ev.allDay ? 1 : 0));
    const multi = startOfDay(last) > startOfDay(start);
    if (ev.allDay) return multi ? `${shortDay(start)} - ${shortDay(last)}` : 'All day';
    if (!ev.end) return timeText(start);
    return multi ? `${shortDay(start)} ${timeText(start)} - ${shortDay(end)} ${timeText(end)}` : `${timeText(start)} - ${timeText(end)}`;
  }
  const dayHeading = (d) => d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  const REPEAT_NAMES = { day: 'daily', week: 'weekly', '2weeks': 'every 2 weeks', month: 'monthly', year: 'yearly' };

  // --- repeating events -------------------------------------------------------
  // An event may repeat: { every: 'day' | 'week' | '2weeks' | 'month' | 'year', until: 'YYYY-MM-DD' | null }.
  // The whole series is one event, so changing it changes every occurrence. A
  // repeat keeps the wall-clock time and, monthly, the day of the month (or the
  // last day of a shorter month).

  function occurrenceAt(first, every, i) {
    const y = first.getFullYear();
    const m = first.getMonth();
    const d = first.getDate();
    const h = first.getHours();
    const mi = first.getMinutes();
    if (every === 'day') return new Date(y, m, d + i, h, mi);
    if (every === 'week') return new Date(y, m, d + 7 * i, h, mi);
    if (every === '2weeks') return new Date(y, m, d + 14 * i, h, mi);
    const months = every === 'year' ? 12 * i : i;
    const last = new Date(y, m + months + 1, 0).getDate();
    return new Date(y, m + months, Math.min(d, last), h, mi);
  }

  // The start times of one event that fall in [from, to).
  function occurrences(ev, from, to) {
    const first = startOf(ev);
    if (!ev.repeat) return first >= from && first < to ? [first] : [];
    const every = ev.repeat.every;
    const until = ev.repeat.until ? endOfDay(parseYmd(ev.repeat.until)) : null;
    let i = 0;
    if (from > first) {
      // Skip ahead rather than walk every day since the first one.
      const days = (from - first) / DAY;
      const skip = every === 'day' ? days : every === 'week' ? days / 7 : every === '2weeks' ? days / 14 : every === 'month' ? days / 31 : days / 366;
      i = Math.max(0, Math.floor(skip) - 1);
    }
    const out = [];
    for (let n = 0; n < 1500; n += 1, i += 1) {
      const at = occurrenceAt(first, every, i);
      if (at >= to || (until && at > until)) break;
      if (at >= from) out.push(at);
    }
    return out;
  }

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
    return `<button class="chip ${x.scope === 'server' && inRoom ? 'server' : ''}" data-open="${esc(x.key)}" draggable="true" title="${esc(x.ev.title)}">${roomIcon(x)}${x.ev.repeat ? '<span class="rep">&#8635;</span>' : ''}${esc(label)}</button>`;
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
      <button class="item" data-open="${esc(x.key)}" draggable="true"><span class="when">${esc(whenText(x.ev, start, end))}</span>
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

  function render() {
    const compact = isCompact();
    $('view-toggle').hidden = compact;
    const showMonth = compact || view === 'month';
    $('prev').hidden = $('next').hidden = !showMonth;
    $('view-month').classList.toggle('on', view === 'month');
    $('view-list').classList.toggle('on', view === 'list');
    renderFilters();
    $('title').textContent = showMonth ? cursor.toLocaleDateString([], { month: 'long', year: 'numeric' }) : 'Next 90 days';
    if (compact) {
      // A narrow pane shows the month on top and that month's events beneath.
      $('body').innerHTML = `<div class="stack">${monthGrid()}<div><h3 class="list-title">This month</h3>${monthList()}</div></div>`;
    } else {
      $('body').innerHTML = view === 'month' ? monthGrid() : upcomingList();
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

  // --- the date picker -----------------------------------------------------
  // A small month grid under a date field, with the weekdays across the top, so the day a date falls
  // on is visible while choosing. The typed field keeps working; the button opens this, and the
  // weekday of whatever is in the field shows beneath it.

  const DATE_FIELDS = ['f-date', 'f-end-date', 'f-until'];
  function showWeekdays() {
    for (const id of DATE_FIELDS) {
      const hint = document.querySelector(`[data-dow="${id}"]`);
      const v = $(id).value;
      hint.textContent = v ? parseYmd(v).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }) : '';
    }
  }
  for (const id of DATE_FIELDS) $(id).addEventListener('input', showWeekdays);
  for (const id of DATE_FIELDS) $(id).addEventListener('change', showWeekdays);

  let picker = null; // { el, input }
  function closePicker() {
    if (picker) picker.el.remove();
    picker = null;
  }
  function openPicker(inputId) {
    if (picker && picker.input === inputId) return closePicker();
    closePicker();
    const input = $(inputId);
    const seed = input.value || (inputId !== 'f-date' && $('f-date').value) || ymd(new Date());
    let month = new Date(parseYmd(seed).getFullYear(), parseYmd(seed).getMonth(), 1);
    const el = document.createElement('div');
    el.className = 'dp';
    const draw = () => {
      const gridStart = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay());
      const from = $('f-date').value;
      const to = $('f-end-date').value;
      const today = ymd(new Date());
      let cells = '';
      for (let i = 0; i < 42; i += 1) {
        const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
        const k = ymd(d);
        const cls = ['dp-day', d.getMonth() !== month.getMonth() ? 'other' : '', k === today ? 'today' : '', k === input.value ? 'sel' : '', from && to && k >= from && k <= to ? 'inrange' : ''].join(' ');
        cells += `<button type="button" class="${cls}" data-day="${k}">${d.getDate()}</button>`;
      }
      el.innerHTML = `<div class="dp-head"><button type="button" data-dp="prev" aria-label="Previous month">&lsaquo;</button><strong>${esc(month.toLocaleDateString([], { month: 'long', year: 'numeric' }))}</strong><button type="button" data-dp="next" aria-label="Next month">&rsaquo;</button></div>
        <div class="dp-grid">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((n) => `<span class="dp-dow">${n}</span>`).join('')}${cells}</div>
        <div class="dp-foot"><button type="button" data-dp="today">Today</button>${inputId === 'f-date' ? '<span></span>' : '<button type="button" data-dp="clear">Clear</button>'}</div>`;
    };
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const day = e.target.closest('[data-day]');
      const nav = e.target.closest('[data-dp]');
      const set = (v) => {
        input.value = v;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        closePicker();
      };
      if (day) return set(day.dataset.day);
      if (!nav) return;
      if (nav.dataset.dp === 'prev') month = new Date(month.getFullYear(), month.getMonth() - 1, 1);
      else if (nav.dataset.dp === 'next') month = new Date(month.getFullYear(), month.getMonth() + 1, 1);
      else if (nav.dataset.dp === 'today') return set(ymd(new Date()));
      else if (nav.dataset.dp === 'clear') return set('');
      draw();
    });
    draw();
    const card = $('form');
    card.appendChild(el);
    // Under the field, kept inside the card.
    const c = card.getBoundingClientRect();
    const r = input.getBoundingClientRect();
    el.style.top = `${r.bottom - c.top + 4}px`;
    el.style.left = `${Math.max(8, Math.min(r.left - c.left, c.width - 252 - 8))}px`;
    picker = { el, input: inputId };
  }
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-picker]');
    if (btn) return openPicker(btn.dataset.picker);
    if (picker && !e.target.closest('.dp')) closePicker();
  });

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
  if (tavern.refs && tavern.refs.onOpen) {
    tavern.refs.onOpen((ref) => {
      const x = events.get(keyOf('room', ref.id)) || events.get(keyOf('server', ref.id)) || events.get(keyOf('rooms', ref.id, ref.room));
      if (!x) return;
      const d = startOf(x.ev);
      cursor = new Date(d.getFullYear(), d.getMonth(), 1);
      view = 'month';
      render();
      openEditor(x);
    });
    tavern.on('links', (e) => {
      if (e.ref && e.ref.kind === 'event' && editing && events.get(backlinksFor) && events.get(backlinksFor).id === e.ref.id) showBacklinks(events.get(backlinksFor));
    });
  }

  function openEditor(x, day) {
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
    $('f-repeat').value = ev.repeat ? ev.repeat.every : '';
    $('f-until').value = ev.repeat && ev.repeat.until ? ev.repeat.until : '';
    for (const id of ['f-title', 'f-date', 'f-time', 'f-end-date', 'f-end', 'f-allday', 'f-desc', 'f-remind', 'f-repeat', 'f-until']) $(id).disabled = readOnly;
    $('f-save').hidden = readOnly;
    $('f-delete').hidden = readOnly || !x;
    $('f-delete').textContent = 'Delete';
    $('f-cancel').textContent = readOnly ? 'Close' : 'Cancel';
    syncForm();
    remindHint();
    closePicker();
    showWeekdays();
    showBacklinks(x || null);
    $('editor').hidden = false;
    $(readOnly ? 'f-cancel' : 'f-title').focus();
  }
  function closeEditor() {
    closePicker();
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

  $('prev').addEventListener('click', () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1); render(); });
  $('next').addEventListener('click', () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1); render(); });
  $('today').addEventListener('click', () => { const n = new Date(); cursor = new Date(n.getFullYear(), n.getMonth(), 1); render(); });
  $('view-month').addEventListener('click', () => { view = 'month'; render(); });
  $('view-list').addEventListener('click', () => { view = 'list'; render(); });
  $('add').addEventListener('click', () => openEditor(null));
  // The host draws the Add button in the module's action bar (in the room's bottom row when
  // docked); the button in the header stays only for a host without one.
  if (tavern.bar) {
    $('add').classList.add('hosted');
    tavern.bar.set(canEdit ? [{ id: 'add', label: 'Add event', icon: 'plus', primary: true }] : []).catch(() => $('add').classList.remove('hosted'));
    tavern.on('bar', (e) => { if (e.id === 'add' && canEdit) openEditor(null); });
  }
  // An event can be dragged onto another module that links to events (a to-do, say): it carries a
  // pointer to the event, and the other module asks Tavern for what it may show.
  $('body').addEventListener('dragstart', (e) => {
    const open = e.target.closest('[data-open]');
    const x = open && events.get(open.dataset.open);
    if (!x || !tavern.refs) return;
    const where = x.scope === 'rooms' ? { room: x.roomId } : x.scope === 'server' && inRoom ? { scope: 'server' } : undefined;
    tavern.refs.drag(e, 'event', x.id, { ...where, label: x.ev.title });
  });
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
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (picker) return closePicker();
    if (!$('editor').hidden) closeEditor();
  });

  // A frame can report no width while it is still being laid out, so wait for a real
  // one before choosing the compact layout.
  const fit = () => {
    const w = document.documentElement.clientWidth;
    if (!w) return;
    $('app').classList.toggle('compact', w < 520);
  };
  new ResizeObserver(() => { fit(); render(); }).observe(document.documentElement);

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
})();
