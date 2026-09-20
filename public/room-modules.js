// The panes of a room: the Modules button and its menu, and every pane the room has
// open. A pane is either a module (a sandboxed frame driven by module-host.js) or a
// native pane, which are the conference and the chat. Both work the same way and can
// be shown three ways:
//
//   docked   as a column of the room's grid: conference, chat, module...
//   floating as a draggable, resizable panel over the call
//   window   as a window of its own
//
// A module's manifest says which of docked and floating it supports (both, if it
// does not say); every module can be popped into a window. Panes follow the call
// when it is popped out: they open in whichever window the stage is in.
// See documentation/architecture/architecture-room-layout.md.

import { api, markModuleRead } from '/brand.js';
import { mountModule } from '/module-host.js';

// What each room remembers (`tavern.panels.<room>`): the panes open when the person last used it,
// and each pane's mode and sizes. `tavern.panels` alone is what earlier versions kept for all
// rooms, and is the starting point for a room with nothing saved yet.
const STORE_KEY = 'tavern.panels';
const storeKey = (roomId) => `${STORE_KEY}.${roomId}`;
const MIN_W = 240;
const MIN_H = 160;
const HEAD_H = 42; // the shared module header height (--module-header-h in style.css)
const DOCK_MIN = 240;
const VIDEO_MIN = 280; // the flexible column always keeps at least this much of the stage

