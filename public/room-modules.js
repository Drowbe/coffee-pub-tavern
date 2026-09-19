// Room modules: the Modules button on the call's toolbar, its menu, and the
// panes a room's modules open in. A module can be shown three ways:
//
//   docked   as a column of the room's grid beside the video and the chat,
//   floating as a draggable, resizable panel over the call, or
//   popped out into a window of its own.
//
// A module's manifest says which of docked and floating it supports; every
// module can be popped out. Floating panels live in their own layer on the
// main page and docked panes in the stage's grid; each is a sandboxed frame
// driven by module-host.js. See documentation/architecture/architecture-room-layout.md.

import { api, markModuleRead } from '/brand.js';
import { mountModule } from '/module-host.js';

const STORE_KEY = 'tavern.panels';
const MIN_W = 240;
const MIN_H = 160;
const HEAD_H = 42; // the shared module header height (--module-header-h in style.css)
const DOCK_MIN = 260;

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const headerHtml = (m, { docked, canDock, canFloat }) => `
  <span class="module-panel-title"><i class="fa-solid fa-${escapeHtml(m.icon)} fa-fw" aria-hidden="true"></i> <span data-title>${escapeHtml(m.name)}</span></span>
  <span class="mod-header-tools">
    ${docked && canFloat ? '<button class="msg-btn" data-mode="float" type="button" title="Float over the call" aria-label="Float over the call"><i class="fa-regular fa-window-restore fa-fw" aria-hidden="true"></i></button>' : ''}
    ${!docked && canDock ? '<button class="msg-btn" data-mode="dock" type="button" title="Dock beside the chat" aria-label="Dock beside the chat"><i class="fa-solid fa-table-columns fa-fw" aria-hidden="true"></i></button>' : ''}
    <button class="msg-btn" data-popout type="button" title="Open in its own window" aria-label="Open in its own window"><i class="fa-solid fa-up-right-from-square fa-fw" aria-hidden="true"></i></button>
    <button class="msg-btn" data-close type="button" title="Close" aria-label="Close"><i class="fa-solid fa-xmark fa-fw" aria-hidden="true"></i></button>
  </span>`;

