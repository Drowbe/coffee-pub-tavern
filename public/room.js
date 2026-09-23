// The table: players see and hear each other.
import { Room, RoomEvent, Track, createLocalTracks } from '/lib/livekit-client.esm.mjs';
import { loadBranding, api, renderTopbar, setTopbarLocation, iconClasses, roomCrumbIcon } from '/brand.js';
import { createRoomModules, joinPanes, setJoinPanes } from '/room-modules.js';
import { hotkeyMatches, formatHotkey } from '/hotkeys.js';
import { initDashboard } from '/dashboard.js';

// Elements by id, wherever the stage currently lives (the page or the pop-out
// window, which takes the whole stage with it).
const stageEl = document.getElementById('stage');
// The conference can live in a floating panel or a window of its own, away from the stage.
const confEl = document.getElementById('conference');
// The header moves to the popped-out window with the stage, so it is searched too.
const topbarEl = document.getElementById('topbar');
const $ = (id) => (id === 'stage' ? stageEl : document.getElementById(id) || stageEl.querySelector(`#${id}`) || confEl.querySelector(`#${id}`) || topbarEl.querySelector(`#${id}`));
// Before anything else touches a header element -- the header itself is
// built here, not left static in room.html, so every #topbar-crumb,
// #recall-button etc. lookup below needs this to have already run.
renderTopbar();
if (new URLSearchParams(location.search).has('layout')) import('/layout-debug.js'); // a live geometry readout, see there
// The room's own bar, a second row of the header (so it moves with the header when the app is
// popped out): the panes to open on the left (chat, the room's modules; room-modules.js fills
// #modules-menu), and the controls for the whole app on the right, full screen and pop out,
// which move the whole table, not the conference.
const subnav = document.createElement('div');
subnav.className = 'subnav';
subnav.id = 'subnav';
// The secondary nav is about the space (the room), in three zones (see documentation/plans/plan-nav.md and
// architecture-navigation.md): left, the room's name and the module selector; middle, the space's own information and
// navigation (nothing yet); right, the space's actions: the stage-level snap, full screen, pop out, pulling people back
// from an aside, and leaving.
subnav.innerHTML = `
  <div class="nav-left subnav-left">
    <span class="space-name" id="space-name" hidden><i class="fa-solid fa-fw" id="space-icon" aria-hidden="true"></i><span id="space-name-text"></span></span>
    <div class="subnav-panes" id="modules-menu"></div>
  </div>
  <div class="nav-middle subnav-middle" id="subnav-middle"></div>
  <span class="nav-right subnav-tools">
  <span class="snap-tools" id="snap-tools"><button class="icon-link" id="snap-all" type="button" title="Snap every floating pane to a grid" aria-label="Snap every floating pane to a grid" aria-pressed="false"><i class="fa-solid fa-border-all fa-fw" aria-hidden="true"></i></button><input type="range" id="snap-size" title="Grid size" aria-label="Grid size" hidden></span>
  <button class="icon-link" id="fullscreen-toggle" type="button" title="Full screen (F)" aria-label="Full screen"><i class="fa-solid fa-expand fa-fw icon-on" aria-hidden="true"></i><i class="fa-solid fa-compress fa-fw icon-off" aria-hidden="true"></i></button>
  <button class="icon-link" id="popout" type="button" title="Pop out into its own window" aria-label="Pop out into its own window"><i class="fa-solid fa-up-right-from-square fa-fw icon-on" aria-hidden="true"></i><i class="fa-solid fa-window-restore fa-fw icon-off" aria-hidden="true"></i></button>
  <button class="btn btn-small" id="recall-button" type="button" title="Give everyone in a Private Conversation from this space a 10 second warning, then pull them back" hidden><i class="fa-solid fa-people-arrows fa-fw" aria-hidden="true"></i> Pull Participants Back</button>
  <button class="icon-link" id="rejoin-call" type="button" title="Rejoin call" aria-label="Rejoin call" hidden><i class="fa-solid fa-circle-left fa-fw" aria-hidden="true"></i></button>
  <span class="nav-divider"></span>
  <button class="icon-link" id="leave-room" type="button" title="Leave space" aria-label="Leave space"><i class="fa-solid fa-square-xmark fa-fw" aria-hidden="true"></i></button>
  </span>`;
topbarEl.appendChild(subnav);
// On a phone the room bar is a tab bar at the bottom of the page, in the flow after the stage, so
// the call toolbar sits directly above it whatever the browser does with its own bottom bar. Wider,
// it is the header's second row.
const phoneWidth = window.matchMedia('(max-width: 640px)');
const placeSubnav = () => {
  if (subnav.ownerDocument !== document) return; // popped out with the header
  if (phoneWidth.matches) document.body.appendChild(subnav);
  else topbarEl.appendChild(subnav);
};
phoneWidth.addEventListener('change', placeSubnav);
placeSubnav();
// On a phone the header's links are a menu (see brand.js), and the call's settings would otherwise
// only be reachable from the Conference view's toolbar. This item, in the menu only and only while
// in the call, shows the conference and opens them.
const callSettingsLink = document.createElement('button');
callSettingsLink.className = 'icon-link call-settings-link';
callSettingsLink.type = 'button';
callSettingsLink.hidden = true;
callSettingsLink.setAttribute('aria-label', 'Call settings');
callSettingsLink.innerHTML = '<i class="fa-solid fa-sliders fa-fw" aria-hidden="true"></i>';
const logoutDivider = topbarEl.querySelector('#logout-link')?.previousElementSibling;
logoutDivider?.parentNode.insertBefore(callSettingsLink, logoutDivider);
topbarEl.querySelector('#nav-toggle')?.addEventListener('click', () => { callSettingsLink.hidden = !inCall; });
callSettingsLink.addEventListener('click', () => {
  document.querySelector('.modules-menu-item[data-native="conference"]')?.click(); // shows the conference view
  setTimeout(() => { if ($('settings').hidden || $('settings').dataset.group !== 'more') openSettings('more'); }, 50);
});
// Only this page loads your profile/Manage as an overlay over a running
// call instead of a real navigation (see openOverlay() below) -- the
// shared header doesn't know that, so it's marked here instead.
$('whoami-link').dataset.overlayLink = '';
$('admin-link').dataset.overlayLink = '';
const room = new Room({ adaptiveStream: true, dynacast: true });
const tiles = new Map(); // participant identity (user key) -> tile element
const ghostTiles = new Map(); // identity -> tile element, for room members aside elsewhere
const asideSelection = new Set(); // identities picked to pull aside together, before confirming
let me = null;
let tableName = 'The Table';
const tableUsers = new Map(); // key -> { displayName, borderColor, online, room, ... } from /api/table
let tableRooms = []; // the rooms, with `mine` for the ones I may join
let currentRoom = null; // the room I am in, once joined
// Reloading the page keeps you in your room: the room is remembered for this tab (not across tabs or restarts) and rejoined when the
// page starts again. It is forgotten when you leave or are removed, but not when the page itself is going away.
let unloading = false;
addEventListener('pagehide', () => { unloading = true; });
addEventListener('pageshow', () => { unloading = false; });
const REMEMBERED_ROOM = 'host.room';
const rememberRoom = (id) => { try { sessionStorage.setItem(REMEMBERED_ROOM, id); } catch { /* not remembered */ } };
const forgetRoom = () => { if (unloading) return; try { sessionStorage.removeItem(REMEMBERED_ROOM); } catch { /* nothing */ } };
const rememberedRoom = () => { try { return sessionStorage.getItem(REMEMBERED_ROOM) || ''; } catch { return ''; } };
// Being in the room and being in the conference are separate: the page stays connected
// for the chat and the modules, and only sends and receives audio and video while the
// conference pane is open. Others see the difference through the "call" attribute.
let inCall = false;
let callStarting = Promise.resolve(); // settles once the conference has finished starting
const LOBBY = 'lobby';
let activeRoom = LOBBY; // the room the stream currently hears (server-computed)
let adminOnline = false; // whether that's actually backed by a real online admin right now
// Server-wide call feature toggles (Manage > Settings) -- these defaults
// hold until init() replaces them with whatever /api/branding actually says.
let features = { maxQuality: 720, allowScreenShare: true, allowAsides: true, allowPrivate: true, allowReactions: true };

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

// A member's Online picture for the space we're in, when they've set one there
// (Use Default Profile Images off); otherwise the tile falls back to their
// profile photo. Private asides count as their origin room.
function roomPortraitUrl(key) {
  const roomId = currentRoom?.ephemeral ? currentRoom.origin : currentRoom?.id;
  if (!roomId || roomId === LOBBY || key.startsWith(GUEST_PREFIX)) return imgUrl(key, 'profile');
  return imgUrl(key, 'player', { room: roomId, roomOnly: 1 });
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
    if (!guestToken) initDashboard({ users, rooms: tableRooms, me: me?.key }, { openInRoom, joinRoom: joinInvitedRoom });
    reconcileGhostTiles();
    renderGuestLink();
    renderRoomLink();
    updateRecallButton();
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
  if (link) btn.querySelector('.glyph').innerHTML = `<i class="${iconClasses(room.linkIcon || 'link')} fa-fw" aria-hidden="true"></i>`;
}
$('room-link').addEventListener('click', () => {
  const room = currentRoom && tableRooms.find((r) => r.id === currentRoom.id);
  if (room?.link) window.open(room.link, '_blank', 'noopener');
});

// Admin only: shows "Pull Participants Back" whenever a Private
// Conversation was pulled out of the room I'm currently in -- the admin
// is never part of those (see /api/table/pull-aside), so without this
// there'd be no way to know one is even happening, let alone end it.
let recallButtonTimer = 0;
let recallButtonCountingDown = false;

function updateRecallButton() {
  const btn = $('recall-button');
  if (!btn || recallButtonCountingDown) return;
  btn.hidden = !(me?.role === 'admin' && currentRoom && tableRooms.some((r) => r.ephemeral && r.private && r.origin === currentRoom.id));
}

function resetRecallButton() {
  clearInterval(recallButtonTimer);
  recallButtonCountingDown = false;
  const btn = $('recall-button');
  if (!btn) return;
  btn.disabled = false;
  btn.innerHTML = '<i class="fa-solid fa-people-arrows fa-fw" aria-hidden="true"></i> Pull Participants Back';
}

