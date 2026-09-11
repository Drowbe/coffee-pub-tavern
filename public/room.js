// The table: players see and hear each other.
import { Room, RoomEvent, Track, createLocalTracks } from '/lib/livekit-client.esm.mjs';

const $ = (id) => document.getElementById(id);
const room = new Room({ adaptiveStream: true, dynacast: true });
const roomName = decodeURIComponent(location.pathname.split('/')[2] || 'tavern');
const params = new URLSearchParams(location.search);
const tiles = new Map(); // participant identity -> tile element

$('name').value = params.get('name') || localStorage.getItem('tavern.name') || '';
$('key').value = params.get('key') || localStorage.getItem('tavern.key') || '';

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
  const placeholder = document.createElement('div');
  placeholder.className = 'placeholder';
  placeholder.textContent = '☕';
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

room
  .on(RoomEvent.TrackSubscribed, (track, _pub, participant) => attachTrack(participant, track))
  .on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => detachTrack(participant, track))
  .on(RoomEvent.LocalTrackPublished, (pub) => pub.track && attachTrack(room.localParticipant, pub.track))
  .on(RoomEvent.LocalTrackUnpublished, (pub) => pub.track && detachTrack(room.localParticipant, pub.track))
  .on(RoomEvent.ParticipantConnected, (p) => tileFor(p))
  .on(RoomEvent.ParticipantDisconnected, removeParticipant)
  .on(RoomEvent.TrackMuted, (_pub, participant) => updateMuted(participant))
  .on(RoomEvent.TrackUnmuted, (_pub, participant) => updateMuted(participant))
  .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
    const active = new Set(speakers.map((s) => s.identity));
    for (const [identity, tile] of tiles) tile.classList.toggle('speaking', active.has(identity));
  })
  .on(RoomEvent.Reconnecting, () => setStatus('reconnecting...'))
  .on(RoomEvent.Reconnected, () => setStatus(`at ${roomName}`))
  .on(RoomEvent.Disconnected, () => {
    setStatus('left the table');
    $('grid').hidden = true;
    $('controls').hidden = true;
    $('join').hidden = false;
  });

async function fillDevices() {
  const devices = await Room.getLocalDevices();
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

$('join').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('join-error').hidden = true;
  const name = $('name').value.trim();
  const key = $('key').value.trim();
  try {
    setStatus('connecting...');
    const res = await fetch('/api/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ room: roomName, name, key }),
    });
    if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
    const { token, livekitUrl } = await res.json();
    localStorage.setItem('tavern.name', name);
    localStorage.setItem('tavern.key', key);

    await room.connect(livekitUrl, token);
    console.debug('[tavern] connected');
    $('join').hidden = true;
    $('grid').hidden = false;
    $('controls').hidden = false;
    setStatus(`at ${roomName}`);

    const tile = tileFor(room.localParticipant);
    tile.classList.add('mirror');
    for (const p of room.remoteParticipants.values()) {
      tileFor(p);
      updateMuted(p);
    }
    const tracks = await createLocalTracks({ audio: true, video: { resolution: { width: 1280, height: 720 } } });
    console.debug('[tavern] local tracks', tracks.map((t) => t.kind).join(','));
    for (const track of tracks) {
      await room.localParticipant.publishTrack(track);
      console.debug('[tavern] published', track.kind);
    }
    updateMuted(room.localParticipant);
    await fillDevices();
    console.debug('[tavern] devices listed');
    $('mic').classList.add('on');
    $('cam').classList.add('on');
  } catch (err) {
    setStatus('', false);
    $('join-error').textContent = err.message;
    $('join-error').hidden = false;
    await room.disconnect().catch(() => {});
  }
});

$('mic').addEventListener('click', async () => {
  const enabled = !room.localParticipant.isMicrophoneEnabled;
  await room.localParticipant.setMicrophoneEnabled(enabled);
  $('mic').classList.toggle('on', enabled);
  $('mic').classList.toggle('off', !enabled);
  updateMuted(room.localParticipant);
});
$('cam').addEventListener('click', async () => {
  const enabled = !room.localParticipant.isCameraEnabled;
  await room.localParticipant.setCameraEnabled(enabled);
  $('cam').classList.toggle('on', enabled);
  $('cam').classList.toggle('off', !enabled);
});
$('mic-select').addEventListener('change', (e) => room.switchActiveDevice('audioinput', e.target.value));
$('cam-select').addEventListener('change', (e) => room.switchActiveDevice('videoinput', e.target.value));
$('leave').addEventListener('click', () => room.disconnect());
window.addEventListener('beforeunload', () => room.disconnect());
