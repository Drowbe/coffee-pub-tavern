// The table: players see and hear each other.
import { Room, RoomEvent, Track, createLocalTracks } from '/lib/livekit-client.esm.mjs';
import { loadBranding, api } from '/brand.js';
import { hotkeyMatches, formatHotkey } from '/hotkeys.js';

// Elements by id, wherever the stage currently lives (the page or the pop-out
// window, which takes the whole stage with it).
const stageEl = document.getElementById('stage');
const $ = (id) => (id === 'stage' ? stageEl : document.getElementById(id) || stageEl.querySelector(`#${id}`));
const room = new Room({ adaptiveStream: true, dynacast: true });
const tiles = new Map(); // participant identity (user key) -> tile element
const ghostTiles = new Map(); // identity -> tile element, for room members aside elsewhere
const asideSelection = new Set(); // identities picked to pull aside together, before confirming
let me = null;
let tableName = 'The Table';
const tableUsers = new Map(); // key -> { displayName, borderColor, online, room, ... } from /api/table
let tableRooms = []; // the rooms, with `mine` for the ones I may join
let currentRoom = null; // the room I am in, once joined
const LOBBY = 'lobby';
let activeRoom = LOBBY; // the room the stream currently hears (server-computed)
let adminOnline = false; // whether that's actually backed by a real online admin right now

// A guest link (/guest/<token>): no account, just a name and this room. The
// token both identifies which room's guest link this is and, appended to
// our own reads below, is this tab's only credential -- there's no session.
const GUEST_PREFIX = 'guest-';
const guestToken = location.pathname.startsWith('/guest/') ? decodeURIComponent(location.pathname.split('/')[2] || '') : null;

// A picture URL for a slot, guest-aware: a guest identity (however many
// different guests are at the table) always shows the one shared guest
// picture set, and our own guest token (if we are the guest looking) rides
// along so the server recognises this tab without a session.
function imgUrl(key, slot, params = {}) {
  const isGuest = key.startsWith(GUEST_PREFIX);
  const urlKey = isGuest ? 'guest' : key;
  const urlSlot = isGuest && slot === 'profile' ? 'player' : slot;
  const q = new URLSearchParams(params);
  if (guestToken) q.set('guest', guestToken);
  const qs = q.toString();
  return `/img/${encodeURIComponent(urlKey)}/${urlSlot}${qs ? `?${qs}` : ''}`;
}

async function loadTable() {
  try {
    const { users, rooms, activeRoom: active, adminOnline: hasAdmin } = await api('GET', guestToken ? `/api/table?guest=${encodeURIComponent(guestToken)}` : '/api/table');
    tableUsers.clear();
    for (const u of users) tableUsers.set(u.key, u);
    tableRooms = rooms || [];
    activeRoom = active || LOBBY;
    adminOnline = Boolean(hasAdmin);
    for (const [key, tile] of tiles) {
      const colour = tableUsers.get(key)?.borderColor;
      if (colour) tile.style.setProperty('--talk', colour);
      updateBackgroundPlaceholder(tile, key);
    }
    renderRooms();
    reconcileGhostTiles();
    renderGuestLink();
    renderRoomLink();
  } catch (err) {
    // default colour stands
  }
}

// The room's own launch link, mirrored in the floatbar so it's reachable
// without leaving the call. Reads live off tableRooms (like renderGuestLink)
// rather than the frozen currentRoom, so an admin editing the link mid-call
// is reflected here on the next poll.
function renderRoomLink() {
  const btn = $('room-link');
  if (!btn || !currentRoom) return;
  const room = tableRooms.find((r) => r.id === currentRoom.id);
  const link = room?.link;
  btn.hidden = !link;
  if (link) btn.querySelector('.glyph').innerHTML = `<i class="fa-solid fa-${room.linkIcon || 'link'} fa-fw" aria-hidden="true"></i>`;
}
$('room-link').addEventListener('click', () => {
  const room = currentRoom && tableRooms.find((r) => r.id === currentRoom.id);
  if (room?.link) window.open(room.link, '_blank', 'noopener');
});

// A member of the room I'm in who is online but not actually connected
// here -- they're in a private aside elsewhere -- gets a placeholder tile:
// their picture stands in for video, dimmed, with who they stepped aside
// with, so they read as "still at the table" rather than looking like they
// hung up. Reconciled from the same polled /api/table data that already
// drives the join screen's badges, since a genuine LiveKit disconnect
// alone can't tell "went to a private aside" apart from "actually left".
function othersLabel(members, exclude) {
  const names = members.filter((k) => k !== exclude).map((k) => tableUsers.get(k)?.displayName).filter(Boolean);
  if (!names.length) return '';
  if (names.length === 1) return `with ${names[0]}`;
  return `with ${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

// The Aside/Private picture (their own, their room's, or the server-wide
// Default Images fallback) laid over their profile photo, same as OBS
// shows it over the Online/Offline picture -- a badge, not a replacement.
// Optional, so unlike the profile photo it simply stays hidden rather
// than falling back to anything when nothing resolves for that slot.
function setGhostBadge(img, key, slot) {
  img.hidden = true;
  img.onerror = () => { img.hidden = true; };
  img.onload = () => { img.hidden = false; };
  img.src = imgUrl(key, slot);
}

function ghostTile(key) {
  let tile = ghostTiles.get(key);
  if (tile) return tile;
  tile = document.createElement('div');
  tile.className = 'tile tile-ghost';
  tile.dataset.identity = key;
  const placeholder = document.createElement('img');
  placeholder.className = 'placeholder';
  placeholder.alt = '';
  placeholder.src = imgUrl(key, 'profile');
  tile.appendChild(placeholder);
  const badge = document.createElement('img');
  badge.className = 'tile-ghost-badge';
  badge.alt = '';
  badge.hidden = true;
  tile.appendChild(badge);
  const overlay = document.createElement('div');
  overlay.className = 'tile-ghost-overlay';
  const status = document.createElement('span');
  status.className = 'tile-ghost-status';
  status.textContent = 'In an aside';
  const withLine = document.createElement('span');
  withLine.className = 'tile-ghost-with';
  overlay.append(status, withLine);
  tile.appendChild(overlay);
  const name = document.createElement('span');
  name.className = 'name';
  tile.appendChild(name);
  ghostTiles.set(key, tile);
  placeInOrder(tile);
  return tile;
}

function removeGhost(key) {
  const tile = ghostTiles.get(key);
  if (!tile) return;
  tile.remove();
  ghostTiles.delete(key);
}

function reconcileGhostTiles() {
  if (!currentRoom || !document.body.classList.contains('at-table')) return;
  let changed = false;
  for (const key of currentRoom.members) {
    if (key === me?.key) continue;
    if (tiles.has(key)) {
      if (ghostTiles.has(key)) { removeGhost(key); changed = true; }
      continue;
    }
    const user = tableUsers.get(key);
    const asideRoom = user?.online && user.room && user.room !== currentRoom.id ? tableRooms.find((r) => r.id === user.room) : null;
    if (asideRoom?.ephemeral) {
      const tile = ghostTile(key);
      const isPrivate = Boolean(asideRoom.private);
      tile.classList.toggle('tile-ghost-private', isPrivate);
      setGhostBadge(tile.querySelector('.tile-ghost-badge'), key, isPrivate ? 'playerPrivate' : 'playerAside');
      tile.querySelector('.name').textContent = user.displayName;
      tile.querySelector('.tile-ghost-status').textContent = isPrivate ? 'In a private conversation' : 'In an aside';
      // Who a private word is with stays off the record here too, same as
      // it's kept off the OBS-facing recording -- everyone else at the
      // table only gets to know that it's happening, not with whom.
      tile.querySelector('.tile-ghost-with').textContent = isPrivate ? '' : othersLabel(asideRoom.members, key);
      changed = true;
    } else if (ghostTiles.has(key)) {
      removeGhost(key);
      changed = true;
    }
  }
  for (const key of [...ghostTiles.keys()]) {
    if (!currentRoom.members.includes(key)) { removeGhost(key); changed = true; }
  }
  if (changed) applyLayout();
}

// A room's name for display: ephemeral "pull aside" rooms carry no useful
// stored name, so build one from whoever else is in it.
function roomDisplayName(r) {
  if (!r?.ephemeral) return r?.name || tableName;
  const others = r.members.filter((k) => k !== me?.key).map((k) => tableUsers.get(k)?.displayName).filter(Boolean);
  // Says "Private" rather than "Aside" whenever it is one -- whoever's in
  // here should be able to tell at a glance that this one is genuinely off
  // the record, not just infer it from which button someone clicked earlier.
  const label = r.private ? 'Private' : 'Aside';
  return others.length ? `${label} with ${others.join(' & ')}` : label;
}

// The join screen: one card per room I belong to, with its members and a
// green dot on those in that room right now. Refreshed until I join.
function renderRooms() {
  const list = $('rooms');
  if (!list) return;
  const keep = new Set();
  for (const r of tableRooms.filter((x) => x.mine)) {
    keep.add(r.id);
    let card = list.querySelector(`[data-room="${CSS.escape(r.id)}"]`);
    if (!card) {
      card = document.getElementById('room-choice').content.firstElementChild.cloneNode(true);
      card.dataset.room = r.id;
      card.querySelector('[data-join]').dataset.join = r.id;
      list.appendChild(card);
    }
    card.classList.toggle('aside', Boolean(r.ephemeral));
    const edit = card.querySelector('[data-edit]');
    edit.hidden = r.ephemeral || me?.role !== 'admin';
    edit.href = `/rooms/${encodeURIComponent(r.id)}`;
    const link = card.querySelector('[data-link]');
    link.hidden = !r.link;
    if (r.link) {
      link.href = r.link;
      link.querySelector('i').className = `fa-solid fa-${r.linkIcon || 'link'} fa-fw`;
    }
    card.querySelector('.room-choice-name').textContent = roomDisplayName(r);
    card.querySelector('.room-choice-desc').textContent = r.description;
    card.querySelector('.room-choice-desc').hidden = !r.description || r.ephemeral;
    const img = card.querySelector('.room-choice-image');
    const src = !r.ephemeral && r.hasImage ? `/img/room/${encodeURIComponent(r.id)}` : '';
    img.hidden = !src;
    if (src && img.dataset.src !== src) {
      img.dataset.src = src;
      img.src = src;
    }
    const members = r.members.map((k) => tableUsers.get(k)).filter(Boolean);
    const here = members.filter((u) => u.online && u.room === r.id).length;
    card.querySelector('.room-choice-count').textContent = r.ephemeral ? '' : here ? `${here} of ${members.length} here now` : `${members.length} member${members.length === 1 ? '' : 's'}`;
    renderMembers(card.querySelector('.members'), members, r.id);
  }
  for (const card of [...list.children]) if (!keep.has(card.dataset.room)) card.remove();
}

function renderMembers(list, members, roomId) {
  const keep = new Set();
  for (const u of members) {
    keep.add(u.key);
    let el = list.querySelector(`[data-key="${CSS.escape(u.key)}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'member';
      el.dataset.key = u.key;
      const img = document.createElement('img');
      img.alt = '';
      img.src = imgUrl(u.key, 'profile');
      const dot = document.createElement('span');
      dot.className = 'dot';
      const name = document.createElement('span');
      name.className = 'member-name';
      el.append(img, dot, name);
      list.appendChild(el);
    }
    const here = Boolean(u.online) && u.room === roomId;
    el.querySelector('.member-name').textContent = u.displayName;
    el.querySelector('.dot').classList.toggle('online', here);
    el.classList.toggle('online', here);
    const elsewhere = u.online && !here ? tableRooms.find((r) => r.id === u.room) : null;
    el.title = here ? `${u.displayName} is here` : elsewhere ? `${u.displayName} is in ${roomDisplayName(elsewhere)}` : u.displayName;
    // Off stream: this member is online but not in the room the stream
    // currently hears (wherever the admin/GM actually is); "aside" is the
    // more specific case of a pulled-aside private word, which implies off
    // stream too. Only meaningful when an admin is actually online -- with
    // none, activeRoom is just the Lobby fallback, not a real "here's where
    // the stream is" signal, so nobody should read as off stream against it.
    const inAside = u.online && tableRooms.find((r) => r.id === u.room)?.ephemeral;
    const offStream = u.online && adminOnline && u.room !== activeRoom;
    let badge = el.querySelector('.stream-badge');
    if (inAside || offStream) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'stream-badge';
        el.appendChild(badge);
      }
      badge.textContent = inAside ? 'aside' : 'off stream';
      badge.classList.toggle('aside', Boolean(inAside));
    } else if (badge) {
      badge.remove();
    }
  }
  for (const el of [...list.children]) if (!keep.has(el.dataset.key)) el.remove();
}
setInterval(() => {
  if (!$('join').hidden || document.body.classList.contains('at-table')) loadTable();
}, 5000);
$('rooms').addEventListener('click', (event) => {
  const button = event.target.closest('[data-join]');
  if (button) join(button.dataset.join);
});
$('guest-join').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('guest-join-error').hidden = true;
  const name = $('guest-name').value.trim();
  if (!name) return;
  const submit = $('guest-join').querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const { token, livekitUrl, identity, roomId, roomName } = await api('POST', '/api/guest-join', { token: guestToken, name });
    me = { key: identity, displayName: name, role: 'guest' };
    await joinAsGuest(token, livekitUrl, roomId, roomName);
  } catch (err) {
    $('guest-join-error').textContent = err.message;
    $('guest-join-error').hidden = false;
  } finally {
    submit.disabled = false;
  }
});
let unread = 0;
let installPrompt = null;
let pipWindow = null;

