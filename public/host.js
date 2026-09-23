// The host console (admin.<base domain>): the deployment's own door. The environments (each its own people, spaces,
// settings and modules), their plans against their use, the host admins, the host itself. It shows no environment's
// data beyond the counts. The API is /api/host/ (documentation/plans/plan-tenants.md, "Phase 1 in detail").
import { loadBranding, api, renderTopbar } from '/brand.js';
import { mountAiForm } from '/ai-form.js';
import { wireRegionCut } from '/region-cut.js';

const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const say = (el, text, error = false) => { el.textContent = text; el.classList.toggle('error', error); el.hidden = !text; };
const clone = (id) => $(id).content.firstElementChild.cloneNode(true);
const slot = (el, name) => el.querySelector(`[data-slot="${name}"]`);

let settings = { baseDomain: '', version: '', hostAdmins: [] };
let tenants = [];

const gb = (bytes) => (bytes ? `${(bytes / 1e9).toFixed(bytes < 1e8 ? 2 : 1)} GB` : '0');
const cap = (used, limit, unit = '') => (limit ? `${used}${unit} of ${limit}${unit}` : `${used}${unit}, no cap`);
const tenantUrl = (slug) => `${location.protocol}//${slug}.${settings.baseDomain}${location.port ? `:${location.port}` : ''}`; // the port only in development

async function load() {
  try {
    await api('GET', '/api/host/me');
  } catch (err) {
    $('host-login').hidden = false;
    $('host-main').hidden = true;
    return;
  }
  $('host-login').hidden = true;
  $('host-main').hidden = false;
  try {
    settings = await api('GET', '/api/host/settings');
    tenants = (await api('GET', '/api/host/tenants')).tenants;
  } catch (err) {
    say($('tenants-status'), err.message, true);
    return;
  }
  $('base-hint').textContent = `<slug>.${settings.baseDomain}`;
  renderTenants();
  renderAdmins();
  renderFacts();
  await aiForm.load();
  await loadShared();
}

// --- the managed AI service: the same form as an environment's page, against the host's own endpoints -------------
const aiForm = mountAiForm({ get: '/api/host/ai', put: '/api/host/ai', models: '/api/host/ai/models' });

