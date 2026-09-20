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
  let editingLinks = []; // the links the open editor will save
  const MAX_LINKS = 5;
  // What this module may link to is whatever other modules share and Tavern says it may (module.json
  // refs.consumes is "*"), so a module written later takes part with no change here.
  let consumable = new Set(); // "module:kind"
  async function loadKinds() {
    try {
      consumable = new Set((await tavern.refs.kinds()).map((k) => k.module + ':' + k.kind));
    } catch (err) {
      consumable = new Set();
    }
  }
  const cards = new Map(); // pointer key -> card, or { error } when it is gone or not for this viewer

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
    // Stored data is whatever a writer put there: keep only well-formed links.
    const t = item.value;
    t.links = Array.isArray(t.links) ? t.links.filter((r) => r && typeof r === 'object' && typeof r.module === 'string' && typeof r.kind === 'string' && typeof r.id === 'string' && linkable(r)).slice(0, MAX_LINKS) : [];
    tasks.set(key, { key, scope, roomId, id, version: item.version, t });
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

  // --- links to other modules' items ----------------------------------------
  // A task stores only pointers ({ module, kind, id, scope, room }); what to show comes from
  // Tavern each time (tavern.refs.resolve), so it is always current and never more than the
  // viewer may see. The pointers are checked in the drop and search: only the kinds above.

  const refKey = (r) => [r.module, r.kind, r.id, r.scope, r.room || ''].join('|');
  const linkable = (r) => consumable.has(r.module + ':' + r.kind);
  const myRef = (id) => tavern.refs.make('task', id);
  const syncedLinks = new Map(); // task id -> the links last told to Tavern

  // Tell Tavern what a task points at, so the things it points at can show it. Only when it changed.
  async function syncLinks(id, links) {
    if (!tavern.refs || !tavern.refs.setLinks) return;
    const sig = JSON.stringify(links.map(refKey));
    if (syncedLinks.get(id) === sig) return;
    syncedLinks.set(id, sig);
    try {
      await tavern.refs.setLinks(myRef(id), links);
    } catch (err) {
      syncedLinks.delete(id); // try again next time
    }
  }

  async function resolveLinks() {
    if (!tavern.refs) return;
    const want = new Map();
    for (const x of tasks.values()) for (const r of x.t.links || []) if (!cards.has(refKey(r))) want.set(refKey(r), r);
    for (const r of editingLinks) if (!cards.has(refKey(r))) want.set(refKey(r), r);
    if (!want.size) return;
    const list = [...want.values()];
    try {
      const got = await tavern.refs.resolve(list);
      list.forEach((r, i) => cards.set(refKey(r), got[i] || { error: 'unavailable' }));
    } catch (err) {
      list.forEach((r) => cards.set(refKey(r), { error: 'unavailable' }));
    }
    render();
    renderEditorLinks();
  }

  function dateText(when, allDay) {
    if (when === undefined || when === null || when === '') return '';
    const d = typeof when === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(when) ? parseYmd(when) : new Date(when);
    if (Number.isNaN(d.getTime())) return '';
    return allDay === false ? d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function linkChip(r, removable) {
    const c = cards.get(refKey(r));
    const x = removable ? `<button class="x" type="button" data-unlink="${esc(refKey(r))}" aria-label="Remove link">&times;</button>` : '';
    if (!c) return `<span class="link gone">Loading...${x}</span>`;
    if (c.error) return `<span class="link gone" title="Deleted, or not something you can see">Not available${x}</span>`;
    const when = dateText(c.when, c.allDay);
    const body = `<b>${esc(c.kindName || c.module.name)}</b> ${esc(c.title)}${when ? ' &middot; ' + esc(when) : ''}`;
    // A card that says its module can show the item is a button that does.
    return c.open
      ? `<span class="link"><span class="open" role="button" tabindex="0" data-open-ref="${esc(refKey(r))}" title="Open ${esc(c.title)}">${body}</span>${x}</span>`
      : `<span class="link" title="${esc(c.title)}">${body}${x}</span>`;
  }

  // Add a pointer to a task (from a drop) and save it.
  async function linkTo(key, ref) {
    const x = tasks.get(key);
    if (!x || !canEdit || x.scope !== 'own' || !ref || !linkable(ref)) return;
    const links = x.t.links || [];
    if (links.some((r) => refKey(r) === refKey(ref))) return;
    if (links.length >= MAX_LINKS) return showNote('A task can link to ' + MAX_LINKS + ' things.');
    try {
      await put(x, { ...x.t, links: [...links, ref] });
    } catch (err) {
      showNote(err.status === 409 ? 'Someone changed that task first. Try again.' : err.message);
    }
    render();
    resolveLinks();
  }

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
    const links = (t.links || []).length ? `<span class="links">${t.links.map((r) => linkChip(r, false)).join('')}</span>` : '';
    return `<div class="task ${t.done ? 'done' : ''}" data-task="${esc(x.key)}" ${x.scope === 'own' ? 'draggable="true"' : ''}>
      <input class="tick" type="checkbox" data-tick="${esc(x.key)}" ${t.done ? 'checked' : ''} ${editable ? '' : 'disabled'} aria-label="Done">
      <button class="text" type="button" data-open="${esc(x.key)}">${esc(t.title)}${notes}${links}</button>
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

  // Open / Done / All are icons in the titlebar when the host has one (a pane, or a module's own
  // window); on the server page there is none, and the buttons stay in the page.
  const FILTERS = [
    { id: 'open', icon: 'circle', regular: true, title: 'Open' },
    { id: 'done', icon: 'circle-check', title: 'Done' },
    { id: 'all', icon: 'list', title: 'All' },
  ];
  let headerSig = '';
  async function syncHeader(openCount) {
    if (!tavern.header) return;
    const sig = show + '|' + openCount;
    if (sig === headerSig) return;
    headerSig = sig;
    let hosted = false;
    try {
      hosted = await tavern.header.set(FILTERS.map((f) => ({ ...f, on: f.id === show, title: f.id === 'open' && openCount ? `Open (${openCount})` : f.title })));
    } catch (err) {
      hosted = false;
    }
    $('app').classList.toggle('hosted-header', Boolean(hosted));
  }
  if (tavern.header) {
    tavern.on('header', (e) => {
      if (!FILTERS.some((f) => f.id === e.id)) return;
      show = e.id;
      render();
    });
  }

  function render() {
    for (const b of $('filter').querySelectorAll('[data-show]')) b.classList.toggle('on', b.dataset.show === show);
    const own = [...tasks.values()].filter((x) => x.scope === 'own');
    const openCount = own.filter((x) => !x.t.done).length;
    $('count').textContent = own.length ? `${openCount} open` : '';
    syncHeader(openCount);

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
    syncLinks(t.id, t.links || []);
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
    editingLinks = ((x && x.t.links) || []).slice();
    $('f-auto').checked = Boolean(x && x.t.autoDone);
    $('f-auto').disabled = readOnly;
    $('f-link-search').value = '';
    $('f-link-results').innerHTML = '';
    $('f-link-search').hidden = readOnly || !tavern.refs;
    $('f-links-wrap').hidden = !tavern.refs || (readOnly && !editingLinks.length);
    renderEditorLinks(readOnly);
    resolveLinks();
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
    editingLinks = [];
  }

  function renderEditorLinks(readOnly = $('f-link-search').hidden) {
    $('f-links').innerHTML = editingLinks.map((r) => linkChip(r, !readOnly)).join('');
  }
  $('f-links').addEventListener('click', (e) => {
    const o = e.target.closest('[data-open-ref]');
    if (o) return void openLink(o.dataset.openRef);
    const b = e.target.closest('[data-unlink]');
    if (!b) return;
    editingLinks = editingLinks.filter((r) => refKey(r) !== b.dataset.unlink);
    renderEditorLinks();
  });

  function addEditorLink(ref) {
    if (!linkable(ref) || editingLinks.some((r) => refKey(r) === refKey(ref))) return;
    if (editingLinks.length >= MAX_LINKS) return showError('A task can link to ' + MAX_LINKS + ' things.');
    editingLinks.push(ref);
    renderEditorLinks();
    resolveLinks();
  }

  // Search the things this module may link to: here, and (from a room) the server's.
  let searchTimer = 0;
  async function searchLinks() {
    const text = $('f-link-search').value.trim();
    const box = $('f-link-results');
    if (!tavern.refs) return;
    try {
      const found = [...await tavern.refs.search(text)];
      if (inRoom) found.push(...await tavern.refs.search(text, { scope: 'server' }).catch(() => []));
      const fresh = found.filter((c) => !editingLinks.some((r) => refKey(r) === refKey(c.ref))).slice(0, 12);
      for (const c of fresh) cards.set(refKey(c.ref), c);
      box.innerHTML = fresh.length ? fresh.map((c) => `<button type="button" class="result" data-link="${esc(refKey(c.ref))}"><span>${esc(c.module.name)}: ${esc(c.title)}</span><small>${esc(dateText(c.when, c.allDay))}</small></button>`).join('') : '<span class="hint">Nothing found.</span>';
      box.dataset.found = JSON.stringify(fresh.map((c) => c.ref));
    } catch (err) {
      box.innerHTML = '';
    }
  }
  $('f-link-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(searchLinks, 250); });
  $('f-link-search').addEventListener('focus', searchLinks);
  $('f-link-results').addEventListener('click', (e) => {
    const b = e.target.closest('[data-link]');
    if (!b) return;
    const ref = JSON.parse($('f-link-results').dataset.found || '[]').find((r) => refKey(r) === b.dataset.link);
    if (ref) addEditorLink(ref);
    b.remove();
  });

  // Dropping an event or poll from another module on the open editor links it.
  const acceptsRef = (e) => tavern.refs && tavern.refs.accepts(e);
  $('editor').addEventListener('dragover', (e) => {
    if (!acceptsRef(e) || $('f-link-search').hidden) return;
    e.preventDefault();
    $('editor').classList.add('drop');
  });
  $('editor').addEventListener('dragleave', (e) => { if (e.target === $('editor')) $('editor').classList.remove('drop'); });
  $('editor').addEventListener('drop', (e) => {
    $('editor').classList.remove('drop');
    if (!acceptsRef(e) || $('f-link-search').hidden) return;
    e.preventDefault();
    const ref = tavern.refs.parse(e);
    if (ref) addEditorLink(ref);
  });
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
      links: editingLinks.slice(0, MAX_LINKS),
      autoDone: $('f-auto').checked,
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
      syncLinks(editing.id, []);
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
  // A link to another module's item opens it there; Tavern opens that module and hands it the pointer.
  const openLink = (key) => {
    const c = cards.get(key);
    if (!c || c.error || !c.open || !tavern.refs || !tavern.refs.open) return;
    tavern.refs.open(c.ref).catch((err) => showNote(err.message));
  };
  $('body').addEventListener('click', (e) => {
    const ref = e.target.closest('[data-open-ref]');
    if (ref) return void openLink(ref.dataset.openRef);
    const open = e.target.closest('[data-open]');
    if (open) {
      const x = tasks.get(open.dataset.open);
      if (x) openEditor(x);
    }
  });
  // A task can be dragged (to another module that links to tasks), and an event or a poll dragged from
  // another module onto a task links to it.
  $('body').addEventListener('dragstart', (e) => {
    const row = e.target.closest('[data-task]');
    const x = row && tasks.get(row.dataset.task);
    if (x && x.scope === 'own' && tavern.refs) tavern.refs.drag(e, 'task', x.id, { label: x.t.title });
  });
  $('body').addEventListener('dragover', (e) => {
    const row = e.target.closest('[data-task]');
    const x = row && tasks.get(row.dataset.task);
    if (!x || x.scope !== 'own' || !canEdit || !acceptsRef(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'link';
    row.classList.add('drop');
  });

  // A drag from another module on the same page is brokered by Tavern: it says where the pointer is
  // and what was dropped, in this page's own coordinates.
  const clearDrop = () => {
    for (const r of document.querySelectorAll('.task.drop')) r.classList.remove('drop');
    $('editor').classList.remove('drop');
  };
  const taskAt = (pt) => {
    const el = document.elementFromPoint(pt.x, pt.y);
    const row = el && el.closest('[data-task]');
    return row && tasks.get(row.dataset.task) && tasks.get(row.dataset.task).scope === 'own' ? row : null;
  };
  if (tavern.refs && tavern.refs.dropTarget) {
    tavern.refs.dropTarget({
      over: (pt, ref) => {
        clearDrop();
        if (!ref || !linkable(ref) || !canEdit) return;
        if (!$('editor').hidden) {
          if (!$('f-link-search').hidden) $('editor').classList.add('drop');
          return;
        }
        const row = taskAt(pt);
        if (row) row.classList.add('drop');
      },
      leave: clearDrop,
      drop: (ref, pt) => {
        clearDrop();
        if (!ref || !linkable(ref) || !canEdit) return;
        if (!$('editor').hidden) {
          if (!$('f-link-search').hidden) addEditorLink(ref);
          return;
        }
        const row = taskAt(pt);
        if (row) linkTo(row.dataset.task, ref);
      },
    });
  }
  $('body').addEventListener('dragleave', (e) => {
    const row = e.target.closest('[data-task]');
    if (row) row.classList.remove('drop');
  });
  $('body').addEventListener('drop', (e) => {
    const row = e.target.closest('[data-task]');
    for (const r of $('body').querySelectorAll('.drop')) r.classList.remove('drop');
    if (!row || !acceptsRef(e)) return;
    e.preventDefault();
    const ref = tavern.refs.parse(e);
    if (ref) linkTo(row.dataset.task, ref);
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
    await loadKinds();
    await load();
  } catch (err) {
    $('msg').textContent = 'The to-do list could not load: ' + err.message;
    return;
  }
  $('msg').hidden = true;
  $('app').hidden = false;
  render();
  // Other modules say what happens to their items (an event on a poll, say); Tavern delivers what this
  // module was approved to hear. A task marked to follow what it links to is ticked when a linked item is
  // finished: the conventional names are closed, done, completed and finished. Doing it twice is harmless.
  const FINISHED = new Set(['closed', 'done', 'completed', 'finished']);
  if (tavern.events && tavern.events.subscribe) {
    tavern.events.subscribe(async (e) => {
      if (!FINISHED.has(e.name) || !e.ref) return;
      const k = refKey(e.ref);
      for (const x of [...tasks.values()]) {
        if (x.scope !== 'own' || x.t.done || !x.t.autoDone || !(x.t.links || []).some((r) => refKey(r) === k)) continue;
        try {
          const t = { ...x.t, done: true, doneAt: Date.now() };
          await put(x, t);
          applyReminder(t).catch(() => {});
        } catch (err) {
          // changed or ticked by someone else meanwhile
        }
      }
      render();
    });
  }

  // What other modules may ask of this one. A task made this way links to the item it came from.
  if (tavern.actions && tavern.actions.provide) {
    tavern.actions.provide({
      createTask: async (input, meta) => {
        const t = {
          id: newId(), title: input.title, notes: input.notes || '', due: null, remind: false, done: false, doneAt: null,
          createdAt: Date.now(), by: (meta && meta.by) || 'someone', links: input.ref && linkable(input.ref) ? [input.ref] : [], autoDone: false,
        };
        await put(null, t);
        render();
        resolveLinks();
        return { ref: myRef(t.id) };
      },
    });
  }

  // Another module asking to show one of this module's tasks (from a link to it): open it.
  if (tavern.refs && tavern.refs.onOpen) {
    tavern.refs.onOpen((ref) => {
      const x = ref.kind === 'task' ? tasks.get('own:' + ref.id) : null;
      if (x) openEditor(x);
    });
  }
  resolveLinks();
  // Tell Tavern about links made before it was told (and only those that changed).
  for (const x of [...tasks.values()].filter((t) => t.scope === 'own' && (t.t.links || []).length).slice(0, 100)) syncLinks(x.id, x.t.links);
  // The items linked to can change or go; look again now and then.
  setInterval(() => { cards.clear(); resolveLinks(); }, 60000);
})();
