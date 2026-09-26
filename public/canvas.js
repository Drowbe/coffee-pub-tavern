// The canvas of a space: the Modules button and its menu, and every module the space has
// open on it. A module is either an installed one (a sandboxed frame driven by module-host.js)
// or a built-in one, the conference and the chat. Both work the same way and can be shown
// three ways:
//
//   docked   as a column of the space's grid: conference, chat, module...
//   floating as a draggable, resizable box over the call
//   window   as a window of its own
//
// A module's manifest says which of docked and floating it supports (both, if it
// does not say); every module can be popped into a window. Modules follow the call
// when it is popped out: they open in whichever window the canvas is in.
// See documentation/architecture/architecture-canvas.md.

import { api, markModuleRead, followTheme } from '/brand.js';
import { mountModule } from '/module-host.js';

// What each space remembers (`app.canvas.<space>`; brand.js moves the old `app.panels` keys): the modules open when the person last used it,
// and each module's mode and sizes. `app.canvas` alone is what earlier versions kept for all
// spaces, and is the starting point for a space with nothing saved yet.
const STORE_KEY = 'app.canvas';
const storeKey = (spaceId) => `${STORE_KEY}.${spaceId}`;
const MIN_W = 240;
const MIN_H = 160;
const HEAD_H = 42; // the shared module header height (--module-header-h in style.css)
const DOCK_MIN = 240;
const VIDEO_MIN = 280; // the flexible column always keeps at least this much of the canvas

