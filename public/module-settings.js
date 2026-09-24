// The forms for the settings modules declare (module.json `settings`): one card per module that has settings of
// a scope, one control per setting, a Save on each card. Used on the Modules tab (the server's), a space's page (the
// room's), the page a space's moderators use (module-settings.html) and the profile page (a person's own). The
// server decides who may change what; this only draws what it is given.
import { api, escapeHtml } from '/brand.js';

// A list of things with a label, an icon and a colour each (Planner's marker types): rows to change, reorder, remove and add. The rows the
// module says are fixed (def.fixed: ids) are always there; their label, icon and colour can change but they cannot be removed.
// Icons are picked from a small set of Font Awesome names that suit a plan; the colour is a hex value.
const ICONS = ['flag', 'flag-checkered', 'plane-departure', 'plane-arrival', 'plane', 'train', 'car', 'ship', 'bus', 'bed', 'utensils', 'mug-hot', 'martini-glass', 'camera', 'mountain', 'umbrella-beach', 'person-walking', 'person-hiking', 'ticket', 'bell', 'clock', 'hourglass-half', 'moon', 'sun', 'face-smile', 'heart', 'star', 'users', 'shopping-bag', 'landmark', 'music', 'circle-exclamation', 'triangle-exclamation', 'location-dot', 'suitcase', 'gift', 'wine-glass', 'spa', 'bolt'];
const HEX = /^#[0-9a-f]{6}$/i;
function listRow(def, r) {
  const fixed = (def.fixed || []).includes(r.id);
  const color = HEX.test(r.color || '') ? r.color : '#888888';
  const icon = ICONS.includes(r.icon) ? r.icon : ICONS[0];
  return `<li class="list-row" data-id="${escapeHtml(r.id || '')}" data-icon="${escapeHtml(icon)}">
    <input type="color" data-f="color" value="${escapeHtml(color)}" aria-label="Colour">
    <details class="icon-pick"><summary aria-label="Icon" title="Icon"><i class="fa-solid fa-${escapeHtml(icon)} fa-fw" aria-hidden="true"></i></summary><div class="icon-grid">${ICONS.map((n) => `<button type="button" data-icon-choice="${n}" title="${n.replace(/-/g, ' ')}"><i class="fa-solid fa-${n} fa-fw" aria-hidden="true"></i></button>`).join('')}</div></details>
    <input type="text" data-f="label" value="${escapeHtml(r.label || '')}" maxlength="${def.maxLength || 30}" placeholder="Label" aria-label="Label">
    <span class="list-tools"><button type="button" class="btn btn-small" data-list="up" title="Move up" aria-label="Move up"><i class="fa-solid fa-arrow-up" aria-hidden="true"></i></button><button type="button" class="btn btn-small" data-list="down" title="Move down" aria-label="Move down"><i class="fa-solid fa-arrow-down" aria-hidden="true"></i></button>${fixed ? '<span class="pill">Built in</span>' : '<button type="button" class="btn btn-small btn-danger" data-list="remove" title="Remove" aria-label="Remove"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>'}</span>
  </li>`;
}
function listControl(def) {
  const rows = Array.isArray(def.value) ? def.value : [];
  return `<div class="list-setting" data-key="${escapeHtml(def.key)}" data-list-setting><div class="hint">${escapeHtml(def.label)}</div><ul class="list-rows">${rows.map((r) => listRow(def, r)).join('')}</ul><button type="button" class="btn btn-small" data-list="add"><i class="fa-solid fa-plus" aria-hidden="true"></i> Add</button></div>`;
}
// What the rows say now: [{ id, label, icon, color }] (a new row has no id: the server makes one from its label).
function readList(el) {
  return [...el.querySelectorAll('.list-row')].map((li) => ({ id: li.dataset.id || '', label: li.querySelector('[data-f="label"]').value.trim(), icon: li.dataset.icon, color: li.querySelector('[data-f="color"]').value }));
}
function wireList(el, def) {
  el.addEventListener('click', (event) => {
    const choice = event.target.closest('[data-icon-choice]');
    const li = event.target.closest('.list-row');
    if (choice && li) {
      li.dataset.icon = choice.dataset.iconChoice;
      li.querySelector('summary i').className = `fa-solid fa-${choice.dataset.iconChoice} fa-fw`;
      li.querySelector('details').open = false;
      return;
    }
    const b = event.target.closest('[data-list]');
    if (!b) return;
    const list = el.querySelector('.list-rows');
    if (b.dataset.list === 'add') {
      list.insertAdjacentHTML('beforeend', listRow(def, { id: '', label: '', icon: 'flag', color: '#4f8fdd' }));
      list.lastElementChild.querySelector('[data-f="label"]').focus();
    } else if (li && b.dataset.list === 'remove') li.remove();
    else if (li && b.dataset.list === 'up' && li.previousElementSibling) li.previousElementSibling.before(li);
    else if (li && b.dataset.list === 'down' && li.nextElementSibling) li.nextElementSibling.after(li);
  });
}

