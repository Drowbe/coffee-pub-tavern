// OBS view of one user on a transparent background.
//   /view/<key>?s=<stream key>&kind=player|character&debug=1
//
// player:    the camera when it is on, the Online picture when it is off, the
//            Offline picture (or nothing) away from the table; the talking or
//            muted border and the name plate as set for the user, plus the
//            Talking / Muted pictures laid on top. Nothing else is drawn.
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
const slots = kind === 'player' ? ['playerOffline', 'player', 'playerTalking', 'playerMuted'] : ['characterOffline', 'character', 'talking', 'muted'];
const images = Object.fromEntries(slots.map((s) => [s, null]));
let settings = { border: true, borderColor: '#6fae6b', borderWidth: 6, mutedBorder: true, mutedColor: '#b8503f', plate: false, pictureBackground: false, pictureColor: '#1a1410', pictureScale: 100, displayName: '' };
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

// The Tavern room the player is in right now (the Lobby while they are
// away); this box follows them from room to room, and its own per-room
// images (if that room has any) follow along too.
let playerRoom = 'lobby';
let lastImageRoom = playerRoom;
let connectedRoom = null;

async function loadSettings() {
  try {
    const res = await fetch(`/api/table?s=${encodeURIComponent(streamKey)}`);
    if (!res.ok) return;
    const { users, reactions } = await res.json();
    REACTIONS = Object.fromEntries((reactions || []).map((r) => [r.id, r.glyph]));
    const me = users.find((u) => u.key === wanted);
    if (me) {
      settings = { border: me.border, borderColor: me.borderColor, borderWidth: me.borderWidth || 6, mutedBorder: me.mutedBorder !== false, mutedColor: me.mutedColor || '#b8503f', plate: Boolean(me.plate), charBorder: Boolean(me.charBorder), charBorderColor: me.charBorderColor || '#6fae6b', charMutedBorder: Boolean(me.charMutedBorder), charMutedColor: me.charMutedColor || '#b8503f', charBorderWidth: me.charBorderWidth || 6, pictureBackground: Boolean(me.pictureBackground), pictureColor: me.pictureColor || '#1a1410', pictureScale: me.pictureScale || 100, displayName: me.displayName };
      playerRoom = (me.online && me.room) || 'lobby';
    }
    const b = borders();
    document.documentElement.style.setProperty('--talk', b.talkColor);
    document.documentElement.style.setProperty('--talk-w', `${b.width}px`);
    document.documentElement.style.setProperty('--mute', b.muteColor);
    // Player box only: the picture's size and the colour behind it.
    const scale = kind === 'player' ? settings.pictureScale : 100;
    document.documentElement.style.setProperty('--pic-inset', `${(100 - scale) / 2}%`);
    document.documentElement.style.setProperty('--pic-bg', settings.pictureColor);
    document.body.classList.toggle('picture-bg', kind === 'player' && settings.pictureBackground);
    if (playerRoom !== lastImageRoom) {
      lastImageRoom = playerRoom;
      loadImages();
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

function render() {
  const online = !!participant;
  const video = document.querySelector('video');
  const muted = online && !micOn;
  const talking = online && speaking && micOn;
  // blank: nothing at all; offline: the Offline picture; image: the online
  // picture (player or character); video: the camera.
  let state = 'blank';
  if (kind === 'player') {
    if (online && cameraOn && video) state = 'video';
    else if (online) state = 'image';
    else if (images.playerOffline) state = 'offline';
    if (video) video.hidden = state !== 'video';
    setImage($('base'), state === 'image' ? images.player : state === 'offline' ? images.playerOffline : null);
    setImage($('overlay-talking'), talking ? images.playerTalking : null);
    setImage($('overlay-muted'), muted ? images.playerMuted : null);
  } else {
    state = online ? 'image' : images.characterOffline ? 'offline' : 'blank';
    setImage($('base'), online ? images.character : state === 'offline' ? images.characterOffline : null);
    setImage($('overlay-talking'), talking ? images.talking : null);
    setImage($('overlay-muted'), muted ? images.muted : null);
  }
  const b = borders();
  document.body.classList.toggle('talking', b.talk && talking && state !== 'blank');
  document.body.classList.toggle('muted-frame', b.mute && muted && state !== 'blank');
  // The Player option applies to the player box; plate=1 forces it on either kind.
  const showPlate = forcePlate || (kind === 'player' && settings.plate);
  $('plate').hidden = !(showPlate && state !== 'blank');
  if (showPlate) $('plate').textContent = participant?.name || settings.displayName || wanted;
  document.body.dataset.state = state;
  document.body.dataset.talking = talking ? '1' : '';
  document.body.dataset.muted = muted ? '1' : '';
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
setInterval(loadSettings, 5000); // colours, options, and which room the player is in
loadSettings().then(connect);
