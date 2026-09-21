// The forms for the settings modules declare (module.json `settings`): one card per module that has settings of
// a scope, one control per setting, a Save on each card. Used on the Modules tab (the server's), a room's page (the
// room's), the page a room's moderators use (module-settings.html) and the profile page (a person's own). The
// server decides who may change what; this only draws what it is given.
import { api, escapeHtml } from '/brand.js';

function control(def) {
  const id = `ms-${def.key}`;
  if (def.type === 'boolean') return `<label class="check"><input type="checkbox" data-key="${escapeHtml(def.key)}" ${def.value ? 'checked' : ''}> ${escapeHtml(def.label)}</label>`;
  const head = `<label>${escapeHtml(def.label)}`;
  if (def.type === 'choice') return `${head}<select data-key="${escapeHtml(def.key)}">${def.options.map((o) => `<option value="${escapeHtml(o.value)}" ${o.value === def.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select></label>`;
  if (def.type === 'file') return `${head}<select data-key="${escapeHtml(def.key)}"><option value="">None</option>${(def.available || []).map((n) => `<option value="${escapeHtml(n)}" ${n === def.value ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select></label>${(def.available || []).length && !(def.skipped || []).length ? '' : `<p class="hint">${escapeHtml(fileHint(def))}</p>`}`;
  if (def.type === 'url') return `${head}<input id="${id}" type="url" data-key="${escapeHtml(def.key)}" value="${escapeHtml(def.value)}" maxlength="500" placeholder="https://"></label>`;
  if (def.type === 'number') return `${head}<input id="${id}" type="number" data-key="${escapeHtml(def.key)}" value="${escapeHtml(def.value)}" ${def.min !== undefined ? `min="${def.min}"` : ''} ${def.max !== undefined ? `max="${def.max}"` : ''} step="any"></label>`;
  return `${head}<input id="${id}" type="text" data-key="${escapeHtml(def.key)}" value="${escapeHtml(def.value)}" maxlength="${def.maxLength || 100}"></label>`;
}

// Fill `container` with the settings of one scope ('server', 'room' with { room }, or 'person'). The container is
// left hidden when there is nothing to set.
// Why the list of files is empty, from what the server found in the folder.
function fileHint(def) {
  const where = def.folder ? `Looking in ${def.folder}` : 'Looking in the module\'s folder in the data folder';
  if (def.exists === false) return `${where}, which does not exist yet. Create it and copy the file in.`;
  const skipped = def.skipped || [];
  if ((def.available || []).length) return `Tavern ignored ${skipped.length} other file${skipped.length === 1 ? '' : 's'} in ${def.folder || 'the folder'}: ${skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}.`;
  if (skipped.length) return `${where}, which has ${skipped.length} file${skipped.length === 1 ? '' : 's'} Tavern ignored: ${skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}.`;
  return `${where}, which is empty. Copy the file in.`;
}

export async function renderModuleSettings(container, { scope, room = null, only = '', heading = true }) {
  container.hidden = true;
  let modules;
  try {
    const q = room ? `?room=${encodeURIComponent(room)}` : '';
    modules = (await api('GET', `/api/module-settings/${scope}${q}`)).modules;
  } catch {
    return; // not something this person may set here
  }
  if (only) modules = modules.filter((m) => m.id === only);
  if (!modules.length) return;
  container.hidden = false;
  container.innerHTML = modules.map((m) => `
    <div class="module-settings-card" data-module="${escapeHtml(m.id)}">
      ${heading ? `<h3><i class="fa-solid fa-${escapeHtml(m.icon)} fa-fw" aria-hidden="true"></i> ${escapeHtml(m.name)}</h3>` : ''}
      <div class="module-settings-fields">${m.settings.map((d) => `<div class="module-setting">${control(d)}${d.help ? `<p class="hint">${escapeHtml(d.help)}</p>` : ''}</div>`).join('')}</div>
      <div class="row"><button class="btn btn-primary btn-small" data-save type="button">Save</button><span class="status" data-status></span></div>
    </div>`).join('');
  container.onclick = async (event) => {
    const button = event.target.closest('[data-save]');
    if (!button) return;
    const card = button.closest('.module-settings-card');
    const status = card.querySelector('[data-status]');
    const module = modules.find((m) => m.id === card.dataset.module);
    const values = {};
    for (const el of card.querySelectorAll('[data-key]')) {
      const def = module.settings.find((d) => d.key === el.dataset.key);
      values[def.key] = def.type === 'boolean' ? el.checked : def.type === 'number' ? Number(el.value) : el.value;
    }
    status.classList.remove('error');
    status.textContent = 'saving...';
    try {
      await api('PUT', `/api/modules/${encodeURIComponent(module.id)}/settings/${scope}`, { values, ...(room ? { room } : {}) });
      status.textContent = 'saved';
    } catch (err) {
      status.textContent = err.message;
      status.classList.add('error');
    }
  };
}
