// OBS view of one user on a transparent background.
//   /view/<key>?s=<stream key>&mode=auto|video|avatar&audio=1&plate=1&offline=blank|avatar&debug=1
//
// video:  the camera when it is on, otherwise nothing.
// avatar: the user's normal / talking / muted image, following the microphone.
// auto:   the camera when it is on, the images otherwise (default).
// status: only the talking image while they speak and the muted image while
//         their microphone is off; transparent otherwise. Made to overlay a
//         character bar next to the video.
// border=1 draws a green frame while they speak (video and images).
import { Room, RoomEvent, Track } from '/lib/livekit-client.esm.mjs';

const $ = (id) => document.getElementById(id);
const wanted = decodeURIComponent(location.pathname.split('/')[2] || '');
const params = new URLSearchParams(location.search);
const streamKey = params.get('s') || '';
const mode = ['video', 'avatar', 'auto', 'status'].includes(params.get('mode')) ? params.get('mode') : 'auto';
const withBorder = params.get('border') === '1' && mode !== 'status';
const withAudio = params.get('audio') === '1';
const showPlate = params.get('plate') === '1';
const offlineAvatar = params.get('offline') === 'avatar';
const debug = params.get('debug') === '1';
// An images-only view never needs the video stream: subscribe by hand.
const imagesOnly = mode === 'avatar' || mode === 'status';
const room = new Room({ adaptiveStream: false, autoSubscribe: !imagesOnly });

function subscribeWanted(p) {
  if (!imagesOnly || p.identity !== wanted) return;
  for (const pub of p.trackPublications.values()) {
    if (typeof pub.setSubscribed === 'function') pub.setSubscribed(pub.kind === Track.Kind.Audio && withAudio);
  }
}

const images = { normal: null, talking: null, muted: null }; // slot -> blob URL
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
  for (const slot of Object.keys(images)) {
    try {
      const strict = mode === 'status' ? '&strict=1' : '';
      const res = await fetch(`/img/${encodeURIComponent(wanted)}/${slot}?s=${encodeURIComponent(streamKey)}${strict}`);
      if (!res.ok) {
        if (images[slot]) URL.revokeObjectURL(images[slot]);
        images[slot] = null;
        continue;
      }
      const url = URL.createObjectURL(await res.blob());
      if (images[slot]) URL.revokeObjectURL(images[slot]);
      images[slot] = url;
    } catch (err) {
      // keep whatever we had
    }
  }
  render();
}

function avatarSlot() {
  if (!micOn) return 'muted';
  return speaking ? 'talking' : 'normal';
}

function render() {
  const online = !!participant;
  const video = document.querySelector('video');
  let state;
  if (mode === 'video') state = online && cameraOn && video ? 'video' : 'blank';
  else if (mode === 'avatar') state = online || offlineAvatar ? 'avatar' : 'blank';
  else if (mode === 'status') {
    const slot = online ? avatarSlot() : offlineAvatar ? 'muted' : '';
    state = slot === 'talking' || slot === 'muted' ? 'avatar' : 'blank';
  } else state = online && cameraOn && video ? 'video' : online || offlineAvatar ? 'avatar' : 'blank';

  if (video) video.hidden = state !== 'video';
  const slot = online ? avatarSlot() : 'muted';
  // status mode shows only the two indicator images, never the normal one
  const src = mode === 'status' ? images[slot] || '' : images[slot] || images.normal || '';
  document.body.classList.toggle('talking', withBorder && online && speaking && state !== 'blank');
  $('avatar').hidden = state !== 'avatar' || !src;
  if (state === 'avatar' && src && $('avatar').getAttribute('src') !== src) $('avatar').src = src;
  $('plate').hidden = !(showPlate && state !== 'blank');
  if (showPlate) $('plate').textContent = participant?.name || wanted;
  document.body.dataset.state = state;
  document.body.dataset.slot = state === 'avatar' ? slot : '';
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
  subscribeWanted(p);
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
    await room.connect(livekitUrl, token);
    for (const p of room.remoteParticipants.values()) adopt(p);
    render();
  } catch (err) {
    msg(err.message);
    setTimeout(connect, 5000);
  }
}

loadImages();
setInterval(loadImages, 5 * 60000); // pick up replaced images without a reload
connect();
