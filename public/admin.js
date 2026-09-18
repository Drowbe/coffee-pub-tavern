import { loadBranding, api, wireOverlayBack, renderTopbar, escapeHtml, crumbLink } from '/brand.js';

const $ = (id) => document.getElementById(id);
const cards = new Map(); // key -> card element
let me = null;
let streamKey = '';
let streamShown = false;
let users = [];

// Kept in sync with ROOM_LINK_ICONS in server/store.js -- Font Awesome
// solid is the only style loaded, so the choice is a fixed set, not free text.
const HOME_ICONS = [
  'link', 'globe', 'gamepad', 'dice-d20', 'dice-d6', 'scroll', 'book',
  'book-open', 'map', 'compass', 'music', 'headphones', 'video', 'tv',
  'comments', 'wand-magic-sparkles', 'chess', 'users', 'house', 'star', 'couch',
];
let selectedHomeIcon = 'couch';

function buildHomeIconGrid() {
  const grid = $('set-home-icon');
  for (const icon of HOME_ICONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.icon = icon;
    btn.title = icon;
    btn.innerHTML = `<i class="fa-solid fa-${icon} fa-fw" aria-hidden="true"></i>`;
    btn.addEventListener('click', () => {
      selectedHomeIcon = icon;
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

// Users / Rooms / Roles / Settings / About tabs, remembered in the address
const TABS = ['users', 'rooms', 'roles', 'settings', 'about'];
function selectTab(name) {
  const tab = TABS.includes(name) ? name : 'users';
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
  ['theme-bg-card', '--bg-card', 'bgCard'],
  ['theme-border', '--border', 'border'],
  ['theme-text', '--text', 'text'],
  ['theme-text-dim', '--text-dim', 'textDim'],
  ['theme-accent', '--accent', 'accent'],
  ['theme-on-accent', '--on-accent', 'onAccent'],
];
let themes = [];
let activeThemeId = null; // what's actually live right now (persisted)
let selectedThemeId = null; // whatever the dropdown/editor is showing -- may not be applied yet

function currentThemeColor(cssVar) {
  return getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim() || '#000000';
}
function loadThemeInputsFrom(theme) {
  for (const [id, cssVar, key] of THEME_FIELDS) $(id).value = theme ? theme[key] : currentThemeColor(cssVar);
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
}
function clearThemePreview() {
  const root = document.documentElement;
  for (const [, cssVar] of THEME_FIELDS) root.style.removeProperty(cssVar);
}
for (const [id] of THEME_FIELDS) $(id).addEventListener('input', updateThemePreview);
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
  const colors = {};
  for (const [id, , key] of THEME_FIELDS) colors[key] = $(id).value;
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
  const colors = {};
  for (const [id, , key] of THEME_FIELDS) colors[key] = $(id).value;
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

// Site images (icon, sign-in background): click the picture to change it,
// Remove to clear it. The icon falls back to the built-in one when unset.
function renderSiteImages(b) {
  for (const slot of document.querySelectorAll('#tab-settings [data-site]')) {
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

$('tab-settings').addEventListener('change', async (event) => {
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

$('tab-settings').addEventListener('click', async (event) => {
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
