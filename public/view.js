// OBS view of one user on a transparent background.
//   /view/<key>?s=<stream key>&kind=player|character&debug=1
//
// player:    the camera when it is on, the Online picture when it is off, the
//            Offline picture (or nothing) away from the table; the talking or
//            muted border and the name plate as set for the user, plus the
//            Talking / Muted / Aside / Private pictures laid on top (Aside
//            and Private also dim+tint per Manage > Settings, and Private
//            always forces the live camera off regardless of any of this).
//            Audio always plays; whether it reaches the OBS mixer is OBS's
//            "Control audio via OBS". plate=1 in the link forces the plate on.
// Both kinds float the player's reactions up the box; reactions=0 turns
// that off for a source that should stay clean.
// character: the Online picture (Offline away from the table, nothing when
//            unset) with Talking on top while they speak and Muted while muted.
//            Made to sit over a character bar as a second source. No audio.
//
// Older links: mode=auto|video -> player, mode=avatar|status -> character.
import { Room, RoomEvent, Track } from '/lib/livekit-client.esm.mjs';

const $ = (id) => document.getElementById(id);
const wanted = decodeURIComponent(location.pathname.split('/')[2] || '');
const params = new URLSearchParams(location.search);
const streamKey = params.get('s') || '';
const legacy = { auto: 'player', video: 'player', avatar: 'character', status: 'character' };
const kind = params.get('kind') === 'character' || params.get('kind') === 'player' ? params.get('kind') : legacy[params.get('mode')] || 'player';
document.body.dataset.kind = kind;
const forcePlate = params.get('plate') === '1';
const withReactions = params.get('reactions') !== '0';
let REACTIONS = {}; // id -> glyph, from the server's reaction list (Manage > Settings)
const withAudio = kind === 'player' && params.get('audio') !== '0';
const debug = params.get('debug') === '1';
const room = new Room({ adaptiveStream: false });
// The player box takes everything; the character box picks the microphone
// alone once the player is found (see subscribeForCharacter).
const connectOptions = { autoSubscribe: kind === 'player' };

// Slots this kind draws, as blob URLs (null when the user has none).
const slots = kind === 'player' ? ['playerOffline', 'player', 'playerTalking', 'playerMuted', 'playerAside', 'playerPrivate'] : ['characterOffline', 'character', 'talking', 'muted'];
const images = Object.fromEntries(slots.map((s) => [s, null]));
let settings = { border: true, borderColor: '#6fae6b', borderWidth: 6, mutedBorder: true, mutedColor: '#b8503f', plate: false, plateLayout: 'lower-left', plateColor: '#000000', plateTextColor: '#f1e6d8', plateFontSize: 16, plateOpacity: 60, plateTextCase: 'default', pictureBackground: false, pictureColor: '#1a1410', pictureScale: 100, displayName: '' };
// Each kind draws its own borders: the player's (per user) or the character's (server-wide).
function borders() {
  if (kind === 'player') return { talk: settings.border, talkColor: settings.borderColor, mute: settings.mutedBorder, muteColor: settings.mutedColor, width: settings.borderWidth };
  return { talk: settings.charBorder, talkColor: settings.charBorderColor, mute: settings.charMutedBorder, muteColor: settings.charMutedColor, width: settings.charBorderWidth };
}
let participant = null;
let speaking = false;
let cameraOn = false;
let micOn = false;

function msg(text) {
  if (!debug) return;
  $('msg').textContent = text;
  $('msg').hidden = !text;
}

// Whichever room this person is in right now (playerRoom, from loadSettings)
// may have its own picture for a slot; falls back to their default when it
// doesn't, same as the server does. Re-run whenever playerRoom changes, not
// just on the slow 5-minute poll, so following someone into a differently
// cast room shows the right picture promptly.
async function loadImages() {
  const q = new URLSearchParams({ s: streamKey });
  if (playerRoom) q.set('room', playerRoom);
  for (const slot of slots) {
    try {
      const res = await fetch(`/img/${encodeURIComponent(wanted)}/${slot}?${q}`);
      if (images[slot]) URL.revokeObjectURL(images[slot]);
      images[slot] = res.ok ? URL.createObjectURL(await res.blob()) : null;
    } catch (err) {
      // keep whatever we had
    }
  }
  render();
}

// The player's own video-background picture (profile page, used live to
// replace their real background) -- reused here as what sits behind a
// paused camera's portrait, in place of the flat picture colour, when
// they have one set. Player box only; the character box never shows it.
let bgImage = null;
async function loadBgImage() {
  const q = new URLSearchParams({ s: streamKey });
  if (playerRoom) q.set('room', playerRoom);
  try {
    const res = await fetch(`/img/${encodeURIComponent(wanted)}/background?${q}`);
    if (bgImage) URL.revokeObjectURL(bgImage);
    bgImage = res.ok ? URL.createObjectURL(await res.blob()) : null;
  } catch (err) {
    // keep whatever we had
  }
  render();
}

