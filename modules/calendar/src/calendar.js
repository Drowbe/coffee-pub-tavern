// Calendar module. One file of code for every place it shows: the server's own
// page, a room's docked pane or floating panel, and a window of its own. On the
// server page it holds the server's events; in a room it holds that room's events
// and shows the server's beside them. The SDK (window.tavern) is injected by Tavern.
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
  function whenText(ev, start) {
    if (ev.allDay) return 'All day';
    const end = ev.end ? new Date(ev.end) : null;
    return end ? `${timeText(start)} - ${timeText(end)}` : timeText(start);
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

  // Every occurrence of every event in [from, to), soonest first.
  function inRange(from, to) {
    const out = [];
    for (const x of events.values()) for (const start of occurrences(x.ev, from, to)) out.push({ x, start });
    return out.sort((a, b) => a.start - b.start);
  }

  // --- loading and live updates --------------------------------------------

  const keyOf = (scope, id) => `${scope}:${id}`;
  function remember(scope, item) {
    if (!item.key.startsWith('event:') || !item.value) return;
    events.set(keyOf(scope, item.key.slice(6)), { scope, id: item.key.slice(6), version: item.version, ev: item.value });
  }
  async function load() {
    events.clear();
    for (const item of await tavern.storage.list('event:')) remember('room', item);
    if (inRoom) {
      try {
        for (const item of await tavern.storage.list('event:', { scope: 'server' })) remember('server', item);
      } catch (err) {
        // guests and people without server access see just the room's events
      }
    }
  }
  tavern.on('change', (e) => {
    if (!e.key.startsWith('event:')) return;
    const scope = e.scope === 'server' && inRoom ? 'server' : 'room';
    const id = e.key.slice(6);
    if (e.deleted) events.delete(keyOf(scope, id));
    else remember(scope, { key: e.key, value: e.value, version: e.version });
    if (editing && editing.scope === scope && editing.id === id && e.by !== info.user.key) {
      showError('This event was just changed by someone else. Close and reopen it to see the change.');
    }
    render();
  });

  // --- drawing -------------------------------------------------------------

  const isCompact = () => $('app').classList.contains('compact');

  function chipHtml({ x, start }) {
    const label = (x.ev.allDay ? '' : timeText(start) + ' ') + x.ev.title;
    return `<button class="chip ${x.scope === 'server' && inRoom ? 'server' : ''}" data-open="${esc(x.scope)}:${esc(x.id)}" title="${esc(x.ev.title)}">${x.ev.repeat ? '<span class="rep">&#8635;</span>' : ''}${esc(label)}</button>`;
  }

  function monthGrid() {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
    const gridEnd = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + 42);
    const byDay = new Map();
    for (const occ of inRange(gridStart, gridEnd)) {
      const k = ymd(occ.start);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(occ);
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
  function listHtml(occs, emptyText) {
    if (!occs.length) return `<p class="empty">${emptyText}</p>`;
    const groups = new Map();
    for (const occ of occs) {
      const k = ymd(occ.start);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(occ);
    }
    return `<div class="list">${[...groups.values()].map((g) => `<div class="group"><h4>${esc(dayHeading(g[0].start))}</h4>${g.map(({ x, start }) => `
      <button class="item" data-open="${esc(x.scope)}:${esc(x.id)}"><span class="when">${esc(whenText(x.ev, start))}</span>
        <span class="what"><strong>${esc(x.ev.title)}${x.ev.repeat ? `<span class="tag">${esc(REPEAT_NAMES[x.ev.repeat.every] || 'repeats')}</span>` : ''}${x.scope === 'server' && inRoom ? '<span class="tag">server</span>' : ''}</strong>${x.ev.desc ? `<span>${esc(x.ev.desc.slice(0, 120))}</span>` : ''}</span></button>`).join('')}</div>`).join('')}</div>`;
  }

  function monthList() {
    const from = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const to = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    return listHtml(inRange(from, to), `Nothing in ${cursor.toLocaleDateString([], { month: 'long' })}.${canEdit ? ' Add an event to get started.' : ''}`);
  }

  function upcomingList() {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + 90 * DAY);
    return listHtml(inRange(from, to).slice(0, 300), `Nothing coming up.${canEdit ? ' Add an event to get started.' : ''}`);
  }

  function render() {
    const compact = isCompact();
    $('view-toggle').hidden = compact;
    const showMonth = compact || view === 'month';
    $('prev').hidden = $('next').hidden = !showMonth;
    $('view-month').classList.toggle('on', view === 'month');
    $('view-list').classList.toggle('on', view === 'list');
    $('title').textContent = showMonth ? cursor.toLocaleDateString([], { month: 'long', year: 'numeric' }) : 'Next 90 days';
    if (compact) {
      // A narrow pane shows the month on top and that month's events beneath.
      $('body').innerHTML = `<div class="stack">${monthGrid()}<div><h3 class="list-title">This month</h3>${monthList()}</div></div>`;
    } else {
      $('body').innerHTML = view === 'month' ? monthGrid() : upcomingList();
    }
  }

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

  function openEditor(x, day) {
    const readOnly = !canEdit || (x && x.scope === 'server' && inRoom);
    const ev = x ? x.ev : { title: '', allDay: false, start: '', end: null, desc: '', remind: null, repeat: null };
    editing = x ? { scope: x.scope, id: x.id, version: x.version } : { scope: 'room', id: null, version: null };
    showError('');
    $('editor-title').textContent = x ? (readOnly ? ev.title : 'Edit event') : 'New event';
    $('f-title').value = ev.title;
    $('f-allday').checked = Boolean(ev.allDay);
    const start = x ? startOf(ev) : null;
    $('f-date').value = start ? ymd(start) : day || ymd(new Date());
    $('f-time').value = start && !ev.allDay ? `${pad(start.getHours())}:${pad(start.getMinutes())}` : '19:00';
    $('f-end').value = ev.end ? `${pad(new Date(ev.end).getHours())}:${pad(new Date(ev.end).getMinutes())}` : '';
    $('f-desc').value = ev.desc || '';
    $('f-remind').value = ev.remind === null || ev.remind === undefined ? '' : String(ev.remind);
    $('f-repeat').value = ev.repeat ? ev.repeat.every : '';
    $('f-until').value = ev.repeat && ev.repeat.until ? ev.repeat.until : '';
    for (const id of ['f-title', 'f-date', 'f-time', 'f-end', 'f-allday', 'f-desc', 'f-remind', 'f-repeat', 'f-until']) $(id).disabled = readOnly;
    $('f-save').hidden = readOnly;
    $('f-delete').hidden = readOnly || !x;
    $('f-delete').textContent = 'Delete';
    $('f-cancel').textContent = readOnly ? 'Close' : 'Cancel';
    syncForm();
    remindHint();
    $('editor').hidden = false;
    $(readOnly ? 'f-cancel' : 'f-title').focus();
  }
  function closeEditor() {
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
    if (!allDay) {
      const time = $('f-time').value || '19:00';
      const s = new Date(`${date}T${time}`);
      if (Number.isNaN(s.getTime())) return showError('That time is not valid.');
      start = s.toISOString();
      if ($('f-end').value) {
        const t = new Date(`${date}T${$('f-end').value}`);
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
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('editor').hidden) closeEditor(); });

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
