// One module's own settings page (Manage > Modules > Module Configuration): /module-config.html?id=<module id>.
// Admins only. Every module gets a page, so a module with many settings is not squeezed into a shared box.
import { loadBranding, api, renderTopbar, crumbLink, wireOverlayBack } from '/brand.js';
import { renderModuleSettings } from '/module-settings.js';

const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get('id') || '';

renderTopbar({ location: crumbLink('gear', 'Server Settings', '/admin') });
await loadBranding();
wireOverlayBack();

let data;
try {
  data = await api('GET', '/api/modules');
} catch {
  location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
}
const m = data && data.modules.find((x) => x.id === id);
if (!m) {
  $('cfg-missing').hidden = false;
} else {
  document.title = `Coffee Pub Tavern - ${m.name} configuration`;
  $('config').hidden = false;
  $('cfg-icon').classList.add(`fa-${m.icon}`);
  $('cfg-name').textContent = `${m.name} configuration`;
  $('cfg-version').textContent = `v${m.version}${m.author ? ' by ' + m.author : ''}`;
  $('cfg-state').textContent = m.enabled ? 'Enabled' : 'Disabled';
  $('cfg-state').classList.add(m.enabled ? 'on' : 'warn');
  $('cfg-desc').textContent = m.description || '';
  const mine = (scope) => (m.settings || []).filter((d) => d.scope === scope).length;
  if (!mine('server')) {
    $('cfg-none').hidden = false;
  } else if (!m.enabled) {
    $('cfg-off').hidden = false;
    $('cfg-off').textContent = `Turn ${m.name} on (Manage > Modules) to change its settings.`;
  } else {
    await renderModuleSettings($('settings'), { scope: 'server', only: m.id, heading: false });
  }
  const others = [mine('room') && "each room's moderators choose some in the room's module settings", mine('person') && 'each person chooses some in their own profile'].filter(Boolean);
  if (others.length) {
    $('cfg-other').hidden = false;
    $('cfg-other').textContent = `Also: ${others.join('; ')}.`;
  }
}
