// The Research module's page: notes, links and photos a group keeps while it plans, each a card that can be tagged, found again,
// linked from anywhere and dragged onto a plan; and an Ask panel where the AI the admin chose answers over the items, writing what
// is worth keeping as a card. The items live in the module's store (see research-lib.js). This page draws into the markup in
// research.html by cloning its templates and filling their [data-slot] and [data-icon] hooks, and toggles the state classes and
// data attributes CONTRACT.md lists. It builds no markup from strings and sets no style (a tag's colour, --tag, and the item menu's
// position are the exceptions). Nothing here names another module.
(async () => {
  'use strict';

  // This module runs in a frame (the SDK is a global) or in the page (its SDK is handed to its script); either way it looks
  // elements up in tavern.root, never in document.
  const tavern = (document.currentScript && document.currentScript.tavern) || window.tavern;
  const root = tavern.root;
  const $ = (id) => root.getElementById(id);

  let info;
  try {
    info = await tavern.ready();
  } catch (err) {
    $('msg').textContent = 'Research could not start: ' + err.message;
    return;
  }
  const inRoom = info.context.scope === 'room';
  const geo = tavern.util.geo;
  /*__LIB__*/

  const canEdit = tavern.can('edit');
  const personal = Boolean(info.user && info.user.key !== 'guest'); // a guest has no profile, so nothing of their own
  const isAdmin = Boolean(info.user && info.user.role === 'admin');
  const me = (info.user && info.user.key) || '';

  // Two stores of the same kind of thing: this room's, and the person's own (private, the same in every room).
  const stores = { room: createResearch(tavern, { scope: 'room' }), my: createResearch(tavern, { scope: 'person' }) };
  const loadedStores = new Set();
  const ensureLoaded = (v) => { if (loadedStores.has(v)) return Promise.resolve(); loadedStores.add(v); return stores[v].load().catch((err) => { loadedStores.delete(v); throw err; }); };
  let view = inRoom ? 'room' : 'my';
  const research = new Proxy({}, { get: (_, key) => stores[view][key] });
  const scopeOf = () => (view === 'my' ? 'person' : 'room');
  const allowed = { my: personal, room: inRoom };

  const state = {
    people: [],
    filter: '',
    kind: '',
    tags: [], // tags chosen as filters (an item must have all)
    loaded: false,
    editing: null, // { id | null, kind, version, point, pointOk, seed }
    menuFor: null,
    armed: null,
    uploads: [], // { el, file, step, progress, error, posAsk }
    tagColors: new Map(), // a well-known tag -> its colour
    ai: false, // whether this person may use AI here
    asking: false,
    lastQuestion: '',
    thumbs: new Map(), // photo id -> address of its thumbnail in the view it was asked for
  };
  const nameOf = (key) => (state.people.find((p) => p.key === key) || {}).name || (key === me && info.user ? info.user.displayName : '') || '';
  const initial = (key) => (nameOf(key)[0] || '?').toUpperCase();

  // --- small helpers ------------------------------------------------------------------------------------------------

  const clone = (id) => $(id).content.firstElementChild.cloneNode(true);
  const hide = (node, yes) => { if (node) node.hidden = Boolean(yes); };
  const slot = (el, name) => (el.dataset.slot === name ? el : el.querySelector(`[data-slot="${name}"]`));
  // Set a slot's text, or hide the slot when there is nothing to show; a `<name>-wrap` around it hides with it.
  function fill(el, values) {
    for (const [name, value] of Object.entries(values)) {
      const s = slot(el, name);
      const empty = value === '' || value == null;
      if (s) { s.textContent = empty ? '' : String(value); s.hidden = empty; }
      const wrap = slot(el, `${name}-wrap`);
      if (wrap) wrap.hidden = empty;
    }
  }
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
  const say = (text, ms) => { const n = $('note'); n.textContent = text || ''; n.hidden = !text; if (text && ms) setTimeout(() => { if (n.textContent === text) say(''); }, ms); };
  const message = (err) => (err && err.message) || String(err);

  // The pane's width, not the window's: a bundled module runs in the page, so a media query would follow the window.
  const fit = () => {
    const w = tavern.rootElement.clientWidth;
    if (w) $('app').classList.toggle('narrow', w < 720);
  };
  fit();
  new ResizeObserver(fit).observe(tavern.rootElement);

  const dayText = (d) => { const t = new Date(`${d}T12:00:00`); return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };
  // What to call an item an answer came from: its title when it is one of ours, otherwise what kind of thing it is.
  const sourceLabel = (r) => (r.module === info.module.id && stores.room.get(r.id) ? stores.room.get(r.id).title : r.module === info.module.id && stores.my.get(r.id) ? stores.my.get(r.id).title : r.label || r.kind);
  // A source of an answer as a pill; `gone` when it is one of ours that is no longer there.
  const sourcePill = (r) => {
    const el = clone('tpl-source');
    fill(el, { label: sourceLabel(r) });
    el.classList.toggle('gone', r.module === info.module.id && !stores.room.get(r.id) && !stores.my.get(r.id));
    return el;
  };
  const placeText = (p) => (p ? p.name || geo.coordsText(p.lat, p.lng) : '');

  // --- tags ---------------------------------------------------------------------------------------------------------

  const colorOf = (tag) => state.tagColors.get(tag) || '';
  function loadTagColors(values) {
    state.tagColors = new Map();
    for (const r of (values && Array.isArray(values.tags) ? values.tags : [])) if (r && r.color) { state.tagColors.set(String(r.label || r.id).toLowerCase().replace(/[^\p{L}\p{N}-]/gu, ''), r.color); }
  }
  function tagNode(tag, tplId) {
    const el = clone(tplId);
    fill(el, { label: tag });
    const c = colorOf(tag);
    if (c) el.style.setProperty('--tag', c);
    return el;
  }

  // --- the list -----------------------------------------------------------------------------------------------------

  const visible = () => filterItems(research.list(), { q: state.filter, kind: state.kind, tags: state.tags });
  const thumbUrl = (it) => {
    const key = `${view}:${it.file.id}`;
    if (!state.thumbs.has(key)) {
      state.thumbs.set(key, '');
      tavern.uploads.url(it.file.id, { thumb: it.file.hasThumb, scope: scopeOf() }).then((u) => { state.thumbs.set(key, u); for (const img of root.querySelectorAll(`.rcard[data-id="${it.id}"] [data-slot="thumb"]`)) { img.src = u; img.hidden = false; } }).catch(() => {});
    }
    return state.thumbs.get(key);
  };

  // What other modules point at each item (room view only: a person's own items are never linked): asked once per item, cleared by the
  // 'links' event. Shown as one pill per kind of linker: "Task: book the hotel", or "2 plans".
  const links = new Map(); // item id -> cards of what points at it
  const linkTarget = new WeakMap(); // a pill -> the pointer to open
  const askedLinks = new Set();
  async function loadLinks() {
    if (view === 'my' || !tavern.refs || !tavern.refs.linksTo) return;
    let changed = false;
    for (const it of research.list().slice(0, 100)) {
      if (askedLinks.has(it.id)) continue;
      askedLinks.add(it.id);
      try {
        const cards = await tavern.refs.linksTo(research.refOf(it.kind, it.id));
        if (cards.length) { links.set(it.id, cards); changed = true; }
      } catch (err) { /* nothing points at it */ }
    }
    if (changed) render();
  }
  if (tavern.on) tavern.on('links', () => { askedLinks.clear(); links.clear(); loadLinks().catch(() => {}); });
  function backlinkPills(cards) {
    const groups = new Map();
    for (const c of cards) { const k = c.kindName || c.kind || 'item'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
    const all = [...groups.entries()];
    const pills = all.slice(0, 3).map(([kind, list]) => {
      const el = clone('tpl-backlink');
      setIcon(el.querySelector('[data-icon]'), (list[0].module && list[0].module.icon) || 'link');
      fill(el, { label: list.length === 1 ? `${kind}: ${list[0].title}` : `${list.length} ${kind.toLowerCase()}s` });
      el.title = list.map((c) => c.title).join(', ');
      linkTarget.set(el, list[0].ref);
      return el;
    });
    if (all.length > 3) { const more = clone('tpl-backlink-more'); fill(more, { label: `+${all.length - 3}` }); pills.push(more); }
    return pills;
  }

  function card(it) {
    const el = clone('tpl-card');
    el.dataset.id = it.id;
    el.dataset.kind = it.kind;
    setIcon(el.querySelector('.kind [data-icon]'), KIND_ICON[it.kind]);
    fill(el, { kind: KIND_LABEL[it.kind], title: it.title, site: it.site, excerpt: it.kind === 'photo' ? '' : textOf(it), when: it.date ? dayText(it.date) : '', place: placeText(it.point), by: initial(it.by) });
    hide(slot(el, 'ai'), it.kind !== 'answer');
    const by = slot(el, 'by-wrap');
    if (by) by.title = nameOf(it.by) ? `Added by ${nameOf(it.by)}` : '';
    hide(slot(el, 'by-wrap'), !it.by || view === 'my');
    const img = slot(el, 'thumb');
    // A picture that will not load (its file was removed) shows a quiet placeholder instead of nothing.
    img.addEventListener('error', () => { if (img.getAttribute('src')) { img.classList.add('missing'); img.hidden = false; } });
    if (it.kind === 'photo' && it.file) { const u = thumbUrl(it); if (u) { img.src = u; img.hidden = false; } } else hide(img, true);
    const tags = slot(el, 'tags');
    tags.replaceChildren(...it.tags.map((t) => tagNode(t, 'tpl-tag')));
    tags.hidden = !it.tags.length;
    const back = slot(el, 'backlinks');
    if (back) { back.replaceChildren(...backlinkPills(links.get(it.id) || [])); back.hidden = !back.children.length; }
    return el;
  }

  function renderUploads() {
    for (const n of root.querySelectorAll('.upload, .pos-ask')) n.remove();
    const body = $('body');
    body.prepend(...state.uploads.map((u) => u.el));
    hydrate(body);
  }

  function render() {
    const all = research.list();
    const empty = state.loaded && !all.length && !state.uploads.length;
    fill($('app').querySelector('.rs-head'), { count: all.length ? String(all.length) : '' });
    for (const n of [$('kinds'), $('tag-chips'), $('app').querySelector('.rs-tools')]) hide(n, empty || !state.loaded);
    const body = $('body');
    if (!state.loaded) { body.replaceChildren(clone('tpl-state-loading')); return; }
    if (empty) {
      body.replaceChildren(clone('tpl-state-empty'));
      for (const b of body.querySelectorAll('[data-action="new-note"], [data-action="add-photo"]')) hide(b, !canEdit);
      hydrate(root);
      return;
    }
    for (const b of $('kinds').querySelectorAll('.rs-chip')) b.classList.toggle('on', b.dataset.kind === state.kind);
    const counts = tagCounts(all);
    $('tag-chips').replaceChildren(...counts.map(({ tag }) => { const c = tagNode(tag, 'tpl-chip-tag'); c.dataset.tag = tag; c.classList.toggle('on', state.tags.includes(tag)); return c; }));
    const dl = $('tag-list');
    dl.replaceChildren(...counts.map(({ tag }) => { const o = document.createElement('option'); o.value = tag; return o; }));
    const shown = visible();
    const grid = document.createElement('div');
    grid.className = 'rs-grid';
    if (!shown.length && !state.uploads.length) { body.replaceChildren(clone('tpl-state-noresults')); hydrate(root); return; }
    grid.replaceChildren(...shown.map(card));
    body.replaceChildren(grid);
    renderUploads();
    hydrate(root);
  }
  for (const key of Object.keys(stores)) {
    stores[key].subscribe(() => {
      if (view !== key) return; // a change to the store not being looked at needs no redraw
      if (state.loaded) render();
      checkConflict();
    });
  }

  $('filter').addEventListener('input', () => { state.filter = $('filter').value; render(); });
  $('kinds').addEventListener('click', (ev) => { const b = ev.target.closest('.rs-chip'); if (b) { state.kind = b.dataset.kind; render(); } });
  $('tag-chips').addEventListener('click', (ev) => {
    const b = ev.target.closest('.rs-chip');
    if (!b) return;
    state.tags = state.tags.includes(b.dataset.tag) ? state.tags.filter((t) => t !== b.dataset.tag) : [...state.tags, b.dataset.tag];
    render();
  });

  // --- the item menu ------------------------------------------------------------------------------------------------

  const mayRemove = (it) => canEdit && (view === 'my' || it.kind !== 'photo' || it.by === me || isAdmin);
  function openMenu(id, button) {
    const it = research.get(id);
    if (!it) return;
    const menu = $('item-menu');
    state.menuFor = id;
    fill(menu, { 'edit-label': canEdit ? 'Edit' : 'View', 'copy-label': view === 'my' ? 'Copy to This room' : 'Copy to Mine' });
    hide(menu.querySelector('[data-action="copy-to"]'), !canEdit || !personal || !inRoom || it.kind === 'photo');
    hide(menu.querySelector('[data-action="ask-about"]'), !state.ai || it.kind === 'photo');
    hide(menu.querySelector('[data-action="delete"]'), !mayRemove(it));
    menu.querySelector('[data-action="delete"] [data-slot="delete-label"]').textContent = 'Remove';
    state.armed = null;
    menu.hidden = false;
    hydrate(menu);
    const box = tavern.rootElement.getBoundingClientRect();
    const b = button.getBoundingClientRect();
    const left = Math.max(4, Math.min(b.right - box.left - menu.offsetWidth, box.width - menu.offsetWidth - 4));
    menu.style.top = `${Math.max(4, b.bottom - box.top + 4)}px`;
    menu.style.left = `${left}px`;
  }
  const closeMenu = () => { hide($('item-menu'), true); state.menuFor = null; };

  // --- the dialog for one item --------------------------------------------------------------------------------------

  const editorError = (text) => { $('f-error').textContent = text; $('f-error').hidden = !text; };
  const dropConflict = () => { for (const n of $('form').querySelectorAll('.conflict-bar')) n.remove(); if (state.editing) state.editing.conflict = null; };
  const setFormEditable = (yes) => { for (const f of $('form').querySelectorAll('input, textarea, select')) f.disabled = !yes; };

  function readPoint() {
    const text = $('f-point').value.trim();
    const e = state.editing;
    if (!text) { e.point = null; e.pointOk = true; $('f-point-note').textContent = ''; return; }
    const pt = geo.parsePoint(text);
    e.point = pt ? { ...pt, ...(e.point && e.point.name ? { name: e.point.name } : {}) } : null;
    e.pointOk = Boolean(pt);
    $('f-point-note').textContent = pt ? 'Coordinates found.' : 'No coordinates in that.';
  }
  $('f-point').addEventListener('input', readPoint);

  // Show an item in the dialog: a new one (`id` null; `seed` its start, with its kind), or an existing one.
  function openEditor(id, seed) {
    const cur = id ? research.get(id) : null;
    if (id && !cur) return;
    const s = seed || {};
    const kind = cur ? cur.kind : KINDS.includes(s.kind) ? s.kind : 'note';
    const it = cur || { kind, title: s.title || '', body: s.body || '', excerpt: s.excerpt || '', content: '', url: s.url || '', tags: [], date: '', point: s.point || null, by: '', ai: null };
    state.editing = { id: id || null, kind, version: cur ? research.versionOf(id) : undefined, point: it.point, pointOk: true, conflict: null };
    dropConflict();
    $('form').dataset.kind = kind;
    $('editor-title').textContent = id ? (canEdit ? `Change this ${KIND_LABEL[kind].toLowerCase()}` : it.title) : `New ${KIND_LABEL[kind].toLowerCase()}`;
    $('f-title').value = kind === 'photo' ? '' : it.title;
    $('f-caption').value = kind === 'photo' ? it.title : '';
    $('f-url').value = it.url;
    $('f-body').value = kind === 'answer' ? it.content : it.body;
    fill($('form'), { 'body-label': kind === 'answer' ? 'Answer' : 'Note' });
    $('f-excerpt').value = it.excerpt;
    $('f-tags').value = it.tags.join(', ');
    $('f-point').value = it.point ? geo.coordsText(it.point.lat, it.point.lng) : '';
    $('f-point-note').textContent = '';
    $('f-date').value = it.date;
    hide($('f-asked'), !(kind === 'answer' && it.ai));
    if (kind === 'answer' && it.ai) {
      fill($('f-asked'), { asked: it.ai.question });
      const src = $('f-asked').querySelector('[data-slot="sources"]');
      src.replaceChildren(...it.ai.sources.map(sourcePill));
    }
    $('f-by').textContent = it.by ? `Added by ${nameOf(it.by) || 'someone'}${it.at ? ' on ' + dayText(it.at.slice(0, 10)) : ''}` : '';
    editorError('');
    setFormEditable(canEdit);
    hide($('f-save'), !canEdit);
    hide($('form').querySelector('[data-action="suggest-tags"]'), !(state.ai && canEdit && id && kind !== 'photo'));
    hide($('f-delete'), !id || !cur || !mayRemove(cur));
    $('f-delete').textContent = 'Remove';
    state.armed = null;
    hide($('editor'), false);
    hydrate($('editor'));
    if (canEdit) (kind === 'photo' ? $('f-caption') : kind === 'link' && !id ? $('f-url') : $('f-title')).focus();
  }
  function closeEditor() { hide($('editor'), true); state.editing = null; }

  // Someone else changed the item that is open: say so, and offer their version or keeping mine.
  function checkConflict() {
    const e = state.editing;
    if (!e || !e.id || !canEdit || e.conflict) return;
    if (!research.get(e.id)) { closeEditor(); return; }
    const now = research.versionOf(e.id);
    if (now !== e.version) showConflict(now);
  }
  function showConflict(version) {
    const e = state.editing;
    if (!e) return;
    dropConflict();
    e.conflict = { version };
    const bar = clone('tpl-conflict');
    fill(bar, { text: 'Someone changed this while you were editing.' });
    $('form').querySelector('.editor-buttons').before(bar);
    editorError('');
  }
  $('form').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-action]');
    const e = state.editing;
    if (!b || !e || !e.conflict) return;
    if (b.dataset.action === 'use-theirs') { const id = e.id; dropConflict(); openEditor(id); }
    else if (b.dataset.action === 'keep-mine') { e.version = e.conflict.version; dropConflict(); }
  });

  $('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const e = state.editing;
    if (!e || !canEdit) return;
    const base = e.id ? research.get(e.id) : null;
    const kind = e.kind;
    readPoint();
    if (!e.pointOk) return editorError('The place is not coordinates or a map link. Leave it empty, or paste one.');
    if (e.conflict) return editorError('Choose Use theirs or Keep mine first.');
    const url = kind === 'link' ? cleanUrl($('f-url').value) : '';
    if (kind === 'link' && !url) return editorError('Give a web address that starts with https:// or http://.');
    const title = kind === 'photo' ? $('f-caption').value : $('f-title').value;
    if (!geo.oneLine(title, 120) && kind !== 'link' && !(kind === 'note' && $('f-body').value.trim())) return editorError(kind === 'photo' ? 'Give the photo a caption.' : 'Give it a title, or write something in it.');
    const item = {
      id: e.id || '',
      kind,
      title,
      body: kind === 'note' ? $('f-body').value : '',
      excerpt: kind === 'link' ? $('f-excerpt').value : '',
      content: kind === 'answer' ? $('f-body').value : '',
      url: url || '',
      tags: parseTags($('f-tags').value),
      date: $('f-date').value,
      point: kind === 'photo' || kind === 'answer' ? (base ? base.point : null) : e.point,
      file: base ? base.file : null,
      by: base ? base.by : me,
      at: base ? base.at : new Date().toISOString(),
      ai: base ? base.ai : null,
    };
    $('f-save').disabled = true;
    try {
      await research.save(item, e.id ? e.version : undefined);
      closeEditor();
    } catch (err) {
      if (err && err.status === 409) {
        if (e.id && research.get(e.id)) showConflict(research.versionOf(e.id));
        else editorError('That was removed by someone else.');
      } else editorError('It could not be saved: ' + message(err));
    } finally {
      $('f-save').disabled = false;
    }
  });
  $('f-cancel').addEventListener('click', closeEditor);
  $('f-delete').addEventListener('click', async () => {
    const e = state.editing;
    if (!e || !e.id) return;
    if (state.armed !== 'editor') { state.armed = 'editor'; $('f-delete').textContent = 'Remove it?'; return; }
    state.armed = null;
    try { await research.remove(e.id); closeEditor(); } catch (err) { editorError('It could not be removed: ' + message(err)); }
  });
  $('editor').addEventListener('pointerdown', (ev) => { if (ev.target === $('editor')) closeEditor(); });

  // --- photos: choose, prepare (resize and a thumbnail, here in the page), upload ------------------------------------

  const jpegOf = (bitmap, max, quality) => {
    const { width, height } = fitSize(bitmap.width, bitmap.height, max);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // a transparent picture becomes white rather than black
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('the picture could not be prepared'))), 'image/jpeg', quality));
  };

  function newUpload(file) {
    const el = clone('tpl-upload');
    fill(el, { name: file.name || 'Photo' });
    const rec = { el, file, step: '', error: false, scope: scopeOf(), store: stores[view] }; // the view it was chosen in, even if the person switches
    state.uploads.push(rec);
    el.querySelector('[data-action="retry-upload"]').addEventListener('click', () => { rec.error = false; runUpload(rec); });
    return rec;
  }
  const setStep = (rec, step, progress, error) => {
    rec.error = Boolean(error);
    fill(rec.el, { step });
    rec.el.classList.toggle('failed', Boolean(error));
    if (progress !== undefined) rec.el.querySelector('progress').value = progress;
    hide(rec.el.querySelector('[data-action="retry-upload"]'), !error);
  };
  const finishUpload = (rec) => { state.uploads = state.uploads.filter((u) => u !== rec); rec.el.remove(); render(); };

  async function runUpload(rec) {
    const sc = rec.scope;
    const store = rec.store;
    try {
      setStep(rec, 'Preparing…', 5);
      const facts = await tavern.uploads.inspect(rec.file.slice(0, 256 * 1024, rec.file.type), { scope: sc }).catch(() => ({}));
      let bitmap;
      try { bitmap = await createImageBitmap(rec.file, { imageOrientation: 'from-image' }); } catch (err) { throw new Error('this browser cannot read that picture'); }
      const main = await jpegOf(bitmap, 2000, 0.85);
      const thumb = await jpegOf(bitmap, 400, 0.8);
      if (bitmap.close) bitmap.close();
      setStep(rec, 'Uploading…', 35);
      const file = rec.done || (rec.done = await tavern.uploads.put(main, { name: rec.file.name, scope: sc }));
      setStep(rec, 'Uploading…', 75);
      await tavern.uploads.thumb(file.id, thumb, { scope: sc });
      const day = facts.taken ? facts.taken.slice(0, 10) : '';
      const item = await store.save({ kind: 'photo', title: captionOf(rec.file.name) || 'Photo', file: { id: file.id, hasThumb: true }, tags: [], date: isDay(day) ? day : '', by: me });
      if (facts.hasPosition && facts.position) { rec.el = askPosition(rec, item, facts.position); renderUploads(); } else finishUpload(rec);
    } catch (err) {
      setStep(rec, 'Could not add it: ' + message(err), undefined, true);
    }
    renderUploads();
  }
  // The file had a position, which is left out unless the person keeps it.
  function askPosition(rec, item, position) {
    const el = clone('tpl-pos-ask');
    fill(el, { text: `This photo has a position (${geo.coordsText(position.lat, position.lng)}). Photos are shared without it unless you keep it.` });
    el.addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-action]');
      if (!b) return;
      if (b.dataset.action === 'keep-position') {
        try {
          const cur = rec.store.get(item.id);
          if (cur) await rec.store.save({ ...cur, point: position }, rec.store.versionOf(item.id));
        } catch (err) { say('The position could not be kept: ' + message(err), 4000); }
      }
      finishUpload(rec);
    });
    return el;
  }
  function addPhotos(files) {
    if (!canEdit) return;
    const list = [...files].filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
    if (!list.length) return say('Choose a picture (JPEG, PNG, WebP or a phone photo).', 4000);
    for (const f of list.slice(0, 10)) runUpload(newUpload(f));
    renderUploads();
  }
  function choosePhotos() {
    if (!canEdit) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.addEventListener('change', () => addPhotos(input.files));
    input.click();
  }

  // --- Ask ----------------------------------------------------------------------------------------------------------

  const ask = { items: [], label: '' };
  function openAsk(items) {
    ask.items = items.slice(0, 12);
    fill($('ask'), { scope: ask.items.length === 1 ? ask.items[0].title : `${ask.items.length} items` });
    hide($('ask'), false);
    hydrate($('ask'));
    $('ask-input').focus();
  }
  const closeAsk = () => hide($('ask'), true);
  const thread = () => $('thread');
  const scrollDown = () => { thread().scrollTop = thread().scrollHeight; };

  function aiCard(c, question) {
    const el = clone('tpl-aicard');
    setIcon(el.querySelector('.badge [data-icon]'), c.icon || 'note');
    fill(el, { title: c.title, content: c.content, place: placeText(c.place), when: c.date ? dayText(c.date) : '' });
    const tags = slot(el, 'tags');
    tags.replaceChildren(...(c.tags || []).map((t) => tagNode(t, 'tpl-tag')));
    tags.hidden = !(c.tags || []).length;
    const srcs = slot(el, 'sources');
    srcs.replaceChildren(...(c.sources || []).map(sourcePill));
    hide(slot(el, 'sources-wrap'), !(c.sources || []).length);
    hide(el.querySelector('[data-action="keep-card"]'), !canEdit);
    el.addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-action]');
      if (!b) return;
      if (b.dataset.action === 'copy-card') {
        try { await navigator.clipboard.writeText(`${c.title}\n${c.content}`); say('Copied.', 2000); } catch (err) { say('Select the text and copy it.', 3000); }
      } else if (b.dataset.action === 'keep-card') {
        b.disabled = true;
        try {
          const kept = await research.save(answerFromCard({ ...c, sources: (c.sources || []).map((r) => ({ ...r, label: sourceLabel(r) })) }, question, me, new Date().toISOString()));
          b.classList.add('kept');
          say('Kept in Research.', 2500);
          el.dataset.kept = kept.id;
        } catch (err) { b.disabled = false; say('It could not be kept: ' + message(err), 4000); }
      }
    });
    return el;
  }
  function showReply(question, reply) {
    const msg = clone('tpl-msg-ai');
    fill(msg, { who: 'AI' });
    const parts = msg.querySelector('.parts');
    for (const p of answerParts(reply.text, (reply.cards || []).length)) {
      if (p.card !== undefined) parts.append(aiCard(reply.cards[p.card], question));
      else { const t = clone('tpl-msg-text'); fill(t, { text: p.text }); parts.append(t); }
    }
    return msg;
  }
  $('ask-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const q = $('ask-input').value.trim();
    if (q.length < 3 || state.asking || !state.ai) return;
    state.asking = true;
    $('ask-send').disabled = true;
    const you = clone('tpl-msg-you');
    fill(you, { text: q });
    const waiting = document.createElement('div');
    waiting.append(clone('tpl-writing'));
    thread().append(you, waiting);
    hydrate(thread());
    $('ask-input').value = '';
    scrollDown();
    try {
      const reply = await tavern.ai.ask({ task: 'ask', question: q, items: ask.items.map((it) => research.refOf(it.kind, it.id)) });
      waiting.replaceWith(showReply(q, reply));
    } catch (err) {
      const t = clone('tpl-msg-text');
      fill(t, { text: 'The AI could not answer: ' + message(err) });
      waiting.replaceWith(t);
    } finally {
      state.asking = false;
      $('ask-send').disabled = false;
      hydrate(thread());
      scrollDown();
    }
  });
  $('ask-input').addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); $('ask-form').requestSubmit(); } });
  async function checkAi() {
    // The Ask button is always drawn once the pane is loaded, so a person can see it exists: dimmed, with the reason, when AI cannot be used here.
    let why = '';
    try { const a = await tavern.ai.available(); state.ai = Boolean(a.available); why = a.why || ''; } catch (err) { state.ai = false; why = 'this module has not been approved to use AI (turn it off and on again in Manage > Modules and approve it)'; }
    state.aiWhy = why;
    const btn = $('ask-btn');
    hide(btn, !state.loaded);
    btn.classList.toggle('unavailable', !state.ai);
    btn.setAttribute('aria-disabled', String(!state.ai));
    btn.title = state.ai ? '' : 'AI is not available here: ' + why;
  }

  // Suggest tags for the item in the dialog (a saved one: the server reads it as the person asking). The words go into the tags field
  // for the person to keep or change; nothing is saved until they save.
  async function suggestTags() {
    const e = state.editing;
    const btn = $('form').querySelector('[data-action="suggest-tags"]');
    if (!e || !e.id || !state.ai || !btn) return;
    btn.disabled = true;
    editorError('');
    try {
      const r = await tavern.ai.ask({ task: 'tags', items: [research.refOf(e.kind, e.id)] });
      const have = parseTags($('f-tags').value);
      $('f-tags').value = [...new Set([...have, ...(r.tags || [])])].slice(0, 8).join(', ');
      if (!(r.tags || []).length) editorError('The AI had no tags to suggest.');
    } catch (err) { editorError('The AI could not suggest tags: ' + message(err)); } finally { btn.disabled = false; }
  }

  // --- clicks on the page -------------------------------------------------------------------------------------------

  root.addEventListener('click', async (ev) => {
    const menu = $('item-menu');
    if (!menu.hidden && !ev.target.closest('#item-menu') && !ev.target.closest('[data-action="menu"]')) closeMenu();
    const t = ev.target.closest('[data-action]');
    const cardEl = ev.target.closest('.rcard');
    if (t && t.dataset.action === 'menu' && cardEl) {
      ev.stopPropagation();
      if (!menu.hidden && state.menuFor === cardEl.dataset.id) return closeMenu();
      return openMenu(cardEl.dataset.id, t);
    }
    if (t && menu.contains(t)) {
      const id = state.menuFor;
      const it = id && research.get(id);
      const a = t.dataset.action;
      if (!it) return closeMenu();
      if (a === 'edit') { closeMenu(); openEditor(id); }
      else if (a === 'ask-about') { closeMenu(); openAsk([it]); }
      else if (a === 'copy-to') {
        closeMenu();
        const target = view === 'my' ? stores.room : stores.my;
        try {
          await ensureLoaded(view === 'my' ? 'room' : 'my');
          await target.save({ ...it, id: '', by: me, at: new Date().toISOString(), ai: it.ai ? { ...it.ai, sources: [] } : null });
          say(view === 'my' ? 'Copied to this room.' : 'Copied to Mine.', 2500);
        } catch (err) { say('It could not be copied: ' + message(err)); }
      } else if (a === 'delete' && mayRemove(it)) {
        if (state.armed !== 'menu') { state.armed = 'menu'; t.querySelector('[data-slot="delete-label"]').textContent = 'Remove it?'; return; }
        state.armed = null;
        closeMenu();
        try { await research.remove(id); } catch (err) { say('It could not be removed: ' + message(err)); }
      }
      return;
    }
    if (t && t.dataset.action === 'open-backlink') { ev.stopPropagation(); const ref = linkTarget.get(t); if (ref) tavern.refs.open(ref).catch(() => say('That could not be opened.', 3000)); return; }
    if (t && t.dataset.action === 'suggest-tags') return suggestTags();
    if (t && t.dataset.action === 'new-note') return openEditor(null, { kind: 'note' });
    if (t && t.dataset.action === 'add-photo') return choosePhotos();
    if (t && t.dataset.action === 'clear-filter') { state.filter = ''; state.kind = ''; state.tags = []; $('filter').value = ''; return render(); }
    if (t && t.dataset.action === 'ask') { if (!state.ai) return say('AI is not available here: ' + (state.aiWhy || 'it is not set up'), 6000); const asked = visible().filter((it) => it.kind !== 'photo').slice(0, 12); if (!asked.length) return say('Add a note or a link first, then ask about it.', 5000); return openAsk(asked); }
    if (t && t.dataset.action === 'close-ask') return closeAsk();
    if (cardEl && !ev.target.closest('.menu')) openEditor(cardEl.dataset.id);
  });
  // An item can be dragged out to another module (onto a day of a plan, or a task that links to it): press its card and move.
  if (tavern.refs && tavern.refs.draggable) {
    tavern.refs.draggable(root, (target) => {
      const el = target.closest && target.closest('.rcard');
      if (!el || !el.dataset.id || target.closest('.menu, button, a')) return null;
      const it = research.get(el.dataset.id);
      return it ? { kind: it.kind, id: it.id, label: it.title, ...(view === 'my' ? { scope: 'person' } : {}) } : null;
    });
  }
  root.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      if (!$('item-menu').hidden) closeMenu(); else if (!$('editor').hidden) closeEditor(); else if (!$('ask').hidden) closeAsk();
    } else if (ev.key === 'Enter' && ev.target.classList && ev.target.classList.contains('rcard')) {
      ev.target.click();
    }
  });

  // --- adding: the bottom bar, and what other modules and pointers ask ---------------------------------------------

  if (tavern.bar) {
    tavern.bar.set(canEdit ? [
      { id: 'add', type: 'quickadd', label: 'Add a note', placeholder: 'Write a note, or paste a link' },
      { id: 'photo', iconOnly: true, icon: 'camera', label: 'Add a photo' },
    ] : []).catch(() => {});
    tavern.on('bar', (e) => {
      if (!canEdit) return;
      if (e.id === 'photo') return choosePhotos();
      if (e.id !== 'add') return;
      const entry = readEntry(e.value);
      openEditor(null, entry || { kind: 'note' });
    });
  }
  // Something from another module dropped on the pane starts a note about it, with its title, linked to it (a personal note is not
  // linked: private items are not linked to or from).
  if (tavern.refs && tavern.refs.dropTarget) {
    const showDrop = (yes) => { $('app').classList.toggle('drop-target', yes); hide($('drop-hint'), !yes); };
    const foreign = (ref) => ref && ref.module && ref.module !== info.module.id;
    tavern.refs.dropTarget({
      over: (_point, ref) => showDrop(canEdit && foreign(ref)),
      leave: () => showDrop(false),
      drop: async (ref) => {
        showDrop(false);
        if (!canEdit || !foreign(ref)) return;
        try {
          const card = await tavern.refs.resolve(ref);
          const note = await research.save({ kind: 'note', title: geo.oneLine(card.title, 120) || 'Note', body: '', tags: [], date: '', by: me });
          if (view !== 'my') tavern.refs.setLinks(research.refOf('note', note.id), [ref]).catch(() => {});
          openEditor(note.id);
        } catch (err) { say('It could not start a note about that: ' + message(err), 4000); }
      },
    });
  }
  if (inRoom) stores.room.provide(me); // other modules' requests to save a note or a link go to the room's research
  if (tavern.refs && tavern.refs.onOpen) {
    tavern.refs.onOpen((ref) => {
      if (ref.module !== info.module.id || !KINDS.includes(ref.kind)) return;
      const show = async () => {
        const want = ref.scope === 'person' ? 'my' : 'room';
        if (want !== view && allowed[want]) await showView(want);
        openEditor(ref.id);
      };
      if (state.loaded) show(); else state.openWanted = show;
    });
  }

  // --- start --------------------------------------------------------------------------------------------------------

  async function showView(next) {
    if (!allowed[next]) next = inRoom ? 'room' : 'my';
    view = next;
    try { localStorage.setItem('research-view', view); } catch (err) { /* not remembered */ }
    for (const b of $('views').querySelectorAll('.view')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
    state.filter = ''; state.kind = ''; state.tags = [];
    $('filter').value = '';
    closeMenu();
    closeEditor();
    state.uploads = [];
    links.clear();
    askedLinks.clear();
    render();
    try { await ensureLoaded(view); if (view === next) { render(); loadLinks().catch(() => {}); } } catch (err) { say('This could not load: ' + message(err)); }
  }
  $('views').addEventListener('click', (ev) => { const b = ev.target.closest('.view'); if (b && !b.hidden) showView(b.dataset.view); });
  for (const b of $('views').querySelectorAll('.view')) hide(b, !allowed[b.dataset.view]);
  hide($('views'), [...$('views').querySelectorAll('.view')].filter((b) => !b.hidden).length < 2);
  try { const last = localStorage.getItem('research-view'); if (allowed[last]) view = last; } catch (err) { /* the default */ }
  for (const b of $('views').querySelectorAll('.view')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
  $('msg').hidden = true;
  $('app').hidden = false;
  render();
  try {
    await ensureLoaded(view);
    state.people = await tavern.people().catch(() => []);
    try { loadTagColors(await tavern.settings.get()); } catch (err) { loadTagColors(null); }
    tavern.settings.onChange((v) => { loadTagColors(v); if (state.loaded) render(); });
    await Promise.all([...new Set([...root.querySelectorAll('[data-icon]'), ...[...root.querySelectorAll('template')].flatMap((t) => [...t.content.querySelectorAll('[data-icon]')])].map((n) => n.dataset.icon).concat(Object.values(KIND_ICON), ['note', 'lightbulb', 'location-dot', 'calendar-days', 'link', 'star', 'bed', 'hotel', 'utensils', 'ticket', 'train', 'plane', 'car', 'ship', 'bus', 'camera', 'circle-info', 'mug-hot', 'landmark', 'mountain', 'umbrella-beach', 'sun', 'moon', 'bell', 'clock', 'wallet', 'triangle-exclamation', 'circle-check', 'heart', 'users', 'bag-shopping', 'music', 'map', 'suitcase', 'hourglass-half', 'flag', 'magnifying-glass', 'list-check', 'scale-balanced', 'coins']))].filter(Boolean).map(wantIcon));
    state.loaded = true;
    render();
    loadLinks().catch(() => {});
    checkAi();
    if (state.openWanted) { const f = state.openWanted; state.openWanted = null; f(); }
  } catch (err) {
    $('app').hidden = true;
    $('msg').hidden = false;
    $('msg').textContent = 'The research could not load: ' + message(err);
  }
})();