$('recall-button').addEventListener('click', async () => {
  const btn = $('recall-button');
  try {
    await api('POST', '/api/table/recall');
    recallButtonCountingDown = true;
    btn.disabled = true;
    let n = 10;
    btn.textContent = `Rejoining in... ${n}`;
    clearInterval(recallButtonTimer);
    recallButtonTimer = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        resetRecallButton();
        updateRecallButton();
        return;
      }
      btn.textContent = `Rejoining in... ${n}`;
    }, 1000);
  } catch (err) {
    setStatus(`pull participants back: ${err.message}`, true);
  }
});

// The countdown a Private Conversation's own participants see once the
// admin recalls them -- a warning, not an instant yank, so it doesn't cut
// anyone off mid-sentence. Re-triggering (e.g. the admin clicks it twice)
// restarts the same countdown rather than stacking a second one.
let recallTimer = 0;
function startRecallCountdown(roomId, roomName) {
  clearInterval(recallTimer);
  $('recall-room-name').textContent = roomName || 'the table';
  $('recall-overlay').hidden = false;
  let n = 10;
  $('recall-countdown').textContent = n;
  recallTimer = setInterval(() => {
    n -= 1;
    if (n <= 0) {
      clearInterval(recallTimer);
      $('recall-overlay').hidden = true;
      reconnectTo(roomId, 'pulled back to the table...');
      return;
    }
    $('recall-countdown').textContent = n;
  }, 1000);
}

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
  if (!currentRoom || !inCall || !document.body.classList.contains('at-table')) return;
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
    // Still connected to this one (just browsing the room list -- see
    // showRoomList()): offer to jump back in instead of joining fresh.
    const rejoin = room.state === 'connected' && currentRoom?.id === r.id;
    card.querySelector('[data-join-icon]').className = `fa-solid fa-${rejoin ? 'circle-left' : 'comments'} fa-fw`;
    card.querySelector('[data-join-label]').textContent = rejoin ? 'Rejoin' : 'Join';
    card.querySelector('[data-join-with]').hidden = Boolean(r.ephemeral);
    const edit = card.querySelector('[data-edit]');
    edit.hidden = r.ephemeral || me?.role !== 'admin';
    edit.href = `/rooms/${encodeURIComponent(r.id)}`;
    // A moderator cannot open the room's page, but changes what its modules do here.
    const modSettings = card.querySelector('[data-module-settings]');
    modSettings.hidden = r.ephemeral || me?.role === 'admin' || !me?.rooms?.[r.id]?.permissions?.moderator;
    modSettings.href = `/module-settings?room=${encodeURIComponent(r.id)}`;
    const link = card.querySelector('[data-link]');
    link.hidden = !r.link;
    if (r.link) {
      link.href = r.link;
      link.querySelector('i').className = `${iconClasses(r.linkIcon || 'link')} fa-fw`;
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
    card.querySelector('.room-choice-count').textContent = r.ephemeral ? '' : `${here}/${members.length} Online`;
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
      const dot = document.createElement('span');
      dot.className = 'dot';
      const name = document.createElement('span');
      name.className = 'member-name';
      el.append(img, dot, name);
      list.appendChild(el);
    }
    const here = Boolean(u.online) && u.room === roomId;
    // This room's Online/Offline picture when they've set one here (Use
    // Default Profile Images off); otherwise their profile photo.
    const img = el.querySelector('img');
    const slot = here ? 'player' : 'playerOffline';
    if (img.dataset.slot !== slot) {
      img.dataset.slot = slot;
      const profile = imgUrl(u.key, 'profile');
      img.onerror = () => { img.onerror = null; img.src = profile; };
      img.src = roomId && roomId !== LOBBY && !u.key.startsWith(GUEST_PREFIX) ? imgUrl(u.key, slot, { room: roomId, roomOnly: 1 }) : profile;
    }
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
// Join a room straight into its own window, skipping the step of joining in
// the page first and then popping out. The window opens first, synchronously
// with the click (a popup opened after a network wait is what browsers
// block); the stage moves into it, and is revealed there once connected.
async function joinInPopout(roomId) {
  if (!pipWindow) openPopout();
  if (room.state === 'connected' && currentRoom?.id === roomId) returnToStage();
  else if (room.state === 'connected') await reconnectTo(roomId);
  else await join(roomId);
  if (room.state !== 'connected') closePopout(); // it failed; don't leave an empty window
}
// "Join with": which panes a room opens with, remembered for that room (see joinPanes in
// room-modules.js). The list is the conference, the chat and the room's modules.
const roomModuleList = new Map(); // room id -> the modules on for it, fetched once
const canIn = (roomId, permission) => me?.role === 'admin' || !!(me?.rooms?.[roomId]?.effective || me?.permissions || {})[permission];

async function toggleJoinWith(card, roomId) {
  const open = card.querySelector('.join-with');
  closeJoinWith();
  if (open) return;
  const pop = document.createElement('div');
  pop.className = 'join-with';
  pop.innerHTML = '<strong>Join with</strong><div class="join-with-list"></div><p class="hint">Remembered for this room.</p>';
  card.appendChild(pop);
  if (!roomModuleList.has(roomId)) {
    try {
      roomModuleList.set(roomId, (await api('GET', `/api/modules/for-room?room=${encodeURIComponent(roomId)}`)).modules);
    } catch {
      roomModuleList.set(roomId, []);
    }
  }
  const items = [
    ...(canIn(roomId, 'conference') ? [{ id: 'conference', name: 'Conference', icon: 'video' }] : []),
    ...(canIn(roomId, 'chatRead') ? [{ id: 'chat', name: 'Chat', icon: 'message' }] : []),
    ...roomModuleList.get(roomId).map((m) => ({ id: m.id, name: m.name, icon: m.icon })),
  ];
  const chosen = new Set(joinPanes(roomId) ?? ['conference']);
  const list = pop.querySelector('.join-with-list');
  for (const item of items) {
    const label = document.createElement('label');
    label.className = 'check';
    label.innerHTML = `<input type="checkbox" data-pane="${escapeHtml(item.id)}"> <i class="fa-solid fa-${escapeHtml(item.icon)} fa-fw" aria-hidden="true"></i> ${escapeHtml(item.name)}`;
    label.querySelector('input').checked = chosen.has(item.id);
    list.appendChild(label);
  }
  list.addEventListener('change', () => {
    setJoinPanes(roomId, [...list.querySelectorAll('input:checked')].map((i) => i.dataset.pane));
  });
}
function closeJoinWith() {
  for (const pop of document.querySelectorAll('.join-with')) pop.remove();
}
document.addEventListener('click', (event) => {
  if (!event.target.closest('.join-with, [data-join-with]')) closeJoinWith();
});

$('rooms').addEventListener('click', (event) => {
  const withBtn = event.target.closest('[data-join-with]');
  if (withBtn) {
    const card = withBtn.closest('.room-choice');
    toggleJoinWith(card, card.dataset.room);
    return;
  }
  const popout = event.target.closest('[data-join-popout]');
  if (popout) {
    joinInPopout(popout.closest('.room-choice').dataset.room);
    return;
  }
  const button = event.target.closest('[data-join]');
  if (!button) return;
  const roomId = button.dataset.join;
  if (room.state === 'connected' && currentRoom?.id === roomId) returnToStage();
  else if (room.state === 'connected') reconnectTo(roomId);
  else join(roomId);
});
$('guest-join').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('guest-join-error').hidden = true;
  const name = $('guest-name').value.trim();
  if (!name) return;
  const submit = $('guest-join').querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const { token, livekitUrl, identity, roomId, roomName, permissions } = await api('POST', '/api/guest-join', { token: guestToken, name });
    me = { key: identity, displayName: name, role: 'guest', permissions };
    await joinAsGuest(token, livekitUrl, roomId, roomName);
  } catch (err) {
    $('guest-join-error').textContent = err.message;
    $('guest-join-error').hidden = false;
  } finally {
    submit.disabled = false;
  }
});
let unread = 0;
let pipWindow = null;

function setStatus(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
  // The page header shows the same status, except the plain "in <room>"
  // which the room name next to the brand already says.
  const top = $('topbar-status');
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

// Admin only, on hover: mute (toggles, reading the live mic state fresh on
// each click rather than tracking our own copy of it) and kick. Neither
// touches this browser's own call state, so no local UI besides the tile
// itself needs updating -- the room's own presence/track events do that.
// What I can do here: everything as an admin; otherwise the room's own
// effective set (my role's permissions plus anything ticked for me in that
// room, see Settings > Roles and profile > Rooms), or just my role's
// outside a room the server has no per-room entry for (an aside, a guest).
function canDo(permission) {
  if (me?.role === 'admin') return true;
  const inRoom = currentRoom && me?.rooms?.[currentRoom.id]?.effective;
  return !!(inRoom || me?.permissions || {})[permission];
}
// Everything a permission hides or shows on the page. Reruns once who I am
// and which room I'm in are both known, not just at load.
function applyPermissions() {
  applyFeatureFlags();
  $('chat-form').hidden = !canDo('chat');
  $('chat-pic').hidden = !canDo('sendPictures');
}

function adminToolsFor(participant) {
  const tools = document.createElement('div');
  tools.className = 'tile-admin-tools';
  // Muting is a real server-side toggle, but LiveKit has no "remote
  // unmute" -- only the participant's own client can turn their mic back
  // on, so offering it here just fails ("remote unmute not enabled").
  // The button only ever mutes; once muted, updateMuted() hides it and
  // whoever's muted has to unmute themselves.
  const mute = document.createElement('button');
  mute.type = 'button';
  mute.dataset.action = 'mute';
  mute.className = 'tile-admin-btn';
  mute.title = 'Mute';
  mute.hidden = participant.getTrackPublication(Track.Source.Microphone)?.isMuted ?? false;
  mute.innerHTML = '<i class="fa-solid fa-microphone-slash fa-fw" aria-hidden="true"></i>';
  mute.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await api('POST', `/api/users/${encodeURIComponent(participant.identity)}/mute`, { muted: true });
    } catch (err) {
      setStatus(`mute: ${err.message}`, true);
    }
  });
  const kick = document.createElement('button');
  kick.type = 'button';
  kick.className = 'tile-admin-btn danger';
  kick.title = 'Kick';
  kick.innerHTML = '<i class="fa-solid fa-user-slash fa-fw" aria-hidden="true"></i>';
  kick.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!window.confirm(`Kick ${participant.name || participant.identity} from the table? They can rejoin.`)) return;
    try {
      await api('POST', `/api/users/${encodeURIComponent(participant.identity)}/kick`);
    } catch (err) {
      setStatus(`kick: ${err.message}`, true);
    }
  });
  if (canDo('canMute')) tools.append(mute);
  if (canDo('canKick')) tools.append(kick);
  // Same restriction as the corner step-aside button: you can't step aside
  // from an aside (or private) room, there's nowhere further to go. Each
  // also has its own Manage > Settings toggle, independent of the other.
  const isAdmin = me?.role === 'admin';
  if (isAdmin && !currentRoom?.ephemeral && features.allowAsides) {
    const aside = document.createElement('button');
    aside.type = 'button';
    aside.className = 'tile-admin-btn';
    aside.title = 'Step aside';
    aside.innerHTML = '<i class="fa-solid fa-people-arrows fa-fw" aria-hidden="true"></i>';
    aside.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!window.confirm(`Step aside with ${participant.name || participant.identity}?`)) return;
      pullAside([participant.identity]);
    });
    tools.append(aside);
  }
  if (isAdmin && !currentRoom?.ephemeral && features.allowPrivate) {
    const priv = document.createElement('button');
    priv.type = 'button';
    priv.className = 'tile-admin-btn';
    priv.title = 'Privately';
    priv.innerHTML = '<i class="fa-solid fa-user-lock fa-fw" aria-hidden="true"></i>';
    priv.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!window.confirm(`Have a private word with ${participant.name || participant.identity}?`)) return;
      pullAside([participant.identity], true);
    });
    tools.append(priv);
  }
  return tools;
}