function readStore(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function loadSaved(spaceId) {
  const own = spaceId ? readStore(storeKey(spaceId)) : null;
  if (own) return own;
  const { __open, ...rest } = readStore(STORE_KEY) || {};
  return rest;
}

// The modules a space opens with (ids, in order), or null when nothing is remembered yet. The space
// list's "Join with" choice reads and writes this.
export function joinModules(spaceId) {
  const open = loadSaved(spaceId).__open;
  return Array.isArray(open) ? open : null;
}

export function setJoinModules(spaceId, ids) {
  const saved = loadSaved(spaceId);
  saved.__open = ids;
  try {
    localStorage.setItem(storeKey(spaceId), JSON.stringify(saved));
  } catch {
    // private mode: nothing is remembered
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// The buttons at the end of every module's header: switch between docked and
// floating, open in a window, close.
const toolsHtml = ({ mode, canDock, canFloat, closable = true, snap = false }) => `
  ${mode === 'float' ? `<button class="msg-btn${snap ? ' on' : ''}" data-snap type="button" title="Snap to a grid" aria-label="Snap to a grid" aria-pressed="${snap ? 'true' : 'false'}"><i class="fa-solid fa-border-all fa-fw" aria-hidden="true"></i></button>` : ''}
  ${mode !== 'float' && canFloat ? '<button class="msg-btn" data-mode="float" type="button" title="Float over the call" aria-label="Float over the call"><i class="fa-regular fa-window-restore fa-fw" aria-hidden="true"></i></button>' : ''}
  ${mode !== 'dock' && canDock ? '<button class="msg-btn" data-mode="dock" type="button" title="Dock beside the video" aria-label="Dock beside the video"><i class="fa-solid fa-table-columns fa-fw" aria-hidden="true"></i></button>' : ''}
  ${mode !== 'window' ? '<button class="msg-btn" data-popout type="button" title="Open in its own window" aria-label="Open in its own window"><i class="fa-solid fa-up-right-from-square fa-fw" aria-hidden="true"></i></button>' : ''}
  ${closable ? '<button class="msg-btn" data-close type="button" title="Close" aria-label="Close"><i class="fa-solid fa-xmark fa-fw" aria-hidden="true"></i></button>' : ''}`;

export function createCanvas({ guestToken = null } = {}) {
  const toggle = document.getElementById('modules-toggle');
  const menu = document.getElementById('modules-menu');
  // An inline menu (the module buttons sit in a bar in the space header) is always shown: it is never hidden
  // or positioned by this file, only kept up to date.
  const inline = () => Boolean(menu && menu.classList.contains('subnav-modules'));
  const canvas = document.getElementById('canvas');
  let saved = loadSaved(null);
  // Nothing is remembered until a join has restored the space's modules, and not while the space is
  // being torn down: closing every module on the way out must not become the layout.
  let suspended = true;
  const opened = new Map(); // id -> module; a module is open while it is in here
  const builtins = new Map(); // id -> the built-in module's definition (the conference and the chat)
  const canvasEmpty = document.getElementById('canvas-empty');
  let spaceId = null;
  let available = [];
  let z = 40;
  let order = 0;
  let unread = {}; // module id -> unread notifications, from brand.js
  const builtinUnread = {}; // built-in module id -> unread count (the chat's messages)

  const canvasDoc = () => canvas.ownerDocument;
  const canvasWin = () => canvasDoc().defaultView || window;

  // A layer for floating modules in whichever window the call is in.
  const layers = new WeakMap();
  function layerFor(doc) {
    let layer = layers.get(doc);
    if (!layer) {
      layer = doc.createElement('div');
      layer.id = 'module-layer';
      layer.className = 'module-layer';
      doc.body.appendChild(layer);
      layers.set(doc, layer);
    }
    return layer;
  }
  // Floating modules live in their own layer, a sibling of the canvas, so hiding the canvas (space.js's
  // own space-list view, shown while still connected but not looking at this space) does not hide them
  // on its own -- without this they go on floating over whatever the space shows instead. Nothing is
  // torn down: the same modules reappear exactly as they were once the canvas comes back.
  function showFloating(show) {
    const layer = layers.get(canvasDoc());
    if (layer) layer.hidden = !show;
  }

  const supports = (p, mode) => (p.modes || ['dock', 'float']).includes(mode);

  // A narrow canvas has no room for a column.
  function isNarrow() {
    const w = canvas.clientWidth;
    return w > 0 ? w < 640 : canvas.classList.contains('narrow');
  }

  function persist() {
    if (!spaceId) return; // an aside remembers nothing
    try {
      localStorage.setItem(storeKey(spaceId), JSON.stringify(saved));
    } catch {
      // private mode: modules still work, they just do not remember where they were
    }
  }

  // The modules open now, in column order.
  // A join that was asked to open one item (from the dashboard) opens just that module, once, and does not
  // become the space's remembered layout: nothing is saved until the person opens or closes a module themselves.
  let openRequest = null;
  let keepLayout = false;
  let restoring = false;
  function snapshot() {
    if (suspended || !spaceId || keepLayout) return;
    saved.__open = [...opened.values()].sort((a, b) => a.order - b.order).map((p) => p.id);
    persist();
  }

  function remember(id, patch) {
    saved[id] = { ...(saved[id] || {}), ...patch };
    persist();
  }

  // --- floating: place, drag, resize ----------------------------------------

  function clampBox(box, win) {
    const maxW = Math.max(MIN_W, win.innerWidth - 16);
    const maxH = Math.max(MIN_H, win.innerHeight - 16);
    const w = Math.min(Math.max(box.w, MIN_W), maxW);
    const h = Math.min(Math.max(box.h, MIN_H), maxH);
    const x = Math.min(Math.max(box.x, 0), Math.max(0, win.innerWidth - w));
    const y = Math.min(Math.max(box.y, 0), Math.max(0, win.innerHeight - h));
    return { x, y, w, h };
  }

  function place(floater, box) {
    const win = floater.ownerDocument.defaultView || window;
    const b = clampBox(box, win);
    floater.style.left = `${b.x}px`;
    floater.style.top = `${b.y}px`;
    floater.style.width = `${b.w}px`;
    floater.style.height = `${b.h}px`;
    return b;
  }

  const currentBox = (floater) => ({ x: floater.offsetLeft, y: floater.offsetTop, w: floater.offsetWidth, h: floater.offsetHeight });
  const front = (floater) => { floater.style.zIndex = String(++z); };

  // --- snap: a floating module can snap to a grid over the canvas --------------
  // Floating is free by default (anywhere, any size). A module with `snap` on sits in the cells of a grid laid over
  // the canvas instead: dragged, it jumps from cell to cell; resized, it grows a cell at a time; and what is
  // remembered is its cells (`cell`: col, row, cols, rows), so it keeps its place in the grid when the window
  // changes size. The grid is as many cells of about SNAP_CELL as the canvas fits (never fewer than one), gutter
  // SNAP_GAP, drawn (`.snap-grid`) only while a snapped module is being dragged. Docked and window are untouched.
  // The grid's pitch (a cell's width; a cell is 0.77 as tall) is the canvas's: the space bar's slider sets it, remembered with
  // the space's layout (`__snap.pitch`), beside the canvas-level switch (`__snap.all`) that snaps every floating module, now and later.
  const SNAP_PITCH = { min: 60, max: 320, step: 10, default: 130 };
  const SNAP_GAP = 16; // the same 16px clampBox keeps clear of the window's edges, so a module spanning every cell still fits the grid
  const snapPitch = () => { const p = Number(saved.__snap?.pitch); return p >= SNAP_PITCH.min && p <= SNAP_PITCH.max ? p : SNAP_PITCH.default; };
  const snapAllOn = () => Boolean(saved.__snap?.all);
  const snapping = (id) => snapAllOn() || Boolean(saved[id]?.snap);
  function snapGrid() {
    const win = canvasWin();
    const r = canvas.getBoundingClientRect();
    const s = r.width > 0 && r.height > 0 ? r : { left: 0, top: 0, width: win.innerWidth, height: win.innerHeight };
    const pitch = snapPitch();
    const cols = Math.max(1, Math.floor(s.width / pitch));
    const rows = Math.max(1, Math.floor(s.height / (pitch * 0.77)));
    return { x: s.left, y: s.top, w: s.width, h: s.height, cols, rows, cw: s.width / cols, ch: s.height / rows };
  }
  // The box a run of cells makes, and the run of cells a box is nearest to (never fewer cells than a module's smallest size needs).
  const cellBox = (g, c) => ({ x: g.x + c.col * g.cw + SNAP_GAP / 2, y: g.y + c.row * g.ch + SNAP_GAP / 2, w: c.cols * g.cw - SNAP_GAP, h: c.rows * g.ch - SNAP_GAP });
  function snapCell(g, box) {
    const leastCols = Math.min(g.cols, Math.ceil((MIN_W + SNAP_GAP) / g.cw));
    const leastRows = Math.min(g.rows, Math.ceil((MIN_H + SNAP_GAP) / g.ch));
    const cols = Math.max(leastCols, Math.min(g.cols, Math.round((box.w + SNAP_GAP) / g.cw)));
    const rows = Math.max(leastRows, Math.min(g.rows, Math.round((box.h + SNAP_GAP) / g.ch)));
    const col = Math.max(0, Math.min(g.cols - cols, Math.round((box.x - g.x) / g.cw)));
    const row = Math.max(0, Math.min(g.rows - rows, Math.round((box.y - g.y) / g.ch)));
    return { col, row, cols, rows };
  }
  // Put a snapped module in its cells (its remembered ones, or the ones nearest its box) and remember both.
  function settleSnap(id, floater, cell) {
    const g = snapGrid();
    const c = cell || snapCell(g, currentBox(floater));
    const box = place(floater, cellBox(g, c));
    remember(id, { cell: c, box });
    return box;
  }
  // The grid, drawn in the layer while a snapped module moves.
  function showGrid(layer, g) {
    let grid = layer.querySelector('.snap-grid');
    if (!grid) {
      grid = layer.ownerDocument.createElement('div');
      grid.className = 'snap-grid';
      layer.appendChild(grid);
    }
    grid.style.left = `${g.x}px`;
    grid.style.top = `${g.y}px`;
    grid.style.width = `${g.w}px`;
    grid.style.height = `${g.h}px`;
    grid.style.setProperty('--snap-cw', `${g.cw}px`);
    grid.style.setProperty('--snap-ch', `${g.ch}px`);
    layer.classList.add('snapping');
  }
  const hideGrid = (layer) => layer.classList.remove('snapping');
  // The box a module floats in (an installed module's is its own element; a built-in module's is around it).
  const floaterOf = (mod) => (mod.kind === 'builtin' ? mod.floatEl : mod.mode === 'float' ? mod.el : null);
  function setSnap(id, on) {
    const mod = opened.get(id);
    const floater = mod && floaterOf(mod);
    if (!floater) return;
    remember(id, { snap: Boolean(on) });
    if (on) settleSnap(id, floater);
    for (const b of [mod.el, floater].flatMap((el) => [...(el?.querySelectorAll?.('[data-snap]') || [])])) {
      b.classList.toggle('on', Boolean(on));
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }
  // The canvas-level switch. On: every module that can float does -- the docked ones are floated first, their docked mode
  // remembered (`__snap.before`) -- and snaps, each one's own switch following; any module opened later floats and snaps too
  // (preferredMode, api_openBuiltin). Off: the modules that were docked when it went on go back to docked, the rest stay floating,
  // free again. A module on a narrow canvas (a phone) is left docked either way: it has no room to float.
  function setSnapAll(on) {
    const snap = saved.__snap || {};
    if (on) {
      const before = { ...(snap.before || {}) };
      for (const p of [...opened.values()]) {
        if (p.mode === 'dock' && supports(p, 'float') && !isNarrow()) { before[p.id] = 'dock'; setMode(p.id, 'float'); }
      }
      saved.__snap = { ...snap, all: true, before };
      persist();
      for (const p of opened.values()) if (floaterOf(p)) setSnap(p.id, true);
      return;
    }
    saved.__snap = { ...snap, all: false, before: {} };
    persist();
    for (const p of [...opened.values()]) if (floaterOf(p)) setSnap(p.id, false);
    for (const [id, mode] of Object.entries(snap.before || {})) {
      const p = opened.get(id);
      if (p && p.mode === 'float' && supports(p, mode)) setMode(id, mode);
    }
  }
  // The space bar's "dock all": every floating module that can be a column goes back beside the call. The canvas-level snap
  // goes off first (it would float a module again the moment it opened), with nothing remembered to restore, since docked is
  // where everything is now. A module in a window of its own, and one that can only float, are left alone.
  function dockAll() {
    if (snapAllOn()) {
      saved.__snap = { ...(saved.__snap || {}), all: false, before: {} };
      persist();
      for (const p of opened.values()) if (floaterOf(p)) setSnap(p.id, false);
    }
    for (const p of [...opened.values()]) if (p.mode === 'float' && supports(p, 'dock') && !isNarrow()) setMode(p.id, 'dock');
    update();
  }
  // The grid's size, from the space bar's slider: every snapped module refits to the cells nearest its box. While the slider
  // moves (`preview`) the grid shows, so the size can be seen; it hides when the slider is let go.
  function setSnapPitch(px, { preview = false } = {}) {
    const pitch = Math.min(SNAP_PITCH.max, Math.max(SNAP_PITCH.min, Math.round(Number(px) || SNAP_PITCH.default)));
    saved.__snap = { ...(saved.__snap || {}), pitch };
    persist();
    for (const p of opened.values()) { const floater = floaterOf(p); if (floater && snapping(p.id)) settleSnap(p.id, floater); }
    const layer = layerFor(canvasDoc());
    if (preview) showGrid(layer, snapGrid()); else hideGrid(layer);
  }

  // Drag a floating module by `handle`, resize it by `grip`. A snapped module moves and grows by whole cells.
  function wireFloating(id, floater, handle, grip) {
    const layer = floater.parentNode;
    let drag = null;
    const begin = (kind) => (event) => {
      if (event.target.closest('button, input, textarea, a')) return;
      event.preventDefault();
      drag = { kind, sx: event.clientX, sy: event.clientY, box: currentBox(floater), grid: snapping(id) ? snapGrid() : null };
      layer.classList.add('dragging'); // frames swallow pointer events; switch them off while dragging
      if (drag.grid) showGrid(layer, drag.grid);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    };
    const move = (event) => {
      if (!drag) return;
      const dx = event.clientX - drag.sx;
      const dy = event.clientY - drag.sy;
      const b = { ...drag.box };
      if (drag.kind === 'move') { b.x += dx; b.y += dy; } else { b.w += dx; b.h += dy; }
      place(floater, drag.grid ? cellBox(drag.grid, snapCell(drag.grid, b)) : b);
    };
    const end = () => {
      if (!drag) return;
      const g = drag.grid;
      drag = null;
      layer.classList.remove('dragging');
      hideGrid(layer);
      if (g) settleSnap(id, floater, snapCell(g, currentBox(floater)));
      else remember(id, { box: currentBox(floater) });
    };
    for (const [el, kind] of [[handle, 'move'], [grip, 'size']]) {
      el.addEventListener('pointerdown', begin(kind));
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    }
    floater.addEventListener('pointerdown', () => front(floater));
  }

  // --- docked: columns of the grid ------------------------------------------

  const dockedModules = () => [...opened.values()].filter((p) => p.mode === 'dock').sort((a, b) => a.order - b.order);

  const maxDock = () => Math.max(DOCK_MIN, Math.round(canvas.clientWidth * 0.6));
  const clampDock = (w) => Math.min(Math.max(Math.round(w), DOCK_MIN), maxDock());

  // Docked modules are the columns, in order: the conference, the chat, then modules. One
  // column is flexible and takes what is left: the conference when it is docked, else the
  // first docked module, so the canvas is never left with an empty column. The others keep
  // their widths. On a narrow canvas CSS takes over (see architecture-room-layout).
  function syncDock() {
    const docked = dockedModules();
    // The narrow layout keys off this, as it does off chat-open.
    canvas.classList.toggle('module-open', docked.some((p) => p.kind === 'module'));
    syncView();
    for (const p of opened.values()) p.el.classList?.remove('is-flex');
    for (const p of docked) for (const el of p.parts()) el.style.gridColumn = '';
    if (canvasEmpty) canvasEmpty.hidden = opened.size > 0;
    if (isNarrow() || !docked.length) {
      canvas.style.removeProperty('--canvas-cols');
      return;
    }
    const flex = docked.find((p) => p.def?.flex) || docked[0];
    flex.el.classList.add('is-flex');
    // The fixed columns together may not crowd the flexible one out: past that, they all shrink
    // in step (each module keeps the width it was given for when there is room again).
    const fixed = docked.filter((p) => p !== flex);
    const total = fixed.reduce((sum, p) => sum + p.width, 0);
    const spare = Math.max(DOCK_MIN, canvas.clientWidth - VIDEO_MIN);
    const ratio = total > spare ? spare / total : 1;
    canvas.style.setProperty('--canvas-cols', docked.map((p) => (p === flex ? 'minmax(0, 1fr)' : `${Math.max(160, Math.floor(p.width * ratio))}px`)).join(' '));
    docked.forEach((p, i) => { for (const el of p.parts()) el.style.gridColumn = String(1 + i); });
  }

  // When the fixed columns together are wider than the canvas allows, syncDock shows them squeezed in step
  // and the conference at its minimum. A drag would then change a stored width that is not what is on
  // screen, so the conference never moved. Called as a drag starts: each fixed module takes the width it is
  // showing, so the drag moves what the person sees (narrowing one gives the room to the conference).
  function settleDock() {
    const docked = dockedModules();
    if (isNarrow() || docked.length < 2) return;
    const flex = docked.find((p) => p.def?.flex) || docked[0];
    const fixed = docked.filter((p) => p !== flex);
    const total = fixed.reduce((sum, p) => sum + p.width, 0);
    const spare = Math.max(DOCK_MIN, canvas.clientWidth - VIDEO_MIN);
    if (total <= spare) return;
    const ratio = spare / total;
    for (const p of fixed) p.width = Math.max(160, Math.floor(p.width * ratio));
  }

  // Widening a column when there is no room left takes the width from the other fixed columns (each down to
  // its minimum), not by squeezing the one being dragged; the conference keeps what it has.
  function takeWidthFromOthers(mod) {
    const docked = dockedModules();
    if (isNarrow() || docked.length < 2) return;
    const flex = docked.find((p) => p.def?.flex) || docked[0];
    if (mod === flex) return;
    const fixed = docked.filter((p) => p !== flex);
    const others = fixed.filter((p) => p !== mod);
    let excess = fixed.reduce((sum, p) => sum + p.width, 0) - Math.max(DOCK_MIN, canvas.clientWidth - VIDEO_MIN);
    if (excess <= 0) return;
    const spare = others.reduce((sum, p) => sum + Math.max(0, p.width - 160), 0);
    if (spare <= 0) return;
    const take = Math.min(excess, spare);
    for (const p of others) p.width -= Math.round(take * (Math.max(0, p.width - 160) / spare));
  }

  // Reordering the columns: drag a docked module by its titlebar. The module's column follows the pointer as the others make way, so the
  // order is what the person sees; it is remembered with the layout. Buttons in the bar are left alone, and a press that does not move
  // is a click as before.
  function wireReorder(head, current) {
    if (!head || wired.has(head)) return;
    wired.add(head);
    head.classList.add('reorderable');
    let drag = null;
    head.addEventListener('pointerdown', (event) => {
      const mod = current();
      if (!mod || mod.mode !== 'dock' || isNarrow() || event.button !== 0 || event.target.closest('button, a, input, select, textarea, [data-close]')) return;
      drag = { id: event.pointerId, x: event.clientX, started: false };
    });
    head.addEventListener('pointermove', (event) => {
      const mod = current();
      if (!drag || event.pointerId !== drag.id || !mod) return;
      if (!drag.started) {
        if (Math.abs(event.clientX - drag.x) < 6) return;
        drag.started = true;
        head.setPointerCapture?.(event.pointerId);
        canvas.classList.add('reordering');
        for (const el of mod.parts()) el.classList.add('module-lifted');
      }
      const docked = dockedModules();
      const at = docked.indexOf(mod);
      const cols = getComputedStyle(canvas).gridTemplateColumns.split(' ').map(parseFloat);
      if (at < 0 || cols.length !== docked.length || cols.some((w) => !Number.isFinite(w))) return;
      // Where the pointer is among the other columns, as they would sit without this one: each other column's midpoint in that row.
      const others = docked.map((p, i) => ({ p, w: cols[i] })).filter((c) => c.p !== mod);
      let x = canvas.getBoundingClientRect().left;
      let target = 0;
      for (const c of others) {
        if (event.clientX > x + c.w / 2) target += 1;
        x += c.w;
      }
      if (target === at) return;
      const values = docked.map((p) => p.order).sort((a, b) => a - b);
      const next = others.map((c) => c.p);
      next.splice(target, 0, mod);
      next.forEach((p, i) => { p.order = values[i]; });
      syncDock();
      update();
    });
    const stop = (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const moved = drag.started;
      drag = null;
      if (!moved) return;
      canvas.classList.remove('reordering');
      for (const p of opened.values()) for (const el of p.parts()) el.classList.remove('module-lifted');
      // The release would otherwise count as a click on something in the bar.
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      head.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => head.removeEventListener('click', swallow, { capture: true }), 100);
    };
    head.addEventListener('pointerup', stop);
    head.addEventListener('pointercancel', stop);
  }

  // `current` returns the module the handle belongs to right now (a built-in module is a new object each time it opens).
  function wireDockResize(current, handle) {
    let drag = null;
    handle.addEventListener('pointerdown', (event) => {
      const mod = current();
      if (!mod) return;
      event.preventDefault();
      settleDock();
      drag = { sx: event.clientX, w: mod.width };
      handle.classList.add('dragging');
      canvas.classList.add('resizing-dock'); // frames swallow the pointer while dragging
      handle.setPointerCapture?.(event.pointerId);
    });
    handle.addEventListener('pointermove', (event) => {
      const mod = current();
      if (!drag || !mod) return;
      mod.width = clampDock(drag.w + (drag.sx - event.clientX)); // the column is on the right: dragging left widens it
      takeWidthFromOthers(mod);
      syncDock();
    });
    const stop = () => {
      const mod = current();
      if (!drag || !mod) return;
      drag = null;
      handle.classList.remove('dragging');
      canvas.classList.remove('resizing-dock');
      remember(mod.id, { dockW: mod.width });
      mod.onWidth?.(mod.width);
    };
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  }

  // --- installed modules -------------------------------------------------------

  const moduleHeader = (m, mode, canDock, canFloat, snap = false) => `
    <span class="mod-title"><i class="fa-solid fa-${escapeHtml(m.icon)} fa-fw" aria-hidden="true"></i> <span data-title>${escapeHtml(m.name)}</span></span>
    <span class="mod-header-tools"><span class="titlebar-custom" data-header-custom></span>${toolsHtml({ mode, canDock, canFloat, snap })}</span>`;

  // An installed module's place on the canvas: a frame for a sandboxed module, an element of its own for one that runs in the page.
  const holder = (m, cls) => (m.runMode === 'page'
    ? `<div class="module-root ${cls}" data-module-root="${escapeHtml(m.id)}"></div>`
    : `<iframe class="${cls}" title="${escapeHtml(m.name)}"></iframe>`);

  // onBar and onResize are wired the same way regardless of which mode a module opened in, and read
  // the module's *current* element and mode rather than the one it was mounted with (`mod.el`, `mod.mode`):
  // that is what lets moveModule, below, hand a mount that started in one mode on to the other without
  // remounting it. has-bar only styles the docked layout; onResize only remembers a size while floating.
  function mountFor(mod, frame, bar, extra = {}) {
    const m = mod.m;
    return mountModule({
      module: { id: m.id, version: m.version, scope: m.scope },
      ...(frame.tagName === 'IFRAME' ? { frame } : { container: frame }),
      bar,
      header: mod.el.querySelector('[data-header-custom]'),
      toolbar: mod.el.querySelector('[data-toolbar]'),
      onOpenRef: openRef,
      // A request for an action waits for the page of the module that carries it: open that module if it is on here.
      onOpenModule: (id) => { const target = available.find((x) => x.id === id); if (target && !opened.has(id)) openModule(target); },
      scope: 'space',
      spaceId,
      guestToken,
      entry: m.canvas.entry,
      onTitle: (title) => { mod.el.querySelector('[data-title]').textContent = title || m.name; },
      onBar: (has) => mod.el.classList.toggle('has-bar', has),
      onToolbar: (has) => mod.el.classList.toggle('has-toolbar', has),
      onResize: ({ width, height } = {}) => {
        if (mod.mode !== 'float') return;
        const b = currentBox(mod.el);
        if (Number.isFinite(width)) b.w = width;
        if (Number.isFinite(height)) b.h = height + HEAD_H;
        if (snapping(m.id)) { const g = snapGrid(); settleSnap(m.id, mod.el, snapCell(g, b)); return; }
        remember(m.id, { box: place(mod.el, b) });
      },
      ...extra,
    });
  }

  // `reuse` (from moveModule) carries a frame/container, bar, toolbar and header-buttons span already
  // mounted in the other mode's chrome: they are moved into the new chrome instead of built fresh, so the
  // module inside keeps running and keeps whatever it was holding (a conversation, a draft, ...) rather
  // than being torn down and started over. Only the class that lays each one out changes.
  function openModuleFloating(m, reuse) {
    const doc = canvasDoc();
    const floater = doc.createElement('section');
    floater.className = 'module-floating';
    floater.dataset.module = m.id;
    floater.innerHTML = `
      <header class="mod-header module-floating-head">${moduleHeader(m, 'float', supports({ modes: m.canvas.mode }, 'dock') && !isNarrow(), true, snapping(m.id))}</header>
      <div class="mod-toolbar" data-toolbar hidden></div>
      ${reuse ? '<div class="reuse-slot frame-slot"></div>' : holder(m, 'module-floating-frame')}
      <div class="module-floating-bar" hidden></div>
      <span class="module-floating-grip" title="Drag to resize"></span>`;
    layerFor(doc).appendChild(floater);
    const index = [...opened.values()].filter((p) => p.mode === 'float').length;
    const win = canvasWin();
    place(floater, saved[m.id]?.box || {
      w: m.canvas.width,
      h: m.canvas.height + HEAD_H,
      x: win.innerWidth - m.canvas.width - 24 - index * 28,
      y: 70 + index * 28,
    });
    if (snapping(m.id)) settleSnap(m.id, floater, saved[m.id]?.cell);
    front(floater);
    const mod = { id: m.id, kind: 'module', mode: 'float', m, el: floater, modes: m.canvas.mode, order: ++order, parts: () => [] };
    if (reuse) {
      reuse.frame.className = reuse.frame.classList.contains('module-root') ? 'module-root module-floating-frame' : 'module-floating-frame';
      floater.querySelector('.frame-slot').replaceWith(reuse.frame);
      reuse.bar.className = 'module-floating-bar';
      floater.querySelector('.module-floating-bar').replaceWith(reuse.bar);
      floater.querySelector('[data-header-custom]').replaceWith(reuse.headerCustom);
      floater.querySelector('[data-toolbar]').replaceWith(reuse.toolbar);
      mod.mount = reuse.mount;
    } else {
      mod.mount = mountFor(mod, floater.querySelector('iframe, .module-root'), floater.querySelector('.module-floating-bar'));
    }
    opened.set(m.id, mod);
    wireFloating(m.id, floater, floater.querySelector('.module-floating-head'), floater.querySelector('.module-floating-grip'));
    wireHeader(floater, mod);
  }

  function openModuleDocked(m, reuse) {
    const doc = canvasDoc();
    const section = doc.createElement('section');
    section.className = 'module module-docked';
    section.dataset.module = m.id;
    section.innerHTML = `
      <div class="dock-resize" title="Drag to resize"></div>
      <div class="mod-content dock-content">
        <header class="mod-header">${moduleHeader(m, 'dock', false, true)}</header>
        <div class="mod-toolbar" data-toolbar hidden></div>
        ${reuse ? '<div class="reuse-slot frame-slot"></div>' : holder(m, 'dock-frame')}
      </div>
      <div class="mod-bar dock-bar" hidden></div>`;
    canvas.appendChild(section);
    const mod = {
      id: m.id, kind: 'module', mode: 'dock', m, el: section, modes: m.canvas.mode, order: ++order,
      width: clampDock(saved[m.id]?.dockW || m.canvas.width),
      parts: () => [...section.children],
    };
    if (reuse) {
      reuse.frame.className = reuse.frame.classList.contains('module-root') ? 'module-root dock-frame' : 'dock-frame';
      section.querySelector('.frame-slot').replaceWith(reuse.frame);
      reuse.bar.className = 'mod-bar dock-bar';
      section.querySelector('.dock-bar').replaceWith(reuse.bar);
      section.querySelector('[data-header-custom]').replaceWith(reuse.headerCustom);
      section.querySelector('[data-toolbar]').replaceWith(reuse.toolbar);
      mod.mount = reuse.mount;
      // The bar's own onBar callback only fires on the next change; a bar or toolbar already showing needs this now.
      section.classList.toggle('has-bar', !reuse.bar.hidden);
      section.classList.toggle('has-toolbar', !reuse.toolbar.hidden);
    } else {
      // With a bar the module's content stops above the shared bottom row; without one it fills the column.
      mod.mount = mountFor(mod, section.querySelector('iframe, .module-root'), section.querySelector('.dock-bar'));
    }
    opened.set(m.id, mod);
    syncDock();
    wireDockResize(() => mod, section.querySelector('.dock-resize'));
    wireHeader(section, mod);
    wireReorder(section.querySelector('.mod-header'), () => opened.get(m.id));
  }

  // Switch an installed module between docked and floating without the module inside noticing: pull its frame
  // (or in-page container), its action bar, toolbar and header buttons out of the old chrome and into the
  // new one, then drop the emptied-out old chrome. Leaving for a window is a real new page, so that keeps
  // going through closeModule + popOut instead (see setMode).
  function moveModule(id, mode) {
    const mod = opened.get(id);
    const m = mod.m;
    const reuse = {
      frame: mod.el.querySelector('iframe, .module-root'),
      bar: mod.el.querySelector('.dock-bar, .module-floating-bar'),
      headerCustom: mod.el.querySelector('[data-header-custom]'),
      toolbar: mod.el.querySelector('[data-toolbar]'),
      mount: mod.mount,
    };
    const titleText = mod.el.querySelector('[data-title]')?.textContent || '';
    const old = mod.el;
    opened.delete(id);
    if (mode === 'dock') openModuleDocked(m, reuse); else openModuleFloating(m, reuse);
    old.remove();
    if (titleText) opened.get(id).el.querySelector('[data-title]').textContent = titleText;
  }

  // --- built-in modules (the conference and the chat) ---------------------------
  // The module's DOM already exists in the page; moving it between the canvas's grid,
  // a floating box and a window keeps everything wired to it (a node moved to
  // another document keeps its listeners).

  const wired = new WeakSet();

  // `opts.moving`: the module is only changing where it is shown, not opening or closing, so
  // its owner (the conference: a call) is told not to start or stop anything.
  function openBuiltinIn(def, mode, opts = {}) {
    if (def.allowed && !def.allowed()) return false;
    if (mode !== 'dock' && def.modes && !def.modes.includes(mode)) mode = 'dock';
    if (mode === 'window') return openBuiltinWindow(def, opts);
    const doc = canvasDoc();
    const el = def.el;
    const mod = {
      id: def.id, kind: 'builtin', mode, def, el, modes: def.modes || ['dock', 'float'], order: def.order,
      width: clampDock(saved[def.id]?.dockW || def.width || 320),
      onWidth: def.onWidth,
      parts: () => [...el.children],
    };
    if (mode === 'dock') {
      canvas.appendChild(el);
      el.hidden = false;
      const handle = el.querySelector('.chat-resize');
      if (handle && !wired.has(handle)) {
        wired.add(handle);
        wireDockResize(() => opened.get(def.id), handle);
      }
      wireReorder(el.querySelector('header'), () => opened.get(def.id));
    } else {
      const floater = doc.createElement('section');
      floater.className = `module-floating builtin-floating ${def.id}-floating`;
      floater.dataset.module = def.id;
      floater.appendChild(wrapFor(def, el, doc));
      const grip = doc.createElement('span');
      grip.className = 'module-floating-grip';
      grip.title = 'Drag to resize';
      floater.appendChild(grip);
      layerFor(doc).appendChild(floater);
      el.hidden = false;
      const size = def.floatSize || { w: 340, h: 480 };
      place(floater, saved[def.id]?.box || { ...size, x: Math.max(8, canvasWin().innerWidth - size.w - 24), y: 70 });
      if (snapping(def.id)) settleSnap(def.id, floater, saved[def.id]?.cell);
      front(floater);
      mod.floatEl = floater;
      wireFloating(def.id, floater, el.querySelector('header'), grip);
    }
    opened.set(def.id, mod);
    syncDock();
    decorateBuiltin(mod);
    def.onChange?.({ open: true, mode, moving: opts.moving });
    update();
    return true;
  }

  // The conference's tiles are styled by an ancestor `.canvas`, so out of the canvas's grid it
  // needs one of its own (`def.wrap` is its class); the chat needs nothing.
  function wrapFor(def, el, doc) {
    if (!def.wrap) return el;
    const wrap = doc.createElement('div');
    wrap.className = def.wrap;
    wrap.appendChild(el);
    return wrap;
  }

  // Add (or refresh) the mode buttons in the module's own header.
  function decorateBuiltin(mod) {
    const tools = mod.el.querySelector('.chat-tools, .conference-tools');
    if (!tools) return;
    tools.querySelectorAll('[data-mode], [data-popout]').forEach((b) => b.remove());
    const holder = tools.ownerDocument.createElement('span');
    tools.querySelectorAll('[data-snap]').forEach((b) => b.remove());
    holder.innerHTML = toolsHtml({ mode: mod.mode, canDock: true, canFloat: mod.modes.includes('float'), closable: false, snap: snapping(mod.id) });
    const close = tools.querySelector('#chat-close, [data-module-close]');
    for (const b of [...holder.children]) tools.insertBefore(b, close);
    for (const b of tools.querySelectorAll('[data-mode], [data-popout]')) {
      b.onclick = (event) => {
        event.stopPropagation();
        setMode(mod.id, b.dataset.mode || 'window');
      };
    }
    for (const b of tools.querySelectorAll('[data-snap]')) {
      b.onclick = (event) => {
        event.stopPropagation();
        setSnap(mod.id, !snapping(mod.id));
      };
    }
  }

  function openBuiltinWindow(def, opts = {}) {
    const size = saved[def.id]?.win || def.windowSize || { w: 380, h: 520 };
    const win = window.open('/popout.html', `app-${def.id}`, `popup,width=${size.w},height=${size.h}`);
    if (!win) return false;
    const mod = { id: def.id, kind: 'builtin', mode: 'window', def, el: def.el, win, modes: def.modes || ['dock', 'float'], order: def.order, parts: () => [] };
    opened.set(def.id, mod);
    const setup = () => {
      win.document.title = def.name;
      for (const sheet of document.querySelectorAll('link[rel="stylesheet"]')) win.document.head.appendChild(sheet.cloneNode(true));
      followTheme(win.document); // light or dark, and a changed theme, follow the call page's (brand.js)
      win.document.body.className = def.windowClass || 'chat-window';
      const grid = def.wrap ? wrapFor(def, def.el, win.document) : win.document.createElement('div');
      if (!def.wrap) {
        grid.className = 'chat-window-grid';
        grid.appendChild(def.el);
      }
      win.document.body.appendChild(grid);
      def.el.hidden = false;
      decorateBuiltin(mod);
      def.onWindow?.(win);
      // Popups the chat opens (emoji, formatting help) close on a click elsewhere.
      win.document.addEventListener('click', (e) => {
        for (const id of ['chat-help-popup', 'chat-emoji-popup', 'chat-command-menu']) {
          const p = win.document.getElementById(id);
          if (p && !p.hidden && !e.target.closest(`#${id}`) && !e.target.closest('#chat-help, #chat-emoji, #chat-command')) p.hidden = true;
        }
      });
      win.addEventListener('resize', () => {
        remember(def.id, { win: { w: win.innerWidth, h: win.innerHeight } });
        def.onWindowResize?.(win);
      });
      def.onChange?.({ open: true, mode: 'window', moving: opts.moving });
      update();
    };
    win.addEventListener('load', () => {
      setup();
      // Closing the window brings the module back into the page, in the mode it had before it left (docked or
      // floating), with whatever it holds untouched: a call keeps going, a chat keeps its draft. Closing the
      // window is not closing the module; a call is left with Hang up, a chat with its own close. Registered
      // only once the window has loaded: the blank page it starts as also fires pagehide, when it navigates
      // to the real one, and that must not count as the person closing it. The module the app closed itself
      // (closeBuiltin) is already gone from `opened` by the time its window's pagehide fires, so it stays closed.
      win.addEventListener('pagehide', () => {
        if (opened.get(def.id) !== mod) return;
        canvas.appendChild(def.el);
        def.el.hidden = true;
        def.el.classList.remove('is-flex');
        opened.delete(def.id);
        const back = saved[def.id]?.mode === 'float' && supports(mod, 'float') && !isNarrow() ? 'float' : 'dock';
        if (!openBuiltinIn(def, back, { moving: true })) {
          syncDock();
          def.onChange?.({ open: false, mode: 'window' });
        }
        update();
      });
    }, { once: true });
    return true;
  }

  function closeBuiltin(id, opts = {}) {
    const mod = opened.get(id);
    if (!mod) return;
    if (!restoring) keepLayout = false;
    const def = mod.def;
    opened.delete(id);
    if (mod.floatEl) mod.floatEl.remove();
    canvas.appendChild(def.el); // home again, before a window goes and takes it along
    def.el.hidden = true;
    def.el.classList.remove('is-flex');
    for (const el of def.el.children) el.style.gridColumn = '';
    if (mod.mode === 'window') mod.win.close();
    syncDock();
    def.onChange?.({ open: false, mode: mod.mode, moving: opts.moving });
    update();
  }

  // --- opening, closing, switching -------------------------------------------

  function preferredMode(p) {
    const want = saved[p.id]?.mode;
    // A phone shows one module at a time, docked below the conference strip like the chat; a module that cannot dock floats.
    if (isNarrow()) return supports(p, 'dock') ? 'dock' : 'float';
    if (snapAllOn() && supports(p, 'float')) return 'float'; // the canvas-level snap: every module that can float does, snapped
    if (want && supports(p, want)) return want;
    return supports(p, 'dock') ? 'dock' : 'float';
  }

  // On a narrow canvas (a phone) one view is shown at a time: the conference, the chat or a module. The others
  // stay open, only hidden, so the call keeps running (its microphone and camera as they were) while you read
  // the chat; a tab switches the view and never closes anything. `view` is the id being shown.
  let view = null;
  function syncView() {
    const narrow = isNarrow();
    const shown = [...opened.values()].filter((p) => p.mode === 'dock').map((p) => p.id);
    // With no conference (the admin turned it off), the chat is the view to start on.
    if (narrow && !shown.includes(view)) view = shown.includes('conference') ? 'conference' : shown.includes('chat') ? 'chat' : shown[shown.length - 1] || null;
    for (const p of opened.values()) {
      if (p.mode !== 'dock') continue;
      const hide = narrow && p.id !== view;
      for (const el of p.parts()) el.classList.toggle('narrow-hidden', hide);
    }
  }
  function setView(id) {
    if (!opened.has(id)) return;
    const mod = opened.get(id);
    if (mod.mode !== 'dock') {
      if (mod.el.classList && mod.mode === 'float') front(mod.el);
      return;
    }
    view = id;
    syncView();
    if (mod.kind === 'module') markModuleRead(id);
    update();
  }

  function openModule(m, mode) {
    if (!restoring) keepLayout = false;
    const p = { id: m.id, modes: m.canvas.mode, kind: 'module' };
    if (opened.has(m.id)) {
      const mod = opened.get(m.id);
      if (mod.mode === 'float') front(mod.el);
      return;
    }
    if (isNarrow()) view = m.id;
    mode ||= preferredMode(p);
    if (mode === 'dock' && !supports(p, 'dock')) mode = 'float';
    if (mode === 'dock') openModuleDocked(m); else openModuleFloating(m);
    markModuleRead(m.id);
    update();
  }

  // Show an item in the module that owns it, here: open its module (if it is on in this space) and hand it
  // the pointer, which its own code turns into showing the item. the host knows nothing about the item.
  function openRef(ref) {
    const m = available.find((x) => x.id === ref.module);
    if (!m) return false;
    if (!opened.has(m.id)) openModule(m);
    const mod = opened.get(m.id);
    if (!mod || !mod.mount) return false;
    if (mod.mode === 'float') front(mod.el);
    mod.mount.deliver('objectopen', { ref });
    return true;
  }

  function closeModule(id) {
    const mod = opened.get(id);
    if (!mod) return;
    if (!restoring) keepLayout = false;
    if (mod.kind === 'builtin') return closeBuiltin(id);
    mod.mount.destroy();
    mod.el.remove();
    opened.delete(id);
    syncDock();
    update();
  }

  function closeAllModules() {
    for (const p of [...opened.values()]) if (p.kind === 'module') closeModule(p.id);
    if (menu && !inline()) menu.hidden = true;
  }

  function setMode(id, mode) {
    const mod = opened.get(id);
    if (!mod || mod.mode === mode) return;
    if (mod.kind === 'builtin') {
      const def = mod.def;
      const before = mod.mode;
      closeBuiltin(id, { moving: true });
      if (mode !== 'window') remember(id, { mode });
      // A window the browser refuses to open must not leave the module closed.
      if (!openBuiltinIn(def, mode, { moving: true })) openBuiltinIn(def, before, { moving: true });
      return;
    }
    if (mode !== 'window' && !supports(mod, mode)) return;
    const m = mod.m;
    if (mode === 'window') { closeModule(id); return popOut(m.id); }
    remember(id, { mode });
    moveModule(id, mode);
    markModuleRead(m.id);
    update();
  }

  // A module's own window: the same page a server page uses, in this space's scope.
  const windows = new Map();
  function popOut(id) {
    const mod = opened.get(id);
    const m = mod?.m || available.find((x) => x.id === id);
    if (!m) return;
    const q = new URLSearchParams({ space: spaceId, popout: '1' });
    if (guestToken) q.set('guest', guestToken);
    const width = Math.max(320, Math.min(m.canvas.width, screen.availWidth));
    const height = Math.max(240, Math.min(m.canvas.height + HEAD_H, screen.availHeight));
    const win = window.open(`/modules/${encodeURIComponent(m.id)}?${q}`, `app-module-${m.id}`, `popup,width=${width},height=${height}`);
    if (!win) return;
    windows.set(m.id, win);
    if (mod) closeModule(m.id);
  }

  function wireHeader(el, mod) {
    el.querySelector('[data-close]').addEventListener('click', () => closeModule(mod.id));
    el.querySelector('[data-popout]').addEventListener('click', () => popOut(mod.id));
    el.querySelector('[data-mode]')?.addEventListener('click', (event) => setMode(mod.id, event.currentTarget.dataset.mode));
    el.querySelector('[data-snap]')?.addEventListener('click', () => setSnap(mod.id, !snapping(mod.id)));
  }

  // The call moved to (or came back from) a window of its own. Module frames cannot
  // move between windows without reloading, and a frame's messages arrive in the
  // window it lives in, so each open module is opened again in the canvas's new
  // window, the same way it was. A floating chat is carried over; a docked one is
  // inside the canvas and goes with it.
  function canvasPopped() {
    suspended = true; // closing and reopening the modules is not a change of layout
    const doc = canvasDoc();
    const again = [...opened.values()].filter((p) => p.kind === 'module').map((p) => ({ m: p.m, mode: p.mode }));
    for (const { m } of again) closeModule(m.id);
    for (const p of opened.values()) {
      if (p.kind === 'builtin' && p.mode === 'float' && p.floatEl) {
        layerFor(doc).appendChild(p.floatEl);
        place(p.floatEl, currentBox(p.floatEl));
      }
    }
    bindDoc(doc);
    for (const { m, mode } of again) openModule(m, isNarrow() ? undefined : mode);
    suspended = false;
    syncDock();
    snapshot();
  }

  // Open the space's remembered modules: what was open when it was last used, or just the
  // conference for a space not used before.
  function restore() {
    suspended = true;
    restoring = true;
    // A pending request to open one item wins, when the module is on for this space and the request is fresh.
    const request = openRequest && Date.now() - openRequest.at < 20000 && available.some((x) => x.id === openRequest.module) ? openRequest : null;
    openRequest = null;
    keepLayout = Boolean(request);
    // A space not used before opens on the conference, or on the chat when the conference is off on this server.
    const noConference = builtins.has('conference') && builtins.get('conference').allowed && !builtins.get('conference').allowed();
    const want = request ? [request.module] : Array.isArray(saved.__open) ? saved.__open : [noConference ? 'chat' : 'conference'];
    for (const id of want) {
      if (builtins.has(id)) api_openBuiltin(id);
      else {
        const m = available.find((x) => x.id === id);
        if (m) openModule(m);
      }
    }
    // The remembered order is the column order, for the built-in modules as well as the installed ones.
    if (!request) {
      const docked = dockedModules();
      const sequence = want.map((id) => opened.get(id)).filter((p) => p && p.mode === 'dock');
      if (sequence.length === docked.length) {
        const values = docked.map((p) => p.order).sort((a, b) => a - b);
        sequence.forEach((p, i) => { p.order = values[i]; });
      }
    }
    // On a phone the call is the view to start on, whatever was opened last.
    if (isNarrow() && opened.has('conference')) view = 'conference';
    restoring = false;
    suspended = false;
    syncDock();
    update();
    snapshot();
    if (request) openRef(request.ref);
  }

  // --- the toolbar button and its menu --------------------------------------

  // The one place to show and hide modules: the chat first, then the space's modules.
  function update() {
    const total = available.reduce((sum, m) => sum + (unread[m.id] || 0), 0)
      + [...builtins.keys()].reduce((sum, id) => sum + (opened.has(id) ? 0 : builtinUnread[id] || 0), 0);
    const badge = toggle?.querySelector('.badge');
    if (badge) {
      badge.hidden = total === 0;
      badge.textContent = total > 9 ? '9+' : String(total);
    }
    snapshot();
    toggle?.classList.toggle('on', [...opened.keys()].some((id) => id !== 'conference'));
    if (canvasEmpty) canvasEmpty.hidden = opened.size > 0;
    if (!menu) return;
    menu.innerHTML = '';
    for (const def of [...builtins.values()].sort((a, b) => a.order - b.order)) {
      if (def.allowed && !def.allowed()) continue;
      const open = opened.has(def.id);
      const b = menu.ownerDocument.createElement('button');
      b.type = 'button';
      b.className = 'modules-menu-item';
      b.dataset.builtin = def.id;
      // On a phone the highlighted tab is the view being shown, not just an open module.
      b.classList.toggle('on', isNarrow() && open ? view === def.id : open);
      // The call is on: the phone's tab bar marks it, since the conference can be hidden while it runs.
      b.classList.toggle('in-call', def.id === 'conference' && open);
      const n = builtinUnread[def.id] || 0;
      b.innerHTML = `<i class="fa-solid fa-${escapeHtml(def.icon)} fa-fw" aria-hidden="true"></i><span>${escapeHtml(!open && def.closedLabel ? def.closedLabel : def.name)}</span>${n ? `<span class="badge">${n > 9 ? '9+' : n}</span>` : ''}`;
      menu.appendChild(b);
    }
    for (const m of available) {
      const b = menu.ownerDocument.createElement('button');
      b.type = 'button';
      b.className = 'modules-menu-item';
      b.dataset.module = m.id;
      b.classList.toggle('on', isNarrow() && opened.has(m.id) ? view === m.id : opened.has(m.id));
      const n = unread[m.id] || 0;
      b.innerHTML = `<i class="fa-solid fa-${escapeHtml(m.icon)} fa-fw" aria-hidden="true"></i><span>${escapeHtml(m.name)}</span>${n ? `<span class="badge">${n > 9 ? '9+' : n}</span>` : ''}`;
      menu.appendChild(b);
    }
  }

  // Clicking away closes the menu, and a resize keeps floating modules on screen,
  // in whichever window the call is in.
  const bound = new WeakSet();
  function bindDoc(doc) {
    if (bound.has(doc)) return;
    bound.add(doc);
    doc.addEventListener('click', (event) => {
      if (menu && !inline() && !menu.hidden && !event.target.closest('#modules-menu, #modules-toggle')) menu.hidden = true;
    });
    (doc.defaultView || window).addEventListener('resize', () => {
      for (const p of opened.values()) {
        const floater = floaterOf(p);
        if (!floater || floater.ownerDocument !== doc) continue;
        // A snapped module keeps its cells in the grid the new size makes; a free one just stays on screen.
        if (snapping(p.id)) settleSnap(p.id, floater, saved[p.id]?.cell); else place(floater, currentBox(floater));
      }
      syncDock();
      if (menu && !inline() && !menu.hidden) positionMenu();
    });
  }
  bindDoc(document);

  document.addEventListener('app:unread', (event) => {
    unread = event.detail || {};
    update();
  });
  // The menu belongs to the canvas, so it works with the conference closed. It opens under the
  // Modules button in the page header (the one place to open modules).
  function positionMenu() {
    if (inline()) return;
    const visible = (el) => el && el.getBoundingClientRect().width > 0;
    // The header moves with the canvas when the app is popped out, so the button is always beside it.
    const anchor = [toggle].find(visible);
    const s = canvas.getBoundingClientRect();
    const w = menu.offsetWidth;
    menu.style.transform = 'none';
    menu.style.bottom = 'auto';
    menu.style.top = '8px';
    if (!anchor || anchor.ownerDocument !== canvas.ownerDocument) {
      menu.style.left = 'auto';
      menu.style.right = '8px';
      return;
    }
    const a = anchor.getBoundingClientRect();
    menu.style.right = 'auto';
    menu.style.left = `${Math.min(Math.max(a.left - s.left + a.width / 2 - w / 2, 8), Math.max(8, s.width - w - 8))}px`;
    // Under a button inside the canvas; a header button is above the canvas, so 8px from its top.
    if (canvas.contains(anchor)) menu.style.top = `${a.bottom - s.top + 6}px`;
  }

  function toggleMenu() {
    if (!menu || inline()) return;
    menu.hidden = !menu.hidden;
    if (!menu.hidden) positionMenu();
  }

  toggle?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleMenu();
  });
  menu?.addEventListener('click', (event) => {
    const builtin = event.target.closest('[data-builtin]');
    if (builtin) {
      const id = builtin.dataset.builtin;
      // On a phone a tab switches the view; it never closes a module (so it never hangs up the call).
      if (isNarrow()) { if (opened.has(id)) setView(id); else api_openBuiltin(id); }
      else if (opened.has(id)) closeBuiltin(id);
      else api_openBuiltin(id);
      if (!inline()) menu.hidden = true;
      return;
    }
    const item = event.target.closest('[data-module]');
    if (!item) return;
    const m = available.find((x) => x.id === item.dataset.module);
    if (!m) return;
    if (isNarrow()) { if (opened.has(m.id)) setView(m.id); else openModule(m); }
    else if (opened.has(m.id)) closeModule(m.id);
    else openModule(m);
    if (!inline()) menu.hidden = true;
  });

  // The modules on for this space and this viewer, or none (null = not in a space).
  async function refresh(id) {
    suspended = true;
    closeAllModules();
    spaceId = id;
    saved = loadSaved(id);
    available = [];
    if (id) {
      try {
        const q = new URLSearchParams({ space: id });
        if (guestToken) q.set('guest', guestToken);
        const answer = await api('GET', `/api/modules/for-space?${q}`);
        available = (answer.modules || []).filter((m) => !m.canvas || m.canvas.menu !== false);
        showBuiltin(answer.builtin);
      } catch {
        available = [];
      }
    }
    update();
  }

  // The built-in modules' names and icons as this environment shows them (their display names, else their own), from the
  // server's `builtin` list; a module that draws its own header hears it through def.onShown.
  function showBuiltin(list) {
    for (const b of Array.isArray(list) ? list : []) {
      const def = builtins.get(b.id);
      if (!def || typeof b.name !== 'string' || !b.name) continue;
      const was = def.name;
      def.name = b.name;
      if (typeof b.icon === 'string' && /^[a-z0-9-]{1,40}$/.test(b.icon)) def.icon = b.icon;
      def.onShown?.(def);
      // A window of its own titled by the module's name follows it (one titled otherwise, the conference's, keeps its own).
      const mod = opened.get(b.id);
      if (mod?.mode === 'window' && mod.win && !mod.win.closed && mod.win.document.title === was) mod.win.document.title = def.name;
    }
  }

  const api_openBuiltin = (id, mode) => {
    const def = builtins.get(id);
    if (!def) return false;
    if (opened.has(id)) return true;
    if (!restoring) keepLayout = false;
    if (isNarrow()) view = id;
    const canFloat = !def.modes || def.modes.includes('float');
    // With the canvas-level snap on, a module that can float opens floating (and snapped), whatever it was last time.
    const want = canFloat && (saved[id]?.mode === 'float' || snapAllOn()) ? 'float' : 'dock';
    return openBuiltinIn(def, mode || (isNarrow() ? 'dock' : want));
  };

  return {
    refresh,
    restore,
    // Ask the next restore to open just this module, on this item (a pointer), instead of the remembered modules.
    requestOpen: (module, ref) => { openRequest = { module, ref, at: Date.now() }; },
    suspend: () => { suspended = true; },
    setBuiltinUnread(id, n) {
      builtinUnread[id] = n;
      update();
    },
    closeAll: closeAllModules,
    popped: canvasPopped, // the call moved to (or back from) a window of its own
    showFloating,
    layoutChanged: syncDock,
    updateMenu: update,
    openRef,
    // For tests: send a host event to an open module's frame.
    sendTo: (id, event, data) => opened.get(id)?.mount?.send(event, data),
    testDrag: (id, ref) => opened.get(id)?.mount?.beginDragForTest(ref),
    testPtr: (id, step, ref, label, x, y) => opened.get(id)?.mount?.ptrForTest(step, ref, label, x, y),
    // The canvas-level snap (the space bar's switch and slider): whether every floating module snaps, and the grid's pitch.
    snapAll: setSnapAll,
    snapAllOn,
    dockAll,
    snapPitch,
    snapPitchRange: () => ({ ...SNAP_PITCH }),
    setSnapPitch,
    toggleMenu,
    // `mode` (a module's own window asking to come back as a column or floating) is remembered.
    open: (id, mode) => {
      const m = available.find((x) => x.id === id);
      if (!m) return;
      if (mode) remember(id, { mode });
      openModule(m, mode);
    },
    // Whether the module supports a mode (the window's titlebar offers only what works).
    supportsMode: (id, mode) => {
      const m = available.find((x) => x.id === id);
      return Boolean(m) && supports({ modes: m.canvas.mode }, mode);
    },
    close: closeModule,
    isOpen: (id) => opened.has(id),
    modeOf: (id) => opened.get(id)?.mode || null,
    setMode,
    popOut,
    list: () => available.slice(),
    // The built-in modules: the conference and the chat register their element and how to be told about changes.
    registerBuiltin(def) {
      def.order ??= 0; // the conference sets -1 to come first; the chat is the next column
      builtins.set(def.id, def);
      update(); // the menu lists it
    },
    openBuiltin: api_openBuiltin,
    closeBuiltin,
    builtinOpen: (id) => opened.has(id),
    // The window a built-in module is popped out into, or null (the page's idle-hide needs that document's own canvas).
    builtinWindow: (id) => { const p = opened.get(id); return p && p.mode === 'window' && p.win && !p.win.closed ? p.win : null; },
    builtinMode: (id) => opened.get(id)?.mode || null,
    // A notification's toast asks the call to open the module on the canvas.
    handleNotification(n) {
      if (n.scope !== 'space' || n.spaceId !== spaceId) return false;
      const m = available.find((x) => x.id === n.module);
      if (!m) return false;
      openModule(m);
      return true;
    },
  };
}
