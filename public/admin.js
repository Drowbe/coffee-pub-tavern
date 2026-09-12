import { loadBranding, api } from '/brand.js';

const $ = (id) => document.getElementById(id);
const cards = new Map(); // key -> card element
let me = null;
let streamKey = '';
let streamShown = false;
let users = [];

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

function viewLink(user, card) {
  const kind = card.querySelector('[data-view-kind]').value;
  const q = new URLSearchParams({ s: streamKey, kind });
  return `${user.viewUrl}?${q}`;
}

let defaults = { border: true, borderColor: '#6fae6b' };

// Users / Rooms / Settings tabs, remembered in the address
function selectTab(name) {
  const tab = name === 'settings' || name === 'rooms' ? name : 'users';
  $('tab-users').hidden = tab !== 'users';
  $('tab-rooms').hidden = tab !== 'rooms';
  $('tab-settings').hidden = tab !== 'settings';
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

function fill(card, user) {
  card.dataset.key = user.key;
  card.querySelector('[data-name]').textContent = user.displayName;
  card.querySelector('[data-login]').textContent = user.login;
  card.querySelector('[data-role]').textContent = user.role;
  card.querySelector('[data-key]').textContent = user.key;
  card.querySelector('[data-thumb]').src = imgUrl(user.key, 'profile');
  if (document.activeElement?.closest?.('.user-card') !== card) {
    card.querySelector('[data-field="displayName"]').value = user.displayName;
    card.querySelector('[data-field="login"]').value = user.login;
    card.querySelector('[data-field="role"]').value = user.role;
  }
  card.querySelector('[data-action="clear-password"]').hidden = !user.hasPassword;
  const link = card.querySelector('[data-link]');
  link.textContent = user.link || 'off';
  link.classList.toggle('dim', !user.link);
  card.querySelector('[data-action="link-copy"]').hidden = !user.link;
  card.querySelector('[data-action="link-off"]').hidden = !user.link;
  card.querySelector('[data-action="link-new"]').textContent = user.link ? 'Regenerate' : 'Create';
  for (const slot of card.querySelectorAll('.slot')) {
    const name = slot.dataset.slot;
    const has = !!user.images[name];
    const img = slot.querySelector('img');
    img.hidden = !has;
    if (has) img.src = imgUrl(user.key, name);
    slot.querySelector('.unset').hidden = has;
    slot.classList.toggle('set', has);
    slot.querySelector('[data-action="slot-clear"]').hidden = !has;
  }
  // The last admin cannot be demoted; say so before the click.
  const admins = users.filter((u) => u.role === 'admin').length;
  const lastAdmin = user.role === 'admin' && admins <= 1;
  const self = me && user.key === me.key;
  const userOption = card.querySelector('[data-field="role"] option[value="user"]');
  userOption.disabled = lastAdmin || self;
  card.querySelector('[data-role-note]').hidden = !lastAdmin;
  if (self && !lastAdmin) card.querySelector('[data-role-note]').textContent = 'Another admin has to change your role.';
  card.querySelector('[data-role-note]').hidden = !(lastAdmin || self);
  card.querySelector('[data-view-open]').href = viewLink(user, card);
  card.querySelector('[data-action="delete"]').hidden = self || lastAdmin;
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
  const status = card.querySelector('[data-status]');
  const run = async (fn) => {
    try {
      await fn();
    } catch (err) {
      say(status, err.message, true);
    }
  };
  card.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || !card.contains(button)) return;
    const user = userOf(card);
    const action = button.dataset.action;
    if (action === 'toggle') {
      const body = card.querySelector('.user-body');
      body.hidden = !body.hidden;
      button.textContent = body.hidden ? 'Edit' : 'Close';
    } else if (action === 'save') {
      run(async () => {
        const patch = {
          displayName: card.querySelector('[data-field="displayName"]').value,
          login: card.querySelector('[data-field="login"]').value,
          role: card.querySelector('[data-field="role"]').value,
        };
        const password = card.querySelector('[data-field="password"]').value;
        if (password) patch.password = password;
        const { user: updated } = await api('PATCH', `/api/users/${user.key}`, patch);
        card.querySelector('[data-field="password"]').value = '';
        replace(updated);
        say(status, 'saved');
      });
    } else if (action === 'clear-password') {
      run(async () => {
        if (!user.link && !window.confirm(`${user.displayName} has no personal link. Without a password they cannot sign in. Remove it anyway?`)) return;
        const { user: updated } = await api('PATCH', `/api/users/${user.key}`, { password: '' });
        replace(updated);
        say(status, 'password removed');
      });
    } else if (action === 'link-copy') {
      copy(user.link, status);
    } else if (action === 'link-new') {
      run(async () => {
        if (user.link && !window.confirm('Regenerate the link? The old one stops working.')) return;
        const { user: updated } = await api('POST', `/api/users/${user.key}/link`);
        replace(updated);
        say(status, user.link ? 'new link made' : 'link created');
      });
    } else if (action === 'link-off') {
      run(async () => {
        const { user: updated } = await api('DELETE', `/api/users/${user.key}/link`);
        replace(updated);
        say(status, 'link turned off');
      });
    } else if (action === 'slot-clear') {
      const slot = button.closest('.slot').dataset.slot;
      run(async () => {
        const { user: updated } = await api('DELETE', `/api/users/${user.key}/images/${slot}`);
        replace(updated);
      });
    } else if (action === 'view-copy') {
      copy(viewLink(user, card), status);
    } else if (action === 'mute') {
      run(async () => {
        await api('POST', `/api/users/${user.key}/mute`, { muted: true });
        say(status, 'muted');
        refreshLive();
      });
    } else if (action === 'kick') {
      run(async () => {
        if (!window.confirm(`Kick ${user.displayName} from the table? They can rejoin.`)) return;
        await api('POST', `/api/users/${user.key}/kick`);
        say(status, 'kicked');
        refreshLive();
      });
    } else if (action === 'delete') {
      run(async () => {
        if (!window.confirm(`Delete ${user.displayName}? Their images and links go with them.`)) return;
        await api('DELETE', `/api/users/${user.key}`);
        card.remove();
        cards.delete(user.key);
        users = users.filter((u) => u.key !== user.key);
      });
    }
  });
  card.addEventListener('change', (event) => {
    const user = userOf(card);
    const input = event.target;
    if (input.type === 'file') {
      const slot = input.closest('.slot').dataset.slot;
      const file = input.files[0];
      if (!file) return;
      run(async () => {
        say(status, `uploading ${slot}...`);
        const { user: updated } = await api('PUT', `/api/users/${user.key}/images/${slot}`, file, file.type);
        replace(updated);
        say(status, 'image saved');
      });
      input.value = '';
    } else if (input.matches('[data-view-kind]')) {
      card.querySelector('[data-view-open]').href = viewLink(user, card);
    }
  });
}

