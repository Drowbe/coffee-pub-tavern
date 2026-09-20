import { loadBranding, api, wireOverlayBack, renderTopbar, escapeHtml, crumbLink, getIcons, setUpdateBadge } from '/brand.js';

const $ = (id) => document.getElementById(id);
const cards = new Map(); // key -> card element
let me = null;
let streamKey = '';
let streamShown = false;
let users = [];

// The choices come from the Font Awesome list on the Theme tab.
let selectedHomeIcon = 'couch';

function buildHomeIconGrid() {
  const grid = $('set-home-icon');
  grid.textContent = '';
  for (const { id, classes, label } of getIcons()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.icon = id;
    btn.title = label || id;
    btn.innerHTML = `<i class="${escapeHtml(classes)} fa-fw" aria-hidden="true"></i>`;
    btn.addEventListener('click', () => {
      selectedHomeIcon = id;
      renderHomeIconSelection();
    });
    grid.appendChild(btn);
  }
}
function renderHomeIconSelection() {
  for (const btn of $('set-home-icon').children) btn.classList.toggle('selected', btn.dataset.icon === selectedHomeIcon);
}

function say(el, text, error = false) {
  el.textContent = text;
  el.classList.toggle('error', error);
  if (text && !error) setTimeout(() => el.textContent === text && (el.textContent = ''), 3000);
}

async function copy(text, statusEl) {
  try {
    await navigator.clipboard.writeText(text);
    if (statusEl) say(statusEl, 'copied');
  } catch (err) {
    window.prompt('Copy this:', text);
  }
}

function imgUrl(key, slot) {
  return `/img/${encodeURIComponent(key)}/${slot}?v=${Date.now()}`;
}

// Server / Theme / Rooms / Roles / Users / About tabs, remembered in the address
const TABS = ['server', 'theme', 'rooms', 'roles', 'users', 'modules', 'about'];
function selectTab(name) {
  if (name === 'settings') name = 'server'; // the old name
  const tab = TABS.includes(name) ? name : 'server';
  for (const t of TABS) $(`tab-${t}`).hidden = tab !== t;
  for (const b of document.querySelectorAll('.subtab')) b.classList.toggle('active', b.dataset.tab === tab);
  if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
}
$('subtabs').addEventListener('click', (event) => {
  const b = event.target.closest('.subtab');
  if (b) selectTab(b.dataset.tab);
});
window.addEventListener('hashchange', () => selectTab(location.hash.slice(1)));
selectTab(location.hash.slice(1));

$('add-toggle').addEventListener('click', () => {
  $('add-user').hidden = !$('add-user').hidden;
  if (!$('add-user').hidden) $('new-login').focus();
});
$('add-cancel').addEventListener('click', () => {
  $('add-user').hidden = true;
  $('add-user').reset();
  $('new-link').checked = true;
});

// A card is just a roster row now: status, a thumbnail, quick mute/kick for
// whoever is live, and a link to their profile page, which is the one place
// any of a user's own settings actually get edited (see profile.js).
function fill(card, user) {
  card.dataset.key = user.key;
  card.querySelector('[data-name]').textContent = user.displayName;
  card.querySelector('[data-login]').textContent = user.login;
  card.querySelector('[data-role]').textContent = user.role;
  card.querySelector('[data-key]').textContent = user.key;
  card.querySelector('[data-thumb]').src = imgUrl(user.key, 'profile');
  card.querySelector('[data-action="edit"]').href = `/profile/${encodeURIComponent(user.key)}`;
  renderLive(card, user.online);
}

function renderLive(card, online) {
  const dot = card.querySelector('[data-dot]');
  dot.classList.toggle('online', !!online);
  dot.title = online ? 'at the table' : 'offline';
  const live = card.querySelector('[data-live]');
  const inRoom = online && online.room ? rooms.find((r) => r.id === online.room) : null;
  live.textContent = online ? `${inRoom ? `in ${inRoom.name} · ` : ''}${online.micOn ? 'mic on' : 'mic off'} · ${online.cameraOn ? 'camera on' : 'camera off'}` : '';
  card.querySelector('[data-action="mute"]').hidden = !online || !online.micOn;
  card.querySelector('[data-action="kick"]').hidden = !online;
}

function cardFor(user) {
  let card = cards.get(user.key);
  if (card) return card;
  card = $('user-card').content.firstElementChild.cloneNode(true);
  cards.set(user.key, card);
  $('users').appendChild(card);
  wire(card);
  return card;
}

function userOf(card) {
  return users.find((u) => u.key === card.dataset.key);
}

function wire(card) {
  card.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || !card.contains(button)) return;
    const user = userOf(card);
    const action = button.dataset.action;
    if (action === 'mute') {
      api('POST', `/api/users/${user.key}/mute`, { muted: true }).then(refreshLive).catch((err) => say($('party-status'), err.message, true));
    } else if (action === 'kick') {
      if (!window.confirm(`Kick ${user.displayName} from the table? They can rejoin.`)) return;
      api('POST', `/api/users/${user.key}/kick`).then(refreshLive).catch((err) => say($('party-status'), err.message, true));
    }
  });
}

function renderUsers() {
  for (const user of users) fill(cardFor(user), user);
  for (const [key, card] of cards) {
    if (!users.some((u) => u.key === key)) {
      card.remove();
      cards.delete(key);
    }
  }
  $('party-status').textContent = `${users.filter((u) => u.online).length} of ${users.length} at the table`;
  renderRooms(); // the member lists follow the users
}

async function refreshLive() {
  try {
    const status = await api('GET', '/api/status');
    const byKey = new Map(status.users.map((u) => [u.key, u]));
    users = users.map((u) => ({ ...u, online: byKey.get(u.key)?.online || null }));
    for (const user of users) renderLive(cardFor(user), user.online);
    $('party-status').textContent = `${users.filter((u) => u.online).length} of ${users.length} at the table`;
  } catch (err) {
    // leave the last known state
  }
}

async function loadUsers() {
  const status = await api('GET', '/api/status');
  users = status.users;
  rooms = status.rooms || rooms;
  renderUsers();
}

// --- roles ---------------------------------------------------------------------
// A grid: one row per permission, one column per role. Admin is always all
// on and disabled; the other three save the moment a box is clicked.

const ROLE_COLUMNS = [['admin', 'Admin'], ['moderator', 'Moderator'], ['user', 'User'], ['guest', 'Guest']];

