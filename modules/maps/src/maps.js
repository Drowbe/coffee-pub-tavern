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
    settings: { maps: [], web: false }, // the map files to draw (names on this server, or one https address when `web`)
    candidates: [], // search results drawn as pins to pick from
    searcher: null, // the action that searches for a place, if some module provides one
    selected: null, // the id of the card that is open
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
  async function loadItems() {
    if (!tavern.refs || !tavern.refs.search) return;
    try {
      // This room's, the person's own (private to them) and everyone's on this server (a guest has neither of the last, so those answer with nothing).
      const [room, mine, everyone] = await Promise.all([tavern.refs.search(''), tavern.refs.search('', { scope: 'person' }).catch(() => []), tavern.refs.search('', { scope: 'server' }).catch(() => [])]);
      const found = [...room, ...mine, ...everyone];
      state.items = found.filter((c) => c && c.ref && c.place && geo.inRange(Number(c.place.lat), Number(c.place.lng)) && c.title);
    } catch (err) {
      state.items = [];
    }
  }
  // What the module that keeps places offers: a dialog for a new place at a position (`newPlace`) and a search by name
  // (`searchPlaces`, which answers with a few results). Found by what they offer, never by name.
  async function findAdder() {
    state.adder = null;
    state.searcher = null;
    if (!tavern.actions || !tavern.actions.list) return;
    try {
      const list = await tavern.actions.list();
      if (canEdit) state.adder = list.find((a) => a.name === 'newPlace' && a.input && a.input.lat && a.input.lng) || null;
      state.searcher = list.find((a) => a.name === 'searchPlaces' && a.input && a.input.q) || null;
    } catch (err) {
      state.adder = null;
      state.searcher = null;
    }
  }

  // --- the callout of the selected place, and drawing --------------------------------------------------------------

  // A selected pin shows its callout over the map: what it is, where, and what can be done (open it in the person's own maps
  // app, copy its position, or open it in the module that owns it). Places is the list; Maps only shows.
  function renderCallout() {
    const box = $('callout');
    const c = current();
    if (!c) { box.replaceChildren(); hide(box, true); return; }
    const el = clone('tpl-callout');
    el.dataset.kind = kindOf(c);
    if (c.category) el.dataset.cat = c.category;
    if (c.ref.scope === 'person') el.dataset.scope = 'person';
    fill(el, { title: c.title, where: c.subtitle || '', coords: coordsText(c.place.lat, c.place.lng), from: `from ${moduleName(c)}${c.when ? ' \u00b7 ' + whenText(c.when) : ''}` });
    setIcon(el.querySelector('.callout-source [data-icon]'), (c.module && c.module.icon) || 'link');
    el.querySelector('[data-action="open-in-maps"]').href = mapsLink(c.place.lat, c.place.lng, c.title, apple);
    box.replaceChildren(el);
    hide(box, false);
    hydrate(box);
  }

  function render() {
    if (state.selected && !current()) state.selected = null;
    renderCallout();
    hydrate(root);
    drawPins();
  }

  // Follow the pane's width (the stylesheet keys its narrow layout on `.app.narrow`). A frame can report none while it is still
  // being laid out, so wait for a real one.
  const fit = () => {
    const w = tavern.rootElement.clientWidth;
    if (!w) return;
    const now = w < NARROW;
    if (now === isNarrow() && state.fitted) { state.map && state.map.resize(); return; }
    state.fitted = true;
    $('app').classList.toggle('narrow', now);
    if (state.started) state.map && state.map.resize();
  };
  fit();
  new ResizeObserver(fit).observe(tavern.rootElement);

  function select(id, o) {
    state.selected = id || null;
    render();
    const c = current();
    if (c && state.map && !(o && o.still)) state.map.easeTo({ center: [c.place.lng, c.place.lat], zoom: Math.max(state.map.getZoom(), 13), duration: 500 });
  }

  // --- the pins -----------------------------------------------------------------------------------------------------

  const markers = [];
  let draftMarker = null;
  function clearPins() { while (markers.length) markers.pop().remove(); }

  function makePin(kind, id, icon, label, on, cat, scope) {
    const pin = clone('tpl-pin');
    pin.dataset.kind = kind;
    pin.dataset.id = id;
    if (cat) pin.dataset.cat = cat;
    if (scope) pin.dataset.scope = scope;
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
    const all = state.items.map((c) => ({ kind: kindOf(c), id: cardId(c), lat: c.place.lat, lng: c.place.lng, title: c.title, cat: c.category || '', scope: c.ref.scope === 'person' ? 'person' : '', icon: (c.module && c.module.icon) || 'location-dot' }));
    const picked = all.filter((x) => x.id === state.selected);
    const rest = all.filter((x) => !picked.includes(x));
    for (const g of clusterPoints(rest, (lat, lng) => map.project([lng, lat]), 36)) {
      if (g.points.length === 1) {
        const x = g.points[0];
        markers.push(new maplibregl.Marker({ element: makePin(x.kind, x.id, x.icon, x.title, () => select(x.id), x.cat, x.scope), anchor: 'bottom' }).setLngLat([x.lng, x.lat]).addTo(map));
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
    for (const c of state.candidates) {
      const pin = clone('tpl-pin');
      pin.dataset.kind = 'place';
      pin.classList.add('candidate');
      setIcon(pin.querySelector('[data-icon]'), 'location-dot');
      fill(pin, { label: c.title });
      pin.addEventListener('click', (e) => { e.stopPropagation(); draftAt(c.lat, c.lng, { title: c.title, address: c.sub }); });
      markers.push(new maplibregl.Marker({ element: pin, anchor: 'bottom' }).setLngLat([c.lng, c.lat]).addTo(map));
    }
    for (const x of picked) markers.push(new maplibregl.Marker({ element: makePin(x.kind, x.id, x.icon, x.title, () => {}, x.cat, x.scope), anchor: 'bottom' }).setLngLat([x.lng, x.lat]).addTo(map));
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
  }

  // A pin where a place would go, and Places' own dialog for it: the map asks the module that keeps places to open its dialog
  // with this spot filled in (its pane opens if it is not open). The pin stays until the new place arrives, or a minute passes.
  function draftAt(lat, lng, o) {
    if (!state.adder) return;
    state.draft = { lat, lng };
    drawDraft();
    setAdding(false);
    state.candidates = [];
    if (state.map) state.map.easeTo({ center: [lng, lat], zoom: Math.max(state.map.getZoom(), 14), duration: 500 });
    const before = state.items.length;
    const a = o || {};
    tavern.actions.request(state.adder.action, { lat, lng, ...(a.title ? { title: a.title } : {}), ...(a.address ? { address: a.address } : {}), ...(a.notes ? { notes: a.notes } : {}) }).catch((err) => { state.draft = null; drawDraft(); say('It could not be started: ' + ((err && err.message) || err)); });
    waitForCard(before).then(() => { if (state.draft && state.draft.lat === lat && state.draft.lng === lng) { state.draft = null; drawDraft(); render(); } });
  }
  async function waitForCard(before) {
    for (let i = 0; i < 30; i += 1) {
      await new Promise((r) => setTimeout(r, 2000));
      await loadItems();
      if (state.items.length > before) return true;
    }
    return false;
  }

  // --- search (only when the admin set an address) ------------------------------------------------------------------

  // What someone sees when they search and no search has been chosen in Places' settings.
  const NO_SEARCH = 'Search is not available. It has not been configured for this room.';
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
    state.candidates = [];
    if (!state.searcher || q.length < 2) { drawResults(); return; }
    try {
      const near = state.map ? state.map.getCenter() : null;
      const out = await tavern.actions.request(state.searcher.action, { q, ...(near ? { lat: round6(near.lat), lon: round6(near.lng) } : {}) }, { wait: true });
      if (mine !== searchToken) return;
      if (out.status !== 'done' || !out.result || !out.result.ok) {
        state.searchMessage = out.result && /not set up|not configured/.test(out.result.error || '') ? NO_SEARCH : 'Search is not available right now';
      } else {
        const list = out.result.data && Array.isArray(out.result.data.results) ? out.result.data.results : [];
        hits = list.filter((h) => h && geo.inRange(Number(h.lat), Number(h.lng)) && typeof h.title === 'string').slice(0, 6).map((h) => ({ title: oneLine(h.title, 120), sub: oneLine(h.sub, 160), lat: Number(h.lat), lng: Number(h.lng) }));
        state.searchMessage = hits.length ? '' : 'No results';
      }
    } catch (err) {
      if (mine !== searchToken) return;
      state.searchMessage = 'Search is not available right now';
    }
    state.candidates = hits;
    drawPins();
    drawResults();
  }
  function pickHit(i) {
    const h = hits[i];
    if (!h) return;
    hits = [];
    state.searchMessage = '';
    drawResults();
    if (state.adder) draftAt(h.lat, h.lng, { title: h.title, address: h.sub });
    else if (state.map) state.map.easeTo({ center: [h.lng, h.lat], zoom: 15 });
  }
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
    const wanted = state.settings.maps;
    const app = $('app');
    if (!wanted.length) {
      showState(isAdmin ? 'tpl-state-nomap-admin' : 'tpl-state-nomap-member');
      const link = $('state').querySelector('[data-action="open-settings"]');
      if (link) link.href = '/admin.html#modules';
      render();
      return;
    }
    if (!webgl()) {
      showState('tpl-state-nowebgl');
      render();
      return;
    }
    showState('tpl-state-loading');
    let fileUrls;
    let headers;
    let metadata = null;
    try {
      if (!protocol) { protocol = new pmtiles.Protocol(); maplibregl.addProtocol('pmtiles', protocol.tile); }
      fileUrls = [];
      headers = [];
      for (const name of wanted) {
        const url = state.settings.web ? name : new URL(await tavern.files.url(name), location.href).href;
        const archive = new pmtiles.PMTiles(url);
        protocol.add(archive);
        headers.push(await archive.getHeader());
        fileUrls.push(url);
        if (!metadata) metadata = await archive.getMetadata().catch(() => null);
      }
    } catch (err) {
      showError();
      render();
      return;
    }
    const glyphs = `${location.origin}/maps-glyphs/{fontstack}/{range}.pbf`;
    state.tileUrls = fileUrls.map((u) => `pmtiles://${u}`);
    const header = { centerLon: headers[0].centerLon, centerLat: headers[0].centerLat, minLon: Math.min(...headers.map((h) => h.minLon)), minLat: Math.min(...headers.map((h) => h.minLat)), maxLon: Math.max(...headers.map((h) => h.maxLon)), maxLat: Math.max(...headers.map((h) => h.maxLat)) };
    const style = () => buildStyle(tokens(), { tiles: state.tileUrls, glyphs });
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
      // A missing glyph range (a script the labels do not cover) is not the map failing.
      if (/maps-glyphs\//.test(String((e && e.error && (e.error.url || e.error.message)) || ''))) return;
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
    const t = e.target.closest('[data-action]');
    if (!t || t.closest('template')) return;
    const a = t.dataset.action;
    const c = current();
    if (a === 'close-callout') select(null);
    else if (a === 'cancel') setAdding(false);
    else if (a === 'copy-coords' && c) {
      try { await navigator.clipboard.writeText(coordsText(c.place.lat, c.place.lng)); say('Coordinates copied.'); setTimeout(() => say(''), 2000); } catch (err) { say('Copy them from the place: ' + coordsText(c.place.lat, c.place.lng)); }
    } else if (a === 'open' && c) tavern.refs.open(c.ref).catch(() => say('That item could not be opened.'));
  });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (state.adding) setAdding(false); else if (hits.length || state.searchMessage) { hits = []; state.searchMessage = ''; state.candidates = []; drawPins(); drawResults(); } else if (state.selected) select(null);
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

  // The host's bottom bar is the map's search: type a place, or paste coordinates or a map link (Enter). A second button
  // starts adding a place by clicking the map. Only where something can be done with it.
  function setBar() {
    if (!tavern.bar) return;
    const items = [];
    if (state.searcher || state.adder) items.push({ id: 'find', type: 'quickadd', icon: 'magnifying-glass', label: 'Search', placeholder: state.searcher ? 'Search, or paste coordinates or a link' : 'Paste coordinates or a link' });
    if (state.adder) items.push({ id: 'add', icon: 'plus', iconOnly: true, label: 'Add a place: click the map' });
    tavern.bar.set(items).catch(() => {});
  }
  if (tavern.bar) {
    tavern.on('bar', (e) => {
      if (e.id === 'add') { if (state.adder) setAdding(!state.adding); return; }
      if (e.id !== 'find') return;
      const text = String(e.value || '').trim();
      if (!text) return;
      const p = parsePoint(text);
      if (p) { if (state.adder) draftAt(p.lat, p.lng); else if (state.map) state.map.easeTo({ center: [p.lng, p.lat], zoom: 15 }); return; }
      if (state.searcher) { search(text); return; }
      say(`${NO_SEARCH} Paste coordinates or a map link, or click the map.`);
    });
  }

  // Show an item on the map for the person who asked (a view: only their own page does it). The request waits for the page to
  // have started, and the item must be one that has a place.
  let startedResolve;
  const startedPromise = new Promise((r) => { startedResolve = r; });
  if (tavern.actions && tavern.actions.provide) {
    tavern.actions.provide({
      showOnMap: async (input) => {
        await startedPromise;
        const id = tavern.util.refKey(input.ref);
        if (!state.items.some((c) => cardId(c) === id)) { await loadItems(); render(); }
        if (!state.items.some((c) => cardId(c) === id)) throw new Error('that place is not on the map');
        if (state.mapReady) select(id); else state.openWanted = id;
        return {};
      },
    });
  }

  // Asked to show an item on the map (the map shows what has a place): select it when it is there.
  if (tavern.refs && tavern.refs.onOpen) {
    tavern.refs.onOpen((ref) => {
      const id = tavern.util.refKey(ref);
      if (state.mapReady) select(state.items.some((c) => cardId(c) === id) ? id : null); else state.openWanted = id;
    });
  }

  tavern.on('theme', () => {
    if (!state.map || !state.mapReady) return;
    if (!state.tileUrls) return;
    state.map.setStyle(buildStyle(tokens(), { tiles: state.tileUrls, glyphs: `${location.origin}/maps-glyphs/{fontstack}/{range}.pbf` }));
  });

  function applySettings(next) {
    // The map files chosen (a list; a single name from before is one file).
    // From this server's files (a list; a single name from before is one file), or one file at an https web address.
    let files = (Array.isArray(next.map) ? next.map : next.map ? [next.map] : []).slice(0, 20);
    let web = false;
    if (next.mapSource === 'web') {
      web = true;
      files = typeof next.mapUrl === 'string' && /^https:\/\//i.test(next.mapUrl) ? [next.mapUrl] : [];
    }
    const mapChanged = files.join('|') !== state.settings.maps.join('|') || web !== state.settings.web;
    state.settings = { maps: files, web };
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
    startedResolve();
    await startMap();
  } catch (err) {
    $('app').hidden = true;
    $('msg').hidden = false;
    $('msg').textContent = 'The map could not load: ' + err.message;
  }
})();
