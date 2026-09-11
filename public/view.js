// OBS view: one player's video (and optionally audio) on a transparent background.
//   /view/<room>/<name>?key=ADMIN&audio=1&plate=1
import { Room, RoomEvent, Track } from '/lib/livekit-client.esm.mjs';

const $ = (id) => document.getElementById(id);
const parts = location.pathname.split('/');
const roomName = decodeURIComponent(parts[2] || 'tavern');
const wanted = decodeURIComponent(parts[3] || '');
const params = new URLSearchParams(location.search);
const withAudio = params.get('audio') === '1';
const showPlate = params.get('plate') === '1';
const room = new Room({ adaptiveStream: false });

function matches(participant) {
  return participant.identity === wanted || participant.name === wanted;
}

function show(participant, track) {
  if (!matches(participant)) return;
  if (track.kind === Track.Kind.Video) {
    document.querySelector('video')?.remove();
    document.body.prepend(track.attach());
    $('msg').hidden = true;
    if (showPlate) {
      $('plate').textContent = participant.name || participant.identity;
      $('plate').hidden = false;
    }
  } else if (track.kind === Track.Kind.Audio && withAudio) {
    document.body.appendChild(track.attach());
  }
}

function hide(participant, track) {
  if (!matches(participant)) return;
  track.detach().forEach((el) => el.remove());
  if (track.kind === Track.Kind.Video) $('msg').hidden = false;
}

room
  .on(RoomEvent.TrackSubscribed, (track, _pub, p) => show(p, track))
  .on(RoomEvent.TrackUnsubscribed, (track, _pub, p) => hide(p, track))
  .on(RoomEvent.ParticipantDisconnected, (p) => {
    if (matches(p)) {
      document.querySelectorAll('video, audio').forEach((el) => el.remove());
      $('msg').hidden = false;
    }
  })
  .on(RoomEvent.Disconnected, () => {
    $('msg').textContent = 'disconnected';
    $('msg').hidden = false;
    setTimeout(connect, 3000);
  });

async function connect() {
  try {
    const res = await fetch('/api/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ room: roomName, name: wanted, key: params.get('key') || '', role: 'viewer' }),
    });
    if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
    const { token, livekitUrl } = await res.json();
    await room.connect(livekitUrl, token);
    $('msg').textContent = 'waiting for player';
  } catch (err) {
    $('msg').textContent = err.message;
    $('msg').hidden = false;
    setTimeout(connect, 5000);
  }
}
connect();
