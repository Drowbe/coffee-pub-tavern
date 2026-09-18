// Your own profile: change your own photo, see everything else your admin
// set. An admin visiting /profile/<key> gets the same page in edit mode
// for that person instead -- the one place any of a user's settings are
// changed, rather than a flat table of everyone on the Manage page.
import { loadBranding, api, wireOverlayBack, renderTopbar } from '/brand.js';
import { formatHotkey, comboFromEvent } from '/hotkeys.js';

const PARTICIPANT_SLOTS = ['playerOffline', 'player', 'playerTalking', 'playerMuted', 'playerAside', 'playerPrivate'];
const CHARACTER_SLOTS = ['characterOffline', 'character', 'talking', 'muted', 'characterAside', 'characterPrivate'];
const ROOM_PROFILE_SLOTS = { roleplaying: [...PARTICIPANT_SLOTS, ...CHARACTER_SLOTS], participants: PARTICIPANT_SLOTS, characters: CHARACTER_SLOTS };

const $ = (id) => document.getElementById(id);
const editingKey = decodeURIComponent(location.pathname.split('/')[2] || '') || null;
let me = null; // the signed-in admin, only used for the "last admin" check
let user = null; // whose profile this is: me, or the person being edited
let streamKey = '';
let roomsById = new Map(); // every real room (not the Lobby), for the per-room sections below

// If this page is open as the overlay on top of an active call (same
// pattern as closeProfileOverlay -- see brand.js/room.js), and it's my own
// settings rather than an admin editing someone else's, tell the running
// call to pick up the change now instead of waiting for a camera toggle.
function notifyLiveCallPrefs(patch) {
  if (editingKey || window.parent === window) return;
  window.parent.tavernApplyCallPrefs?.(patch)?.catch?.(() => {});
}

function say(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}

function sayField(el, text, error = false) {
  el.textContent = text;
  el.classList.toggle('error', error);
  if (text && !error) setTimeout(() => el.textContent === text && (el.textContent = ''), 3000);
}

async function copy(text, statusEl) {
  try {
    await navigator.clipboard.writeText(text);
    sayField(statusEl, 'copied');
  } catch (err) {
    window.prompt('Copy this:', text);
  }
}

function imgUrl(slot) {
  return `/img/${encodeURIComponent(user.key)}/${slot}?v=${Date.now()}`;
}

function viewLink() {
  const q = new URLSearchParams({ s: streamKey, kind: $('view-kind').value });
  return `${user.viewUrl}?${q}`;
}

async function reload() {
  user = editingKey ? (await api('GET', `/api/users/${editingKey}`)).user : (await api('GET', '/api/me')).user;
}

