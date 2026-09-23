// The Places module's page: the room's saved places, listed by category, each with an address, an optional position, notes and
// owners. The places live in the module's store (see places-lib.js) and, with a position, give their card a `place` that a map
// module draws. This page draws into the markup in places.html by cloning its templates and filling their [data-slot] and
// [data-icon] hooks, and toggles the state classes and data attributes CONTRACT.md lists. It builds no markup from strings
// and sets no style (the item menu is placed under the button that opened it). Nothing here names another module.
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
    $('msg').textContent = 'Places could not start: ' + err.message;
    return;
  }
  // In a room (a pane) or on the module's own page: a room has its own list; the page has only mine and everyone's.
  const inRoom = info.context.scope === 'room';
  if (!inRoom && info.context.scope !== 'server') {
    $('msg').textContent = 'Places could not open here.';
    return;
  }

  const geo = tavern.util.geo;
  /*__LIB__*/

  const canEdit = tavern.can('edit');
  const personal = Boolean(info.user && info.user.key !== 'guest'); // a guest has no profile, so no personal places
  const apple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document;
  const CAT_ORDER = ['do', 'eat', 'stay', 'travel', 'other'];
  const CAT_LABEL = { do: 'Things to do', eat: 'Food', stay: 'Stay', travel: 'Travel', other: 'Other' };
  const CAT_ICON = { do: 'ticket', eat: 'utensils', stay: 'bed', travel: 'plane', other: 'note-sticky' };

  // Two stores of the same kind of thing: this room's, and the person's own (private, in their profile, the same in every room).
  // `places` is whichever the person is looking at.
  const stores = { room: createPlaces(tavern, { scope: 'room' }), my: createPlaces(tavern, { scope: 'person' }), global: createPlaces(tavern, { scope: 'server' }) };
  const loadedStores = new Set();
  const ensureLoaded = (v) => { if (loadedStores.has(v)) return Promise.resolve(); loadedStores.add(v); return stores[v].load().catch((err) => { loadedStores.delete(v); throw err; }); };
  let view = inRoom ? 'room' : 'my';
  const places = new Proxy({}, { get: (_, key) => stores[view][key] });
  // A module that can show a place on a map, if one is installed: found by what it offers, never by name.
  let showAction = null;
  async function findShowAction() {
    try {
      const list = await tavern.actions.list({ accepts: 'places:place' });
      showAction = list.find((a) => a.name === 'showOnMap') || null;
    } catch (err) {
      showAction = null;
    }
  }
  const state = {
    people: [],
    filter: '',
    cat: '',
    loaded: false,
    links: new Map(), // place id -> cards of what other modules point at it
    editing: null, // { id | null, version, point: {lat, lng} | null, pointOk, conflict, origin (the search result it came from) }
    menuFor: null,
    armed: null,
    search: false, // whether a place search is set up
    searchCredit: '', // what to say about it under the results
  };
  const nameOf = (key) => (state.people.find((p) => p.key === key) || {}).name || '';
  const initial = (key) => (nameOf(key)[0] || '?').toUpperCase();

  // --- small helpers ------------------------------------------------------------------------------------------------

  const clone = (id) => $(id).content.firstElementChild.cloneNode(true);
  const hide = (node, yes) => { if (node) node.hidden = Boolean(yes); };
  const slot = (el, name) => (el.dataset.slot === name ? el : el.querySelector(`[data-slot="${name}"]`));
  // Set a slot's text, or hide the slot when there is nothing to show.
  function fill(el, values) {
    for (const [name, value] of Object.entries(values)) {
      const s = slot(el, name);
      if (!s) continue;
      s.textContent = value == null ? '' : String(value);
      s.hidden = value === '' || value == null;
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
  const say = (text) => { const n = $('note'); n.textContent = text || ''; n.hidden = !text; };
  const placeRef = (id) => tavern.refs.make('place', id, view === 'my' ? { scope: 'person' } : view === 'global' ? { scope: 'server' } : undefined);

  // The pane's width, not the window's: a bundled module runs in the page, so a media query would follow the window.
  const fit = () => {
    const w = tavern.rootElement.clientWidth;
    if (w) $('app').classList.toggle('narrow', w < 720);
  };
  fit();
  new ResizeObserver(fit).observe(tavern.rootElement);

  // --- the list -----------------------------------------------------------------------------------------------------

  const matches = (p, q) => !q || [p.title, p.address, p.notes].some((t) => t.toLowerCase().includes(q));
  const visible = () => {
    const q = state.filter.trim().toLowerCase();
    return places.list().filter((p) => matches(p, q));
  };

  // What other modules point at each place (asked once per place; the 'links' event clears it).
  const asked = new Set();
  async function loadLinks() {
    if (view === 'my' || !tavern.refs || !tavern.refs.linksTo) return; // personal places are not linked
    let changed = false;
    for (const p of places.list().slice(0, 100)) {
      if (asked.has(p.id)) continue;
      asked.add(p.id);
      try {
        const cards = await tavern.refs.linksTo(placeRef(p.id));
        if (cards.length) { state.links.set(p.id, cards); changed = true; }
      } catch (err) { /* nothing points at it */ }
    }
    if (changed) render();
  }
  if (tavern.on) tavern.on('links', () => { asked.clear(); state.links.clear(); loadLinks().catch(() => {}); });

  const linkPill = (card) => {
    const el = clone('tpl-link');
    setIcon(el.querySelector('[data-icon]'), (card.module && card.module.icon) || 'link');
    fill(el, { kind: card.kindName || card.kind || '', title: card.title || '' });
    return el;
  };

  function row(p) {
    const el = clone('tpl-place');
    el.dataset.id = p.id;
    el.dataset.cat = p.category;
    setIcon(el.querySelector('.mark [data-icon]'), CAT_ICON[p.category]);
    fill(el, { title: p.title, address: p.address });
    hide(slot(el, 'pinned'), !p.point);
    hide(slot(el, 'nopos'), Boolean(p.point));
    const owners = slot(el, 'owners');
    owners.replaceChildren(...p.owners.map((k) => { const o = clone('tpl-owner'); o.textContent = initial(k); o.title = nameOf(k); return o; }));
    owners.hidden = !owners.children.length;
    const links = slot(el, 'links');
    links.replaceChildren(...(state.links.get(p.id) || []).slice(0, 4).map(linkPill));
    links.hidden = !links.children.length;
    return el;
  }

  function render() {
    const all = places.list();
    const empty = state.loaded && !all.length;
    hide($('app').querySelector('.head'), empty);
    hide($('chips'), empty || !state.loaded);
    fill($('app').querySelector('.head'), { count: all.length ? String(all.length) : '' });
    const body = $('body');
    if (!state.loaded) { body.replaceChildren(clone('tpl-state-loading')); return; }
    if (empty) {
      body.replaceChildren(clone('tpl-state-empty'));
      hide(body.querySelector('[data-action="add-place"]'), !canEdit);
      hydrate(root);
      return;
    }
    // The chips: All, then a chip per category with places, each with its count.
    const counts = Object.fromEntries(CAT_ORDER.map((c) => [c, all.filter((p) => p.category === c).length]));
    const chips = [];
    const chip = (key, icon, label, count) => {
      const c = clone('tpl-chip');
      c.dataset.cat = key;
      setIcon(c.querySelector('[data-icon]'), icon);
      fill(c, { label, count: String(count) });
      c.classList.toggle('on', state.cat === key);
      chips.push(c);
    };
    chip('', 'layer-group', 'All', all.length);
    for (const c of CAT_ORDER) if (counts[c]) chip(c, CAT_ICON[c], CAT_LABEL[c], counts[c]);
    $('chips').replaceChildren(...chips);
    // The groups.
    const shown = visible().filter((p) => !state.cat || p.category === state.cat);
    if (!shown.length) {
      body.replaceChildren(clone('tpl-state-noresults'));
      hydrate(root);
      return;
    }
    const groups = [];
    for (const c of CAT_ORDER) {
      const inCat = shown.filter((p) => p.category === c);
      if (!inCat.length) continue;
      const g = clone('tpl-group');
      setIcon(g.querySelector('[data-icon]'), CAT_ICON[c]);
      fill(g, { title: CAT_LABEL[c] });
      g.querySelector('.rows').replaceChildren(...inCat.map(row));
      groups.push(g);
    }
    body.replaceChildren(...groups);
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

  // --- the place menu -----------------------------------------------------------------------------------------------

  function openLinkFor(p) {
    if (p.point) return geo.mapsLink(p.point.lat, p.point.lng, p.title, apple);
    return geo.mapsSearch(p.address || p.title, apple);
  }
  // Delete armed by id, cleared a few seconds after arming so a stray later click cannot delete unarmed.
  const armedDelete = new Set();
  function openMenu(id, button) {
    const p = places.get(id);
    if (!p) return;
    const canShare = canEdit && personal && inRoom && (view === 'my' || view === 'room'); // copy between mine and this room: the original stays where it is
    const items = [
      { id: 'edit', label: canEdit ? 'Edit' : 'View', icon: 'pen', onClick: () => openEditor(id) },
    ];
    if (canShare) {
      items.push({
        id: 'share',
        label: view === 'my' ? 'Share to this room' : 'Save to mine',
        icon: 'share-nodes',
        onClick: async () => {
          const target = view === 'my' ? stores.room : stores.my;
          try {
            await target.save({ ...p, id: '', ref: null, by: info.user.key, owners: [info.user.key] });
            say(view === 'my' ? 'Shared to this room.' : 'Saved to your places.');
            setTimeout(() => say(''), 2500);
          } catch (err) { say('It could not be copied: ' + ((err && err.message) || err)); }
        },
      });
    }
    items.push({ id: 'open-in-maps', label: 'Open in my maps app', icon: 'arrow-up-right-from-square', href: openLinkFor(p) });
    if (p.point) {
      items.push({
        id: 'copy-coords',
        label: 'Copy coordinates',
        icon: 'copy',
        onClick: async () => {
          try { await navigator.clipboard.writeText(geo.coordsText(p.point.lat, p.point.lng)); say('Coordinates copied.'); setTimeout(() => say(''), 2000); } catch (err) { say('Copy them from the place: ' + geo.coordsText(p.point.lat, p.point.lng)); }
        },
      });
    }
    if (canEdit) {
      items.push({
        id: 'delete',
        label: 'Delete',
        icon: 'trash',
        danger: true,
        onClick: (item, b) => {
          if (!armedDelete.has(id)) {
            armedDelete.add(id);
            const label = b.querySelector('.tv-menu-label');
            if (label) label.textContent = 'Delete it?';
            setTimeout(() => armedDelete.delete(id), 4000);
            return false;
          }
          armedDelete.delete(id);
          places.remove(id).catch((err) => say('It could not be deleted: ' + ((err && err.message) || err)));
        },
      });
    }
    tavern.menu.show({ id: `place-${id}`, anchor: button, items });
  }

  // --- the dialog for one place -------------------------------------------------------------------------------------

  const FIELD_WRAPPERS = () => [...$('form').children].filter((n) => !['editor-title', 'f-links-out', 'f-used-by', 'f-by', 'f-error'].includes(n.id) && !n.classList.contains('editor-buttons') && !n.classList.contains('readonly') && !n.classList.contains('conflict-bar'));

  function fillOwners(selected) {
    const box = $('f-owners');
    box.replaceChildren(...state.people.map((person) => {
      const label = document.createElement('label');
      label.className = 'check';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = person.key;
      input.checked = selected.includes(person.key);
      label.append(input, document.createTextNode(' ' + person.name));
      return label;
    }));
  }
  const ownersChosen = () => [...$('f-owners').querySelectorAll('input:checked')].map((i) => i.value);

  // The position field: a pair of coordinates or a map link. Empty means no position.
  function readPoint() {
    const text = $('f-point').value.trim();
    const e = state.editing;
    if (!text) { e.point = null; e.pointOk = true; $('f-point-note').textContent = ''; return; }
    const pt = geo.parsePoint(text);
    e.point = pt;
    e.pointOk = Boolean(pt);
    $('f-point-note').textContent = pt ? 'Coordinates found.' : 'No coordinates in that.';
  }
  $('f-point').addEventListener('input', readPoint);

  const editorError = (text) => { $('f-error').textContent = text; $('f-error').hidden = !text; };
  const dropConflict = () => { for (const n of $('form').querySelectorAll('.conflict-bar')) n.remove(); if (state.editing) state.editing.conflict = null; };

  // Show a place in the dialog: a new one (`id` null, `seed` its start), or an existing one.
  function openEditor(id, seed) {
    const p = id ? places.get(id) : null;
    if (id && !p) return;
    state.editing = { id: id || null, version: p ? places.versionOf(id) : undefined, point: p ? p.point : (seed && seed.point) || null, pointOk: true, conflict: null, origin: (seed && seed.origin) || '' };
    dropConflict();
    for (const n of $('form').querySelectorAll('.readonly')) n.remove();
    const view = p || { title: (seed && seed.title) || '', category: 'other', address: (seed && seed.address) || '', point: (seed && seed.point) || null, notes: (seed && seed.notes) || '', owners: [], by: '', ref: null };
    const editable = canEdit;
    $('editor-title').textContent = id ? (editable ? 'Change this place' : view.title) : 'Add a place';
    for (const w of FIELD_WRAPPERS()) w.hidden = !editable;
    if (editable) {
      $('f-title').value = view.title;
      $('f-category').value = view.category;
      $('f-address').value = view.address;
      $('f-point').value = view.point ? geo.coordsText(view.point.lat, view.point.lng) : '';
      $('f-point-note').textContent = '';
      $('f-notes').value = view.notes;
      fillOwners(id ? view.owners : [info.user.key]);
    } else {
      const ro = clone('tpl-readonly');
      fill(ro, { category: CAT_LABEL[view.category], address: view.address || 'None', point: view.point ? geo.coordsText(view.point.lat, view.point.lng) : 'None yet', owners: view.owners.map(nameOf).filter(Boolean).join(', ') || 'Nobody in particular', notes: view.notes });
      $('editor-title').after(ro);
    }
    // Where it is, and what uses it.
    hide($('f-links-out'), !id);
    if (id) $('f-open-in-maps').href = openLinkFor(view);
    const used = state.links.get(id) || [];
    hide($('f-used-by'), !used.length);
    $('f-used-by-links').replaceChildren(...used.map(linkPill));
    $('f-by').textContent = view.by ? `Last changed by ${nameOf(view.by) || 'someone'}` : '';
    editorError('');
    hide($('f-save'), !editable);
    hide($('f-delete'), !id || !editable);
    $('f-delete').textContent = 'Delete';
    $('f-cancel').textContent = editable ? 'Close' : 'Close';
    state.armed = null;
    hide($('editor'), false);
    hydrate($('editor'));
    if (editable) $('f-title').focus();
  }
  function closeEditor() {
    hide($('editor'), true);
    state.editing = null;
  }

  // Someone else changed the place that is open: say so, and offer their version or keeping mine.
  function checkConflict() {
    const e = state.editing;
    if (!e || !e.id || !canEdit || e.conflict) return;
    const now = places.versionOf(e.id);
    if (!places.get(e.id)) { closeEditor(); return; }
    if (now === e.version) return;
    showConflict(places.get(e.id), now);
  }
  function showConflict(theirs, version) {
    const e = state.editing;
    if (!e) return;
    dropConflict();
    e.conflict = { theirs, version };
    const bar = clone('tpl-conflict');
    fill(bar, { text: 'Someone changed this place while you were editing.' });
    $('form').querySelector('.editor-buttons').before(bar);
    editorError('');
  }
  $('form').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-action]');
    const e = state.editing;
    if (!b || !e || !e.conflict) return;
    if (b.dataset.action === 'use-theirs') {
      const id = e.id;
      dropConflict();
      openEditor(id);
    } else if (b.dataset.action === 'keep-mine') {
      e.version = e.conflict.version;
      dropConflict();
    }
  });

  $('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const e = state.editing;
    if (!e || !canEdit) return;
    const title = geo.oneLine($('f-title').value, 120);
    if (!title) return editorError('Give the place a name.');
    readPoint();
    if (!e.pointOk) return editorError('The position is not coordinates or a map link. Leave it empty, or paste one.');
    if (e.conflict) return editorError('Choose Use theirs or Keep mine first.');
    const base = e.id ? places.get(e.id) : null;
    const place = {
      id: e.id || '',
      title,
      category: CAT_ORDER.includes($('f-category').value) ? $('f-category').value : 'other',
      address: geo.oneLine($('f-address').value, 200),
      point: e.point,
      notes: $('f-notes').value,
      owners: ownersChosen(),
      by: info.user.key,
      ref: base ? base.ref : null,
    };
    $('f-save').disabled = true;
    try {
      await places.save(place, e.id ? e.version : undefined);
      if (e.origin) markUsed(e.origin);
      closeEditor();
    } catch (err) {
      if (err && err.status === 409) {
        const cur = e.id ? places.get(e.id) : null;
        if (cur) showConflict(cur, places.versionOf(e.id));
        else editorError('That place was removed by someone else.');
      } else editorError('It could not be saved: ' + ((err && err.message) || err));
    } finally {
      $('f-save').disabled = false;
    }
  });
  $('f-cancel').addEventListener('click', closeEditor);
  $('f-delete').addEventListener('click', async () => {
    const e = state.editing;
    if (!e || !e.id) return;
    if (state.armed !== 'editor') { state.armed = 'editor'; $('f-delete').textContent = 'Delete it?'; return; }
    state.armed = null;
    try { await places.remove(e.id); closeEditor(); } catch (err) { editorError('It could not be deleted: ' + ((err && err.message) || err)); }
  });
  $('editor').addEventListener('pointerdown', (ev) => { if (ev.target === $('editor')) closeEditor(); });

  // --- clicks on the page -------------------------------------------------------------------------------------------

  root.addEventListener('click', async (ev) => {
    const t = ev.target.closest('[data-action]');
    const rowEl = ev.target.closest('.place-row');
    if (t && t.dataset.action === 'menu' && rowEl) {
      ev.stopPropagation();
      return openMenu(rowEl.dataset.id, t);
    }
    if (t && t.dataset.action === 'add-place') return openEditor(null);
    if (t && t.dataset.action === 'clear-filter') { state.filter = ''; state.cat = ''; $('filter').value = ''; return render(); }
    const chip = ev.target.closest('.chip');
    if (chip) { state.cat = chip.dataset.cat === state.cat ? '' : chip.dataset.cat; return render(); }
    if (rowEl && !ev.target.closest('.item-menu')) {
      // A click on a place with a position shows it on the map when something offers that; otherwise it opens the place.
      const p = places.get(rowEl.dataset.id);
      if (p && p.point && showAction) return void tavern.actions.request(showAction.action, { ref: placeRef(p.id) }).catch(() => openEditor(p.id));
      openEditor(rowEl.dataset.id);
    }
  });
  // A place can be dragged out to another module (onto a day of a plan, or a task that links to it): press its row and move.
  // The pointer is the place's in the view it is shown in. A click after the drag is swallowed by the SDK.
  if (tavern.refs && tavern.refs.draggable) {
    tavern.refs.draggable(root, (target) => {
      const row = target.closest && target.closest('.place-row');
      if (!row || !row.dataset.id || target.closest('.item-menu, button, a')) return null;
      const p = places.get(row.dataset.id);
      return p ? { kind: 'place', id: p.id, label: p.title, ...(view === 'my' ? { scope: 'person' } : view === 'global' ? { scope: 'server' } : {}) } : null;
    });
  }
  root.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      if (!$('editor').hidden) closeEditor(); else if (!$('found').hidden) closeFound();
    } else if (ev.key === 'Enter' && ev.target.classList && ev.target.classList.contains('place-row')) {
      ev.target.click();
    }
  });

  // --- adding: the bottom bar, and what other modules and pointers ask ----------------------------------------------

  // --- find a place (only when the admin set a search address) -----------------------------------------------------

  let searchToken = 0;
  let hits = [];
  // Ask the server to search for places by name: [{ key, title, sub, lat, lng, from }], or an Error. The server looks in the
  // places it has saved first and asks the outside service only for what is missing.
  async function searchFor(q, near) {
    if (!state.search) throw new Error('search is not configured');
    const out = await tavern.geocode.search(q, near || null);
    if (out.credit) state.searchCredit = out.credit;
    return (out.results || []).slice(0, 6);
  }
  const closeFound = () => { searchToken += 1; hits = []; hide($('found'), true); $('found').replaceChildren(); };
  function foundHead(label, query, closable) {
    const h = clone('tpl-found-head');
    fill(h, { label, query: '\u201c' + query + '\u201d' });
    hide(h.querySelector('.found-close'), !closable);
    return h;
  }
  async function find(query) {
    const mine = ++searchToken;
    const box = $('found');
    box.replaceChildren(foundHead('Searching for', query, false), clone('tpl-found-searching'));
    hide(box, false);
    let found;
    try {
      found = await searchFor(query);
    } catch (err) {
      if (mine !== searchToken) return;
      const st = clone('tpl-found-state');
      fill(st, { text: 'Search is not available right now.' });
      box.replaceChildren(foundHead('Results for', query, true), st);
      return;
    }
    if (mine !== searchToken) return;
    hits = found;
    if (!found.length) {
      const st = clone('tpl-found-state');
      fill(st, { text: 'Nothing found. Try a fuller name, or paste coordinates or a map link.' });
      box.replaceChildren(foundHead('Results for', query, true), st);
      return;
    }
    const rows = document.createElement('div');
    rows.className = 'found-rows';
    found.forEach((h, i) => {
      const r = clone('tpl-found-row');
      r.dataset.i = String(i);
      fill(r, { title: h.title, address: h.sub, source: h.from || '' });
      hide(r.querySelector('[data-action="save-found"]'), !canEdit);
      rows.append(r);
    });
    const parts = [foundHead('Results for', query, true), rows];
    if (state.searchCredit) { const c = document.createElement('p'); c.className = 'found-credit'; c.textContent = state.searchCredit; parts.push(c); }
    box.replaceChildren(...parts);
    hydrate(box);
  }
  // A picked result is marked used on the server, which keeps it from being purged. Nothing depends on it, so a failure is ignored.
  const markUsed = (key) => { if (key && tavern.geocode) tavern.geocode.used(key).catch(() => {}); };
  // A result saved as a place: its name, address and position (the category is left for the person to set).
  async function saveFound(i) {
    const h = hits[i];
    if (!h || !canEdit) return;
    try {
      await places.save({ id: '', title: h.title, category: 'other', address: h.sub, point: { lat: h.lat, lng: h.lng }, notes: '', owners: [info.user.key], by: info.user.key, ref: null });
      markUsed(h.key);
      closeFound();
    } catch (err) {
      say('It could not be saved: ' + ((err && err.message) || err));
    }
  }
  $('found').addEventListener('click', (ev) => {
    const row = ev.target.closest('.found-row');
    if (ev.target.closest('[data-action="close-found"]')) return closeFound();
    if (row) saveFound(Number(row.dataset.i));
  });
  $('found').addEventListener('keydown', (ev) => {
    const row = ev.target.closest && ev.target.closest('.found-row');
    if (!row) return;
    if (ev.key === 'Enter') { ev.preventDefault(); saveFound(Number(row.dataset.i)); }
    else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const next = ev.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
      if (next) next.focus();
    }
  });

  if (tavern.bar) {
    tavern.bar.set(canEdit ? [{ id: 'add', type: 'quickadd', label: 'Add a place', placeholder: 'Add a place: name, or paste coordinates or a map link' }] : []).catch(() => {});
    tavern.on('bar', (e) => {
      if (e.id !== 'add' || !canEdit) return;
      if (!e.value) return openEditor(null);
      const entry = readEntry(e.value);
      // A name, with a search address set, looks for the place; anything with coordinates or a link (or no search) opens the dialog.
      if (entry.find && state.search) return void find(entry.title);
      closeFound();
      openEditor(null, entry);
    });
  }

  // What other modules may ask of this page, for the person who asked (a view, so only their own page does it): look for a
  // place by name, and open the dialog for a new one where a map was clicked.
  if (tavern.actions && tavern.actions.provide) {
    tavern.actions.provide({
      searchPlaces: async (input) => {
        const q = geo.oneLine(input && input.q, 200);
        if (q.length < 2) throw new Error('nothing to look for');
        return { data: { results: await searchFor(q, input && input.lat !== undefined ? { lat: input.lat, lon: input.lon } : null) } };
      },
      newPlace: async (input) => {
        if (!canEdit) throw new Error('you may not add places here');
        const i = input || {};
        const has = (x) => x !== undefined && x !== null && x !== '';
        const point = has(i.lat) && has(i.lng) && geo.inRange(Number(i.lat), Number(i.lng)) ? { lat: geo.round6(Number(i.lat)), lng: geo.round6(Number(i.lng)) } : null;
        closeFound();
        openEditor(null, { title: geo.oneLine(i.title, 120), point, address: geo.oneLine(i.address, 200), notes: String(i.notes || '').slice(0, 1000), origin: geo.oneLine(i.origin, 60) });
        return {};
      },
    });
  }

  if (inRoom) stores.room.provide(info.user.key); // other modules' requests to add a place go to the room's list
  if (tavern.refs && tavern.refs.onOpen) {
    tavern.refs.onOpen((ref) => {
      if (ref.module !== info.module.id || ref.kind !== 'place') return;
      const show = () => openEditor(ref.id);
      if (state.loaded) show(); else state.openWanted = show;
    });
  }

  // --- start --------------------------------------------------------------------------------------------------------

  // Whose places: the person's own need a signed-in person (a guest has no profile), and so does everyone's (a server-wide store).
  const VIEW_NOTES = { my: 'Only you see these. They follow you into every room.', global: 'Everyone on this server sees these, and anyone who can edit can change them.' };
  const allowed = { my: personal, room: inRoom, global: personal };
  const VIEW_OPTIONS = [
    { id: 'my', label: 'Mine', icon: 'user' },
    { id: 'room', label: 'This room', icon: 'users' },
    { id: 'global', label: 'Everyone', icon: 'globe' },
  ].filter((o) => allowed[o.id]);
  const viewSwitch = VIEW_OPTIONS.length > 1 ? tavern.ui.viewSwitch({ id: 'whose', options: VIEW_OPTIONS, value: view, onChange: showView }) : null;
  function showView(next) {
    if (!allowed[next]) next = inRoom ? 'room' : 'my';
    view = next;
    try { localStorage.setItem('places-view', view); } catch (err) { /* not remembered */ }
    viewSwitch?.set(view);
    const note = root.querySelector('[data-slot="view-note"]');
    fill(note, { text: VIEW_NOTES[view] || '' });
    hide(note, !VIEW_NOTES[view]);
    state.links = new Map();
    asked.clear();
    tavern.menu.close();
    closeFound();
    closeEditor();
    render();
    ensureLoaded(view).then(() => { if (view === next) { render(); loadLinks().catch(() => {}); } }).catch((err) => say('These places could not load: ' + err.message));
  }
  try { const last = localStorage.getItem('places-view'); if (allowed[last] && (last !== 'room' || inRoom)) view = last; } catch (err) { /* the default */ }
  if (view !== 'room' || !inRoom) {
    viewSwitch?.set(view);
    fill(root.querySelector('[data-slot="view-note"]'), { text: VIEW_NOTES[view] || '' });
    hide(root.querySelector('[data-slot="view-note"]'), !VIEW_NOTES[view]);
  }
  $('msg').hidden = true;
  $('app').hidden = false;
  render();
  try {
    await ensureLoaded(view);
    state.people = await tavern.people().catch(() => []);
    const useSearch = (v) => { state.search = searchOn(v); state.searchCredit = ''; if (!state.search) closeFound(); };
    try { useSearch(await tavern.settings.get()); } catch (err) { useSearch(null); }
    tavern.settings.onChange((v) => useSearch(v));
    await Promise.all([...new Set([...root.querySelectorAll('[data-icon]'), ...[...root.querySelectorAll('template')].flatMap((t) => [...t.content.querySelectorAll('[data-icon]')])].map((n) => n.dataset.icon).concat(Object.values(CAT_ICON), ['layer-group', 'link']))].filter(Boolean).map(wantIcon));
    findShowAction();
    state.loaded = true;
    render();
    loadLinks().catch(() => {});
    if (state.openWanted) { const f = state.openWanted; state.openWanted = null; f(); }
  } catch (err) {
    $('app').hidden = true;
    $('msg').hidden = false;
    $('msg').textContent = 'The places could not load: ' + err.message;
  }
})();
