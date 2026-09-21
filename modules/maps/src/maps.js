// The Maps module's page: a map of the places a room cares about, from the admin's map file. Places added here live in the
// module's store (`place:<id>`, see maps-lib-c-geo.js); places other modules' items carry come in through the cards
// conduit (a card's `place`), drawn with that module's own icon. This page draws into the markup in maps.html by cloning its
// templates and filling their [data-slot] and [data-icon] hooks, and toggles the state classes and data attributes CONTRACT.md
// lists. It builds no markup from strings and sets no style (the map library positions the pins). Nothing here names another
// module, and no request leaves the server unless the admin set a search address.
(async () => {
  'use strict';

  // This module runs in the page (its SDK is handed to its script; a frame cannot read a map file or start the map's worker).
  const tavern = (document.currentScript && document.currentScript.tavern) || window.tavern;
  const root = tavern.root;
  const $ = (id) => root.getElementById(id);

  let info;
  try {
    info = await tavern.ready();
  } catch (err) {
    $('msg').textContent = 'Maps could not start: ' + err.message;
    return;
  }
  if (info.context.scope !== 'room') {
    $('msg').textContent = 'A map belongs to a room. Open the room, then Maps from its panes.';
    return;
  }

  /*__LIB__*/

  const canEdit = tavern.can('edit');
  const isAdmin = info.user && info.user.role === 'admin';
  const maplibregl = window.maplibregl;
  const narrow = window.matchMedia('(max-width: 719px)');
  const apple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document;

  const state = {
    places: new Map(), // id -> { place, version }
    items: [], // cards of other modules' items that carry a place
    people: [],
    settings: { map: '', search: '' },
    selected: null, // { kind: 'place' | 'item', id }
    panelOpen: !window.matchMedia('(max-width: 719px)').matches, // a sheet starts as a peek on a phone
    adding: false,
    draft: null, // { lat, lng }: where a new place would go
    editing: null, // { id | null, version, ref }
    map: null,
    mapReady: false,
    armed: null,
    linked: new Map(), // place id -> card of the item it points at
  };
  const nameOf = (key) => (state.people.find((p) => p.key === key) || {}).name || '';

  // --- small helpers ------------------------------------------------------------------------------------------------

  const clone = (id) => $(id).content.firstElementChild.cloneNode(true);
  const parts = (id) => [...$(id).content.children].map((n) => n.cloneNode(true));
  const hide = (node, yes) => { if (node) node.hidden = Boolean(yes); };
  const slot = (el, name) => (el.dataset.slot === name ? el : el.querySelector(`[data-slot="${name}"]`));
  function fill(el, values) {
    for (const [name, value] of Object.entries(values)) {
      const s = slot(el, name);
      if (s) { s.textContent = value == null ? '' : String(value); if (value === '' || value == null) s.hidden = true; else s.hidden = false; }
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
  const whenText = (w) => {
    if (w == null || w === '') return '';
    const d = typeof w === 'number' ? new Date(w) : /^\d{4}-\d{2}-\d{2}/.test(String(w)) ? new Date(String(w).length === 10 ? String(w) + 'T00:00:00' : String(w)) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) : String(w).slice(0, 40);
  };
  const placeRef = (id) => tavern.refs.make('place', id);
  const newId = () => (tavern.util.id ? tavern.util.id() : Math.random().toString(36).slice(2, 10));

  // --- the places ---------------------------------------------------------------------------------------------------

  const own = () => [...state.places.values()].map((x) => x.place).sort((a, b) => a.title.localeCompare(b.title));
  // The other modules' items that carry a place and that no place here already points at.
  const shownItems = () => {
    const pointed = new Set(own().filter((p) => p.ref).map((p) => tavern.util.refKey(p.ref)));
    return state.items.filter((c) => !c.ref || !pointed.has(tavern.util.refKey(c.ref)));
  };
  const itemId = (c) => tavern.util.refKey(c.ref);
  const findSelected = () => {
    const s = state.selected;
    if (!s) return null;
    if (s.kind === 'place') { const x = state.places.get(s.id); return x ? { kind: 'place', place: x.place } : null; }
    const card = shownItems().find((c) => itemId(c) === s.id);
    return card ? { kind: 'item', card } : null;
  };
  const cardPlace = (c) => ({ id: itemId(c), title: c.title, point: { lat: c.place.lat, lng: c.place.lng, name: c.place.name || c.title } });

  async function loadPlaces() {
    state.places.clear();
    for (const it of await tavern.storage.list(PLACE_PREFIX)) {
      const p = cleanPlace(it.key.slice(PLACE_PREFIX.length), it.value);
      if (p) state.places.set(p.id, { place: p, version: it.version });
    }
  }
  async function loadItems() {
    if (!tavern.refs || !tavern.refs.search) return;
    try {
      const found = await tavern.refs.search('');
      state.items = found.filter((c) => c && c.ref && c.place && Number.isFinite(c.place.lat) && Number.isFinite(c.place.lng) && c.title);
    } catch (err) {
      state.items = [];
    }
  }
  async function loadLinked() {
    const want = own().filter((p) => p.ref && !state.linked.has(p.id));
    if (!want.length) return;
    let got;
    try { got = await tavern.refs.resolve(want.map((p) => p.ref)); } catch (err) { got = want.map(() => ({ error: 'unavailable' })); }
    want.forEach((p, i) => state.linked.set(p.id, got[i] || { error: 'unavailable' }));
    render();
  }

  tavern.on('change', (e) => {
    if (e.scope === 'rooms' || !String(e.key).startsWith(PLACE_PREFIX)) return;
    const id = String(e.key).slice(PLACE_PREFIX.length);
    const p = e.deleted ? null : cleanPlace(id, e.value);
    if (p) { state.places.set(id, { place: p, version: e.version }); state.linked.delete(id); } else state.places.delete(id);
    if (state.selected && state.selected.kind === 'place' && state.selected.id === id && !p) state.selected = null;
    render();
    loadLinked().catch(() => {});
  });

  // Save a place (a new one when `id` is empty). Resolves with the place, or rejects with the store's error.
  async function savePlace(p, version) {
    const id = p.id || newId();
    const value = placeValue({ ...p, id });
    const saved = await tavern.storage.set(PLACE_PREFIX + id, value, version === undefined ? undefined : { version });
    const place = cleanPlace(id, value);
    state.places.set(id, { place, version: saved && saved.version });
    state.linked.delete(id);
    if (place.ref) tavern.refs.setLinks(placeRef(id), [place.ref]).catch(() => {});
    render();
    loadLinked().catch(() => {});
    return place;
  }
  async function removePlace(id) {
    const x = state.places.get(id);
    await tavern.storage.delete(PLACE_PREFIX + id, x ? { version: x.version } : undefined);
    state.places.delete(id);
    tavern.refs.setLinks(placeRef(id), []).catch(() => {});
    if (state.selected && state.selected.id === id) state.selected = null;
    render();
  }

  // --- drawing the list and the place -------------------------------------------------------------------------------

  function renderList(body) {
    const notes = [];
    if (state.listonly && state.noWebgl) {
      const n = clone('tpl-notice');
      fill(n, { text: 'This device cannot draw the map, so the places are listed here. Each one opens in your own maps app.' });
      notes.push(n);
    }
    if (state.searchNote) {
      const n = clone('tpl-notice');
      fill(n, { text: state.searchNote });
      notes.push(n);
    }
    body.replaceChildren(...notes);
    const mine = own();
    const theirs = shownItems();
    if (!mine.length && !theirs.length) {
      const e = clone('tpl-empty');
      fill(e, { text: canEdit ? 'No places yet. Choose Add place, then click the map, or paste coordinates or a map link in the bar below.' : 'No places yet.' });
      body.appendChild(e);
      return;
    }
    const row = (kind, id, icon, title, sub) => {
      const r = clone('tpl-row');
      r.dataset.kind = kind;
      r.dataset.id = id;
      setIcon(r.querySelector('[data-icon]'), icon);
      fill(r, { title, sub });
      if (state.selected && state.selected.kind === kind && state.selected.id === id) r.classList.add('selected');
      return r;
    };
    if (mine.length) {
      const t = clone('tpl-group-title');
      fill(t, { text: 'Added here' });
      body.appendChild(t);
      for (const p of mine) body.appendChild(row('place', p.id, 'location-dot', p.title, p.notes.split('\n')[0].slice(0, 80)));
    }
    if (theirs.length) {
      const t = clone('tpl-group-title');
      fill(t, { text: 'From other modules' });
      body.appendChild(t);
      for (const c of theirs) body.appendChild(row('item', itemId(c), (c.module && c.module.icon) || 'location-dot', c.title, [c.module && c.module.name, whenText(c.when)].filter(Boolean).join(' · ')));
    }
  }

  function renderPlace(body, sel) {
    const el = clone('tpl-place');
    const isPlace = sel.kind === 'place';
    const p = isPlace ? sel.place : cardPlace(sel.card);
    el.dataset.kind = sel.kind;
    el.dataset.id = p.id;
    fill(el, { title: p.title, where: '', coords: coordsText(p.point.lat, p.point.lng), notes: isPlace ? p.notes : sel.card.subtitle || '' });
    const src = slot(el, 'source');
    const ref = isPlace ? p.ref : sel.card.ref;
    const card = isPlace ? state.linked.get(p.id) : sel.card;
    if (ref && card && !card.error) {
      setIcon(src.querySelector('[data-icon]'), (card.module && card.module.icon) || 'link');
      fill(src, { from: `from ${(card.module && card.module.name) || 'another module'} · ${card.title}${card.when ? ' · ' + whenText(card.when) : ''}` });
      src.hidden = false;
      src.querySelector('[data-action="open"]').dataset.ref = tavern.util.refKey(ref);
    } else src.hidden = true;
    const owners = slot(el, 'owners');
    owners.replaceChildren(...(isPlace ? p.owners : []).map((k) => { const o = clone('tpl-owner'); o.textContent = (nameOf(k)[0] || '?').toUpperCase(); o.title = nameOf(k); return o; }));
    owners.parentElement.hidden = !owners.children.length;
    const open = el.querySelector('[data-action="open-in-maps"]');
    open.href = mapsLink(p, apple);
    for (const a of ['edit', 'delete']) hide(el.querySelector(`[data-action="${a}"]`), !isPlace || !canEdit);
    body.replaceChildren(el);
  }

  function render() {
    const sel = findSelected();
    if (state.selected && !sel) state.selected = null;
    const body = $('panel-body');
    if (sel) renderPlace(body, sel); else renderList(body);
    const total = own().length + shownItems().length;
    for (const c of root.querySelectorAll('[data-slot="count"]')) if (!c.closest('template')) c.textContent = total ? String(total) : '';
    $('panel').querySelector('[data-slot="heading"]').textContent = sel ? 'Place' : 'Places';
    hide($('panel').querySelector('[data-action="back"]'), !sel);
    syncPanel();
    hydrate(root);
    drawPins();
  }

  function syncPanel() {
    const panel = $('panel');
    if (state.listonly) { panel.hidden = false; panel.dataset.state = 'open'; return; }
    if (narrow.matches) { panel.hidden = false; panel.dataset.state = state.panelOpen ? 'open' : 'peek'; } else { panel.dataset.state = 'open'; panel.hidden = !state.panelOpen; }
    const tool = root.querySelector('[data-action="toggle-panel"]');
    if (tool) tool.classList.toggle('on', state.panelOpen);
  }
  narrow.addEventListener('change', () => { state.panelOpen = !narrow.matches; syncPanel(); state.map && state.map.resize(); });

  function select(kind, id, o) {
    state.selected = kind ? { kind, id } : null;
    if (kind) state.panelOpen = true;
    render();
    const sel = findSelected();
    if (sel && state.map && !(o && o.still)) {
      const pt = sel.kind === 'place' ? sel.place.point : cardPlace(sel.card).point;
      const pad = narrow.matches ? { bottom: 260 } : { right: 0 };
      state.map.easeTo({ center: [pt.lng, pt.lat], zoom: Math.max(state.map.getZoom(), 13), padding: pad, duration: 500 });
    }
  }

  // --- the pins -----------------------------------------------------------------------------------------------------

  const markers = [];
  let draftMarker = null;
  function clearPins() { while (markers.length) markers.pop().remove(); }

  function makePin(kind, id, icon, label, on) {
    const pin = clone('tpl-pin');
    pin.dataset.kind = kind;
    pin.dataset.id = id;
    setIcon(pin.querySelector('[data-icon]'), icon);
    if (label && state.map.getZoom() >= 11) fill(pin, { label }); else pin.querySelector('.pin-label').remove();
    if (state.selected && state.selected.kind === kind && state.selected.id === id) pin.classList.add('selected');
    pin.addEventListener('click', (e) => { e.stopPropagation(); if (!state.adding) on(); });
    return pin;
  }

  function drawPins() {
    if (!state.map || !state.mapReady) return;
    clearPins();
    const map = state.map;
    const sel = state.selected;
    const all = [
      ...own().map((p) => ({ kind: 'place', id: p.id, lat: p.point.lat, lng: p.point.lng, title: p.title, icon: 'location-dot' })),
      ...shownItems().map((c) => ({ kind: 'item', id: itemId(c), lat: c.place.lat, lng: c.place.lng, title: c.title, icon: (c.module && c.module.icon) || 'location-dot' })),
    ];
    const picked = sel ? all.filter((x) => x.kind === sel.kind && x.id === sel.id) : [];
    const rest = all.filter((x) => !picked.includes(x));
    const groups = clusterPoints(rest, (lat, lng) => map.project([lng, lat]), 36);
    const add = (el, lng, lat, opts) => {
      const m = new maplibregl.Marker({ element: el, anchor: 'bottom', ...(opts || {}) }).setLngLat([lng, lat]).addTo(map);
      markers.push(m);
      return m;
    };
    for (const g of groups) {
      if (g.points.length === 1) {
        const x = g.points[0];
        add(makePin(x.kind, x.id, x.icon, x.title, () => select(x.kind, x.id)), x.lng, x.lat);
      } else {
        const c = clone('tpl-pin-cluster');
        fill(c, { count: g.points.length });
        c.addEventListener('click', (e) => {
          e.stopPropagation();
          const b = boundsOf(g.points);
          map.fitBounds(b, { padding: 60, maxZoom: 17, duration: 500 });
        });
        markers.push(new maplibregl.Marker({ element: c, anchor: 'center' }).setLngLat([g.lng, g.lat]).addTo(map));
      }
    }
    for (const x of picked) {
      const editable = x.kind === 'place' && canEdit;
      const pin = makePin(x.kind, x.id, x.icon, x.title, () => {});
      const m = add(pin, x.lng, x.lat, { draggable: editable });
      if (editable) {
        m.on('dragstart', () => pin.classList.add('dragging'));
        m.on('dragend', async () => {
          pin.classList.remove('dragging');
          const at = m.getLngLat();
          const cur = state.places.get(x.id);
          if (!cur) return;
          try {
            await savePlace({ ...cur.place, point: { ...cur.place.point, lat: round6(Math.max(-90, Math.min(90, at.lat))), lng: round6(Math.max(-180, Math.min(180, at.lng))) } }, cur.version);
          } catch (err) {
            say(err && err.status === 409 ? 'Someone else moved that place first.' : 'The place could not be moved: ' + (err.message || err));
            render();
          }
        });
      }
    }
    hydrate(root);
  }

  function drawDraft() {
    if (draftMarker) { draftMarker.remove(); draftMarker = null; }
    if (!state.draft || !state.map) return;
    const pin = clone('tpl-pin');
    pin.dataset.kind = 'place';
    pin.classList.add('draft');
    setIcon(pin.querySelector('[data-icon]'), 'location-dot');
    pin.querySelector('.pin-label').remove();
    draftMarker = new maplibregl.Marker({ element: pin, anchor: 'bottom' }).setLngLat([state.draft.lng, state.draft.lat]).addTo(state.map);
    hydrate(root);
  }

  // --- adding and changing a place ----------------------------------------------------------------------------------

  function setAdding(on) {
    state.adding = Boolean(on) && canEdit && Boolean(state.map);
    $('map').classList.toggle('adding', state.adding);
    hide($('banner'), !state.adding);
    root.querySelector('[data-action="add-place"]').classList.toggle('on', state.adding);
  }

  function openEditor(o) {
    // o: { id?, title?, lat, lng, notes?, ref? }
    const x = o.id ? state.places.get(o.id) : null;
    state.editing = { id: o.id || null, version: x ? x.version : undefined, ref: x ? x.place.ref : o.ref || null, owners: x ? x.place.owners : [] };
    $('editor-title').textContent = o.id ? 'Change this place' : 'Add a place';
    $('f-title').value = o.title || '';
    $('f-lat').value = o.lat == null ? '' : String(round6(o.lat));
    $('f-lng').value = o.lng == null ? '' : String(round6(o.lng));
    $('f-notes').value = o.notes || '';
    $('f-by').textContent = x && x.place.by ? `Last changed by ${nameOf(x.place.by) || 'someone'}` : '';
    $('f-error').hidden = true;
    hide($('f-delete'), !o.id);
    $('f-delete').textContent = 'Delete';
    hide($('editor'), false);
    setAdding(false);
    $('f-title').focus();
  }
  function closeEditor() {
    hide($('editor'), true);
    state.editing = null;
    state.draft = null;
    drawDraft();
  }
  const editorError = (text) => { $('f-error').textContent = text; $('f-error').hidden = !text; };

  // The pin follows the coordinates as they are typed.
  function syncDraftFromFields() {
    const lat = coord($('f-lat').value, 90);
    const lng = coord($('f-lng').value, 180);
    if (lat === null || lng === null || !state.editing) return;
    if (state.editing.id) return;
    state.draft = { lat, lng };
    drawDraft();
  }
  $('f-lat').addEventListener('input', syncDraftFromFields);
  $('f-lng').addEventListener('input', syncDraftFromFields);

  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.editing) return;
    const title = oneLine($('f-title').value, 120);
    const lat = coord($('f-lat').value, 90);
    const lng = coord($('f-lng').value, 180);
    if (!title) return editorError('Give the place a name.');
    if (lat === null || lng === null) return editorError('Latitude is a number from -90 to 90 and longitude from -180 to 180.');
    const cur = state.editing;
    const base = cur.id && state.places.get(cur.id) ? state.places.get(cur.id).place : null;
    const place = {
      id: cur.id || '',
      title,
      notes: $('f-notes').value,
      point: { lat, lng, name: title },
      owners: base ? base.owners : cur.owners.length ? cur.owners : [info.user.key],
      by: info.user.key,
      ref: base ? base.ref : cur.ref,
    };
    $('f-save').disabled = true;
    try {
      const saved = await savePlace(place, cur.id ? cur.version : undefined);
      closeEditor();
      select('place', saved.id);
    } catch (err) {
      if (err && err.status === 409) {
        const now = state.places.get(cur.id);
        if (now) cur.version = now.version;
        else if (err.current && err.current.version) cur.version = err.current.version;
        editorError('Someone changed this place while you were editing. Save again to keep your changes.');
      } else editorError('It could not be saved: ' + ((err && err.message) || err));
    } finally {
      $('f-save').disabled = false;
    }
  });
  $('f-cancel').addEventListener('click', closeEditor);
  $('f-delete').addEventListener('click', async () => {
    if (!state.editing || !state.editing.id) return;
    if (state.armed !== 'editor') { state.armed = 'editor'; $('f-delete').textContent = 'Delete it?'; return; }
    state.armed = null;
    try { await removePlace(state.editing.id); closeEditor(); } catch (err) { editorError('It could not be deleted: ' + ((err && err.message) || err)); }
  });
  $('editor').addEventListener('pointerdown', (e) => { if (e.target === $('editor')) closeEditor(); });

  // A pin where a place would go, and the editor for it.
  function draftAt(lat, lng, o) {
    if (!canEdit) return;
    state.draft = { lat, lng };
    drawDraft();
    if (state.map) state.map.easeTo({ center: [lng, lat], zoom: Math.max(state.map.getZoom(), 14), duration: 500 });
    openEditor({ lat, lng, ...(o || {}) });
  }

  // --- search (only when the admin set an address) ------------------------------------------------------------------

  let searchToken = 0;
  let hits = [];
  let hit = -1;
  function drawResults() {
    const list = $('results');
    list.replaceChildren();
    if (state.searchMessage) {
      const li = document.createElement('li');
      li.className = 'note';
      li.textContent = state.searchMessage;
      list.appendChild(li);
    }
    hits.forEach((h, i) => {
      const li = clone('tpl-result');
      fill(li, { title: h.title, sub: h.sub });
      const b = li.querySelector('.result');
      b.dataset.i = String(i);
      b.classList.toggle('on', i === hit);
      list.appendChild(li);
    });
    list.hidden = !list.children.length;
    hydrate(root);
  }
  async function search(text) {
    const q = String(text || '').trim();
    const mine = ++searchToken;
    hits = [];
    hit = -1;
    state.searchMessage = '';
    if (!state.settings.search || q.length < 2) { drawResults(); return; }
    try {
      const u = new URL(state.settings.search);
      u.searchParams.set('q', q);
      u.searchParams.set('limit', '6');
      if (state.map) { const c = state.map.getCenter(); u.searchParams.set('lat', String(round6(c.lat))); u.searchParams.set('lon', String(round6(c.lng))); }
      const res = await fetch(u.href, { headers: { Accept: 'application/json' }, credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!res.ok) throw new Error(String(res.status));
      const found = searchResults(await res.json(), 6);
      if (mine !== searchToken) return;
      hits = found;
      state.searchMessage = found.length ? '' : 'No results';
    } catch (err) {
      if (mine !== searchToken) return;
      state.searchMessage = 'Search is not available right now';
    }
    drawResults();
  }
  function pickHit(i) {
    const h = hits[i];
    if (!h) return;
    $('search-input').value = '';
    hits = [];
    state.searchMessage = '';
    drawResults();
    if (canEdit) draftAt(h.lat, h.lng, { title: h.title, notes: h.sub });
    else if (state.map) state.map.easeTo({ center: [h.lng, h.lat], zoom: 15 });
  }
  let searchTimer = null;
  $('search-input').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => search($('search-input').value), 300); });
  $('search-input').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!hits.length) return;
      e.preventDefault();
      hit = (hit + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
      drawResults();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (hit >= 0) pickHit(hit); else if (hits.length) pickHit(0); else { clearTimeout(searchTimer); search($('search-input').value); }
    } else if (e.key === 'Escape') {
      hits = [];
      state.searchMessage = '';
      drawResults();
    }
  });
  $('results').addEventListener('click', (e) => {
    const b = e.target.closest('.result');
    if (b) pickHit(Number(b.dataset.i));
  });

  // --- the map ------------------------------------------------------------------------------------------------------

  const tokenProbe = (name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    $('app').appendChild(probe);
    const c = rgbOf(getComputedStyle(probe).color);
    probe.remove();
    return c;
  };
  const tokens = () => {
    const t = { bg: tokenProbe('--bg'), section: tokenProbe('--bg-section'), text: tokenProbe('--text'), dim: tokenProbe('--text-dim'), accent: tokenProbe('--accent'), border: tokenProbe('--border') };
    for (const k of Object.keys(t)) if (!t[k]) delete t[k];
    return t;
  };

  // The credit the licence requires: always there. A credit the map file's own metadata names (its builder) is added to it.
  function credit(metadata) {
    const box = root.querySelector('.attribution');
    for (const extra of box.querySelectorAll('[data-extra]')) extra.remove();
    const html = metadata && typeof metadata.attribution === 'string' ? metadata.attribution : '';
    if (!html) return;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const a of doc.querySelectorAll('a')) {
      const text = (a.textContent || '').trim().slice(0, 60);
      if (!text || /openstreetmap/i.test(text)) continue;
      const href = a.getAttribute('href') || '';
      const link = document.createElement('a');
      link.textContent = text;
      if (/^https?:\/\//i.test(href)) { link.href = href; link.target = '_blank'; link.rel = 'noopener'; }
      link.dataset.extra = '1';
      box.append(document.createTextNode(' · '), link);
    }
  }

  let protocol = null;
  function showState(name) {
    const s = $('state');
    if (!name) { s.hidden = true; s.replaceChildren(); return; }
    s.replaceChildren(...parts(name));
    s.hidden = false;
    hydrate(s);
  }

  async function startMap() {
    if (state.map) { state.map.remove(); state.map = null; state.mapReady = false; clearPins(); }
    const wantFile = state.settings.map;
    const app = $('app');
    app.classList.remove('listonly');
    state.listonly = false;
    if (!wantFile) {
      showState(isAdmin ? 'tpl-state-nomap-admin' : 'tpl-state-nomap-member');
      if (!isAdmin) { app.classList.add('listonly'); state.listonly = true; }
      hide(root.querySelector('[data-action="add-place"]'), true);
      const link = $('state').querySelector('[data-action="open-settings"]');
      if (link) link.href = '/admin.html#modules';
      render();
      return;
    }
    if (!webgl()) {
      state.noWebgl = true;
      app.classList.add('listonly');
      state.listonly = true;
      showState(null);
      render();
      return;
    }
    showState('tpl-state-loading');
    let fileUrl;
    let header;
    let metadata = null;
    try {
      fileUrl = new URL(await tavern.files.url(wantFile), location.href).href;
      if (!protocol) { protocol = new pmtiles.Protocol(); maplibregl.addProtocol('pmtiles', protocol.tile); }
      const archive = new pmtiles.PMTiles(fileUrl);
      protocol.add(archive);
      header = await archive.getHeader();
      metadata = await archive.getMetadata().catch(() => null);
    } catch (err) {
      showState('tpl-state-error');
      const retry = $('state').querySelector('[data-action="retry"]');
      if (retry) retry.addEventListener('click', () => startMap());
      render();
      return;
    }
    const glyphs = `${location.origin}/maps-glyphs/{fontstack}/{range}.pbf`;
    const style = () => buildStyle(tokens(), { tiles: `pmtiles://${fileUrl}`, glyphs });
    const map = new maplibregl.Map({ container: $('map'), style: style(), attributionControl: false, renderWorldCopies: false, dragRotate: false, pitchWithRotate: false, maxZoom: 19, center: [header.centerLon, header.centerLat], zoom: 2, fadeDuration: 150 });
    map.touchZoomRotate.disableRotation();
    state.map = map;
    map.getCanvas().setAttribute('aria-label', 'Map');
    credit(metadata);
    hide(root.querySelector('[data-action="add-place"]'), !canEdit);
    map.on('click', (e) => {
      if (state.adding) { draftAt(round6(e.lngLat.lat), round6(e.lngLat.lng)); return; }
      if (state.selected) select(null);
    });
    map.on('moveend', drawPins);
    map.once('load', () => {
      state.mapReady = true;
      showState(null);
      const pts = [...own().map((p) => p.point), ...shownItems().map((c) => c.place)];
      const b = boundsOf(pts);
      if (b && (b[0][0] !== b[1][0] || b[0][1] !== b[1][1])) map.fitBounds(b, { padding: 70, maxZoom: 14, animate: false });
      else if (b) map.jumpTo({ center: b[0], zoom: 13 });
      else map.fitBounds([[header.minLon, header.minLat], [header.maxLon, header.maxLat]], { padding: 20, animate: false });
      render();
      const want = state.openWanted;
      state.openWanted = null;
      if (want) select(want.kind, want.id);
    });
    let failed = false;
    map.on('error', (e) => {
      if (state.mapReady || failed) return;
      const status = e && e.error && e.error.status;
      if (status === 404 || status === 401 || status === 403) { failed = true; showState('tpl-state-error'); const retry = $('state').querySelector('[data-action="retry"]'); if (retry) retry.addEventListener('click', () => startMap()); }
    });
    map.on('styleimagemissing', () => {});
  }

  function webgl() {
    try {
      const c = document.createElement('canvas');
      return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (err) {
      return false;
    }
  }

  // The zoom and locate buttons.
  (function controls() {
    const group = document.createElement('div');
    group.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const button = (icon, label, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.title = label;
      b.setAttribute('aria-label', label);
      const i = document.createElement('span');
      i.className = 'ic';
      i.dataset.icon = icon;
      b.appendChild(i);
      b.addEventListener('click', fn);
      group.appendChild(b);
    };
    button('plus', 'Zoom in', () => state.map && state.map.zoomIn());
    button('minus', 'Zoom out', () => state.map && state.map.zoomOut());
    button('location-crosshairs', 'Show where I am', () => {
      if (!state.map || !navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition((pos) => state.map.easeTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: Math.max(state.map.getZoom(), 14) }), () => say('Your location is not available here.'), { timeout: 8000 });
    });
    $('ctrl-zoom').appendChild(group);
  })();

  // --- events on the page -------------------------------------------------------------------------------------------

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-action], .place-row');
    if (!t || t.closest('template')) return;
    if (t.classList.contains('place-row')) return select(t.dataset.kind, t.dataset.id);
    const a = t.dataset.action;
    const sel = findSelected();
    if (a === 'back') select(null);
    else if (a === 'close-panel') { if (state.selected) select(null); else { state.panelOpen = false; syncPanel(); } }
    else if (a === 'toggle-panel') { state.panelOpen = !state.panelOpen; syncPanel(); if (state.map) setTimeout(() => state.map.resize(), 0); }
    else if (a === 'toggle-sheet') { state.panelOpen = !state.panelOpen; syncPanel(); }
    else if (a === 'add-place') setAdding(!state.adding);
    else if (a === 'cancel') setAdding(false);
    else if (a === 'copy-coords' && sel) {
      const p = sel.kind === 'place' ? sel.place : cardPlace(sel.card);
      try { await navigator.clipboard.writeText(coordsText(p.point.lat, p.point.lng)); say('Coordinates copied.'); setTimeout(() => say(''), 2000); } catch (err) { say('Copy them from the place: ' + coordsText(p.point.lat, p.point.lng)); }
    } else if (a === 'edit' && sel && sel.kind === 'place') openEditor({ id: sel.place.id, title: sel.place.title, lat: sel.place.point.lat, lng: sel.place.point.lng, notes: sel.place.notes });
    else if (a === 'delete' && sel && sel.kind === 'place') {
      if (state.armed !== 'panel') { state.armed = 'panel'; t.lastChild.textContent = ' Delete it?'; return; }
      state.armed = null;
      try { await removePlace(sel.place.id); } catch (err) { say('It could not be deleted: ' + ((err && err.message) || err)); }
    } else if (a === 'open') {
      const ref = sel && (sel.kind === 'place' ? sel.place.ref : sel.card.ref);
      if (ref) tavern.refs.open(ref).catch(() => say('That item could not be opened.'));
    }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('editor').hidden) closeEditor(); else if (state.adding) setAdding(false);
  });

  // An item dropped on the map: a place at that spot, with the item as its source (the editor opens first).
  if (tavern.refs && tavern.refs.dropTarget) {
    tavern.refs.dropTarget({
      over: () => {},
      leave: () => {},
      drop: async (ref, pt) => {
        if (!ref || !canEdit || !state.map || !state.mapReady) return;
        const host = tavern.rootElement;
        const hr = host.getBoundingClientRect();
        const mr = $('map').getBoundingClientRect();
        const at = state.map.unproject([pt.x + hr.left - mr.left, pt.y + hr.top - mr.top]);
        let card = null;
        try { card = await tavern.refs.resolve(ref); } catch (err) { card = null; }
        if (!card || card.error) return say('That item could not be read.');
        if (card.place) return select('item', tavern.util.refKey(ref));
        draftAt(round6(at.lat), round6(at.lng), { title: card.title, notes: card.subtitle || '', ref });
      },
    });
  }

  // What other modules may ask of this one.
  if (tavern.actions && tavern.actions.provide) {
    tavern.actions.provide({
      addPlace: async (input) => {
        const lat = Number(input.lat);
        const lng = Number(input.lng);
        const title = oneLine(input.title, 120);
        if (!title || !inRange(lat, lng)) throw new Error('a place needs a name and coordinates in range');
        const place = await savePlace({ id: '', title, notes: input.notes || '', point: { lat, lng, name: title }, owners: [], by: info.user.key, ref: input.ref || null });
        return { ref: placeRef(place.id) };
      },
    });
  }
  if (tavern.refs && tavern.refs.onOpen) {
    tavern.refs.onOpen((ref) => {
      if (ref.module !== info.module.id || ref.kind !== 'place') return;
      if (state.mapReady || state.listonly) select('place', ref.id); else state.openWanted = { kind: 'place', id: ref.id };
    });
  }

  // The bottom bar: paste coordinates or a map link, or type something to search for.
  if (tavern.bar) {
    tavern.bar.set(canEdit ? [{ id: 'add', type: 'quickadd', label: 'Add a place', placeholder: 'Paste a place, coordinates or a map link' }] : []).catch(() => {});
    tavern.on('bar', (e) => {
      if (e.id !== 'add' || !canEdit) return;
      const text = String(e.value || '').trim();
      if (!text) return setAdding(true);
      const p = parsePoint(text);
      if (p) return draftAt(p.lat, p.lng);
      if (state.settings.search) { $('search-input').value = text; search(text); $('search-input').focus(); return; }
      say('Search is not set up. Paste coordinates or a map link, or click the map.');
    });
  }

  tavern.on('theme', () => {
    if (!state.map || !state.mapReady) return;
    const c = state.map.getStyle();
    if (!c || !c.sources || !c.sources.map) return;
    state.map.setStyle(buildStyle(tokens(), { tiles: c.sources.map.url, glyphs: `${location.origin}/maps-glyphs/{fontstack}/{range}.pbf` }));
  });

  function applySettings(next) {
    const mapChanged = next.map !== state.settings.map;
    state.settings = { map: next.map || '', search: next.search || '' };
    hide($('search'), !state.settings.search);
    if (mapChanged && state.started) startMap();
  }
  tavern.settings.onChange((s) => applySettings(s || {}));

  // Other modules' items change without telling this page: look again now and then, and when the page comes back.
  const refresh = async () => { await loadItems(); if (state.started) render(); };
  const timer = setInterval(() => { if (!tavern.rootElement.isConnected) clearInterval(timer); else refresh(); }, 90000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

  // --- start --------------------------------------------------------------------------------------------------------

  try {
    for (const name of new Set([...root.querySelectorAll('[data-icon]'), ...[...root.querySelectorAll('template')].flatMap((t) => [...t.content.querySelectorAll('[data-icon]')])].map((n) => n.dataset.icon).concat(['location-dot', 'map-location-dot', 'link']))) if (name) wantIcon(name);
    applySettings((await tavern.settings.get()) || {});
    state.people = await tavern.people().catch(() => []);
    await Promise.all([loadPlaces(), loadItems()]);
    $('msg').hidden = true;
    $('app').hidden = false;
    state.started = true;
    render();
    await startMap();
    loadLinked().catch(() => {});
  } catch (err) {
    $('app').hidden = true;
    $('msg').hidden = false;
    $('msg').textContent = 'The map could not load: ' + err.message;
  }
})();