function render() {
  const editing = !!editingKey;

  const has = !!user.images.profile;
  $('portrait').src = imgUrl('profile'); // the server draws initials when unset
  $('portrait-slot').classList.toggle('set', has);
  $('portrait-clear').hidden = !has; // nothing on an account is off-limits to an admin, this included
  document.querySelector('#portrait-slot .unset').hidden = true;
  $('whoami-img').src = `/img/${encodeURIComponent(me ? me.key : user.key)}/profile?v=${Date.now()}`;
  $('whoami-img').hidden = false;
  $('whoami').textContent = me ? me.displayName : user.displayName;
  $('name').textContent = user.displayName;

  const hasBg = !!user.images.background;
  $('background').hidden = !hasBg;
  if (hasBg) $('background').src = imgUrl('background');
  $('background-slot').querySelector('.unset').hidden = hasBg;
  $('background-clear').hidden = !hasBg;
  $('background-hint').textContent = editing
    ? `Shown behind ${user.displayName}'s portrait when their camera is off, and used as their real call background too if Background Style below is set to Image Background. Unset shows the plain color instead.`
    : 'Shown behind your portrait when your camera is off, and used as your real call background too if Background Style below is set to Image Background. Leave it unset to use the plain color instead.';

  // Someone's own mic and camera setup, not an admin's to adjust for them --
  // only shown on your own profile.
  $('section-call').hidden = editing;
  $('call-prefs-hint').textContent = 'Your own mic and camera settings, applied automatically wherever you join a call from. Which device to use is separate -- that stays on this device, in the call itself.';
  if (!document.activeElement?.id?.startsWith('cp-')) {
    const cp = user.callPrefs;
    $('cp-gain').value = String(cp.gain);
    $('cp-gain-value').textContent = `${cp.gain}%`;
    $('cp-gate').value = String(cp.gate);
    $('cp-gate-value').textContent = cp.gate ? `${cp.gate}` : 'off';
    $('cp-noise').checked = cp.noise;
    $('cp-echo').checked = cp.echo;
    $('cp-agc').checked = cp.agc;
    $('cp-talk-mode').value = cp.ptt ? 'ptt' : 'open';
    $('cp-quality').value = String(cp.quality);
    $('cp-mirror').checked = cp.mirror;
    $('cp-background').value = cp.background;
    $('cp-master-volume').value = String(cp.masterVolume);
    $('cp-volume-value').textContent = `${cp.masterVolume}%`;
    $('cp-mute-key').textContent = formatHotkey(cp.muteKey);
    $('cp-ptt-key').textContent = formatHotkey(cp.pttKey);
    $('cp-cam-key').textContent = formatHotkey(cp.camKey);
  }

  $('admin-link').hidden = !(me ? me.role === 'admin' : user.role === 'admin');
  $('portrait-hint').textContent = editing
    ? `${user.displayName}'s own photo: it shows next to their name in the header and on their tile at the table. Click it to change it -- it is not the picture used in the recording, that's below.`
    : 'Your own photo: it shows next to your name in the header and on your tile at the table. Click it to change it; square images look best. It is not the picture used in the recording — your admin sets that.';

  // Account: read-only facts normally, editable fields for an admin. Same
  // boxed layout either way (see .facts/.fact in style.css) -- only
  // whether a box holds plain text or an input changes.
  $('account-facts').hidden = editing;
  $('account-fields').hidden = !editing;
  $('account-save-row').hidden = !editing;
  $('account-hint').hidden = editing;
  if (!editing) {
    $('f-name').textContent = user.displayName;
    $('f-login').textContent = user.login;
    $('f-role').textContent = user.role === 'admin' ? 'Admin: runs the table' : 'Player';
    $('f-password').textContent = user.hasPassword ? 'Set. Only an admin can change it.' : 'None. You sign in with your personal link.';
  } else if (document.activeElement?.closest?.('#account-fields') == null) {
    $('e-name').value = user.displayName;
    $('e-login').value = user.login;
    $('e-role').value = user.role;
    // The last admin cannot be demoted, and neither can the admin editing
    // their own account here -- the disabled option itself says enough.
    const self = me && user.key === me.key;
    $('e-role').querySelector('option[value="user"]').disabled = self;
    $('account-clear-password').hidden = !user.hasPassword;
  }
  // Seeing and copying your own link isn't an editing action -- only
  // creating, regenerating or turning it off is.
  $('link-value').textContent = user.link || 'off';
  $('link-value').classList.toggle('dim', !user.link);
  $('link-copy').hidden = !user.link;
  $('link-edit-actions').hidden = !editing;
  if (editing) {
    $('link-off').hidden = !user.link;
    $('link-new').textContent = user.link ? 'Regenerate' : 'Create';
  }

  $('images-heading').textContent = editing ? 'Default Profile Images' : 'Your Default Profile Images';
  $('player-images-hint').textContent = editing
    ? "The participant's video box. Offline shows the Offline picture (or nothing). Online shows the camera, or the Online picture when the camera is off. Talking and muted lay their pictures on top, and draw the borders set under Settings."
    : 'Your video box. Offline shows the Offline picture (or nothing). Online shows your camera, or the Online picture when your camera is off. Talking and muted lay their pictures on top, and draw the borders set under Settings.';
  $('character-images-hint').textContent = editing
    ? 'A second box for OBS. Offline shows the Offline picture, Online the character picture, with Talking and Muted laid on top while they speak or while their microphone is off. Any picture left unset is transparent, so with no Online picture the box can sit over a character bar.'
    : 'A second box for OBS. Offline shows the Offline picture, Online the character picture, with Talking and Muted laid on top while you speak or while your microphone is off. Any picture left unset is transparent, so with no Online picture the box can sit over a character bar.';
  for (const slot of document.querySelectorAll('#other-images .slot')) {
    const name = slot.dataset.slot;
    const set = !!user.images[name];
    const img = slot.querySelector('img');
    img.hidden = !set;
    if (set) img.src = imgUrl(name);
    slot.querySelector('.unset').hidden = set;
    slot.classList.toggle('set', set);
    slot.querySelector('.slot-pick').classList.toggle('still', !editing);
    slot.querySelector('[data-action="slot-clear"]').hidden = !editing || !set;
  }

  $('obs-link-row').hidden = !editing;
  if (editing) $('view-open').href = viewLink();

  $('danger-row').hidden = !editing;
  if (editing) {
    const self = me && user.key === me.key;
    $('delete-btn').hidden = self;
  }

  renderRoomSections();
}

