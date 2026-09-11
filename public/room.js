// The table: players see and hear each other.
import { Room, RoomEvent, Track, createLocalTracks } from '/lib/livekit-client.esm.mjs';
import { loadBranding, api } from '/brand.js';

const $ = (id) => document.getElementById(id);
const room = new Room({ adaptiveStream: true, dynacast: true });
const tiles = new Map(); // participant identity (user key) -> tile element
let me = null;
let tableName = 'The Table';

function setStatus(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}

function tileFor(participant) {
  let tile = tiles.get(participant.identity);
  if (tile) return tile;
  tile = document.createElement('div');
  tile.className = 'tile';
  tile.dataset.identity = participant.identity;
  const placeholder = document.createElement('img');
  placeholder.className = 'placeholder';
  placeholder.alt = '';
  placeholder.src = `/img/${encodeURIComponent(participant.identity)}/novideo`;
  tile.appendChild(placeholder);
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = participant.name || participant.identity;
  tile.appendChild(name);
  tiles.set(participant.identity, tile);
  $('grid').appendChild(tile);
  return tile;
}

function attachTrack(participant, track) {
  const tile = tileFor(participant);
  if (track.kind === Track.Kind.Video) {
    tile.querySelector('video')?.remove();
    const video = track.attach();
    video.muted = true; // audio comes through its own element
    tile.prepend(video);
    tile.querySelector('.placeholder').hidden = true;
  } else if (track.kind === Track.Kind.Audio) {
    if (participant.isLocal) return; // never play your own voice back
    const audio = track.attach();
    audio.dataset.identity = participant.identity;
    document.body.appendChild(audio);
  }
}

function detachTrack(participant, track) {
  track.detach().forEach((el) => el.remove());
  const tile = tiles.get(participant.identity);
  if (tile && track.kind === Track.Kind.Video) tile.querySelector('.placeholder').hidden = false;
}

function removeParticipant(participant) {
  const tile = tiles.get(participant.identity);
  if (tile) tile.remove();
  tiles.delete(participant.identity);
  document.querySelectorAll(`audio[data-identity="${CSS.escape(participant.identity)}"]`).forEach((el) => el.remove());
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
  tile.querySelector('.placeholder').hidden = !off && !!video;
}

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
  })
  .on(RoomEvent.Reconnecting, () => setStatus('reconnecting...'))
  .on(RoomEvent.Reconnected, () => setStatus(`at ${tableName}`))
  .on(RoomEvent.Disconnected, () => {
    setStatus('left the table');
    $('grid').hidden = true;
    $('controls').hidden = true;
    $('join').hidden = false;
    for (const [, tile] of tiles) tile.remove();
    tiles.clear();
    document.querySelectorAll('audio').forEach((el) => el.remove());
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
  for (const [kind, select] of [['audioinput', $('mic-select')], ['videoinput', $('cam-select')]]) {
    select.textContent = '';
    for (const d of devices.filter((d) => d.kind === kind)) {
      const option = document.createElement('option');
      option.value = d.deviceId;
      option.textContent = d.label || kind;
      select.appendChild(option);
    }
  }
}

async function join() {
  $('join-error').hidden = true;
  $('join-button').disabled = true;
  try {
    setStatus('connecting...');
    const { token, livekitUrl } = await api('POST', '/api/token', {});
    await room.connect(livekitUrl, token);
    console.debug('[tavern] connected');
    $('join').hidden = true;
    $('grid').hidden = false;
    $('controls').hidden = false;
    setStatus(`at ${tableName}`);

    const tile = tileFor(room.localParticipant);
    tile.classList.add('mirror');
    for (const p of room.remoteParticipants.values()) {
      tileFor(p);
      updateMuted(p);
    }
    // Ask for the microphone and the camera separately: a player with no
    // camera (or who declines it) still joins with audio, and the other way
    // round. Each one that works is published; each that fails is reported.
    const missing = [];
    const tracks = [];
    try {
      tracks.push(...(await createLocalTracks({ audio: true })));
    } catch (err) {
      console.warn('[tavern] no microphone:', err.message);
      missing.push('microphone');
    }
    try {
      tracks.push(...(await createLocalTracks({ video: { resolution: { width: 1280, height: 720 } } })));
    } catch (err) {
      console.warn('[tavern] no camera:', err.message);
      missing.push('camera');
    }
    console.debug('[tavern] local tracks', tracks.map((t) => t.kind).join(',') || 'none');
    for (const track of tracks) {
      await room.localParticipant.publishTrack(track);
      console.debug('[tavern] published', track.kind);
    }
    updateMuted(room.localParticipant);
    updateCamera(room.localParticipant);
    await fillDevices();
    const haveMic = tracks.some((t) => t.kind === Track.Kind.Audio);
    const haveCam = tracks.some((t) => t.kind === Track.Kind.Video);
    $('mic').classList.toggle('on', haveMic);
    $('mic').classList.toggle('off', !haveMic);
    $('cam').classList.toggle('on', haveCam);
    $('cam').classList.toggle('off', !haveCam);
    if (missing.length) setStatus(`at ${tableName} (no ${missing.join(' or ')})`);
  } catch (err) {
    setStatus('', false);
    $('join-error').textContent = err.message;
    $('join-error').hidden = false;
    await room.disconnect().catch(() => {});
  } finally {
    $('join-button').disabled = false;
  }
}

$('join-button').addEventListener('click', join);

$('mic').addEventListener('click', async () => {
  const enabled = !room.localParticipant.isMicrophoneEnabled;
  try {
    await room.localParticipant.setMicrophoneEnabled(enabled);
  } catch (err) {
    setStatus(`microphone: ${err.message}`, true);
  }
  const on = room.localParticipant.isMicrophoneEnabled;
  $('mic').classList.toggle('on', on);
  $('mic').classList.toggle('off', !on);
  updateMuted(room.localParticipant);
});
$('cam').addEventListener('click', async () => {
  const enabled = !room.localParticipant.isCameraEnabled;
  try {
    await room.localParticipant.setCameraEnabled(enabled);
  } catch (err) {
    setStatus(`camera: ${err.message}`, true);
  }
  const on = room.localParticipant.isCameraEnabled;
  $('cam').classList.toggle('on', on);
  $('cam').classList.toggle('off', !on);
  updateCamera(room.localParticipant);
});
$('mic-select').addEventListener('change', (e) => room.switchActiveDevice('audioinput', e.target.value));
$('cam-select').addEventListener('change', (e) => room.switchActiveDevice('videoinput', e.target.value));
$('leave').addEventListener('click', () => room.disconnect());
window.addEventListener('beforeunload', () => room.disconnect());

async function init() {
  const branding = await loadBranding();
  tableName = branding.tableName || tableName;
  try {
    const info = await api('GET', '/api/me');
    me = info.user;
    $('whoami').textContent = me.displayName;
    $('admin-link').hidden = me.role !== 'admin';
  } catch (err) {
    location.href = '/login';
  }
}
init();