function setStatus(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
  // The page header shows the same status, except the plain "in <room>"
  // which the room name next to the brand already says.
  const top = document.getElementById('topbar-status');
  top.textContent = !error && text === `in ${tableName}` ? '' : text;
  top.classList.toggle('error', error);
}

// --- tiles -------------------------------------------------------------------

// While the camera is off, a chosen background image (the same one used
// live when the camera is on -- see room.js's video settings) shows behind
// the profile photo too, instead of a plain fill, so the box looks like
// them even without video.
function updateBackgroundPlaceholder(tile, key) {
  const user = tableUsers.get(key);
  const hasBg = !!user?.images?.background;
  tile.classList.toggle('has-bg-image', hasBg);
  const bg = tile.querySelector('.placeholder-bg');
  // removeAttribute, not src='' -- an empty string still makes the browser
  // fetch the current page as an "image" and show a broken-image icon once
  // it fails to decode; only actually removing the attribute stays invisible.
  if (bg) { if (hasBg) bg.src = imgUrl(key, 'background'); else bg.removeAttribute('src'); }
  tile.style.setProperty('--pic-scale', user?.pictureScale || 100);
}

function tileFor(participant) {
  let tile = tiles.get(participant.identity);
  if (tile) return tile;
  removeGhost(participant.identity); // they're back live, the placeholder can go
  tile = document.createElement('div');
  tile.className = 'tile';
  tile.dataset.identity = participant.identity;
  const placeholderBg = document.createElement('img');
  placeholderBg.className = 'placeholder-bg';
  placeholderBg.alt = '';
  tile.appendChild(placeholderBg);
  const placeholder = document.createElement('img');
  placeholder.className = 'placeholder';
  placeholder.alt = '';
  placeholder.src = imgUrl(participant.identity, 'profile');
  const colour = tableUsers.get(participant.identity)?.borderColor;
  if (colour) tile.style.setProperty('--talk', colour);
  tile.appendChild(placeholder);
  updateBackgroundPlaceholder(tile, participant.identity);
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = participant.name || participant.identity;
  tile.appendChild(name);
  if (!participant.isLocal) {
    const vol = document.createElement('input');
    vol.type = 'range';
    vol.className = 'vol';
    vol.min = '0';
    vol.max = '100';
    vol.value = String(Math.round((prefs.volumes[participant.identity] ?? 1) * 100));
    vol.title = 'Volume';
    vol.addEventListener('input', () => setVolume(participant, Number(vol.value) / 100));
    vol.addEventListener('click', (e) => e.stopPropagation());
    vol.addEventListener('pointerenter', () => (tile.draggable = false));
    vol.addEventListener('pointerleave', () => (tile.draggable = true));
    tile.appendChild(vol);
    if (!currentRoom?.ephemeral) {
      const aside = document.createElement('button');
      aside.type = 'button';
      aside.className = 'tile-aside';
      aside.title = me?.role === 'admin'
        ? `Step aside with ${participant.name || participant.identity} (pick one or more, then confirm)`
        : `Have a private word with ${participant.name || participant.identity} (pick one or more, then confirm)`;
      aside.innerHTML = '<i class="fa-solid fa-people-arrows" aria-hidden="true"></i>';
      aside.classList.toggle('selected', asideSelection.has(participant.identity));
      aside.addEventListener('click', (e) => { e.stopPropagation(); toggleAsideSelection(participant.identity, aside); });
      tile.appendChild(aside);
    }
  }
  tile.draggable = true;
  tile.addEventListener('dragstart', onDragStart);
  tile.addEventListener('dragover', onDragOver);
  tile.addEventListener('drop', onDrop);
  tile.addEventListener('dragend', onDragEnd);
  tile.addEventListener('click', () => spotlight(participant.identity));
  tiles.set(participant.identity, tile);
  placeInOrder(tile);
  applyLayout();
  return tile;
}

// A shared screen gets its own tile, separate from the sharer's camera one
// -- someone can keep their camera up while sharing, and both stay visible.
function screenTileId(identity) {
  return `${identity}::screen`;
}
function screenTileFor(participant) {
  const key = screenTileId(participant.identity);
  let tile = tiles.get(key);
  if (tile) return tile;
  tile = document.createElement('div');
  tile.className = 'tile tile-screen';
  tile.dataset.identity = key;
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = `${participant.name || participant.identity}'s screen`;
  tile.appendChild(name);
  if (document.pictureInPictureEnabled) {
    const pip = document.createElement('button');
    pip.type = 'button';
    pip.className = 'tile-pip';
    pip.title = 'Pop out this screen share';
    pip.innerHTML = '<i class="fa-solid fa-up-right-from-square" aria-hidden="true"></i>';
    pip.addEventListener('click', (e) => {
      e.stopPropagation();
      const video = tile.querySelector('video');
      if (!video) return;
      (document.pictureInPictureElement === video ? document.exitPictureInPicture() : video.requestPictureInPicture()).catch(() => {});
    });
    tile.appendChild(pip);
  }
  tile.addEventListener('click', () => spotlight(key));
  tiles.set(key, tile);
  $('grid').appendChild(tile);
  applyLayout();
  return tile;
}
function removeScreenTile(identity) {
  const key = screenTileId(identity);
  const tile = tiles.get(key);
  if (!tile) return;
  if (document.pictureInPictureElement && tile.contains(document.pictureInPictureElement)) {
    document.exitPictureInPicture().catch(() => {});
  }
  tile.remove();
  tiles.delete(key);
  applyLayout();
}

// --- layouts and ordering -----------------------------------------------------

const DEFAULT_PREFS = {
  layout: 'grid', order: [], pinned: null, follow: true,
  micId: '', camId: '', gain: 100, gate: 0, noise: true, echo: true, agc: true, ptt: false,
  quality: 720, mirror: true, background: 'none', volumes: {}, popout: null, deafened: false,
  chatWidth: 320, speakerId: '', masterVolume: 100,
  pttKey: 'Space', muteKey: 'Mod+KeyD', camKey: 'Mod+KeyE',
};
const prefs = loadPrefs();

function loadPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem('tavern.table') || '{}') };
  } catch (err) {
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs() {
  try {
    localStorage.setItem('tavern.table', JSON.stringify(prefs));
  } catch (err) {
    // private mode or storage off: the session still works
  }
}

// The mic/camera processing fields (not device selection) also live on the
// account -- see populateCallSettingsUI -- so a change here follows to the
// profile page and to wherever else this account joins from. A guest has no
// account to save it to; localStorage above is all they get. Debounced and
// accumulated across fields so dragging a slider doesn't fire a request per
// tick.
let pendingCallPrefs = {};
let callPrefsTimer = 0;
function syncCallPrefs(patch) {
  if (guestToken) return;
  Object.assign(pendingCallPrefs, patch);
  clearTimeout(callPrefsTimer);
  callPrefsTimer = setTimeout(async () => {
    const body = pendingCallPrefs;
    pendingCallPrefs = {};
    try {
      await api('PATCH', '/api/me/call-prefs', body);
    } catch (err) {
      // best-effort: the local change already applied, this just fails to follow the account
    }
  }, 500);
}

// Insert a tile where the remembered order says; unknown ones go last.
function placeInOrder(tile) {
  const rank = (el) => {
    const i = prefs.order.indexOf(el.dataset.identity);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const siblings = [...$('grid').querySelectorAll('.tile')];
  const next = siblings.find((el) => rank(el) > rank(tile));
  if (next) next.parentNode.insertBefore(tile, next);
  else ($('grid').querySelector('.rest') || $('grid')).appendChild(tile);
}

function rememberOrder() {
  const order = [...$('grid').querySelectorAll('.tile')].map((el) => el.dataset.identity);
  // In spotlight the big tile sits apart from the row; keep its remembered place.
  const spot = $('grid').querySelector('.tile.spot');
  if (spot && prefs.layout === 'spotlight') {
    const id = spot.dataset.identity;
    const previous = prefs.order.indexOf(id);
    order.splice(order.indexOf(id), 1);
    order.splice(previous < 0 ? order.length : Math.min(previous, order.length), 0, id);
  }
  prefs.order = order;
  savePrefs();
}

const LAYOUTS = ['grid', 'strip', 'spotlight'];
// Same icon on the floatbar's own layout button as its matching picker
// button, so the button always shows the view you're actually in.
const LAYOUT_ICONS = { grid: 'fa-solid fa-table-cells-large', strip: 'fa-solid fa-grip', spotlight: 'fa-regular fa-square' };

function syncLayoutPick() {
  for (const b of $('layout-pick').children) b.classList.toggle('selected', b.dataset.layout === prefs.layout);
  $('layout-glyph').className = `${LAYOUT_ICONS[prefs.layout]} fa-fw`;
}

function setLayout(layout, announce = false) {
  prefs.layout = LAYOUTS.includes(layout) ? layout : 'grid';
  savePrefs();
  syncLayoutPick();
  applyLayout();
}

function applyLayout() {
  const grid = $('grid');
  grid.dataset.layout = prefs.layout;
  const portrait = grid.clientHeight > grid.clientWidth;
  grid.classList.toggle('portrait', portrait);
  const stage = $('stage');
  stage.classList.toggle('compact', stage.clientWidth < 460);
  stage.classList.toggle('tiny', stage.clientWidth < 300 || stage.clientHeight < 220);
  const ordered = [...grid.querySelectorAll('.tile')];
  let rest = grid.querySelector('.rest');
  if (prefs.layout === 'spotlight' && ordered.length > 1) {
    // remember where every tile sits before the big one is pulled out
    let changed = false;
    for (const tile of ordered) {
      if (!prefs.order.includes(tile.dataset.identity)) {
        prefs.order.push(tile.dataset.identity);
        changed = true;
      }
    }
    if (changed) savePrefs();
    const wanted = (prefs.pinned && tiles.get(prefs.pinned)) || (prefs.follow && speaker && tiles.get(speaker)) || ordered[0];
    if (!rest) {
      rest = document.createElement('div');
      rest.className = 'rest';
    }
    // the big tile stays a direct child; the others share a row underneath
    for (const tile of ordered) {
      const isSpot = tile === wanted;
      tile.classList.toggle('spot', isSpot);
      if (isSpot && tile.parentNode !== grid) grid.appendChild(tile);
      else if (!isSpot && tile.parentNode !== rest) rest.appendChild(tile);
    }
    if (rest.parentNode !== grid) grid.appendChild(rest);
  } else {
    for (const tile of ordered) {
      tile.classList.remove('spot');
      if (tile.parentNode !== grid) grid.appendChild(tile);
    }
    if (rest) rest.remove();
  }
  fitTiles(grid, portrait);
}

// Size the tiles so all of them fit the grid area at 16:9, whatever the
// window shape. Sizes go into CSS variables the layouts read.
const RATIO = 16 / 9;
const GAP = 10;
function fitTiles(grid, portrait) {
  // Ghost tiles (members stepped into an aside) are real .tile elements in
  // the grid too -- size for all of them, or the ones left out get the
  // sizing meant for a smaller crowd and spill past the grid's own edges.
  const n = tiles.size + ghostTiles.size;
  const style = getComputedStyle(grid);
  const W = grid.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const H = grid.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  if (n === 0 || W <= 0 || H <= 0) return;
  let w = 0;
  let h = 0;
  let sw = 0;
  let sh = 0;
  if (prefs.layout === 'strip') {
    if (portrait) {
      w = Math.min(W, ((H - GAP * (n - 1)) / n) * RATIO);
      h = w / RATIO;
    } else {
      h = Math.min(H, (W - GAP * (n - 1)) / n / RATIO);
      w = h * RATIO;
    }
  } else if (prefs.layout === 'spotlight' && n > 1) {
    sh = Math.max(64, Math.min(160, H * 0.22));
    sw = Math.min(sh * RATIO, (W - GAP * (n - 2)) / (n - 1));
    sh = sw / RATIO;
    h = H - sh - GAP;
    w = Math.min(W, h * RATIO);
    h = w / RATIO;
  } else {
    // grid (and a spotlight of one): the column count that gives the biggest tiles
    for (let cols = 1; cols <= n; cols += 1) {
      const rows = Math.ceil(n / cols);
      let tw = (W - GAP * (cols - 1)) / cols;
      let th = tw / RATIO;
      if (th * rows + GAP * (rows - 1) > H) {
        th = (H - GAP * (rows - 1)) / rows;
        tw = th * RATIO;
      }
      if (tw > w) {
        w = tw;
        h = th;
      }
    }
  }
  grid.style.setProperty('--tw', `${Math.floor(w)}px`);
  grid.style.setProperty('--th', `${Math.floor(h)}px`);
  grid.style.setProperty('--sw', `${Math.floor(sw)}px`);
  grid.style.setProperty('--sh', `${Math.floor(sh)}px`);
}

// Refit whenever the grid area changes (window resize, chat drawer, pop out).
const refit = new ResizeObserver(() => applyLayout());
refit.observe($('grid'));

// Click a tile: pin it as the spotlight (click again to unpin).
function spotlight(identity) {
  if (dragging || justDragged) return;
  prefs.pinned = prefs.pinned === identity ? null : identity;
  if (prefs.layout !== 'spotlight') prefs.layout = 'spotlight';
  savePrefs();
  syncLayoutPick();
  applyLayout();
}

let speaker = null;
let dragging = null;
let justDragged = false;

function onDragStart(event) {
  dragging = event.currentTarget;
  dragging.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  try {
    event.dataTransfer.setData('text/plain', dragging.dataset.identity);
  } catch (err) {
    // some browsers refuse setData in synthetic events
  }
}

function onDragOver(event) {
  if (!dragging) return;
  event.preventDefault();
  const over = event.currentTarget;
  if (over === dragging) return;
  // in spotlight only the small row reorders; the big tile stays put
  if (prefs.layout === 'spotlight' && (over.classList.contains('spot') || dragging.classList.contains('spot'))) return;
  const box = over.getBoundingClientRect();
  const horizontal = box.width >= box.height || $('grid').dataset.layout !== 'strip';
  const before = horizontal ? event.clientX < box.left + box.width / 2 : event.clientY < box.top + box.height / 2;
  over.parentNode.insertBefore(dragging, before ? over : over.nextSibling);
}

function onDrop(event) {
  event.preventDefault();
  rememberOrder();
}

function onDragEnd() {
  if (dragging) dragging.classList.remove('dragging');
  dragging = null;
  rememberOrder();
  // a click can follow the drop; keep it from toggling the spotlight
  justDragged = true;
  setTimeout(() => (justDragged = false), 200);
}

function attachTrack(participant, track) {
  if (track.kind === Track.Kind.Video && track.source === Track.Source.ScreenShare) {
    const screenTile = screenTileFor(participant);
    screenTile.querySelector('video')?.remove();
    const video = track.attach();
    video.muted = true;
    screenTile.prepend(video);
    return;
  }
  const tile = tileFor(participant);
  if (track.kind === Track.Kind.Video) {
    tile.querySelector('video')?.remove();
    const video = track.attach();
    video.muted = true; // audio comes through its own element
    tile.prepend(video);
    // placeholder-bg sits later in the tile than the just-prepended video,
    // so it paints on top and hides live video behind whoever's custom
    // background picture unless it's hidden here too -- updateCamera()
    // already knew to do both, but this is the only path a remote viewer's
    // very first subscribe to someone's camera ever goes through.
    tile.querySelector('.placeholder').hidden = true;
    tile.querySelector('.placeholder-bg').hidden = true;
  } else if (track.kind === Track.Kind.Audio) {
    if (participant.isLocal) return; // never play your own voice back
    const audio = track.attach();
    audio.dataset.identity = participant.identity;
    audio.muted = prefs.deafened;
    if (prefs.speakerId && audio.setSinkId) audio.setSinkId(prefs.speakerId).catch(() => {});
    $('stage').appendChild(audio);
    track.setVolume(effectiveVolume(participant.identity));
  }
}

function detachTrack(participant, track) {
  track.detach().forEach((el) => el.remove());
  if (track.kind === Track.Kind.Video && track.source === Track.Source.ScreenShare) {
    removeScreenTile(participant.identity);
    return;
  }
  const tile = tiles.get(participant.identity);
  if (tile && track.kind === Track.Kind.Video) {
    tile.querySelector('.placeholder').hidden = false;
    tile.querySelector('.placeholder-bg').hidden = false;
  }
}

function removeParticipant(participant) {
  const tile = tiles.get(participant.identity);
  if (tile) tile.remove();
  tiles.delete(participant.identity);
  removeScreenTile(participant.identity);
  if (asideSelection.delete(participant.identity)) updateAsideConfirm();
  stageDoc().querySelectorAll(`audio[data-identity="${CSS.escape(participant.identity)}"]`).forEach((el) => el.remove());
  reconcileGhostTiles(); // they may have just stepped into a private aside, not actually left
  applyLayout();
}

function updateMuted(participant) {
  const tile = tileFor(participant);
  const mic = participant.getTrackPublication(Track.Source.Microphone);
  let badge = tile.querySelector('.muted');
  const muted = !mic || mic.isMuted;
  if (muted && !badge) {
    badge = document.createElement('span');
    badge.className = 'muted';
    badge.textContent = 'muted';
    tile.appendChild(badge);
  } else if (!muted && badge) {
    badge.remove();
  }
}

// A camera turned off keeps its publication but mutes it: show the image again.
function updateCamera(participant) {
  const tile = tileFor(participant);
  const cam = participant.getTrackPublication(Track.Source.Camera);
  const off = !cam || cam.isMuted;
  const video = tile.querySelector('video');
  if (video) video.hidden = off;
  // Not gated on the <video> element already existing: attachTrack() hides
  // these the moment it runs regardless, and if this fires first there's
  // nothing to gain by leaving them showing for however long that takes --
  // an empty tile reads better than the wrong picture stuck on top of live video.
  tile.querySelector('.placeholder').hidden = !off;
  tile.querySelector('.placeholder-bg').hidden = !off;
}

// The document the stage currently lives in (the page, or the pop-out window).
function stageDoc() {
  return $('stage').ownerDocument;
}

// --- chat ---------------------------------------------------------------------

// Text and pictures travel over LiveKit's data channel; nothing is stored.
// The log lives here for Save and for late reads; it goes when you leave.
const chatLog = []; // { who, at, text } or { who, at, blob, name }

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// A little markup: `code`, **bold**, *italic* or _italic_, bare links, line breaks.
function renderMarkup(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  html = html.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)"'])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
  html = html.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
  return html.replace(/\n/g, '<br>');
}

function iconButton(icon, title, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'msg-btn';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = `<i class="fa-solid fa-${icon} fa-fw" aria-hidden="true"></i>`;
  b.addEventListener('click', onClick);
  return b;
}

function flashIcon(btn, icon) {
  const i = btn.querySelector('i');
  const was = i.className;
  i.className = `fa-solid fa-${icon} fa-fw`;
  setTimeout(() => (i.className = was), 1200);
}

function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name || 'picture.png';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function toPng(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close();
  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}

async function copyEntry(entry, btn) {
  try {
    if (entry.blob) {
      const png = entry.blob.type === 'image/png' ? entry.blob : await toPng(entry.blob);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    } else {
      await navigator.clipboard.writeText(entry.text);
    }
    flashIcon(btn, 'check');
  } catch (err) {
    setStatus(`copy: ${err.message}`, true);
  }
}

function messageEl(entry, own) {
  const el = document.createElement('div');
  el.className = `message${own ? ' own' : ''}`;
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = entry.who;
  const body = document.createElement('span');
  body.className = 'text';
  if (entry.blob) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(entry.blob);
    img.alt = entry.name || 'picture';
    img.title = 'Open full size';
    img.addEventListener('click', () => window.open(img.src, '_blank'));
    body.appendChild(img);
  } else {
    body.innerHTML = renderMarkup(entry.text);
  }
  const actions = document.createElement('span');
  actions.className = 'actions';
  const copyBtn = iconButton('copy', entry.blob ? 'Copy picture' : 'Copy text', () => copyEntry(entry, copyBtn));
  actions.appendChild(copyBtn);
  if (entry.blob) actions.appendChild(iconButton('download', 'Save picture', () => saveBlob(entry.blob, entry.name)));
  el.append(who, body, actions);
  return el;
}

