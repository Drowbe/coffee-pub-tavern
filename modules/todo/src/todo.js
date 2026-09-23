// To-do module. One file of code for every place it shows: the server's own page, a
// room's docked pane or floating panel, and a window of its own. Each place has its own
// list. On the server page the viewer's rooms' lists are shown too, read-only, each with
// its room's icon. The SDK (window.tavern) is injected by Tavern.
(async function () {
  'use strict';

  // This module runs in a frame (the SDK is a global) or in the page (its SDK is handed to its script);
  // either way it looks elements up in tavern.root, never in document, so it works in both.
  const tavern = (document.currentScript && document.currentScript.tavern) || window.tavern;
  const root = tavern.root;

  const $ = (id) => root.getElementById(id);
  const { esc, ymd, parseYmd, refKey, id: newId } = tavern.util;

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
  let editingRules = {}; // and what each does when the item reports something: { pointerKey: { eventName: outcome } }
  const MAX_LINKS = 5;
  // What this module may link to is whatever other modules share and Tavern says it may (module.json
  // refs.consumes is "*"), so a module written later takes part with no change here.
  let consumable = new Set(); // "module:kind"
  const kindEvents = new Map(); // "module:kind" -> what that kind of item can report: [{ name, label, data }]
  async function loadKinds() {
    try {
      const kinds = await tavern.refs.kinds();
      consumable = new Set(kinds.map((k) => k.module + ':' + k.kind));
      for (const k of kinds) kindEvents.set(k.module + ':' + k.kind, k.events || []);
    } catch (err) {
      consumable = new Set();
    }
  }
  // What a task can do when an item it links to reports something. Each is offered only when the event
  // carries what it needs: the summary is a line about how it turned out, the pick is an item it chose.
  const OUTCOMES = [
    { id: 'tick', label: 'Tick this', needs: [] },
    { id: 'note', label: 'Add the result to the notes', needs: ['summary'] },
    { id: 'both', label: 'Tick this and add the result', needs: ['summary'] },
    { id: 'title', label: 'Use the result as the title', needs: ['summary'] },
    { id: 'link', label: 'Link what it picked', needs: ['pick'] },
  ];
  const FINISHED = new Set(['closed', 'done', 'completed', 'finished']);
  // And what it can ask other modules to do with what an item reports: any action another module offers whose
  // required fields can be filled from the event (a date from its date, text from its summary, the item itself),
  // shown as "Module: what it does". Nothing here names those modules.
  let askable = [];
  async function loadAskable() {
    try {
      askable = (await tavern.actions.list()).filter((a) => a && a.input);
    } catch (err) {
      askable = [];
    }
  }
  const baseType = (t) => t.replace(/\?$/, '');
  const fillable = (a, event) => Object.entries(a.input).every(([, type]) => {
    if (type.endsWith('?')) return true;
    const base = baseType(type);
    const has = (f) => Object.keys(event.data || {}).includes(f);
    return base === 'date' ? has('date') : base === 'string' || base === 'text' ? has('summary') : base === 'ref';
  }) && Object.values(a.input).some((t) => !t.endsWith('?'));
  const outcomesFor = (event) => [
    ...OUTCOMES.filter((o) => o.needs.every((f) => Object.keys(event.data || {}).includes(f))),
    ...askable.filter((a) => fillable(a, event)).map((a) => ({ id: 'ask:' + a.action, label: a.moduleName + ': ' + a.label })),
  ];
  const askInput = (a, e) => {
    const data = e.data || {};
    const input = {};
    for (const [field, type] of Object.entries(a.input)) {
      if (type.endsWith('?')) continue;
      const base = baseType(type);
      if (base === 'date') input[field] = String(data.date || '');
      else if (base === 'string' || base === 'text') input[field] = String(data.summary || '');
      else if (base === 'ref') input[field] = e.ref;
    }
    return input;
  };
  const cards = new Map(); // pointer key -> card, or { error } when it is gone or not for this viewer

  // --- dates ---------------------------------------------------------------

  const pad = (n) => String(n).padStart(2, '0');
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
    return `<div class="task ${t.done ? 'done' : ''}" data-task="${esc(x.key)}">
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

  // Open / Done / All is the toolbar's view switch.
  const FILTERS = [
    { id: 'open', label: 'Open' },
    { id: 'done', label: 'Done' },
    { id: 'all', label: 'All' },
  ];
  const filterSwitch = tavern.ui.viewSwitch({
    id: 'filter',
    options: FILTERS,
    value: show,
    onChange: (id) => { show = id; render(); },
  });

  function render() {
    const own = [...tasks.values()].filter((x) => x.scope === 'own');
    const openCount = own.filter((x) => !x.t.done).length;
    $('count').textContent = own.length ? `${openCount} open` : '';
    filterSwitch.set(show, FILTERS.map((f) => (f.id === 'open' && openCount ? { ...f, label: `Open (${openCount})` } : f)));

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
  const duePicker = tavern.ui.datePicker($('f-due'), { clearable: true });

  function openEditor(x, prefill) {
    const readOnly = !canEdit || (x && x.scope !== 'own');
    const t = x ? x.t : { title: (prefill && prefill.title) || '', notes: '', due: (prefill && prefill.date) || null, remind: false, done: false };
    editing = x ? { key: x.key, id: x.id, version: x.version } : { key: null, id: null, version: null };
    editingLinks = ((x && x.t.links) || []).slice();
    editingRules = rulesFor(x && x.t);
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
    duePicker.refresh();
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

  // The task's rules with the older per-task settings folded in: those meant "tick, and keep the result" for
  // a finished item, which is what a rule on a link now says.
  function rulesFor(t) {
    const rules = {};
    const legacy = t && t.autoDone && t.autoNote ? 'both' : t && t.autoDone ? 'tick' : t && t.autoNote ? 'note' : null;
    for (const r of (t && t.links) || []) {
      for (const ev of kindEvents.get(r.module + ':' + r.kind) || []) {
        const set = t.rules && t.rules[refKey(r)] && t.rules[refKey(r)][ev.name];
        const use = set || (FINISHED.has(ev.name) ? legacy : null);
        if (use && outcomesFor(ev).some((o) => o.id === use)) (rules[refKey(r)] = rules[refKey(r)] || {})[ev.name] = use;
      }
    }
    return rules;
  }
  function renderRules(readOnly) {
    const rows = [];
    for (const r of editingLinks) {
      const c = cards.get(refKey(r));
      for (const ev of kindEvents.get(r.module + ':' + r.kind) || []) {
        const chosen = (editingRules[refKey(r)] || {})[ev.name] || '';
        rows.push(`<label class="rule"><span>${esc(c && !c.error ? c.title : 'That item')}: ${esc(ev.label)}</span><select data-rule="${esc(refKey(r))}|${esc(ev.name)}" ${readOnly ? 'disabled' : ''}><option value="">Do nothing</option>${outcomesFor(ev).map((o) => `<option value="${o.id}"${o.id === chosen ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`);
      }
    }
    $('f-rules').innerHTML = rows.join('');
  }
  $('f-rules').addEventListener('change', (e) => {
    const s = e.target.closest('[data-rule]');
    if (!s) return;
    const cut = s.dataset.rule.lastIndexOf('|'); // the pointer's own key holds bars
    const key = s.dataset.rule.slice(0, cut);
    const name = s.dataset.rule.slice(cut + 1);
    const rule = editingRules[key] = editingRules[key] || {};
    if (s.value) rule[name] = s.value; else delete rule[name];
  });
  function renderEditorLinks(readOnly = $('f-link-search').hidden) {
    $('f-links').innerHTML = editingLinks.map((r) => linkChip(r, !readOnly)).join('');
    renderRules(readOnly);
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
      rules: Object.fromEntries(Object.entries(editingRules).filter(([k, v]) => editingLinks.some((r) => refKey(r) === k) && Object.keys(v).length)),
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
  // A task can be dragged to another module (one that links to tasks, or does something with one).
  if (tavern.refs && tavern.refs.draggable) {
    tavern.refs.draggable($('body'), (target) => {
      const row = target.closest('[data-task]');
      const x = row && tasks.get(row.dataset.task);
      return x && x.scope === 'own' ? { kind: 'task', id: x.id, label: x.t.title } : null;
    });
  }

  // Something dropped here from another module (a drag Tavern brokers between panes on the same page): what can be
  // done with it is the shared decision (tavern.refs.dropMenu). This module's own offers: link it to the task under
  // the pointer, or start a task from it (linked to it when it is an item, titled and dated from it when it is a card
  // carried by the drag, an answer say). Dropped on the open editor's link field, it is linked there and nothing is asked.
  const clearDrop = () => {
    for (const r of root.querySelectorAll('.task.drop')) r.classList.remove('drop');
    $('editor').classList.remove('drop');
  };
  const taskAt = (pt) => {
    const el = tavern.refs.elementAt(pt);
    const row = el && el.closest('[data-task]');
    return row && tasks.get(row.dataset.task) && tasks.get(row.dataset.task).scope === 'own' ? row : null;
  };
  if (tavern.refs && tavern.refs.dropTarget) {
    tavern.refs.dropTarget({
      over: (pt, ref, dragged) => {
        clearDrop();
        if (!(ref || dragged.card) || !canEdit) return;
        if (!$('editor').hidden) {
          if (ref && linkable(ref) && !$('f-link-search').hidden) $('editor').classList.add('drop');
          return;
        }
        const row = taskAt(pt);
        if (row) row.classList.add('drop');
      },
      leave: clearDrop,
      drop: async (ref, pt, dragged) => {
        clearDrop();
        if (!(ref || dragged.card) || !canEdit) return tavern.refs.trace(`drop ignored: ${canEdit ? 'nothing valid was dropped' : 'cannot edit'}`);
        if (!$('editor').hidden) {
          if (ref && linkable(ref) && !$('f-link-search').hidden) addEditorLink(ref);
          return;
        }
        const row = taskAt(pt);
        const x = row && tasks.get(row.dataset.task);
        try {
          const own = [];
          if (x && ref && linkable(ref)) own.push({ id: 'link', label: `Link it to "${x.t.title}"`, run: () => linkTo(row.dataset.task, ref) });
          own.push({
            id: 'create',
            label: 'Start a task from it',
            run: (ctx) => { openEditor(null, { title: ctx.card.title || '', date: ctx.card.date || null }); if (ref && linkable(ref)) addEditorLink(ref); },
          });
          const chosen = await tavern.refs.dropMenu(dragged, pt, { context: x ? { target: myRef(x.id) } : {}, own, remember: x ? 'task' : 'list' });
          if (chosen && chosen.id !== 'link' && chosen.id !== 'create') showNote(`${chosen.label}: done`);
        } catch (err) {
          showNote(err.message);
        }
      },
    });
  }
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
  // the button and the quick-add field at the top stay only for a host without one.
  if (tavern.bar) {
    // Then the quick-add field at the top is not needed either: there is one place to add a task, the bar.
    $('add').classList.add('hosted');
    $('quick-form').classList.add('hosted');
    tavern.bar.set(canEdit ? [{ id: 'add', type: 'quickadd', label: 'Add task', placeholder: 'Add a task: book flights by sep 25' }] : []).catch(() => { $('add').classList.remove('hosted'); $('quick-form').classList.remove('hosted'); });
    tavern.on('bar', (e) => {
      if (e.id !== 'add' || !canEdit) return;
      openEditor(null, e.value ? tavern.util.parseWhen(e.value) : null);
    });
  }
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('editor').hidden) closeEditor(); });

  $('add').hidden = !canEdit;
  $('quick-form').hidden = !canEdit;
  try {
    await loadKinds();
    await loadAskable();
    await load();
  } catch (err) {
    $('msg').textContent = 'The to-do list could not load: ' + err.message;
    return;
  }
  $('msg').hidden = true;
  $('app').hidden = false;
  render();
  // Other modules say what happens to their items (a poll closing, say); Tavern delivers what this module
  // was approved to hear. Each link on a task can carry a rule for an event it may report: tick the task, keep
  // the result in its notes, use it as the title, or link what the item picked. A task from before rules that
  // asked to follow a finished item keeps doing that (the conventional names closed, done, completed and
  // finished). Doing a rule twice is harmless.
  if (tavern.events && tavern.events.subscribe) {
    tavern.events.subscribe(async (e) => {
      if (!e.ref) return;
      const k = refKey(e.ref);
      const summary = e.data && typeof e.data.summary === 'string' ? e.data.summary.slice(0, 200) : '';
      const pick = e.data && e.data.pick && typeof e.data.pick === 'object' && linkable(e.data.pick) ? e.data.pick : null;
      for (const x of [...tasks.values()]) {
        if (x.scope !== 'own' || !(x.t.links || []).some((r) => refKey(r) === k)) continue;
        const rule = rulesFor(x.t)[k] && rulesFor(x.t)[k][e.name];
        if (!rule) continue;
        let t = { ...x.t };
        let ask = null;
        if (rule.startsWith('ask:')) {
          // Ask another module to do something; the first page to record it does the asking, the others fail to save.
          const a = askable.find((o) => 'ask:' + o.action === rule);
          const marker = k + '|' + e.name;
          if (!a || (e.id && t.fired && t.fired[marker] === e.id) || (e.data && e.data.date && !/^\d{4}-\d{2}-\d{2}$/.test(String(e.data.date)))) continue;
          t = { ...t, fired: { ...(t.fired || {}), [marker]: e.id || Date.now() } };
          ask = { a, input: askInput(a, e) };
        }
        if ((rule === 'tick' || rule === 'both') && !t.done) t = { ...t, done: true, doneAt: Date.now() };
        if ((rule === 'note' || rule === 'both') && summary && !(t.notes || '').includes('Result: ' + summary)) t.notes = ((t.notes ? t.notes + '\n' : '') + 'Result: ' + summary).slice(0, 1000);
        if (rule === 'title' && summary && t.title !== summary) t.title = summary.slice(0, 200);
        if (rule === 'link' && pick && !(t.links || []).some((r) => refKey(r) === refKey(pick)) && (t.links || []).length < MAX_LINKS) t.links = [...(t.links || []), pick];
        if (JSON.stringify(t) === JSON.stringify(x.t)) continue;
        try {
          await put(x, t);
          applyReminder(t).catch(() => {});
          if (ask) {
            try {
              await tavern.actions.request(ask.a.action, ask.input);
              showNote(ask.a.moduleName + ': ' + ask.a.label + ' (from "' + t.title + '")');
            } catch (err) {
              showNote(err.message);
            }
          }
        } catch (err) {
          // changed or ticked by someone else meanwhile
        }
      }
      render();
    });
  }

  // What other modules may ask of this one about a task it names: link it to something, or set its due date.
  const ownTask = (ref) => {
    const x = ref && ref.kind === 'task' ? tasks.get('own:' + ref.id) : null;
    if (!x) throw new Error('that task is not here');
    return x;
  };
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
      linkTask: async (input) => {
        const x = ownTask(input.task);
        if (!linkable(input.target)) throw new Error('this list may not link to that');
        await linkTo(x.key, input.target);
        return { ref: myRef(x.id) };
      },
      setTaskDue: async (input) => {
        const x = ownTask(input.task);
        const t = { ...x.t, due: input.date, remind: x.t.remind };
        await put(x, t);
        applyReminder(t).catch(() => {});
        render();
        return { ref: myRef(x.id) };
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
