import { nav } from '/nav-bar.js';
import { mountEnvironmentBanner } from '/environment-banner.js';

// Escapes text going into innerHTML -- a space's or the environment's name is an owner-set
// string, not something we generated, so it isn't safe to trust verbatim.
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Whether an account has every right in this environment: its owner, or the host admin signed in through their
// stand-in account (role `admin`, `hostAdmin: true`). The server decides the same way; this only picks what to show.
export const hasOwnerRights = (user) => Boolean(user) && ['owner', 'admin'].includes(user.role);
// The admin: the server's own (ADMIN_LOGIN on a single-environment install), or the host admin's stand-in (`hostAdmin`).
// Every right, but not an owner, and its role and sign-in are the server's or the host console's, not Manage's.
export const isAdminAccount = (user) => Boolean(user) && ['admin'].includes(user.role);

// The word a person reads for an account's role. Admin is not a role anyone is given: the server's admin reads
// "Admin", and the host admin's stand-in inside an environment reads "Host admin".
export function roleLabel(user) {
  if (!user) return '';
  if (user.hostAdmin) return 'Host admin';
  return { owner: 'Owner', member: 'Member', guest: 'Guest', admin: 'Admin' }[user.role] || String(user.role || '');
}

// The admin's Font Awesome list (Theme tab), as last loaded by loadBranding().
let ICONS = [];
export const getIcons = () => ICONS;
// Full class list for an icon id -- space link icons and the home icon are
// stored as ids into that list. Before the list has loaded, or for an id no
// longer in it, fall back rather than draw nothing.
export function iconClasses(id) {
  const found = ICONS.find((i) => i.id === id);
  if (found) return found.classes;
  return ICONS.length ? 'fa-solid fa-link' : `fa-solid fa-${id || 'link'}`;
}

// What a page keeps in the browser was keyed by the product's old name once; it is keyed by
// "app" now (the host is not the brand, see plans/plan-modules.md). Old keys are moved the first time any page loads, so
// nobody's layout, chat history or remembered choices are lost. A key moves only when its new name is still empty, and
// the old one is deleted either way.
function moveStoredKey(storage, from, to) {
  const old = storage.getItem(from);
  if (old === null) return;
  if (storage.getItem(to) === null) storage.setItem(to, old);
  storage.removeItem(from);
}
function migrateStoredKeys() {
  try {
    for (const key of Object.keys(localStorage)) {
      const m = /^tavern([.:])(.*)$/.exec(key); // the old product name, read only to move the key
      if (m) moveStoredKey(localStorage, key, `app${m[1]}${m[2]}`);
    }
    // Keys renamed by the Names plan, read only to move them: the call's preferences (step 3), and each space's
    // remembered canvas (step 5b; `app.panels` alone is the layout from before layouts were kept per space). The chat
    // keys (app:chat:<id>:..., app:chatclear:<id>:...) keep their names: a space's id did not change.
    const moves = { 'host.table': 'app.call', 'app.panels': 'app.canvas' };
    for (const [from, to] of Object.entries(moves)) moveStoredKey(localStorage, from, to);
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('app.panels.')) moveStoredKey(localStorage, key, `app.canvas.${key.slice('app.panels.'.length)}`);
    }
  } catch {
    // no storage: nothing to move
  }
  try {
    moveStoredKey(sessionStorage, 'host.room', 'app.space'); // the space this tab was in, rejoined on a reload (step 5b)
  } catch {
    // no storage: nothing to move
  }
}
migrateStoredKeys();