function addEntry(entry, own = false) {
  entry.at = new Date();
  chatLog.push(entry);
  $('messages').appendChild(messageEl(entry, own));
  $('messages').scrollTop = $('messages').scrollHeight;
  if ($('chat').hidden && !own) {
    unread += 1;
    $('chat-badge').textContent = String(unread);
    $('chat-badge').hidden = false;
  }
}

function addMessage(message, from, own = false) {
  addEntry({ who: from, text: message }, own);
}

function saveChat() {
  if (!chatLog.length) return;
  const lines = chatLog.map((e) => `[${e.at.toLocaleTimeString()}] ${e.who}: ${e.blob ? `[picture${e.name ? ' ' + e.name : ''}]` : e.text}`);
  saveBlob(new Blob([lines.join('\n') + '\n'], { type: 'text/plain' }), `${tableName.replace(/[^\w-]+/g, '-').toLowerCase()}-chat-${new Date().toISOString().slice(0, 10)}.txt`);
}

// Pictures: pasted, dropped or picked, shrunk to a sensible size, then sent
// as a LiveKit byte stream on topic "chat-image" (no server involved).
const MAX_IMAGE_SIDE = 1600;
async function shrinkImage(file) {
  const bmp = await createImageBitmap(file);
  const keep = file.size <= 1.5e6 && Math.max(bmp.width, bmp.height) <= MAX_IMAGE_SIDE && /^image\/(png|jpeg|gif|webp)$/.test(file.type);
  if (keep) {
    bmp.close();
    return file;
  }
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.85));
  return new File([blob], `${(file.name || 'picture').replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' });
}

async function sendImage(file) {
  if (!file || !file.type.startsWith('image/') || room.state !== 'connected') return;
  try {
    const out = await shrinkImage(file);
    addEntry({ who: room.localParticipant.name || room.localParticipant.identity, blob: out, name: out.name }, true);
    await room.localParticipant.sendFile(out, { topic: 'chat-image', mimeType: out.type });
  } catch (err) {
    setStatus(`picture: ${err.message}`, true);
  }
}

room.registerByteStreamHandler('chat-image', async (reader, { identity }) => {
  try {
    const chunks = await reader.readAll();
    const blob = new Blob(chunks, { type: reader.info.mimeType || 'image/png' });
    const from = room.remoteParticipants.get(identity);
    addEntry({ who: from?.name || identity, blob, name: reader.info.name }, false);
  } catch (err) {
    setStatus(`picture: ${err.message}`, true);
  }
});

function imageFiles(list) {
  return [...(list || [])].filter((f) => f && f.type && f.type.startsWith('image/'));
}

// --- reactions ------------------------------------------------------------------
// A reaction travels over the data channel (topic "reaction"), like chat but
// never stored: every table page and every OBS view page of that player
// floats it up from their tile for a couple of seconds.

// The reaction tray, as the admin has set it up (Manage > Settings); keys 1
// to 6 reach only the first six, however many are configured.
let REACTIONS = {}; // id -> glyph
let REACTION_KEYS = []; // id, in tray order
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function renderReactionTray(list) {
  const reactions = Array.isArray(list) ? list : [];
  REACTIONS = Object.fromEntries(reactions.map((r) => [r.id, r.glyph]));
  REACTION_KEYS = reactions.map((r) => r.id);
  const tray = $('react-tray');
  tray.textContent = '';
  reactions.forEach((r, i) => {
    const button = document.createElement('button');
    button.className = 'react';
    button.type = 'button';
    button.dataset.reaction = r.id;
    button.title = i < 6 ? `${r.label} (${i + 1})` : r.label;
    button.textContent = r.glyph;
    tray.appendChild(button);
  });
}

function showReaction(identity, id) {
  const glyph = REACTIONS[id];
  const tile = tiles.get(identity);
  if (!glyph || !tile) return;
  const el = tile.ownerDocument.createElement('span');
  el.className = 'reaction';
  el.textContent = glyph;
  el.style.left = `${20 + Math.random() * 60}%`;
  el.addEventListener('animationend', () => el.remove());
  setTimeout(() => el.remove(), 3000); // a hidden tab never fires animationend
  tile.appendChild(el);
}

async function sendReaction(id) {
  if (!REACTIONS[id] || room.state !== 'connected') return;
  showReaction(room.localParticipant.identity, id); // data is not echoed back
  try {
    await room.localParticipant.publishData(encoder.encode(JSON.stringify({ type: 'reaction', id })), { reliable: true, topic: 'reaction' });
  } catch (err) {
    setStatus(`reaction: ${err.message}`, true);
  }
}

function toggleTray(open = $('react-tray').hidden) {
  $('react-tray').hidden = !open;
  $('react-toggle').classList.toggle('on', open);
  if (open) closeSettings();
}

// The settings popover shows one focused group at a time: mic, audio
// (speaker + volume), camera, layout, or "more" (everything else -- guests,
// install, account links) for the gear. Each of mic/audio/camera/layout's
// own caret opens straight to its group; clicking the same one again (or
// anywhere outside) closes it, same as any dropdown.
function closeSettings() {
  $('settings').hidden = true;
  for (const b of stageDoc().querySelectorAll('[data-settings]')) b.classList.remove('on');
}
function openSettings(group) {
  const trigger = stageDoc().querySelector(`[data-settings="${group}"]`);
  if (!$('settings').hidden && $('settings').dataset.group === group) {
    closeSettings();
    return;
  }
  for (const el of stageDoc().querySelectorAll('.settings-group')) el.hidden = el.dataset.group !== group;
  $('settings').dataset.group = group;
  $('settings').hidden = false;
  for (const b of stageDoc().querySelectorAll('[data-settings]')) b.classList.remove('on');
  if (trigger) trigger.classList.add('on');
  toggleTray(false);
}

// The chat's own width, dragged from its left edge (see the chat-resize
// listeners below) and remembered like any other preference. --chat-w lives
// on the stage so both the chat panel and the popped-out floatbar (which
// keeps clear of the chat) can read it.
const CHAT_MIN_WIDTH = 240;
// remember: false for applying the stored width on join, where the stage may
// not be laid out to its real size yet -- a clamp there shouldn't overwrite
// what the user actually asked for.
function setChatWidth(px, { remember = true } = {}) {
  const max = Math.max(CHAT_MIN_WIDTH, Math.round($('stage').clientWidth * 0.7));
  const clamped = Math.min(Math.max(Math.round(px), CHAT_MIN_WIDTH), max);
  $('stage').style.setProperty('--chat-w', `${clamped}px`);
  if (remember) prefs.chatWidth = clamped;
  return clamped;
}

function toggleChat(open = $('chat').hidden) {
  $('chat').hidden = !open;
  $('stage').classList.toggle('chat-open', open);
  applyLayout();
  $('chat-toggle').classList.toggle('on', open);
  if (open) {
    unread = 0;
    $('chat-badge').hidden = true;
    $('chat-input').focus();
    $('messages').scrollTop = $('messages').scrollHeight;
  }
}

// --- microphone: device -> level -> gate -> what the table hears -----------
//
// The mic is processed in the page before it is published, so the level
// slider and the noise gate work in every browser and the meter shows what
// others actually receive. Changing device or filters swaps the input; the
// published track stays the same.

const mic = { ctx: null, raw: null, source: null, level: null, gate: null, analyser: null, timer: 0, dest: null, track: null, open: true, shown: 0, bypass: false };
let pttHeld = false;

function micConstraints() {
  const c = { noiseSuppression: prefs.noise, echoCancellation: prefs.echo, autoGainControl: prefs.agc };
  if (prefs.micId) c.deviceId = { exact: prefs.micId };
  return c;
}

async function buildMicGraph() {
  mic.ctx = new AudioContext();
  mic.level = mic.ctx.createGain();
  mic.dest = mic.ctx.createMediaStreamDestination();
  try {
    // The gate lives on the audio thread (see gate-worklet.js), so it keeps
    // working when the tab is hidden and page timers are throttled.
    await mic.ctx.audioWorklet.addModule('/gate-worklet.js');
    mic.gate = new AudioWorkletNode(mic.ctx, 'tavern-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    mic.gate.port.onmessage = (event) => onMicLevel(event.data);
    mic.level.connect(mic.gate);
    mic.gate.connect(mic.dest);
  } catch (err) {
    console.warn('[tavern] no audio worklet, gate off:', err.message);
    mic.gate = null;
    mic.analyser = mic.ctx.createAnalyser();
    mic.analyser.fftSize = 512;
    mic.level.connect(mic.analyser);
    mic.level.connect(mic.dest);
    mic.timer = setInterval(meterFromAnalyser, 50);
  }
  mic.track = mic.dest.stream.getAudioTracks()[0];
}

async function openMic() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints() });
  } catch (err) {
    if (!prefs.micId) throw err;
    prefs.micId = ''; // the remembered device is gone
    savePrefs();
    stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints() });
  }
  const raw = stream.getAudioTracks()[0];
  if (!mic.ctx) await buildMicGraph();
  if (mic.source) mic.source.disconnect();
  if (mic.raw) mic.raw.stop();
  mic.raw = raw;
  mic.source = mic.ctx.createMediaStreamSource(new MediaStream([raw]));
  mic.source.connect(mic.level);
  applyMicSettings();
  await mic.ctx.resume();
  if (mic.ctx.state !== 'running') {
    // No audio output device or the browser refused to start the graph:
    // publish the microphone as it is, without level and gate.
    console.warn('[tavern] audio graph not running; publishing the raw microphone');
    mic.bypass = true;
    return raw;
  }
  return mic.track;
}

function closeMic() {
  if (mic.raw) mic.raw.stop();
  if (mic.source) mic.source.disconnect();
  mic.raw = null;
  mic.source = null;
  mic.shown = 0;
  $('meter').style.setProperty('--level', '0');
}

function applyMicSettings() {
  if (!mic.ctx) return;
  mic.level.gain.setTargetAtTime(prefs.gain / 100, mic.ctx.currentTime, 0.02);
  // slider 0..60 maps to a quiet-to-loud rms range
  if (mic.gate) mic.gate.parameters.get('threshold').value = prefs.gate / 100 / 4;
  $('gain-value').textContent = `${prefs.gain}%`;
  $('gate-value').textContent = !mic.gate && mic.ctx ? 'unavailable' : prefs.gate ? `${prefs.gate}` : 'off';
}

// Level and gate state from the audio thread: peak hold with a quick decay
// reads better than raw samples.
function onMicLevel({ level, open }) {
  mic.shown = Math.max(Math.min(1, level * 4), mic.shown * 0.85);
  $('meter').style.setProperty('--level', mic.shown.toFixed(2));
  if (open !== mic.open) {
    mic.open = open;
    $('mic').classList.toggle('gated', !open);
  }
}

const samples = new Float32Array(512);
function meterFromAnalyser() {
  if (!mic.analyser) return;
  mic.analyser.getFloatTimeDomainData(samples);
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  onMicLevel({ level: Math.sqrt(sum / samples.length), open: true });
}

// The master volume (Settings > Audio output) multiplies every remote
// participant's own volume (set by hovering their tile) rather than
// replacing it, so both stay independently adjustable.
function effectiveVolume(identity) {
  return (prefs.masterVolume / 100) * (prefs.volumes[identity] ?? 1);
}

function setVolume(participant, volume) {
  prefs.volumes[participant.identity] = volume;
  savePrefs();
  const pub = participant.getTrackPublication(Track.Source.Microphone);
  if (pub?.track?.setVolume) pub.track.setVolume(effectiveVolume(participant.identity));
}

function applyMasterVolume() {
  for (const p of room.remoteParticipants.values()) {
    const pub = p.getTrackPublication(Track.Source.Microphone);
    if (pub?.track?.setVolume) pub.track.setVolume(effectiveVolume(p.identity));
  }
}

// The output device every remote participant's audio plays through.
async function applySpeaker() {
  if (!prefs.speakerId) return;
  for (const audio of stageDoc().querySelectorAll('audio')) {
    if (audio.setSinkId) await audio.setSinkId(prefs.speakerId).catch(() => {});
  }
}

const RESOLUTIONS = { 360: { width: 640, height: 360 }, 540: { width: 960, height: 540 }, 720: { width: 1280, height: 720 } };
function videoConstraints() {
  const c = { resolution: RESOLUTIONS[prefs.quality] || RESOLUTIONS[720] };
  if (prefs.camId) c.deviceId = { exact: prefs.camId };
  return c;
}

async function setPushToTalk(on) {
  prefs.ptt = on;
  savePrefs();
  pttHeld = false;
  $('mic').title = on ? `Push to talk: hold ${formatHotkey(prefs.pttKey)} (M toggles)` : 'Microphone (M)';
  if (on && room.state === 'connected') await room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
  reflectMic();
}

function reflectMic() {
  const on = room.localParticipant?.isMicrophoneEnabled;
  $('mic').classList.toggle('on', !!on);
  $('mic').classList.toggle('off', !on);
  $('mic').classList.toggle('ptt', prefs.ptt);
  if (room.state === 'connected') updateMuted(room.localParticipant);
}

// --- room events --------------------------------------------------------------

room
  .on(RoomEvent.TrackSubscribed, (track, _pub, participant) => attachTrack(participant, track))
  .on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => detachTrack(participant, track))
  .on(RoomEvent.LocalTrackPublished, (pub) => pub.track && attachTrack(room.localParticipant, pub.track))
  .on(RoomEvent.LocalTrackUnpublished, (pub) => pub.track && detachTrack(room.localParticipant, pub.track))
  .on(RoomEvent.ParticipantConnected, (p) => tileFor(p))
  .on(RoomEvent.ParticipantDisconnected, removeParticipant)
  .on(RoomEvent.TrackMuted, (_pub, participant) => {
    updateMuted(participant);
    updateCamera(participant);
  })
  .on(RoomEvent.TrackUnmuted, (_pub, participant) => {
    updateMuted(participant);
    updateCamera(participant);
  })
  .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
    const active = new Set(speakers.map((s) => s.identity));
    for (const [identity, tile] of tiles) tile.classList.toggle('speaking', active.has(identity));
    const loudest = speakers.find((s) => !s.isLocal) || speakers[0];
    if (loudest && loudest.identity !== speaker) {
      speaker = loudest.identity;
      if (prefs.layout === 'spotlight' && !prefs.pinned && prefs.follow) applyLayout();
    }
  })
  .on(RoomEvent.ChatMessage, (message, participant) => {
    addMessage(message.message, participant?.name || participant?.identity || 'someone', participant?.isLocal);
  })
  .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
    try {
      const data = JSON.parse(decoder.decode(payload));
      if (topic === 'reaction' && participant && data.type === 'reaction') showReaction(participant.identity, data.id);
      else if (topic === 'away' && participant && data.type === 'away') updateAwayOverlay(participant.identity, !!data.on);
      // A server push (no sending participant): the admin pulled me aside.
      // Deferred a tick so this event's own dispatch finishes first.
      else if (topic === 'pull-aside' && data.type === 'pull-aside' && data.roomId) {
        setTimeout(() => reconnectTo(data.roomId, 'pulled aside...'), 0);
      }
      // The other member of a pull-aside room clicked "Back to the table";
      // follow them there instead of being left behind.
      else if (topic === 'return-to-table' && data.type === 'return-to-table' && data.roomId) {
        setTimeout(() => reconnectTo(data.roomId, 'back to the table...'), 0);
      }
      // Someone just got pulled into a private aside, myself excluded: prime
      // the local data so their tile can turn into an "in an aside"
      // placeholder right away, without waiting for the next /api/table poll.
      else if (topic === 'aside-started' && data.type === 'aside-started' && data.roomId && Array.isArray(data.members)) {
        if (!tableRooms.some((r) => r.id === data.roomId)) tableRooms.push({ id: data.roomId, name: 'Aside', members: data.members, ephemeral: true });
        for (const key of data.members) {
          const user = tableUsers.get(key);
          if (user) { user.online = true; user.room = data.roomId; }
        }
        reconcileGhostTiles();
      }
    } catch (err) {
      // not ours
    }
  })
  .on(RoomEvent.Reconnecting, () => setStatus('reconnecting...'))
  .on(RoomEvent.Reconnected, () => setStatus(`in ${tableName}`))
  .on(RoomEvent.Disconnected, () => {
    closeMic();
    closePopout();
    setStatus('left the call');
    currentRoom = null;
    document.body.classList.remove('at-table');
    $('stage').hidden = true;
    $('room-link').hidden = true;
    // A guest has no session and no room to pick from -- back to their own
    // name-only form for the one room their link is for, not the real
    // members' room list (which they can't do anything with anyway).
    $('join').hidden = !!guestToken;
    $('guest-join').hidden = !guestToken;
    $('away').hidden = true;
    $('room-now').hidden = true;
    $('leave-top').hidden = true;
    $('back-to-table').hidden = true;
    asideSelection.clear();
    updateAsideConfirm();
    for (const [, tile] of tiles) tile.remove();
    tiles.clear();
    for (const [, tile] of ghostTiles) tile.remove();
    ghostTiles.clear();
    stageDoc().querySelectorAll('audio').forEach((el) => el.remove());
    $('messages').textContent = '';
    toggleChat(false);
    toggleTray(false);
    loadTable();
  });

async function fillDevices() {
  // Do not let the device list ask for permissions again: a denied camera
  // would throw here and drop an audio-only player out of the table.
  let devices = [];
  try {
    devices = await Room.getLocalDevices(undefined, false);
  } catch (err) {
    console.warn('[tavern] device list:', err.message);
  }
  const wantedFor = { audioinput: prefs.micId, videoinput: prefs.camId, audiooutput: prefs.speakerId };
  for (const [kind, select] of [['audioinput', $('mic-select')], ['videoinput', $('cam-select')], ['audiooutput', $('speaker-select')]]) {
    select.textContent = '';
    for (const d of devices.filter((d) => d.kind === kind)) {
      const option = document.createElement('option');
      option.value = d.deviceId;
      option.textContent = d.label || kind;
      select.appendChild(option);
    }
    const wanted = wantedFor[kind];
    if (wanted && [...select.options].some((o) => o.value === wanted)) select.value = wanted;
  }
}

// --- join / leave ---------------------------------------------------------------

// Disconnect (if connected) and join a different room. Used for the admin's
// own "pull aside" click, for the pulled player's push notification, and
// for "Back to the table".
async function reconnectTo(roomId, statusText) {
  if (statusText) setStatus(statusText);
  await room.disconnect().catch(() => {});
  await join(roomId);
}

// Admin only: pick who to pull into a private room with me -- click a
// tile's door icon to add or remove them, then confirm once ready.
function toggleAsideSelection(identity, button) {
  if (asideSelection.has(identity)) asideSelection.delete(identity);
  else asideSelection.add(identity);
  button.classList.toggle('selected', asideSelection.has(identity));
  updateAsideConfirm();
}

function updateAsideConfirm() {
  const overlay = $('aside-overlay');
  if (!overlay) return;
  overlay.hidden = asideSelection.size === 0;
  const n = asideSelection.size;
  const names = [...asideSelection].map((k) => tableUsers.get(k)?.displayName || k);
  const isAdmin = me?.role === 'admin';
  // An ordinary (recorded) aside is a GM move; anyone can ask for a real
  // off-the-record word, admin or not -- see /api/table/pull-aside.
  $('aside-confirm').hidden = !isAdmin;
  $('aside-overlay-prompt').textContent = isAdmin ? `Step aside with ${names.join(' & ')}?` : `Have a private word with ${names.join(' & ')}?`;
  $('aside-confirm-label').textContent = n === 1 ? 'Step aside' : `Step aside with ${n}`;
  $('aside-confirm-private-label').textContent = n === 1 ? 'Privately' : `Privately with ${n}`;
}

// Back out without pulling anyone: un-pick everyone, door icons included.
function cancelAsideSelection() {
  for (const key of asideSelection) tiles.get(key)?.querySelector('.tile-aside')?.classList.remove('selected');
  asideSelection.clear();
  updateAsideConfirm();
}

// Admin only: pull one or more people who are currently at the table into a
// new room with me, for a word away from the rest. `priv` marks a real
// off-the-record word (Studio hides it from the recording, and the stream
// doesn't follow me there) rather than an in-fiction private moment (still
// recorded, just muted/dimmed on the main feed while it's happening).
async function pullAside(identities, priv = false) {
  try {
    const { room: asideRoom } = await api('POST', '/api/table/pull-aside', { with: identities, private: priv });
    asideSelection.clear();
    await reconnectTo(asideRoom.id, priv ? 'stepping aside privately...' : 'stepping aside...');
  } catch (err) {
    setStatus(`pull aside: ${err.message}`, true);
  }
}

// "Back to the table": return to the room a pull-aside room came from
// (whichever room that was, not always the Lobby), and bring whoever else
// is still in there with me.
async function returnToTable() {
  try {
    const { room: homeRoom } = await api('POST', '/api/table/return');
    await reconnectTo(homeRoom.id, 'back to the table...');
  } catch (err) {
    setStatus(`back to the table: ${err.message}`, true);
  }
}

// Leaving entirely (not "back to the table" -- I'm not going anywhere
// myself). If I'm in a pulled-aside room, regular or private, whoever's
// still in there with me would otherwise be stranded -- an aside/private
// room is normally just the two (or few) of us, so without me there's no
// reason for them to still be off in a room by themselves. Applies to
// anyone, not just an admin: a Private Conversation doesn't need one.
// Same nudge /api/table/return already sends the others in
// returnToTable() above; I just never reconnect anywhere myself afterward.
async function leaveRoom() {
  if (currentRoom?.ephemeral) {
    await api('POST', '/api/table/return').catch(() => {});
  }
  room.disconnect();
}

async function join(roomId = 'lobby') {
  $('join-error').hidden = true;
  for (const b of document.querySelectorAll('[data-join]')) b.disabled = true;
  try {
    setStatus('connecting...');
    const { token, livekitUrl } = await api('POST', '/api/token', { room: roomId });
    await loadTable();
    currentRoom = tableRooms.find((r) => r.id === roomId) || { id: roomId, name: tableName };
    tableName = roomDisplayName(currentRoom);
    renderRoomLink();
    await connectAndSetup(token, livekitUrl);
  } catch (err) {
    setStatus('', false);
    $('join-error').textContent = err.message;
    $('join-error').hidden = false;
    await room.disconnect().catch(() => {});
  } finally {
    for (const b of document.querySelectorAll('[data-join]')) b.disabled = false;
  }
}

// A guest link: locked to the one room the link is for, no room picker, no
// account -- everything past "connect" is identical to a real member's join.
async function joinAsGuest(token, livekitUrl, roomId, roomName) {
  $('guest-join-error').hidden = true;
  try {
    setStatus('connecting...');
    tableName = roomName;
    await loadTable();
    // The full room object (members, ephemeral, ...), same as a real
    // member's join -- not just the {id, name} guest-join handed back, or
    // anything reading currentRoom.members downstream breaks.
    currentRoom = tableRooms.find((r) => r.id === roomId) || { id: roomId, name: roomName, members: [] };
    renderRoomLink();
    await connectAndSetup(token, livekitUrl);
  } catch (err) {
    setStatus('', false);
    $('guest-join-error').textContent = err.message;
    $('guest-join-error').hidden = false;
    await room.disconnect().catch(() => {});
  }
}

// Shared by join() and joinAsGuest() once a LiveKit token is in hand:
// connect, reveal the stage, publish mic/camera. Errors propagate to
// whichever of those called it, to land on the right error message.
async function connectAndSetup(token, livekitUrl) {
    await room.connect(livekitUrl, token);
    console.debug('[tavern] connected to', currentRoom.id);
    $('join').hidden = true;
    $('guest-join').hidden = true;
    $('stage').hidden = false;
    setChatWidth(prefs.chatWidth, { remember: false });
    // The header stays, naming the room and offering a way out of it. A
    // pulled-aside room also gets a quicker way back than "Leave" (which
    // would drop to the join screen instead of straight back to the Lobby).
    $('room-now-name').textContent = tableName;
    $('room-now').hidden = false;
    $('leave-top').hidden = false;
    const originRoom = currentRoom.ephemeral && currentRoom.origin ? tableRooms.find((r) => r.id === currentRoom.origin) : null;
    $('back-to-table').hidden = !currentRoom.ephemeral;
    $('back-to-table').textContent = originRoom ? `Back to ${roomDisplayName(originRoom)}` : 'Back to the table';
    document.body.classList.add('at-table');
    wake();
    setStatus(`in ${tableName}`);

    tileFor(room.localParticipant);
    applyMirror();
    for (const p of room.remoteParticipants.values()) {
      tileFor(p);
      updateMuted(p);
    }
    reconcileGhostTiles(); // anyone else in this room who's aside elsewhere, without waiting for the next poll
    // Only the microphone publishes on join. The camera stays off until
    // deliberately turned on -- a safety default, so nobody's video goes out
    // before they mean it to, and camera permission is only ever asked for
    // once someone actually reaches for it. toggleCam()'s setCameraEnabled
    // call already handles publishing a fresh track the first time, same as
    // it does for anyone who declined the camera here and turns it on later.
    let haveMic = false;
    try {
      const track = await openMic();
      await room.localParticipant.publishTrack(track, { source: Track.Source.Microphone, name: 'microphone' });
      haveMic = true;
      console.debug('[tavern] published audio');
      if (prefs.ptt) await room.localParticipant.setMicrophoneEnabled(false);
    } catch (err) {
      console.warn('[tavern] no microphone:', err.message);
    }
    updateMuted(room.localParticipant);
    updateCamera(room.localParticipant);
    await fillDevices();
    reflectMic();
    $('cam').classList.remove('on');
    $('cam').classList.add('off');
    if (!haveMic) setStatus(`in ${tableName} (no microphone)`);
}

async function toggleMic() {
  const enabled = !room.localParticipant.isMicrophoneEnabled;
  try {
    await room.localParticipant.setMicrophoneEnabled(enabled);
  } catch (err) {
    setStatus(`microphone: ${err.message}`, true);
  }
  reflectMic();
}

async function toggleCam() {
  const enabled = !room.localParticipant.isCameraEnabled;
  try {
    await room.localParticipant.setCameraEnabled(enabled);
    if (enabled && prefs.background !== 'none') await applyBackground(); // a fresh track on re-enable needs the processor reapplied
  } catch (err) {
    setStatus(`camera: ${err.message}`, true);
  }
  const on = room.localParticipant.isCameraEnabled;
  $('cam').classList.toggle('on', on);
  $('cam').classList.toggle('off', !on);
  updateCamera(room.localParticipant);
}

// Desktop sharing: LiveKit's own screen-share track (getDisplayMedia under
// the hood), published and rendered as its own tile -- see screenTileFor.
async function toggleScreenShare() {
  try {
    await room.localParticipant.setScreenShareEnabled(!room.localParticipant.isScreenShareEnabled, { audio: true });
  } catch (err) {
    // cancelling the browser's own share picker throws too -- not a real error
    if (err?.name !== 'NotAllowedError') setStatus(`screen share: ${err.message}`, true);
  }
  const on = room.localParticipant.isScreenShareEnabled;
  $('screen-share').classList.toggle('on', on);
  $('screen-share').title = on ? 'Stop sharing your screen (S)' : 'Share your screen (S)';
}

// Mute what I hear: everyone else's audio, not my own mic -- for when a
// phone call or something else needs the room quiet for a minute without
// actually leaving or muting yourself to the others.
function applyDeafen() {
  stageDoc().querySelectorAll('audio').forEach((el) => { el.muted = prefs.deafened; });
  $('deafen').classList.toggle('on', !prefs.deafened);
  $('deafen').classList.toggle('off', prefs.deafened);
  $('deafen').title = prefs.deafened ? 'Unmute what you hear (D)' : 'Mute what you hear (D)';
}

function toggleDeafen() {
  prefs.deafened = !prefs.deafened;
  savePrefs();
  applyDeafen();
}

$('mic').addEventListener('click', toggleMic);
$('cam').addEventListener('click', toggleCam);
$('deafen').addEventListener('click', toggleDeafen);
$('screen-share').addEventListener('click', toggleScreenShare);
if (navigator.mediaDevices?.getDisplayMedia) $('screen-share').hidden = false;
applyDeafen();
$('mic-select').addEventListener('change', async (e) => {
  prefs.micId = e.target.value;
  savePrefs();
  if (mic.ctx) await openMic().catch((err) => setStatus(`microphone: ${err.message}`, true));
});
$('cam-select').addEventListener('change', async (e) => {
  prefs.camId = e.target.value;
  savePrefs();
  await restartCamera();
});
$('speaker-select').addEventListener('change', async (e) => {
  prefs.speakerId = e.target.value;
  savePrefs();
  await applySpeaker();
});
$('master-volume').addEventListener('input', (e) => {
  prefs.masterVolume = Number(e.target.value);
  savePrefs();
  syncCallPrefs({ masterVolume: prefs.masterVolume });
  $('volume-value').textContent = `${prefs.masterVolume}%`;
  applyMasterVolume();
});
$('gain').addEventListener('input', (e) => {
  prefs.gain = Number(e.target.value);
  savePrefs();
  syncCallPrefs({ gain: prefs.gain });
  applyMicSettings();
});
$('gate').addEventListener('input', (e) => {
  prefs.gate = Number(e.target.value);
  savePrefs();
  syncCallPrefs({ gate: prefs.gate });
  applyMicSettings();
});
for (const id of ['noise', 'echo', 'agc']) {
  $(id).addEventListener('change', async (e) => {
    prefs[id] = e.target.checked;
    savePrefs();
    syncCallPrefs({ [id]: prefs[id] });
    if (mic.ctx) await openMic().catch((err) => setStatus(`microphone: ${err.message}`, true));
  });
}
$('talk-mode').addEventListener('change', (e) => setPushToTalk(e.target.value === 'ptt'));
$('quality').addEventListener('change', async (e) => {
  prefs.quality = Number(e.target.value);
  savePrefs();
  syncCallPrefs({ quality: prefs.quality });
  await restartCamera();
});
$('mirror').addEventListener('change', (e) => {
  prefs.mirror = e.target.checked;
  savePrefs();
  syncCallPrefs({ mirror: prefs.mirror });
  applyMirror();
});
$('background-mode').addEventListener('change', async (e) => {
  prefs.background = e.target.value;
  savePrefs();
  syncCallPrefs({ background: prefs.background });
  await applyBackground();
});

function applyMirror() {
  const tile = room.localParticipant && tiles.get(room.localParticipant.identity);
  if (tile) tile.classList.toggle('mirror', prefs.mirror);
}

const MEDIAPIPE_ASSET_PATHS = { tasksVisionFileSet: '/lib/mediapipe-wasm', modelAssetPath: '/models/selfie_segmenter.tflite' };

// Blur, or a still picture (set on your profile page), behind your own
// camera -- entirely client-side (LiveKit's server never sees the real
// background or the other way around; this runs on the same track before
// it's published, same idea as a mirror flip). The model is real weight --
// a WASM runtime plus an ML segmenter -- so it's only fetched the first
// time someone actually turns either of these on, not on every join.
async function applyBackground() {
  const pub = room.localParticipant?.getTrackPublication(Track.Source.Camera);
  if (!pub?.track) return; // camera off right now; applied when it comes back on
  try {
    if (prefs.background === 'blur') {
      const { BackgroundBlur } = await import('/lib/track-processors.mjs');
      await pub.track.setProcessor(BackgroundBlur(10, undefined, undefined, { assetPaths: MEDIAPIPE_ASSET_PATHS }));
    } else if (prefs.background === 'image') {
      const { VirtualBackground } = await import('/lib/track-processors.mjs');
      await pub.track.setProcessor(VirtualBackground(`/img/${encodeURIComponent(me.key)}/background?v=${Date.now()}`, undefined, undefined, { assetPaths: MEDIAPIPE_ASSET_PATHS }));
    } else {
      await pub.track.stopProcessor();
    }
  } catch (err) {
    setStatus(`background: ${err.message}`, true);
    prefs.background = 'none';
    savePrefs();
    $('background-mode').value = 'none';
  }
}

async function restartCamera() {
  const pub = room.localParticipant?.getTrackPublication(Track.Source.Camera);
  if (!pub?.track) return;
  try {
    await pub.track.restartTrack(videoConstraints());
  } catch (err) {
    setStatus(`camera: ${err.message}`, true);
  }
}
$('leave').addEventListener('click', () => leaveRoom());
$('leave-top').addEventListener('click', () => leaveRoom());
$('back-to-table').addEventListener('click', () => returnToTable());
$('aside-confirm').addEventListener('click', () => pullAside([...asideSelection]));
$('aside-confirm-private').addEventListener('click', () => pullAside([...asideSelection], true));
$('aside-cancel').addEventListener('click', cancelAsideSelection);
$('aside-overlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) cancelAsideSelection(); });
window.addEventListener('beforeunload', () => room.disconnect());

$('chat-toggle').addEventListener('click', () => toggleChat());
$('chat-close').addEventListener('click', () => toggleChat(false));
$('chat-save').addEventListener('click', saveChat);
$('chat-pic').addEventListener('click', () => $('chat-file').click());
$('chat-file').addEventListener('change', () => {
  for (const f of imageFiles($('chat-file').files)) sendImage(f);
  $('chat-file').value = '';
});
$('chat').addEventListener('paste', (event) => {
  const files = imageFiles(event.clipboardData?.files);
  if (!files.length) return;
  event.preventDefault();
  for (const f of files) sendImage(f);
});
$('chat').addEventListener('dragover', (event) => {
  event.preventDefault();
  $('chat').classList.add('drop');
});
$('chat').addEventListener('dragleave', () => $('chat').classList.remove('drop'));
$('chat').addEventListener('drop', (event) => {
  event.preventDefault();
  $('chat').classList.remove('drop');
  for (const f of imageFiles(event.dataTransfer?.files)) sendImage(f);
});
let chatDragStartX = 0;
let chatDragStartWidth = 0;
$('chat-resize').addEventListener('pointerdown', (event) => {
  event.preventDefault();
  chatDragStartX = event.clientX;
  chatDragStartWidth = $('chat').getBoundingClientRect().width;
  $('chat-resize').classList.add('dragging');
  $('chat-resize').setPointerCapture(event.pointerId);
});
$('chat-resize').addEventListener('pointermove', (event) => {
  if (!$('chat-resize').classList.contains('dragging')) return;
  setChatWidth(chatDragStartWidth + (chatDragStartX - event.clientX)); // chat is on the right: dragging left widens it
});
function stopChatDrag() {
  if (!$('chat-resize').classList.contains('dragging')) return;
  $('chat-resize').classList.remove('dragging');
  savePrefs();
}
$('chat-resize').addEventListener('pointerup', stopChatDrag);
$('chat-resize').addEventListener('pointercancel', stopChatDrag);

$('chat-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = $('chat-input').value.trim();
  if (!text) return;
  $('chat-input').value = '';
  try {
    await room.localParticipant.sendChatMessage(text); // echoed back through ChatMessage
  } catch (err) {
    setStatus(`chat: ${err.message}`, true);
  }
});

$('layout').addEventListener('click', () => setLayout(LAYOUTS[(LAYOUTS.indexOf(prefs.layout) + 1) % LAYOUTS.length], true));
$('layout-pick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-layout]');
  if (b) setLayout(b.dataset.layout);
});
$('follow-speaker').addEventListener('change', (e) => {
  prefs.follow = e.target.checked;
  savePrefs();
  applyLayout();
});
window.addEventListener('resize', applyLayout);

$('floatbar').addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-settings]');
  if (trigger) openSettings(trigger.dataset.settings);
});

// Guests: the room's own reusable join link, same door for everyone at the
// table to open (see the guest-link routes) -- not just an admin.
function say(el, text, error = false) {
  el.textContent = text;
  el.classList.toggle('error', error);
  if (text && !error) setTimeout(() => el.textContent === text && (el.textContent = ''), 3000);
}
async function copyText(text, statusEl) {
  try {
    await navigator.clipboard.writeText(text);
    if (statusEl) say(statusEl, 'copied');
  } catch (err) {
    window.prompt('Copy this:', text);
  }
}
function renderGuestLink() {
  if (guestToken || !currentRoom) return; // a guest has no session to manage this with
  const room = tableRooms.find((r) => r.id === currentRoom.id);
  const token = room?.guestToken || null;
  const allowed = room?.allowGuests !== false;
  $('guest-link-off-note').hidden = allowed;
  $('guest-link-value').textContent = token ? `${location.origin}/guest/${token}` : 'off';
  $('guest-link-on').hidden = !allowed || !!token;
  $('guest-link-copy').hidden = !token;
  $('guest-link-new').hidden = !allowed || !token;
  $('guest-link-off').hidden = !token;
}
async function setGuestLink(body) {
  try {
    if (body === null) await api('DELETE', `/api/rooms/${encodeURIComponent(currentRoom.id)}/guest-link`);
    else await api('POST', `/api/rooms/${encodeURIComponent(currentRoom.id)}/guest-link`, body);
    await loadTable();
    renderGuestLink();
  } catch (err) {
    say($('guest-link-status'), err.message, true);
  }
}
$('guest-link-on').addEventListener('click', () => setGuestLink({}));
$('guest-link-new').addEventListener('click', () => setGuestLink({ regenerate: true }));
$('guest-link-off').addEventListener('click', () => setGuestLink(null));
$('guest-link-copy').addEventListener('click', () => copyText($('guest-link-value').textContent, $('guest-link-status')));
$('react-toggle').addEventListener('click', () => toggleTray());
$('react-tray').addEventListener('click', (event) => {
  const button = event.target.closest('[data-reaction]');
  if (!button) return;
  sendReaction(button.dataset.reaction);
  toggleTray(false);
});

// Keyboard: M mic, V camera, D deafen, C chat, L layout, R reactions, S
// screen share (once available), 1 to 6 send a reaction, the account's own
// push-to-talk key held = talk while in that mode, unless typing in a
// field. The account's mute and camera hotkeys (Cmd/Ctrl+D and +E by
// default, set on the profile page) work alongside M and V, not instead
// of them.
document.addEventListener('keydown', onKey);
document.addEventListener('keyup', onKeyUp);
function typing(event) {
  const target = event.target;
  return target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
}
function onKeyUp(event) {
  if (prefs.ptt && pttHeld && !typing(event) && hotkeyMatches(event, prefs.pttKey)) {
    pttHeld = false;
    room.localParticipant.setMicrophoneEnabled(false).then(reflectMic).catch(() => {});
    event.preventDefault();
  }
}
function onKey(event) {
  if (!document.body.classList.contains('at-table')) return;
  if (typing(event)) return;
  if (prefs.ptt && hotkeyMatches(event, prefs.pttKey)) {
    event.preventDefault();
    if (event.repeat || pttHeld) return;
    pttHeld = true;
    room.localParticipant.setMicrophoneEnabled(true).then(reflectMic).catch(() => {});
    return;
  }
  // Configurable mute/camera shortcuts (Cmd/Ctrl+D and +E by default, same
  // as Google Meet) check first since they carry a modifier the plain
  // single-letter shortcuts below intentionally reject.
  if (hotkeyMatches(event, prefs.muteKey)) { toggleMic(); event.preventDefault(); return; }
  if (hotkeyMatches(event, prefs.camKey)) { toggleCam(); event.preventDefault(); return; }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === 'm') toggleMic();
  else if (key === 'v') toggleCam();
  else if (key === 'd') toggleDeafen();
  else if (key === 'c') toggleChat();
  else if (key === 'l') setLayout(LAYOUTS[(LAYOUTS.indexOf(prefs.layout) + 1) % LAYOUTS.length], true);
  else if (key === 'r') toggleTray();
  else if (key === 's' && !$('screen-share').hidden) toggleScreenShare();
  else if (/^[1-6]$/.test(key)) sendReaction(REACTION_KEYS[Number(key) - 1]);
  else return;
  event.preventDefault();
}

// --- floating controls: show on movement, hide when the pointer rests --------

let idleTimer = 0;
function wake() {
  $('stage').classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const keepOpen = !$('chat').hidden || !$('settings').hidden || !$('react-tray').hidden || $('floatbar').matches(':hover');
    if (!keepOpen) $('stage').classList.add('idle');
    else wake();
  }, 2500);
}
function watchPointer(doc) {
  doc.addEventListener('mousemove', wake);
  doc.addEventListener('touchstart', wake, { passive: true });
  doc.addEventListener('keydown', wake);
}
watchPointer(document);

// Click anywhere outside the settings popover (but still on the page) closes
// it, same as any other dropdown -- doesn't fire for the gear or any of the
// per-button carets that open it, or for clicks inside the popover itself
// (a link, a colour picker, ...).
function watchOutsideClick(doc) {
  doc.addEventListener('click', (event) => {
    if ($('settings').hidden) return;
    if (event.target.closest('#settings') || event.target.closest('[data-settings]')) return;
    closeSettings();
  });
}
watchOutsideClick(document);

// --- install as an app / pop out ------------------------------------------------

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  $('install').hidden = false;
  $('install-note').textContent = '';
});
$('install').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => {});
  installPrompt = null;
  $('install').hidden = true;
});

function describeInstall() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return '';
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return 'Add to your home screen for a full-screen table: Share, then Add to Home Screen.';
  if (/Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)) return 'For a window without browser bars: File, then Add to Dock.';
  if (/Firefox/.test(ua)) return 'Firefox has no install; Chrome, Edge or Safari can open the table in its own window.';
  return 'For a window without browser bars, use Install in the settings once you are at the table.';
}

// Chrome's document picture-in-picture: the whole stage moves into a small
// always-available window with no browser bars, and comes back when closed.
async function openPopout() {
  if (!('documentPictureInPicture' in window)) return;
  try {
    // Open small (or at the last size used) so it fits beside the game;
    // the tiles fit whatever size the window is dragged to.
    const size = prefs.popout || { w: 480, h: 300 };
    pipWindow = await window.documentPictureInPicture.requestWindow({
      width: Math.max(240, Math.min(size.w, 1280)),
      height: Math.max(120, Math.min(size.h, 720)),
    });
    for (const sheet of document.querySelectorAll('link[rel="stylesheet"]')) {
      pipWindow.document.head.appendChild(sheet.cloneNode(true));
    }
    pipWindow.document.body.className = 'at-table popout';
    pipWindow.document.body.appendChild($('stage'));
    $('away').hidden = false;
    watchPointer(pipWindow.document);
    watchOutsideClick(pipWindow.document);
    pipWindow.document.addEventListener('keydown', onKey);
    pipWindow.document.addEventListener('keyup', onKeyUp);
    pipWindow.addEventListener('resize', () => {
      prefs.popout = { w: pipWindow.innerWidth, h: pipWindow.innerHeight };
      savePrefs();
      applyLayout();
    });
    setTimeout(applyLayout, 50);
    pipWindow.addEventListener('pagehide', () => {
      document.body.appendChild($('stage'));
      $('away').hidden = true;
      pipWindow = null;
      $('popout').classList.remove('on');
      wake();
    });
    $('popout').classList.add('on');
  } catch (err) {
    setStatus(`pop out: ${err.message}`, true);
  }
}
function closePopout() {
  if (pipWindow) pipWindow.close();
}
$('popout').addEventListener('click', () => (pipWindow ? closePopout() : openPopout()));
$('bring-back').addEventListener('click', closePopout);
if ('documentPictureInPicture' in window) $('popout').hidden = false;

// --- your profile / Manage, without leaving the call -------------------------
// A real navigation would drop the WebRTC connection (it's tied to the page),
// so these load in an iframe instead: the call keeps running underneath,
// untouched. The loaded page (same origin) gets a "Back to [room]" link
// added to its own header -- see wireOverlayBack in brand.js -- rather than
// this page stacking a second bar of its own on top of it. Everyone else at
// the table sees your own tile marked "Away" while you're in there; you
// don't, since you already know.
function openOverlay(path) {
  const params = new URLSearchParams({ from: 'room', room: tableName });
  $('page-overlay-frame').src = `${path}${path.includes('?') ? '&' : '?'}${params}`;
  $('page-overlay-frame').hidden = false;
  sendAway(true);
}
function closeOverlay() {
  $('page-overlay-frame').hidden = true;
  $('page-overlay-frame').src = 'about:blank';
  sendAway(false);
}
window.closeProfileOverlay = closeOverlay; // called directly by the (same-origin) iframe

// Also called directly by the profile page overlay, right after it saves a
// background/call-prefs change -- otherwise the call keeps running with
// whatever was in effect at connect time, and the only way to pick up a
// change made this way used to be toggling the camera off and back on.
// `patch` is whatever fields actually changed (e.g. {background: 'blur'},
// {mirror: true}, {quality: 720}); a bare call with no patch just means
// "the background image itself changed, nothing in prefs did".
window.tavernApplyCallPrefs = async function (patch) {
  if (patch) {
    Object.assign(prefs, patch);
    savePrefs();
  }
  if (!patch || 'mirror' in patch) applyMirror();
  if (!patch || 'masterVolume' in patch) applyMasterVolume();
  if (!patch || 'gain' in patch || 'gate' in patch) applyMicSettings();
  if ((!patch || 'noise' in patch || 'echo' in patch || 'agc' in patch || 'micId' in patch) && mic.ctx) {
    await openMic().catch(() => {});
  }
  if (!patch || 'quality' in patch || 'camId' in patch) await restartCamera();
  // A plain image re-upload (no mode change) still needs this: applyBackground()
  // re-fetches the picture itself fresh every time, cache-bust and all.
  if (!patch || 'background' in patch || prefs.background === 'image') await applyBackground();
};
// Delegated (not one-time-queried) since a room card's own Edit link is
// built later, once tableRooms comes back -- a static query here would
// miss it and open it as a real navigation instead, with no way back.
document.addEventListener('click', (event) => {
  const link = event.target.closest('[data-overlay-link]');
  if (!link) return;
  event.preventDefault();
  openOverlay(link.getAttribute('href'));
});

function updateAwayOverlay(identity, on) {
  const tile = tiles.get(identity);
  if (!tile) return;
  tile.classList.toggle('tile-away', on);
  let overlay = tile.querySelector('.tile-away-overlay');
  if (on && !overlay) {
    overlay = document.createElement('div');
    overlay.className = 'tile-away-overlay';
    overlay.textContent = 'Away';
    tile.appendChild(overlay);
  } else if (!on && overlay) {
    overlay.remove();
  }
}

async function sendAway(on) {
  updateAwayOverlay(room.localParticipant?.identity, on);
  if (room.state !== 'connected') return;
  try {
    await room.localParticipant.publishData(encoder.encode(JSON.stringify({ type: 'away', on })), { reliable: true, topic: 'away' });
  } catch (err) {
    // best-effort: not worth surfacing to the person who just wants their profile
  }
}

// --- start --------------------------------------------------------------------

// The mic/camera processing fields (not device selection -- that's kept
// local, per machine) also live on the account, set from the profile page
// or here; this reflects prefs into the settings-popover controls, called
// once from local defaults at startup and again once the account's own
// values come back from /api/me.
function populateCallSettingsUI() {
  $('gain').value = String(prefs.gain);
  $('gate').value = String(prefs.gate);
  $('gain-value').textContent = `${prefs.gain}%`;
  $('gate-value').textContent = prefs.gate ? `${prefs.gate}` : 'off';
  $('noise').checked = prefs.noise;
  $('echo').checked = prefs.echo;
  $('agc').checked = prefs.agc;
  $('talk-mode').value = prefs.ptt ? 'ptt' : 'open';
  $('quality').value = String(prefs.quality);
  $('mirror').checked = prefs.mirror;
  $('background-mode').value = prefs.background;
  $('master-volume').value = String(prefs.masterVolume);
  $('volume-value').textContent = `${prefs.masterVolume}%`;
  $('mic').classList.toggle('ptt', prefs.ptt);
}

async function init() {
  const branding = await loadBranding();
  tableName = branding.tableName || tableName;
  renderReactionTray(branding.reactions);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  syncLayoutPick();
  $('follow-speaker').checked = prefs.follow;
  populateCallSettingsUI();
  applyLayout();
  const hint = describeInstall();
  $('install-hint').textContent = hint;
  $('install-hint').hidden = !hint;
  $('install-note').textContent = hint;

  if (guestToken) {
    // No account: no whoami, no Manage, no Sign out, no Guests section (that
    // needs a real session too) -- just the name field and, past that,
    // everything the room itself already handles the same for everyone.
    $('join').hidden = true;
    $('whoami-link').hidden = true;
    $('logout-link').hidden = true;
    $('guest-section').hidden = true;
    $('settings-links').hidden = true;
    try {
      const info = await api('GET', `/api/guest-link/${encodeURIComponent(guestToken)}`);
      $('guest-room-name').textContent = `Join ${info.roomName}`;
      $('guest-join').hidden = false;
      $('guest-join').dataset.roomId = info.roomId;
      $('guest-join').dataset.roomName = info.roomName;
    } catch (err) {
      $('guest-room-name').textContent = 'This link is off';
      $('guest-join-error').textContent = err.message;
      $('guest-join-error').hidden = false;
      $('guest-join').hidden = false;
      $('guest-join').querySelector('button[type="submit"]').hidden = true;
      $('guest-name').hidden = true;
    }
    return;
  }

  try {
    const info = await api('GET', '/api/me');
    me = info.user;
    $('whoami').textContent = me.displayName;
    $('whoami-img').src = `/img/${encodeURIComponent(me.key)}/profile?v=${Date.now()}`;
    $('whoami-img').hidden = false;
    $('admin-link').hidden = me.role !== 'admin';
    $('admin-link-2').hidden = me.role !== 'admin';
    // The account's own mic/camera processing settings take over from
    // whatever this browser had locally, so joining from anywhere lands
    // already set up the way the account is configured.
    if (me.callPrefs) {
      Object.assign(prefs, me.callPrefs);
      savePrefs();
      populateCallSettingsUI();
    }
    await loadTable(); // the join screen's member grid
  } catch (err) {
    location.href = '/login';
  }
}
init();
