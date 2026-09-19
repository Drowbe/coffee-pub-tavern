// Room modules: the Modules button on the call's toolbar, its menu, and the
// floating panels a room's modules open in. Panels live in their own layer on
// the main page (not in the stage), so they stay put when the call is popped
// out. Each panel is a sandboxed frame driven by module-host.js.

import { api, markModuleRead } from '/brand.js';
import { mountModule } from '/module-host.js';

const STORE_KEY = 'tavern.panels';
const MIN_W = 240;
const MIN_H = 160;
const HEAD_H = 34;

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createRoomModules({ guestToken = null } = {}) {
  const layer = document.createElement('div');
  layer.id = 'module-layer';
  layer.className = 'module-layer';
  document.body.appendChild(layer);

  const toggle = document.getElementById('modules-toggle');
  const menu = document.getElementById('modules-menu');
  const saved = loadSaved();
  const open = new Map(); // module id -> { panel, mount }
  let roomId = null;
  let available = [];
  let z = 40;
  let unread = {}; // module id -> unread notifications, from brand.js

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(saved));
    } catch {
      // private mode: panels still work, they just do not remember where they were
    }
  }

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

  function currentBox(panel) {
    return { x: panel.offsetLeft, y: panel.offsetTop, w: panel.offsetWidth, h: panel.offsetHeight };
  }

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

  function closePanel(id) {
    const entry = open.get(id);
    if (!entry) return;
    entry.mount.destroy();
    entry.panel.remove();
    open.delete(id);
    update();
  }

  function closeAll() {
    for (const id of [...open.keys()]) closePanel(id);
    if (menu) menu.hidden = true;
  }

  function front(panel) {
    panel.style.zIndex = String(++z);
  }

  function openPanel(m) {
    if (open.has(m.id)) {
      front(open.get(m.id).panel);
      return;
    }
    const panel = document.createElement('section');
    panel.className = 'module-panel';
    panel.dataset.module = m.id;
    panel.innerHTML = `
      <header class="module-panel-head">
        <span class="module-panel-title"><i class="fa-solid fa-${escapeHtml(m.icon)} fa-fw" aria-hidden="true"></i> <span data-title>${escapeHtml(m.name)}</span></span>
        <button class="msg-btn" data-close type="button" title="Close" aria-label="Close"><i class="fa-solid fa-xmark fa-fw" aria-hidden="true"></i></button>
      </header>
      <iframe class="module-panel-frame" title="${escapeHtml(m.name)}"></iframe>
      <span class="module-panel-grip" title="Drag to resize"></span>`;
    layer.appendChild(panel);
    const index = open.size;
    const start = saved[m.id] || {
      w: m.panel.width,
      h: m.panel.height + HEAD_H,
      x: window.innerWidth - m.panel.width - 24 - index * 28,
      y: 70 + index * 28,
    };
    place(panel, start);
    front(panel);

    const frame = panel.querySelector('iframe');
    const mount = mountModule({
      module: { id: m.id, version: m.version, scope: m.scope },
      frame,
      scope: 'room',
      roomId,
      guestToken,
      entry: m.panel.entry,
      onTitle: (title) => { panel.querySelector('[data-title]').textContent = title || m.name; },
      onResize: ({ width, height }) => {
        const box = currentBox(panel);
        if (Number.isFinite(width)) box.w = width;
        if (Number.isFinite(height)) box.h = height + HEAD_H;
        saved[m.id] = place(panel, box);
        persist();
      },
    });
    open.set(m.id, { panel, mount });
    markModuleRead(m.id);

    // Drag by the header, resize by the grip, raise on any touch.
    let drag = null;
    const begin = (kind) => (event) => {
      if (event.target.closest('[data-close]')) return;
      event.preventDefault();
      drag = { kind, sx: event.clientX, sy: event.clientY, box: currentBox(panel) };
      layer.classList.add('dragging'); // frames swallow pointer events; switch them off while dragging
      event.currentTarget.setPointerCapture(event.pointerId);
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
      saved[m.id] = currentBox(panel);
      persist();
    };
    for (const [el, kind] of [[panel.querySelector('.module-panel-head'), 'move'], [panel.querySelector('.module-panel-grip'), 'size']]) {
      el.addEventListener('pointerdown', begin(kind));
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    }
    panel.addEventListener('pointerdown', () => front(panel));
    panel.querySelector('[data-close]').addEventListener('click', () => closePanel(m.id));
    update();
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
    if (open.has(m.id)) closePanel(m.id);
    else openPanel(m);
    menu.hidden = true;
  });
  document.addEventListener('click', (event) => {
    if (menu && !menu.hidden && !event.target.closest('#modules-menu')) menu.hidden = true;
  });
  window.addEventListener('resize', () => {
    for (const { panel } of open.values()) place(panel, currentBox(panel));
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
    open: (id) => { const m = available.find((x) => x.id === id); if (m) openPanel(m); },
    close: closePanel,
    isOpen: (id) => open.has(id),
    list: () => available.slice(),
    // A notification's toast asks the call to open the module's panel.
    handleNotification(n) {
      if (n.scope !== 'room' || n.roomId !== roomId) return false;
      const m = available.find((x) => x.id === n.module);
      if (!m) return false;
      openPanel(m);
      return true;
    },
  };
}
