// Escapes text going into innerHTML -- a room or server name is an admin-set
// string, not something we generated, so it isn't safe to trust verbatim.
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
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
  document.querySelectorAll('[data-brand="serverName"]').forEach((el) => (el.textContent = b.serverName));
  document.querySelectorAll('[data-brand="home-icon"]').forEach((el) => (el.className = `fa-solid fa-${b.homeIcon || 'couch'} fa-fw`));
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
export function renderTopbar({ location = '', adminHref = '/admin' } = {}) {
  const header = document.querySelector('.topbar');
  if (!header) return;
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
        <i class="fa-solid fa-${initialIcon} fa-fw" data-brand="home-icon" aria-hidden="true"></i>
        <span data-brand="serverName">${escapeHtml(initialName)}</span>
      </a>
      <nav class="crumb" id="topbar-crumb"></nav>
      <button class="btn btn-small" id="recall-button" type="button" title="Give everyone in a Private Conversation from this room a 10 second warning, then pull them back" hidden><i class="fa-solid fa-people-arrows fa-fw" aria-hidden="true"></i> Pull Participants Back</button>
      <span class="status topbar-status" id="topbar-status"></span>
    </div>
    <nav class="links">
      <a class="whoami" href="/profile" id="whoami-link" title="Your profile"><img id="whoami-img" alt="" hidden><span id="whoami"></span></a>
      <span class="nav-divider"></span>
      <a class="icon-link" href="/" target="_top" id="rooms-link" title="All rooms" aria-label="All rooms"><i class="fa-solid fa-${initialIcon} fa-fw" data-brand="home-icon" aria-hidden="true"></i></a>
      <a class="icon-link" href="${adminHref}" id="admin-link" title="Manage" aria-label="Manage" hidden><i class="fa-solid fa-gear fa-fw" aria-hidden="true"></i></a>
      <button class="icon-link" id="install-link" type="button" title="Install as an app" aria-label="Install as an app" hidden><i class="fa-solid fa-download fa-fw" aria-hidden="true"></i></button>
      <a class="icon-link" href="/logout" id="logout-link" title="Sign out" aria-label="Sign out"><i class="fa-solid fa-right-from-bracket fa-fw" aria-hidden="true"></i></a>
    </nav>
  `;
  setTopbarLocation(location);
  wireInstall();
}

// The crumb zone: plain text for "you're already here" (Rooms, Profile,
// Server Settings), or markup with its own buttons for a page that offers
// actions from right where it says where you are (a room's own Leave, an
// aside's own Rejoin Call) -- see room.js's updateCrumb() for the one page
// that actually changes this after the initial render.
export function setTopbarLocation(html) {
  const crumb = document.getElementById('topbar-crumb');
  if (crumb) crumb.innerHTML = html ? `<span class="crumb-sep">&rsaquo;</span>${html}` : '';
}

// Chrome/Edge's "Install as an app" prompt -- a chromeless window (Settings
// > Install, or here) with none of a browser tab's own address bar or tab
// strip. Shared so any page can offer it, not just the table.
let installPromptEvent = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPromptEvent = event;
  document.getElementById('install-link')?.removeAttribute('hidden');
});
function wireInstall() {
  if (installPromptEvent) document.getElementById('install-link')?.removeAttribute('hidden');
  document.getElementById('install-link')?.addEventListener('click', async () => {
    if (!installPromptEvent) return;
    installPromptEvent.prompt();
    await installPromptEvent.userChoice.catch(() => {});
    installPromptEvent = null;
    document.getElementById('install-link')?.setAttribute('hidden', '');
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
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
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