// --- the host's shared files (the map every environment shows) -------------------------------------------------
// GET /api/host/shared lists every bundled module's shared folder; phase 1 has one (Maps' map-tiles), so the panel
// is that one folder: its files, the world address regions are cut from, and the region cut itself.
let shared = null;
let regionWired = false;
const size = (b) => (b === undefined || b === null ? '' : b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
async function loadShared() {
  let folders = [];
  try {
    folders = (await api('GET', '/api/host/shared')).folders || [];
  } catch (err) {
    $('shared-panel').hidden = true;
    return;
  }
  shared = folders[0] || null;
  $('shared-panel').hidden = !shared;
  if (!shared) return;
  $('shared-title').textContent = shared.name || shared.module;
  $('shared-folder').textContent = `DATA_DIR/shared/${shared.module}/${shared.folder}/${shared.exists === false ? ' (not there yet: it is made on the first cut, or make it and copy a file in)' : ''}`;
  $('shared-address').value = shared.address || '';
  const files = shared.files || [];
  const hasZooms = files.some((f) => f.zoom);
  $('shared-files').innerHTML = files.length
    ? `<table class="files-table"><thead><tr><th>File</th>${hasZooms ? '<th>Zoom</th>' : ''}<th>Size</th><th></th></tr></thead><tbody>${files.map((f) => `<tr><td>${escapeHtml(f.name)}</td>${hasZooms ? `<td class="hint">${f.zoom ? (f.zoom.minZoom === f.zoom.maxZoom ? f.zoom.maxZoom : `${f.zoom.minZoom}–${f.zoom.maxZoom}`) : ''}</td>` : ''}<td class="hint">${size(f.size)}</td><td><button type="button" class="btn btn-small btn-danger" data-delete-file="${escapeHtml(f.name)}" title="Delete ${escapeHtml(f.name)}" aria-label="Delete ${escapeHtml(f.name)}"><i class="fa-solid fa-trash" aria-hidden="true"></i></button></td></tr>`).join('')}</tbody></table>`
    : '<p class="hint">No map files yet. Every environment shows an empty map until one is here.</p>';
  if (!regionWired) {
    regionWired = true;
    wireRegionCut({ base: `/api/host/shared/${encodeURIComponent(shared.module)}/${encodeURIComponent(shared.folder)}/region-cut`, onDone: loadShared });
  }
}
$('shared-address-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!shared) return;
  try {
    await api('PUT', `/api/host/shared/${encodeURIComponent(shared.module)}/${encodeURIComponent(shared.folder)}`, { address: $('shared-address').value.trim() });
    say($('shared-status'), 'saved');
    await loadShared();
  } catch (err) { say($('shared-status'), err.message, true); }
});
const armedFiles = new Map();
$('shared-files').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-delete-file]');
  if (!b || !shared) return;
  const name = b.dataset.deleteFile;
  if (armedFiles.get(name) !== b) { armedFiles.set(name, b); b.textContent = 'Really delete?'; setTimeout(() => { if (armedFiles.get(name) === b) { armedFiles.delete(name); b.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i>'; } }, 4000); return; }
  armedFiles.delete(name);
  try {
    await api('DELETE', `/api/host/shared/${encodeURIComponent(shared.module)}/${encodeURIComponent(shared.folder)}/files/${encodeURIComponent(name)}`);
    say($('shared-status'), `${name} deleted`);
    await loadShared();
  } catch (err) { say($('shared-status'), err.message, true); }
});

function renderFacts() {
  $('host-facts').innerHTML = `<dt>Base domain</dt><dd>${escapeHtml(settings.baseDomain || '(none: one environment)')}</dd><dt>Version</dt><dd>${escapeHtml(settings.version || '')}</dd><dt>Environments</dt><dd>${tenants.length}</dd>`;
}

function renderTenants() {
  const box = $('tenants');
  box.replaceChildren();
  if (!tenants.length) { box.innerHTML = '<p class="hint">No environments yet.</p>'; return; }
  for (const t of tenants) {
    const el = clone('tpl-tenant');
    el.dataset.slug = t.slug;
    slot(el, 'name').textContent = t.name || t.slug;
    slot(el, 'link').href = tenantUrl(t.slug);
    slot(el, 'slug').textContent = `${t.slug}.${settings.baseDomain}`;
    const status = slot(el, 'status');
    status.textContent = t.status === 'pastDue' ? 'past due' : t.status || 'active';
    status.dataset.status = t.status || 'active';
    el.querySelector('[data-action="suspend"]').textContent = t.status === 'suspended' ? 'Restore' : 'Suspend';
    const u = t.usage || {};
    const p = t.plan || {};
    const mods = p.modules === 'all' || !p.modules ? 'all installed' : `${p.modules.length} allowed`;
    slot(el, 'facts').innerHTML = [
      ['Members', cap(u.members ?? 0, p.members)],
      ['Spaces', String(u.spaces ?? 0)],
      ['Storage', u.storageBytes == null ? (p.storageBytes ? `not measured yet, cap ${gb(p.storageBytes)}` : 'not measured yet') : p.storageBytes ? `${gb(u.storageBytes)} of ${gb(p.storageBytes)}` : `${gb(u.storageBytes)}, no cap`],
      ['AI this month', cap(u.aiCallsThisMonth ?? 0, p.aiCallsPerMonth, ' calls')],
      ['Calls', p.calls ? `up to ${p.calls} at once` : 'no cap'],
      ['Modules', mods],
      ['Since', t.createdAt ? new Date(t.createdAt).toLocaleDateString() : ''],
    ].map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('');
    // the plan form, filled from the plan
    const form = slot(el, 'plan-form');
    form.elements.name.value = t.name || '';
    form.elements.modules.value = p.modules === 'all' || !p.modules ? 'all' : 'list';
    form.elements.moduleIds.value = Array.isArray(p.modules) ? p.modules.join('\n') : '';
    slot(el, 'modules-list').hidden = form.elements.modules.value !== 'list';
    form.elements.members.value = p.members || '';
    form.elements.storageGb.value = p.storageBytes ? String(p.storageBytes / 1e9) : '';
    form.elements.aiCallsPerMonth.value = p.aiCallsPerMonth ?? '';
    form.elements.calls.value = p.calls || '';
    box.append(el);
  }
}

function renderAdmins() {
  const box = $('admins');
  box.replaceChildren(...(settings.hostAdmins || []).map((a) => {
    const row = clone('tpl-admin');
    row.dataset.key = a.key;
    slot(row, 'login').textContent = a.login;
    if ((settings.hostAdmins || []).length < 2) row.querySelector('[data-action="remove-admin"]').disabled = true; // never the last
    return row;
  }));
}

// --- the tenants' own controls, by delegation -----------------------------------------------------------------
const armed = new Map(); // slug -> the delete button armed for a second click
$('tenants').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  const card = b.closest('.tenant');
  const slug = card.dataset.slug;
  const t = tenants.find((x) => x.slug === slug);
  const action = b.dataset.action;
  if (action === 'plan') { slot(card, 'plan-form').hidden = false; return; }
  if (action === 'plan-cancel') { slot(card, 'plan-form').hidden = true; return; }
  if (action === 'suspend') {
    try {
      await api('PATCH', `/api/host/tenants/${encodeURIComponent(slug)}`, { status: t.status === 'suspended' ? 'active' : 'suspended' });
      await load();
    } catch (err) { say($('tenants-status'), err.message, true); }
    return;
  }
  if (action === 'backup') {
    b.disabled = true;
    try {
      const res = await fetch(`/api/host/tenants/${encodeURIComponent(slug)}/backup`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `backup failed (${res.status})`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${slug}-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    } catch (err) { say($('tenants-status'), err.message, true); }
    b.disabled = false;
    return;
  }
  if (action === 'delete') {
    if (armed.get(slug) !== b) { armed.set(slug, b); b.textContent = 'Really delete?'; setTimeout(() => { if (armed.get(slug) === b) { armed.delete(slug); b.textContent = 'Delete'; } }, 4000); return; }
    armed.delete(slug);
    try {
      await api('DELETE', `/api/host/tenants/${encodeURIComponent(slug)}`);
      say($('tenants-status'), `${slug} moved aside (its data is kept under tenants-deleted).`);
      await load();
    } catch (err) { say($('tenants-status'), err.message, true); }
  }
});
$('tenants').addEventListener('change', (e) => {
  if (e.target.name !== 'modules') return;
  const form = e.target.closest('form');
  slot(form, 'modules-list').hidden = e.target.value !== 'list';
});
$('tenants').addEventListener('submit', async (e) => {
  const form = e.target.closest('.plan-form');
  if (!form) return;
  e.preventDefault();
  const card = form.closest('.tenant');
  const f = form.elements;
  const num = (el) => (el.value === '' ? null : Number(el.value));
  const plan = {
    modules: f.modules.value === 'all' ? 'all' : f.moduleIds.value.split(/\s+/).map((s) => s.trim()).filter(Boolean),
    members: num(f.members),
    storageBytes: f.storageGb.value === '' ? null : Math.round(Number(f.storageGb.value) * 1e9),
    aiCallsPerMonth: num(f.aiCallsPerMonth),
    calls: num(f.calls),
  };
  try {
    await api('PATCH', `/api/host/tenants/${encodeURIComponent(card.dataset.slug)}`, { name: f.name.value.trim(), plan });
    say(slot(form, 'plan-status'), 'saved');
    await load();
  } catch (err) { say(slot(form, 'plan-status'), err.message, true); }
});

// --- creating one ----------------------------------------------------------------------------------------------
$('create-toggle').addEventListener('click', () => { $('create-form').hidden = !$('create-form').hidden; if (!$('create-form').hidden) $('new-slug').focus(); });
$('create-cancel').addEventListener('click', () => { $('create-form').hidden = true; });
$('create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  say($('create-error'), '');
  try {
    await api('POST', '/api/host/tenants', {
      slug: $('new-slug').value.trim().toLowerCase(),
      name: $('new-name').value.trim(),
      owner: { login: $('new-owner-login').value.trim(), displayName: $('new-owner-name').value.trim(), password: $('new-owner-password').value },
    });
    $('create-form').reset();
    $('create-form').hidden = true;
    await load();
  } catch (err) { say($('create-error'), err.message, true); }
});

