// A module's own full-width page (/modules/<id>): the shell that hosts its
// sandboxed frame. The module itself is public/module-host.js's business.
//
// Two ways in:
//   /modules/<id>                          the module's server page
//   /modules/<id>?moduleRoom=<room>&popout=1   a room panel in a window of its own
//                                          (add &guest=<token> for a guest)
// (Not "room": a module page opened over a call already carries room=<name of the room>.)
import { loadBranding, api, wireOverlayBack, renderTopbar, setTopbarLocation, crumbLink, markModuleRead } from '/brand.js';
import { mountModule } from '/module-host.js';

const $ = (id) => document.getElementById(id);
const id = decodeURIComponent(location.pathname.split('/')[2] || '');
const params = new URLSearchParams(location.search);
const roomId = params.get('moduleRoom');
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
    $('admin-link').hidden = me.role !== 'admin';
  }

  // Which module, and how it is shown: its own page (server scope), or a room's panel.
  let mod;
  let scope = 'server';
  let entry;
  if (roomId) {
    scope = 'room';
    const q = new URLSearchParams({ room: roomId });
    if (guestToken) q.set('guest', guestToken);
    const found = (await api('GET', `/api/modules/for-room?${q}`)).modules.find((m) => m.id === id);
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
  const frame = $('module-frame');
  frame.hidden = false;
  mountModule({
    module: { id: mod.id, version: mod.version, scope: mod.scope },
    frame,
    bar: $('module-bar'),
    scope,
    roomId,
    guestToken,
    entry,
    onTitle: (title) => {
      document.title = `${title || mod.name}`;
      if (popout) $('module-titlebar-title').textContent = title || mod.name;
      if (!popout) setTopbarLocation(crumbLink(mod.icon, title || mod.name, location.pathname));
    },
  });
}

// The window's own titlebar: close, and (while the room page that opened it is still there) the
// way back into the room as a docked column or a floating panel.
function wireTitlebar(mod) {
  $('module-titlebar').hidden = false;
  $('module-titlebar-icon').className = `fa-solid fa-${mod.icon} fa-fw`;
  $('module-titlebar-title').textContent = mod.name;
  $('module-close').addEventListener('click', () => window.close());
  let host = null;
  try {
    host = window.opener && !window.opener.closed ? window.opener.tavernModules : null;
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
  note.textContent = `This module could not start: ${err.message}`;
  note.hidden = false;
});
