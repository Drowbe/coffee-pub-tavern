// One room's own page, the same idea as a user's profile page: click a
// room in Manage > Rooms and land here, instead of editing it inline in
// the list. Admin only.
import { loadBranding, api, wireOverlayBack, renderTopbar, setTopbarLocation, escapeHtml } from '/brand.js';

const $ = (id) => document.getElementById(id);
const roomId = decodeURIComponent(location.pathname.split('/')[2] || '');
let me = null;
let room = null;
let users = [];

// Kept in sync with ROOM_LINK_ICONS in server/store.js -- Font Awesome
// solid is the only style loaded, so the choice is a fixed set, not free text.
const ROOM_LINK_ICONS = [
  'link', 'globe', 'gamepad', 'dice-d20', 'dice-d6', 'scroll', 'book',
  'book-open', 'map', 'compass', 'music', 'headphones', 'video', 'tv',
  'comments', 'wand-magic-sparkles', 'chess', 'users', 'house', 'star', 'couch',
];
let selectedLinkIcon = 'link';

function buildIconGrid() {
  const grid = $('e-link-icon');
  for (const icon of ROOM_LINK_ICONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.icon = icon;
    btn.title = icon;
    btn.innerHTML = `<i class="fa-solid fa-${icon} fa-fw" aria-hidden="true"></i>`;
    btn.addEventListener('click', () => {
      selectedLinkIcon = icon;
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
    : 'Click a player to add or remove them from this room.';

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

$('members').addEventListener('change', (event) => {
  const input = event.target;
  if (input.type !== 'checkbox') return;
  input.closest('.member-toggle').classList.toggle('online', input.checked);
});

$('save-btn').addEventListener('click', async () => {
  try {
    const patch = { name: $('e-name').value, description: $('e-description').value, profile: $('e-profile').value, link: $('e-link').value, linkIcon: selectedLinkIcon };
    if (!room.isLobby) patch.members = [...$('members').querySelectorAll('input:checked')].map((i) => i.closest('[data-member]').dataset.member);
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

async function init() {
  renderTopbar({ adminHref: '/admin#rooms', location: '<span class="crumb-here"><i class="fa-solid fa-gear fa-fw" aria-hidden="true"></i><span class="crumb-label"> Server Settings</span></span>' });
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
      `<span class="crumb-here"><i class="fa-solid fa-gear fa-fw" aria-hidden="true"></i><span class="crumb-label"> Server Settings</span></span>` +
      `<span class="crumb-sep">&rsaquo;</span>` +
      `<span class="crumb-here"><i class="fa-solid fa-message fa-fw" aria-hidden="true"></i><span class="crumb-label"> ${escapeHtml(room.name)}</span></span>`
    );
  } catch (err) {
    location.href = '/admin#rooms';
    return;
  }
  render();
}
init();
