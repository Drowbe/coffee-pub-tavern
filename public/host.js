// The host console (admin.<base domain>): the deployment's own door. The environments (each its own people, spaces,
// settings and modules), their plans against their use, the host admins, the host itself. It shows no environment's
// data beyond the counts. The API is /api/host/ (documentation/plans/plan-tenants.md, "Phase 1 in detail").
import { loadBranding, api, renderTopbar } from '/brand.js';
import { wireRegionCut } from '/region-cut.js';

const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const say = (el, text, error = false) => { el.textContent = text; el.classList.toggle('error', error); el.hidden = !text; };
const clone = (id) => $(id).content.firstElementChild.cloneNode(true);
const slot = (el, name) => el.querySelector(`[data-slot="${name}"]`);

let settings = { baseDomain: '', version: '', hostAdmins: [], plans: {} };
const PLAN_ORDER = (plans) => Object.keys(plans || {}).sort((a, b) => (a === 'free' ? -1 : b === 'free' ? 1 : a.localeCompare(b)));
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
  renderPlans();
  await loadAiServices();
  await loadShared();
}

// --- the managed AI services: one row per company ---------------------------------------------------------------
// GET /api/host/ai lists every company with whether it is offered (a key, or an address for Other, and a model); a row
// sets or replaces the key (write-only, or read from the server's environment), picks the model from the company's own
// list, and saves that one company (PUT /api/host/ai { provider, ... }).
const AI_COMPANIES = [
  { id: 'openai', name: 'OpenAI', env: 'AI_OPENAI_KEY' },
  { id: 'anthropic', name: 'Anthropic', env: 'AI_ANTHROPIC_KEY' },
  { id: 'compatible', name: 'Other (OpenAI-compatible)', env: 'AI_KEY' },
];
async function loadAiServices() {
  let services = [];
  try {
    services = (await api('GET', '/api/host/ai')).services || [];
  } catch (err) {
    $('ai-panel').hidden = true;
    return;
  }
  const box = $('ai-services');
  box.replaceChildren();
  for (const c of AI_COMPANIES) {
    const s = services.find((x) => x.provider === c.id) || { provider: c.id, model: '', address: '', keySet: false, keyFromEnvironment: false, offered: false };
    box.appendChild(aiServiceRow(c, s));
  }
}
function aiServiceRow(c, s) {
  const form = clone('tpl-ai-service');
  form.dataset.provider = c.id;
  slot(form, 'name').textContent = c.name;
  const offered = slot(form, 'offered');
  offered.textContent = s.offered ? 'Offered' : 'Not offered';
  offered.classList.toggle('on', Boolean(s.offered));
  slot(form, 'address-row').hidden = c.id !== 'compatible';
  form.elements.address.value = s.address || '';
  // The key: keep what is saved, replace it, or clear it; the page never sees the key itself.
  let keyMode = 'keep';
  const keyState = slot(form, 'key-state');
  const keyInput = form.elements.key;
  const replaceBtn = form.querySelector('[data-action="key-replace"]');
  const clearBtn = form.querySelector('[data-action="key-clear"]');
  const syncKey = () => {
    const set = (s.keySet || keyMode === 'replace') && keyMode !== 'clear';
    keyState.textContent = s.keyFromEnvironment ? 'set by the server\'s environment' : keyMode === 'clear' ? 'will be removed' : set ? 'set' : 'not set';
    keyState.classList.toggle('on', set);
    keyInput.hidden = keyMode !== 'replace';
    replaceBtn.hidden = Boolean(s.keyFromEnvironment);
    replaceBtn.textContent = keyMode === 'replace' ? 'Cancel' : s.keySet ? 'Replace the key' : 'Set a key';
    clearBtn.hidden = Boolean(s.keyFromEnvironment) || !s.keySet || keyMode === 'clear';
    slot(form, 'key-help').textContent = s.keyFromEnvironment ? `The key comes from the server's environment (${c.env}); change it there.` : c.id === 'compatible' ? 'Optional for a model on your own network. Kept on the host and never shown again.' : 'Kept on the host and never shown again.';
  };
  replaceBtn.addEventListener('click', () => { keyMode = keyMode === 'replace' ? 'keep' : 'replace'; keyInput.value = ''; syncKey(); if (keyMode === 'replace') keyInput.focus(); else loadModels(); });
  clearBtn.addEventListener('click', () => { keyMode = 'clear'; syncKey(); });
  // The model, from the company's own list once there is a key (or an address); typed by hand when the list cannot be had.
  const sel = form.elements.model;
  const text = form.elements['model-text'];
  const manualBtn = form.querySelector('[data-action="model-manual"]');
  const refreshBtn = form.querySelector('[data-action="models-refresh"]');
  const hint = slot(form, 'models-hint');
  let manual = false;
  const syncModel = () => { sel.hidden = manual; text.hidden = !manual; refreshBtn.hidden = manual; };
  async function loadModels() {
    const wanted = manual ? text.value.trim() : sel.value || s.model || '';
    const haveKey = s.keySet || s.keyFromEnvironment || (keyMode === 'replace' && keyInput.value);
    if (c.id !== 'compatible' && !haveKey) { sel.replaceChildren(new Option('Set a key to see the models', '')); hint.textContent = ''; manualBtn.hidden = false; return; }
    if (c.id === 'compatible' && !form.elements.address.value.trim()) { sel.replaceChildren(new Option('Enter the address first', '')); hint.textContent = ''; return; }
    sel.replaceChildren(new Option('Loading models...', ''));
    hint.textContent = '';
    try {
      const body = { provider: c.id, address: form.elements.address.value.trim() };
      if (keyMode === 'replace' && keyInput.value) body.key = keyInput.value;
      const { models: list = [] } = await api('POST', '/api/host/ai/models', body);
      sel.replaceChildren(...list.map((m) => new Option(m.name || m.id, m.id)));
      if (wanted && !list.some((m) => m.id === wanted)) sel.append(new Option(`${wanted} (current)`, wanted));
      if (!list.length) sel.append(new Option('No models were listed', ''));
      sel.value = wanted || (list[0] && list[0].id) || '';
      hint.textContent = list.length ? `${list.length} models available.` : '';
    } catch (err) {
      sel.replaceChildren(...(wanted ? [new Option(`${wanted} (current)`, wanted)] : [new Option('The list could not be loaded', '')]));
      sel.value = wanted;
      hint.textContent = `${err.message || 'The list of models could not be loaded'}.`;
    }
    manualBtn.hidden = false;
  }
  manualBtn.addEventListener('click', () => { manual = true; text.value = sel.value || s.model || ''; manualBtn.hidden = true; syncModel(); text.focus(); });
  refreshBtn.addEventListener('click', loadModels);
  form.elements.address.addEventListener('change', loadModels);
  keyInput.addEventListener('change', loadModels);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const model = manual ? text.value.trim() : sel.value;
    const body = { provider: c.id, model, address: c.id === 'compatible' ? form.elements.address.value.trim() : '' };
    if (keyMode === 'replace' && keyInput.value) body.key = keyInput.value;
    if (keyMode === 'clear') body.clearKey = true;
    say(slot(form, 'status'), 'saving...');
    try {
      await api('PUT', '/api/host/ai', body);
      say($('ai-status'), `${c.name} saved`);
      await loadAiServices();
    } catch (err) { say(slot(form, 'status'), err.message, true); }
  });
  syncKey();
  syncModel();
  loadModels();
  return form;
}

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
  const webhook = settings.baseDomain ? `${location.protocol}//admin.${settings.baseDomain}${location.port ? ':' + location.port : ''}/api/host/billing` : '';
  $('host-facts').innerHTML = `<dt>Base domain</dt><dd>${escapeHtml(settings.baseDomain || '(none: one environment)')}</dd><dt>Version</dt><dd>${escapeHtml(settings.version || '')}</dd><dt>Environments</dt><dd>${tenants.length}</dd><dt>Sign-up</dt><dd>${settings.signup === false ? 'off (SIGNUP=off)' : 'on, at the base domain, on the free plan'}</dd><dt>Billing webhook</dt><dd>${webhook ? `<code>${escapeHtml(webhook)}</code>, a JSON body { slug, plan, event: paid | lapsed | cancelled } signed with <code>BILLING_SECRET</code> (x-billing-signature, HMAC-SHA256 of the body, hex)${settings.billingSecretSet === false ? '; <strong>BILLING_SECRET is not set</strong>, so the webhook refuses everything' : ''}` : 'needs a base domain'}</dd>`;
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
    const graceEnds = t.graceEndsAt ? new Date(t.graceEndsAt) : t.pastDueSince ? new Date(new Date(t.pastDueSince).getTime() + 14 * 86400000) : null;
    // The facts as tiles: what the plan allows against what is used, a bar where there is a cap, and the states that
    // need a host admin's eye (past due, degraded, a deletion asked for) marked.
    el.dataset.status = t.status || 'active';
    const pctOf = (used, limit) => (limit ? Math.min(100, Math.round((used / limit) * 100)) : null);
    const tile = (key, value, pct = null, warn = false) => `<div class="fact${warn || (pct !== null && pct >= 90) ? ' fact-warn' : ''}"><span class="fact-key">${escapeHtml(key)}</span><span class="fact-value">${escapeHtml(value)}</span>${pct === null ? '' : `<span class="env-cap-bar${pct >= 90 ? ' warn' : ''}"><span style="width:${pct}%"></span></span>`}</div>`;
    const storageText = u.storageBytes == null ? (p.storageBytes ? `not measured yet, cap ${gb(p.storageBytes)}` : 'not measured yet') : p.storageBytes ? `${gb(u.storageBytes)} of ${gb(p.storageBytes)}` : `${gb(u.storageBytes)}, no cap`;
    slot(el, 'facts').innerHTML = [
      tile('Plan', p.name ? (settings.plans && settings.plans[p.name] ? settings.plans[p.name].name || p.name : p.name) : 'no plan named'),
      ...(t.status === 'pastDue' ? [tile('Past due', `since ${t.pastDueSince ? new Date(t.pastDueSince).toLocaleDateString() : '?'}; free plan on ${graceEnds ? graceEnds.toLocaleDateString() : '?'}`, null, true)] : []),
      ...(t.degradedAt ? [tile('Degraded to free', new Date(t.degradedAt).toLocaleDateString(), null, true)] : []),
      ...(t.deleteRequestedAt ? [tile('Deletion asked for', `${new Date(t.deleteRequestedAt).toLocaleDateString()}${t.deleteRequestReason || t.deleteReason ? ': ' + (t.deleteRequestReason || t.deleteReason) : ''}`, null, true)] : []),
      tile('Members', cap(u.members ?? 0, p.members), pctOf(u.members ?? 0, p.members)),
      tile('Spaces', String(u.spaces ?? 0)),
      tile('Storage', storageText, u.storageBytes == null ? null : pctOf(u.storageBytes, p.storageBytes)),
      tile('AI this month', cap(u.aiCallsThisMonth ?? 0, p.aiCallsPerMonth, ' calls'), pctOf(u.aiCallsThisMonth ?? 0, p.aiCallsPerMonth)),
      tile('Calls at once', p.calls ? `${u.callsNow ?? 0} of ${p.calls}` : 'no cap', pctOf(u.callsNow ?? 0, p.calls)),
      tile('Modules', mods),
      tile('Since', t.createdAt ? new Date(t.createdAt).toLocaleDateString() : ''),
    ].join('');
    // the plan form, filled from the plan
    const form = slot(el, 'plan-form');
    form.elements.name.value = t.name || '';
    const pick = form.elements.planName;
    pick.replaceChildren(new Option('(none named)', ''), ...PLAN_ORDER(settings.plans).map((id) => new Option(settings.plans[id].name || id, id)));
    pick.value = p.name && settings.plans[p.name] ? p.name : '';
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
  const form = e.target.closest('form');
  if (e.target.name === 'planName') {
    const caps = (settings.plans[e.target.value] || {}).caps;
    if (!caps) return;
    form.elements.modules.value = Array.isArray(caps.modules) ? 'list' : 'all';
    form.elements.moduleIds.value = Array.isArray(caps.modules) ? caps.modules.join('\n') : '';
    slot(form, 'modules-list').hidden = form.elements.modules.value !== 'list';
    form.elements.members.value = caps.members || '';
    form.elements.storageGb.value = caps.storageBytes ? String(caps.storageBytes / 1e9) : '';
    form.elements.aiCallsPerMonth.value = caps.aiCallsPerMonth ?? '';
    form.elements.calls.value = caps.calls || '';
    return;
  }
  if (e.target.name !== 'modules') return;
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
    name: f.planName.value || null,
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