function renderRoles({ permissions, roles }) {
  const rows = ['<thead><tr><th></th>' + ROLE_COLUMNS.map(([, label]) => `<th>${label}</th>`).join('') + '</tr></thead><tbody>'];
  let group = null;
  for (const p of permissions) {
    if (p.group !== group) {
      group = p.group;
      rows.push(`<tr class="roles-group"><th colspan="${ROLE_COLUMNS.length + 1}">${escapeHtml(group)}</th></tr>`);
    }
    rows.push(`<tr><th scope="row">${escapeHtml(p.label)}</th>` + ROLE_COLUMNS.map(([role]) => {
      const locked = role === 'admin';
      return `<td><input type="checkbox" data-role="${role}" data-perm="${p.key}" ${roles[role][p.key] ? 'checked' : ''} ${locked ? 'disabled title="Admins can always do this"' : ''} aria-label="${escapeHtml(p.label)}, ${role}"></td>`;
    }).join('') + '</tr>');
  }
  rows.push('</tbody>');
  $('roles-table').innerHTML = rows.join('');
}
async function loadRoles() {
  renderRoles(await api('GET', '/api/roles'));
}
$('roles-table').addEventListener('change', async (event) => {
  const box = event.target;
  if (!box.dataset.role) return;
  try {
    await api('PATCH', `/api/roles/${box.dataset.role}`, { [box.dataset.perm]: box.checked });
    say($('roles-status'), 'saved');
  } catch (err) {
    box.checked = !box.checked;
    say($('roles-status'), err.message, true);
  }
});

// --- rooms ---------------------------------------------------------------------
// A roster, same as Users: click a room to configure it on its own page
// (/rooms/<id>) instead of editing it inline in this list.

let rooms = [];
const roomRows = new Map();

function roomRowFor(room) {
  let row = roomRows.get(room.id);
  if (row) return row;
  row = $('room-card').content.firstElementChild.cloneNode(true);
  row.dataset.room = room.id;
  roomRows.set(room.id, row);
  $('rooms').appendChild(row);
  return row;
}

const PROFILE_LABELS = { roleplaying: 'Roleplaying', participants: 'Participants', characters: 'Characters' };

function fillRoomRow(row, room, index) {
  const img = row.querySelector('[data-thumb]');
  img.hidden = !room.hasImage;
  if (room.hasImage) img.src = `/img/room/${room.id}?v=${Date.now()}`;
  row.querySelector('[data-thumb-fallback]').hidden = room.hasImage;
  row.querySelector('[data-name]').textContent = room.name;
  const count = room.isLobby ? users.length : room.members.length;
  const who = room.isLobby ? 'Everyone at the table' : `${count} member${count === 1 ? '' : 's'}`;
  row.querySelector('[data-meta]').textContent = `${who} · ${PROFILE_LABELS[room.profile] || 'Roleplaying'}`;
  row.querySelector('[data-action="edit"]').href = `/rooms/${encodeURIComponent(room.id)}`;
  row.classList.toggle('lobby', room.isLobby);
  // The Lobby always sits first and isn't reorderable; among the rest, hide
  // whichever arrow would be a no-op at that end of the list.
  row.querySelector('[data-action="room-up"]').hidden = room.isLobby || index <= 1;
  row.querySelector('[data-action="room-down"]').hidden = room.isLobby || index >= rooms.length - 1;
}

function renderRooms() {
  rooms.forEach((room, index) => {
    const row = roomRowFor(room);
    fillRoomRow(row, room, index);
    $('rooms').appendChild(row); // also fixes the row's position after a reorder
  });
  for (const [id, row] of roomRows) {
    if (!rooms.some((r) => r.id === id)) {
      row.remove();
      roomRows.delete(id);
    }
  }
  $('rooms-status').textContent = `${rooms.length} room${rooms.length === 1 ? '' : 's'}`;
  renderInviteRooms();
}

async function saveRoomOrder() {
  try {
    await api('POST', '/api/rooms/order', { order: rooms.filter((r) => !r.isLobby).map((r) => r.id) });
  } catch (err) {
    say($('rooms-status'), err.message, true);
  }
}

$('rooms').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action="room-up"], [data-action="room-down"]');
  if (!button) return;
  const id = button.closest('.user-card').dataset.room;
  const index = rooms.findIndex((r) => r.id === id);
  const swapWith = button.dataset.action === 'room-up' ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= rooms.length || rooms[swapWith].isLobby) return;
  [rooms[index], rooms[swapWith]] = [rooms[swapWith], rooms[index]];
  renderRooms();
  saveRoomOrder();
});

$('add-room').addEventListener('click', async () => {
  try {
    const { room } = await api('POST', '/api/rooms', { name: `Room ${rooms.length}`, description: '', members: [] });
    location.href = `/rooms/${encodeURIComponent(room.id)}`; // set up members and an image right away
  } catch (err) {
    say($('rooms-status'), err.message, true);
  }
});

$('add-user').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('add-error').hidden = true;
  try {
    const { user } = await api('POST', '/api/users', {
      login: $('new-login').value,
      displayName: $('new-name').value,
      role: $('new-role').value,
      password: $('new-password').value,
      passwordless: $('new-link').checked,
    });
    users.push({ ...user, online: null });
    renderUsers();
    $('add-user').reset();
    $('new-link').checked = true;
    $('add-user').hidden = true;
    location.href = `/profile/${encodeURIComponent(user.key)}`; // set up their images etc. right away
  } catch (err) {
    $('add-error').textContent = err.message;
    $('add-error').hidden = false;
  }
});

async function saveSettings(patch, statusEl) {
  try {
    await api('PATCH', '/api/settings', patch);
    await loadBranding();
    say(statusEl, 'saved');
  } catch (err) {
    say(statusEl, err.message, true);
  }
}
$('save-settings').addEventListener('click', () => saveSettings({ serverName: $('set-server').value, homeIcon: selectedHomeIcon }, $('settings-status')));
$('save-features').addEventListener('click', () => saveSettings({
  maxQuality: Number($('set-max-quality').value),
  allowScreenShare: $('set-allow-screen-share').checked,
  allowAsides: $('set-allow-asides').checked,
  allowPrivate: $('set-allow-private').checked,
  allowReactions: $('set-allow-reactions').checked,
}, $('features-status')));
$('save-login').addEventListener('click', () => saveSettings({ loginText: $('set-login-text').value }, $('login-status')));

