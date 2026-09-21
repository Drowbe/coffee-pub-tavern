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
  if (m.geocoder && m.enabled) wireCache(m.id);
  const others = [mine('room') && "each room's moderators choose some in the room's module settings", mine('person') && 'each person chooses some in their own profile'].filter(Boolean);
  if (others.length) {
    $('cfg-other').hidden = false;
    $('cfg-other').textContent = `Also: ${others.join('; ')}.`;
  }
}

// The saved search results of a module that keeps them: counts, and purging (unused ones, unused ones older than a number of days, everything).
// Used places survive the first two. A destructive button asks twice: it reads "Really purge?" for a few seconds.
function wireCache(id) {
  const box = $('cfg-cache');
  box.hidden = false;
  const base = `/api/modules/${encodeURIComponent(id)}/geocode`;
  const status = $('cache-status');
  const show = (s) => {
    $('cache-saved').textContent = String(s.saved);
    $('cache-used').textContent = String(s.used);
    $('cache-unused').textContent = String(Math.max(0, s.saved - s.used));
    $('cache-oldest').textContent = s.oldest ? new Date(s.oldest).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '-';
  };
  const load = () => api('GET', `${base}/stats`).then(show).catch(() => { status.textContent = 'The counts could not be read.'; status.classList.add('error'); });
  load();
  const armed = new Map();
  box.addEventListener('click', async (event) => {
    const b = event.target.closest('[data-purge]');
    if (!b) return;
    const what = b.dataset.purge;
    if (!armed.has(b)) {
      const label = b.textContent;
      b.textContent = 'Really purge?';
      armed.set(b, setTimeout(() => { b.textContent = label; armed.delete(b); }, 4000));
      return;
    }
    clearTimeout(armed.get(b));
    armed.delete(b);
    b.textContent = b.dataset.purge === 'older' ? 'Purge unused older than' : what === 'all' ? 'Purge everything' : 'Purge unused';
    status.classList.remove('error');
    status.textContent = 'purging...';
    try {
      const body = what === 'all' ? { what: 'all' } : what === 'older' ? { what: 'unused', olderThanDays: Math.max(1, Number($('cache-days').value) || 90) } : { what: 'unused' };
      const s = await api('POST', `${base}/purge`, body);
      show(s);
      status.textContent = `${s.removed} removed`;
    } catch (err) {
      status.textContent = err.message;
      status.classList.add('error');
    }
  });
}