// A tile exists only while I am in the conference and the person is too.
const shownInCall = (participant) => inCall && (participant.isLocal || participant.attributes?.call !== 'off');
const subscribeAll = (participant) => { for (const pub of participant.trackPublications.values()) pub.setSubscribed(true); };

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
  placeholder.src = roomPortraitUrl(participant.identity);
  placeholder.onerror = () => { placeholder.onerror = null; placeholder.src = imgUrl(participant.identity, 'profile'); };
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
    // An admin has Step Aside/Privately right in the hover tools below, one
    // click each -- this corner button (pick one or more, then confirm) is
    // only still needed for a non-admin, who has no other way to invite
    // someone for a private word.
    if (!currentRoom?.ephemeral && me?.role !== 'admin' && ((features.allowPrivate && canDo('privateCall')) || (features.allowAsides && canDo('startAside')))) {
      const aside = document.createElement('button');
      aside.type = 'button';
      aside.className = 'tile-aside';
      aside.title = `Have a private word with ${participant.name || participant.identity} (pick one or more, then confirm)`;
      aside.innerHTML = '<i class="fa-solid fa-people-arrows" aria-hidden="true"></i>';
      aside.classList.toggle('selected', asideSelection.has(participant.identity));
      aside.addEventListener('click', (e) => { e.stopPropagation(); toggleAsideSelection(participant.identity, aside); });
      tile.appendChild(aside);
    }
    // Mute/Kick for admins, or for a member granted them in this room --
    // never against an admin (the server refuses that anyway).
    const targetIsAdmin = tableUsers.get(participant.identity)?.isAdmin;
    if (me?.role === 'admin' || (!targetIsAdmin && (canDo('canMute') || canDo('canKick')))) {
      const tools = adminToolsFor(participant);
      tools.addEventListener('pointerenter', () => (tile.draggable = false));
      tools.addEventListener('pointerleave', () => (tile.draggable = true));
      tile.appendChild(tools);
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
// The room's modules: the toolbar's Modules button and its floating panels.
const roomModules = createRoomModules({ guestToken });
window.hostModules = roomModules; // for debugging and tests

// The stage-level snap, in the room bar: one switch that makes every floating pane, now and later, snap to a grid over the
// stage, and, while it is on, a slider for the grid's size (the grid shows while the slider moves). Each pane's own switch
// on its titlebar still works on its own; this one sets them all. Remembered with the room's layout.
function syncSnapBar() {
  const on = roomModules.snapAllOn();
  const range = roomModules.snapPitchRange();
  $('snap-all').classList.toggle('on', on);
  $('snap-all').setAttribute('aria-pressed', on ? 'true' : 'false');
  const size = $('snap-size');
  size.hidden = !on;
  size.min = String(range.min); size.max = String(range.max); size.step = String(range.step);
  size.value = String(roomModules.snapPitch());
}
$('snap-all').addEventListener('click', () => { roomModules.snapAll(!roomModules.snapAllOn()); syncSnapBar(); });
$('snap-size').addEventListener('input', () => roomModules.setSnapPitch(Number($('snap-size').value), { preview: true }));
$('snap-size').addEventListener('change', () => roomModules.setSnapPitch(Number($('snap-size').value)));
syncSnapBar();
// A toast about a room module opens its panel; a server module opens over the call.
document.addEventListener('app:notification', (event) => {
  const n = event.detail;
  if (roomModules.handleNotification(n)) event.preventDefault();
  else if (n.scope === 'server' && document.body.classList.contains('at-table')) {
    event.preventDefault();
    openOverlay(`/modules/${encodeURIComponent(n.module)}`);
  }
});

function loadPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem('host.table') || '{}') };
  } catch (err) {
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs() {
  try {
    localStorage.setItem('host.table', JSON.stringify(prefs));
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

const LAYOUTS = ['grid', 'strip', 'spotlight']; // the actual stored prefs.layout values
// Four picker buttons over three real layouts: Focus and Spotlight are both
// prefs.layout 'spotlight' underneath, one big tile either picked by hand
// (pinned, or just first) or following whoever's speaking -- prefs.follow
// is the only thing that differs between them.
const VIEWS = [
  { id: 'grid', layout: 'grid', icon: 'fa-solid fa-table-cells-large' },
  { id: 'strip', layout: 'strip', icon: 'fa-solid fa-grip' },
  { id: 'focus', layout: 'spotlight', follow: false, icon: 'fa-regular fa-square' },
  { id: 'spotlight', layout: 'spotlight', follow: true, icon: 'fa-brands fa-square-web-awesome' },
];

function currentViewId() {
  if (prefs.layout === 'spotlight') return prefs.follow ? 'spotlight' : 'focus';
  return LAYOUTS.includes(prefs.layout) ? prefs.layout : 'grid';
}

function syncLayoutPick() {
  const id = currentViewId();
  for (const b of $('layout-pick').children) b.classList.toggle('selected', b.dataset.view === id);
  $('layout-glyph').className = `${VIEWS.find((v) => v.id === id).icon} fa-fw`;
}

function setView(id) {
  const view = VIEWS.find((v) => v.id === id) || VIEWS[0];
  prefs.layout = view.layout;
  if ('follow' in view) prefs.follow = view.follow;
  savePrefs();
  syncLayoutPick();
  applyLayout();
}

function cycleView() {
  const id = currentViewId();
  setView(VIEWS[(VIEWS.findIndex((v) => v.id === id) + 1) % VIEWS.length].id);
}

function applyLayout() {
  fitFloatbar();
  roomModules.layoutChanged(); // panes' columns follow the stage's width
  const grid = $('grid');
  grid.dataset.layout = prefs.layout;
  const portrait = grid.clientHeight > grid.clientWidth;
  grid.classList.toggle('portrait', portrait);
  const stage = $('stage');
  stage.classList.toggle('narrow', stage.clientWidth < 640);
  // The sizes follow the conference itself, wherever it is (docked beside the chat, floating,
  // or in a window of its own), not the whole stage.
  const host = confEl.closest('.stage') || stage;
  const box = confEl.querySelector('.mod-content');
  const cw = box?.clientWidth || host.clientWidth;
  const ch = box?.clientHeight || host.clientHeight;
  for (const el of new Set([stage, host])) {
    el.classList.toggle('compact', cw < 460);
    el.classList.toggle('tiny', cw < 300 || ch < 220);
  }
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
  if (!shownInCall(participant)) return;
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
  if (!shownInCall(participant)) return;
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
  // The admin Mute button can't unmute (see adminToolsFor) -- hide it once
  // there's nothing left for it to do.
  const muteBtn = tile.querySelector('.tile-admin-btn[data-action="mute"]');
  if (muteBtn) muteBtn.hidden = muted;
}

// A camera turned off keeps its publication but mutes it: show the image again.
function updateCamera(participant) {
  if (!shownInCall(participant)) return;
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

// Text and pictures travel live over LiveKit's data channel. The sender also posts a text message to the server,
// which keeps a rolling window per room (see server/chat-history.js), and everyone who joins reads it back, so a
// late joiner or a new browser sees what was said. Pictures are live only. An aside/private room keeps nothing,
// staying as off-the-record as everything else about it. The log here is what Save writes out and goes when you
// leave; "Clear chat" hides what came before from this browser only.
const chatLog = []; // { who, at, text } or { who, at, blob, name }
// Older versions kept the history in this browser only; it is still read when the server has none for the room
// (or cannot be reached). "Clear chat" remembers when, per person, so what came before stays hidden here.
const chatHistoryKey = (roomId) => `app:chat:${roomId}:${me?.key || guestToken || 'guest'}`;
const chatClearedKey = (roomId) => `app:chatclear:${roomId}:${me?.key || guestToken || 'guest'}`;
function loadChatHistory(roomId) {
  try {
    return JSON.parse(localStorage.getItem(chatHistoryKey(roomId))) || [];
  } catch {
    return [];
  }
}
function chatClearedAt(roomId) {
  try {
    return Number(localStorage.getItem(chatClearedKey(roomId))) || 0;
  } catch {
    return 0;
  }
}
async function fetchChatHistory(roomId) {
  const q = guestToken ? `?guest=${encodeURIComponent(guestToken)}` : '';
  const { messages } = await api('GET', `/api/rooms/${encodeURIComponent(roomId)}/chat${q}`);
  return messages.map((m) => ({ who: m.who, text: m.text, at: new Date(m.at).toISOString() }));
}
// Tell the server what was just said, so the room's history has it. Best effort: the message already went out live.
function postChatMessage(text) {
  if (!currentRoom || currentRoom.ephemeral) return;
  const q = guestToken ? `?guest=${encodeURIComponent(guestToken)}` : '';
  api('POST', `/api/rooms/${encodeURIComponent(currentRoom.id)}/chat${q}`, { text, name: me?.displayName || room.localParticipant.name }).catch(() => {});
}
// Called once per join, after the stage is up but before anything live has
// arrived -- fills #messages with whatever this room already said, so it
// reads as "still here" rather than the chat looking wiped on every rejoin.
async function renderChatHistory(roomId) {
  let history;
  try {
    history = await fetchChatHistory(roomId);
    if (!history.length) history = loadChatHistory(roomId);
  } catch {
    history = loadChatHistory(roomId);
  }
  const cleared = chatClearedAt(roomId);
  history = history.filter((e) => new Date(e.at).getTime() > cleared);
  // Anything live that arrived while this was loading is already there, so the history goes above it.
  const fragment = document.createDocumentFragment();
  for (const entry of history) {
    const el = messageEl({ who: entry.who, text: entry.text, at: new Date(entry.at) }, entry.who === me?.displayName);
    el.classList.add('history');
    fragment.appendChild(el);
  }
  // Everything above this line was said before you opened the table just
  // now; everything below it is happening live. Only worth marking when
  // there's actually old chat to separate from the new.
  if (history.length) {
    const divider = document.createElement('div');
    divider.className = 'chat-session-divider';
    divider.innerHTML = `<span>${escapeHtml(new Date().toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}</span>`;
    fragment.appendChild(divider);
    $('messages').prepend(fragment);
    $('messages').scrollTop = $('messages').scrollHeight;
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Markdown to safe HTML: headings, **bold**, *italic*/_italic_, `code`, fenced code, - and 1. lists, > quotes
// (what replyToEntry() quotes with), [text](url) and bare links. The one shared implementation every module
// (and now Chat) uses, in /sdk/host.js -- loaded on this page already for the modules it hosts in the page.
function renderMarkup(text) {
  return window.tavernText.markdown(text);
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

// Quotes the original message (markdown blockquote, so it renders as one
// once sent -- see renderMarkup()) at the start of whatever's already
// being typed, cursor landing right after so the reply continues below it.
function replyToEntry(entry) {
  const el = $('chat-input');
  const quoted = entry.blob
    ? `> ${entry.who} sent a picture`
    : `> ${entry.who}: ${entry.text.split('\n').join('\n> ')}`;
  const prefix = `${quoted}\n`;
  el.value = prefix + el.value;
  el.focus();
  el.setSelectionRange(prefix.length, prefix.length);
  resizeChatInput();
}

function messageEl(entry, own) {
  const el = document.createElement('div');
  el.className = `message${own ? ' own' : ''}`;
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = entry.who;
  if (entry.at) {
    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = entry.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    who.appendChild(when);
  }
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
  actions.appendChild(iconButton('reply', 'Reply', () => replyToEntry(entry)));
  if (entry.blob) actions.appendChild(iconButton('download', 'Save picture', () => saveBlob(entry.blob, entry.name)));
  el.append(who, body, actions);
  return el;
}

function addEntry(entry, own = false) {
  entry.at = new Date();
  chatLog.push(entry);
  $('messages').appendChild(messageEl(entry, own));
  $('messages').scrollTop = $('messages').scrollHeight;
  if (!roomModules.nativeOpen('chat') && !own) {
    unread += 1;
    roomModules.setNativeUnread('chat', unread);
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
  if (!file || !file.type.startsWith('image/') || room.state !== 'connected' || !canDo('sendPictures')) return;
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

// The reaction tray, as the admin has set it up (Manage > Theme); keys 1
// to 6 reach only the first six, however many are configured.
let REACTIONS = {}; // id -> glyph
let REACTION_KEYS = []; // id, in tray order
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function renderReactionTray(list) {
  const reactions = Array.isArray(list) ? list : [];
  REACTIONS = Object.fromEntries(reactions.map((r) => [r.id, r.glyph]));
  REACTION_KEYS = reactions.map((r) => r.id);
  renderChatEmoji(reactions);
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
  if (!features.allowReactions || !canDo('react') || !REACTIONS[id] || room.state !== 'connected') return;
  showReaction(room.localParticipant.identity, id); // data is not echoed back
  try {
    await room.localParticipant.publishData(encoder.encode(JSON.stringify({ type: 'reaction', id })), { reliable: true, topic: 'reaction' });
  } catch (err) {
    setStatus(`reaction: ${err.message}`, true);
  }
}

function toggleTray(open = $('react-tray').hidden) {
  if (open && !(features.allowReactions && canDo('react'))) return;
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
  for (const b of confEl.querySelectorAll('[data-settings]')) b.classList.remove('on');
}
function openSettings(group) {
  const trigger = confEl.querySelector(`[data-settings="${group}"]`);
  if (!$('settings').hidden && $('settings').dataset.group === group) {
    closeSettings();
    return;
  }
  for (const el of confEl.querySelectorAll('.settings-group')) el.hidden = el.dataset.group !== group;
  $('settings').dataset.group = group;
  $('settings').hidden = false;
  for (const b of confEl.querySelectorAll('[data-settings]')) b.classList.remove('on');
  if (trigger) trigger.classList.add('on');
  toggleTray(false);
}

// The conference is a pane too: docked, floating or in a window of its own, and it can be
// closed, which leaves the call but not the room. It is the flexible column, and the first
// one. Opening it starts the call (from a join or "Rejoin call"), closing it stops it;
// only moving it between docked, floating and a window leaves the call running.
roomModules.registerNative({
  id: 'conference',
  name: 'Conference',
  closedLabel: 'Rejoin call',
  icon: 'video',
  el: $('conference'),
  order: -1,
  flex: true,
  modes: ['dock', 'float', 'window'],
  wrap: 'stage conference-stage', // out of the stage's grid it needs a .stage of its own
  windowClass: 'conference-window',
  windowSize: { w: 640, h: 420 },
  floatSize: { w: 560, h: 380 },
  allowed: () => canDo('conference'),
  // A window of its own has its own document: idle/hover, popovers and keys need to hear it.
  onWindow: (win) => {
    win.document.title = tableName;
    watchPointer(win.document);
    watchOutsideClick(win.document);
    win.document.addEventListener('keydown', onKey);
    win.document.addEventListener('keyup', onKeyUp);
    win.document.addEventListener('fullscreenchange', syncFullscreenButton);
  },
  onWindowResize: () => applyLayout(),
  onChange: ({ open, mode, moving }) => {
    $('stage').classList.toggle('conference-open', open && mode === 'dock'); // the narrow layout keys off this
    if (!moving) {
      if (open) callStarting = startCall().catch((err) => setStatus(`call: ${err.message}`, true));
      else stopCall();
    }
    updateCrumb();
    setTimeout(applyLayout, 0); // once the pane is in place
  },
});
$('conf-close').addEventListener('click', hangUp);


// The chat is a pane like a module's: a column beside the video, a floating panel,
// or a window of its own (see room-modules.js). This is what the pane manager
// tells the chat when it opens or closes.
roomModules.registerNative({
  id: 'chat',
  name: 'Chat',
  icon: 'message',
  el: $('chat'),
  allowed: () => canDo('chatRead'),
  width: prefs.chatWidth,
  onWidth: (w) => { prefs.chatWidth = w; savePrefs(); },
  onChange: ({ open, mode }) => {
    $('stage').classList.toggle('chat-open', open && mode === 'dock'); // the narrow layout keys off this
    applyLayout();
    if (open) {
      unread = 0;
      roomModules.setNativeUnread('chat', 0);
      $('chat-input').focus();
      $('messages').scrollTop = $('messages').scrollHeight;
    }
  },
});

function toggleChat(open = !roomModules.nativeOpen('chat')) {
  if (open) roomModules.openNative('chat');
  else roomModules.closeNative('chat');
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
    mic.gate = new AudioWorkletNode(mic.ctx, 'mic-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    mic.gate.port.onmessage = (event) => onMicLevel(event.data);
    mic.level.connect(mic.gate);
    mic.gate.connect(mic.dest);
  } catch (err) {
    console.warn('[app] no audio worklet, gate off:', err.message);
    mic.gate = null;
    mic.analyser = mic.ctx.createAnalyser();
    mic.analyser.fftSize = 512;
    mic.level.connect(mic.analyser);
    mic.level.connect(mic.dest);
    mic.timer = setInterval(meterFromAnalyser, 50);
  }
  mic.track = mic.dest.stream.getAudioTracks()[0];
}

// Rebuilds just the graph's output node (and the track that publishes from
// it) after LiveKit has stopped the old one -- everything upstream (the
// AudioContext, gain, gate/analyser) is untouched and still running.
function rebuildMicDestination() {
  const from = mic.gate || mic.level;
  from.disconnect(mic.dest);
  mic.dest = mic.ctx.createMediaStreamDestination();
  from.connect(mic.dest);
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
  // LiveKit's room.disconnect() (called on every reconnectTo(), including
  // every aside/private step and the return from one) stops the underlying
  // MediaStreamTrack of whatever was published -- our processed track from
  // the Web Audio graph included. A stopped track can never restart, so
  // without this the mic would go dead the moment you first stepped aside
  // and stay dead for the rest of the session.
  else if (!mic.track || mic.track.readyState === 'ended') rebuildMicDestination();
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
    console.warn('[app] audio graph not running; publishing the raw microphone');
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
  // On a phone the conference can be hidden behind the chat while the mic is live, so the room bar
  // says so (see the in-call dot in style.css). The bar's own element is kept, its items are rebuilt.
  const bar = $('modules-menu');
  if (bar) bar.dataset.mic = on ? 'live' : 'off';
  if (room.state === 'connected') updateMuted(room.localParticipant);
}

// --- room events --------------------------------------------------------------

room
  .on(RoomEvent.TrackSubscribed, (track, _pub, participant) => attachTrack(participant, track))
  .on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => detachTrack(participant, track))
  .on(RoomEvent.LocalTrackPublished, (pub) => pub.track && attachTrack(room.localParticipant, pub.track))
  .on(RoomEvent.LocalTrackUnpublished, (pub) => pub.track && detachTrack(room.localParticipant, pub.track))
  .on(RoomEvent.ParticipantConnected, (p) => { if (shownInCall(p)) tileFor(p); })
  // Nothing is received until I am in the conference; then everything published is taken.
  .on(RoomEvent.TrackPublished, (pub, p) => { if (shownInCall(p)) pub.setSubscribed(true); })
  // Someone left or rejoined the conference without leaving the room.
  .on(RoomEvent.ParticipantAttributesChanged, (changed, p) => {
    if (p.isLocal || !inCall || !('call' in changed)) return;
    if (p.attributes?.call === 'off') return removeParticipant(p);
    tileFor(p);
    subscribeAll(p);
    updateMuted(p);
    updateCamera(p);
    applyLayout();
  })
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
    if (!canDo('chatRead')) return;
    addMessage(message.message, participant?.name || participant?.identity || 'someone', participant?.isLocal);
  })
  .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
    try {
      const data = JSON.parse(decoder.decode(payload));
      if (topic === 'reaction' && participant && data.type === 'reaction') showReaction(participant.identity, data.id);
      else if (topic === 'away' && participant && data.type === 'away') updateAwayOverlay(participant.identity, !!data.on, data.message);
      // A server push (no sending participant): someone pulled me aside.
      // An admin's word is final -- just go. A peer's "Privately" needs
      // this end to actually agree to it first. Deferred a tick so this
      // event's own dispatch finishes first.
      else if (topic === 'pull-aside' && data.type === 'pull-aside' && data.roomId) {
        if (data.byAdmin) {
          setTimeout(() => reconnectTo(data.roomId, 'pulled aside...'), 0);
        } else {
          setTimeout(() => {
            if (window.confirm(`${data.from || 'Someone'} wants ${data.private === false ? 'to step aside with you' : 'to have a private word'}. Join them?`)) {
              reconnectTo(data.roomId, data.private === false ? 'stepping aside...' : 'stepping aside privately...');
            }
          }, 0);
        }
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
      // The admin clicked "Pull Participants Back" in the room this Private
      // Conversation came from: warn, don't yank -- a countdown, then go.
      else if (topic === 'recall' && data.type === 'recall' && data.roomId) {
        startRecallCountdown(data.roomId, data.roomName);
      }
    } catch (err) {
      // not ours
    }
  })
  .on(RoomEvent.Reconnecting, () => setStatus('reconnecting...'))
  .on(RoomEvent.Reconnected, () => setStatus(`in ${tableName}`))
  .on(RoomEvent.Disconnected, () => {
    roomModules.suspend(); // tearing the room down must not become its remembered layout
    inCall = false; // the whole room is gone, so there is nothing to stop; the rest of this clears it
    closeMic();
    closePopout();
    roomModules.closeNative('conference');
    setStatus('left the call');
    forgetRoom();
    currentRoom = null;
    roomModules.refresh(null);
    document.body.classList.remove('at-table');
    $('stage').hidden = true;
    $('room-link').hidden = true;
    resetRecallButton();
    $('recall-button').hidden = true;
    clearInterval(recallTimer);
    $('recall-overlay').hidden = true;
    // A guest has no session and no room to pick from -- back to their own
    // name-only form for the one room their link is for, not the real
    // members' space list (which they can't do anything with anyway).
    $('join').hidden = !!guestToken;
    $('guest-join').hidden = !guestToken;
    $('away').hidden = true;
    updateCrumb();
    asideSelection.clear();
    updateAsideConfirm();
    // Not setAway(false): that would try to re-enable mic/camera on a
    // participant that's already gone. Just drop the stale state so the
    // next room starts clean, not still marked away from the last one.
    $('away-overlay').hidden = true;
    isAway = false;
    $('away-toggle').classList.remove('off');
    $('away-toggle').title = 'Away: pauses your mic and camera and lets everyone know';
    for (const [, tile] of tiles) tile.remove();
    tiles.clear();
    for (const [, tile] of ghostTiles) tile.remove();
    ghostTiles.clear();
    stageDoc().querySelectorAll('audio').forEach((el) => el.remove());
    $('messages').textContent = '';
    $('chat-delete-overlay').hidden = true;
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
    console.warn('[app] device list:', err.message);
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
// From the dashboard: go into a room with one module's pane open on one item, and nothing else changed. In the
// room already, that is just showing the stage and opening the pane.
// Into a room I was invited to (or started): the one I am in is left for it.
async function joinInvitedRoom(roomId) {
  if (room.state === 'connected' && currentRoom?.id === roomId) return returnToStage();
  if (room.state === 'connected') return reconnectTo(roomId);
  return join(roomId);
}
// An invitation accepted on this page (the toast in brand.js asks; a page that handles it says so).
document.addEventListener('app:invite-accept', (event) => {
  event.preventDefault();
  joinInvitedRoom(event.detail.roomId);
});

async function openInRoom(roomId, moduleId, ref) {
  if (room.state === 'connected' && currentRoom?.id === roomId) {
    returnToStage();
    roomModules.open(moduleId);
    roomModules.openRef(ref);
    return;
  }
  roomModules.requestOpen(moduleId, ref);
  if (room.state === 'connected') await reconnectTo(roomId);
  else await join(roomId);
}
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
  // An ordinary (recorded) aside and an off-the-record word are separate
  // permissions -- see Settings > Roles and /api/table/pull-aside.
  const canAside = canDo('startAside') && features.allowAsides;
  const canPrivate = canDo('privateCall') && features.allowPrivate;
  $('aside-confirm').hidden = !canAside;
  $('aside-confirm-private').hidden = !canPrivate;
  $('aside-overlay-prompt').textContent = canAside ? `Step aside with ${names.join(' & ')}?` : `Have a private word with ${names.join(' & ')}?`;
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
// myself). If I'm in a pulled-aside space, regular or private, whoever's
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

// Keeps the header's crumb in sync with where we actually are: the room
// list (nobody's called join() yet, or Disconnected just fired), a real
// room (with its own Leave), or an aside/private pulled out of one (with
// both a Leave for the whole table and a Rejoin Call back into the room it
// came from). Same delegated click handler covers both, wired once below.
// "Rooms" is a real ancestor, not a label that only shows up when there's
// nothing more specific to say -- the path never skips a level, so it's
// always here and always a link back to the room list, whether or not
// there's anything after it.
// Rejoin is icon-only, styled like the header's other icon buttons
// (settings, sign out) rather than a labeled pill -- title carries the
// name for a screen reader or a hover, same as those. Leave is in the subnav.
// The label text hides at narrow widths (see .crumb-label in style.css),
// leaving just the icon -- which is why every crumb-here needs one.
const crumbHere = (icon, text) => `<span class="crumb-here"><i class="${icon.includes(' ') ? icon : `fa-solid fa-${icon}`} fa-fw" aria-hidden="true"></i><span class="crumb-label"> ${escapeHtml(text)}</span></span>`;

// The space's name in the secondary nav's left zone. At the table the primary nav's crumb is empty: the secondary nav says
// where you are, and saying it twice was noise (plan-nav.md). In an aside the name is the origin's plus the kind, and the
// Rejoin call button (a space action) shows in the right zone.
function setSpaceName(icon, text) {
  const el = $('space-name');
  if (!el) return;
  el.hidden = !text;
  const i = $('space-icon');
  if (i) i.className = `${icon.includes(' ') ? icon : `fa-solid fa-${icon}`} fa-fw`;
  const t = $('space-name-text');
  if (t) t.textContent = text || '';
}
function updateCrumb() {
  setTopbarLocation('');
  const rejoin = $('rejoin-call');
  if (!currentRoom) {
    setSpaceName('couch', '');
    if (rejoin) rejoin.hidden = true;
    return;
  }
  if (currentRoom.ephemeral && currentRoom.origin) {
    const originRoom = tableRooms.find((r) => r.id === currentRoom.origin);
    const originName = originRoom ? roomDisplayName(originRoom) : 'the table';
    const kind = currentRoom.private ? 'Private' : 'Aside';
    setSpaceName('people-arrows', `${originName} · ${kind}`);
    if (rejoin) rejoin.hidden = false;
  } else {
    setSpaceName(roomCrumbIcon(currentRoom), tableName);
    if (rejoin) rejoin.hidden = true;
  }
}

async function join(roomId = 'lobby') {
  $('join-error').hidden = true;
  for (const b of document.querySelectorAll('[data-join]')) b.disabled = true;
  try {
    setStatus('connecting...');
    const { token, livekitUrl } = await api('POST', '/api/token', { room: roomId });
    // Fresh permissions each join -- an admin may have changed them since
    // this page loaded.
    me = (await api('GET', '/api/me')).user;
    await loadTable();
    currentRoom = tableRooms.find((r) => r.id === roomId) || { id: roomId, name: tableName };
    await roomModules.refresh(currentRoom.ephemeral ? null : currentRoom.id); // asides have no modules
    tableName = roomDisplayName(currentRoom);
    renderRoomLink();
    applyPermissions();
    updateRecallButton();
    await connectAndSetup(token, livekitUrl);
  } catch (err) {
    setStatus('', false);
    forgetRoom(); // a room that cannot be joined is not remembered, so a reload does not try it again
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
    await roomModules.refresh(currentRoom.id);
    renderRoomLink();
    applyPermissions();
    updateRecallButton();
    await connectAndSetup(token, livekitUrl);
  } catch (err) {
    setStatus('', false);
    $('guest-join-error').textContent = err.message;
    $('guest-join-error').hidden = false;
    await room.disconnect().catch(() => {});
  }
}

// Shared by join() and joinAsGuest() once a LiveKit token is in hand:
// connect, reveal the stage, and open the conference (unless the role has no
// conference). Errors propagate to whichever of those called it, to land on the
// right error message. Nothing is received until the conference starts, so
// autoSubscribe is off.
async function connectAndSetup(token, livekitUrl) {
    await room.connect(livekitUrl, token, { autoSubscribe: false });
    console.debug('[app] connected to', currentRoom.id);
    if (!guestToken && currentRoom && !currentRoom.ephemeral) rememberRoom(currentRoom.id); // an aside is gone once it ends, so it is not kept
    $('join').hidden = true;
    $('guest-join').hidden = true;
    $('stage').hidden = false;
    updateCrumb();
    document.body.classList.add('at-table');
    wake();
    setStatus(`in ${tableName}`);
    if (!currentRoom.ephemeral) renderChatHistory(currentRoom.id);
    roomModules.updateMenu();
    roomModules.restore(); // the panes this room had open last time, or the conference the first time
    syncSnapBar(); // and this room's stage-level snap
    if (roomModules.nativeOpen('conference')) await callStarting;
    else setStatus(`in ${tableName} (not in the call)`);
}

// Start the conference: tiles for everyone in it, their media, and my own microphone.
// Runs when the conference pane opens (a join, or "Rejoin call").
async function startCall() {
  if (inCall || room.state !== 'connected') return;
  inCall = true;
  if (room.localParticipant.attributes?.call !== 'on') {
    await room.localParticipant.setAttributes({ call: 'on' }).catch(() => {});
  }
  tileFor(room.localParticipant);
  applyMirror();
  for (const p of room.remoteParticipants.values()) {
    if (!shownInCall(p)) continue;
    tileFor(p);
    subscribeAll(p);
    updateMuted(p);
    updateCamera(p);
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
    console.debug('[app] published audio');
    if (prefs.ptt) await room.localParticipant.setMicrophoneEnabled(false);
  } catch (err) {
    console.warn('[app] no microphone:', err.message);
  }
  updateMuted(room.localParticipant);
  updateCamera(room.localParticipant);
  await fillDevices();
  reflectMic();
  $('cam').classList.remove('on');
  $('cam').classList.add('off');
  setStatus(haveMic ? `in ${tableName}` : `in ${tableName} (no microphone)`);
  applyLayout();
}

// Leave the conference and stay in the room: stop sending and receiving media, drop the
// tiles, and tell everyone I am not in it (the "call" attribute), so they drop mine.
async function stopCall() {
  if (!inCall) return;
  inCall = false;
  if (room.state === 'connected') {
    await room.localParticipant.setAttributes({ call: 'off' }).catch(() => {});
    for (const pub of [...room.localParticipant.trackPublications.values()]) {
      if (pub.track) await room.localParticipant.unpublishTrack(pub.track, true).catch(() => {});
    }
    for (const p of room.remoteParticipants.values()) for (const pub of p.trackPublications.values()) pub.setSubscribed(false);
  }
  closeMic();
  // Away is a conference state: going out of the call ends it without a word to anyone.
  $('away-overlay').hidden = true;
  isAway = false;
  $('away-toggle').classList.remove('off');
  $('away-toggle').title = 'Away: pauses your mic and camera and lets everyone know';
  for (const [, tile] of tiles) tile.remove();
  tiles.clear();
  for (const [, tile] of ghostTiles) tile.remove();
  ghostTiles.clear();
  stageDoc().querySelectorAll('audio').forEach((el) => el.remove());
  asideSelection.clear();
  updateAsideConfirm();
  $('cam').classList.remove('on');
  $('cam').classList.add('off');
  $('screen-share').classList.remove('on');
  toggleTray(false);
  closeSettings();
  setStatus(`in ${tableName} (not in the call)`);
}

// The hang-up button. In a pop-out window the stage comes back to the page first, since the
// Modules button that brings the conference back is in the page's header.
function hangUp() {
  if (pipWindow) closePopout();
  roomModules.closeNative('conference');
}

async function toggleMic() {
  if (!inCall) return;
  const enabled = !room.localParticipant.isMicrophoneEnabled;
  try {
    await room.localParticipant.setMicrophoneEnabled(enabled);
  } catch (err) {
    setStatus(`microphone: ${err.message}`, true);
  }
  reflectMic();
}

let camToggling = false;
async function toggleCam() {
  if (!inCall) return;
  // getUserMedia (plus the retry above) can take a moment -- without this
  // guard a quick double-tap fires a second toggle before the first one has
  // actually turned the camera on, landing on whichever finishes last.
  if (camToggling) return;
  camToggling = true;
  $('cam').classList.add('loading');
  const enabled = !room.localParticipant.isCameraEnabled;
  try {
    await setCameraEnabledWithRetry(enabled);
    if (enabled && prefs.background !== 'none') await applyBackground(); // a fresh track on re-enable needs the processor reapplied
  } catch (err) {
    setStatus(`camera: ${err.message}`, true);
  }
  camToggling = false;
  $('cam').classList.remove('loading');
  const on = room.localParticipant.isCameraEnabled;
  $('cam').classList.toggle('on', on);
  $('cam').classList.toggle('off', !on);
  updateCamera(room.localParticipant);
}

// Right after a reconnectTo() (stepping into or back from an aside/private),
// the camera device can still be a beat from actually releasing on the OS
// side -- most often on mobile -- so the very next getUserMedia can fail
// with NotReadableError even though nothing is really wrong. One short
// retry covers that without making a real failure (denied permission, no
// camera at all) wait needlessly.
async function setCameraEnabledWithRetry(enabled) {
  try {
    await room.localParticipant.setCameraEnabled(enabled);
  } catch (err) {
    if (!enabled || err?.name !== 'NotReadableError') throw err;
    await new Promise((resolve) => setTimeout(resolve, 700));
    await room.localParticipant.setCameraEnabled(enabled);
  }
}

// Desktop sharing: LiveKit's own screen-share track (getDisplayMedia under
// the hood), published and rendered as its own tile -- see screenTileFor.
async function toggleScreenShare() {
  if (!inCall) return;
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
// A short tone through whichever speaker is picked above -- routed through
// an <audio> element (not straight to AudioContext.destination) since
// setSinkId is how a specific output device actually gets chosen, same as
// every remote participant's own audio already goes through one.
$('test-speaker').addEventListener('click', async () => {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 440;
    osc.connect(gain);
    const dest = ctx.createMediaStreamDestination();
    gain.connect(dest);
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.25, now + 0.05); // fade in/out so it doesn't click
    gain.gain.setValueAtTime(0.25, now + 0.55);
    gain.gain.linearRampToValueAtTime(0, now + 0.65);
    const audio = new Audio();
    audio.srcObject = dest.stream;
    if (prefs.speakerId && audio.setSinkId) await audio.setSinkId(prefs.speakerId).catch(() => {});
    await audio.play();
    osc.start(now);
    osc.stop(now + 0.7);
    osc.onended = () => {
      audio.pause();
      ctx.close();
    };
  } catch (err) {
    setStatus(`test speaker: ${err.message}`, true);
  }
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
$('hangup').addEventListener('click', hangUp);
// The crumb's own action buttons (Leave, Rejoin Call) get regenerated with
// every updateCrumb() call, so one delegated listener on the stable
// container instead of rewiring a fresh element's click every time.
$('topbar-crumb').addEventListener('click', (event) => {
  const action = event.target.closest('[data-crumb-action]')?.dataset.crumbAction;
  if (action === 'rejoin') returnToTable();
});
// Rejoin call now lives in the space's bar (an aside's way back); the crumb listener above is kept for any page that still draws it there.
$('rejoin-call').addEventListener('click', () => returnToTable());
// Leave is in the room's bar (the subnav), which is not the crumb, so it has its own listener.
$('leave-room').addEventListener('click', leaveRoom);
$('aside-confirm').addEventListener('click', () => pullAside([...asideSelection]));
$('aside-confirm-private').addEventListener('click', () => pullAside([...asideSelection], true));
$('aside-cancel').addEventListener('click', cancelAsideSelection);
$('aside-overlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) cancelAsideSelection(); });
window.addEventListener('beforeunload', () => room.disconnect());

$('chat-close').addEventListener('click', () => toggleChat(false));
$('chat-save').addEventListener('click', saveChat);
$('chat-delete').addEventListener('click', () => { $('chat-delete-overlay').hidden = false; });
$('chat-delete-cancel').addEventListener('click', () => { $('chat-delete-overlay').hidden = true; });
$('chat-delete-confirm').addEventListener('click', () => {
  chatLog.length = 0;
  $('messages').textContent = '';
  unread = 0;
  roomModules.setNativeUnread('chat', 0);
  if (currentRoom) {
    try {
      localStorage.setItem(chatClearedKey(currentRoom.id), String(Date.now()));
      localStorage.removeItem(chatHistoryKey(currentRoom.id));
    } catch {
      // private browsing: the chat is cleared for now, but the history returns on the next join
    }
  }
  $('chat-delete-overlay').hidden = true;
});
$('chat-pic').addEventListener('click', () => { toggleChatTools(false); $('chat-file').click(); });
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
$('chat-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = $('chat-input').value.trim();
  if (!text || !canDo('chat')) return;
  $('chat-input').value = '';
  resizeChatInput();
  try {
    await room.localParticipant.sendChatMessage(text); // echoed back through ChatMessage
    postChatMessage(text);
  } catch (err) {
    setStatus(`chat: ${err.message}`, true);
  }
});
// Enter sends, like a normal chat; Shift+Enter is the way to actually get a
// newline into a <textarea> without that also submitting the form.
$('chat-input').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey) return;
  event.preventDefault();
  $('chat-form').requestSubmit();
});
// Grows with the text up to a few lines, then scrolls -- resetting height
// to 'auto' first is what lets scrollHeight shrink back down too, not just
// grow, when a line is deleted.
function resizeChatInput() {
  const el = $('chat-input');
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}
$('chat-input').addEventListener('input', resizeChatInput);

// Wraps the current selection (or just inserts an empty pair, cursor
// landing in the middle) in the chat input with the given marker --
// **bold**, *italic*, `code`, matching what renderMarkup() understands.
function wrapChatSelection(marker) {
  const el = $('chat-input');
  const { selectionStart: start, selectionEnd: end, value } = el;
  const selected = value.slice(start, end);
  el.value = value.slice(0, start) + marker + selected + marker + value.slice(end);
  el.focus();
  const from = start + marker.length;
  el.setSelectionRange(from, from + selected.length);
  resizeChatInput();
}
$('chat-bold').addEventListener('click', () => wrapChatSelection('**'));
$('chat-italic').addEventListener('click', () => wrapChatSelection('*'));
$('chat-code').addEventListener('click', () => wrapChatSelection('`'));
// Prefixes the current line (or every non-blank line the selection spans)
// with "- ", rather than wrapping like the others -- a list marker belongs
// at the start of a line, not around a span of text.
$('chat-list').addEventListener('click', () => {
  const el = $('chat-input');
  const { selectionStart: start, selectionEnd: end, value } = el;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = value.indexOf('\n', end) === -1 ? value.length : value.indexOf('\n', end);
  const block = value.slice(lineStart, lineEnd);
  const newBlock = block.split('\n').map((l) => (l.trim() ? `- ${l}` : l)).join('\n');
  el.value = value.slice(0, lineStart) + newBlock + value.slice(lineEnd);
  el.focus();
  el.setSelectionRange(lineStart, lineStart + newBlock.length);
  resizeChatInput();
});
// The formatting tools are a layer above the input row, opened from the icons button and closed by a click
// elsewhere, Escape, or choosing a picture.
function toggleChatTools(open) {
  const bar = $('chat-format-bar');
  const show = open ?? bar.hidden;
  bar.hidden = !show;
  $('chat-tools').setAttribute('aria-expanded', String(show));
  $('chat-tools').classList.toggle('on', show);
  if (!show) { $('chat-help-popup').hidden = true; $('chat-emoji-popup').hidden = true; }
}
$('chat-tools').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleChatTools();
});
document.addEventListener('click', (e) => {
  if (!$('chat-format-bar').hidden && !e.target.closest('#chat-format-bar, #chat-tools')) toggleChatTools(false);
});
$('chat-format-bar').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { toggleChatTools(false); $('chat-input').focus(); }
});
$('chat-help').addEventListener('click', (e) => {
  e.stopPropagation();
  $('chat-emoji-popup').hidden = true;
  $('chat-help-popup').hidden = !$('chat-help-popup').hidden;
});
document.addEventListener('click', (e) => {
  if (!$('chat-help-popup').hidden && !e.target.closest('#chat-help-popup')) $('chat-help-popup').hidden = true;
  if (!$('chat-emoji-popup').hidden && !e.target.closest('#chat-emoji-popup')) $('chat-emoji-popup').hidden = true;
});

// The chat's emoji picker offers the same list as the reaction tray (the admin
// sets it under Manage > Theme), rebuilt whenever that list is loaded.
function renderChatEmoji(reactions) {
  const popup = $('chat-emoji-popup');
  popup.textContent = '';
  for (const r of reactions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chat-emoji-btn';
    b.textContent = r.glyph;
    b.title = r.label;
    b.addEventListener('click', () => {
      const el = $('chat-input');
      const { selectionStart: start, selectionEnd: end, value } = el;
      el.value = value.slice(0, start) + r.glyph + value.slice(end);
      el.focus();
      const at = start + r.glyph.length;
      el.setSelectionRange(at, at);
      resizeChatInput();
    });
    popup.appendChild(b);
  }
  $('chat-emoji').hidden = reactions.length === 0;
}
$('chat-emoji').addEventListener('click', (e) => {
  e.stopPropagation();
  $('chat-help-popup').hidden = true;
  $('chat-emoji-popup').hidden = !$('chat-emoji-popup').hidden;
});

$('layout').addEventListener('click', cycleView);
$('layout-pick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (b) setView(b.dataset.view);
});
window.addEventListener('resize', applyLayout);