// --- theme -------------------------------------------------------------------
// A chooser (Default + every saved theme) plus the same seven color inputs,
// now used to create/edit whichever one is picked rather than a single live
// override. "Default" has no stored colors at all -- its inputs come from
// getComputedStyle, which already knows the real effective value of each
// custom property (style.css's own built-in default, nothing else in play).
const THEME_FIELDS = [
  ['theme-bg', '--bg', 'bg'],
  ['theme-bg-section', '--bg-section', 'bgSection'],
  ['theme-border', '--border', 'border'],
  ['theme-text', '--text', 'text'],
  ['theme-text-dim', '--text-dim', 'textDim'],
  ['theme-accent', '--accent', 'accent'],
  ['theme-on-accent', '--on-accent', 'onAccent'],
];
// Colors a theme may leave on Auto (the stylesheet derives them). For an Auto
// field the preview sets the same formula style.css uses, so what you see is
// right whichever theme happens to be live.
const THEME_OPTIONAL_FIELDS = [
  ['theme-card', '--bg-card', 'card', 'var(--bg-input)'],
  ['theme-header-bg', '--header-bg', 'headerBg', 'var(--bg)'],
  ['theme-header-text', '--header-text', 'headerText', 'var(--text)'],
  ['theme-icon', '--icon', 'icon', 'initial'], // initial: unset, so the fallbacks in style.css apply
  ['theme-icon-hover', '--icon-hover', 'iconHover', 'var(--accent)'],
  ['theme-primary-hover', '--primary-hover', 'primaryHover', 'var(--accent-hover)'],
  ['theme-secondary', '--secondary', 'secondary', 'var(--surface)'],
  ['theme-secondary-text', '--secondary-text', 'secondaryText', 'var(--text)'],
  ['theme-secondary-hover', '--secondary-hover', 'secondaryHover', 'var(--surface-hover)'],
];
const autoBox = (id) => document.querySelector(`[data-auto-for="${id}"]`);
const isAuto = (id) => autoBox(id).checked;
let colorProbeCtx = null;
// Any CSS color (including color-mix results) as #rrggbb for a color input.
function toHex(cssColor) {
  const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  // color-mix() results serialize as color(srgb r g b) with 0-1 channels.
  const srgb = String(cssColor).match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (srgb) return '#' + srgb.slice(1, 4).map((n) => hex2(Number(n) * 255)).join('');
  colorProbeCtx ||= document.createElement('canvas').getContext('2d');
  colorProbeCtx.fillStyle = '#000000';
  colorProbeCtx.fillStyle = cssColor;
  const v = colorProbeCtx.fillStyle;
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('') : '#000000';
}
function resolvedVar(cssVar) {
  const probe = document.createElement('span');
  probe.style.color = `var(${cssVar})`;
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return toHex(color);
}
let themes = [];
let activeThemeId = null; // what's actually live right now (persisted)
let selectedThemeId = null; // whatever the dropdown/editor is showing -- may not be applied yet

function currentThemeColor(cssVar) {
  return getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim() || '#000000';
}
function loadThemeInputsFrom(theme) {
  for (const [id, cssVar, key] of THEME_FIELDS) $(id).value = theme ? theme[key] : currentThemeColor(cssVar);
  for (const [id, , key] of THEME_OPTIONAL_FIELDS) {
    const auto = !theme || !theme[key];
    autoBox(id).checked = auto;
    $(id).disabled = auto;
    if (!auto) $(id).value = theme[key];
  }
}
// Sets these straight on :root (not just a scoped preview box) -- several
// other rules (button surfaces, hover shades) are themselves computed FROM
// these seven with color-mix(), and that only recomputes for real when the
// values it references change at the SAME element custom properties
// inherit their already-resolved value, they don't re-substitute var() per
// descendant. Root it is; this only previews locally until Apply actually
// persists it.
function updateThemePreview() {
  const root = document.documentElement;
  for (const [id, cssVar] of THEME_FIELDS) root.style.setProperty(cssVar, $(id).value);
  for (const [id, cssVar, , formula] of THEME_OPTIONAL_FIELDS) {
    root.style.setProperty(cssVar, isAuto(id) ? formula : $(id).value);
  }
  // An Auto field shows what it currently works out to.
  for (const [id, cssVar] of THEME_OPTIONAL_FIELDS) {
    if (!isAuto(id)) continue;
    // --icon has no value when Auto; show what an icon in the sample header actually draws.
    $(id).value = cssVar === '--icon'
      ? toHex(getComputedStyle(document.querySelector('.theme-preview-header .icon-link')).color)
      : resolvedVar(cssVar);
  }
}
function clearThemePreview() {
  const root = document.documentElement;
  for (const [, cssVar] of THEME_FIELDS) root.style.removeProperty(cssVar);
  for (const [, cssVar] of THEME_OPTIONAL_FIELDS) root.style.removeProperty(cssVar);
}
for (const [id] of THEME_FIELDS) $(id).addEventListener('input', updateThemePreview);
for (const [id] of THEME_OPTIONAL_FIELDS) {
  $(id).addEventListener('input', updateThemePreview);
  autoBox(id).addEventListener('change', () => {
    $(id).disabled = autoBox(id).checked;
    updateThemePreview();
  });
}
// The colors to save: the seven, and each optional one or null when on Auto.
function themeColors() {
  const colors = {};
  for (const [id, , key] of THEME_FIELDS) colors[key] = $(id).value;
  for (const [id, , key] of THEME_OPTIONAL_FIELDS) colors[key] = isAuto(id) ? null : $(id).value;
  return colors;
}
// /theme.css only changes what the *server* sends on the *next* request --
// this page's own <link> already fetched the old one. Re-pointing it at a
// cache-busted URL and waiting for it to load is what makes actually
// applying a theme visibly repaint this page too, not just the next page
// someone opens.
function reloadThemeStylesheet() {
  return new Promise((resolve) => {
    const link = $('theme-link');
    const onLoad = () => { link.removeEventListener('load', onLoad); resolve(); };
    link.addEventListener('load', onLoad);
    const url = new URL(link.href, location.origin);
    url.searchParams.set('v', Date.now());
    link.href = url.toString();
  });
}
function renderThemeChooser() {
  const select = $('theme-select');
  select.innerHTML = '<option value="">Default</option>' + themes.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  select.value = selectedThemeId || '';
  const selected = themes.find((t) => t.id === selectedThemeId);
  $('theme-update-name').textContent = selected ? selected.name : '';
  $('theme-update').hidden = !selected;
  $('theme-delete').hidden = !selected;
  $('theme-apply').disabled = selectedThemeId === activeThemeId;
}
async function loadThemes() {
  const data = await api('GET', '/api/themes');
  themes = data.themes;
  activeThemeId = data.activeThemeId;
  selectedThemeId = activeThemeId;
  renderThemeChooser();
  loadThemeInputsFrom(themes.find((t) => t.id === activeThemeId) || null);
  updateThemePreview();
}
// Browsing the dropdown only previews -- it takes an explicit Apply to
// actually persist and go live, rather than every click through the list
// changing what everyone else sees.
$('theme-select').addEventListener('change', () => {
  selectedThemeId = $('theme-select').value || null;
  renderThemeChooser();
  loadThemeInputsFrom(themes.find((t) => t.id === selectedThemeId) || null);
  updateThemePreview();
});
$('theme-apply').addEventListener('click', async () => {
  await saveSettings({ activeThemeId: selectedThemeId }, $('theme-status'));
  await reloadThemeStylesheet();
  clearThemePreview();
  activeThemeId = selectedThemeId;
  renderThemeChooser();
});
$('theme-save-new').addEventListener('click', async () => {
  const name = window.prompt('Name this theme:');
  if (!name) return;
  const colors = themeColors();
  try {
    const { theme } = await api('POST', '/api/themes', { name, ...colors });
    themes.push(theme);
    selectedThemeId = theme.id;
    renderThemeChooser();
    say($('theme-status'), 'saved -- Apply to go live');
  } catch (err) {
    say($('theme-status'), err.message, true);
  }
});
$('theme-update').addEventListener('click', async () => {
  if (!selectedThemeId) return;
  const colors = themeColors();
  try {
    const { theme } = await api('PATCH', `/api/themes/${selectedThemeId}`, colors);
    themes = themes.map((t) => (t.id === theme.id ? theme : t));
    renderThemeChooser();
    // Only reapplies for real if this is the theme actually live right now
    // -- editing a theme you're just browsing shouldn't make it live.
    if (selectedThemeId === activeThemeId) {
      await reloadThemeStylesheet();
      clearThemePreview();
    }
    say($('theme-status'), 'saved');
  } catch (err) {
    say($('theme-status'), err.message, true);
  }
});
$('theme-delete').addEventListener('click', async () => {
  const selected = themes.find((t) => t.id === selectedThemeId);
  if (!selected) return;
  if (!window.confirm(`Delete the theme "${selected.name}"? This can't be undone.`)) return;
  try {
    await api('DELETE', `/api/themes/${selected.id}`);
    themes = themes.filter((t) => t.id !== selected.id);
    // The server already fell back activeThemeId to Default if this was
    // the live one -- mirror that here rather than leaving a dangling
    // reference to a theme that no longer exists.
    const wasActive = activeThemeId === selected.id;
    if (wasActive) activeThemeId = null;
    selectedThemeId = activeThemeId;
    renderThemeChooser();
    loadThemeInputsFrom(themes.find((t) => t.id === selectedThemeId) || null);
    if (wasActive) {
      await reloadThemeStylesheet();
      clearThemePreview();
    }
    say($('theme-status'), 'deleted');
  } catch (err) {
    say($('theme-status'), err.message, true);
  }
});
$('save-registration').addEventListener('click', () => saveSettings({ allowRegistration: $('set-allow-registration').checked }, $('registration-status')));