function replace(updated) {
  const previous = users.find((u) => u.key === updated.key);
  const merged = { ...updated, online: previous?.online || null };
  users = users.map((u) => (u.key === updated.key ? merged : u));
  fill(cardFor(merged), merged);
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

// --- rooms ---------------------------------------------------------------------
// The Lobby holds everyone; other rooms hold the members the admin ticks.

let rooms = [];
const roomCards = new Map();

function roomCardFor(room) {
  let card = roomCards.get(room.id);
  if (card) return card;
  card = $('room-card').content.firstElementChild.cloneNode(true);
  card.dataset.room = room.id;
  roomCards.set(room.id, card);
  $('rooms').appendChild(card);
  return card;
}

function fillRoom(card, room) {
  const editing = document.activeElement?.closest?.('.room-card') === card;
  if (!editing) {
    card.querySelector('[data-rfield="name"]').value = room.name;
    card.querySelector('[data-rfield="description"]').value = room.description;
  }
  const img = card.querySelector('[data-room-image] img');
  img.hidden = !room.hasImage;
  if (room.hasImage) img.src = `/img/room/${room.id}?v=${Date.now()}`;
  card.querySelector('[data-room-image] .unset').hidden = room.hasImage;
  card.querySelector('[data-action="room-image-clear"]').hidden = !room.hasImage;
  const checks = card.querySelector('[data-members]');
  const members = new Set(room.members);
  const keep = new Set();
  for (const user of users) {
    keep.add(user.key);
    let label = checks.querySelector(`[data-member="${CSS.escape(user.key)}"]`);
    if (!label) {
      // A portrait tile that toggles: lit when the user is in the room.
      label = document.createElement('label');
      label.className = 'member member-toggle';
      label.dataset.member = user.key;
      label.title = 'Click to add or remove';
      const input = document.createElement('input');
      input.type = 'checkbox';
      const thumb = document.createElement('img');
      thumb.alt = '';
      thumb.src = imgUrl(user.key, 'profile');
      const name = document.createElement('span');
      name.className = 'member-name';
      label.append(input, thumb, name);
      checks.appendChild(label);
    }
    label.querySelector('.member-name').textContent = user.displayName;
    const input = label.querySelector('input');
    if (!editing) input.checked = room.isLobby || members.has(user.key);
    input.disabled = room.isLobby;
    label.classList.toggle('online', input.checked);
    label.classList.toggle('locked', room.isLobby);
  }
  for (const label of [...checks.children]) if (!keep.has(label.dataset.member)) label.remove();
  card.querySelector('[data-members-note]').hidden = !room.isLobby;
  card.querySelector('[data-action="room-delete"]').hidden = room.isLobby;
  card.classList.toggle('lobby', room.isLobby);
}

function renderRooms() {
  for (const room of rooms) fillRoom(roomCardFor(room), room);
  for (const [id, card] of roomCards) {
    if (!rooms.some((r) => r.id === id)) {
      card.remove();
      roomCards.delete(id);
    }
  }
  $('rooms-status').textContent = `${rooms.length} room${rooms.length === 1 ? '' : 's'}`;
}

function replaceRoom(updated) {
  rooms = rooms.map((r) => (r.id === updated.id ? updated : r));
  fillRoom(roomCardFor(updated), updated);
}

$('add-room').addEventListener('click', async () => {
  try {
    const { room } = await api('POST', '/api/rooms', { name: `Room ${rooms.length}`, description: '', members: [] });
    rooms.push(room);
    renderRooms();
    const card = roomCards.get(room.id);
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    card.querySelector('[data-rfield="name"]').select();
  } catch (err) {
    say($('rooms-status'), err.message, true);
  }
});

$('rooms').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const card = button.closest('.room-card');
  const room = rooms.find((r) => r.id === card.dataset.room);
  const status = card.querySelector('[data-status]');
  if (!room) return;
  try {
    if (button.dataset.action === 'room-save') {
      const patch = {
        name: card.querySelector('[data-rfield="name"]').value,
        description: card.querySelector('[data-rfield="description"]').value,
      };
      if (!room.isLobby) patch.members = [...card.querySelectorAll('[data-member] input:checked')].map((i) => i.closest('[data-member]').dataset.member);
      const { room: updated } = await api('PATCH', `/api/rooms/${room.id}`, patch);
      replaceRoom(updated);
      say(status, 'saved');
    } else if (button.dataset.action === 'room-delete') {
      if (!window.confirm(`Delete the room "${room.name}"? Its members stay in the Lobby.`)) return;
      await api('DELETE', `/api/rooms/${room.id}`);
      rooms = rooms.filter((r) => r.id !== room.id);
      renderRooms();
    } else if (button.dataset.action === 'room-image-clear') {
      const { room: updated } = await api('DELETE', `/api/rooms/${room.id}/image`);
      replaceRoom(updated);
      say(status, 'image removed');
    }
  } catch (err) {
    say(status, err.message, true);
  }
});

