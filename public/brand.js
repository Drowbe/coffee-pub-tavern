// Escapes text going into innerHTML -- a room or server name is an admin-set
// string, not something we generated, so it isn't safe to trust verbatim.
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// The admin's Font Awesome list (Theme tab), as last loaded by loadBranding().
let ICONS = [];
export const getIcons = () => ICONS;
// Full class list for an icon id -- room link icons and the home icon are
// stored as ids into that list. Before the list has loaded, or for an id no
// longer in it, fall back rather than draw nothing.
export function iconClasses(id) {
  const found = ICONS.find((i) => i.id === id);
  if (found) return found.classes;
  return ICONS.length ? 'fa-solid fa-link' : `fa-solid fa-${id || 'link'}`;
}

// Fills in the server name and icon on every page from /api/branding.
export async function loadBranding() {
  let b = { serverName: 'Coffee Pub Tavern', tableName: 'The Table', loginText: '', hasIcon: false };
  try {
    const res = await fetch('/api/branding');
    if (res.ok) b = await res.json();
  } catch (err) {
    // keep the defaults
  }
  ICONS = Array.isArray(b.icons) ? b.icons : [];
  qsa('[data-brand="serverName"]').forEach((el) => (el.textContent = b.serverName));
  qsa('[data-brand="home-icon"]').forEach((el) => {
    el.className = `${iconClasses(b.homeIcon || 'couch')} fa-fw`;
    el.dataset.iconId = b.homeIcon || 'couch';
  });
  document.querySelectorAll('[data-brand="tableName"]').forEach((el) => (el.textContent = b.tableName));
  document.querySelectorAll('[data-brand="loginText"]').forEach((el) => (el.textContent = b.loginText));
  document.querySelectorAll('[data-brand="version"]').forEach((el) => (el.textContent = b.version || ''));
  const suffix = document.title.split(' - ').slice(1).join(' - ');
  document.title = suffix ? `${b.serverName} - ${suffix}` : b.serverName;
  let icon = document.querySelector('link[rel="icon"]');
  if (!icon) {
    icon = document.createElement('link');
    icon.rel = 'icon';
    document.head.appendChild(icon);
  }
  icon.href = `/img/site/icon?v=${Date.now()}`;
  document.querySelectorAll('img[data-brand="icon"]').forEach((el) => (el.src = icon.href));
  // A page marked data-brand="background" (the sign-in page) gets the
  // background picture when one is set. It goes on the root element: the
  // root has its own colour, so a picture on the body would stop at the
  // body's box and leave the collapsed margin above the sign-in box bare.
  if (document.querySelector('[data-brand="background"]')) {
    const root = document.documentElement;
    root.classList.toggle('has-background', Boolean(b.hasBackground));
    root.style.backgroundImage = b.hasBackground ? `url("/img/site/background?v=${Date.now()}")` : '';
  }
  return b;
}

// One header, built once here, used by every page including the table
// itself -- room.html included, its live-call controls (Leave, Pull
// Participants Back) folded in through the "location and actions" crumb
// zone (see setTopbarLocation()) rather than kept as a bespoke header of
// its own. Four zones, left to right: the server icon and name (always
// the same), the crumb (changes with where you are and what you can do
// from here), and the global nav (always the same, on every page,
// regardless of which of those icons is the page you're already on).
// The header can be moved to the popped-out window with the rest of the app, so its parts are
// looked up inside it as well as in this document.
let headerEl = null;
const qsa = (sel) => [...new Set([...document.querySelectorAll(sel), ...(headerEl ? headerEl.querySelectorAll(sel) : [])])];
const byId = (id) => document.getElementById(id) || headerEl?.querySelector(`#${id}`) || null;