// --- invites -----------------------------------------------------------------

function renderInviteRooms() {
  const container = $('invite-rooms');
  const keep = new Set();
  for (const room of rooms) {
    if (room.isLobby) continue; // everyone is already there; nothing to pick
    keep.add(room.id);
    let label = container.querySelector(`[data-room="${CSS.escape(room.id)}"]`);
    if (!label) {
      label = document.createElement('label');
      label.className = 'member member-toggle';
      label.dataset.room = room.id;
      const input = document.createElement('input');
      input.type = 'checkbox';
      const name = document.createElement('span');
      name.className = 'member-name';
      label.append(input, name);
      container.appendChild(label);
    }
    label.querySelector('.member-name').textContent = room.name;
  }
  for (const label of [...container.children]) if (!keep.has(label.dataset.room)) label.remove();
}

$('invite-rooms').addEventListener('change', (event) => {
  event.target.closest('.member-toggle')?.classList.toggle('online', event.target.checked);
});

$('make-invite').addEventListener('click', async () => {
  try {
    const roomIds = [...$('invite-rooms').querySelectorAll('input:checked')].map((i) => i.closest('[data-room]').dataset.room);
    const { invite } = await api('POST', '/api/invites', { rooms: roomIds });
    $('invite-link').textContent = invite.url;
    $('invite-link-row').hidden = false;
    say($('invite-status'), 'link made');
  } catch (err) {
    say($('invite-status'), err.message, true);
  }
});
$('invite-copy').addEventListener('click', () => copy($('invite-link').textContent, $('invite-status')));

// Sliders, not spinner number inputs, for anything with a small bounded
// range -- sets the range input's own value and the live-value label next
// to it (e.g. "35%") together, and wires the label to keep tracking the
// slider as it's dragged, before Save is even clicked.
function setSlider(id, value, suffix = '') {
  $(id).value = value;
  const label = $(`${id}-value`);
  if (label) label.textContent = `${value}${suffix}`;
}
for (const [id, suffix] of [
  ['set-border-width', 'px'],
  ['set-char-border-width', 'px'],
  ['set-plate-font-size', 'px'],
  ['set-plate-opacity', '%'],
  ['set-picture-scale', '%'],
  ['set-offline-dim', '%'],
  ['set-offline-tint-opacity', '%'],
  ['set-aside-dim', '%'],
  ['set-aside-tint-opacity', '%'],
  ['set-private-dim', '%'],
  ['set-private-tint-opacity', '%'],
]) {
  $(id).addEventListener('input', () => setSlider(id, $(id).value, suffix));
}

$('save-defaults').addEventListener('click', async () => {
  try {
    const { settings } = await api('PATCH', '/api/settings', {
      border: $('set-border').checked,
      borderColor: $('set-border-color').value,
      borderWidth: $('set-border-width').value,
      mutedBorder: $('set-muted-border').checked,
      mutedColor: $('set-muted-color').value,
      charBorder: $('set-char-border').checked,
      charBorderColor: $('set-char-border-color').value,
      charMutedBorder: $('set-char-muted-border').checked,
      charMutedColor: $('set-char-muted-color').value,
      charBorderWidth: $('set-char-border-width').value,
      plate: $('set-plate').checked,
      plateLayout: $('set-plate-layout').value,
      plateColor: $('set-plate-color').value,
      plateTextColor: $('set-plate-text-color').value,
      plateFontSize: $('set-plate-font-size').value,
      plateOpacity: $('set-plate-opacity').value,
      plateTextCase: $('set-plate-text-case').value,
      pictureBackground: $('set-picture-bg').checked,
      pictureColor: $('set-picture-color').value,
      pictureScale: $('set-picture-scale').value,
      offlineDim: $('set-offline-dim').value,
      offlineTint: $('set-offline-tint').value,
      offlineTintOpacity: $('set-offline-tint-opacity').value,
      asideDim: $('set-aside-dim').value,
      asideTint: $('set-aside-tint').value,
      asideTintOpacity: $('set-aside-tint-opacity').value,
      privateDim: $('set-private-dim').value,
      privateTint: $('set-private-tint').value,
      privateTintOpacity: $('set-private-tint-opacity').value,
    });
    say($('defaults-status'), 'saved');
    await loadUsers();
  } catch (err) {
    say($('defaults-status'), err.message, true);
  }
});

// --- reactions --------------------------------------------------------------