$('rooms').addEventListener('change', async (event) => {
  const input = event.target;
  if (input.type === 'checkbox' && input.closest('.member-toggle')) {
    input.closest('.member-toggle').classList.toggle('online', input.checked);
    return;
  }
  if (input.type !== 'file') return;
  const card = input.closest('.room-card');
  const room = rooms.find((r) => r.id === card.dataset.room);
  const file = input.files[0];
  if (!room || !file) return;
  const status = card.querySelector('[data-status]');
  try {
    say(status, 'uploading...');
    const { room: updated } = await api('PUT', `/api/rooms/${room.id}/image`, file, file.type);
    replaceRoom(updated);
    say(status, 'image saved');
  } catch (err) {
    say(status, err.message, true);
  }
  input.value = '';
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
    const card = cards.get(user.key);
    card.querySelector('.user-body').hidden = false;
    card.querySelector('[data-action="toggle"]').textContent = 'Close';
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
$('save-settings').addEventListener('click', () => saveSettings({ serverName: $('set-server').value }, $('settings-status')));
$('save-login').addEventListener('click', () => saveSettings({ loginText: $('set-login-text').value }, $('login-status')));

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
      pictureBackground: $('set-picture-bg').checked,
      pictureColor: $('set-picture-color').value,
      pictureScale: $('set-picture-scale').value,
    });
    defaults = { border: settings.border, borderColor: settings.borderColor };
    say($('defaults-status'), 'saved');
    await loadUsers();
  } catch (err) {
    say($('defaults-status'), err.message, true);
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
    img.src = showImage ? `/img/site/${name}?v=${Date.now()}` : '';
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
  await loadBranding();
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
    streamKey = info.streamKey;
    const { settings } = await api('GET', '/api/settings');
    $('set-server').value = settings.serverName;
    $('set-login-text').value = settings.loginText;
    defaults = { border: settings.border, borderColor: settings.borderColor };
    $('set-border').checked = settings.border;
    $('set-border-color').value = settings.borderColor;
    $('set-border-width').value = settings.borderWidth || 6;
    $('set-muted-border').checked = settings.mutedBorder !== false;
    $('set-muted-color').value = settings.mutedColor || '#b8503f';
    $('set-plate').checked = Boolean(settings.plate);
    $('set-char-border').checked = Boolean(settings.charBorder);
    $('set-char-border-color').value = settings.charBorderColor || '#6fae6b';
    $('set-char-muted-border').checked = Boolean(settings.charMutedBorder);
    $('set-char-muted-color').value = settings.charMutedColor || '#b8503f';
    $('set-char-border-width').value = settings.charBorderWidth || 6;
    $('set-picture-bg').checked = Boolean(settings.pictureBackground);
    $('set-picture-color').value = settings.pictureColor || '#1a1410';
    $('set-picture-scale').value = settings.pictureScale || 100;
    renderSiteImages(settings);
    showStreamKey();
    await loadUsers();
    setInterval(refreshLive, 5000);
  } catch (err) {
    location.href = '/login?next=/admin';
  }
}
init();