// Fills in the environment's name and icon on every page from /api/branding.
export async function loadBranding() {
  let b = { environmentName: 'Coffee Pub', loginText: '', hasIcon: false };
  try {
    const res = await fetch('/api/branding');
    if (res.ok) b = await res.json();
  } catch (err) {
    // keep the defaults
  }
  ICONS = Array.isArray(b.icons) ? b.icons : [];
  clockHour12 = b.clock !== '24';
  if (byId('topbar-clock')) startClock();
  qsa('[data-brand="environmentName"]').forEach((el) => (el.textContent = b.environmentName));
  qsa('[data-brand="home-icon"]').forEach((el) => {
    el.className = `${iconClasses(b.homeIcon || 'couch')} fa-fw`;
    el.dataset.iconId = b.homeIcon || 'couch';
  });
  document.querySelectorAll('[data-brand="loginText"]').forEach((el) => (el.textContent = b.loginText));
  document.querySelectorAll('[data-brand="version"]').forEach((el) => (el.textContent = b.version || ''));
  // The page's own title ("Sign in", "Manage", or "<old server name> - Manage" on a second load) gets the server's name in front.
  const parts = document.title.split(' - ');
  const page = parts.length > 1 ? parts.slice(1).join(' - ') : ['Coffee Pub', b.environmentName].includes(document.title.trim()) ? '' : document.title.trim();
  document.title = page ? `${b.environmentName} - ${page}` : b.environmentName;
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

// One header, built once here, used by every page including the call page
// itself -- space.html included, its live-call controls (Leave, Pull
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
  // Opened as an overlay iframe (see openOverlay() in space.js), the parent
  // page already knows the environment's real name and icon -- passing them along
  // means the very first paint gets it right, instead of flashing the
  // generic default while this page's own loadBranding() fetch is in
  // flight (barely noticeable on a real navigation, jarring in an iframe
  // that appears almost instantly).
  const handoff = new URLSearchParams(window.location.search);
  const initialName = handoff.get('environmentName') || 'Coffee Pub';
  const initialIcon = handoff.get('homeIcon') || 'couch';
  // The primary nav is about the system, in three zones (see documentation/plans/plan-nav.md and architecture-navigation.md):
  // left, the logo (home) and where you are; middle, the core navigation (the spaces, each module's own page); right, the
  // system's actions (your profile, Manage, Install, Sign out) and information (the time, on the server's clock).
  // The markup here is only what is not a tool: the logo, the crumb, the status, the menu button. Everything in the
  // middle and right zones is a registration in the nav-bar registry (public/nav-bar.js), the same shape a module's
  // tools take, so there is one drawing path.
  header.innerHTML = `
    <div class="nav-left brand">
      <a class="brand-home" href="/" target="_top" title="All spaces">
        <img data-brand="icon" alt="" class="icon">
        <i class="fa-solid fa-${initialIcon} fa-fw" data-icon-id="${escapeHtml(initialIcon)}" data-brand="home-icon" aria-hidden="true"></i>
        <span data-brand="environmentName">${escapeHtml(initialName)}</span>
      </a>
      <nav class="crumb" id="topbar-crumb"></nav>
      <span class="status topbar-status" id="topbar-status"></span>
    </div>
    <nav class="nav-middle core-nav" id="core-nav" aria-label="Core navigation"></nav>
    <nav class="nav-right links"></nav>
    <button class="icon-link nav-toggle" id="nav-toggle" type="button" title="Menu" aria-label="Menu" aria-expanded="false"><i class="fa-solid fa-bars fa-fw" aria-hidden="true"></i></button>
  `;
  nav.attach('primary', header);
  registerSystemTools(header, initialIcon, adminHref);
  wireNavMenu(header);
  setTopbarLocation(location);
  wireInstall();
  loadModuleNav();
  startClock();
  loadUpdateBadge();
  startPresence();
  startNotifications();
  mountEnvironmentBanner(); // an owner's past-due line under the header, on a hosted environment only
}

