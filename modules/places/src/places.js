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
  if (info.context.scope !== 'room') {
    $('msg').textContent = 'Places belong to a room. Open the room, then Places from its panes.';
    return;
  }

  const geo = tavern.util.geo;
  /*__LIB__*/

  const canEdit = tavern.can('edit');
  const apple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document;
  const CAT_ORDER = ['do', 'eat', 'stay', 'travel', 'other'];
  const CAT_LABEL = { do: 'Things to do', eat: 'Food', stay: 'Stay', travel: 'Travel', other: 'Other' };
  const CAT_ICON = { do: 'ticket', eat: 'utensils', stay: 'bed', travel: 'plane', other: 'note-sticky' };

  const places = createPlaces(tavern);
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
    editing: null, // { id | null, version, point: {lat, lng} | null, pointOk, conflict }
    menuFor: null,
    armed: null,
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
  const placeRef = (id) => tavern.refs.make('place', id);

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
    if (!tavern.refs || !tavern.refs.linksTo) return;
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
  places.subscribe(() => {
    if (state.loaded) render();
    checkConflict();
  });

  $('filter').addEventListener('input', () => { state.filter = $('filter').value; render(); });

  // --- the place menu -----------------------------------------------------------------------------------------------

  function openLinkFor(p) {
    if (p.point) return geo.mapsLink(p.point.lat, p.point.lng, p.title, apple);
    const q = encodeURIComponent(p.address || p.title);
    return apple ? `https://maps.apple.com/?q=${q}` : `geo:0,0?q=${q}`;
  }
  function openMenu(id, button) {
    const p = places.get(id);
    if (!p) return;
    const menu = $('item-menu');
    state.menuFor = id;
    fill(menu, { 'edit-label': canEdit ? 'Edit' : 'View' });
    menu.querySelector('[data-action="open-in-maps"]').href = openLinkFor(p);
    hide(menu.querySelector('[data-action="copy-coords"]'), !p.point);
    hide(menu.querySelector('[data-action="delete"]'), !canEdit);
    menu.querySelector('[data-action="delete"]').lastChild.textContent = ' Delete';
    state.armed = null;
    menu.hidden = false;
    hydrate(menu);
    // Under the button, inside the module's own box.
    const box = tavern.rootElement.getBoundingClientRect();
    const b = button.getBoundingClientRect();
    const left = Math.max(4, Math.min(b.right - box.left - menu.offsetWidth, box.width - menu.offsetWidth - 4));
    menu.style.top = `${Math.max(4, b.bottom - box.top + 4)}px`;
    menu.style.left = `${left}px`;
  }
  const closeMenu = () => { hide($('item-menu'), true); state.menuFor = null; };

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
    state.editing = { id: id || null, version: p ? places.versionOf(id) : undefined, point: p ? p.point : (seed && seed.point) || null, pointOk: true, conflict: null };
    dropConflict();
    for (const n of $('form').querySelectorAll('.readonly')) n.remove();
    const view = p || { title: (seed && seed.title) || '', category: 'other', address: '', point: (seed && seed.point) || null, notes: '', owners: [], by: '', ref: null };
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
    const menu = $('item-menu');
    if (!menu.hidden && !ev.target.closest('#item-menu') && !ev.target.closest('[data-action="menu"]')) closeMenu();
    const t = ev.target.closest('[data-action]');
    const rowEl = ev.target.closest('.place-row');
    if (t && t.dataset.action === 'menu' && rowEl) {
      ev.stopPropagation();
      if (!menu.hidden && state.menuFor === rowEl.dataset.id) return closeMenu();
      return openMenu(rowEl.dataset.id, t);
    }
    if (t && menu.contains(t)) {
      const id = state.menuFor;
      const p = id && places.get(id);
      const a = t.dataset.action;
      if (!p) return closeMenu();
      if (a === 'edit') { closeMenu(); openEditor(id); }
      else if (a === 'open-in-maps') closeMenu();
      else if (a === 'copy-coords' && p.point) {
        closeMenu();
        try { await navigator.clipboard.writeText(geo.coordsText(p.point.lat, p.point.lng)); say('Coordinates copied.'); setTimeout(() => say(''), 2000); } catch (err) { say('Copy them from the place: ' + geo.coordsText(p.point.lat, p.point.lng)); }
      } else if (a === 'delete' && canEdit) {
        if (state.armed !== 'menu') { state.armed = 'menu'; t.lastChild.textContent = ' Delete it?'; return; }
        state.armed = null;
        closeMenu();
        try { await places.remove(id); } catch (err) { say('It could not be deleted: ' + ((err && err.message) || err)); }
      }
      return;
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
  root.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      if (!$('item-menu').hidden) closeMenu(); else if (!$('editor').hidden) closeEditor();
    } else if (ev.key === 'Enter' && ev.target.classList && ev.target.classList.contains('place-row')) {
      ev.target.click();
    }
  });

  // --- adding: the bottom bar, and what other modules and pointers ask ----------------------------------------------

  // What was typed: a name, with coordinates or a map link anywhere in it setting the position.
  function readQuickAdd(text) {
    const t = String(text || '').trim();
    const whole = geo.parsePoint(t);
    if (whole) return { title: '', point: whole };
    const link = t.match(/(?:https?:\/\/|geo:)\S+/i);
    if (link) {
      const pt = geo.parsePoint(link[0]);
      if (pt) return { title: geo.oneLine(t.replace(link[0], ' '), 120), point: pt };
    }
    const tail = t.match(/(-?\d{1,3}\.\d+)[,;\s]+(-?\d{1,3}\.\d+)\s*$/);
    if (tail) {
      const pt = geo.parsePoint(`${tail[1]}, ${tail[2]}`);
      if (pt) return { title: geo.oneLine(t.slice(0, tail.index), 120), point: pt };
    }
    return { title: geo.oneLine(t, 120), point: null };
  }
  if (tavern.bar) {
    tavern.bar.set(canEdit ? [{ id: 'add', type: 'quickadd', label: 'Add a place', placeholder: 'Add a place: name, or paste coordinates or a map link' }] : []).catch(() => {});
    tavern.on('bar', (e) => {
      if (e.id !== 'add' || !canEdit) return;
      if (!e.value) return openEditor(null);
      openEditor(null, readQuickAdd(e.value));
    });
  }

  places.provide(info.user.key);
  if (tavern.refs && tavern.refs.onOpen) {
    tavern.refs.onOpen((ref) => {
      if (ref.module !== info.module.id || ref.kind !== 'place') return;
      const show = () => openEditor(ref.id);
      if (state.loaded) show(); else state.openWanted = show;
    });
  }

  // --- start --------------------------------------------------------------------------------------------------------

  $('msg').hidden = true;
  $('app').hidden = false;
  render();
  try {
    await places.load();
    state.people = await tavern.people().catch(() => []);
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
