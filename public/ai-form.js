// The AI service's form, shared by two pages that carry the same fields (the same ids): an environment's AI
// configuration page (/ai-config.html, where the choice is the host's managed service or a custom one) and the host
// console's Managed AI panel (the one service the host offers every environment). The person picks a company by name
// and the server knows its address; the models are listed from the company's own list, not typed. The key is
// write-only: the page is told only whether one is set, and a typed key replaces it.
//
// mountAiForm({ get, put, models, source, cap, usage }): `get`, `put` and `models` are the API paths; `source` draws the
// managed/custom choice (the environment's page), `cap` the monthly allowance, `usage` this month's use.
import { api, fill, word } from '/brand.js';

const $ = (id) => document.getElementById(id);
function say(el, text, error = false) {
  el.textContent = text;
  el.classList.toggle('error', Boolean(error));
}

// Level words as {placeholders}, filled when shown (fill() in public/words.js).
const AI_NOTICES = {
  none: 'AI is off. {A module} that asks for it is told AI is not set up.',
  openai: 'Sends the {objects} a person selects, and their question, to OpenAI under your account and its terms. Only what a person selects is sent, never another {space}.',
  anthropic: 'Sends the {objects} a person selects, and their question, to Anthropic under your account and its terms. Only what a person selects is sent, never another {space}.',
  compatible: 'Sends the {objects} a person selects, and their question, to the address below. For a hosted service that means to that company, under its terms and your account. For a model you run yourself nothing leaves your network. Only what a person selects is sent, never another {space}.',
};
const COMPANY = { openai: 'OpenAI', anthropic: 'Anthropic', compatible: 'another service', none: 'none' };