// --- per-room images -------------------------------------------------------
// One section per real room this person belongs to (never the Lobby --
// per-room images are for rooms an admin actually picked them into). A
// room's profile decides which of the two groups it even offers; an unset
// slot here simply uses the Default Profile Images above, so someone in
// two campaigns can give each its own Character images without the other
// campaign's set ever needing to be touched.

function buildRoomSection(roomId) {
  const section = $('room-section-template').content.firstElementChild.cloneNode(true);
  section.id = `section-room-${roomId}`;
  section.dataset.room = roomId;
  $('room-sections').appendChild(section);
  return section;
}

function fillRoomSection(section, room, roomImages) {
  const editing = !!editingKey;
  section.querySelector('.room-section-title').textContent = room.name;
  section.querySelector('.room-section-hint').textContent = editing
    ? `${user.displayName}'s images just for ${room.name}. Anything left unset here uses the Default Profile Images above.`
    : `Your images just for ${room.name}. Anything left unset here uses your Default Profile Images above.`;

  const allowed = ROOM_PROFILE_SLOTS[room.profile] || ROOM_PROFILE_SLOTS.roleplaying;
  section.querySelector('[data-group="participant"]').hidden = !PARTICIPANT_SLOTS.some((s) => allowed.includes(s));
  section.querySelector('[data-group="character"]').hidden = !CHARACTER_SLOTS.some((s) => allowed.includes(s));

  for (const slot of section.querySelectorAll('.slot')) {
    const name = slot.dataset.slot;
    const hasOwn = !!roomImages.images[name];
    const hasEffective = hasOwn || !!user.images[name];
    const img = slot.querySelector('img');
    img.hidden = !hasEffective;
    if (hasEffective) img.src = `/img/${encodeURIComponent(user.key)}/${name}?room=${encodeURIComponent(room.id)}&v=${Date.now()}`;
    slot.querySelector('.unset').hidden = hasEffective;
    slot.classList.toggle('set', hasOwn);
    slot.querySelector('.slot-pick').classList.toggle('still', !editing);
    slot.querySelector('[data-action="slot-clear"]').hidden = !editing || !hasOwn;
  }
}

function renderRoomSections() {
  const userRooms = user.rooms || {};
  const keep = new Set(Object.keys(userRooms));
  for (const [roomId, roomImages] of Object.entries(userRooms)) {
    const room = roomsById.get(roomId);
    if (!room) continue; // a room we don't know about yet (shouldn't happen); skip rather than crash
    const section = $(`section-room-${roomId}`) || buildRoomSection(roomId);
    fillRoomSection(section, room, roomImages);
  }
  for (const section of [...$('room-sections').children]) {
    if (keep.has(section.dataset.room)) continue;
    section.remove();
  }
}

$('room-sections').addEventListener('change', (event) => {
  if (!editingKey || event.target.type !== 'file') return;
  const roomId = event.target.closest('.room-section').dataset.room;
  const slot = event.target.closest('.slot').dataset.slot;
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  run(async () => {
    say(`uploading ${slot}...`);
    user = (await api('PUT', `/api/users/${user.key}/rooms/${roomId}/images/${slot}`, file, file.type)).user;
    render();
    say('image saved');
  });
});
$('room-sections').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action="slot-clear"]');
  if (!button || !editingKey) return;
  const roomId = button.closest('.room-section').dataset.room;
  const slot = button.closest('.slot').dataset.slot;
  run(async () => {
    user = (await api('DELETE', `/api/users/${user.key}/rooms/${roomId}/images/${slot}`)).user;
    render();
  });
});

// --- portrait: self-service, or an admin overriding it for someone else ----
// Nothing on a user's account is admin-proof, this photo included -- an
// admin editing someone else's profile can replace or clear it exactly like
// their own, via the same per-user image route every other slot already uses.

$('portrait-file').addEventListener('change', async () => {
  const file = $('portrait-file').files[0];
  if (!file) return;
  try {
    say('uploading...');
    if (editingKey) user = (await api('PUT', `/api/users/${user.key}/images/profile`, file, file.type)).user;
    else { await api('PUT', '/api/me/images/profile', file, file.type); await reload(); }
    render();
    say('image saved');
  } catch (err) {
    say(err.message, true);
  }
  $('portrait-file').value = '';
});

$('portrait-clear').addEventListener('click', async () => {
  try {
    if (editingKey) user = (await api('DELETE', `/api/users/${user.key}/images/profile`)).user;
    else { await api('DELETE', '/api/me/images/profile'); await reload(); }
    render();
    say('image removed');
  } catch (err) {
    say(err.message, true);
  }
});

