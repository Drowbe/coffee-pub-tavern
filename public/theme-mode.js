// Light and dark (GitHub #62): the header's switch, and keeping every open page on the right mode and theme without a
// reload.
//
// /theme.css carries both of the live theme's sets, each under its own <html data-theme-mode> (server/theme-css.js);
// a page with no attribute shows the default one: the signed-in person's own mode, else the environment's. So a switch
// is one attribute, set at once, on this page and on every window and frame it shares its look with:
//   - the windows made from /popout.html (the popped-out call, a built-in module's window), which clone this page's
//     stylesheets: they are told with followTheme(doc);
//   - a same-origin page in a frame (Profile or Manage opened over a call, ?from=space), which has no event stream of
//     its own: it is told through its own copy of this file (window.appTheme);
//   - a module's sandboxed frame: module-host.js re-sends it the colors on the 'app:theme' event this file fires.
//
// A person's pick is kept on their account (PATCH /api/me) and in this browser (localStorage 'app.themeMode', which
// theme-head.js reads before the first paint); a guest's in the browser only. Once picked, it no longer follows the
// environment's default. brand.js wires the rest: the account's own mode (setAccountMode), the environment's default
// and its stylesheet's version (setEnvironmentMode), and the stream's 'mode' and 'theme' events.

const KEY = 'app.themeMode';
const isMode = (m) => m === 'light' || m === 'dark';

const docs = new Set([document]); // every document that shows this page's look
const switches = new Set(); // every header switch drawn
let signedIn = null; // null until known
let envMode = null; // the environment's default mode (Manage > Theme), from /api/branding
let envVersion = null; // the fingerprint of the environment's /theme.css, from /api/branding

function stored() {
  try {
    const m = localStorage.getItem(KEY);
    return isMode(m) ? m : null;
  } catch {
    return null;
  }
}
function store(mode) {
  try {
    if (mode) localStorage.setItem(KEY, mode);
    else localStorage.removeItem(KEY);
  } catch {
    // no storage: the account (or nothing, for a guest) keeps it
  }
}

// The documents still open (a closed window's document has no window).
function liveDocs() {
  for (const doc of docs) if (!doc.defaultView) docs.delete(doc);
  return [...docs];
}
// Same-origin pages in frames that follow this one (an overlay over a call); a module's sandboxed frame throws here.
function framedPages() {
  const out = [];
  for (const doc of liveDocs()) {
    for (const frame of doc.querySelectorAll('iframe')) {
      try {
        const w = frame.contentWindow;
        if (w && w !== window && w.appTheme) out.push(w.appTheme);
      } catch {
        // another origin
      }
    }
  }
  return out;
}

// The mode showing now: the attribute if set, else the stylesheet's default (the person's own, else the environment's).
export function themeMode() {
  const set = document.documentElement.dataset.themeMode;
  if (isMode(set)) return set;
  return envMode || 'dark';
}

// Sets (or, with null, clears) the attribute everywhere this page's look reaches, and says so.
function applyMode(mode) {
  for (const doc of liveDocs()) {
    if (mode) doc.documentElement.dataset.themeMode = mode;
    else delete doc.documentElement.dataset.themeMode;
  }
  for (const page of framedPages()) page.mode(mode);
  changed();
}

// Every open page's colors just changed (a mode, or a new stylesheet): the switches repaint, and module-host.js
// re-sends a module's frame its colors.
function changed() {
  const mode = themeMode();
  for (const button of switches) {
    if (!button.ownerDocument.defaultView) {
      switches.delete(button);
      continue;
    }
    paintSwitch(button, mode);
  }
  document.dispatchEvent(new CustomEvent('app:theme', { detail: { mode } }));
}

// Re-fetches /theme.css in every document (the owner changed the theme or its default mode), and says so once the
// new colors are in. A link that does not load in five seconds is not waited for.
function reloadSheets(version) {
  const v = version || Date.now().toString(36);
  const loads = [];
  for (const doc of liveDocs()) {
    for (const link of doc.querySelectorAll('link[rel="stylesheet"][href^="/theme.css"]')) {
      loads.push(new Promise((resolve) => {
        const done = () => {
          link.removeEventListener('load', done);
          link.removeEventListener('error', done);
          resolve();
        };
        link.addEventListener('load', done);
        link.addEventListener('error', done);
        setTimeout(done, 5000);
      }));
      link.setAttribute('href', `/theme.css?v=${encodeURIComponent(v)}`);
    }
  }
  for (const page of framedPages()) page.reload(v);
  return Promise.all(loads).then(changed);
}

