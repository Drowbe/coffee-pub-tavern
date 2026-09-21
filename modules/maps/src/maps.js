// The Maps module's page: a map of every place the room has, from the admin's map file. Maps keeps no data of its own: it draws
// every card in the room that carries a `place` (through the cards conduit), each with its own module's icon and grouped by
// module, and it saves a new place by asking whichever module provides the `addPlace` action. This page draws into the markup
// in maps.html by cloning its templates and filling their [data-slot] and [data-icon] hooks, and toggles the state classes
// and data attributes CONTRACT.md lists. It builds no markup from strings and sets no style (the map library positions the
// pins). Nothing here names another module, and no request leaves the server unless the admin set a search address.
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

  const geo = tavern.util.geo;
  const { round6, oneLine, parsePoint, coordsText, mapsLink } = geo;
  /*__LIB__*/

  const canEdit = tavern.can('edit');
  const isAdmin = info.user && info.user.role === 'admin';
  const maplibregl = window.maplibregl;
  // The pane's width, not the window's: a bundled module runs in the page, so a media query would follow the window. The
  // stylesheet keys its narrow layout on `.app.narrow`.
  const NARROW = 720;
  const isNarrow = () => $('app').classList.contains('narrow');
  const apple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document;

  const state = {
    items: [], // the cards in this room that carry a place
    settings: { map: '', search: '' },
    selected: null, // the id of the card that is open
    panelOpen: true,
    adding: false,
    draft: null, // { lat, lng }: where a new place would go
    adder: null, // the action that saves a place, if some module provides one
    map: null,
    mapReady: false,
    fitted: false,
    started: false,
    saving: false,
  };

  // --- small helpers ------------------------------------------------------------------------------------------------

  const clone = (id) => $(id).content.firstElementChild.cloneNode(true);
  const parts = (id) => [...$(id).content.children].map((n) => n.cloneNode(true));
  const hide = (node, yes) => { if (node) node.hidden = Boolean(yes); };
  const slot = (el, name) => (el.dataset.slot === name ? el : el.querySelector(`[data-slot="${name}"]`));
  function fill(el, values) {
    for (const [name, value] of Object.entries(values)) {
      const s = slot(el, name);
      if (s) { s.textContent = value == null ? '' : String(value); s.hidden = value === '' || value == null; }
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

  // --- the places (cards) -------------------------------------------------------------------------------------------

  const cardId = (c) => tavern.util.refKey(c.ref);
  // A place kept by the module that owns places is drawn as a place; anything else with a position is an item.
  const kindOf = (c) => (c.kind === 'place' ? 'place' : 'item');
  const moduleName = (c) => (c.module && c.module.name) || 'Other';
  const current = () => (state.selected ? state.items.find((c) => cardId(c) === state.selected) || null : null);
  // The cards by module: the module that keeps places first, then the others by name.
  function groups() {
    const by = new Map();
    for (const c of state.items) {
      const k = (c.module && c.module.id) || '';
      if (!by.has(k)) by.set(k, { name: moduleName(c), places: false, cards: [] });
      const g = by.get(k);
      g.places = g.places || c.kind === 'place';
      g.cards.push(c);
    }
    for (const g of by.values()) g.cards.sort((a, b) => a.title.localeCompare(b.title));
    return [...by.values()].sort((a, b) => (a.places === b.places ? a.name.localeCompare(b.name) : a.places ? -1 : 1));
  }

  async function loadItems() {
    if (!tavern.refs || !tavern.refs.search) return;
    try {
      const found = await tavern.refs.search('');
      state.items = found.filter((c) => c && c.ref && c.place && geo.inRange(Number(c.place.lat), Number(c.place.lng)) && c.title);
    } catch (err) {
      state.items = [];
    }
  }
  // Which module (if any) will save a place for us: one that provides an `addPlace` action taking a position.
  async function findAdder() {
    state.adder = null;
    if (!canEdit || !tavern.actions || !tavern.actions.list) return;
    try {
      const list = await tavern.actions.list();
      state.adder = list.find((a) => a.name === 'addPlace' && a.input && a.input.lat && a.input.lng && a.input.title) || null;
    } catch (err) {
      state.adder = null;
    }
  }

  // --- drawing the list and the place -------------------------------------------------------------------------------

  function renderList(body) {
    const notes = [];
    const note = (text) => { const n = clone('tpl-notice'); fill(n, { text }); notes.push(n); };
    if (state.listonly && state.noWebgl) note('This device cannot draw the map, so the places are listed here. Each one opens in your own maps app.');
    if (canEdit && !state.adder && state.started) note('Install Places to save places.');
    if (state.searchNote) note(state.searchNote);
    body.replaceChildren(...notes);
    if (!state.items.length) {
      const e = clone('tpl-empty');
      fill(e, { text: state.adder ? 'No places yet. Choose Add place, then click the map, or paste coordinates or a map link in the bar below.' : 'No places yet.' });
      body.appendChild(e);
      return;
    }
    for (const g of groups()) {
      const t = clone('tpl-group-title');
      fill(t, { text: g.places ? g.name : `From ${g.name}` });
      body.appendChild(t);
      for (const c of g.cards) {
        const r = clone('tpl-row');
        r.dataset.kind = kindOf(c);
        r.dataset.id = cardId(c);
        setIcon(r.querySelector('[data-icon]'), (c.module && c.module.icon) || 'location-dot');
        fill(r, { title: c.title, sub: c.subtitle || whenText(c.when) });
        if (state.selected === cardId(c)) r.classList.add('selected');
        body.appendChild(r);
      }
    }
  }

  function renderPlace(body, c) {
    const el = clone('tpl-place');
    el.dataset.kind = kindOf(c);
    el.dataset.id = cardId(c);
    fill(el, { title: c.title, where: c.subtitle || '', coords: coordsText(c.place.lat, c.place.lng), notes: '' });
    const src = slot(el, 'source');
    setIcon(src.querySelector('[data-icon]'), (c.module && c.module.icon) || 'link');
    fill(src, { from: `from ${moduleName(c)}${c.when ? ' · ' + whenText(c.when) : ''}` });
    src.hidden = false;
    hide(slot(el, 'owners').parentElement, true);
    el.querySelector('[data-action="open-in-maps"]').href = mapsLink(c.place.lat, c.place.lng, c.title, apple);
    body.replaceChildren(el);
  }

  function render() {
    const sel = current();
    if (state.selected && !sel) state.selected = null;
    const body = $('panel-body');
    if (sel) renderPlace(body, sel); else renderList(body);
    const total = state.items.length;
    for (const c of root.querySelectorAll('[data-slot="count"]')) if (!c.closest('template')) c.textContent = total && !(sel && c.closest('.panel-head')) ? String(total) : ''; // the header's count is for the list, not for one place
    $('panel').querySelector('[data-slot="heading"]').textContent = sel ? 'Place' : 'Places';
    hide($('panel').querySelector('[data-action="back"]'), !sel);
    hide(root.querySelector('[data-action="add-place"]'), !state.adder || !state.map);
    syncPanel();
    hydrate(root);
    drawPins();
  }

  function syncPanel() {
    const panel = $('panel');
    if (state.listonly) { panel.hidden = false; panel.dataset.state = 'open'; return; }
    if (isNarrow()) { panel.hidden = false; panel.dataset.state = state.panelOpen ? 'open' : 'peek'; } else { panel.dataset.state = 'open'; panel.hidden = !state.panelOpen; }
    const tool = root.querySelector('[data-action="toggle-panel"]');
    if (tool) tool.classList.toggle('on', state.panelOpen);
  }
  // Follow the pane's width. A frame can report none while it is still being laid out, so wait for a real one. Crossing the
  // line resets the panel: a peeking sheet on a narrow pane, open beside the map on a wide one.
  const fit = () => {
    const w = tavern.rootElement.clientWidth;
    if (!w) return;
    const now = w < NARROW;
    if (now === isNarrow() && state.fitted) { state.map && state.map.resize(); return; }
    state.fitted = true;
    $('app').classList.toggle('narrow', now);
    state.panelOpen = !now;
    if (state.started) { syncPanel(); state.map && state.map.resize(); }
  };
  fit();
  new ResizeObserver(fit).observe(tavern.rootElement);

  function select(id, o) {
    state.selected = id || null;
    if (id) state.panelOpen = true;
    render();
    const c = current();
    if (c && state.map && !(o && o.still)) {
      const pad = isNarrow() ? { bottom: 260 } : { right: 0 };
      state.map.easeTo({ center: [c.place.lng, c.place.lat], zoom: Math.max(state.map.getZoom(), 13), padding: pad, duration: 500 });
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
    if (state.selected === id) pin.classList.add('selected');
    pin.addEventListener('click', (e) => { e.stopPropagation(); if (!state.adding) on(); });
    return pin;
  }

  function drawPins() {
    if (!state.map || !state.mapReady) return;
    clearPins();
    const map = state.map;
    const all = state.items.map((c) => ({ kind: kindOf(c), id: cardId(c), lat: c.place.lat, lng: c.place.lng, title: c.title, icon: (c.module && c.module.icon) || 'location-dot' }));
    const picked = all.filter((x) => x.id === state.selected);
    const rest = all.filter((x) => !picked.includes(x));
    for (const g of clusterPoints(rest, (lat, lng) => map.project([lng, lat]), 36)) {
      if (g.points.length === 1) {
        const x = g.points[0];
        markers.push(new maplibregl.Marker({ element: makePin(x.kind, x.id, x.icon, x.title, () => select(x.id)), anchor: 'bottom' }).setLngLat([x.lng, x.lat]).addTo(map));
      } else {
        const c = clone('tpl-pin-cluster');
        fill(c, { count: g.points.length });
        c.addEventListener('click', (e) => {
          e.stopPropagation();
          map.fitBounds(boundsOf(g.points), { padding: 60, maxZoom: 17, duration: 500 });
        });
        markers.push(new maplibregl.Marker({ element: c, anchor: 'center' }).setLngLat([g.lng, g.lat]).addTo(map));
      }
    }
    for (const x of picked) markers.push(new maplibregl.Marker({ element: makePin(x.kind, x.id, x.icon, x.title, () => {}), anchor: 'bottom' }).setLngLat([x.lng, x.lat]).addTo(map));
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

  // --- saving a new place -------------------------------------------------------------------------------------------

  function setAdding(on) {
    state.adding = Boolean(on) && Boolean(state.adder) && Boolean(state.map);
    $('map').classList.toggle('adding', state.adding);
    hide($('banner'), !state.adding);
    root.querySelector('[data-action="add-place"]').classList.toggle('on', state.adding);
  }

  const editorError = (text) => { $('f-error').textContent = text; $('f-error').hidden = !text; };
  function openEditor(o) {
    $('f-title').value = o.title || '';
    $('f-notes').value = o.notes || '';
    $('f-where').textContent = coordsText(state.draft.lat, state.draft.lng);
    editorError('');
    hide($('editor'), false);
    setAdding(false);
    $('f-title').focus();
  }
  function closeEditor() {
    hide($('editor'), true);
    if (!state.saving) { state.draft = null; drawDraft(); }
  }
  $('f-cancel').addEventListener('click', closeEditor);
  $('editor').addEventListener('pointerdown', (e) => { if (e.target === $('editor')) closeEditor(); });

  // A pin where a place would go, and the dialog for it.
  function draftAt(lat, lng, o) {
    if (!state.adder) return;
    state.draft = { lat, lng };
    drawDraft();
    if (state.map) state.map.easeTo({ center: [lng, lat], zoom: Math.max(state.map.getZoom(), 14), duration: 500 });
    openEditor(o || {});
  }

  // The module that carries the action saves it from its own page (Tavern opens that pane if it is not open), so look for the
  // new card for a little while.
  async function waitForCard(before) {
    for (let i = 0; i < 12; i += 1) {
      await new Promise((r) => setTimeout(r, i ? 2000 : 800));
      await loadItems();
      if (state.items.length > before) return true;
    }
    return false;
  }
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.draft || !state.adder || state.saving) return;
    const title = oneLine($('f-title').value, 120);
    if (!title) return editorError('Give the place a name.');
    state.saving = true;
    $('f-save').disabled = true;
    const before = state.items.length;
    try {
      const out = await tavern.actions.request(state.adder.action, { title, lat: state.draft.lat, lng: state.draft.lng, notes: $('f-notes').value.slice(0, 1000) }, { wait: true });
      if (out.status === 'done' && out.result && !out.result.ok) { editorError(out.result.error || 'It could not be saved.'); return; }
      hide($('editor'), true);
      const ref = out.status === 'done' && out.result && out.result.ref;
      if (!ref) {
        say('Saving. The place appears when it is saved.');
        await waitForCard(before);
        say('');
      } else await loadItems();
      state.draft = null;
      drawDraft();
      render();
      const saved = ref ? state.items.find((c) => cardId(c) === tavern.util.refKey(ref)) : null;
      if (saved) select(cardId(saved));
    } catch (err) {
      editorError('It could not be saved: ' + ((err && err.message) || err));
    } finally {
      state.saving = false;
      $('f-save').disabled = false;
    }
  });

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
    if (state.adder) draftAt(h.lat, h.lng, { title: h.title, notes: h.sub });
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
  const showError = () => {
    showState('tpl-state-error');
    const retry = $('state').querySelector('[data-action="retry"]');
    if (retry) retry.addEventListener('click', () => startMap());
  };

  async function startMap() {
    if (state.map) { state.map.remove(); state.map = null; state.mapReady = false; clearPins(); }
    const wantFile = state.settings.map;
    const app = $('app');
    app.classList.remove('listonly');
    state.listonly = false;
    if (!wantFile) {
      showState(isAdmin ? 'tpl-state-nomap-admin' : 'tpl-state-nomap-member');
      if (!isAdmin) { app.classList.add('listonly'); state.listonly = true; }
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
      showError();
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
    map.on('click', (e) => {
      if (state.adding) { draftAt(round6(e.lngLat.lat), round6(e.lngLat.lng)); return; }
      if (state.selected) select(null);
    });
    map.on('moveend', drawPins);
    map.once('load', () => {
      state.mapReady = true;
      showState(null);
      const b = boundsOf(state.items.map((c) => c.place));
      if (b && (b[0][0] !== b[1][0] || b[0][1] !== b[1][1])) map.fitBounds(b, { padding: 70, maxZoom: 14, animate: false });
      else if (b) map.jumpTo({ center: b[0], zoom: 13 });
      else map.fitBounds([[header.minLon, header.minLat], [header.maxLon, header.maxLat]], { padding: 20, animate: false });
      render();
      const want = state.openWanted;
      state.openWanted = null;
      if (want) select(want);
    });
    let failed = false;
    map.on('error', (e) => {
      if (state.mapReady || failed) return;
      const status = e && e.error && e.error.status;
      if (status === 404 || status === 401 || status === 403) { failed = true; showError(); }
    });
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
    if (t.classList.contains('place-row')) return select(t.dataset.id);
    const a = t.dataset.action;
    const c = current();
    if (a === 'back') select(null);
    else if (a === 'close-panel') { if (state.selected) select(null); else { state.panelOpen = false; syncPanel(); } }
    else if (a === 'toggle-panel') { state.panelOpen = !state.panelOpen; syncPanel(); if (state.map) setTimeout(() => state.map.resize(), 0); }
    else if (a === 'toggle-sheet') { state.panelOpen = !state.panelOpen; syncPanel(); }
    else if (a === 'add-place') setAdding(!state.adding);
    else if (a === 'cancel') setAdding(false);
    else if (a === 'copy-coords' && c) {
      try { await navigator.clipboard.writeText(coordsText(c.place.lat, c.place.lng)); say('Coordinates copied.'); setTimeout(() => say(''), 2000); } catch (err) { say('Copy them from the place: ' + coordsText(c.place.lat, c.place.lng)); }
    } else if (a === 'open' && c) tavern.refs.open(c.ref).catch(() => say('That item could not be opened.'));
  });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('editor').hidden) closeEditor(); else if (state.adding) setAdding(false);
  });

  // An item dropped on the map: one that already has a place is shown; another gets a position through its own module's
  // `setPlacePoint` action, when it offers one for that kind of item. Nothing else is done to it.
  if (tavern.refs && tavern.refs.dropTarget) {
    tavern.refs.dropTarget({
      over: () => {},
      leave: () => {},
      drop: async (ref, pt) => {
        if (!ref || !canEdit || !state.map || !state.mapReady) return;
        const hr = tavern.rootElement.getBoundingClientRect();
        const mr = $('map').getBoundingClientRect();
        const at = state.map.unproject([pt.x + hr.left - mr.left, pt.y + hr.top - mr.top]);
        const known = state.items.find((c) => cardId(c) === tavern.util.refKey(ref));
        if (known) return select(cardId(known));
        let offers = [];
        try { offers = await tavern.actions.list({ accepts: `${ref.module}:${ref.kind}` }); } catch (err) { offers = []; }
        const set = offers.find((a) => a.name === 'setPlacePoint' && a.input && a.input.lat && a.input.lng);
        if (!set) return say('That item cannot be put on the map from here.');
        try {
          const out = await tavern.actions.request(set.action, { place: ref, lat: round6(at.lat), lng: round6(at.lng) }, { wait: true });
          if (out.status === 'done' && out.result && !out.result.ok) return say(out.result.error || 'It could not be placed.');
          await loadItems();
          render();
        } catch (err) {
          say('It could not be placed: ' + ((err && err.message) || err));
        }
      },
    });
  }

  // The bottom bar: paste coordinates or a map link, or type something to search for. Only where a place can be saved.
  function setBar() {
    if (!tavern.bar) return;
    tavern.bar.set(state.adder ? [{ id: 'add', type: 'quickadd', label: 'Add a place', placeholder: 'Paste a place, coordinates or a map link' }] : []).catch(() => {});
  }
  if (tavern.bar) {
    tavern.on('bar', (e) => {
      if (e.id !== 'add' || !state.adder) return;
      const text = String(e.value || '').trim();
      if (!text) return setAdding(true);
      const p = parsePoint(text);
      if (p) return draftAt(p.lat, p.lng);
      if (state.settings.search) { $('search-input').value = text; search(text); $('search-input').focus(); return; }
      say('Search is not set up. Paste coordinates or a map link, or click the map.');
    });
  }

  // Asked to show an item on the map (the map shows what has a place): select it when it is there.
  if (tavern.refs && tavern.refs.onOpen) {
    tavern.refs.onOpen((ref) => {
      const id = tavern.util.refKey(ref);
      if (state.mapReady || state.listonly) select(state.items.some((c) => cardId(c) === id) ? id : null); else state.openWanted = id;
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
  const refresh = async () => { await Promise.all([loadItems(), findAdder()]); setBar(); if (state.started) render(); };
  const timer = setInterval(() => { if (!tavern.rootElement.isConnected) clearInterval(timer); else refresh(); }, 90000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

  // --- start --------------------------------------------------------------------------------------------------------

  try {
    for (const name of new Set([...root.querySelectorAll('[data-icon]'), ...[...root.querySelectorAll('template')].flatMap((t) => [...t.content.querySelectorAll('[data-icon]')])].map((n) => n.dataset.icon).concat(['location-dot', 'map-location-dot', 'link']))) if (name) wantIcon(name);
    applySettings((await tavern.settings.get()) || {});
    await Promise.all([loadItems(), findAdder()]);
    setBar();
    $('msg').hidden = true;
    $('app').hidden = false;
    state.started = true;
    render();
    await startMap();
  } catch (err) {
    $('app').hidden = true;
    $('msg').hidden = false;
    $('msg').textContent = 'The map could not load: ' + err.message;
  }
})();
