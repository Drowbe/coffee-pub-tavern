// One room's own page, the same idea as a user's profile page: click a
// room in Manage > Rooms and land here, instead of editing it inline in
// the list. Admin only.
import { loadBranding, api, wireOverlayBack } from '/brand.js';

const $ = (id) => document.getElementById(id);
const roomId = decodeURIComponent(location.pathname.split('/')[2] || '');
let me = null;
let room = null;
let users = [];

function say(el, text, error = false) {
  el.textContent = text;
  el.classList.toggle('error', error);
  if (text && !error) setTimeout(() => el.textContent === text && (el.textContent = ''), 3000);
}

function imgUrl(key, slot) {
  return `/img/${encodeURIComponent(key)}/${slot}?v=${Date.now()}`;
}

function render() {
  document.title = `${document.title.split(' - ')[0]} - ${room.name}`;
  $('room-title').textContent = room.name;
  $('lobby-tag').hidden = !room.isLobby;

  if (document.activeElement?.closest?.('.fields') == null) {
    $('e-name').value = room.name;
    $('e-description').value = room.description;
  }

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
    const patch = { name: $('e-name').value, description: $('e-description').value };
    if (!room.isLobby) patch.members = [...$('members').querySelectorAll('input:checked')].map((i) => i.closest('[data-member]').dataset.member);
    room = (await api('PATCH', `/api/rooms/${room.id}`, patch)).room;
    render();
    say($('save-status'), 'saved');
  } catch (err) {
    say($('save-status'), err.message, true);
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
  await loadBranding();
  wireOverlayBack();
  try {
    const info = await api('GET', '/api/me');
    me = info.user;
    if (me.role !== 'admin') { location.href = '/'; return; }
    $('whoami').textContent = me.displayName;
    $('whoami-img').src = imgUrl(me.key, 'profile');
    $('whoami-img').hidden = false;
    const [roomRes, usersRes] = await Promise.all([api('GET', `/api/rooms/${roomId}`), api('GET', '/api/users')]);
    room = roomRes.room;
    users = usersRes.users;
  } catch (err) {
    location.href = '/admin#rooms';
    return;
  }
  render();
}
init();
