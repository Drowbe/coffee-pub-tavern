// The panes beside the call: the Modules button on the toolbar and its menu, and
// every pane a room has open. A pane is either a module (a sandboxed frame driven
// by module-host.js) or a native pane, which today is the chat. Both work the same
// way and can be shown three ways:
//
//   docked   as a column of the room's grid, after the video: video, chat, module...
//   floating as a draggable, resizable panel over the call
//   window   as a window of its own
//
// A module's manifest says which of docked and floating it supports (both, if it
// does not say); every module can be popped into a window. Panes follow the call
// when it is popped out: they open in whichever window the stage is in.
// See documentation/architecture/architecture-room-layout.md.

import { api, markModuleRead } from '/brand.js';
import { mountModule } from '/module-host.js';

const STORE_KEY = 'tavern.panels';
const MIN_W = 240;
const MIN_H = 160;
const HEAD_H = 42; // the shared module header height (--module-header-h in style.css)
const DOCK_MIN = 240;
const VIDEO_MIN = 280; // the video always keeps at least this much of the stage

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// The buttons at the end of every pane's header: switch between docked and
// floating, open in a window, close.
const toolsHtml = ({ mode, canDock, canFloat, closable = true }) => `
  ${mode === 'dock' && canFloat ? '<button class="msg-btn" data-mode="float" type="button" title="Float over the call" aria-label="Float over the call"><i class="fa-regular fa-window-restore fa-fw" aria-hidden="true"></i></button>' : ''}
  ${mode !== 'dock' && canDock ? '<button class="msg-btn" data-mode="dock" type="button" title="Dock beside the video" aria-label="Dock beside the video"><i class="fa-solid fa-table-columns fa-fw" aria-hidden="true"></i></button>' : ''}
  ${mode !== 'window' ? '<button class="msg-btn" data-popout type="button" title="Open in its own window" aria-label="Open in its own window"><i class="fa-solid fa-up-right-from-square fa-fw" aria-hidden="true"></i></button>' : ''}
  ${closable ? '<button class="msg-btn" data-close type="button" title="Close" aria-label="Close"><i class="fa-solid fa-xmark fa-fw" aria-hidden="true"></i></button>' : ''}`;

