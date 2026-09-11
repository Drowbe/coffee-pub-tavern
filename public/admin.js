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

let defaults = { border: true, borderColor: '#6fae6b', badge: true, plate: false };

// Users / Settings tabs, remembered in the address
function selectTab(name) {
  const tab = name === 'settings' ? 'settings' : 'users';
  $('tab-users').hidden = tab !== 'users';
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
  card.querySelector('[data-thumb]').src = imgUrl(user.key, 'player');
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
  // Player video box: the user's own values, or the defaults when unset
  const eff = user.player.effective;
  const own = user.player;
  if (document.activeElement?.closest?.('.user-card') !== card) {
    card.querySelector('[data-pfield="border"]').checked = eff.border;
    card.querySelector('[data-pfield="borderColor"]').value = eff.borderColor;
    card.querySelector('[data-pfield="badge"]').checked = eff.badge;
    card.querySelector('[data-pfield="plate"]').checked = Boolean(eff.plate);
  }
  const custom = own.border !== null || own.borderColor || own.badge !== null || (own.plate !== null && own.plate !== undefined);
  card.querySelector('[data-player-note]').textContent = custom ? 'custom for this player' : 'server defaults';
  card.querySelector('[data-action="player-defaults"]').hidden = !custom;
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
  live.textContent = online ? `${online.micOn ? 'mic on' : 'mic off'} · ${online.cameraOn ? 'camera on' : 'camera off'}` : '';
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
    } else if (action === 'player-defaults') {
      run(async () => {
        const { user: updated } = await api('PATCH', `/api/users/${user.key}`, { player: { border: null, borderColor: '', badge: null, plate: null } });
        replace(updated);
        say(status, 'using the server defaults');
      });
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
    } else if (input.matches('[data-pfield]')) {
      run(async () => {
        const player = {
          border: card.querySelector('[data-pfield="border"]').checked,
          borderColor: card.querySelector('[data-pfield="borderColor"]').value,
          badge: card.querySelector('[data-pfield="badge"]').checked,
          plate: card.querySelector('[data-pfield="plate"]').checked,
        };
        const { user: updated } = await api('PATCH', `/api/users/${user.key}`, { player });
        replace(updated);
        say(status, 'saved');
      });
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
  renderUsers();
}

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

$('save-settings').addEventListener('click', async () => {
  try {
    await api('PATCH', '/api/settings', {
      serverName: $('set-server').value,
      tableName: $('set-table').value,
      loginText: $('set-login-text').value,
    });
    await loadBranding();
    say($('settings-status'), 'saved');
  } catch (err) {
    say($('settings-status'), err.message, true);
  }
});

$('save-defaults').addEventListener('click', async () => {
  try {
    const { settings } = await api('PATCH', '/api/settings', {
      border: $('set-border').checked,
      borderColor: $('set-border-color').value,
      badge: $('set-badge').checked,
      plate: $('set-plate').checked,
    });
    defaults = { border: settings.border, borderColor: settings.borderColor, badge: settings.badge, plate: settings.plate };
    say($('defaults-status'), 'saved');
    await loadUsers(); // effective values on the cards follow the defaults
  } catch (err) {
    say($('defaults-status'), err.message, true);
  }
});

$('icon-file').addEventListener('change', async () => {
  const file = $('icon-file').files[0];
  if (!file) return;
  try {
    await api('PUT', '/api/settings/icon', file, file.type);
    await loadBranding();
    $('icon-preview').src = `/img/site/icon?v=${Date.now()}`;
    say($('settings-status'), 'icon saved');
  } catch (err) {
    say($('settings-status'), err.message, true);
  }
  $('icon-file').value = '';
});

$('icon-remove').addEventListener('click', async () => {
  try {
    await api('DELETE', '/api/settings/icon');
    await loadBranding();
    $('icon-preview').src = `/img/site/icon?v=${Date.now()}`;
    say($('settings-status'), 'icon removed');
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
    streamKey = info.streamKey;
    const { settings } = await api('GET', '/api/settings');
    $('set-server').value = settings.serverName;
    $('set-table').value = settings.tableName;
    $('set-login-text').value = settings.loginText;
    defaults = { border: settings.border, borderColor: settings.borderColor, badge: settings.badge, plate: settings.plate };
    $('set-border').checked = settings.border;
    $('set-border-color').value = settings.borderColor;
    $('set-badge').checked = settings.badge;
    $('set-plate').checked = Boolean(settings.plate);
    $('icon-preview').src = `/img/site/icon?v=${Date.now()}`;
    showStreamKey();
    await loadUsers();
    setInterval(refreshLive, 5000);
  } catch (err) {
    location.href = '/login?next=/admin';
  }
}
init();