function control(def) {
  if (def.type === 'list') return listControl(def);
  const id = `ms-${def.key}`;
  if (def.type === 'boolean') return `<label class="check"><input type="checkbox" data-key="${escapeHtml(def.key)}" ${def.value ? 'checked' : ''}> ${escapeHtml(def.label)}</label>`;
  // A note has no control and no value: a label (its help under it), for a module to say where something is set up.
  if (def.type === 'note') return `<span class="field-label">${escapeHtml(def.label)}</span>`; // its help follows, as every setting's does
  const head = `<label>${escapeHtml(def.label)}`;
  if (def.type === 'choice') return `${head}<select data-key="${escapeHtml(def.key)}">${def.options.map((o) => `<option value="${escapeHtml(o.value)}" ${o.value === def.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select></label>${def.options.some((o) => o.help) ? '<div class="option-help" data-option-help></div>' : ''}`;
  // A setting the host keeps for every environment (a shared folder, or the address regions are cut from): shown, never set here.
  if (def.shared) {
    const files = def.type === 'files' ? (def.available || []) : [];
    const list = files.length ? `<ul class="shared-files">${files.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : def.type === 'files' ? '<p class="hint">The host has no files here yet.</p>' : '';
    return `<div data-shared><div class="hint">${escapeHtml(def.label)} <span class="pill">Provided by the host</span></div>${list}${def.type !== 'files' && def.value ? `<p class="hint">${escapeHtml(String(def.value))}</p>` : ''}</div>`;
  }
  if (def.type === 'files') {
    const chosen = new Set(Array.isArray(def.value) ? def.value : def.value ? [def.value] : []);
    const size = (n) => { const b = (def.sizes || {})[n]; return b === undefined ? '' : b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`; };
    // How detailed a map file is (street-level or not), read from its own PMTiles header -- blank for anything else.
    const zoom = (n) => { const z = (def.zooms || {})[n]; return z ? (z.minZoom === z.maxZoom ? `${z.maxZoom}` : `${z.minZoom}–${z.maxZoom}`) : ''; };
    const hasZooms = Object.keys(def.zooms || {}).length > 0;
    const rows = (def.available || []).map((n) => `<tr><td><input type="checkbox" value="${escapeHtml(n)}" ${chosen.has(n) ? 'checked' : ''} aria-label="Use ${escapeHtml(n)}"></td><td>${escapeHtml(n)}</td>${hasZooms ? `<td class="hint">${zoom(n)}</td>` : ''}<td class="hint">${size(n)}</td><td><button type="button" class="btn btn-small btn-danger" data-delete-file="${escapeHtml(n)}" title="Delete ${escapeHtml(n)}" aria-label="Delete ${escapeHtml(n)}"><i class="fa-solid fa-trash" aria-hidden="true"></i></button></td></tr>`).join('');
    return `<div data-key="${escapeHtml(def.key)}" data-files><div class="hint">${escapeHtml(def.label)}</div>${rows ? `<table class="files-table"><thead><tr><th>Use</th><th>File</th>${hasZooms ? '<th>Zoom</th>' : ''}<th>Size</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : ''}${(def.available || []).length && !(def.skipped || []).length ? '' : `<p class="hint">${escapeHtml(fileHint(def))}</p>`}</div>`;
  }
  if (def.type === 'file') return `${head}<select data-key="${escapeHtml(def.key)}"><option value="">None</option>${(def.available || []).map((n) => `<option value="${escapeHtml(n)}" ${n === def.value ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select></label>${(def.available || []).length && !(def.skipped || []).length ? '' : `<p class="hint">${escapeHtml(fileHint(def))}</p>`}`;
  if (def.type === 'url') return `${head}<input id="${id}" type="url" data-key="${escapeHtml(def.key)}" value="${escapeHtml(def.value)}" maxlength="500" placeholder="https://"></label>`;
  if (def.type === 'number') return `${head}<input id="${id}" type="number" data-key="${escapeHtml(def.key)}" value="${escapeHtml(def.value)}" ${def.min !== undefined ? `min="${def.min}"` : ''} ${def.max !== undefined ? `max="${def.max}"` : ''} step="any"></label>`;
  if (def.type === 'color') return `${head}<input id="${id}" type="color" data-key="${escapeHtml(def.key)}" value="${escapeHtml(/^#[0-9a-f]{6}$/i.test(def.value) ? def.value : '#000000')}"></label>`;
  return `${head}<input id="${id}" type="text" data-key="${escapeHtml(def.key)}" value="${escapeHtml(def.value)}" maxlength="${def.maxLength || 100}"></label>`;
}

// Fill `container` with the settings of one scope ('server', 'room' with { room }, or 'person'). The container is
// left hidden when there is nothing to set.
// Why the list of files is empty, from what the server found in the folder.
function fileHint(def) {
  const where = def.folder ? `Looking in ${def.folder}` : 'Looking in the module\'s folder in the data folder';
  if (def.exists === false) return `${where}, which does not exist yet. Create it and copy the file in.`;
  const skipped = def.skipped || [];
  if ((def.available || []).length) return `The server ignored ${skipped.length} other file${skipped.length === 1 ? '' : 's'} in ${def.folder || 'the folder'}: ${skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}.`;
  if (skipped.length) return `${where}, which has ${skipped.length} file${skipped.length === 1 ? '' : 's'} The server ignored: ${skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}.`;
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
      <div class="module-settings-fields">${m.settings.map((d) => `<div class="module-setting"${d.showWhen ? ` data-when-key="${escapeHtml(d.showWhen.key)}" ${d.showWhen.not !== undefined ? `data-when-not="${escapeHtml(d.showWhen.not)}"` : `data-when-value="${escapeHtml(d.showWhen.value)}"`}` : ''}>${control(d)}${d.help ? `<p class="hint">${escapeHtml(d.help)}</p>` : ''}</div>`).join('')}</div>
      <div class="row"><button class="btn btn-primary btn-small" data-save type="button">Save</button><span class="status" data-status></span></div>
    </div>`).join('');
  // What the chosen option says (its own help, more than a line can hold), and the settings that only apply to a choice.
  const linkify = (text) => escapeHtml(text).replace(/https:\/\/[^\s<)]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  const refresh = (card) => {
    const module = modules.find((m) => m.id === card.dataset.module);
    const value = (key) => { const el = card.querySelector(`[data-key="${key}"]`); return el ? (el.type === 'checkbox' ? String(el.checked) : el.value) : ''; };
    for (const sel of card.querySelectorAll('select[data-key]')) {
      const def = module.settings.find((d) => d.key === sel.dataset.key);
      const box = sel.closest('.module-setting').querySelector('[data-option-help]');
      const option = def && def.options.find((o) => o.value === sel.value);
      if (box) box.innerHTML = option && option.help ? option.help.split(/\n+/).map((p) => `<p class="hint">${linkify(p)}</p>`).join('') : '';
    }
    for (const row of card.querySelectorAll('[data-when-key]')) row.hidden = row.dataset.whenNot !== undefined ? value(row.dataset.whenKey) === row.dataset.whenNot : value(row.dataset.whenKey) !== row.dataset.whenValue;
  };
  for (const box of container.querySelectorAll('[data-list-setting]')) wireList(box, modules.find((m) => m.id === box.closest('.module-settings-card').dataset.module).settings.find((d) => d.key === box.dataset.key));
  for (const card of container.querySelectorAll('.module-settings-card')) {
    refresh(card);
    card.addEventListener('change', () => refresh(card));
  }
  container.onclick = async (event) => {
    const delBtn = event.target.closest('[data-delete-file]');
    if (delBtn) {
      const card = delBtn.closest('.module-settings-card');
      const module = modules.find((m) => m.id === card.dataset.module);
      const name = delBtn.dataset.deleteFile;
      if (!window.confirm(`Delete ${name}? This can't be undone.`)) return;
      delBtn.disabled = true;
      try {
        await api('DELETE', `/api/modules/${encodeURIComponent(module.id)}/files/${encodeURIComponent(name)}`);
        await renderModuleSettings(container, { scope, room, only, heading });
      } catch (err) {
        delBtn.disabled = false;
        window.alert(err.message);
      }
      return;
    }
    const button = event.target.closest('[data-save]');
    if (!button) return;
    const card = button.closest('.module-settings-card');
    const status = card.querySelector('[data-status]');
    const module = modules.find((m) => m.id === card.dataset.module);
    const values = {};
    for (const el of card.querySelectorAll('[data-key]')) {
      const def = module.settings.find((d) => d.key === el.dataset.key);
      values[def.key] = def.type === 'list' ? readList(el) : def.type === 'files' ? [...el.querySelectorAll('input:checked')].map((i) => i.value) : def.type === 'boolean' ? el.checked : def.type === 'number' ? Number(el.value) : el.value;
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