export function renderTopbar({ location = '', adminHref = '/admin' } = {}) {
  const header = document.querySelector('.topbar');
  if (!header) return;
  headerEl = header;
  // Opened as an overlay iframe (see openOverlay() in room.js), the parent
  // page already knows the real server name and icon -- passing them along
  // means the very first paint gets it right, instead of flashing the
  // generic default while this page's own loadBranding() fetch is in
  // flight (barely noticeable on a real navigation, jarring in an iframe
  // that appears almost instantly).
  const handoff = new URLSearchParams(window.location.search);
  const initialName = handoff.get('serverName') || 'Coffee Pub Tavern';
  const initialIcon = handoff.get('homeIcon') || 'couch';
  header.innerHTML = `
    <div class="brand">
      <a class="brand-home" href="/" target="_top" title="All rooms">
        <img data-brand="icon" alt="" class="icon">
        <i class="fa-solid fa-${initialIcon} fa-fw" data-icon-id="${escapeHtml(initialIcon)}" data-brand="home-icon" aria-hidden="true"></i>
        <span data-brand="serverName">${escapeHtml(initialName)}</span>
      </a>
      <nav class="crumb" id="topbar-crumb"></nav>
      <button class="btn btn-small" id="recall-button" type="button" title="Give everyone in a Private Conversation from this room a 10 second warning, then pull them back" hidden><i class="fa-solid fa-people-arrows fa-fw" aria-hidden="true"></i> Pull Participants Back</button>
      <span class="status topbar-status" id="topbar-status"></span>
    </div>
    <nav class="links">
      <a class="whoami" href="/profile" id="whoami-link" title="Your profile"><img id="whoami-img" alt="" hidden><span id="whoami"></span></a>
      <span class="nav-divider"></span>
      <span class="module-nav" id="module-nav"></span>
      <a class="icon-link" href="/" target="_top" id="rooms-link" title="All rooms" aria-label="All rooms"><i class="fa-solid fa-${initialIcon} fa-fw" data-brand="home-icon" aria-hidden="true"></i></a>
      <a class="icon-link" href="${adminHref}" id="admin-link" title="Manage" aria-label="Manage" hidden><i class="fa-solid fa-gear fa-fw" aria-hidden="true"></i></a>
      <button class="icon-link" id="install-link" type="button" title="Install as an app" aria-label="Install as an app" hidden><i class="fa-solid fa-download fa-fw" aria-hidden="true"></i></button>
      <span class="nav-group" id="room-nav"></span>
      <span class="nav-divider"></span>
      <a class="icon-link" href="/logout" id="logout-link" title="Sign out" aria-label="Sign out"><i class="fa-solid fa-right-from-bracket fa-fw" aria-hidden="true"></i></a>
    </nav>
  `;
  setTopbarLocation(location);
  wireInstall();
  loadModuleNav();
  startNotifications();
}

// --- module notifications ----------------------------------------------------
// A module can notify people (its reminders, say). They arrive as a toast
// while you are in Tavern and as an unread count on the module's nav item and
// on the call's Modules button; opening the module clears them. Overlay pages
// opened over a call (?from=room) leave this to the call page underneath.
const unreadByModule = {};

function paintUnread() {
  for (const link of qsa('.module-nav-link')) {
    const n = unreadByModule[link.dataset.module] || 0;
    let badge = link.querySelector('.nav-badge');
    if (!n) { badge?.remove(); continue; }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'nav-badge';
      link.appendChild(badge);
    }
    badge.textContent = n > 9 ? '9+' : String(n);
  }
  document.dispatchEvent(new CustomEvent('tavern:unread', { detail: { ...unreadByModule } }));
}
document.addEventListener('module-nav-loaded', paintUnread);

export async function markModuleRead(moduleId) {
  unreadByModule[moduleId] = 0;
  paintUnread();
  try {
    await api('POST', '/api/notifications/read', { module: moduleId });
  } catch {
    // the count clears next load
  }
}

function showToast(n) {
  let layer = document.getElementById('toast-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'toast-layer';
    layer.className = 'toast-layer';
    document.body.appendChild(layer);
  }
  const toast = document.createElement('button');
  toast.type = 'button';
  toast.className = 'toast';
  toast.innerHTML = `<i class="fa-solid fa-${escapeHtml(n.icon || 'bell')} fa-fw toast-icon" aria-hidden="true"></i><span class="toast-text"><strong>${escapeHtml(n.title)}</strong>${n.body ? `<span class="toast-body">${escapeHtml(n.body)}</span>` : ''}<span class="toast-from">${escapeHtml(n.moduleName || '')}</span></span>`;
  const dismiss = () => toast.remove();
  toast.addEventListener('click', () => {
    // The call page handles opening a room module's panel; anything else goes to the module's page.
    const handled = !document.dispatchEvent(new CustomEvent('tavern:notification', { detail: n, cancelable: true }));
    if (!handled && n.scope === 'server') window.location.href = `/modules/${encodeURIComponent(n.module)}`;
    dismiss();
  });
  layer.appendChild(toast);
  setTimeout(dismiss, 9000);
}

async function startNotifications() {
  if (new URLSearchParams(window.location.search).get('from') === 'room') return;
  try {
    const res = await fetch('/api/notifications');
    if (!res.ok) return;
    Object.assign(unreadByModule, (await res.json()).byModule);
    paintUnread();
  } catch {
    return;
  }
  const source = new EventSource('/api/notifications/stream');
  source.addEventListener('notification', (ev) => {
    try {
      const n = JSON.parse(ev.data);
      unreadByModule[n.module] = (unreadByModule[n.module] || 0) + 1;
      paintUnread();
      showToast(n);
    } catch {
      // ignore a malformed event
    }
  });
}