// This window's own entry point for the page that frames it (see framedPages).
window.appTheme = {
  mode: (mode) => applyMode(isMode(mode) ? mode : null),
  reload: (version) => reloadSheets(version),
};

// A window made from /popout.html, which cloned this page's stylesheets: it follows the mode and the theme from now on.
export function followTheme(doc) {
  if (!doc) return;
  docs.add(doc);
  const mode = document.documentElement.dataset.themeMode;
  if (isMode(mode)) doc.documentElement.dataset.themeMode = mode;
  else delete doc.documentElement.dataset.themeMode;
}

// The environment's default mode and its stylesheet's version (/api/branding). A version other than the one this page
// knew means the stylesheet changed since: it is fetched again.
export function setEnvironmentMode(mode, version) {
  const before = envVersion;
  envMode = isMode(mode) ? mode : envMode;
  envVersion = version || envVersion;
  if (before && version && version !== before) reloadSheets(version);
  else changed();
}

// The signed-in person's own mode (GET /api/me's user.themeMode, or the stream's 'mode' event), or signedIn false for
// a guest. The account wins over what this browser remembers, and the browser keeps a copy for the next first paint.
export function setAccountMode(user) {
  if (!user) {
    signedIn = false;
    return;
  }
  signedIn = true;
  const mode = isMode(user.themeMode) ? user.themeMode : null;
  store(mode);
  applyMode(mode);
}

// The owner changed the theme or its default mode (the stream's 'theme' event, or a guest's check).
export function themeChanged({ themeMode: mode, version } = {}) {
  if (isMode(mode)) envMode = mode;
  if (version && version === envVersion) return changed();
  envVersion = version || envVersion;
  return reloadSheets(version);
}

// Signing out: this browser forgets the person's light or dark, so the next person (or a guest) starts from the
// default instead of the last person's pick. The page is leaving, so the attribute stays as it is.
export function forgetThemeMode() {
  store(null);
}

// Another tab of this browser picked a mode (a guest's, or a copy of the account's): follow it.
window.addEventListener('storage', (event) => {
  if (event.key !== KEY) return;
  applyMode(isMode(event.newValue) ? event.newValue : null);
});

// The person flips the switch: at once here, then kept (the account, or this browser for a guest).
async function toggle() {
  const next = themeMode() === 'dark' ? 'light' : 'dark';
  store(next);
  applyMode(next);
  if (signedIn === false) return;
  try {
    const res = await fetch('/api/me', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ themeMode: next }) });
    if (res.status === 401) signedIn = false; // a guest after all: the browser keeps it
  } catch {
    // offline: this browser keeps it, and the account catches up on the next flip
  }
}

// The header's switch: the same sun, track and moon as Manage > Theme's (.theme-mode in style.css), a button with the
// switch role, on meaning dark. Its name shows beside it in the phone menu.
export function themeSwitch(doc = document) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'theme-mode topbar-theme-mode';
  button.id = 'theme-mode-switch';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-label', 'Dark mode');
  button.innerHTML = '<i class="fa-solid fa-sun fa-fw" aria-hidden="true"></i><span class="theme-mode-track" aria-hidden="true"><span class="theme-mode-knob"></span></span><i class="fa-solid fa-moon fa-fw" aria-hidden="true"></i><span class="theme-mode-label" aria-hidden="true">Dark mode</span>';
  button.addEventListener('click', (event) => {
    event.stopPropagation(); // the phone menu stays open, so the change can be seen and undone
    toggle();
  });
  switches.add(button);
  paintSwitch(button, themeMode());
  return button;
}
function paintSwitch(button, mode) {
  button.setAttribute('aria-checked', String(mode === 'dark'));
  button.title = mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
}

// A guest has no event stream: it asks after /theme.css now and then (every minute while the page is in view, and when
// it comes back into view) and fetches it again when it changed. The file is small and sent with no-cache.
export function watchThemeWithoutStream() {
  let last = null;
  const check = async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      const res = await fetch('/theme.css', { cache: 'no-store' });
      if (!res.ok) return;
      const text = await res.text();
      if (last !== null && text !== last) {
        // The default mode may be what changed: the switch has to know it to show the right side.
        const b = await fetch('/api/branding').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
        await themeChanged({ themeMode: b.themeMode, version: b.themeVersion || Date.now().toString(36) });
      }
      last = text;
    } catch {
      // the next check asks again
    }
  };
  check();
  setInterval(check, 60000);
  document.addEventListener('visibilitychange', check);
}
