// To-do module. One file of code for every place it shows: the server's own page, a
// room's docked pane or floating panel, and a window of its own. Each place has its own
// list. On the server page the viewer's rooms' lists are shown too, read-only, each with
// its room's icon. The SDK (window.tavern) is injected by Tavern.
(async function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  let info;
  try {
    info = await tavern.ready();
  } catch (err) {
    $('msg').textContent = 'The to-do list could not start: ' + err.message;
    return;
  }
  const inRoom = info.context.scope === 'room';
  const canEdit = tavern.can('edit');
  const DAY = 24 * 60 * 60 * 1000;

  // Every task we know of, by key. `scope` is 'own' (this place's list) or 'rooms' (another room's, read-only).
  const tasks = new Map();
  const roomInfo = new Map(); // room id -> { id, name, icon, svg }, on the server page
  const hiddenRooms = new Set();
  let show = 'open';
  let editing = null; // { key, id, version } while the editor is open

  // --- dates ---------------------------------------------------------------

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const startOfToday = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };

  function dueText(due) {
    const days = Math.round((parseYmd(due) - startOfToday()) / DAY);
    if (days === 0) return { text: 'Today', cls: 'soon' };
    if (days === 1) return { text: 'Tomorrow', cls: 'soon' };
    if (days === -1) return { text: 'Yesterday', cls: 'late' };
    const text = parseYmd(due).toLocaleDateString([], { month: 'short', day: 'numeric' });
    return { text, cls: days < 0 ? 'late' : '' };
  }

  // --- loading and live updates --------------------------------------------

  const keyOf = (scope, id, roomId) => (scope === 'rooms' ? `rooms:${roomId}:${id}` : `own:${id}`);
  function remember(scope, item, roomId) {
    if (!item.key.startsWith('task:') || !item.value) return;
    const id = item.key.slice(5);
    const key = keyOf(scope, id, roomId);
    tasks.set(key, { key, scope, roomId, id, version: item.version, t: item.value });
  }
  async function load() {
    tasks.clear();
    for (const item of await tavern.storage.list('task:')) remember('own', item);
    if (!inRoom && info.context.scope === 'server') {
      try {
        for (const r of await tavern.rooms()) roomInfo.set(r.id, r);
        for (const item of await tavern.storage.list('task:', { scope: 'rooms' })) remember('rooms', item, item.roomId);
      } catch (err) {
        // just the server's own list
      }
    }
  }
  tavern.on('change', (e) => {
    if (!e.key.startsWith('task:')) return;
    const scope = e.scope === 'rooms' ? 'rooms' : 'own';
    const id = e.key.slice(5);
    if (e.deleted) tasks.delete(keyOf(scope, id, e.roomId));
    else remember(scope, { key: e.key, value: e.value, version: e.version }, e.roomId);
    if (editing && editing.key === keyOf(scope, id, e.roomId) && e.by !== info.user.key) {
      showError('This task was just changed by someone else. Close and reopen it to see the change.');
    }
    render();
  });

  // --- drawing -------------------------------------------------------------

  const roomIcon = (roomId) => {
    const r = roomInfo.get(roomId);
    return r && r.svg ? `<span class="ri">${r.svg}</span>` : '';
  };

  // Open tasks: soonest due first, then the ones with no date, oldest first. Done: latest first.
  function sorted(list, done) {
    return list.slice().sort((a, b) => {
      if (done) return (b.t.doneAt || 0) - (a.t.doneAt || 0);
      const da = a.t.due || '9999';
      const db = b.t.due || '9999';
      return da < db ? -1 : da > db ? 1 : (a.t.createdAt || 0) - (b.t.createdAt || 0);
    });
  }

  function taskHtml(x) {
    const t = x.t;
    const editable = canEdit && x.scope === 'own';
    const due = t.due ? dueText(t.due) : null;
    const notes = t.notes ? `<small>${esc(t.notes.split('\n')[0].slice(0, 90))}</small>` : '';
    return `<div class="task ${t.done ? 'done' : ''}">
      <input class="tick" type="checkbox" data-tick="${esc(x.key)}" ${t.done ? 'checked' : ''} ${editable ? '' : 'disabled'} aria-label="Done">
      <button class="text" type="button" data-open="${esc(x.key)}">${esc(t.title)}${notes}</button>
      ${due && !t.done ? `<span class="due ${due.cls}">${esc(due.text)}</span>` : ''}
    </div>`;
  }

  function groupHtml(label, list) {
    const shown = list.filter((x) => (show === 'all' ? true : show === 'done' ? x.t.done : !x.t.done));
    if (!shown.length) return '';
    const open = sorted(shown.filter((x) => !x.t.done), false);
    const done = sorted(shown.filter((x) => x.t.done), true);
    return `<section class="group">${label ? `<h4>${label}</h4>` : ''}${[...open, ...done].map(taskHtml).join('')}</section>`;
  }

  function render() {
    for (const b of $('filter').querySelectorAll('[data-show]')) b.classList.toggle('on', b.dataset.show === show);
    const own = [...tasks.values()].filter((x) => x.scope === 'own');
    const openCount = own.filter((x) => !x.t.done).length;
    $('count').textContent = own.length ? `${openCount} open` : '';

    $('rooms').hidden = roomInfo.size === 0;
    if (roomInfo.size) {
      $('rooms').innerHTML = [...roomInfo.values()].map((r) => `<button type="button" class="filter ${hiddenRooms.has(r.id) ? '' : 'on'}" data-room="${esc(r.id)}" title="${hiddenRooms.has(r.id) ? 'Show' : 'Hide'} ${esc(r.name)}"><span class="ri">${r.svg || ''}</span> ${esc(r.name)}</button>`).join('');
    }

    let html = groupHtml(roomInfo.size ? 'Server' : '', own);
    for (const r of roomInfo.values()) {
      if (hiddenRooms.has(r.id)) continue;
      html += groupHtml(`${roomIcon(r.id)} ${esc(r.name)}`, [...tasks.values()].filter((x) => x.scope === 'rooms' && x.roomId === r.id));
    }
    $('body').innerHTML = html || `<p class="empty">${show === 'done' ? 'Nothing done yet.' : 'Nothing to do.'}${canEdit && show !== 'done' ? ' Add a task to get started.' : ''}</p>`;
  }

  function showNote(text) {
    $('note').textContent = text;
    $('note').hidden = !text;
    if (text) setTimeout(() => { $('note').hidden = true; }, 5000);
  }

  // --- reminders ------------------------------------------------------------
  // A reminder is a schedule Tavern runs for us: at 9:00 on the due date it sends a
  // notification, even with this page closed. It stops when the task is done, changed or deleted.

  async function applyReminder(t) {
    const key = 'remind:' + t.id;
    try {
      if (!t.remind || !t.due || t.done) return await tavern.cancelSchedule(key);
      const at = parseYmd(t.due).getTime() + 9 * 60 * 60 * 1000;
      if (at <= Date.now()) return await tavern.cancelSchedule(key);
      await tavern.schedule({ key, at, payload: { id: t.id }, notify: { title: t.title, body: 'Due today' } });
    } catch (err) {
      showNote('Saved, but the reminder could not be set: ' + err.message);
      throw err;
    }
  }

  // --- changing tasks --------------------------------------------------------

  async function put(x, t) {
    const saved = await tavern.storage.set('task:' + t.id, t, x && x.version ? { version: x.version } : {});
    remember('own', { key: 'task:' + t.id, value: t, version: saved.version });
    return saved;
  }

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  async function quickAdd(title) {
    const t = { id: newId(), title, notes: '', due: null, remind: false, done: false, doneAt: null, createdAt: Date.now(), by: info.user.name };
    try {
      await put(null, t);
      render();
    } catch (err) {
      showNote(err.message);
    }
  }

  async function tick(key, done) {
    const x = tasks.get(key);
    if (!x || !canEdit || x.scope !== 'own') return;
    const t = { ...x.t, done, doneAt: done ? Date.now() : null };
    try {
      await put(x, t);
      applyReminder(t).catch(() => {});
    } catch (err) {
      showNote(err.status === 409 ? 'Someone changed that task first. It has been refreshed.' : err.message);
      try { await load(); } catch (e) { /* keep what we have */ }
    }
    render();
  }

  // --- the editor -----------------------------------------------------------

  function showError(text) {
    $('f-error').textContent = text;
    $('f-error').hidden = !text;
  }

  function syncForm() {
    $('f-remind-wrap').hidden = !$('f-due').value;
  }
  $('f-due').addEventListener('change', syncForm);

  function openEditor(x) {
    const readOnly = !canEdit || (x && x.scope !== 'own');
    const t = x ? x.t : { title: '', notes: '', due: null, remind: false, done: false };
    editing = x ? { key: x.key, id: x.id, version: x.version } : { key: null, id: null, version: null };
    showError('');
    const from = x && x.scope === 'rooms' && roomInfo.get(x.roomId) ? ` (${roomInfo.get(x.roomId).name})` : '';
    $('editor-title').textContent = x ? (readOnly ? t.title + from : 'Edit task') : 'New task';
    $('f-title').value = t.title;
    $('f-notes').value = t.notes || '';
    $('f-due').value = t.due || '';
    $('f-remind').checked = Boolean(t.remind);
    $('f-done').checked = Boolean(t.done);
    $('f-by').textContent = x && t.by ? `Added by ${t.by}` : '';
    for (const id of ['f-title', 'f-notes', 'f-due', 'f-remind', 'f-done']) $(id).disabled = readOnly;
    $('f-save').hidden = readOnly;
    $('f-delete').hidden = readOnly || !x;
    $('f-delete').textContent = 'Delete';
    $('f-cancel').textContent = readOnly ? 'Close' : 'Cancel';
    syncForm();
    $('editor').hidden = false;
    $(readOnly ? 'f-cancel' : 'f-title').focus();
  }
  function closeEditor() {
    $('editor').hidden = true;
    editing = null;
  }
  $('f-cancel').addEventListener('click', closeEditor);
  $('editor').addEventListener('click', (e) => { if (e.target === $('editor')) closeEditor(); });

  async function save() {
    if (!editing) return;
    showError('');
    const title = $('f-title').value.trim();
    if (!title) return showError('A task needs a name.');
    const current = editing.key ? tasks.get(editing.key) : null;
    const done = $('f-done').checked;
    const due = $('f-due').value || null;
    const t = {
      id: editing.id || newId(),
      title,
      notes: $('f-notes').value.trim(),
      due,
      remind: Boolean(due) && $('f-remind').checked,
      done,
      doneAt: done ? (current && current.t.done ? current.t.doneAt : Date.now()) : null,
      createdAt: current ? current.t.createdAt : Date.now(),
      by: current ? current.t.by : info.user.name,
    };
    $('f-save').disabled = true;
    try {
      await put(current, t);
      let reminderFailed = false;
      try { await applyReminder(t); } catch (err) { reminderFailed = true; }
      render();
      if (!reminderFailed) closeEditor();
    } catch (err) {
      showError(err.status === 409 ? 'Someone changed this task since you opened it. Close it and open it again.' : err.message);
    } finally {
      $('f-save').disabled = false;
    }
  }
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
      $('f-delete').textContent = 'Really delete?';
      setTimeout(() => { deleteArmed = false; $('f-delete').textContent = 'Delete'; }, 4000);
      return;
    }
    deleteArmed = false;
    try {
      await tavern.storage.delete('task:' + editing.id);
      try { await tavern.cancelSchedule('remind:' + editing.id); } catch (err) { /* nothing to cancel */ }
      tasks.delete(editing.key);
      closeEditor();
      render();
    } catch (err) {
      showError(err.message);
    }
  });

  // --- wiring ---------------------------------------------------------------

  $('filter').addEventListener('click', (e) => {
    const b = e.target.closest('[data-show]');
    if (!b) return;
    show = b.dataset.show;
    render();
  });
  $('rooms').addEventListener('click', (e) => {
    const b = e.target.closest('[data-room]');
    if (!b) return;
    if (hiddenRooms.has(b.dataset.room)) hiddenRooms.delete(b.dataset.room); else hiddenRooms.add(b.dataset.room);
    render();
  });
  $('body').addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    if (open) {
      const x = tasks.get(open.dataset.open);
      if (x) openEditor(x);
    }
  });
  $('body').addEventListener('change', (e) => {
    const box = e.target.closest('[data-tick]');
    if (box) tick(box.dataset.tick, box.checked);
  });
  // Enter in the box adds the task. (The frame's own form-submit is not relied on, so this
  // works wherever a sandboxed frame blocks submitting.)
  function submitQuick() {
    const title = $('quick').value.trim();
    if (!title) return;
    $('quick').value = '';
    quickAdd(title);
  }
  $('quick-form').addEventListener('submit', (e) => { e.preventDefault(); submitQuick(); });
  $('quick').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    submitQuick();
  });
  $('add').addEventListener('click', () => openEditor(null));
  // The host draws Add task in the module's action bar (in the room's bottom row when docked);
  // the button in the header stays only for a host without one.
  if (tavern.bar) {
    $('add').classList.add('hosted');
    tavern.bar.set(canEdit ? [{ id: 'add', label: 'Add task', icon: 'plus', primary: true }] : []).catch(() => $('add').classList.remove('hosted'));
    tavern.on('bar', (e) => { if (e.id === 'add' && canEdit) openEditor(null); });
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('editor').hidden) closeEditor(); });

  $('add').hidden = !canEdit;
  $('quick-form').hidden = !canEdit;
  try {
    await load();
  } catch (err) {
    $('msg').textContent = 'The to-do list could not load: ' + err.message;
    return;
  }
  $('msg').hidden = true;
  $('app').hidden = false;
  render();
})();
