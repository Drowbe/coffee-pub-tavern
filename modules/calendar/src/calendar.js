// Calendar module. One file of code for both places it shows: the server's own
// page (every event on the server) and a room's panel (that room's events, with
// the server's shown alongside). The SDK (window.tavern) is injected by Tavern.
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

  // Every event we know of, by "<scope>:<id>". `scope` is where it is stored: 'room'
  // (this room, or the server on the server page -- the frame's own context) or
  // 'server' (shown read-only in a room panel).
  const events = new Map();
  let cursor = new Date();
  cursor = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  let view = 'month';
  let editing = null; // { scope, id, version } while the editor is open

  // --- dates ---------------------------------------------------------------

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function startOf(ev) {
    if (ev.allDay) {
      const [y, m, d] = ev.start.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    return new Date(ev.start);
  }
  const timeText = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  function whenText(ev) {
    if (ev.allDay) return 'All day';
    const start = startOf(ev);
    const end = ev.end ? new Date(ev.end) : null;
    return end ? `${timeText(start)} - ${timeText(end)}` : timeText(start);
  }
  const dayHeading = (d) => d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

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

  function eventsOn(day) {
    const key = ymd(day);
    return [...events.values()]
      .filter((x) => ymd(startOf(x.ev)) === key)
      .sort((a, b) => startOf(a.ev) - startOf(b.ev));
  }

  function chipHtml(x) {
    const label = (x.ev.allDay ? '' : timeText(startOf(x.ev)) + ' ') + x.ev.title;
    return `<button class="chip ${x.scope === 'server' && inRoom ? 'server' : ''}" data-open="${esc(x.scope)}:${esc(x.id)}" title="${esc(x.ev.title)}">${esc(label)}</button>`;
  }

  function renderMonth() {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
    const today = ymd(new Date());
    let html = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div class="dow">${d}</div>`).join('');
    for (let i = 0; i < 42; i += 1) {
      const day = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      const list = eventsOn(day);
      const shown = $('app').classList.contains('compact') ? list : list.slice(0, 3);
      html += `<div class="day ${day.getMonth() !== cursor.getMonth() ? 'other' : ''} ${ymd(day) === today ? 'today' : ''}" data-day="${ymd(day)}">
        <span class="n">${day.getDate()}</span><div class="chips">${shown.map(chipHtml).join('')}</div>
        ${shown.length < list.length ? `<span class="more">+${list.length - shown.length} more</span>` : ''}</div>`;
    }
    $('body').innerHTML = `<div class="month">${html}</div>`;
  }

  function renderList() {
    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    const upcoming = [...events.values()].filter((x) => startOf(x.ev) >= startToday).sort((a, b) => startOf(a.ev) - startOf(b.ev));
    if (!upcoming.length) {
      $('body').innerHTML = `<p class="empty">Nothing coming up.${canEdit ? ' Add an event to get started.' : ''}</p>`;
      return;
    }
    const groups = new Map();
    for (const x of upcoming) {
      const k = ymd(startOf(x.ev));
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(x);
    }
    $('body').innerHTML = `<div class="list">${[...groups.values()].map((g) => `<div class="group"><h4>${esc(dayHeading(startOf(g[0].ev)))}</h4>${g.map((x) => `
      <button class="item" data-open="${esc(x.scope)}:${esc(x.id)}"><span class="when">${esc(whenText(x.ev))}</span>
        <span class="what"><strong>${esc(x.ev.title)}${x.scope === 'server' && inRoom ? '<span class="tag">server</span>' : ''}</strong>${x.ev.desc ? `<span>${esc(x.ev.desc.slice(0, 120))}</span>` : ''}</span></button>`).join('')}</div>`).join('')}</div>`;
  }

  function render() {
    $('view-month').classList.toggle('on', view === 'month');
    $('view-list').classList.toggle('on', view === 'list');
    $('prev').hidden = $('next').hidden = view !== 'month';
    $('title').textContent = view === 'month' ? cursor.toLocaleDateString([], { month: 'long', year: 'numeric' }) : 'Upcoming';
    if (view === 'month') renderMonth(); else renderList();
  }

  // --- the editor -----------------------------------------------------------

  function showError(text) {
    $('f-error').textContent = text;
    $('f-error').hidden = !text;
  }

  function syncAllDay() {
    const all = $('f-allday').checked;
    $('f-time-wrap').hidden = all;
    $('f-end-wrap').hidden = all;
  }
  $('f-allday').addEventListener('change', syncAllDay);

  function remindHint() {
    $('f-remind-hint').textContent = $('f-remind').value === ''
      ? ''
      : (inRoom ? 'Everyone in this room' : 'Everyone on the server') + ' gets a notification, if they are allowed to see the calendar.';
  }
  $('f-remind').addEventListener('change', remindHint);

  function openEditor(x, day) {
    const readOnly = !canEdit || (x && x.scope === 'server' && inRoom);
    const ev = x ? x.ev : { title: '', allDay: false, start: '', end: null, desc: '', remind: null };
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
    for (const id of ['f-title', 'f-date', 'f-time', 'f-end', 'f-allday', 'f-desc', 'f-remind']) $(id).disabled = readOnly;
    $('f-save').hidden = readOnly;
    $('f-delete').hidden = readOnly || !x;
    $('f-delete').textContent = 'Delete';
    $('f-cancel').textContent = readOnly ? 'Close' : 'Cancel';
    syncAllDay();
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
  // notification, and stops if the event changes or goes away.
  async function applyReminder(id, ev) {
    const key = 'remind:' + id;
    try {
      if (ev.remind === null || ev.remind === undefined) {
        await tavern.cancelSchedule(key);
        return;
      }
      const startMs = ev.allDay ? startOf(ev).getTime() + 9 * 60 * 60 * 1000 : startOf(ev).getTime();
      const at = startMs - ev.remind * 60 * 1000;
      if (at < Date.now() - 4 * 60 * 1000) {
        await tavern.cancelSchedule(key);
        return;
      }
      const label = ev.remind === 0 ? 'Starting now' : ev.remind === 15 ? 'Starts in 15 minutes' : ev.remind === 60 ? 'Starts in an hour' : 'Starts tomorrow';
      await tavern.schedule({ key, at, payload: { id }, notify: { title: ev.title, body: label } });
    } catch (err) {
      showError('Saved, but the reminder could not be set: ' + err.message);
      throw err;
    }
  }

  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
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
    const id = editing.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const ev = { id, title, allDay, start, end, desc: $('f-desc').value.trim(), remind, by: info.user.name };
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
  });

  let deleteArmed = false;
  $('f-delete').addEventListener('click', async () => {
    if (!editing || !editing.id) return;
    if (!deleteArmed) {
      deleteArmed = true;
      $('f-delete').textContent = 'Really delete?';
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

  // A frame can report no width while it is still being laid out, so wait for a real one
  // before choosing compact or the first view.
  let viewChosen = false;
  const fit = () => {
    const w = document.documentElement.clientWidth;
    if (!w) return;
    $('app').classList.toggle('compact', w < 520);
    if (!viewChosen) {
      viewChosen = true;
      view = w < 520 ? 'list' : 'month';
    }
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