$('floatbar').addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-settings]');
  if (trigger) openSettings(trigger.dataset.settings);
});

// --- floatbar overflow -------------------------------------------------------
// Only "More" and hang up always show; everything else collapses into "More"
// (rather than wrapping to a second row) as the bar runs out of room, lowest
// data-collapse first -- the extras, then chat, then camera, then the
// microphone last. See fitFloatbar(), called from applyLayout() whenever the
// stage (or the chat next to it) changes size.
const FLOATBAR_ALL = [...$('floatbar').children];
const FLOATBAR_COLLAPSE_ORDER = FLOATBAR_ALL.filter((el) => el.dataset.collapse).sort(
  (a, b) => Number(a.dataset.collapse) - Number(b.dataset.collapse)
);
function fitFloatbar() {
  const bar = $('floatbar');
  // Put everything back in its original spot first -- simplest way to get a
  // stable, correctly-ordered result every time rather than tracking where
  // each collapsed item needs to be spliced back in.
  for (const item of FLOATBAR_ALL) bar.appendChild(item);
  $('floatbar-more').hidden = true;
  for (const item of FLOATBAR_COLLAPSE_ORDER) {
    if (bar.scrollWidth <= bar.clientWidth) break;
    if (item.hidden) continue; // already hidden by its own logic (no room link, say) -- moving it won't help
    $('floatbar-overflow').appendChild(item);
    $('floatbar-more').hidden = false;
  }
}
$('floatbar-overflow').addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-settings]');
  if (trigger) openSettings(trigger.dataset.settings);
  if (event.target.closest('button')) $('floatbar-overflow').hidden = true;
});
$('floatbar-more').addEventListener('click', (event) => {
  event.stopPropagation();
  $('floatbar-overflow').hidden = !$('floatbar-overflow').hidden;
});
document.addEventListener('click', (event) => {
  if (!$('floatbar-overflow').hidden && !event.target.closest('#floatbar-overflow') && !event.target.closest('#floatbar-more')) {
    $('floatbar-overflow').hidden = true;
  }
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
  $('guest-section').hidden = !canDo('canInvite');
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
// Whether the key went to a text field. A module that runs in the page keeps its fields in a shadow root, where
// event.target is only the root's host, so the field itself is the first thing on the event's path.
function typing(event) {
  const target = (event.composedPath && event.composedPath()[0]) || event.target;
  return Boolean(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable));
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
  else if (key === 'l') cycleView();
  else if (key === 'r') toggleTray();
  else if (key === 's' && !$('screen-share').hidden) toggleScreenShare();
  else if (key === 'f') toggleFullscreen(event.target.ownerDocument || event.target);
  else if (/^[1-6]$/.test(key)) sendReaction(REACTION_KEYS[Number(key) - 1]);
  else return;
  event.preventDefault();
}

// --- mobile viewport quirks ---------------------------------------------------

// Mobile browsers can be slow to recompute CSS's own `dvh` as their address
// and tab bar show and hide on scroll -- visualViewport's resize event
// fires the moment that actually happens, so mirroring it into a custom
// property keeps the floating controls above the browser's own chrome
// instead of sliding out from under it (see body.at-table in style.css).
function syncViewportHeight() {
  const h = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty('--app-vh', `${h}px`);
}
window.visualViewport?.addEventListener('resize', syncViewportHeight);
window.addEventListener('resize', syncViewportHeight);
syncViewportHeight();


// --- floating controls: show on movement, hide when the pointer rests --------

let idleTimer = 0;
function wake() {
  $('stage').classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const keepOpen = roomModules.nativeOpen('chat') || !$('settings').hidden || !$('react-tray').hidden || $('floatbar').matches(':hover');
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

// --- full screen ---------------------------------------------------------------

// Full screen applies to whichever document actually holds the stage right
// now -- the main window normally, or the popped-out one once it exists.
// Hardcoding `document` here would fullscreen the wrong (empty) window
// once popped out, since that's a separate top-level browsing context.
function toggleFullscreen(doc = stageDoc()) {
  if (doc.fullscreenElement) {
    doc.exitFullscreen().catch(() => {});
  } else {
    doc.documentElement.requestFullscreen().catch((err) => setStatus(`full screen: ${err.message}`, true));
  }
}
// Not just the click handler -- covers Esc and any other way the browser
// itself might leave full screen, so the button's icon never gets stuck
// showing the wrong state. Registered on the main document up front, and
// on the popout's own document once it exists (see setUpPopoutWindow).
function syncFullscreenButton() {
  const on = !!document.fullscreenElement || !!stageDoc().fullscreenElement || !!confEl.ownerDocument.fullscreenElement;
  $('fullscreen-toggle').classList.toggle('on', on);
  $('fullscreen-toggle').title = on ? 'Exit full screen (F)' : 'Full screen (F)';
}
document.addEventListener('fullscreenchange', syncFullscreenButton);
$('fullscreen-toggle').addEventListener('click', () => toggleFullscreen());

// --- install as an app / pop out ------------------------------------------------
// The button itself (and the beforeinstallprompt handling behind it) now
// lives in the shared header -- see renderTopbar()/wireInstall() in
// brand.js -- so this is just the manual-instructions fallback for
// browsers that never fire that event at all.

function describeInstall() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return '';
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return 'Add to your home screen for a full-screen table: Share, then Add to Home Screen.';
  if (/Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)) return 'For a window without browser bars: File, then Add to Dock.';
  if (/Firefox/.test(ua)) return 'Firefox has no install; Chrome, Edge or Safari can open the table in its own window.';
  return 'For a window without browser bars, use Install in the header once your browser offers it.';
}