export function mountAiForm({ get, put, models, source = false, cap = false, usage = false }) {
  let aiState = { provider: 'none', keySet: false, keyFromEnvironment: false, model: '', source: 'custom', managed: { available: false } };
  let aiKeyMode = 'keep'; // keep | replace | clear
  let aiManual = false; // typing the model's name because the list could not be had
  let aiModelsToken = 0;

  // The Source select: one "managed:<company>" entry per company the host offers, then "custom".
  const managedChosen = () => source && $('ai-source').value.startsWith('managed:');
  const managedProvider = () => (managedChosen() ? $('ai-source').value.slice('managed:'.length) : '');
  const offered = () => ((aiState.managed && aiState.managed.services) || []).filter((s) => s && s.provider);
  function drawSourceOptions() {
    const sel = $('ai-source');
    const keep = sel.value;
    const services = offered();
    sel.replaceChildren(
      ...services.map((s) => new Option(`Managed: ${COMPANY[s.provider] || s.provider}${s.model ? ', ' + s.model : ''} (this host's key)`, `managed:${s.provider}`)),
      ...(services.length ? [] : [Object.assign(new Option('Managed: this host offers no service', 'managed:'), { disabled: true })]),
      new Option(`Custom: this ${word('environment')}'s own service and key`, 'custom'),
    );
    sel.value = [...sel.options].some((o) => o.value === keep && !o.disabled) ? keep : (services.length ? `managed:${services[0].provider}` : 'custom');
  }

  function syncAiPanel() {
    const provider = $('ai-provider').value;
    const managed = managedChosen();
    if (source) {
      const s = offered().find((x) => x.provider === managedProvider());
      $('ai-managed-note').hidden = !managed;
      $('ai-managed-note').textContent = s ? `Every request goes to ${COMPANY[s.provider] || s.provider}${s.model ? ' (' + s.model + ')' : ''} under the host's own account and key. Nothing is set up here; the allowance below is this ${word('environment')}'s own.` : '';
      for (const el of document.querySelectorAll('[data-ai-custom]')) el.hidden = managed;
    }
    $('ai-notice').textContent = managed ? '' : fill(AI_NOTICES[provider] || '');
    $('ai-notice').hidden = managed || !AI_NOTICES[provider];
    for (const el of $('ai-panel').querySelectorAll('[data-ai-for]')) el.hidden = managed || !el.dataset.aiFor.split(' ').includes(provider);
    $('ai-key-optional').hidden = provider !== 'compatible';
    const set = (aiState.keySet || aiKeyMode === 'replace') && aiKeyMode !== 'clear';
    // A saved key this server can't read (the server says why in keyProblem): it counts as none and has to be entered again.
    const problem = aiState.keyProblem && aiKeyMode === 'keep' ? aiState.keyProblem.charAt(0).toUpperCase() + aiState.keyProblem.slice(1) : '';
    $('ai-key-state').textContent = aiState.keyFromEnvironment ? 'set by the server\'s environment' : aiKeyMode === 'clear' ? 'will be removed' : set ? 'set' : problem ? 'can\'t be read' : 'not set';
    $('ai-key-state').classList.toggle('on', set);
    $('ai-key-state').classList.toggle('warn', Boolean(problem));
    $('ai-key').hidden = aiKeyMode !== 'replace';
    $('ai-key-replace').hidden = aiState.keyFromEnvironment;
    $('ai-key-replace').textContent = aiKeyMode === 'replace' ? 'Cancel' : aiState.keySet ? 'Replace the key' : problem ? 'Enter the key again' : 'Set a key';
    $('ai-key-clear').hidden = aiState.keyFromEnvironment || !aiState.keySet || aiKeyMode === 'clear';
    $('ai-key-help').textContent = problem || (aiState.keyFromEnvironment ? 'The key comes from the server\'s environment (AI_KEY); change it there.' : 'The key is kept on the server and is never shown again.');
    $('ai-key-help').classList.toggle('status', Boolean(problem));
    $('ai-key-help').classList.toggle('error', Boolean(problem));
    $('ai-model-select').hidden = aiManual;
    $('ai-model').hidden = !aiManual;
    $('ai-models-refresh').hidden = aiManual;
  }

  // The models the company offers, asked with the key (the typed one, or the saved one); a failure says why and offers typing the name.
  async function loadAiModels() {
    const provider = $('ai-provider').value;
    const sel = $('ai-model-select');
    if (provider === 'none' || managedChosen()) return;
    const wanted = aiManual ? $('ai-model').value.trim() : sel.value || aiState.model || '';
    const needsKey = provider !== 'compatible';
    const haveKey = aiState.keySet || aiState.keyFromEnvironment || (aiKeyMode === 'replace' && $('ai-key').value);
    if (needsKey && !haveKey) {
      sel.replaceChildren(new Option('Set a key to see the models', ''));
      $('ai-models-hint').textContent = 'The list comes from ' + (provider === 'openai' ? 'OpenAI' : 'Anthropic') + ', so it needs a key first.';
      $('ai-model-manual').hidden = false;
      return;
    }
    if (provider === 'compatible' && !$('ai-address').value.trim()) {
      sel.replaceChildren(new Option('Enter the address first', ''));
      $('ai-models-hint').textContent = '';
      return;
    }
    const mine = ++aiModelsToken;
    sel.replaceChildren(new Option('Loading models...', ''));
    $('ai-models-hint').textContent = '';
    try {
      const body = { provider, address: $('ai-address').value.trim(), workspace: provider === 'anthropic' ? $('ai-workspace').value.trim() : '' };
      if (aiKeyMode === 'replace' && $('ai-key').value) body.key = $('ai-key').value;
      const { models: list = [] } = await api('POST', models, body);
      if (mine !== aiModelsToken) return;
      sel.replaceChildren(...list.map((m) => new Option(m.name || m.id, m.id)));
      if (wanted && !list.some((m) => m.id === wanted)) sel.append(new Option(wanted + ' (current)', wanted));
      if (!list.length) sel.append(new Option('No models were listed', ''));
      sel.value = wanted || (list[0] && list[0].id) || '';
      $('ai-models-hint').textContent = list.length ? list.length + ' models available.' : '';
      $('ai-model-manual').hidden = false;
    } catch (err) {
      if (mine !== aiModelsToken) return;
      sel.replaceChildren(...(wanted ? [new Option(wanted + ' (current)', wanted)] : [new Option('The list could not be loaded', '')]));
      sel.value = wanted;
      $('ai-models-hint').textContent = (err && err.message ? err.message : 'The list of models could not be loaded') + '.';
      $('ai-model-manual').hidden = false;
    }
  }

  function showAi({ ai, usage: used }) {
    aiState = { source: 'custom', managed: { available: false, services: [] }, ...ai };
    aiKeyMode = 'keep';
    aiManual = false;
    if (source) {
      drawSourceOptions();
      const chosen = aiState.source === 'managed' && offered().some((s) => s.provider === aiState.managedProvider) ? `managed:${aiState.managedProvider}` : 'custom';
      $('ai-source').value = chosen;
    }
    $('ai-provider').value = ai.provider === 'openai' && ai.address && !/api\.openai\.com/.test(ai.address) ? 'compatible' : (ai.provider || 'none');
    $('ai-address').value = ai.address || '';
    $('ai-workspace').value = ai.workspace || ''; // an organisation-level Anthropic key must name its workspace
    $('ai-model').value = ai.model || '';
    if (cap) $('ai-cap').value = String(ai.monthlyTokens || 0);
    $('ai-key').value = '';
    syncAiPanel();
    loadAiModels();
    syncAiEnable();
    if (!usage) return;
    const limit = (used && used.monthlyTokens) || 0;
    const off = managedChosen() ? !offered().some((s) => s.provider === managedProvider()) : ai.provider === 'none';
    $('ai-usage').hidden = off;
    const pct = limit ? Math.min(100, Math.round(((used.tokens || 0) / limit) * 100)) : 0;
    $('ai-meter').hidden = !limit;
    $('ai-meter').setAttribute('aria-valuenow', String(pct));
    $('ai-meter-fill').style.width = pct + '%';
    $('ai-meter').classList.toggle('warn', pct >= 90);
    const tasks = Object.entries((used && used.byTask) || {}).map(([k, v]) => k + ' ' + Number(v).toLocaleString()).join(', ');
    $('ai-usage-text').textContent = Number((used && used.tokens) || 0).toLocaleString() + ' tokens in ' + Number((used && used.calls) || 0).toLocaleString() + ' calls' + (limit ? ', ' + pct + '% of the ' + limit.toLocaleString() + ' allowance' : ', no limit set') + (tasks ? '. By task: ' + tasks + '.' : '.');
  }

  // The state pill only: enabling is on the card of the Modules tab. `enabled` comes from the server.
  function syncAiEnable() {
    const pill = $('ai-state');
    if (!pill) return;
    const saved = managedChosen() ? offered().some((s) => s.provider === managedProvider()) : aiState.provider !== 'none' && aiState.model;
    // The host's own form has no enable step: its service is offered or not. An environment's says whether it is enabled.
    if (!source && aiState.enabled === undefined) {
      pill.textContent = saved ? 'Offered' : 'Not offered';
      pill.classList.toggle('on', Boolean(saved));
      return;
    }
    const on = Boolean(saved && (aiState.enabled === undefined ? true : aiState.enabled));
    pill.textContent = on ? 'Enabled' : saved ? 'Disabled' : 'Off';
    pill.classList.toggle('on', on);
  }

  async function loadAi() {
    try { showAi(await api('GET', get)); } catch { $('ai-panel').hidden = true; }
  }

  if (source) $('ai-source').addEventListener('change', () => { syncAiPanel(); loadAiModels(); syncAiEnable(); });
  $('ai-provider').addEventListener('change', () => { aiManual = false; $('ai-model-select').replaceChildren(); syncAiPanel(); loadAiModels(); });
  $('ai-address').addEventListener('change', loadAiModels);
  $('ai-workspace').addEventListener('change', loadAiModels);
  $('ai-models-refresh').addEventListener('click', loadAiModels);
  $('ai-key').addEventListener('change', loadAiModels);
  $('ai-model-manual').addEventListener('click', () => { aiManual = true; $('ai-model').value = $('ai-model-select').value || aiState.model || ''; $('ai-model-manual').hidden = true; syncAiPanel(); $('ai-model').focus(); });
  $('ai-key-replace').addEventListener('click', () => { aiKeyMode = aiKeyMode === 'replace' ? 'keep' : 'replace'; $('ai-key').value = ''; syncAiPanel(); if (aiKeyMode === 'replace') $('ai-key').focus(); else loadAiModels(); });
  $('ai-key-clear').addEventListener('click', () => { aiKeyMode = 'clear'; syncAiPanel(); });
  $('ai-save').addEventListener('click', async () => {
    let body;
    if (managedChosen()) {
      body = { source: 'managed', managedProvider: managedProvider() };
    } else {
      const provider = $('ai-provider').value;
      const model = aiManual ? $('ai-model').value.trim() : $('ai-model-select').value;
      body = { provider, address: provider === 'compatible' ? $('ai-address').value.trim() : '', workspace: provider === 'anthropic' ? $('ai-workspace').value.trim() : '', model: provider === 'none' ? '' : model };
      if (source) body.source = 'custom';
      if (aiKeyMode === 'replace' && $('ai-key').value) body.key = $('ai-key').value;
      if (aiKeyMode === 'clear') body.clearKey = true;
    }
    if (cap) body.monthlyTokens = Math.max(0, Number($('ai-cap').value) || 0);
    say($('ai-status'), 'saving...');
    try {
      await api('PUT', put, body);
      await loadAi();
      say($('ai-status'), 'saved');
    } catch (err) {
      say($('ai-status'), err.message, true);
    }
  });

  return { load: loadAi };
}