function reactionRow(reaction) {
  const row = $('reaction-row').content.firstElementChild.cloneNode(true);
  row.dataset.id = reaction?.id || '';
  row.querySelector('.reaction-glyph').value = reaction?.glyph || '';
  row.querySelector('.reaction-label').value = reaction?.label || '';
  return row;
}

function renderReactionRows(reactions) {
  const list = $('reactions-list');
  list.textContent = '';
  for (const r of reactions || []) list.appendChild(reactionRow(r));
}

function slugify(text) {
  return String(text || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
}

$('reactions-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const row = button.closest('.reaction-row');
  if (button.dataset.action === 'reaction-remove') row.remove();
  else if (button.dataset.action === 'reaction-up' && row.previousElementSibling) row.parentElement.insertBefore(row, row.previousElementSibling);
  else if (button.dataset.action === 'reaction-down' && row.nextElementSibling) row.parentElement.insertBefore(row.nextElementSibling, row);
});
$('reaction-add').addEventListener('click', () => $('reactions-list').appendChild(reactionRow()));

$('save-reactions').addEventListener('click', async () => {
  const seen = new Set();
  const reactions = [...$('reactions-list').querySelectorAll('.reaction-row')]
    .map((row) => {
      const glyph = row.querySelector('.reaction-glyph').value.trim();
      const label = row.querySelector('.reaction-label').value.trim();
      let id = row.dataset.id || slugify(label) || slugify(glyph);
      if (!id || seen.has(id)) id = `r${Math.random().toString(36).slice(2, 8)}`;
      seen.add(id);
      return { id, glyph, label };
    })
    .filter((r) => r.glyph);
  try {
    const { settings } = await api('PATCH', '/api/settings', { reactions });
    renderReactionRows(settings.reactions);
    say($('reactions-status'), 'saved');
  } catch (err) {
    say($('reactions-status'), err.message, true);
  }
});

// --- modules ----------------------------------------------------------------
// Upload a zip, review what it asks for, enable it. See docs/MODULES.md.
let installedModules = [];
let builtinModules = [];
let bundledModules = []; // the modules that ship with this Tavern, and whether each is installed or has an update

async function loadModules() {
  const data = await api('GET', '/api/modules');
  installedModules = data.modules;
  builtinModules = data.builtin || [];
  bundledModules = data.bundled || [];
  renderModules();
  // Say on the tab itself when an update is waiting, so it is seen without opening it.
  const updates = bundledModules.filter((b) => b.update).length;
  setUpdateBadge(updates);
  const tab = document.querySelector('[data-tab="modules"]');
  if (tab) tab.textContent = updates ? `Modules (${updates} update${updates === 1 ? '' : 's'})` : 'Modules';
}

function moduleCard(m) {
  const scopes = m.scope.map((s) => (s === 'server' ? 'Server page' : 'Room panel')).join(' + ');
  const asks = [
    ...m.permissions.map((p) => `<li><strong>${escapeHtml(p.label)}</strong> <span class="hint">permission, appears in Roles</span></li>`),
    ...(m.hooks.schedule ? ['<li><strong>Run things on a schedule</strong> <span class="hint">reminders and timed events</span></li>'] : []),
    ...(m.hooks.notify ? ['<li><strong>Send notifications</strong> <span class="hint">to people at the table</span></li>'] : []),
    ...(m.events && m.events.subscribes.length ? [`<li><strong>Hear what happens in other modules</strong> <span class="hint">${escapeHtml(m.events.subscribes.map((c) => c === '*' ? 'any module' : c.replace(':', ' ')).join(', '))}: their events, only for people who can see them</span></li>`] : []),
    ...(m.actions && m.actions.uses.length ? [`<li><strong>Ask other modules to do things</strong> <span class="hint">${escapeHtml(m.actions.uses.map((c) => c === '*' ? 'any module' : c.replace(':', ' ')).join(', '))}: each request is carried out by the module that owns the action</span></li>`] : []),
    ...(m.refs && m.refs.consumes.length ? [`<li><strong>Link to other modules' items</strong> <span class="hint">${escapeHtml(m.refs.consumes.map((c) => c.replace(':', ' ')).join(', '))}, shown only to people who can already see them</span></li>`] : []),
  ];
  const modeTag = m.runMode === 'page' ? '<span class="pill warn">In the page</span>' : '<span class="pill">Sandboxed</span>';
  const state = modeTag + ' ' + (m.enabled ? '<span class="pill on">Enabled</span>' : m.needsApproval ? '<span class="pill warn">Needs approval</span>' : '<span class="pill">Disabled</span>');
  const several = m.versions.length > 1; // the picker lists every kept version, the running one selected
  const el = document.createElement('article');
  el.className = 'panel module-card';
  el.dataset.id = m.id;
  el.innerHTML = `
    <div class="module-head">
      <i class="fa-solid fa-${escapeHtml(m.icon)} fa-fw module-icon" aria-hidden="true"></i>
      <div class="grow"><h2>${escapeHtml(m.name)} <span class="hint">v${escapeHtml(m.version)}${m.author ? ' by ' + escapeHtml(m.author) : ''}</span></h2>
        <div class="hint">${escapeHtml(scopes)}</div></div>
      ${state}
    </div>
    ${m.description ? `<p>${escapeHtml(m.description)}</p>` : ''}
    <p class="hint">${asks.length ? (m.needsApproval ? 'Asks for these -- enabling approves them:' : 'Approved to:') : 'Asks for nothing beyond showing itself.'}</p>
    ${asks.length ? `<ul class="module-asks">${asks.join('')}</ul>` : ''}
    <div class="module-runmode">
      <p class="hint"><strong>${m.runMode === 'page' ? 'Runs in the page' : 'Runs sandboxed'}</strong>${m.source === 'bundled' ? ', ships with this Tavern' : ', uploaded'}. ${m.runMode === 'page' ? 'It can read and change anything on the page, including what you can see and do. Only allow that for a module you trust.' : 'It is walled off in its own frame and can only reach Tavern through its approved permissions. A module in a frame cannot take part in drag and drop between modules.'}</p>
      ${m.source === 'bundled' ? '' : `<button class="btn" data-module-runmode="${m.runMode === 'page' ? 'sandbox' : 'page'}" type="button">${m.runMode === 'page' ? 'Switch back to sandboxed' : 'Run in the page...'}</button>`}
    </div>
    ${m.scope.includes('room') ? `<label class="check"><input type="checkbox" data-module-all-rooms ${m.allRooms ? 'checked' : ''}> Available in every room</label>` : ''}
    <div class="row">
      <button class="btn ${m.enabled ? '' : 'btn-primary'}" data-module-action="toggle" type="button">${m.enabled ? 'Disable' : m.needsApproval ? 'Approve and enable' : 'Enable'}</button>
      ${several ? `<select data-module-version aria-label="Version">${m.versions.map((v) => `<option value="${escapeHtml(v)}"${v === m.version ? ' selected' : ''}>${escapeHtml(v)}${v === m.version ? ' (current)' : ''}</option>`).join('')}</select><button class="btn" data-module-action="rollback" type="button" disabled>Switch to this version</button>` : ''}
      <button class="btn btn-danger" data-module-action="uninstall" type="button">Uninstall</button>
    </div>`;
  // A newer version ships with this Tavern: offer it, no zip to upload.
  const newer = bundledModules.find((b) => b.id === m.id && b.update);
  if (newer) {
    const note = document.createElement('div');
    note.className = 'module-update';
    note.innerHTML = `<span class="pill warn">Update available</span> <strong>Version ${escapeHtml(newer.version)}</strong> comes with this Tavern. <button class="btn btn-primary btn-small" data-bundled-action="install" data-bundled-id="${escapeHtml(newer.id)}" type="button">Update to ${escapeHtml(newer.version)}</button> <span class="hint">Your data stays as it is, and you can switch back below. If it asks for anything new you approve it first.</span>`;
    el.querySelector('.module-head').after(note);
  }
  return el;
}