// A plain popup window: the whole stage moves into it and comes back when
// closed, same as before. Used to be Chrome's document picture-in-picture,
// which floats over other windows automatically -- but that API caps
// itself to ~80% of the screen's work area with no way for a page to ask
// for more (confirmed against Chromium's own source, not just guessed),
// which was exactly the "can't make it bigger" complaint this replaces.
// A regular popup can be resized to fill the whole screen like any other
// window; the trade-off is it needs `popup` in its window features (and
// even then, some platforms still show a thin title bar of their own) and
// won't stay above other windows the way picture-in-picture did.
function openPopout() {
  try {
    // Open small (or at the last size used) so it fits beside the game;
    // the tiles fit whatever size the window is dragged to. Pointed at a
    // real (empty) page of ours rather than '' -- a blank popup's address
    // strip reads "about:blank", which looks broken; this way it reads our
    // own domain, which at least looks intentional. Either way the strip
    // itself can't be suppressed (see the comment above).
    const size = prefs.popout || { w: 480, h: 300 };
    const width = Math.max(240, Math.min(size.w, screen.availWidth));
    const height = Math.max(120, Math.min(size.h, screen.availHeight));
    pipWindow = window.open('/popout.html', 'app-popout', `popup,width=${width},height=${height}`);
    if (!pipWindow) throw new Error('the browser blocked the popup -- allow popups for this site and try again');
    pipWindow.addEventListener('load', () => setUpPopoutWindow(pipWindow), { once: true });
    $('popout').classList.add('on');
    $('popout').title = 'Pop it back in';
  } catch (err) {
    setStatus(`pop out: ${err.message}`, true);
  }
}

