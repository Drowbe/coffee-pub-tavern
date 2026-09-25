// One module's own settings page (Manage > Modules > Module Configuration): /module-config.html?id=<module id>.
// Admins only. Every module gets a page, so a module with many settings is not squeezed into a shared box.
import { loadBranding, api, renderTopbar, crumbLink, wireOverlayBack, word } from '/brand.js';
import { renderModuleSettings } from '/module-settings.js';
import { wireRegionCut } from '/region-cut.js';

const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get('id') || '';

renderTopbar({ location: crumbLink('gear', 'Manage', '/admin') });
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
  document.title = `${document.title.split(' - ')[0]} - ${m.name} configuration`; // the environment's name is in front once branding has loaded
  $('config').hidden = false;
  $('cfg-icon').classList.add(`fa-${m.icon}`);
  $('cfg-name').textContent = `${m.name} configuration`;
  $('cfg-version').textContent = `v${m.version}${m.author ? ' by ' + m.author : ''}`;
  $('cfg-state').textContent = m.enabled ? 'Enabled' : 'Disabled';
  $('cfg-state').classList.add(m.enabled ? 'on' : 'warn');
  $('cfg-desc').textContent = m.description || '';
  const mine = (scope) => (m.settings || []).filter((d) => d.scope === scope).length; // the server's scope names (plan-names step 5a)
  const showSettings = () => renderModuleSettings($('settings'), { scope: 'environment', only: m.id, heading: false });
  if (!mine('environment')) {
    $('cfg-none').hidden = false;
  } else if (!m.enabled) {
    $('cfg-off').hidden = false;
    $('cfg-off').textContent = `Turn ${m.name} on (Manage > ${word('module', { many: true, cap: true })}) to change its settings.`;
  } else {
    await showSettings();
  }
  if (m.geocoder && m.enabled) wireCache(m.id);
  if (m.regionSource && m.enabled) wireRegion(m, showSettings);
  const others = [mine('space') && `each ${word('space')}'s ${word('moderator', { many: true })} choose some in the ${word('space')}'s ${word('module')} settings`, mine('person') && 'each person chooses some in their own profile'].filter(Boolean);
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

// "Add a region" (a module with `regionSource`): the shared region-cut UI (public/region-cut.js), cutting into this
// module's own folder. Not offered when the folder is the host's (a shared setting): the host console cuts there.
// `showSettings` redraws the settings card above once a cut lands, so the new file shows up ticked.
function wireRegion(m, showSettings) {
  const filesDef = (m.settings || []).find((d) => d.type === 'files' && d.folder === m.regionSource.folder);
  if (filesDef && filesDef.shared) return;
  wireRegionCut({
    base: `/api/modules/${encodeURIComponent(m.id)}/region-cut`,
    // Tick the new file in the files setting above (merging into its current value only -- the server keeps every
    // other setting as it was) and redraw the settings card so the admin sees it ticked without saving by hand.
    onDone: async (name) => {
      if (filesDef) {
        try {
          const mine = (await api('GET', '/api/module-settings/environment')).modules.find((x) => x.id === m.id);
          const current = mine?.settings.find((d) => d.key === filesDef.key)?.value;
          const list = Array.isArray(current) ? current : [];
          if (!list.includes(name)) await api('PUT', `/api/modules/${encodeURIComponent(m.id)}/settings/environment`, { values: { [filesDef.key]: [...list, name] } });
        } catch (err) {
          // the file is cut and on disk either way; the admin can tick it by hand if this could not be saved
        }
      }
      await showSettings();
    },
  });
}
