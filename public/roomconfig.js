// One room's own page, the same idea as a user's profile page: click a
// room in Manage > Rooms and land here, instead of editing it inline in
// the list. Admin only.
import { loadBranding, api, wireOverlayBack, renderTopbar, setTopbarLocation, escapeHtml, crumbLink, getIcons } from '/brand.js';

const $ = (id) => document.getElementById(id);
const roomId = decodeURIComponent(location.pathname.split('/')[2] || '');
let me = null;
let room = null;
let users = [];

// The choices come from the admin's Font Awesome list (Theme tab).
let selectedLinkIcon = 'link';

function buildIconGrid() {
  const grid = $('e-link-icon');
  grid.textContent = '';
  for (const { id, classes, label } of getIcons()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.icon = id;
    btn.title = label || id;
    btn.innerHTML = `<i class="${escapeHtml(classes)} fa-fw" aria-hidden="true"></i>`;
    btn.addEventListener('click', () => {
      selectedLinkIcon = id;
      renderIconGridSelection();
    });
    grid.appendChild(btn);
  }
}

function renderIconGridSelection() {
  for (const btn of $('e-link-icon').children) btn.classList.toggle('selected', btn.dataset.icon === selectedLinkIcon);
}

function say(el, text, error = false) {
  el.textContent = text;
  el.classList.toggle('error', error);
  if (text && !error) setTimeout(() => el.textContent === text && (el.textContent = ''), 3000);
}

function imgUrl(key, slot) {
  return `/img/${encodeURIComponent(key)}/${slot}?v=${Date.now()}`;
}

async function copy(text, statusEl) {
  try {
    await navigator.clipboard.writeText(text);
    say(statusEl, 'copied');
  } catch (err) {
    window.prompt('Copy this:', text);
  }
}

function render() {
  document.title = `${document.title.split(' - ')[0]} - ${room.name}`;
  $('room-title').textContent = room.name;
  $('lobby-tag').hidden = !room.isLobby;

  if (document.activeElement?.closest?.('.fields') == null) {
    $('e-name').value = room.name;
    $('e-description').value = room.description;
    $('e-profile').value = room.profile;
    $('e-link').value = room.link || '';
  }
  if (document.activeElement?.closest?.('.icon-grid') == null) {
    selectedLinkIcon = room.linkIcon;
    renderIconGridSelection();
  }
  $('e-allow-guests').checked = room.allowGuests;

  const img = $('room-image');
  img.hidden = !room.hasImage;
  if (room.hasImage) img.src = `/img/room/${room.id}?v=${Date.now()}`;
  $('room-image-slot').querySelector('.unset').hidden = room.hasImage;
  $('room-image-clear').hidden = !room.hasImage;

  $('members-hint').textContent = room.isLobby
    ? 'Everyone belongs to the Lobby.'
    : 'Click a player to add or remove them from this room -- saves as you click.';

  $('danger-row').hidden = room.isLobby;

  renderMembers();
  renderGuestLink();
}

function renderGuestLink() {
  const token = room.guestToken;
  const allowed = room.allowGuests !== false;
  $('guest-link-off-note').hidden = allowed;
  $('guest-link-value').textContent = token ? `${location.origin}/guest/${token}` : 'off';
  $('guest-link-on').hidden = !allowed || !!token;
  $('guest-link-copy').hidden = !token;
  $('guest-link-new').hidden = !allowed || !token;
  $('guest-link-off').hidden = !token;
}

async function setGuestLink(body) {
  try {
    if (body === null) room = (await api('DELETE', `/api/rooms/${room.id}/guest-link`)).room;
    else room = (await api('POST', `/api/rooms/${room.id}/guest-link`, body)).room;
    renderGuestLink();
  } catch (err) {
    say($('guest-link-status'), err.message, true);
  }
}

function renderMembers() {
  const container = $('members');
  const members = new Set(room.members);
  const keep = new Set();
  for (const user of users) {
    keep.add(user.key);
    let label = container.querySelector(`[data-member="${CSS.escape(user.key)}"]`);
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
      container.appendChild(label);
    }
    label.querySelector('.member-name').textContent = user.displayName;
    const input = label.querySelector('input');
    input.checked = room.isLobby || members.has(user.key);
    input.disabled = room.isLobby;
    label.classList.toggle('online', input.checked);
    label.classList.toggle('locked', room.isLobby);
  }
  for (const label of [...container.children]) if (!keep.has(label.dataset.member)) label.remove();
}