// The system's own tools, in the bands plan-nav.md sets out (1-10 core, 11-50 secondary, 51-100 utility, 999 last), so a
// module's own (101-998) always draw after them. The middle zone is one group, the core navigation; the right zone is
// three: who you are, what you can do from anywhere, and the session (the time, then Sign out), a divider between each.
// The profile link and the clock are the page's own elements the registry places (their look is theirs, not a button's).
function registerSystemTools(header, initialIcon, adminHref) {
  const doc = header.ownerDocument;
  const spaces = nav.register({ id: 'spaces-link', bar: 'primary', zone: 'middle', group: 'core', groupOrder: 1, order: 1, icon: initialIcon, label: 'Spaces', title: 'All spaces', href: '/', target: '_top' });
  spaces.querySelector('i').dataset.brand = 'home-icon'; // loadBranding() swaps in the server's own home icon
  const whoami = doc.createElement('a');
  whoami.className = 'whoami';
  whoami.id = 'whoami-link';
  whoami.href = '/profile';
  whoami.title = 'Your profile';
  whoami.innerHTML = '<img id="whoami-img" alt="" hidden><span id="whoami"></span>';
  nav.register({ id: 'whoami-link', bar: 'primary', zone: 'right', group: 'you', groupOrder: 1, order: 1, element: whoami });
  // Manage: each page shows it once it knows the viewer is an admin (its own `hidden`), so no `visible` here.
  nav.register({ id: 'admin-link', bar: 'primary', zone: 'right', group: 'system', groupOrder: 11, order: 11, icon: 'gear', label: 'Manage', href: adminHref }).hidden = true;
  nav.register({ id: 'install-link', bar: 'primary', zone: 'right', group: 'system', groupOrder: 11, order: 12, icon: 'download', label: 'Install as an app', visible: () => Boolean(installPromptEvent), onClick: installFromPrompt });
  const clock = doc.createElement('span');
  clock.className = 'topbar-clock';
  clock.id = 'topbar-clock';
  clock.title = 'The time';
  nav.register({ id: 'topbar-clock', bar: 'primary', zone: 'right', group: 'session', groupOrder: 51, order: 51, element: clock });
  nav.register({ id: 'logout-link', bar: 'primary', zone: 'right', group: 'session', groupOrder: 51, order: 52, icon: 'right-from-bracket', label: 'Sign out', href: '/logout' });
}

// The time, in the primary nav's right zone, on the server's clock (12- or 24-hour: Manage > Settings > Language, time and
// money, which loadBranding() reads). Kept to the minute.
let clockTimer = null;
let clockHour12 = true;
function startClock() {
  const draw = () => {
    const el = byId('topbar-clock');
    if (el) el.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: clockHour12 });
  };
  draw();
  clearInterval(clockTimer);
  clockTimer = setInterval(draw, 15000);
}

// On a phone the header's links are a menu (see the phone header rules in style.css): the button
// opens them, and a tap anywhere else or Escape closes them. The core navigation (the middle zone) has no
// space on a phone, so the registry draws its tools into the menu there, and back to the middle when the
// window widens (nav-bar.js watches the same width).
function wireNavMenu(header) {
  const toggle = header.querySelector('#nav-toggle');
  const setOpen = (on) => {
    header.classList.toggle('menu-open', on);
    toggle.setAttribute('aria-expanded', String(on));
  };
  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    setOpen(!header.classList.contains('menu-open'));
  });
  header.ownerDocument.addEventListener('click', (event) => {
    if (!event.target.closest('#nav-toggle')) setOpen(false);
  });
  header.ownerDocument.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setOpen(false);
  });
}

// --- module notifications ----------------------------------------------------
// A module can notify people (its reminders, say). They arrive as a toast
// while you are in the host and as an unread count on the module's nav item and
// on the call's Modules button; opening the module clears them. Overlay pages
// opened over a call (?from=space) leave this to the call page underneath.
const unreadByModule = {};

function paintUnread() {
  for (const link of qsa('.module-nav-link')) nav.setBadge(`page-${link.dataset.module}`, unreadByModule[link.dataset.module] || 0);
  document.dispatchEvent(new CustomEvent('app:unread', { detail: { ...unreadByModule } }));
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
    // The call page handles opening a space module's panel; anything else goes to the module's page.
    const handled = !document.dispatchEvent(new CustomEvent('app:notification', { detail: n, cancelable: true }));
    if (!handled && n.scope === 'environment') window.location.href = `/modules/${encodeURIComponent(n.module)}`;
    dismiss();
  });
  layer.appendChild(toast);
  setTimeout(dismiss, 9000);
}

