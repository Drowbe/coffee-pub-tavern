// The AI service's form, shared by two pages that carry the same fields (the same ids): an environment's AI
// configuration page (/ai-config.html, where the choice is the host's managed service or a custom one) and the host
// console's Managed AI panel (the one service the host offers every environment). The person picks a company by name
// and the server knows its address; the models are listed from the company's own list, not typed. The key is
// write-only: the page is told only whether one is set, and a typed key replaces it.
//
// mountAiForm({ get, put, models, source, cap, usage }): `get`, `put` and `models` are the API paths; `source` draws the
// managed/custom choice (the environment's page), `cap` the monthly allowance, `usage` this month's use.
import { api } from '/brand.js';

const $ = (id) => document.getElementById(id);
function say(el, text, error = false) {
  el.textContent = text;
  el.classList.toggle('error', Boolean(error));
}

const AI_NOTICES = {
  none: 'AI is off. A module that asks for it is told AI is not set up.',
  openai: 'Sends the items a person selects, and their question, to OpenAI under your account and its terms. Only what a person selects is sent, never another space.',
  anthropic: 'Sends the items a person selects, and their question, to Anthropic under your account and its terms. Only what a person selects is sent, never another space.',
  compatible: 'Sends the items a person selects, and their question, to the address below. For a hosted service that means to that company, under its terms and your account. For a model you run yourself nothing leaves your network. Only what a person selects is sent, never another space.',
};
const COMPANY = { openai: 'OpenAI', anthropic: 'Anthropic', compatible: 'another service', none: 'none' };

export function mountAiForm({ get, put, models, source = false, cap = false, usage = false }) {
  let aiState = { provider: 'none', keySet: false, keyFromEnvironment: false, model: '', source: 'custom', managed: { available: false } };
  let aiKeyMode = 'keep'; // keep | replace | clear
  let aiManual = false; // typing the model's name because the list could not be had
  let aiModelsToken = 0;

  const managedChosen = () => source && $('ai-source').value === 'managed';

  function syncAiPanel() {
    const provider = $('ai-provider').value;
    const managed = managedChosen();
    if (source) {
      const m = aiState.managed || {};
      const opt = $('ai-source').querySelector('option[value="managed"]');
      opt.disabled = !m.available;
      opt.textContent = m.available ? `Managed: this host's service (${COMPANY[m.provider] || m.provider}${m.model ? ', ' + m.model : ''})` : 'Managed: this host offers no service';
      $('ai-managed-note').hidden = !managed;
      $('ai-managed-note').textContent = m.available ? `Every request goes to ${COMPANY[m.provider] || m.provider}${m.model ? ' (' + m.model + ')' : ''} under the host's own account and key. Nothing is set up here; the allowance below is this environment's own.` : '';
      for (const el of document.querySelectorAll('[data-ai-custom]')) el.hidden = managed;
    }
    $('ai-notice').textContent = managed ? '' : AI_NOTICES[provider] || '';
    $('ai-notice').hidden = managed || !AI_NOTICES[provider];
    for (const el of $('ai-panel').querySelectorAll('[data-ai-for]')) el.hidden = managed || !el.dataset.aiFor.split(' ').includes(provider);
    $('ai-key-optional').hidden = provider !== 'compatible';
    const set = (aiState.keySet || aiKeyMode === 'replace') && aiKeyMode !== 'clear';
    $('ai-key-state').textContent = aiState.keyFromEnvironment ? 'set by the server\'s environment' : aiKeyMode === 'clear' ? 'will be removed' : set ? 'set' : 'not set';
    $('ai-key-state').classList.toggle('on', set);
    $('ai-key').hidden = aiKeyMode !== 'replace';
    $('ai-key-replace').hidden = aiState.keyFromEnvironment;
    $('ai-key-replace').textContent = aiKeyMode === 'replace' ? 'Cancel' : aiState.keySet ? 'Replace the key' : 'Set a key';
    $('ai-key-clear').hidden = aiState.keyFromEnvironment || !aiState.keySet || aiKeyMode === 'clear';
    $('ai-key-help').textContent = aiState.keyFromEnvironment ? 'The key comes from the server\'s environment (AI_KEY); change it there.' : 'The key is kept on the server and is never shown again.';
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
      const body = { provider, address: $('ai-address').value.trim() };
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
    aiState = { source: 'custom', managed: { available: false }, ...ai };
    aiKeyMode = 'keep';
    aiManual = false;
    if (source) $('ai-source').value = aiState.source === 'managed' && aiState.managed && aiState.managed.available ? 'managed' : 'custom';
    $('ai-provider').value = ai.provider === 'openai' && ai.address && !/api\.openai\.com/.test(ai.address) ? 'compatible' : (ai.provider || 'none');
    $('ai-address').value = ai.address || '';
    $('ai-model').value = ai.model || '';
    if (cap) $('ai-cap').value = String(ai.monthlyTokens || 0);
    $('ai-key').value = '';
    syncAiPanel();
    loadAiModels();
    syncAiEnable();
    if (!usage) return;
    const limit = (used && used.monthlyTokens) || 0;
    const off = managedChosen() ? !(aiState.managed && aiState.managed.available) : ai.provider === 'none';
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
    const saved = managedChosen() ? Boolean(aiState.managed && aiState.managed.available) : aiState.provider !== 'none' && aiState.model;
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
  $('ai-models-refresh').addEventListener('click', loadAiModels);
  $('ai-key').addEventListener('change', loadAiModels);
  $('ai-model-manual').addEventListener('click', () => { aiManual = true; $('ai-model').value = $('ai-model-select').value || aiState.model || ''; $('ai-model-manual').hidden = true; syncAiPanel(); $('ai-model').focus(); });
  $('ai-key-replace').addEventListener('click', () => { aiKeyMode = aiKeyMode === 'replace' ? 'keep' : 'replace'; $('ai-key').value = ''; syncAiPanel(); if (aiKeyMode === 'replace') $('ai-key').focus(); else loadAiModels(); });
  $('ai-key-clear').addEventListener('click', () => { aiKeyMode = 'clear'; syncAiPanel(); });
  $('ai-save').addEventListener('click', async () => {
    let body;
    if (managedChosen()) {
      body = { source: 'managed' };
    } else {
      const provider = $('ai-provider').value;
      const model = aiManual ? $('ai-model').value.trim() : $('ai-model-select').value;
      body = { provider, address: provider === 'compatible' ? $('ai-address').value.trim() : '', model: provider === 'none' ? '' : model };
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