// Saves as you click, like Allow Guests -- the Members tab has no Save
// button of its own, and the Room tab's Save shouldn't be what commits it.
$('members').addEventListener('change', async (event) => {
  const input = event.target;
  if (input.type !== 'checkbox') return;
  input.closest('.member-toggle').classList.toggle('online', input.checked);
  try {
    const members = [...$('members').querySelectorAll('input:checked')].map((i) => i.closest('[data-member]').dataset.member);
    room = (await api('PATCH', `/api/rooms/${room.id}`, { members })).room;
    renderMembers();
  } catch (err) {
    input.checked = !input.checked;
    input.closest('.member-toggle').classList.toggle('online', input.checked);
    say($('members-status'), err.message, true);
  }
});

$('save-btn').addEventListener('click', async () => {
  try {
    const patch = { name: $('e-name').value, description: $('e-description').value, profile: $('e-profile').value, link: $('e-link').value, linkIcon: selectedLinkIcon };
    room = (await api('PATCH', `/api/rooms/${room.id}`, patch)).room;
    render();
    say($('save-status'), 'saved');
  } catch (err) {
    say($('save-status'), err.message, true);
  }
});

$('e-allow-guests').addEventListener('change', async (event) => {
  try {
    room = (await api('PATCH', `/api/rooms/${room.id}`, { allowGuests: event.target.checked })).room;
    renderGuestLink();
  } catch (err) {
    event.target.checked = room.allowGuests;
    say($('guest-link-status'), err.message, true);
  }
});

$('room-image-file').addEventListener('change', async () => {
  const file = $('room-image-file').files[0];
  $('room-image-file').value = '';
  if (!file) return;
  try {
    say($('status'), 'uploading...');
    room = (await api('PUT', `/api/rooms/${room.id}/image`, file, file.type)).room;
    render();
    say($('status'), 'image saved');
  } catch (err) {
    say($('status'), err.message, true);
  }
});

$('room-image-clear').addEventListener('click', async () => {
  try {
    room = (await api('DELETE', `/api/rooms/${room.id}/image`)).room;
    render();
    say($('status'), 'image removed');
  } catch (err) {
    say($('status'), err.message, true);
  }
});

$('guest-link-on').addEventListener('click', () => setGuestLink({}));
$('guest-link-new').addEventListener('click', () => setGuestLink({ regenerate: true }));
$('guest-link-off').addEventListener('click', () => setGuestLink(null));
$('guest-link-copy').addEventListener('click', () => copy($('guest-link-value').textContent, $('guest-link-status')));

$('make-invite').addEventListener('click', async () => {
  try {
    const { invite } = await api('POST', '/api/invites', { rooms: [room.id] });
    $('invite-link').textContent = invite.url;
    $('invite-link-row').hidden = false;
    say($('invite-status'), 'link made');
  } catch (err) {
    say($('invite-status'), err.message, true);
  }
});
$('invite-copy').addEventListener('click', () => copy($('invite-link').textContent, $('invite-status')));

$('delete-btn').addEventListener('click', async () => {
  if (!window.confirm(`Delete the room "${room.name}"? Its members stay in the Lobby.`)) return;
  try {
    await api('DELETE', `/api/rooms/${room.id}`);
    location.href = '/admin#rooms';
  } catch (err) {
    say($('status'), err.message, true);
  }
});

// Room / Members tabs, remembered in the address -- same pattern as
// admin.html's and profile.html's tabs.
function selectTab(name) {
  const tab = name === 'members' ? 'members' : 'room';
  $('tab-room').hidden = tab !== 'room';
  $('tab-members').hidden = tab !== 'members';
  for (const b of document.querySelectorAll('.subtab')) b.classList.toggle('active', b.dataset.tab === tab);
  if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
}
$('subtabs').addEventListener('click', (event) => {
  const b = event.target.closest('.subtab');
  if (b) selectTab(b.dataset.tab);
});
window.addEventListener('hashchange', () => selectTab(location.hash.slice(1)));
selectTab(location.hash.slice(1));

async function init() {
  renderTopbar({ adminHref: '/admin#rooms', location: crumbLink('gear', 'Server Settings', '/admin#rooms') });
  await loadBranding();
  wireOverlayBack();
  buildIconGrid();
  try {
    const info = await api('GET', '/api/me');
    me = info.user;
    if (me.role !== 'admin') { location.href = '/'; return; }
    $('whoami').textContent = me.displayName;
    $('whoami-img').src = imgUrl(me.key, 'profile');
    $('whoami-img').hidden = false;
    $('admin-link').hidden = false;
    const [roomRes, usersRes] = await Promise.all([api('GET', `/api/rooms/${roomId}`), api('GET', '/api/users')]);
    room = roomRes.room;
    users = usersRes.users;
    setTopbarLocation(
      crumbLink('gear', 'Server Settings', '/admin#rooms') +
      `<span class="crumb-sep">&rsaquo;</span>` +
      crumbLink('message', room.name, location.pathname)
    );
  } catch (err) {
    location.href = '/admin#rooms';
    return;
  }
  render();
}
init();
