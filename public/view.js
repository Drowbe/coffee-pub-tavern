// OBS view of one user on a transparent background.
//   /view/<key>?s=<stream key>&kind=player|character&plate=1&debug=1
//
// player:    the camera when it is on, the Player image when it is off; the
//            talking border and the muted badge as set for the user, plus the
//            optional Player talking / muted overlay images. Audio always plays;
//            whether it reaches the OBS mixer is OBS's "Control audio via OBS".
// character: the Character image (nothing if none is set) with the Talking
//            image on top while they speak and the Muted image while muted.
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
const showPlate = params.get('plate') === '1';
const withAudio = kind === 'player' && params.get('audio') !== '0';
const debug = params.get('debug') === '1';
const room = new Room({ adaptiveStream: false });
// The character box never needs the media: subscribe to nothing.
const connectOptions = { autoSubscribe: kind === 'player' };

// Slots this kind draws, as blob URLs (null when the user has none).
const slots = kind === 'player' ? ['player', 'playerTalking', 'playerMuted'] : ['character', 'talking', 'muted'];
const images = Object.fromEntries(slots.map((s) => [s, null]));
let settings = { border: true, borderColor: '#6fae6b', badge: true, displayName: '' };
let participant = null;
let speaking = false;
let cameraOn = false;
let micOn = false;

function msg(text) {
  if (!debug) return;
  $('msg').textContent = text;
  $('msg').hidden = !text;
}

async function loadImages() {
  for (const slot of slots) {
    try {
      const res = await fetch(`/img/${encodeURIComponent(wanted)}/${slot}?s=${encodeURIComponent(streamKey)}`);
      if (images[slot]) URL.revokeObjectURL(images[slot]);
      images[slot] = res.ok ? URL.createObjectURL(await res.blob()) : null;
    } catch (err) {
      // keep whatever we had
    }
  }
  render();
}

async function loadSettings() {
  try {
    const res = await fetch(`/api/table?s=${encodeURIComponent(streamKey)}`);
    if (!res.ok) return;
    const { users } = await res.json();
    const me = users.find((u) => u.key === wanted);
    if (me) settings = { border: me.border, borderColor: me.borderColor, badge: me.badge, displayName: me.displayName };
    document.documentElement.style.setProperty('--talk', settings.borderColor);
  } catch (err) {
    // defaults stand
  }
  render();
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
  let state = 'blank';
  if (kind === 'player') {
    if (online && cameraOn && video) state = 'video';
    else if (online) state = 'image';
    if (video) video.hidden = state !== 'video';
    setImage($('base'), state === 'image' ? images.player : null);
    setImage($('overlay-talking'), talking ? images.playerTalking : null);
    setImage($('overlay-muted'), muted ? images.playerMuted : null);
    document.body.classList.toggle('talking', settings.border && talking && state !== 'blank');
    $('badge').hidden = !(settings.badge && muted && state !== 'blank');
  } else {
    state = online ? 'image' : 'blank';
    setImage($('base'), online ? images.character : null);
    setImage($('overlay-talking'), talking ? images.talking : null);
    setImage($('overlay-muted'), muted ? images.muted : null);
    document.body.classList.remove('talking');
    $('badge').hidden = true;
  }
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

function adopt(p) {
  if (p.identity !== wanted) return;
  participant = p;
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
    const res = await fetch(`/api/token?s=${encodeURIComponent(streamKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'viewer' }),
    });
    if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
    const { token, livekitUrl } = await res.json();
    await room.connect(livekitUrl, token, connectOptions);
    for (const p of room.remoteParticipants.values()) adopt(p);
    render();
  } catch (err) {
    msg(err.message);
    setTimeout(connect, 5000);
  }
}

loadSettings();
loadImages();
setInterval(() => {
  loadImages();
  loadSettings();
}, 5 * 60000); // pick up replaced images and colours without a reload
connect();