export function createRoomModules({ guestToken = null } = {}) {
  const toggle = document.getElementById('modules-toggle');
  const menu = document.getElementById('modules-menu');
  const stage = document.getElementById('stage');
  const saved = loadSaved();
  const panes = new Map(); // id -> pane; a pane is open while it is in here
  const natives = new Map(); // id -> the built-in pane's definition (the chat)
  let roomId = null;
  let available = [];
  let z = 40;
  let order = 0;
  let unread = {}; // module id -> unread notifications, from brand.js

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
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(saved));
    } catch {
      // private mode: panes still work, they just do not remember where they were
    }
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

  // Docked panes are the columns after the video: 2, 3, ... On a narrow stage CSS
  // takes over (the chat replaces the video; modules float instead).
  function syncDock() {
    const docked = dockedPanes();
    for (const p of docked) for (const el of p.parts()) el.style.gridColumn = '';
    if (isNarrow()) {
      stage.style.removeProperty('--dock-cols');
      return;
    }
    // The columns together may not crowd the video out: past that, they all shrink in step
    // (each pane keeps the width it was given for when there is room again).
    const total = docked.reduce((sum, p) => sum + p.width, 0);
    const room = Math.max(DOCK_MIN, stage.clientWidth - VIDEO_MIN);
    const ratio = total > room ? room / total : 1;
    stage.style.setProperty('--dock-cols', docked.map((p) => `${Math.max(160, Math.floor(p.width * ratio))}px`).join(' '));
    docked.forEach((p, i) => { for (const el of p.parts()) el.style.gridColumn = String(2 + i); });
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
    <span class="mod-header-tools">${toolsHtml({ mode, canDock, canFloat })}</span>`;

  function mountFor(pane, frame, bar, extra = {}) {
    const m = pane.m;
    return mountModule({
      module: { id: m.id, version: m.version, scope: m.scope },
      frame,
      bar,
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

  function openNativeIn(def, mode) {
    if (mode === 'window') return openNativeWindow(def);
    const doc = stageDoc();
    const el = def.el;
    const pane = {
      id: def.id, kind: 'native', mode, def, el, modes: ['dock', 'float'], order: def.order,
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
      panel.className = 'module-panel native-panel';
      panel.dataset.module = def.id;
      panel.appendChild(el);
      const grip = doc.createElement('span');
      grip.className = 'module-panel-grip';
      grip.title = 'Drag to resize';
      panel.appendChild(grip);
      layerFor(doc).appendChild(panel);
      el.hidden = false;
      place(panel, saved[def.id]?.box || { w: 340, h: 480, x: stageWin().innerWidth - 364, y: 70 });
      front(panel);
      pane.floatEl = panel;
      wireFloating(def.id, panel, el.querySelector('header'), grip);
    }
    panes.set(def.id, pane);
    syncDock();
    decorateNative(pane);
    def.onChange?.({ open: true, mode });
    update();
    return true;
  }

  // Add (or refresh) the mode buttons in the pane's own header.
  function decorateNative(pane) {
    const tools = pane.el.querySelector('.chat-tools');
    if (!tools) return;
    tools.querySelectorAll('[data-mode], [data-popout]').forEach((b) => b.remove());
    const holder = tools.ownerDocument.createElement('span');
    holder.innerHTML = toolsHtml({ mode: pane.mode, canDock: true, canFloat: true, closable: false });
    const close = tools.querySelector('#chat-close');
    for (const b of [...holder.children]) tools.insertBefore(b, close);
    for (const b of tools.querySelectorAll('[data-mode], [data-popout]')) {
      b.onclick = (event) => {
        event.stopPropagation();
        setMode(pane.id, b.dataset.mode || 'window');
      };
    }
  }

  function openNativeWindow(def) {
    const size = saved[def.id]?.win || { w: 380, h: 520 };
    const win = window.open('/popout.html', `tavern-${def.id}`, `popup,width=${size.w},height=${size.h}`);
    if (!win) return false;
    const pane = { id: def.id, kind: 'native', mode: 'window', def, el: def.el, win, modes: ['dock', 'float'], order: def.order, parts: () => [] };
    panes.set(def.id, pane);
    const setup = () => {
      win.document.title = def.name;
      for (const sheet of document.querySelectorAll('link[rel="stylesheet"]')) win.document.head.appendChild(sheet.cloneNode(true));
      win.document.body.className = 'chat-window';
      const grid = win.document.createElement('div');
      grid.className = 'chat-window-grid';
      grid.appendChild(def.el);
      win.document.body.appendChild(grid);
      def.el.hidden = false;
      decorateNative(pane);
      // Popups the chat opens (emoji, formatting help) close on a click elsewhere.
      win.document.addEventListener('click', (e) => {
        for (const id of ['chat-help-popup', 'chat-emoji-popup']) {
          const p = win.document.getElementById(id);
          if (p && !p.hidden && !e.target.closest(`#${id}`) && !e.target.closest('#chat-help, #chat-emoji')) p.hidden = true;
        }
      });
      win.addEventListener('resize', () => remember(def.id, { win: { w: win.innerWidth, h: win.innerHeight } }));
      def.onChange?.({ open: true, mode: 'window' });
      update();
    };
    win.addEventListener('load', setup, { once: true });
    // Closing the window closes the chat, and its parts go back to the page.
    win.addEventListener('pagehide', () => {
      if (panes.get(def.id) !== pane) return;
      stage.appendChild(def.el);
      def.el.hidden = true;
      panes.delete(def.id);
      def.onChange?.({ open: false, mode: 'window' });
      update();
    });
    return true;
  }

  function closeNative(id) {
    const pane = panes.get(id);
    if (!pane) return;
    const def = pane.def;
    panes.delete(id);
    if (pane.floatEl) pane.floatEl.remove();
    stage.appendChild(def.el); // home again, before a window goes and takes it along
    def.el.hidden = true;
    for (const el of def.el.children) el.style.gridColumn = '';
    if (pane.mode === 'window') pane.win.close();
    syncDock();
    def.onChange?.({ open: false, mode: pane.mode });
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
      closeNative(id);
      if (mode !== 'window') remember(id, { mode });
      openNativeIn(def, mode);
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
    syncDock();
  }

  // --- the toolbar button and its menu --------------------------------------

  function update() {
    if (toggle) toggle.hidden = available.length === 0;
    const total = available.reduce((sum, m) => sum + (unread[m.id] || 0), 0);
    const badge = toggle?.querySelector('.badge');
    if (badge) {
      badge.hidden = total === 0;
      badge.textContent = total > 9 ? '9+' : String(total);
    }
    if (!menu) return;
    menu.innerHTML = '';
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
      if (menu && !menu.hidden && !event.target.closest('#modules-menu') && !event.target.closest('#modules-toggle')) menu.hidden = true;
    });
    (doc.defaultView || window).addEventListener('resize', () => {
      for (const p of panes.values()) {
        const panel = p.kind === 'native' ? p.floatEl : p.mode === 'float' ? p.el : null;
        if (panel && panel.ownerDocument === doc) place(panel, currentBox(panel));
      }
      syncDock();
    });
  }
  bindDoc(document);

  document.addEventListener('tavern:unread', (event) => {
    unread = event.detail || {};
    update();
  });
  toggle?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (menu) menu.hidden = !menu.hidden;
  });
  menu?.addEventListener('click', (event) => {
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
    closeAllModules();
    roomId = id;
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

  return {
    refresh,
    closeAll: closeAllModules,
    stagePopped,
    layoutChanged: syncDock,
    open: (id, mode) => { const m = available.find((x) => x.id === id); if (m) openModule(m, mode); },
    close: closePane,
    isOpen: (id) => panes.has(id),
    modeOf: (id) => panes.get(id)?.mode || null,
    setMode,
    popOut,
    list: () => available.slice(),
    // The built-in panes: the chat registers its element and how to be told about changes.
    registerNative(def) {
      def.order = 0; // the chat is the first column after the video
      natives.set(def.id, def);
    },
    openNative(id, mode) {
      const def = natives.get(id);
      if (!def) return false;
      if (panes.has(id)) return true;
      const want = saved[id]?.mode === 'float' ? 'float' : 'dock';
      return openNativeIn(def, mode || (isNarrow() ? 'dock' : want));
    },
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