export function createRoomModules({ guestToken = null } = {}) {
  const layer = document.createElement('div');
  layer.id = 'module-layer';
  layer.className = 'module-layer';
  document.body.appendChild(layer);

  const toggle = document.getElementById('modules-toggle');
  const menu = document.getElementById('modules-menu');
  const stage = document.getElementById('stage');
  const saved = loadSaved();
  const open = new Map(); // module id -> { mode, m, el, mount, width }
  const converted = new Set(); // docked panes turned floating while the call is popped out
  let roomId = null;
  let available = [];
  let z = 40;
  let unread = {}; // module id -> unread notifications, from brand.js

  const supports = (m, mode) => (m.panel.mode || ['float']).includes(mode);

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(saved));
    } catch {
      // private mode: panes still work, they just do not remember where they were
    }
  }

  // --- floating -----------------------------------------------------------

  function clampBox(box) {
    const maxW = Math.max(MIN_W, window.innerWidth - 16);
    const maxH = Math.max(MIN_H, window.innerHeight - 16);
    const w = Math.min(Math.max(box.w, MIN_W), maxW);
    const h = Math.min(Math.max(box.h, MIN_H), maxH);
    const x = Math.min(Math.max(box.x, 0), Math.max(0, window.innerWidth - w));
    const y = Math.min(Math.max(box.y, 0), Math.max(0, window.innerHeight - h));
    return { x, y, w, h };
  }

  function place(panel, box) {
    const b = clampBox(box);
    panel.style.left = `${b.x}px`;
    panel.style.top = `${b.y}px`;
    panel.style.width = `${b.w}px`;
    panel.style.height = `${b.h}px`;
    return b;
  }

  const currentBox = (panel) => ({ x: panel.offsetLeft, y: panel.offsetTop, w: panel.offsetWidth, h: panel.offsetHeight });

  function openFloating(m) {
    const panel = document.createElement('section');
    panel.className = 'module-panel';
    panel.dataset.module = m.id;
    panel.innerHTML = `
      <header class="mod-header module-panel-head">${headerHtml(m, { docked: false, canDock: supports(m, 'dock') && !isNarrow(), canFloat: true })}</header>
      <iframe class="module-panel-frame" title="${escapeHtml(m.name)}"></iframe>
      <span class="module-panel-grip" title="Drag to resize"></span>`;
    layer.appendChild(panel);
    const index = [...open.values()].filter((o) => o.mode === 'float').length;
    const box = saved[m.id]?.box || {
      w: m.panel.width,
      h: m.panel.height + HEAD_H,
      x: window.innerWidth - m.panel.width - 24 - index * 28,
      y: 70 + index * 28,
    };
    place(panel, box);
    front(panel);

    const entry = { mode: 'float', m, el: panel, mount: null };
    entry.mount = mountModule({
      module: { id: m.id, version: m.version, scope: m.scope },
      frame: panel.querySelector('iframe'),
      scope: 'room',
      roomId,
      guestToken,
      entry: m.panel.entry,
      onTitle: (title) => { panel.querySelector('[data-title]').textContent = title || m.name; },
      onResize: ({ width, height }) => {
        const b = currentBox(panel);
        if (Number.isFinite(width)) b.w = width;
        if (Number.isFinite(height)) b.h = height + HEAD_H;
        remember(m.id, { box: place(panel, b) });
      },
    });
    open.set(m.id, entry);

    // Drag by the header, resize by the grip, raise on any touch.
    let drag = null;
    const begin = (kind) => (event) => {
      if (event.target.closest('button')) return;
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
      remember(m.id, { box: currentBox(panel) });
    };
    for (const [el, kind] of [[panel.querySelector('.module-panel-head'), 'move'], [panel.querySelector('.module-panel-grip'), 'size']]) {
      el.addEventListener('pointerdown', begin(kind));
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    }
    panel.addEventListener('pointerdown', () => front(panel));
    wireHeader(panel, m);
  }

  const front = (panel) => { panel.style.zIndex = String(++z); };

  // --- docked ---------------------------------------------------------------

  function dockedEntries() {
    return [...open.values()].filter((o) => o.mode === 'dock');
  }

  // Docked modules are columns after the video and the chat: 3, 4, ...
  function syncDock() {
    const docked = dockedEntries();
    stage.style.setProperty('--dock-cols', docked.map((o) => `${o.width}px`).join(' '));
    docked.forEach((o, i) => {
      for (const el of o.section.children) el.style.gridColumn = String(3 + i);
    });
  }

  function dockWidth(m) {
    const max = Math.max(DOCK_MIN, Math.round(stage.clientWidth * 0.6));
    const want = saved[m.id]?.dockW || m.panel.width;
    return Math.min(Math.max(Math.round(want), DOCK_MIN), max);
  }

  function openDocked(m) {
    const section = document.createElement('section');
    section.className = 'module module-docked';
    section.dataset.module = m.id;
    section.innerHTML = `
      <div class="dock-resize" title="Drag to resize"></div>
      <div class="mod-content dock-content">
        <header class="mod-header">${headerHtml(m, { docked: true, canDock: false, canFloat: true })}</header>
        <iframe class="dock-frame" title="${escapeHtml(m.name)}"></iframe>
      </div>`;
    stage.appendChild(section);
    const entry = { mode: 'dock', m, el: section, section, mount: null, width: dockWidth(m) };
    entry.mount = mountModule({
      module: { id: m.id, version: m.version, scope: m.scope },
      frame: section.querySelector('iframe'),
      scope: 'room',
      roomId,
      guestToken,
      entry: m.panel.entry,
      onTitle: (title) => { section.querySelector('[data-title]').textContent = title || m.name; },
    });
    open.set(m.id, entry);
    syncDock();

    // Drag the left edge to resize this column (leftwards widens it).
    const handle = section.querySelector('.dock-resize');
    let drag = null;
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      drag = { sx: event.clientX, w: entry.width };
      handle.classList.add('dragging');
      layer.classList.add('dragging');
      handle.setPointerCapture?.(event.pointerId);
      stage.classList.add('resizing-dock'); // frames swallow the pointer while dragging
    });
    handle.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const max = Math.max(DOCK_MIN, Math.round(stage.clientWidth * 0.6));
      entry.width = Math.min(Math.max(Math.round(drag.w + (drag.sx - event.clientX)), DOCK_MIN), max);
      syncDock();
    });
    const stop = () => {
      if (!drag) return;
      drag = null;
      handle.classList.remove('dragging');
      layer.classList.remove('dragging');
      stage.classList.remove('resizing-dock');
      remember(m.id, { dockW: entry.width });
    };
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
    wireHeader(section, m);
  }

  // --- opening, closing, switching -----------------------------------------

  const isNarrow = () => stage.classList.contains('narrow');

  function remember(id, patch) {
    saved[id] = { ...(saved[id] || {}), ...patch };
    persist();
  }

  // Docked if the module can be and there is room, else floating.
  function preferredMode(m) {
    if (isNarrow()) return 'float';
    const want = saved[m.id]?.mode;
    if (want && supports(m, want)) return want;
    return supports(m, 'dock') ? 'dock' : 'float';
  }

  function openPane(m, mode = preferredMode(m)) {
    if (open.has(m.id)) {
      const entry = open.get(m.id);
      if (entry.mode === 'float') front(entry.el);
      return;
    }
    if (mode === 'dock' && !supports(m, 'dock')) mode = 'float';
    if (mode === 'dock') openDocked(m); else openFloating(m);
    markModuleRead(m.id);
    update();
  }

  function closePane(id) {
    const entry = open.get(id);
    if (!entry) return;
    entry.mount.destroy();
    entry.el.remove();
    open.delete(id);
    syncDock();
    update();
  }

  function closeAll() {
    for (const id of [...open.keys()]) closePane(id);
    converted.clear();
    if (menu) menu.hidden = true;
  }

  function setMode(id, mode) {
    const entry = open.get(id);
    if (!entry || entry.mode === mode || !supports(entry.m, mode)) return;
    const m = entry.m;
    closePane(id);
    remember(id, { mode });
    openPane(m, mode);
  }

  // A module's own window: the same page a server page uses, in this room's scope.
  const windows = new Map();
  function popOut(id) {
    const entry = open.get(id);
    const m = entry?.m || available.find((x) => x.id === id);
    if (!m) return;
    const q = new URLSearchParams({ room: roomId, popout: '1' });
    if (guestToken) q.set('guest', guestToken);
    const width = Math.max(320, Math.min(m.panel.width, screen.availWidth));
    const height = Math.max(240, Math.min(m.panel.height + HEAD_H, screen.availHeight));
    const win = window.open(`/modules/${encodeURIComponent(m.id)}?${q}`, `tavern-module-${m.id}`, `popup,width=${width},height=${height}`);
    if (!win) return;
    windows.set(m.id, win);
    if (entry) closePane(m.id);
  }

  function wireHeader(el, m) {
    el.querySelector('[data-close]').addEventListener('click', () => closePane(m.id));
    el.querySelector('[data-popout]').addEventListener('click', () => popOut(m.id));
    el.querySelector('[data-mode]')?.addEventListener('click', (event) => setMode(m.id, event.currentTarget.dataset.mode));
  }

  // When the whole call is popped out into its own window the stage moves, and
  // a docked frame would have to reload inside it. Float them over the main
  // window instead, and dock them again when the call comes back.
  function stagePopped(active) {
    if (active) {
      for (const o of dockedEntries()) {
        converted.add(o.m.id);
        const m = o.m;
        closePane(m.id);
        openPane(m, 'float');
      }
    } else {
      for (const id of [...converted]) {
        converted.delete(id);
        const m = available.find((x) => x.id === id);
        if (m && open.get(id)?.mode === 'float' && supports(m, 'dock')) {
          closePane(id);
          openPane(m, 'dock');
        }
      }
    }
  }

  // --- the toolbar button and its menu -----------------------------------

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
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'modules-menu-item';
      b.dataset.module = m.id;
      b.classList.toggle('on', open.has(m.id));
      const n = unread[m.id] || 0;
      b.innerHTML = `<i class="fa-solid fa-${escapeHtml(m.icon)} fa-fw" aria-hidden="true"></i><span>${escapeHtml(m.name)}</span>${n ? `<span class="badge">${n > 9 ? '9+' : n}</span>` : ''}`;
      menu.appendChild(b);
    }
  }

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
    if (open.has(m.id)) closePane(m.id);
    else openPane(m);
    menu.hidden = true;
  });
  document.addEventListener('click', (event) => {
    if (menu && !menu.hidden && !event.target.closest('#modules-menu')) menu.hidden = true;
  });
  window.addEventListener('resize', () => {
    for (const o of open.values()) if (o.mode === 'float') place(o.el, currentBox(o.el));
  });

  // The modules on for this room and this viewer, or none (null = not in a room).
  async function refresh(id) {
    closeAll();
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
    closeAll,
    stagePopped,
    open: (id, mode) => { const m = available.find((x) => x.id === id); if (m) openPane(m, mode); },
    close: closePane,
    isOpen: (id) => open.has(id),
    modeOf: (id) => open.get(id)?.mode || null,
    setMode,
    popOut,
    list: () => available.slice(),
    // A notification's toast asks the call to open the module's pane.
    handleNotification(n) {
      if (n.scope !== 'room' || n.roomId !== roomId) return false;
      const m = available.find((x) => x.id === n.module);
      if (!m) return false;
      openPane(m);
      return true;
    },
  };
}