// Runs once /popout.html has actually finished loading in the new window --
// moving the stage in before then would land it in that page's own
// about:blank-era document, which the real navigation throws away.
function setUpPopoutWindow(win) {
  win.document.title = tableName;
  for (const sheet of document.querySelectorAll('link[rel="stylesheet"]')) {
    win.document.head.appendChild(sheet.cloneNode(true));
  }
  win.document.body.className = 'at-table popout';
  // The whole app moves: the header too, so everything works from where you are. Moving a
  // node adopts it into the new document, video and audio and all.
  win.document.body.appendChild(topbarEl);
  win.document.body.appendChild($('stage'));
  roomModules.stagePopped(); // the panes open again in this window
  $('away').hidden = false;
  watchPointer(win.document);
  watchOutsideClick(win.document);
  win.document.addEventListener('keydown', onKey);
  win.document.addEventListener('keyup', onKeyUp);
  // Full screen while popped out should fullscreen that window, not the
  // (now mostly empty) main one left behind -- see toggleFullscreen().
  win.document.addEventListener('fullscreenchange', syncFullscreenButton);
  // The header's links would navigate this window away from the table. They bring the app back
  // first, then do their thing on the page.
  win.document.addEventListener('click', (event) => {
    const link = event.target.closest('#topbar a[href]');
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute('href');
    closePopout();
    if (link.matches('#spaces-link, .brand-home')) showRoomList();
    else if (href === '/logout') location.href = '/logout';
    else if (link.matches('[data-overlay-link]')) openOverlay(href);
  });
  win.addEventListener('resize', () => {
    prefs.popout = { w: win.innerWidth, h: win.innerHeight };
    savePrefs();
    applyLayout();
  });
  setTimeout(applyLayout, 50);
  win.addEventListener('pagehide', () => {
    document.body.prepend(topbarEl);
    document.body.appendChild($('stage'));
    roomModules.stagePopped(); // and back in this one
    $('away').hidden = true;
    pipWindow = null;
    $('popout').classList.remove('on');
    $('popout').title = 'Pop out into its own window';
    wake();
  });
}
function closePopout() {
  if (pipWindow) pipWindow.close();
}
$('popout').addEventListener('click', () => (pipWindow ? closePopout() : openPopout()));
$('bring-back').addEventListener('click', closePopout);
$('popout').hidden = false;

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
  // Already known here -- handing them off lets the overlay's own header
  // render correctly on its very first paint instead of flashing the
  // generic default. See the matching read in renderTopbar() (brand.js).
  const serverName = document.querySelector('[data-brand="serverName"]')?.textContent;
  if (serverName) params.set('serverName', serverName);
  const homeIconEl = document.querySelector('[data-brand="home-icon"]');
  const homeIcon = homeIconEl?.dataset.iconId;
  if (homeIcon) params.set('homeIcon', homeIcon);
  $('page-overlay-frame').src = `${path}${path.includes('?') ? '&' : '?'}${params}`;
  $('page-overlay-frame').hidden = false;
  setAway(true);
}
function closeOverlay() {
  $('page-overlay-frame').hidden = true;
  $('page-overlay-frame').src = 'about:blank';
  setAway(false);
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

// --- the room list, without leaving the call ---------------------------------
// "All spaces" (the server name/icon, and its twin in the nav) would otherwise
// be a real navigation to '/' -- same page, but a fresh load drops the
// WebRTC connection entirely. The room list already lives right here on this
// page (#join), so there's nothing to load: just swap views, the same "away"
// treatment openOverlay() gives profile/admin, and stay connected underneath.
function showRoomList() {
  if (!document.body.classList.contains('at-table')) return;
  setAway(true);
  document.body.classList.remove('at-table');
  $('stage').hidden = true;
  roomModules.showFloating(false); // a floating pane lives beside the stage, not inside it
  if (guestToken) {
    $('guest-join').hidden = false;
  } else {
    $('join').hidden = false;
    loadTable();
  }
}
// The reverse: a room card recognizes the room it's still connected to (see
// renderRooms()) and offers "Rejoin" instead of "Join" -- no network round
// trip needed, just the same view swap back.
function returnToStage() {
  if (room.state !== 'connected') return;
  $('join').hidden = true;
  $('guest-join').hidden = true;
  $('stage').hidden = false;
  roomModules.showFloating(true);
  document.body.classList.add('at-table');
  updateCrumb();
  setAway(false);
}
document.addEventListener('click', (event) => {
  if (!event.target.closest('#spaces-link, .brand-home')) return;
  if (guestToken || !document.body.classList.contains('at-table')) return; // a real navigation is fine here
  event.preventDefault();
  showRoomList();
});

// `message` is the optional away message; without one the tile just says Away.
function updateAwayOverlay(identity, on, message) {
  const tile = tiles.get(identity);
  if (!tile) return;
  tile.classList.toggle('tile-away', on);
  let overlay = tile.querySelector('.tile-away-overlay');
  if (on && !overlay) {
    overlay = document.createElement('div');
    overlay.className = 'tile-away-overlay';
    tile.appendChild(overlay);
  } else if (!on && overlay) {
    overlay.remove();
    return;
  }
  if (overlay) {
    const custom = typeof message === 'string' ? message.trim().slice(0, 200) : '';
    // Icon and AWAY on top; the message, if any, under them.
    overlay.textContent = '';
    const bubble = document.createElement('div');
    bubble.className = 'away-bubble';
    const head = document.createElement('div');
    head.className = 'away-head';
    const moon = document.createElement('i');
    moon.className = 'fa-solid fa-moon fa-fw'; // the same moon as the away button
    moon.setAttribute('aria-hidden', 'true');
    head.append(moon, ' Away');
    bubble.appendChild(head);
    if (custom) {
      const msg = document.createElement('div');
      msg.className = 'away-msg';
      msg.textContent = custom;
      bubble.appendChild(msg);
    }
    overlay.appendChild(bubble);
    overlay.classList.add('custom');
  }
}

async function sendAway(on, message = '') {
  updateAwayOverlay(room.localParticipant?.identity, on, message);
  if (room.state !== 'connected') return;
  try {
    await room.localParticipant.publishData(encoder.encode(JSON.stringify({ type: 'away', on, message })), { reliable: true, topic: 'away' });
  } catch (err) {
    // best-effort: not worth surfacing to the person who just wants their profile
  }
}

// Away means away: nobody should be hearing or seeing you while your tile
// says so. Set from two places -- opening your profile/Manage over the call
// (openOverlay/closeOverlay above), and the away-toggle button for marking
// yourself away on purpose. Whichever mic/camera were actually on get
// remembered and only those come back when away turns back off, so someone
// whose camera was already off before stepping away doesn't have it turned
// on for them.
let isAway = false;
let awayRestoreMic = false;
let awayRestoreCam = false;
async function setAway(on, message = '') {
  if (on === isAway) return;
  isAway = on;
  if (on) {
    awayRestoreMic = !!room.localParticipant.isMicrophoneEnabled;
    awayRestoreCam = !!room.localParticipant.isCameraEnabled;
    if (awayRestoreMic) await room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
    if (awayRestoreCam) await room.localParticipant.setCameraEnabled(false).catch(() => {});
  } else {
    if (awayRestoreMic) await room.localParticipant.setMicrophoneEnabled(true).catch(() => {});
    if (awayRestoreCam) await setCameraEnabledWithRetry(true).catch(() => {});
  }
  reflectMic();
  const camOn = room.localParticipant.isCameraEnabled;
  $('cam').classList.toggle('on', camOn);
  $('cam').classList.toggle('off', !camOn);
  updateCamera(room.localParticipant);
  $('away-toggle').classList.toggle('off', on);
  $('away-toggle').title = on ? 'Back: unpause your mic and camera and let everyone know' : 'Away: pauses your mic and camera and lets everyone know';
  await sendAway(on, message);
}

// The away button asks for an optional message first; coming back is one click.
// Away set by opening your profile or the room list stays a plain "Away".
function closeAwayPrompt() {
  $('away-overlay').hidden = true;
}
$('away-toggle').addEventListener('click', () => {
  if (isAway) return setAway(false);
  $('away-message').value = '';
  $('away-overlay').hidden = false;
  $('away-message').focus();
});
$('away-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const message = $('away-message').value.trim();
  closeAwayPrompt();
  setAway(true, message);
});
$('away-cancel').addEventListener('click', closeAwayPrompt);
$('away-overlay').addEventListener('click', (event) => {
  if (event.target === $('away-overlay')) closeAwayPrompt();
});
$('away-message').addEventListener('keydown', (event) => {
  event.stopPropagation(); // typing here isn't a hotkey (M, V, C ...)
  if (event.key === 'Escape') closeAwayPrompt();
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) $('away-form').requestSubmit();
});

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