function renderModules() {
  const list = $('modules-list');
  list.textContent = '';
  // The built-in panes first: always on, and not removable.
  for (const b of builtinModules) {
    const el = document.createElement('article');
    el.className = 'panel module-card';
    el.innerHTML = `
      <div class="module-head">
        <i class="fa-solid fa-${escapeHtml(b.icon)} fa-fw module-icon" aria-hidden="true"></i>
        <div class="grow"><h2>${escapeHtml(b.name)} <span class="hint">built in</span></h2>
          <div class="hint">Room pane</div></div>
        <span class="pill on">Always on</span>
      </div>
      <p>${escapeHtml(b.description)}</p>
      <p class="hint">It comes with Tavern and can't be removed. Its permissions are on the Roles tab: ${escapeHtml(b.permissions)}.</p>`;
    list.appendChild(el);
  }
  if (!installedModules.length) {
    const none = document.createElement('div');
    none.className = 'panel';
    none.innerHTML = '<p class="hint">No other modules installed yet.</p>';
    list.appendChild(none);
  }
  for (const m of installedModules) list.appendChild(moduleCard(m));
  const log = document.createElement('div');
  log.className = 'panel';
  log.innerHTML = '<h2>Recent activity</h2><p class="hint">What modules have done lately.</p><ul class="module-activity" id="module-activity"><li class="hint">Loading...</li></ul>';
  list.appendChild(log);
  api('GET', '/api/modules/activity').then((d) => {
    const items = (d.activity || []).slice(0, 30);
    $('module-activity').innerHTML = items.length ? items.map((a) => `<li><span class="hint">${escapeHtml(new Date(a.at).toLocaleTimeString())}</span> <strong>${escapeHtml(a.moduleName)}</strong> ${escapeHtml(a.what)}${a.byName ? ` <span class="hint">by ${escapeHtml(a.byName)}</span>` : ''}</li>` ).join('') : '<li class="hint">Nothing yet.</li>';
  }).catch(() => { const e = $('module-activity'); if (e) e.innerHTML = '<li class="hint">Unavailable.</li>'; });
  // Modules that ship with this Tavern and are not installed yet.
  const available = bundledModules.filter((b) => !b.installed);
  if (available.length) {
    const box = document.createElement('div');
    box.className = 'panel';
    box.innerHTML = `<h2>Available with this Tavern</h2><p class="hint">These come with the server, so there is nothing to upload.</p>${available.map((b) => `
      <div class="row module-available">
        <i class="fa-solid fa-${escapeHtml(b.icon || 'puzzle-piece')} fa-fw module-icon" aria-hidden="true"></i>
        <div class="grow"><strong>${escapeHtml(b.name)}</strong> <span class="hint">v${escapeHtml(b.version)}</span><div class="hint">${escapeHtml(b.description || '')}</div></div>
        <button class="btn btn-primary" data-bundled-action="install" data-bundled-id="${escapeHtml(b.id)}" type="button">Install</button>
      </div>`).join('')}`;
    list.appendChild(box);
  }
}

// Install or update a module that ships with this Tavern, by building it here.
$('modules-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-bundled-action]');
  if (!button) return;
  button.disabled = true;
  say($('modules-status'), 'installing...');
  try {
    const { module } = await api('POST', `/api/modules/bundled/${encodeURIComponent(button.dataset.bundledId)}/install`);
    await loadModules();
    await loadRoles();
    say($('modules-status'), `${module.name} ${module.version} installed${module.enabled ? '' : ' -- review it below, then enable'}`);
  } catch (err) {
    say($('modules-status'), err.message, true);
    button.disabled = false;
  }
});

$('module-install').addEventListener('click', async () => {
  const file = $('module-file').files[0];
  if (!file) return say($('modules-status'), 'choose a zip file first', true);
  say($('modules-status'), 'installing...');
  try {
    const { module } = await api('POST', '/api/modules', file, 'application/zip');
    $('module-file').value = '';
    await loadModules();
    await loadRoles(); // a module's permissions join the Roles grid when it is on
    say($('modules-status'), `${module.name} ${module.version} installed${module.enabled ? '' : ' -- review it below, then enable'}`);
  } catch (err) {
    say($('modules-status'), err.message, true);
  }
});

$('modules-list').addEventListener('click', async (event) => {
  const mode = event.target.closest('[data-module-runmode]');
  if (!mode) return;
  const m = installedModules.find((x) => x.id === mode.closest('.module-card').dataset.id);
  const to = mode.dataset.moduleRunmode;
  try {
    if (to === 'page' && !window.confirm(`Run ${m.name} in the page?\n\nA module in the page is not walled off. It can read and change everything on the page, act as you, and reach anything you can. Tavern cannot hold it to its approved permissions.\n\nOnly continue if you trust whoever wrote it.`)) return;
    await api('PATCH', `/api/modules/${m.id}`, { runMode: to, acceptRisk: to === 'page' });
    await loadModules();
    say($('modules-status'), `${m.name} now runs ${to === 'page' ? 'in the page' : 'sandboxed'}`);
  } catch (err) {
    say($('modules-status'), err.message, true);
  }
});