// The Tavern room the player is in right now (the Lobby while they are
// away); this box follows them from room to room, and its own per-room
// images (if that room has any) follow along too.
let playerRoom = 'lobby';
let lastImageRoom = playerRoom;
let connectedRoom = null;

// Offline/Aside dim+tint: used to be an OBS Color Correction filter on
// Studio's side, moved here since that filter corrupted these sources'
// alpha transparency even at neutral settings. tableOnline is server-
// tracked LiveKit presence (not the local `participant`/`online` below,
// which is just whether this page's own connection currently has them
// attached); aside means online, but not in the room the stream is
// currently following (activeRoom) -- only meaningful when an admin is
// actually online, otherwise there's no reference room to be aside from.
let tableOnline = false;
let isAside = false;
let isPrivate = false;
// Two independent effects per state: Dim (a plain brightness filter over
// the whole box) and Tint (a colour overlay with its own opacity) --
// deliberately not combined into one, so either can be used alone.
let dimSettings = {
  offlineDim: 0, offlineTint: '#000000', offlineTintOpacity: 0,
  asideDim: 0, asideTint: '#000000', asideTintOpacity: 0,
  privateDim: 0, privateTint: '#000000', privateTintOpacity: 0,
};

function hexToRgba(hex, level) {
  const n = parseInt(String(hex).slice(1), 16) || 0;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(100, level)) / 100})`;
}

async function loadSettings() {
  try {
    const res = await fetch(`/api/table?s=${encodeURIComponent(streamKey)}`);
    if (!res.ok) return;
    const data = await res.json();
    const { users, reactions } = data;
    REACTIONS = Object.fromEntries((reactions || []).map((r) => [r.id, r.glyph]));
    const me = users.find((u) => u.key === wanted);
    if (me) {
      settings = { border: me.border, borderColor: me.borderColor, borderWidth: me.borderWidth || 6, mutedBorder: me.mutedBorder !== false, mutedColor: me.mutedColor || '#b8503f', plate: Boolean(me.plate), plateLayout: me.plateLayout || 'lower-left', plateColor: me.plateColor || '#000000', plateTextColor: me.plateTextColor || '#f1e6d8', plateFontSize: me.plateFontSize || 16, plateOpacity: me.plateOpacity ?? 60, plateTextCase: me.plateTextCase || 'default', charBorder: Boolean(me.charBorder), charBorderColor: me.charBorderColor || '#6fae6b', charMutedBorder: Boolean(me.charMutedBorder), charMutedColor: me.charMutedColor || '#b8503f', charBorderWidth: me.charBorderWidth || 6, pictureBackground: Boolean(me.pictureBackground), pictureColor: me.pictureColor || '#1a1410', pictureScale: me.pictureScale || 100, displayName: me.displayName };
      playerRoom = (me.online && me.room) || 'lobby';
      tableOnline = Boolean(me.online);
      isAside = tableOnline && Boolean(data.adminOnline) && me.room !== data.activeRoom;
      // Studio mutes a Private Conversation's audio but no longer hides the
      // OBS source itself -- this page is now the only thing standing
      // between a genuinely off-the-record moment and it being visibly on
      // stream. render() forces the live video off entirely for this case
      // (see isPrivate there); the picture/name plate still show, same as
      // camera-off, dressed with its own dim+tint below rather than aside's.
      const room = tableOnline ? (data.rooms || []).find((r) => r.id === me.room) : null;
      isPrivate = Boolean(room?.ephemeral && room?.private);
    } else {
      tableOnline = false;
      isAside = false;
      isPrivate = false;
    }
    dimSettings = {
      offlineDim: data.offlineDim ?? 0, offlineTint: data.offlineTint || '#000000', offlineTintOpacity: data.offlineTintOpacity ?? 0,
      asideDim: data.asideDim ?? 0, asideTint: data.asideTint || '#000000', asideTintOpacity: data.asideTintOpacity ?? 0,
      privateDim: data.privateDim ?? 0, privateTint: data.privateTint || '#000000', privateTintOpacity: data.privateTintOpacity ?? 0,
    };
    const b = borders();
    document.documentElement.style.setProperty('--talk', b.talkColor);
    document.documentElement.style.setProperty('--talk-w', `${b.width}px`);
    document.documentElement.style.setProperty('--mute', b.muteColor);
    // Player box only: the picture's size and the colour behind it.
    const scale = kind === 'player' ? settings.pictureScale : 100;
    document.documentElement.style.setProperty('--pic-inset', `${(100 - scale) / 2}%`);
    document.documentElement.style.setProperty('--pic-scale', scale);
    document.documentElement.style.setProperty('--pic-bg', settings.pictureColor);
    document.body.classList.toggle('picture-bg', kind === 'player' && settings.pictureBackground);
    document.documentElement.style.setProperty('--plate-bg', settings.plateColor);
    document.documentElement.style.setProperty('--plate-opacity', `${settings.plateOpacity}%`);
    document.documentElement.style.setProperty('--plate-color', settings.plateTextColor);
    document.documentElement.style.setProperty('--plate-size', `${settings.plateFontSize}px`);
    $('plate').dataset.plate = settings.plateLayout;
    if (playerRoom !== lastImageRoom) {
      lastImageRoom = playerRoom;
      loadImages();
      if (kind === 'player') loadBgImage();
    }
  } catch (err) {
    // defaults stand
  }
  render();
  if (connectedRoom && playerRoom !== connectedRoom) {
    msg(`following ${settings.displayName || wanted}...`);
    await room.disconnect().catch(() => {}); // Disconnected reconnects, to the new room
  }
}

function setImage(el, src) {
  el.hidden = !src;
  if (src && el.getAttribute('src') !== src) el.src = src;
}

// The plate's own casing, independent of however the name was actually typed.
function applyPlateCase(text) {
  if (settings.plateTextCase === 'upper') return text.toUpperCase();
  if (settings.plateTextCase === 'lower') return text.toLowerCase();
  if (settings.plateTextCase === 'sentence') {
    const lower = text.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }
  return text;
}

function render() {
  const online = !!participant;
  const video = document.querySelector('video');
  // Private Conversation: never the live video feed (the one genuinely
  // sensitive thing), and shown as muted regardless of real mic state --
  // Studio mutes their audio input, so this stays honest with what
  // viewers actually hear. Everything else renders exactly like normal:
  // their picture, their name plate, the aside dim+tint below (a private
  // pair reads as "aside" the same as an ordinary one, on top of the
  // video being forced off). This is "camera off", not "doesn't exist" --
  // the two people actually in the private room still see each other
  // completely normally, in Tavern itself; this page is what everyone
  // else (and Studio) sees, and that was always the only piece missing.
  const muted = (online && !micOn) || isPrivate;
  const talking = online && speaking && micOn && !isPrivate;
  // blank: nothing at all; offline: the Offline picture; image: the online
  // picture (player or character); video: the camera.
  let state = 'blank';
  if (kind === 'player') {
    if (online && cameraOn && video && !isPrivate) state = 'video';
    else if (online) state = 'image';
    else if (images.playerOffline) state = 'offline';
    if (video) video.hidden = state !== 'video';
    setImage($('base'), state === 'image' ? images.player : state === 'offline' ? images.playerOffline : null);
    setImage($('overlay-talking'), talking ? images.playerTalking : null);
    setImage($('overlay-muted'), muted ? images.playerMuted : null);
    setImage($('overlay-aside'), isAside ? images.playerAside : null);
    setImage($('overlay-private'), isPrivate ? images.playerPrivate : null);
  } else {
    state = online ? 'image' : images.characterOffline ? 'offline' : 'blank';
    setImage($('base'), online ? images.character : state === 'offline' ? images.characterOffline : null);
    setImage($('overlay-talking'), talking ? images.talking : null);
    setImage($('overlay-muted'), muted ? images.muted : null);
  }
  const showBgImage = kind === 'player' && settings.pictureBackground && (state === 'image' || state === 'offline') && !!bgImage;
  setImage($('bg-image'), showBgImage ? bgImage : null);
  const b = borders();
  document.body.classList.toggle('talking', b.talk && talking && state !== 'blank');
  document.body.classList.toggle('muted-frame', b.mute && muted && state !== 'blank');
  // The Player option applies to the player box; plate=1 forces it on either kind.
  const showPlate = forcePlate || (kind === 'player' && settings.plate);
  $('plate').hidden = !(showPlate && state !== 'blank');
  if (showPlate) $('plate').textContent = applyPlateCase(participant?.name || settings.displayName || wanted);
  document.body.dataset.state = state;
  document.body.dataset.talking = talking ? '1' : '';
  document.body.dataset.muted = muted ? '1' : '';
  // Dim (a brightness filter over the whole box) and Tint (a colour
  // overlay with its own opacity) are independent effects -- either, both,
  // or neither can be set per state. Not gated on state !== 'blank':
  // someone with no picture configured at all should still read as
  // offline/aside/private rather than staying invisible just because
  // there's no picture underneath to dim or tint. Private takes its own
  // settings rather than falling through to aside's, even though a
  // private pair is also, mechanically, "aside".
  let statePrefix = null;
  if (!tableOnline) statePrefix = 'offline';
  else if (isPrivate) statePrefix = 'private';
  else if (isAside) statePrefix = 'aside';
  const tintOpacity = statePrefix ? dimSettings[`${statePrefix}TintOpacity`] : 0;
  const tint = statePrefix && tintOpacity > 0 ? hexToRgba(dimSettings[`${statePrefix}Tint`], tintOpacity) : null;
  $('dim').hidden = !tint;
  if (tint) document.documentElement.style.setProperty('--dim', tint);
  const dimLevel = statePrefix ? dimSettings[`${statePrefix}Dim`] : 0;
  document.documentElement.style.setProperty('--brightness', String(1 - Math.max(0, Math.min(100, dimLevel)) / 100));
  msg(online ? '' : 'waiting for player');
}

function refreshFlags() {
  if (!participant) {
    cameraOn = false;
    micOn = false;
    speaking = false;
    return;
  }
  const cam = participant.getTrackPublication(Track.Source.Camera);
  const mic = participant.getTrackPublication(Track.Source.Microphone);
  cameraOn = !!cam && !cam.isMuted && !!cam.track;
  micOn = !!mic && !mic.isMuted;
}

// A reaction from the player, sent over the data channel by their table page.
function showReaction(id) {
  const glyph = REACTIONS[id];
  if (!glyph || !withReactions) return;
  const el = document.createElement('span');
  el.className = 'reaction';
  el.textContent = glyph;
  el.style.left = `${20 + Math.random() * 60}%`;
  el.addEventListener('animationend', () => el.remove());
  setTimeout(() => el.remove(), 3000); // a hidden tab never fires animationend
  document.body.appendChild(el);
}

// The character box subscribes to the player's microphone only, and never
// plays it: LiveKit delivers "who is talking" over the subscriber link, so
// a box subscribed to nothing would never see them talk.
function subscribeForCharacter(p) {
  if (kind === 'player') return;
  for (const pub of p.trackPublications.values()) {
    if (pub.kind === Track.Kind.Audio && !pub.isSubscribed) pub.setSubscribed(true);
  }
}

function adopt(p) {
  if (p.identity !== wanted) return;
  participant = p;
  subscribeForCharacter(p);
  refreshFlags();
  render();
}

function drop(p) {
  if (p.identity !== wanted) return;
  participant = null;
  document.querySelectorAll('video, audio').forEach((el) => el.remove());
  refreshFlags();
  render();
}

room
  .on(RoomEvent.ParticipantConnected, adopt)
  .on(RoomEvent.ParticipantDisconnected, drop)
  .on(RoomEvent.TrackPublished, (_pub, p) => adopt(p))
  .on(RoomEvent.TrackSubscribed, (track, _pub, p) => {
    if (p.identity !== wanted) return;
    participant = p;
    if (kind !== 'player') return;
    if (track.kind === Track.Kind.Video) {
      document.querySelector('video')?.remove();
      document.body.prepend(track.attach());
    } else if (track.kind === Track.Kind.Audio && withAudio) {
      document.body.appendChild(track.attach());
    }
    refreshFlags();
    render();
  })
  .on(RoomEvent.TrackUnsubscribed, (track, _pub, p) => {
    if (p.identity !== wanted) return;
    track.detach().forEach((el) => el.remove());
    refreshFlags();
    render();
  })
  .on(RoomEvent.TrackMuted, (_pub, p) => adopt(p))
  .on(RoomEvent.TrackUnmuted, (_pub, p) => adopt(p))
  .on(RoomEvent.DataReceived, (payload, p, _kind, topic) => {
    if (topic !== 'reaction' || !p || p.identity !== wanted) return;
    try {
      const data = JSON.parse(new TextDecoder().decode(payload));
      if (data.type === 'reaction') showReaction(data.id);
    } catch (err) {
      // not ours
    }
  })
  .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
    const now = speakers.some((s) => s.identity === wanted);
    if (now !== speaking) {
      speaking = now;
      render();
    }
  })
  .on(RoomEvent.Disconnected, () => {
    participant = null;
    document.querySelectorAll('video, audio').forEach((el) => el.remove());
    refreshFlags();
    render();
    msg('disconnected');
    setTimeout(connect, 3000);
  });

async function connect() {
  try {
    const target = playerRoom;
    const res = await fetch(`/api/token?s=${encodeURIComponent(streamKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'viewer', room: target }),
    });
    if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
    const { token, livekitUrl } = await res.json();
    await room.connect(livekitUrl, token, connectOptions);
    connectedRoom = target;
    for (const p of room.remoteParticipants.values()) adopt(p);
    render();
  } catch (err) {
    msg(err.message);
    setTimeout(connect, 5000);
  }
}

room.on(RoomEvent.Disconnected, () => {
  connectedRoom = null;
});

loadImages();
setInterval(loadImages, 5 * 60000); // pick up replaced images without a reload
if (kind === 'player') {
  loadBgImage();
  setInterval(loadBgImage, 5 * 60000);
}
setInterval(loadSettings, 5000); // colours, options, and which room the player is in
loadSettings().then(connect);