$('background-file').addEventListener('change', async () => {
  const file = $('background-file').files[0];
  if (!file) return;
  try {
    say('uploading...');
    if (editingKey) user = (await api('PUT', `/api/users/${user.key}/images/background`, file, file.type)).user;
    else { await api('PUT', '/api/me/images/background', file, file.type); await reload(); }
    render();
    notifyLiveCallPrefs();
    say('image saved');
  } catch (err) {
    say(err.message, true);
  }
  $('background-file').value = '';
});

$('background-clear').addEventListener('click', async () => {
  try {
    if (editingKey) user = (await api('DELETE', `/api/users/${user.key}/images/background`)).user;
    else { await api('DELETE', '/api/me/images/background'); await reload(); }
    render();
    notifyLiveCallPrefs();
    say('image removed');
  } catch (err) {
    say(err.message, true);
  }
});

// --- call settings: mic/camera processing, applied wherever this account
// joins a call from. Saves as you change it, debounced (and accumulated
// across fields) so dragging a slider doesn't fire a request per tick.

let pendingCallPrefs = {};
let callPrefsTimer = 0;
function patchCallPrefs(patch) {
  Object.assign(pendingCallPrefs, patch);
  clearTimeout(callPrefsTimer);
  callPrefsTimer = setTimeout(async () => {
    const body = pendingCallPrefs;
    pendingCallPrefs = {};
    try {
      if (editingKey) user.callPrefs = (await api('PATCH', `/api/users/${user.key}/call-prefs`, body)).callPrefs;
      else user.callPrefs = (await api('PATCH', '/api/me/call-prefs', body)).callPrefs;
      notifyLiveCallPrefs(body);
      sayField($('call-prefs-status'), 'saved');
    } catch (err) {
      sayField($('call-prefs-status'), err.message, true);
    }
  }, 500);
}
$('cp-gain').addEventListener('input', (e) => {
  $('cp-gain-value').textContent = `${e.target.value}%`;
  patchCallPrefs({ gain: Number(e.target.value) });
});
$('cp-gate').addEventListener('input', (e) => {
  $('cp-gate-value').textContent = e.target.value !== '0' ? e.target.value : 'off';
  patchCallPrefs({ gate: Number(e.target.value) });
});
for (const id of ['noise', 'echo', 'agc', 'mirror']) {
  $(`cp-${id}`).addEventListener('change', (e) => patchCallPrefs({ [id]: e.target.checked }));
}
$('cp-talk-mode').addEventListener('change', (e) => patchCallPrefs({ ptt: e.target.value === 'ptt' }));
$('cp-quality').addEventListener('change', (e) => patchCallPrefs({ quality: Number(e.target.value) }));
$('cp-background').addEventListener('change', (e) => patchCallPrefs({ background: e.target.value }));
$('cp-master-volume').addEventListener('input', (e) => {
  $('cp-volume-value').textContent = `${e.target.value}%`;
  patchCallPrefs({ masterVolume: Number(e.target.value) });
});

// --- hotkeys: click a button, then press the combo you want -------------
// Escape or clicking away cancels without changing anything; any other key
// (with or without modifiers) is captured as soon as it lands, since a
// bare modifier alone isn't a usable combo yet.

function startHotkeyCapture(btn, prefKey) {
  btn.textContent = 'Press a key…';
  btn.classList.add('recording');
  const onKeyDown = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') { stop(); return; }
    const combo = comboFromEvent(event);
    if (!combo) return; // only a modifier so far -- keep waiting
    user.callPrefs[prefKey] = combo;
    patchCallPrefs({ [prefKey]: combo });
    stop();
  };
  const onBlur = () => stop();
  function stop() {
    document.removeEventListener('keydown', onKeyDown, true);
    btn.removeEventListener('blur', onBlur);
    btn.classList.remove('recording');
    btn.textContent = formatHotkey(user.callPrefs[prefKey]);
  }
  document.addEventListener('keydown', onKeyDown, true);
  btn.addEventListener('blur', onBlur);
  btn.focus();
}
for (const [id, prefKey] of [['cp-mute-key', 'muteKey'], ['cp-ptt-key', 'pttKey'], ['cp-cam-key', 'camKey']]) {
  $(id).addEventListener('click', () => startHotkeyCapture($(id), prefKey));
}

// --- admin editing someone else -----------------------------------------

async function run(fn, statusEl) {
  try {
    await fn();
  } catch (err) {
    sayField(statusEl, err.message, true);
  }
}