$('modules-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-module-action]');
  if (!button) return;
  const card = button.closest('.module-card');
  const m = installedModules.find((x) => x.id === card.dataset.id);
  try {
    if (button.dataset.moduleAction === 'toggle') {
      await api('PATCH', `/api/modules/${m.id}`, { enabled: !m.enabled });
    } else if (button.dataset.moduleAction === 'rollback') {
      const version = card.querySelector('[data-module-version]').value;
      if (version === m.version) return;
      if (!window.confirm(`Switch ${m.name} to version ${version}? Its data stays as it is.`)) return;
      await api('POST', `/api/modules/${m.id}/rollback`, { version });
    } else if (button.dataset.moduleAction === 'uninstall') {
      if (!window.confirm(`Uninstall ${m.name}?`)) return;
      const wipe = window.confirm(`Also delete ${m.name}'s saved data?\n\nOK deletes it for good. Cancel keeps it, so a later reinstall picks up where it left off.`);
      await api('DELETE', `/api/modules/${m.id}?keepData=${wipe ? 0 : 1}`);
    }
    await loadModules();
    await loadRoles(); // a module's permissions join the Roles grid when it is on
    say($('modules-status'), '');
  } catch (err) {
    say($('modules-status'), err.message, true);
  }
});

$('modules-list').addEventListener('change', async (event) => {
  if (event.target.matches('[data-module-version]')) {
    // Switching is only offered for a version that is not the running one.
    const card = event.target.closest('.module-card');
    const m = installedModules.find((x) => x.id === card.dataset.id);
    card.querySelector('[data-module-action="rollback"]').disabled = event.target.value === m.version;
    return;
  }
  if (!event.target.matches('[data-module-all-rooms]')) return;
  const id = event.target.closest('.module-card').dataset.id;
  try {
    await api('PATCH', `/api/modules/${id}`, { allRooms: event.target.checked });
    await loadModules();
    await loadRoles(); // a module's permissions join the Roles grid when it is on
  } catch (err) {
    say($('modules-status'), err.message, true);
  }
});

// --- Font Awesome icons -----------------------------------------------------
// Paste the HTML Font Awesome gives you; we keep just its classes.
function parseIconClasses(text) {
  const raw = String(text || '');
  const m = raw.match(/class\s*=\s*["']([^"']+)["']/i);
  const tokens = (m ? m[1] : raw).split(/\s+/).filter((t) => /^fa-[a-z0-9-]+$/.test(t));
  const hasStyle = tokens.some((t) => /^fa-(solid|regular|brands|light|thin|duotone|sharp)$/.test(t));
  return tokens.length > (hasStyle ? 1 : 0) ? tokens.join(' ') : '';
}

function iconRow(icon) {
  const row = $('icon-row').content.firstElementChild.cloneNode(true);
  const html = row.querySelector('.icon-html');
  const preview = row.querySelector('.icon-preview');
  row.dataset.id = icon?.id || '';
  row.querySelector('.icon-label').value = icon?.label || '';
  if (icon?.classes) html.value = `<i class="${icon.classes}"></i>`;
  const show = () => {
    const classes = parseIconClasses(html.value);
    preview.textContent = '';
    if (classes) {
      const i = document.createElement('i');
      i.className = classes + ' fa-fw';
      preview.appendChild(i);
    }
    html.classList.toggle('invalid', Boolean(html.value.trim()) && !classes);
  };
  html.addEventListener('input', show);
  show();
  return row;
}

function renderIconRows(icons) {
  const list = $('icons-list');
  list.textContent = '';
  for (const icon of icons || []) list.appendChild(iconRow(icon));
}

$('icons-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const row = button.closest('.icon-row');
  if (button.dataset.action === 'icon-remove') row.remove();
  else if (button.dataset.action === 'icon-up' && row.previousElementSibling) row.parentElement.insertBefore(row, row.previousElementSibling);
  else if (button.dataset.action === 'icon-down' && row.nextElementSibling) row.parentElement.insertBefore(row.nextElementSibling, row);
});
$('icon-add').addEventListener('click', () => $('icons-list').appendChild(iconRow()));

$('save-icons').addEventListener('click', async () => {
  const icons = [...$('icons-list').querySelectorAll('.icon-row')]
    .map((row) => ({ id: row.dataset.id, classes: parseIconClasses(row.querySelector('.icon-html').value), label: row.querySelector('.icon-label').value.trim() }))
    .filter((i) => i.classes);
  try {
    const { settings } = await api('PATCH', '/api/settings', { icons });
    renderIconRows(settings.icons);
    await loadBranding();
    buildHomeIconGrid();
    renderHomeIconSelection();
    say($('icons-status'), 'saved');
  } catch (err) {
    say($('icons-status'), err.message, true);
  }
});

// Site images (icon, sign-in background): click the picture to change it,
// Remove to clear it. The icon falls back to the built-in one when unset.
function renderSiteImages(b) {
  for (const slot of document.querySelectorAll('#tab-server [data-site]')) {
    const name = slot.dataset.site;
    const has = name === 'icon' ? b.hasIcon : b.hasBackground;
    const img = slot.querySelector('img');
    const showImage = has || name === 'icon';
    img.hidden = !showImage;
    if (showImage) img.src = `/img/site/${name}?v=${Date.now()}`;
    else img.removeAttribute('src');
    slot.querySelector('.unset').hidden = showImage;
    slot.classList.toggle('set', has);
    slot.querySelector('[data-action="site-clear"]').hidden = !has;
  }
}

$('tab-server').addEventListener('change', async (event) => {
  const input = event.target;
  if (input.type !== 'file' || !input.closest('[data-site]')) return;
  const name = input.closest('[data-site]').dataset.site;
  const file = input.files[0];
  if (!file) return;
  try {
    await api('PUT', `/api/settings/${name}`, file, file.type);
    renderSiteImages(await loadBranding());
    say($('settings-status'), `${name} saved`);
  } catch (err) {
    say($('settings-status'), err.message, true);
  }
  input.value = '';
});

$('tab-server').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action="site-clear"]');
  if (!button) return;
  const name = button.closest('[data-site]').dataset.site;
  try {
    await api('DELETE', `/api/settings/${name}`);
    renderSiteImages(await loadBranding());
    say($('settings-status'), `${name} removed`);
  } catch (err) {
    say($('settings-status'), err.message, true);
  }
});

// The shared guest Participant picture set, same click-to-change/Clear
// shape as every other image slot in the app.
function renderGuestImages(b) {
  for (const slot of document.querySelectorAll('#guest-images [data-guest-slot]')) {
    const name = slot.dataset.guestSlot;
    const has = !!b.guestImages?.[name];
    const img = slot.querySelector('img');
    img.hidden = !has;
    if (has) img.src = `/img/guest/${name}?v=${Date.now()}`;
    else img.removeAttribute('src');
    slot.querySelector('.unset').hidden = has;
    slot.classList.toggle('set', has);
    slot.querySelector('[data-action="guest-image-clear"]').hidden = !has;
  }
}