async function startNotifications() {
  if (new URLSearchParams(window.location.search).get('from') === 'space') return;
  try {
    const res = await fetch('/api/notifications');
    if (!res.ok) return;
    Object.assign(unreadByModule, (await res.json()).byModule);
    paintUnread();
  } catch {
    return;
  }
  const source = new EventSource('/api/notifications/stream');
  // Someone asked you into a private conversation: join, or decline.
  source.addEventListener('invite', (ev) => {
    try {
      showInvite(JSON.parse(ev.data));
    } catch {
      // ignore a malformed event
    }
  });
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

// Tell the server this page is open (every half minute, and when it comes back into view), so the dashboard's
// Who's around can show who is online, not only who is in a space. Not in an overlay over a call: that page's
// own page is already doing it.
function startPresence() {
  if (new URLSearchParams(window.location.search).get('from') === 'space') return;
  const beat = () => {
    if (document.visibilityState === 'visible') fetch('/api/presence', { method: 'POST' }).catch(() => {});
  };
  beat();
  setInterval(beat, 30000);
  document.addEventListener('visibilitychange', beat);
}

// The toast for an invitation: who asked, and Join or Decline. The page can take it (the space page joins in place);
// any other page goes to the spaces page, which joins.
function showInvite(invite) {
  let layer = document.getElementById('toast-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'toast-layer';
    layer.className = 'toast-layer';
    document.body.appendChild(layer);
  }
  const toast = document.createElement('div');
  toast.className = 'toast toast-invite';
  toast.setAttribute('role', 'alert');
  toast.innerHTML = `<i class="fa-solid fa-people-arrows fa-fw toast-icon" aria-hidden="true"></i><span class="toast-text"><strong>${escapeHtml(invite.fromName || 'Someone')} invites you to talk</strong><span class="toast-body">A private conversation, off the record.</span><span class="toast-actions"><button type="button" class="btn btn-primary btn-small" data-invite="join">Join</button><button type="button" class="btn btn-small" data-invite="decline">Decline</button></span></span>`;
  const dismiss = () => toast.remove();
  toast.addEventListener('click', (e) => {
    const b = e.target.closest('[data-invite]');
    if (!b) return;
    if (b.dataset.invite === 'join') {
      const taken = !document.dispatchEvent(new CustomEvent('app:invite-accept', { detail: invite, cancelable: true }));
      if (!taken) window.location.href = `/#join=${encodeURIComponent(invite.spaceId)}`;
    } else {
      fetch(`/api/asides/invite/${encodeURIComponent(invite.id)}/decline`, { method: 'POST' }).catch(() => {});
    }
    dismiss();
  });
  layer.appendChild(toast);
  setTimeout(dismiss, 60000);
}

// A count on the settings gear when modules that ship with this server have a newer version than the one
// installed, so an admin sees it without opening Manage. Only an admin can ask (anyone else gets a refusal
// and no badge); the Manage page calls setUpdateBadge again when it installs an update.
export function setUpdateBadge(count) {
  const link = byId('admin-link');
  if (!link) return;
  const base = link.getAttribute('data-title') || link.title;
  link.setAttribute('data-title', base);
  nav.setBadge('admin-link', count);
  const text = count ? `${base}: ${count} module update${count === 1 ? '' : 's'} available` : base;
  link.title = text;
  link.setAttribute('aria-label', text);
}
async function loadUpdateBadge() {
  try {
    const res = await fetch('/api/modules');
    if (!res.ok) return;
    const { bundled } = await res.json();
    setUpdateBadge((bundled || []).filter((b) => b.update).length);
  } catch {
    // no badge is fine
  }
}

// Modules with a page of their own get an item in the header: a tool in the core navigation, after Spaces, in the
// secondary band (11-50) so the system's own core items stay ahead. Opened from inside a call they use the same
// in-page overlay as the profile, so the call keeps running (see openOverlay in space.js).
async function loadModuleNav() {
  if (!nav.has('primary')) return;
  try {
    const res = await fetch('/api/modules/nav');
    if (!res.ok) return;
    const { modules } = await res.json();
    const keep = new URLSearchParams(window.location.search).get('from') === 'space' ? window.location.search : '';
    // A module with a dashboard widget is reached from the widget's heading, so it has no item here; one
    // that opted out (surfaces.page.nav: false, reached some other way -- a space's own pane) has none
    // either; anything else does, so nothing becomes unreachable.
    const listed = modules.filter((m) => !m.widget && m.nav);
    nav.unregisterAll('page-');
    listed.forEach((m, i) => {
      const el = nav.register({ id: `page-${m.id}`, bar: 'primary', zone: 'middle', group: 'core', order: Math.min(50, 11 + i), icon: m.icon, label: m.name, href: `/modules/${encodeURIComponent(m.id)}${keep}` });
      el.classList.add('module-nav-link'); // hidden on the call page, where the space's own module selector is the way in
      el.dataset.module = m.id;
      el.dataset.overlayLink = '';
    });
    document.dispatchEvent(new CustomEvent('module-nav-loaded', { detail: modules }));
  } catch {
    // no nav is fine
  }
}

// The crumb zone: plain text for "you're already here" (Spaces, Profile,
// Manage), or markup with its own buttons for a page that offers
// actions from right where it says where you are (a space's own Leave, an
// aside's own Rejoin Call) -- see space.js's updateCrumb() for the one page
// that actually changes this after the initial render.
// One crumb segment that goes somewhere. Opened as an overlay over a call
// (?from=space), the link keeps that query so the next page still knows to
// offer its "Back" button instead of quietly turning into a normal page.
// The header icon for a space: the launch-link icon the space picked, or the
// plain message icon when it has not picked one ('link' is the default).
export function spaceCrumbIcon(space) {
  return space?.linkIcon && space.linkIcon !== 'link' ? iconClasses(space.linkIcon) : 'fa-solid fa-message';
}

export function crumbLink(icon, label, href) {
  const params = new URLSearchParams(window.location.search);
  const keep = params.get('from') === 'space' ? window.location.search : '';
  const [path, hash] = href.split('#');
  return `<a class="crumb-here" href="${path}${keep}${hash ? '#' + hash : ''}"><i class="${icon.includes(' ') ? icon : `fa-solid fa-${icon}`} fa-fw" aria-hidden="true"></i><span class="crumb-label"> ${escapeHtml(label)}</span></a>`;
}

export function setTopbarLocation(html) {
  const crumb = byId('topbar-crumb');
  if (crumb) crumb.innerHTML = html ? `<span class="crumb-sep">&rsaquo;</span>${html}` : '';
}

// Chrome/Edge's "Install as an app" prompt -- a chromeless window (Settings
// > Install, or here) with none of a browser tab's own address bar or tab
// strip. Shared so any page can offer it, not just the call page.
// The Install tool's `visible` reads installPromptEvent, so the bar is redrawn when it changes.
let installPromptEvent = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPromptEvent = event;
  nav.draw('primary');
});
function wireInstall() {
  nav.draw('primary');
}
async function installFromPrompt() {
  if (!installPromptEvent) return;
  installPromptEvent.prompt();
  await installPromptEvent.userChoice.catch(() => {});
  installPromptEvent = null;
  nav.draw('primary');
}

// A page opened with the server's access key instead of a sign-in (a module's keyed page, /view/<key>?s=...):
// every call the page makes carries the key, so nothing here needs a session.
let accessKey = '';
export function setAccessKey(key) {
  accessKey = String(key || '');
}
export function accessKeyHeaders() {
  return accessKey ? { 'x-stream-key': accessKey } : {};
}

export async function api(method, url, body, contentType) {
  const headers = accessKeyHeaders();
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

// Your profile or Manage, opened from inside a call (space.js loads either
// one in an iframe rather than navigating away, so the call underneath
// keeps running). Adds a "Back to [space]" link to this page's own header,
// which closes the overlay via the parent window -- same origin, so a
// direct call, no postMessage plumbing needed. A page that isn't "about"
// the space itself (Manage, say) can pass its own label instead of the
// space's name.
export function wireOverlayBack(label) {
  const params = new URLSearchParams(location.search);
  if (params.get('from') !== 'space' || window.parent === window) return;
  const nav = document.querySelector('.topbar nav.links');
  if (!nav) return;
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'btn btn-small';
  const spaceName = params.get('spaceName');
  back.textContent = label ? `← Back to ${label}` : spaceName ? `← Back to ${spaceName}` : '← Back';
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
