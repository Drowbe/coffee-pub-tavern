// A module's own full-width page (/modules/<id>): the shell that hosts its
// sandboxed frame. The module itself is public/module-host.js's business.
import { loadBranding, api, wireOverlayBack, renderTopbar, setTopbarLocation, crumbLink, markModuleRead } from '/brand.js';
import { mountModule } from '/module-host.js';

const $ = (id) => document.getElementById(id);
const id = decodeURIComponent(location.pathname.split('/')[2] || '');

async function init() {
  renderTopbar({ location: '' });
  await loadBranding();
  wireOverlayBack();
  let me;
  try {
    me = (await api('GET', '/api/me')).user;
  } catch {
    location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
    return;
  }
  $('whoami').textContent = me.displayName;
  $('whoami-img').src = `/img/${encodeURIComponent(me.key)}/profile`;
  $('whoami-img').hidden = false;
  $('admin-link').hidden = me.role !== 'admin';

  const { modules } = await api('GET', '/api/modules/nav');
  const mod = modules.find((m) => m.id === id);
  if (!mod) {
    $('module-missing').hidden = false;
    return;
  }
  document.title = `${document.title.split(' - ')[0]} - ${mod.name}`;
  setTopbarLocation(crumbLink(mod.icon, mod.name, location.pathname));
  markModuleRead(mod.id);
  const frame = $('module-frame');
  frame.hidden = false;
  mountModule({
    module: { id: mod.id, version: mod.version, scope: ['server'] },
    frame,
    scope: 'server',
    entry: mod.page,
    onTitle: (title) => setTopbarLocation(crumbLink(mod.icon, title || mod.name, location.pathname)),
  });
}
init();