$('guest-images').addEventListener('change', async (event) => {
  const input = event.target;
  if (input.type !== 'file' || !input.closest('[data-guest-slot]')) return;
  const slot = input.closest('[data-guest-slot]').dataset.guestSlot;
  const file = input.files[0];
  if (!file) return;
  try {
    await api('PUT', `/api/settings/guest-images/${slot}`, file, file.type);
    renderGuestImages(await loadBranding());
  } catch (err) {
    say($('defaults-status'), err.message, true);
  }
  input.value = '';
});
$('guest-images').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action="guest-image-clear"]');
  if (!button) return;
  const slot = button.closest('[data-guest-slot]').dataset.guestSlot;
  try {
    await api('DELETE', `/api/settings/guest-images/${slot}`);
    renderGuestImages(await loadBranding());
  } catch (err) {
    say($('defaults-status'), err.message, true);
  }
});

// The server-wide Default Images set -- what a member's own Participant
// box falls back to once neither they nor their room has set a picture.
// Same click-to-change/Clear shape as every other image slot in the app.
function renderDefaultImages(b) {
  for (const slot of document.querySelectorAll('#default-images [data-default-slot]')) {
    const name = slot.dataset.defaultSlot;
    const has = !!b.defaultImages?.[name];
    const img = slot.querySelector('img');
    img.hidden = !has;
    if (has) img.src = `/img/default/${name}?v=${Date.now()}`;
    else img.removeAttribute('src');
    slot.querySelector('.unset').hidden = has;
    slot.classList.toggle('set', has);
    slot.querySelector('[data-action="default-image-clear"]').hidden = !has;
  }
}

$('default-images').addEventListener('change', async (event) => {
  const input = event.target;
  if (input.type !== 'file' || !input.closest('[data-default-slot]')) return;
  const slot = input.closest('[data-default-slot]').dataset.defaultSlot;
  const file = input.files[0];
  if (!file) return;
  try {
    await api('PUT', `/api/settings/default-images/${slot}`, file, file.type);
    renderDefaultImages(await loadBranding());
  } catch (err) {
    say($('defaults-status'), err.message, true);
  }
  input.value = '';
});
$('default-images').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action="default-image-clear"]');
  if (!button) return;
  const slot = button.closest('[data-default-slot]').dataset.defaultSlot;
  try {
    await api('DELETE', `/api/settings/default-images/${slot}`);
    renderDefaultImages(await loadBranding());
  } catch (err) {
    say($('defaults-status'), err.message, true);
  }
});

function showStreamKey() {
  $('stream-key').textContent = streamShown ? streamKey : '••••••••';
  $('stream-show').textContent = streamShown ? 'Hide' : 'Show';
}
$('stream-show').addEventListener('click', () => {
  streamShown = !streamShown;
  showStreamKey();
});
$('stream-copy').addEventListener('click', () => copy(streamKey, $('settings-status')));
$('stream-regen').addEventListener('click', async () => {
  if (!window.confirm('Regenerate the stream key? Every OBS view link and the Studio app need the new one.')) return;
  try {
    ({ streamKey } = await api('POST', '/api/stream-key/regenerate'));
    showStreamKey();
    for (const user of users) fill(cardFor(user), user);
    say($('settings-status'), 'new stream key');
  } catch (err) {
    say($('settings-status'), err.message, true);
  }
});

async function init() {
  renderTopbar({ location: crumbLink('gear', 'Server Settings', '/admin') });
  buildHomeIconGrid();
  await loadBranding();
  wireOverlayBack('Rooms');
  try {
    const info = await api('GET', '/api/me');
    me = info.user;
    if (me.role !== 'admin') {
      location.href = '/';
      return;
    }
    $('whoami').textContent = me.displayName;
    $('whoami-img').src = imgUrl(me.key, 'profile');
    $('whoami-img').hidden = false;
    $('admin-link').hidden = false;
    streamKey = info.streamKey;
    const { settings } = await api('GET', '/api/settings');
    $('set-server').value = settings.serverName;
    selectedHomeIcon = settings.homeIcon || 'couch';
    renderHomeIconSelection();
    await loadThemes();
    await loadRoles();
    await loadModules();
    $('set-max-quality').value = String(settings.maxQuality || 720);
    $('set-allow-screen-share').checked = settings.allowScreenShare !== false;
    $('set-allow-asides').checked = settings.allowAsides !== false;
    $('set-allow-private').checked = settings.allowPrivate !== false;
    $('set-allow-reactions').checked = settings.allowReactions !== false;
    $('set-login-text').value = settings.loginText;
    $('set-allow-registration').checked = Boolean(settings.allowRegistration);
    $('set-border').checked = settings.border;
    $('set-border-color').value = settings.borderColor;
    setSlider('set-border-width', settings.borderWidth || 6, 'px');
    $('set-muted-border').checked = settings.mutedBorder !== false;
    $('set-muted-color').value = settings.mutedColor || '#b8503f';
    $('set-plate').checked = Boolean(settings.plate);
    $('set-plate-layout').value = settings.plateLayout || 'lower-left';
    $('set-plate-color').value = settings.plateColor || '#000000';
    $('set-plate-text-color').value = settings.plateTextColor || '#f1e6d8';
    setSlider('set-plate-font-size', settings.plateFontSize || 16, 'px');
    setSlider('set-plate-opacity', settings.plateOpacity ?? 60, '%');
    $('set-plate-text-case').value = settings.plateTextCase || 'default';
    $('set-char-border').checked = Boolean(settings.charBorder);
    $('set-char-border-color').value = settings.charBorderColor || '#6fae6b';
    $('set-char-muted-border').checked = Boolean(settings.charMutedBorder);
    $('set-char-muted-color').value = settings.charMutedColor || '#b8503f';
    setSlider('set-char-border-width', settings.charBorderWidth || 6, 'px');
    $('set-picture-bg').checked = Boolean(settings.pictureBackground);
    $('set-picture-color').value = settings.pictureColor || '#1a1410';
    setSlider('set-picture-scale', settings.pictureScale || 100, '%');
    setSlider('set-offline-dim', settings.offlineDim ?? 0, '%');
    $('set-offline-tint').value = settings.offlineTint || '#000000';
    setSlider('set-offline-tint-opacity', settings.offlineTintOpacity ?? 0, '%');
    setSlider('set-aside-dim', settings.asideDim ?? 0, '%');
    $('set-aside-tint').value = settings.asideTint || '#000000';
    setSlider('set-aside-tint-opacity', settings.asideTintOpacity ?? 0, '%');
    setSlider('set-private-dim', settings.privateDim ?? 0, '%');
    $('set-private-tint').value = settings.privateTint || '#000000';
    setSlider('set-private-tint-opacity', settings.privateTintOpacity ?? 0, '%');
    renderReactionRows(settings.reactions);
    renderIconRows(settings.icons);
    renderSiteImages(settings);
    renderGuestImages(settings);
    renderDefaultImages(settings);
    showStreamKey();
    await loadUsers();
    setInterval(refreshLive, 5000);
  } catch (err) {
    location.href = '/login?next=/admin';
  }
}
init();
