// A module's own full-width page (/modules/<id>): the shell that hosts its
// sandboxed frame. The module itself is public/module-host.js's business.
//
// Two ways in:
//   /modules/<id>                          the module's server page
//   /modules/<id>?space=<space>&popout=1   a space's panel in a window of its own (?moduleRoom= redirects here)
//                                          (add &guest=<token> for a guest)
// (A module page opened over a call also carries from=space&spaceName=<the space's name>, for its Back link.)
import { loadBranding, api, wireOverlayBack, renderTopbar, setTopbarLocation, crumbLink, markModuleRead, hasOwnerRights, word } from '/brand.js';
import { mountModule } from '/module-host.js';

const $ = (id) => document.getElementById(id);
const id = decodeURIComponent(location.pathname.split('/')[2] || '');
const params = new URLSearchParams(location.search);
const spaceId = params.get('space');
const guestToken = params.get('guest');
const popout = params.get('popout') === '1';

async function start() {
  if (popout) document.body.classList.add('module-popout'); // no header: the window is the module
  renderTopbar({ location: '' });
  await loadBranding();
  wireOverlayBack();
  if (!guestToken) {
    let me;
    try {
      me = (await api('GET', '/api/me')).user;
    } catch {
      location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }
    $('whoami').textContent = me.displayName;
    $('whoami-img').src = `/img/${encodeURIComponent(me.key)}/profile`;
    $('whoami-img').hidden = false;
    $('admin-link').hidden = !hasOwnerRights(me);
  }

  // Which module, and how it is shown: its own page (the environment's scope), or a space's panel.
  let mod;
  let scope = 'environment';
  let entry;
  if (spaceId) {
    scope = 'space';
    const q = new URLSearchParams({ space: spaceId });
    if (guestToken) q.set('guest', guestToken);
    const found = (await api('GET', `/api/modules/for-space?${q}`)).modules.find((m) => m.id === id);
    if (found) {
      mod = { ...found, entry: found.panel.entry };
      entry = found.panel.entry;
    }
  } else {
    const found = (await api('GET', '/api/modules/nav')).modules.find((m) => m.id === id);
    if (found) {
      mod = { ...found, entry: found.page };
      entry = found.page;
    }
  }
  if (!mod) {
    $('module-missing').hidden = false;
    return;
  }
  document.title = `${document.title.split(' - ')[0]} - ${mod.name}`;
  if (popout) wireTitlebar(mod);
  if (!popout) setTopbarLocation(crumbLink(mod.icon, mod.name, location.pathname));
  if (!guestToken) markModuleRead(mod.id);
  let frame = $('module-frame');
  // A module that runs in the page gets an element of its own where the frame would be.
  const inPage = mod.runMode === 'page';
  if (inPage) {
    const holder = document.createElement('div');
    holder.className = 'module-frame module-root';
    holder.id = 'module-frame';
    frame.replaceWith(holder);
    frame = holder;
  }
  frame.hidden = false;
  // Showing an item in the module that owns it, from a module's own page: go to that module's page,
  // which is given the pointer in the address (#ref=...) and passes it to the module.
  const refHash = (ref) => `#ref=${encodeURIComponent(JSON.stringify(ref))}`;
  const openRef = (ref) => {
    if (ref.module === mod.id) {
      mounted.deliver('refopen', { ref });
      return true;
    }
    const q = new URLSearchParams(location.search);
    q.delete('popout');
    q.delete('space');
    if (ref.scope === 'space') q.set('space', ref.space);
    location.href = `/modules/${encodeURIComponent(ref.module)}${q.toString() ? '?' + q : ''}${refHash(ref)}`;
    return true;
  };
  const mounted = mountModule({
    onOpenRef: openRef,
    module: { id: mod.id, version: mod.version, scope: mod.scope },
    ...(inPage ? { container: frame } : { frame }),
    bar: $('module-bar'),
    header: popout ? $('module-titlebar-custom') : null,
    toolbar: $('module-toolbar'),
    scope,
    spaceId,
    guestToken,
    entry,
    onTitle: (title) => {
      document.title = `${title || mod.name}`;
      if (popout) $('module-titlebar-title').textContent = title || mod.name;
      if (!popout) setTopbarLocation(crumbLink(mod.icon, title || mod.name, location.pathname));
    },
  });
  // Opened by another module's link: hand the pointer on, and again if the address changes.
  const first = refFromHash();
  if (first) mounted.deliver('refopen', { ref: first });
  const place = placeFromHash();
  if (place) mounted.deliver('pagehash', { hash: place });
  window.addEventListener('hashchange', () => {
    const ref = refFromHash();
    if (ref) mounted.deliver('refopen', { ref });
    const at = placeFromHash();
    if (at) mounted.deliver('pagehash', { hash: at });
  });
}

// A place in the module's own page left in the address by a widget ("#day=2026-09-24"; see host.page.open).
function placeFromHash() {
  const m = /^#([A-Za-z0-9=&_.:,-]{1,80})$/.exec(location.hash);
  return m && !m[1].startsWith('ref=') ? m[1] : null;
}

// A pointer left in the address by another module's "open this" (see host.refs.open).
function refFromHash() {
  try {
    const m = /^#ref=(.+)$/.exec(location.hash);
    return m ? JSON.parse(decodeURIComponent(m[1])) : null;
  } catch {
    return null;
  }
}

// The window's own titlebar: close, and (while the space page that opened it is still there) the
// way back into the space as a docked column or a floating panel.
function wireTitlebar(mod) {
  $('module-titlebar').hidden = false;
  $('module-titlebar-icon').className = `fa-solid fa-${mod.icon} fa-fw`;
  $('module-titlebar-title').textContent = mod.name;
  $('module-close').addEventListener('click', () => window.close());
  let host = null;
  try {
    host = window.opener && !window.opener.closed ? window.opener.hostModules : null;
  } catch {
    host = null;
  }
  if (!host) return;
  const back = (mode) => {
    host.open(mod.id, mode);
    window.close();
  };
  for (const mode of ['dock', 'float']) {
    const button = $(`module-back-${mode}`);
    button.hidden = !host.supportsMode(mod.id, mode);
    button.addEventListener('click', () => back(mode));
  }
}

// Whatever goes wrong, say so on the page instead of leaving it blank.
start().catch((err) => {
  const note = $('module-missing');
  note.textContent = `This ${word('module')} could not start: ${err.message}`;
  note.hidden = false;
});