// --- the tabs ----------------------------------------------------------------------------------------------------------
// Host (the facts, the host admins), Plans, Environments (the list and the new-environment form), AI, Maps: the same
// bar and the same hash routing as the Manage page. Environments is the default, being what a host admin comes for.
const TABS = ['host', 'plans', 'environments', 'ai', 'maps'];
function selectTab(name) {
  const tab = TABS.includes(name) ? name : 'environments';
  for (const t of TABS) { const el = $(`tab-${t}`); if (el) el.hidden = tab !== t; }
  for (const b of document.querySelectorAll('.subtab')) b.classList.toggle('active', b.dataset.tab === tab);
  if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
}
$('subtabs').addEventListener('click', (event) => {
  const b = event.target.closest('.subtab');
  if (b) selectTab(b.dataset.tab);
});
window.addEventListener('hashchange', () => selectTab(location.hash.slice(1)));
selectTab(location.hash.slice(1));

// --- the plans catalog ----------------------------------------------------------------------------------------------
// One row per plan (free first and never removed); Save plans sends the whole catalog (PUT /api/host/plans).
function planRow(id, plan) {
  const row = clone('tpl-plan-row');
  const f = row.querySelector.bind(row);
  f('[name="id"]').value = id;
  f('[name="id"]').readOnly = id === 'free';
  f('[name="name"]').value = plan.name || id;
  const c = plan.caps || {};
  f('[name="members"]').value = c.members || '';
  f('[name="storageGb"]').value = c.storageBytes ? String(c.storageBytes / 1e9) : '';
  f('[name="aiCallsPerMonth"]').value = c.aiCallsPerMonth ?? '';
  f('[name="calls"]').value = c.calls || '';
  f('[name="modules"]').value = Array.isArray(c.modules) ? c.modules.join(' ') : 'all';
  if (id === 'free') f('[data-action="plan-remove"]').disabled = true;
  return row;
}
function renderPlans() {
  const box = $('plans-editor');
  const plans = settings.plans && Object.keys(settings.plans).length ? settings.plans : { free: { name: 'Free', caps: {} } };
  box.replaceChildren(...PLAN_ORDER(plans).map((id) => planRow(id, plans[id])));
}
$('plan-add').addEventListener('click', () => { $('plans-editor').appendChild(planRow('', { name: '', caps: {} })); $('plans-editor').lastElementChild.querySelector('[name="id"]').focus(); });
$('plans-editor').addEventListener('click', (e) => {
  const b = e.target.closest('[data-action="plan-remove"]');
  if (b && !b.disabled) b.closest('.plan-row').remove();
});
$('plans-save').addEventListener('click', async () => {
  const plans = {};
  for (const row of $('plans-editor').querySelectorAll('.plan-row')) {
    const v = (name) => row.querySelector(`[name="${name}"]`).value.trim();
    const id = v('id').toLowerCase();
    if (!id) continue;
    const num = (name) => (v(name) === '' ? null : Number(v(name)));
    const mods = v('modules');
    plans[id] = {
      name: v('name') || id,
      caps: {
        modules: !mods || mods === 'all' ? 'all' : mods.split(/[\s,]+/).filter(Boolean),
        members: num('members'),
        storageBytes: v('storageGb') === '' ? null : Math.round(Number(v('storageGb')) * 1e9),
        aiCallsPerMonth: num('aiCallsPerMonth'),
        calls: num('calls'),
      },
    };
  }
  if (!plans.free) plans.free = { name: 'Free', caps: { modules: 'all', members: null, storageBytes: null, aiCallsPerMonth: null, calls: null } };
  try {
    await api('PUT', '/api/host/plans', plans); // the body is the catalog itself
    say($('plans-status'), 'saved');
    await load();
  } catch (err) { say($('plans-status'), err.message, true); }
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