$('account-save').addEventListener('click', () => run(async () => {
  const patch = { displayName: $('e-name').value, login: $('e-login').value, role: $('e-role').value };
  const password = $('e-password').value;
  if (password) patch.password = password;
  user = (await api('PATCH', `/api/users/${user.key}`, patch)).user;
  $('e-password').value = '';
  render();
  sayField($('account-status'), 'saved');
}, $('account-status')));

$('account-clear-password').addEventListener('click', () => run(async () => {
  if (!user.link && !window.confirm(`${user.displayName} has no personal link. Without a password they cannot sign in. Remove it anyway?`)) return;
  user = (await api('PATCH', `/api/users/${user.key}`, { password: '' })).user;
  render();
  sayField($('account-status'), 'password removed');
}, $('account-status')));

$('link-copy').addEventListener('click', () => copy(user.link, $('account-status')));
$('link-new').addEventListener('click', () => run(async () => {
  if (user.link && !window.confirm('Regenerate the link? The old one stops working.')) return;
  user = (await api('POST', `/api/users/${user.key}/link`)).user;
  render();
  sayField($('account-status'), user.link ? 'new link made' : 'link created');
}, $('account-status')));
$('link-off').addEventListener('click', () => run(async () => {
  user = (await api('DELETE', `/api/users/${user.key}/link`)).user;
  render();
  sayField($('account-status'), 'link turned off');
}, $('account-status')));

$('other-images').addEventListener('change', (event) => {
  if (!editingKey || event.target.type !== 'file') return;
  const slot = event.target.closest('.slot').dataset.slot;
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  run(async () => {
    say(`uploading ${slot}...`);
    user = (await api('PUT', `/api/users/${user.key}/images/${slot}`, file, file.type)).user;
    render();
    say('image saved');
  });
});
$('other-images').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action="slot-clear"]');
  if (!button || !editingKey) return;
  const slot = button.closest('.slot').dataset.slot;
  run(async () => {
    user = (await api('DELETE', `/api/users/${user.key}/images/${slot}`)).user;
    render();
  });
});

$('view-kind').addEventListener('change', () => { $('view-open').href = viewLink(); });
$('view-copy').addEventListener('click', () => copy(viewLink(), $('status')));

$('mute-btn').addEventListener('click', () => run(async () => {
  await api('POST', `/api/users/${user.key}/mute`, { muted: true });
  say('muted');
}));
$('kick-btn').addEventListener('click', () => run(async () => {
  if (!window.confirm(`Kick ${user.displayName} from the table? They can rejoin.`)) return;
  await api('POST', `/api/users/${user.key}/kick`);
  say('kicked');
}));
$('delete-btn').addEventListener('click', () => run(async () => {
  if (!window.confirm(`Delete ${user.displayName}? Their images and links go with them.`)) return;
  await api('DELETE', `/api/users/${user.key}`);
  location.href = '/admin';
}));

// Profile / Rooms tabs, remembered in the address -- same pattern as
// admin.html's Users/Rooms/Settings tabs.
function selectTab(name) {
  const tab = name === 'rooms' ? 'rooms' : 'profile';
  $('tab-profile').hidden = tab !== 'profile';
  $('tab-rooms').hidden = tab !== 'rooms';
  for (const b of document.querySelectorAll('.subtab')) b.classList.toggle('active', b.dataset.tab === tab);
  if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
}
$('subtabs').addEventListener('click', (event) => {
  const b = event.target.closest('.subtab');
  if (b) selectTab(b.dataset.tab);
});
window.addEventListener('hashchange', () => selectTab(location.hash.slice(1)));

async function init() {
  renderTopbar({ location: '<span class="crumb-here"><i class="fa-solid fa-user fa-fw" aria-hidden="true"></i><span class="crumb-label"> Profile</span></span>' });
  const branding = await loadBranding();
  // The stored value is already clamped server-side (see sanitizeCallPrefs)
  // -- this just keeps the picker from offering an option that would get
  // silently rounded back down the moment it's picked.
  const maxQuality = branding.maxQuality || 720;
  for (const opt of $('cp-quality').options) opt.hidden = Number(opt.value) > maxQuality;
  wireOverlayBack();
  try {
    if (editingKey) {
      const mine = await api('GET', '/api/me');
      me = mine.user;
      if (me.role !== 'admin') { location.href = '/'; return; }
      streamKey = mine.streamKey || '';
    }
    const [, { rooms }] = await Promise.all([reload(), api('GET', '/api/rooms')]);
    roomsById = new Map(rooms.map((r) => [r.id, r]));
  } catch (err) {
    location.href = editingKey ? '/admin' : '/login?next=/profile';
    return;
  }
  document.title = `${document.title.split(' - ')[0]} - ${user.displayName}`;
  render();
  selectTab(location.hash.slice(1));
}
init();