// Manage > Settings' call-feature toggles: hides what's turned off and
// caps the quality picker at whatever the admin set as the ceiling. Run
// once branding is in hand (init()), since these come from the server.
function applyFeatureFlags() {
  $('screen-share').hidden = !(features.allowScreenShare && canDo('shareScreen') && navigator.mediaDevices?.getDisplayMedia);
  $('react-toggle').hidden = !(features.allowReactions && canDo('react'));
  const select = $('quality');
  for (const opt of select.options) opt.hidden = Number(opt.value) > features.maxQuality;
  if (prefs.quality > features.maxQuality) {
    prefs.quality = features.maxQuality;
    savePrefs();
  }
  select.value = String(prefs.quality);
}

async function init() {
  const branding = await loadBranding();
  tableName = branding.tableName || tableName;
  features = {
    maxQuality: branding.maxQuality || 720,
    allowScreenShare: branding.allowScreenShare !== false,
    allowAsides: branding.allowAsides !== false,
    allowPrivate: branding.allowPrivate !== false,
    allowReactions: branding.allowReactions !== false,
  };
  applyFeatureFlags();
  // The topbar dropped its own version readout -- too cramped alongside
  // everything else there. It's in the title bar instead, which reads as
  // the room's real native window title once installed as an app.
  if (branding.version) document.title += ` — ${branding.version}`;
  renderReactionTray(branding.reactions);
  updateCrumb();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  syncLayoutPick();
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
    $('rooms-link').hidden = true;
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
      // Re-clamp: the account's own stored quality could predate whatever
      // the server's maxQuality cap is set to now.
      applyPermissions();
      populateCallSettingsUI();
    }
    await loadTable(); // the join screen's member grid
  } catch (err) {
    location.href = '/login';
    return;
  }
  // Following an invitation from another page: "/#join=<room>" goes straight into that room.
  const invited = /^#join=([a-z0-9]{4,16})$/.exec(location.hash);
  if (invited) {
    history.replaceState(null, '', location.pathname + location.search);
    joinInvitedRoom(invited[1]);
  } else if (!guestToken && rememberedRoom()) {
    // A reload: back into the room this tab was in, if it is still there for this person.
    const again = tableRooms.find((r) => r.id === rememberedRoom() && !r.ephemeral);
    if (again) join(again.id);
    else forgetRoom();
  }
}
init();