function readStore(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function loadSaved(roomId) {
  const own = roomId ? readStore(storeKey(roomId)) : null;
  if (own) return own;
  const { __open, ...rest } = readStore(STORE_KEY) || {};
  return rest;
}

// The panes a room opens with (ids, in order), or null when nothing is remembered yet. The room
// list's "Join with" choice reads and writes this.
export function joinPanes(roomId) {
  const open = loadSaved(roomId).__open;
  return Array.isArray(open) ? open : null;
}

export function setJoinPanes(roomId, ids) {
  const saved = loadSaved(roomId);
  saved.__open = ids;
  try {
    localStorage.setItem(storeKey(roomId), JSON.stringify(saved));
  } catch {
    // private mode: nothing is remembered
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// The buttons at the end of every pane's header: switch between docked and
// floating, open in a window, close.
const toolsHtml = ({ mode, canDock, canFloat, closable = true }) => `
  ${mode !== 'float' && canFloat ? '<button class="msg-btn" data-mode="float" type="button" title="Float over the call" aria-label="Float over the call"><i class="fa-regular fa-window-restore fa-fw" aria-hidden="true"></i></button>' : ''}
  ${mode !== 'dock' && canDock ? '<button class="msg-btn" data-mode="dock" type="button" title="Dock beside the video" aria-label="Dock beside the video"><i class="fa-solid fa-table-columns fa-fw" aria-hidden="true"></i></button>' : ''}
  ${mode !== 'window' ? '<button class="msg-btn" data-popout type="button" title="Open in its own window" aria-label="Open in its own window"><i class="fa-solid fa-up-right-from-square fa-fw" aria-hidden="true"></i></button>' : ''}
  ${closable ? '<button class="msg-btn" data-close type="button" title="Close" aria-label="Close"><i class="fa-solid fa-xmark fa-fw" aria-hidden="true"></i></button>' : ''}`;

export function createRoomModules({ guestToken = null } = {}) {
  const toggle = document.getElementById('modules-toggle');
  const menu = document.getElementById('modules-menu');
  const stage = document.getElementById('stage');
  let saved = loadSaved(null);
  // Nothing is remembered until a join has restored the room's panes, and not while the room is
  // being torn down: closing every pane on the way out must not become the layout.
  let suspended = true;
  const panes = new Map(); // id -> pane; a pane is open while it is in here
  const natives = new Map(); // id -> the built-in pane's definition (the conference and the chat)
  const stageEmpty = document.getElementById('stage-empty');
  let roomId = null;
  let available = [];
  let z = 40;
  let order = 0;
  let unread = {}; // module id -> unread notifications, from brand.js
  const nativeUnread = {}; // native pane id -> unread count (the chat's messages)

  const stageDoc = () => stage.ownerDocument;
  const stageWin = () => stageDoc().defaultView || window;

  // A layer for floating panels in whichever window the call is in.
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

  const supports = (p, mode) => (p.modes || ['dock', 'float']).includes(mode);

  // A narrow stage has no room for a column.
  function isNarrow() {
    const w = stage.clientWidth;
    return w > 0 ? w < 640 : stage.classList.contains('narrow');
  }

  function persist() {
    if (!roomId) return; // an aside remembers nothing
    try {
      localStorage.setItem(storeKey(roomId), JSON.stringify(saved));
    } catch {
      // private mode: panes still work, they just do not remember where they were
    }
  }

  // The panes open now, in column order.
  function snapshot() {
    if (suspended || !roomId) return;
    saved.__open = [...panes.values()].sort((a, b) => a.order - b.order).map((p) => p.id);
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

  function place(panel, box) {
    const win = panel.ownerDocument.defaultView || window;
    const b = clampBox(box, win);
    panel.style.left = `${b.x}px`;
    panel.style.top = `${b.y}px`;
    panel.style.width = `${b.w}px`;
    panel.style.height = `${b.h}px`;
    return b;
  }

  const currentBox = (panel) => ({ x: panel.offsetLeft, y: panel.offsetTop, w: panel.offsetWidth, h: panel.offsetHeight });
  const front = (panel) => { panel.style.zIndex = String(++z); };

  // Drag a floating panel by `handle`, resize it by `grip`.
  function wireFloating(id, panel, handle, grip) {
    const layer = panel.parentNode;
    let drag = null;
    const begin = (kind) => (event) => {
      if (event.target.closest('button, input, textarea, a')) return;
      event.preventDefault();
      drag = { kind, sx: event.clientX, sy: event.clientY, box: currentBox(panel) };
      layer.classList.add('dragging'); // frames swallow pointer events; switch them off while dragging
      event.currentTarget.setPointerCapture?.(event.pointerId);
    };
    const move = (event) => {
      if (!drag) return;
      const dx = event.clientX - drag.sx;
      const dy = event.clientY - drag.sy;
      const b = { ...drag.box };
      if (drag.kind === 'move') { b.x += dx; b.y += dy; } else { b.w += dx; b.h += dy; }
      place(panel, b);
    };
    const end = () => {
      if (!drag) return;
      drag = null;
      layer.classList.remove('dragging');
      remember(id, { box: currentBox(panel) });
    };
    for (const [el, kind] of [[handle, 'move'], [grip, 'size']]) {
      el.addEventListener('pointerdown', begin(kind));
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    }
    panel.addEventListener('pointerdown', () => front(panel));
  }

  // --- docked: columns of the grid ------------------------------------------

  const dockedPanes = () => [...panes.values()].filter((p) => p.mode === 'dock').sort((a, b) => a.order - b.order);

  const maxDock = () => Math.max(DOCK_MIN, Math.round(stage.clientWidth * 0.6));
  const clampDock = (w) => Math.min(Math.max(Math.round(w), DOCK_MIN), maxDock());

  // Docked panes are the columns, in order: the conference, the chat, then modules. One
  // column is flexible and takes what is left: the conference when it is docked, else the
  // first docked pane, so the stage is never left with an empty column. The others keep
  // their widths. On a narrow stage CSS takes over (see architecture-room-layout).
  function syncDock() {
    const docked = dockedPanes();
    for (const p of panes.values()) p.el.classList?.remove('is-flex');
    for (const p of docked) for (const el of p.parts()) el.style.gridColumn = '';
    if (stageEmpty) stageEmpty.hidden = panes.size > 0;
    if (isNarrow() || !docked.length) {
      stage.style.removeProperty('--stage-cols');
      return;
    }
    const flex = docked.find((p) => p.def?.flex) || docked[0];
    flex.el.classList.add('is-flex');
    // The fixed columns together may not crowd the flexible one out: past that, they all shrink
    // in step (each pane keeps the width it was given for when there is room again).
    const fixed = docked.filter((p) => p !== flex);
    const total = fixed.reduce((sum, p) => sum + p.width, 0);
    const room = Math.max(DOCK_MIN, stage.clientWidth - VIDEO_MIN);
    const ratio = total > room ? room / total : 1;
    stage.style.setProperty('--stage-cols', docked.map((p) => (p === flex ? 'minmax(0, 1fr)' : `${Math.max(160, Math.floor(p.width * ratio))}px`)).join(' '));
    docked.forEach((p, i) => { for (const el of p.parts()) el.style.gridColumn = String(1 + i); });
  }

  // `current` returns the pane the handle belongs to right now (a native pane is a new object each time it opens).
  function wireDockResize(current, handle) {
    let drag = null;
    handle.addEventListener('pointerdown', (event) => {
      const pane = current();
      if (!pane) return;
      event.preventDefault();
      drag = { sx: event.clientX, w: pane.width };
      handle.classList.add('dragging');
      stage.classList.add('resizing-dock'); // frames swallow the pointer while dragging
      handle.setPointerCapture?.(event.pointerId);
    });
    handle.addEventListener('pointermove', (event) => {
      const pane = current();
      if (!drag || !pane) return;
      pane.width = clampDock(drag.w + (drag.sx - event.clientX)); // the column is on the right: dragging left widens it
      syncDock();
    });
    const stop = () => {
      const pane = current();
      if (!drag || !pane) return;
      drag = null;
      handle.classList.remove('dragging');
      stage.classList.remove('resizing-dock');
      remember(pane.id, { dockW: pane.width });
      pane.onWidth?.(pane.width);
    };
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  }

  // --- module panes ---------------------------------------------------------

  const moduleHeader = (m, mode, canDock, canFloat) => `
    <span class="module-panel-title"><i class="fa-solid fa-${escapeHtml(m.icon)} fa-fw" aria-hidden="true"></i> <span data-title>${escapeHtml(m.name)}</span></span>
    <span class="mod-header-tools"><span class="titlebar-custom" data-header-custom></span>${toolsHtml({ mode, canDock, canFloat })}</span>`;

  function mountFor(pane, frame, bar, extra = {}) {
    const m = pane.m;
    return mountModule({
      module: { id: m.id, version: m.version, scope: m.scope },
      frame,
      bar,
      header: pane.el.querySelector('[data-header-custom]'),
      scope: 'room',
      roomId,
      guestToken,
      entry: m.panel.entry,
      onTitle: (title) => { pane.el.querySelector('[data-title]').textContent = title || m.name; },
      ...extra,
    });
  }

  function openModuleFloating(m) {
    const doc = stageDoc();
    const panel = doc.createElement('section');
    panel.className = 'module-panel';
    panel.dataset.module = m.id;
    panel.innerHTML = `
      <header class="mod-header module-panel-head">${moduleHeader(m, 'float', supports({ modes: m.panel.mode }, 'dock') && !isNarrow(), true)}</header>
      <iframe class="module-panel-frame" title="${escapeHtml(m.name)}"></iframe>
      <div class="module-panel-bar" hidden></div>
      <span class="module-panel-grip" title="Drag to resize"></span>`;
    layerFor(doc).appendChild(panel);
    const index = [...panes.values()].filter((p) => p.mode === 'float').length;
    const win = stageWin();
    place(panel, saved[m.id]?.box || {
      w: m.panel.width,
      h: m.panel.height + HEAD_H,
      x: win.innerWidth - m.panel.width - 24 - index * 28,
      y: 70 + index * 28,
    });
    front(panel);
    const pane = { id: m.id, kind: 'module', mode: 'float', m, el: panel, modes: m.panel.mode, order: ++order, parts: () => [] };
    pane.mount = mountFor(pane, panel.querySelector('iframe'), panel.querySelector('.module-panel-bar'), {
      onResize: ({ width, height }) => {
        const b = currentBox(panel);
        if (Number.isFinite(width)) b.w = width;
        if (Number.isFinite(height)) b.h = height + HEAD_H;
        remember(m.id, { box: place(panel, b) });
      },
    });
    panes.set(m.id, pane);
    wireFloating(m.id, panel, panel.querySelector('.module-panel-head'), panel.querySelector('.module-panel-grip'));
    wireHeader(panel, pane);
  }

  function openModuleDocked(m) {
    const doc = stageDoc();
    const section = doc.createElement('section');
    section.className = 'module module-docked';
    section.dataset.module = m.id;
    section.innerHTML = `
      <div class="dock-resize" title="Drag to resize"></div>
      <div class="mod-content dock-content">
        <header class="mod-header">${moduleHeader(m, 'dock', false, true)}</header>
        <iframe class="dock-frame" title="${escapeHtml(m.name)}"></iframe>
      </div>
      <div class="mod-bar dock-bar" hidden></div>`;
    stage.appendChild(section);
    const pane = {
      id: m.id, kind: 'module', mode: 'dock', m, el: section, modes: m.panel.mode, order: ++order,
      width: clampDock(saved[m.id]?.dockW || m.panel.width),
      parts: () => [...section.children],
    };
    // With a bar the module's content stops above the shared bottom row; without one it fills the column.
    pane.mount = mountFor(pane, section.querySelector('iframe'), section.querySelector('.dock-bar'), {
      onBar: (has) => section.classList.toggle('has-bar', has),
    });
    panes.set(m.id, pane);
    syncDock();
    wireDockResize(() => pane, section.querySelector('.dock-resize'));
    wireHeader(section, pane);
  }

  // --- native panes (the chat) ------------------------------------------------
  // The pane's DOM already exists in the page; moving it between the stage's grid,
  // a floating panel and a window keeps everything wired to it (a node moved to
  // another document keeps its listeners).

  const wired = new WeakSet();

  // `opts.moving`: the pane is only changing where it is shown, not opening or closing, so
  // its owner (the conference: a call) is told not to start or stop anything.
  function openNativeIn(def, mode, opts = {}) {
    if (def.allowed && !def.allowed()) return false;
    if (mode !== 'dock' && def.modes && !def.modes.includes(mode)) mode = 'dock';
    if (mode === 'window') return openNativeWindow(def, opts);
    const doc = stageDoc();
    const el = def.el;
    const pane = {
      id: def.id, kind: 'native', mode, def, el, modes: def.modes || ['dock', 'float'], order: def.order,
      width: clampDock(saved[def.id]?.dockW || def.width || 320),
      onWidth: def.onWidth,
      parts: () => [...el.children],
    };
    if (mode === 'dock') {
      stage.appendChild(el);
      el.hidden = false;
      const handle = el.querySelector('.chat-resize');
      if (handle && !wired.has(handle)) {
        wired.add(handle);
        wireDockResize(() => panes.get(def.id), handle);
      }
    } else {
      const panel = doc.createElement('section');
      panel.className = `module-panel native-panel ${def.id}-panel`;
      panel.dataset.module = def.id;
      panel.appendChild(wrapFor(def, el, doc));
      const grip = doc.createElement('span');
      grip.className = 'module-panel-grip';
      grip.title = 'Drag to resize';
      panel.appendChild(grip);
      layerFor(doc).appendChild(panel);
      el.hidden = false;
      const size = def.floatSize || { w: 340, h: 480 };
      place(panel, saved[def.id]?.box || { ...size, x: Math.max(8, stageWin().innerWidth - size.w - 24), y: 70 });
      front(panel);
      pane.floatEl = panel;
      wireFloating(def.id, panel, el.querySelector('header'), grip);
    }
    panes.set(def.id, pane);
    syncDock();
    decorateNative(pane);
    def.onChange?.({ open: true, mode, moving: opts.moving });
    update();
    return true;
  }

  // The conference's tiles are styled by an ancestor `.stage`, so out of the stage's grid it
  // needs one of its own (`def.wrap` is its class); the chat needs nothing.
  function wrapFor(def, el, doc) {
    if (!def.wrap) return el;
    const wrap = doc.createElement('div');
    wrap.className = def.wrap;
    wrap.appendChild(el);
    return wrap;
  }

  // Add (or refresh) the mode buttons in the pane's own header.
  function decorateNative(pane) {
    const tools = pane.el.querySelector('.chat-tools, .pane-tools');
    if (!tools) return;
    tools.querySelectorAll('[data-mode], [data-popout]').forEach((b) => b.remove());
    const holder = tools.ownerDocument.createElement('span');
    holder.innerHTML = toolsHtml({ mode: pane.mode, canDock: true, canFloat: pane.modes.includes('float'), closable: false });
    const close = tools.querySelector('#chat-close, [data-pane-close]');
    for (const b of [...holder.children]) tools.insertBefore(b, close);
    for (const b of tools.querySelectorAll('[data-mode], [data-popout]')) {
      b.onclick = (event) => {
        event.stopPropagation();
        setMode(pane.id, b.dataset.mode || 'window');
      };
    }
  }

  function openNativeWindow(def, opts = {}) {
    const size = saved[def.id]?.win || def.windowSize || { w: 380, h: 520 };
    const win = window.open('/popout.html', `tavern-${def.id}`, `popup,width=${size.w},height=${size.h}`);
    if (!win) return false;
    const pane = { id: def.id, kind: 'native', mode: 'window', def, el: def.el, win, modes: def.modes || ['dock', 'float'], order: def.order, parts: () => [] };
    panes.set(def.id, pane);
    const setup = () => {
      win.document.title = def.name;
      for (const sheet of document.querySelectorAll('link[rel="stylesheet"]')) win.document.head.appendChild(sheet.cloneNode(true));
      win.document.body.className = def.windowClass || 'chat-window';
      const grid = def.wrap ? wrapFor(def, def.el, win.document) : win.document.createElement('div');
      if (!def.wrap) {
        grid.className = 'chat-window-grid';
        grid.appendChild(def.el);
      }
      win.document.body.appendChild(grid);
      def.el.hidden = false;
      decorateNative(pane);
      def.onWindow?.(win);
      // Popups the chat opens (emoji, formatting help) close on a click elsewhere.
      win.document.addEventListener('click', (e) => {
        for (const id of ['chat-help-popup', 'chat-emoji-popup']) {
          const p = win.document.getElementById(id);
          if (p && !p.hidden && !e.target.closest(`#${id}`) && !e.target.closest('#chat-help, #chat-emoji')) p.hidden = true;
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
      // Closing the window closes the pane, and its parts go back to the page. Registered only
      // once the window has loaded: the blank page it starts as also fires pagehide, when it
      // navigates to the real one, and that must not count as the person closing it.
      win.addEventListener('pagehide', () => {
        if (panes.get(def.id) !== pane) return;
        stage.appendChild(def.el);
        def.el.hidden = true;
        def.el.classList.remove('is-flex');
        panes.delete(def.id);
        syncDock();
        def.onChange?.({ open: false, mode: 'window' });
        update();
      });
    }, { once: true });
    return true;
  }

  function closeNative(id, opts = {}) {
    const pane = panes.get(id);
    if (!pane) return;
    const def = pane.def;
    panes.delete(id);
    if (pane.floatEl) pane.floatEl.remove();
    stage.appendChild(def.el); // home again, before a window goes and takes it along
    def.el.hidden = true;
    def.el.classList.remove('is-flex');
    for (const el of def.el.children) el.style.gridColumn = '';
    if (pane.mode === 'window') pane.win.close();
    syncDock();
    def.onChange?.({ open: false, mode: pane.mode, moving: opts.moving });
    update();
  }

  // --- opening, closing, switching -------------------------------------------

  function preferredMode(p) {
    const want = saved[p.id]?.mode;
    if (isNarrow()) return 'float';
    if (want && supports(p, want)) return want;
    return supports(p, 'dock') ? 'dock' : 'float';
  }

  function openModule(m, mode) {
    const p = { id: m.id, modes: m.panel.mode, kind: 'module' };
    if (panes.has(m.id)) {
      const pane = panes.get(m.id);
      if (pane.mode === 'float') front(pane.el);
      return;
    }
    mode ||= preferredMode(p);
    if (mode === 'dock' && !supports(p, 'dock')) mode = 'float';
    if (mode === 'dock') openModuleDocked(m); else openModuleFloating(m);
    markModuleRead(m.id);
    update();
  }

  function closePane(id) {
    const pane = panes.get(id);
    if (!pane) return;
    if (pane.kind === 'native') return closeNative(id);
    pane.mount.destroy();
    pane.el.remove();
    panes.delete(id);
    syncDock();
    update();
  }

  function closeAllModules() {
    for (const p of [...panes.values()]) if (p.kind === 'module') closePane(p.id);
    if (menu) menu.hidden = true;
  }

  function setMode(id, mode) {
    const pane = panes.get(id);
    if (!pane || pane.mode === mode) return;
    if (pane.kind === 'native') {
      const def = pane.def;
      const before = pane.mode;
      closeNative(id, { moving: true });
      if (mode !== 'window') remember(id, { mode });
      // A window the browser refuses to open must not leave the pane closed.
      if (!openNativeIn(def, mode, { moving: true })) openNativeIn(def, before, { moving: true });
      return;
    }
    if (mode !== 'window' && !supports(pane, mode)) return;
    const m = pane.m;
    closePane(id);
    if (mode === 'window') return popOut(m.id);
    remember(id, { mode });
    openModule(m, mode);
  }

  // A module's own window: the same page a server page uses, in this room's scope.
  const windows = new Map();
  function popOut(id) {
    const pane = panes.get(id);
    const m = pane?.m || available.find((x) => x.id === id);
    if (!m) return;
    const q = new URLSearchParams({ moduleRoom: roomId, popout: '1' });
    if (guestToken) q.set('guest', guestToken);
    const width = Math.max(320, Math.min(m.panel.width, screen.availWidth));
    const height = Math.max(240, Math.min(m.panel.height + HEAD_H, screen.availHeight));
    const win = window.open(`/modules/${encodeURIComponent(m.id)}?${q}`, `tavern-module-${m.id}`, `popup,width=${width},height=${height}`);
    if (!win) return;
    windows.set(m.id, win);
    if (pane) closePane(m.id);
  }

  function wireHeader(el, pane) {
    el.querySelector('[data-close]').addEventListener('click', () => closePane(pane.id));
    el.querySelector('[data-popout]').addEventListener('click', () => popOut(pane.id));
    el.querySelector('[data-mode]')?.addEventListener('click', (event) => setMode(pane.id, event.currentTarget.dataset.mode));
  }

  // The call moved to (or came back from) a window of its own. Module frames cannot
  // move between windows without reloading, and a frame's messages arrive in the
  // window it lives in, so each open module is opened again in the stage's new
  // window, the same way it was. A floating chat is carried over; a docked one is
  // inside the stage and goes with it.
  function stagePopped() {
    suspended = true; // closing and reopening the modules is not a change of layout
    const doc = stageDoc();
    const again = [...panes.values()].filter((p) => p.kind === 'module').map((p) => ({ m: p.m, mode: p.mode }));
    for (const { m } of again) closePane(m.id);
    for (const p of panes.values()) {
      if (p.kind === 'native' && p.mode === 'float' && p.floatEl) {
        layerFor(doc).appendChild(p.floatEl);
        place(p.floatEl, currentBox(p.floatEl));
      }
    }
    bindDoc(doc);
    for (const { m, mode } of again) openModule(m, isNarrow() ? 'float' : mode);
    suspended = false;
    syncDock();
    snapshot();
  }

  // Open the room's remembered panes: what was open when it was last used, or just the
  // conference for a room not used before.
  function restore() {
    suspended = true;
    const want = Array.isArray(saved.__open) ? saved.__open : ['conference'];
    for (const id of want) {
      if (natives.has(id)) api_openNative(id);
      else {
        const m = available.find((x) => x.id === id);
        if (m) openModule(m);
      }
    }
    suspended = false;
    snapshot();
  }

  // --- the toolbar button and its menu --------------------------------------

  // The one place to show and hide panes: the chat first, then the room's modules.
  function update() {
    const total = available.reduce((sum, m) => sum + (unread[m.id] || 0), 0)
      + [...natives.keys()].reduce((sum, id) => sum + (panes.has(id) ? 0 : nativeUnread[id] || 0), 0);
    const badge = toggle?.querySelector('.badge');
    if (badge) {
      badge.hidden = total === 0;
      badge.textContent = total > 9 ? '9+' : String(total);
    }
    snapshot();
    toggle?.classList.toggle('on', [...panes.keys()].some((id) => id !== 'conference'));
    if (stageEmpty) stageEmpty.hidden = panes.size > 0;
    if (!menu) return;
    menu.innerHTML = '';
    for (const def of [...natives.values()].sort((a, b) => a.order - b.order)) {
      if (def.allowed && !def.allowed()) continue;
      const open = panes.has(def.id);
      const b = menu.ownerDocument.createElement('button');
      b.type = 'button';
      b.className = 'modules-menu-item';
      b.dataset.native = def.id;
      b.classList.toggle('on', open);
      const n = nativeUnread[def.id] || 0;
      b.innerHTML = `<i class="fa-solid fa-${escapeHtml(def.icon)} fa-fw" aria-hidden="true"></i><span>${escapeHtml(!open && def.closedLabel ? def.closedLabel : def.name)}</span>${n ? `<span class="badge">${n > 9 ? '9+' : n}</span>` : ''}`;
      menu.appendChild(b);
    }
    for (const m of available) {
      const b = menu.ownerDocument.createElement('button');
      b.type = 'button';
      b.className = 'modules-menu-item';
      b.dataset.module = m.id;
      b.classList.toggle('on', panes.has(m.id));
      const n = unread[m.id] || 0;
      b.innerHTML = `<i class="fa-solid fa-${escapeHtml(m.icon)} fa-fw" aria-hidden="true"></i><span>${escapeHtml(m.name)}</span>${n ? `<span class="badge">${n > 9 ? '9+' : n}</span>` : ''}`;
      menu.appendChild(b);
    }
  }

  // Clicking away closes the menu, and a resize keeps floating panels on screen,
  // in whichever window the call is in.
  const bound = new WeakSet();
  function bindDoc(doc) {
    if (bound.has(doc)) return;
    bound.add(doc);
    doc.addEventListener('click', (event) => {
      if (menu && !menu.hidden && !event.target.closest('#modules-menu, #modules-toggle')) menu.hidden = true;
    });
    (doc.defaultView || window).addEventListener('resize', () => {
      for (const p of panes.values()) {
        const panel = p.kind === 'native' ? p.floatEl : p.mode === 'float' ? p.el : null;
        if (panel && panel.ownerDocument === doc) place(panel, currentBox(panel));
      }
      syncDock();
      if (menu && !menu.hidden) positionMenu();
    });
  }
  bindDoc(document);

  document.addEventListener('tavern:unread', (event) => {
    unread = event.detail || {};
    update();
  });
  // The menu belongs to the stage, so it works with the conference closed. It opens under the
  // Modules button in the page header (the one place to open panes).
  function positionMenu() {
    const visible = (el) => el && el.getBoundingClientRect().width > 0;
    // The header moves with the stage when the app is popped out, so the button is always beside it.
    const anchor = [toggle].find(visible);
    const s = stage.getBoundingClientRect();
    const w = menu.offsetWidth;
    menu.style.transform = 'none';
    menu.style.bottom = 'auto';
    menu.style.top = '8px';
    if (!anchor || anchor.ownerDocument !== stage.ownerDocument) {
      menu.style.left = 'auto';
      menu.style.right = '8px';
      return;
    }
    const a = anchor.getBoundingClientRect();
    menu.style.right = 'auto';
    menu.style.left = `${Math.min(Math.max(a.left - s.left + a.width / 2 - w / 2, 8), Math.max(8, s.width - w - 8))}px`;
    // Under a button inside the stage; a header button is above the stage, so 8px from its top.
    if (stage.contains(anchor)) menu.style.top = `${a.bottom - s.top + 6}px`;
  }

  function toggleMenu() {
    if (!menu) return;
    menu.hidden = !menu.hidden;
    if (!menu.hidden) positionMenu();
  }

  toggle?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleMenu();
  });
  menu?.addEventListener('click', (event) => {
    const native = event.target.closest('[data-native]');
    if (native) {
      const id = native.dataset.native;
      if (panes.has(id)) closeNative(id);
      else api_openNative(id);
      menu.hidden = true;
      return;
    }
    const item = event.target.closest('[data-module]');
    if (!item) return;
    const m = available.find((x) => x.id === item.dataset.module);
    if (!m) return;
    if (panes.has(m.id)) closePane(m.id);
    else openModule(m);
    menu.hidden = true;
  });

  // The modules on for this room and this viewer, or none (null = not in a room).
  async function refresh(id) {
    suspended = true;
    closeAllModules();
    roomId = id;
    saved = loadSaved(id);
    available = [];
    if (id) {
      try {
        const q = new URLSearchParams({ room: id });
        if (guestToken) q.set('guest', guestToken);
        available = (await api('GET', `/api/modules/for-room?${q}`)).modules;
      } catch {
        available = [];
      }
    }
    update();
  }

  const api_openNative = (id, mode) => {
    const def = natives.get(id);
    if (!def) return false;
    if (panes.has(id)) return true;
    const want = saved[id]?.mode === 'float' && (!def.modes || def.modes.includes('float')) ? 'float' : 'dock';
    return openNativeIn(def, mode || (isNarrow() ? 'dock' : want));
  };

  return {
    refresh,
    restore,
    suspend: () => { suspended = true; },
    setNativeUnread(id, n) {
      nativeUnread[id] = n;
      update();
    },
    closeAll: closeAllModules,
    stagePopped,
    layoutChanged: syncDock,
    updateMenu: update,
    toggleMenu,
    // `mode` (a module's own window asking to come back as a column or a panel) is remembered.
    open: (id, mode) => {
      const m = available.find((x) => x.id === id);
      if (!m) return;
      if (mode) remember(id, { mode });
      openModule(m, mode);
    },
    // Whether the module supports a mode (the window's titlebar offers only what works).
    supportsMode: (id, mode) => {
      const m = available.find((x) => x.id === id);
      return Boolean(m) && supports({ modes: m.panel.mode }, mode);
    },
    close: closePane,
    isOpen: (id) => panes.has(id),
    modeOf: (id) => panes.get(id)?.mode || null,
    setMode,
    popOut,
    list: () => available.slice(),
    // The built-in panes: the conference and the chat register their element and how to be told about changes.
    registerNative(def) {
      def.order ??= 0; // the conference sets -1 to come first; the chat is the next column
      natives.set(def.id, def);
      update(); // the menu lists it
    },
    openNative: api_openNative,
    closeNative,
    nativeOpen: (id) => panes.has(id),
    nativeMode: (id) => panes.get(id)?.mode || null,
    // A notification's toast asks the call to open the module's pane.
    handleNotification(n) {
      if (n.scope !== 'room' || n.roomId !== roomId) return false;
      const m = available.find((x) => x.id === n.module);
      if (!m) return false;
      openModule(m);
      return true;
    },
  };
}