// Modules with a page of their own get an item in the header. Opened from
// inside a call they use the same in-page overlay as the profile, so the call
// keeps running (see openOverlay in room.js).
async function loadModuleNav() {
  const slot = byId('module-nav');
  if (!slot) return;
  try {
    const res = await fetch('/api/modules/nav');
    if (!res.ok) return;
    const { modules } = await res.json();
    const keep = new URLSearchParams(window.location.search).get('from') === 'room' ? window.location.search : '';
    slot.innerHTML = modules.map((m) => `<a class="module-nav-link" data-overlay-link data-module="${escapeHtml(m.id)}" href="/modules/${encodeURIComponent(m.id)}${keep}" title="${escapeHtml(m.name)}"><i class="fa-solid fa-${escapeHtml(m.icon)} fa-fw" aria-hidden="true"></i><span class="module-nav-label"> ${escapeHtml(m.name)}</span></a>`).join('');
    document.dispatchEvent(new CustomEvent('module-nav-loaded', { detail: modules }));
  } catch {
    // no nav is fine
  }
}

// The crumb zone: plain text for "you're already here" (Rooms, Profile,
// Server Settings), or markup with its own buttons for a page that offers
// actions from right where it says where you are (a room's own Leave, an
// aside's own Rejoin Call) -- see room.js's updateCrumb() for the one page
// that actually changes this after the initial render.
// One crumb segment that goes somewhere. Opened as an overlay over a call
// (?from=room), the link keeps that query so the next page still knows to
// offer its "Back" button instead of quietly turning into a normal page.
// The header icon for a room: the launch-link icon the room picked, or the
// plain message icon when it has not picked one ('link' is the default).
export function roomCrumbIcon(room) {
  return room?.linkIcon && room.linkIcon !== 'link' ? iconClasses(room.linkIcon) : 'fa-solid fa-message';
}

export function crumbLink(icon, label, href) {
  const params = new URLSearchParams(window.location.search);
  const keep = params.get('from') === 'room' ? window.location.search : '';
  const [path, hash] = href.split('#');
  return `<a class="crumb-here" href="${path}${keep}${hash ? '#' + hash : ''}"><i class="${icon.includes(' ') ? icon : `fa-solid fa-${icon}`} fa-fw" aria-hidden="true"></i><span class="crumb-label"> ${escapeHtml(label)}</span></a>`;
}

export function setTopbarLocation(html) {
  const crumb = byId('topbar-crumb');
  if (crumb) crumb.innerHTML = html ? `<span class="crumb-sep">&rsaquo;</span>${html}` : '';
}

// Chrome/Edge's "Install as an app" prompt -- a chromeless window (Settings
// > Install, or here) with none of a browser tab's own address bar or tab
// strip. Shared so any page can offer it, not just the table.
let installPromptEvent = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPromptEvent = event;
  byId('install-link')?.removeAttribute('hidden');
});
function wireInstall() {
  if (installPromptEvent) byId('install-link')?.removeAttribute('hidden');
  byId('install-link')?.addEventListener('click', async () => {
    if (!installPromptEvent) return;
    installPromptEvent.prompt();
    await installPromptEvent.userChoice.catch(() => {});
    installPromptEvent = null;
    byId('install-link')?.setAttribute('hidden', '');
  });
}

export async function api(method, url, body, contentType) {
  const headers = {};
  let payload = body;
  if (body !== undefined && !(body instanceof Blob)) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  } else if (body instanceof Blob) {
    headers['content-type'] = contentType || body.type;
  }
  const res = await fetch(url, { method, headers, body: payload });
  let data = {};
  try {
    data = await res.json();
  } catch (err) {
    data = {};
  }
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.current = data.current; // set on a 409 from the module data store
    throw err;
  }
  return data;
}

// Your profile or Manage, opened from inside a call (room.js loads either
// one in an iframe rather than navigating away, so the call underneath
// keeps running). Adds a "Back to [room]" link to this page's own header,
// which closes the overlay via the parent window -- same origin, so a
// direct call, no postMessage plumbing needed. A page that isn't "about"
// the room itself (Manage, say) can pass its own label instead of the
// room's name.
export function wireOverlayBack(label) {
  const params = new URLSearchParams(location.search);
  if (params.get('from') !== 'room' || window.parent === window) return;
  const nav = document.querySelector('.topbar nav.links');
  if (!nav) return;
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'btn btn-small';
  const room = params.get('room');
  back.textContent = label ? `← Back to ${label}` : room ? `← Back to ${room}` : '← Back';
  back.addEventListener('click', () => {
    try {
      window.parent.closeProfileOverlay?.();
    } catch (err) {
      // not actually framed by our own page for some reason; nothing to do
    }
  });
  nav.prepend(back);
}

export function initialsOf(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  const text = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] || '?').slice(0, 2);
  return text.toUpperCase();
}
