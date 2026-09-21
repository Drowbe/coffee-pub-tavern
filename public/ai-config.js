// The AI service's configuration page (Manage > Modules > AI service > AI Configuration): /ai-config.html. Admins only.
// The person picks a company by name and Tavern knows its address; the models are listed from the company's own list, not typed.
// The key is write-only: the page is told only whether one is set, and a typed key replaces it.
import { loadBranding, api, renderTopbar, crumbLink, wireOverlayBack } from '/brand.js';

const $ = (id) => document.getElementById(id);
function say(el, text, error = false) {
  el.textContent = text;
  el.classList.toggle('error', Boolean(error));
}

renderTopbar({ location: crumbLink('gear', 'Server Settings', '/admin') });
await loadBranding();
wireOverlayBack();

const AI_NOTICES = {
  none: 'AI is off. A module that asks for it is told AI is not set up.',
  openai: 'Sends the items a person selects, and their question, to OpenAI under your account and its terms. Only what a person selects is sent, never another room.',
  anthropic: 'Sends the items a person selects, and their question, to Anthropic under your account and its terms. Only what a person selects is sent, never another room.',
  compatible: 'Sends the items a person selects, and their question, to the address below. For a hosted service that means to that company, under its terms and your account. For a model you run yourself nothing leaves your network. Only what a person selects is sent, never another room.',
};
let aiState = { provider: 'none', keySet: false, keyFromEnvironment: false, model: '' };
let aiKeyMode = 'keep'; // keep | replace | clear
let aiManual = false; // typing the model's name because the list could not be had
let aiModelsToken = 0;
function syncAiPanel() {
  const provider = $('ai-provider').value;
  $('ai-notice').textContent = AI_NOTICES[provider] || '';
  $('ai-notice').hidden = !AI_NOTICES[provider];
  for (const el of $('ai-panel').querySelectorAll('[data-ai-for]')) el.hidden = !el.dataset.aiFor.split(' ').includes(provider);
  $('ai-key-optional').hidden = provider !== 'compatible';
  const set = (aiState.keySet || aiKeyMode === 'replace') && aiKeyMode !== 'clear';
  $('ai-key-state').textContent = aiState.keyFromEnvironment ? 'set by the server\'s environment' : aiKeyMode === 'clear' ? 'will be removed' : set ? 'set' : 'not set';
  $('ai-key-state').classList.toggle('on', set);
  $('ai-key').hidden = aiKeyMode !== 'replace';
  $('ai-key-replace').hidden = aiState.keyFromEnvironment;
  $('ai-key-replace').textContent = aiKeyMode === 'replace' ? 'Cancel' : aiState.keySet ? 'Replace the key' : 'Set a key';
  $('ai-key-clear').hidden = aiState.keyFromEnvironment || !aiState.keySet || aiKeyMode === 'clear';
  $('ai-key-help').textContent = aiState.keyFromEnvironment ? 'The key comes from the server\'s environment (TAVERN_AI_KEY); change it there.' : 'The key is kept on the server and is never shown again.';
  $('ai-model-select').hidden = aiManual;
  $('ai-model').hidden = !aiManual;
  $('ai-models-refresh').hidden = aiManual;
}
// The models the company offers, asked with the key (the typed one, or the saved one); a failure says why and offers typing the name.
async function loadAiModels() {
  const provider = $('ai-provider').value;
  const sel = $('ai-model-select');
  if (provider === 'none') return;
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
    const { models } = await api('POST', '/api/ai/models', body);
    if (mine !== aiModelsToken) return;
    const list = models || [];
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
function showAi({ ai, usage }) {
  aiState = ai;
  aiKeyMode = 'keep';
  aiManual = false;
  $('ai-provider').value = ai.provider === 'openai' && ai.address && !/api\.openai\.com/.test(ai.address) ? 'compatible' : (ai.provider || 'none');
  $('ai-address').value = ai.address || '';
  $('ai-model').value = ai.model || '';
  $('ai-cap').value = String(ai.monthlyTokens || 0);
  $('ai-key').value = '';
  syncAiPanel();
  loadAiModels();
  syncAiEnable();
  const cap = usage.monthlyTokens || 0;
  $('ai-usage').hidden = ai.provider === 'none';
  const pct = cap ? Math.min(100, Math.round((usage.tokens / cap) * 100)) : 0;
  $('ai-meter').hidden = !cap;
  $('ai-meter').setAttribute('aria-valuenow', String(pct));
  $('ai-meter-fill').style.width = pct + '%';
  $('ai-meter').classList.toggle('warn', pct >= 90);
  const tasks = Object.entries(usage.byTask || {}).map(([k, v]) => k + ' ' + Number(v).toLocaleString()).join(', ');
  $('ai-usage-text').textContent = Number(usage.tokens || 0).toLocaleString() + ' tokens in ' + Number(usage.calls || 0).toLocaleString() + ' calls' + (cap ? ', ' + pct + '% of the ' + cap.toLocaleString() + ' allowance' : ', no limit set') + (tasks ? '. By task: ' + tasks + '.' : '.');
}
// The state pill only: enabling is on the card of the Modules tab. `enabled` comes from the server.
function syncAiEnable() {
  const saved = aiState.provider !== 'none' && aiState.model;
  const on = Boolean(saved && (aiState.enabled === undefined ? true : aiState.enabled));
  $('ai-state').textContent = on ? 'Enabled' : saved ? 'Disabled' : 'Off';
  $('ai-state').classList.toggle('on', on);
}
async function loadAi() {
  try { showAi(await api('GET', '/api/ai')); } catch { $('ai-panel').hidden = true; }
}
$('ai-provider').addEventListener('change', () => { aiManual = false; $('ai-model-select').replaceChildren(); syncAiPanel(); loadAiModels(); });
$('ai-address').addEventListener('change', loadAiModels);
$('ai-models-refresh').addEventListener('click', loadAiModels);
$('ai-key').addEventListener('change', loadAiModels);
$('ai-model-manual').addEventListener('click', () => { aiManual = true; $('ai-model').value = $('ai-model-select').value || aiState.model || ''; $('ai-model-manual').hidden = true; syncAiPanel(); $('ai-model').focus(); });
$('ai-key-replace').addEventListener('click', () => { aiKeyMode = aiKeyMode === 'replace' ? 'keep' : 'replace'; $('ai-key').value = ''; syncAiPanel(); if (aiKeyMode === 'replace') $('ai-key').focus(); else loadAiModels(); });
$('ai-key-clear').addEventListener('click', () => { aiKeyMode = 'clear'; syncAiPanel(); });
$('ai-save').addEventListener('click', async () => {
  const provider = $('ai-provider').value;
  const model = aiManual ? $('ai-model').value.trim() : $('ai-model-select').value;
  const body = { provider, address: provider === 'compatible' ? $('ai-address').value.trim() : '', model: provider === 'none' ? '' : model, monthlyTokens: Math.max(0, Number($('ai-cap').value) || 0) };
  if (aiKeyMode === 'replace' && $('ai-key').value) body.key = $('ai-key').value;
  if (aiKeyMode === 'clear') body.clearKey = true;
  say($('ai-status'), 'saving...');
  try {
    await api('PUT', '/api/ai', body);
    await loadAi();
    say($('ai-status'), 'saved');
  } catch (err) {
    say($('ai-status'), err.message, true);
  }
});


try {
  const me = (await api('GET', '/api/me')).user;
  if (me.role !== 'admin') location.href = '/';
  else await loadAi();
} catch {
  location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
}