// --- the host admins -------------------------------------------------------------------------------------------
$('admin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('POST', '/api/host/admins', { login: $('admin-login').value.trim(), password: $('admin-password').value });
    $('admin-form').reset();
    say($('admins-status'), 'added');
    await load();
  } catch (err) { say($('admins-status'), err.message, true); }
});
$('admins').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-action="remove-admin"]');
  if (!b) return;
  const key = b.closest('.list-row').dataset.key;
  try {
    await api('DELETE', `/api/host/admins/${encodeURIComponent(key)}`);
    await load();
  } catch (err) { say($('admins-status'), err.message, true); }
});

// --- signing in and out ---------------------------------------------------------------------------------------
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  say($('login-error'), '');
  try {
    await api('POST', '/api/host/login', { login: $('login-name').value.trim(), password: $('login-password').value });
    $('login-password').value = '';
    await load();
  } catch (err) { say($('login-error'), err.message, true); }
});
$('host-logout').addEventListener('click', async () => {
  try { await api('POST', '/api/host/logout'); } catch (err) { /* the cookie is gone either way */ }
  await load();
});

renderTopbar({ location: '' });
await loadBranding();
// The console is the product's own door, so its bar wears the product's logo, not any environment's name and icon.
const brandHome = document.querySelector('.topbar .brand-home');
if (brandHome) {
  const logo = document.createElement('img');
  logo.className = 'host-logo';
  logo.src = '/assets/images/brand/logo-light.png';
  logo.alt = 'Host console';
  brandHome.replaceChildren(logo);
  brandHome.href = '/';
  brandHome.title = 'Host console';
}
await load();
