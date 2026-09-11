// The table: players see and hear each other.
import { Room, RoomEvent, Track, createLocalTracks, createAudioAnalyser } from '/lib/livekit-client.esm.mjs';
import { loadBranding, api } from '/brand.js';

// Elements by id, wherever the stage currently lives (the page or the pop-out
// window, which takes the whole stage with it).
const stageEl = document.getElementById('stage');
const $ = (id) => (id === 'stage' ? stageEl : document.getElementById(id) || stageEl.querySelector(`#${id}`));
const room = new Room({ adaptiveStream: true, dynacast: true });
const tiles = new Map(); // participant identity (user key) -> tile element
let me = null;
let tableName = 'The Table';
let meterStop = null;
let unread = 0;
let installPrompt = null;
let pipWindow = null;

function setStatus(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}

// --- tiles -------------------------------------------------------------------

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
    $('stage').appendChild(audio);
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
  stageDoc().querySelectorAll(`audio[data-identity="${CSS.escape(participant.identity)}"]`).forEach((el) => el.remove());
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

// The document the stage currently lives in (the page, or the pop-out window).
function stageDoc() {
  return $('stage').ownerDocument;
}

// --- chat ---------------------------------------------------------------------

function addMessage(message, from, own = false) {
  const el = document.createElement('div');
  el.className = `message${own ? ' own' : ''}`;
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = from;
  const text = document.createElement('span');
  text.className = 'text';
  text.textContent = message;
  el.append(who, text);
  $('messages').appendChild(el);
  $('messages').scrollTop = $('messages').scrollHeight;
  if ($('chat').hidden && !own) {
    unread += 1;
    $('chat-badge').textContent = String(unread);
    $('chat-badge').hidden = false;
  }
}

function toggleChat(open = $('chat').hidden) {
  $('chat').hidden = !open;
  $('chat-toggle').classList.toggle('on', open);
  if (open) {
    unread = 0;
    $('chat-badge').hidden = true;
    $('chat-input').focus();
    $('messages').scrollTop = $('messages').scrollHeight;
  }
}

// --- microphone level meter ----------------------------------------------------

function startMeter(track) {
  stopMeter();
  let analyser;
  try {
    analyser = createAudioAnalyser(track, { smoothingTimeConstant: 0.7, fftSize: 256 });
  } catch (err) {
    return;
  }
  let raf = 0;
  const tick = () => {
    const level = Math.min(1, analyser.calculateVolume() * 3);
    $('meter').style.setProperty('--level', level.toFixed(2));
    raf = requestAnimationFrame(tick);
  };
  tick();
  meterStop = () => {
    cancelAnimationFrame(raf);
    analyser.cleanup();
    $('meter').style.setProperty('--level', '0');
  };
}

function stopMeter() {
  if (meterStop) meterStop();
  meterStop = null;
}

// --- room events --------------------------------------------------------------

room
  .on(RoomEvent.TrackSubscribed, (track, _pub, participant) => attachTrack(participant, track))
  .on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => detachTrack(participant, track))
  .on(RoomEvent.LocalTrackPublished, (pub) => {
    if (!pub.track) return;
    attachTrack(room.localParticipant, pub.track);
    if (pub.track.kind === Track.Kind.Audio) startMeter(pub.track);
  })
  .on(RoomEvent.LocalTrackUnpublished, (pub) => {
    if (!pub.track) return;
    detachTrack(room.localParticipant, pub.track);
    if (pub.track.kind === Track.Kind.Audio) stopMeter();
  })
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
  .on(RoomEvent.ChatMessage, (message, participant) => {
    addMessage(message.message, participant?.name || participant?.identity || 'someone', participant?.isLocal);
  })
  .on(RoomEvent.Reconnecting, () => setStatus('reconnecting...'))
  .on(RoomEvent.Reconnected, () => setStatus(`at ${tableName}`))
  .on(RoomEvent.Disconnected, () => {
    stopMeter();
    closePopout();
    setStatus('left the table');
    document.body.classList.remove('at-table');
    $('stage').hidden = true;
    $('join').hidden = false;
    $('topbar').hidden = false;
    for (const [, tile] of tiles) tile.remove();
    tiles.clear();
    stageDoc().querySelectorAll('audio').forEach((el) => el.remove());
    $('messages').textContent = '';
    toggleChat(false);
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

// --- join / leave ---------------------------------------------------------------

async function join() {
  $('join-error').hidden = true;
  $('join-button').disabled = true;
  try {
    setStatus('connecting...');
    const { token, livekitUrl } = await api('POST', '/api/token', {});
    await room.connect(livekitUrl, token);
    console.debug('[tavern] connected');
    $('join').hidden = true;
    $('topbar').hidden = true;
    $('stage').hidden = false;
    document.body.classList.add('at-table');
    wake();
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

async function toggleMic() {
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
}

async function toggleCam() {
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
}

$('join-button').addEventListener('click', join);
$('mic').addEventListener('click', toggleMic);
$('cam').addEventListener('click', toggleCam);
$('mic-select').addEventListener('change', (e) => room.switchActiveDevice('audioinput', e.target.value));
$('cam-select').addEventListener('change', (e) => room.switchActiveDevice('videoinput', e.target.value));
$('leave').addEventListener('click', () => room.disconnect());
window.addEventListener('beforeunload', () => room.disconnect());

$('chat-toggle').addEventListener('click', () => toggleChat());
$('chat-close').addEventListener('click', () => toggleChat(false));
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

$('settings-toggle').addEventListener('click', () => {
  $('settings').hidden = !$('settings').hidden;
  $('settings-toggle').classList.toggle('on', !$('settings').hidden);
});

// Keyboard: M mic, V camera, C chat, unless typing in a field.
document.addEventListener('keydown', onKey);
function onKey(event) {
  if (!document.body.classList.contains('at-table')) return;
  const target = event.target;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === 'm') toggleMic();
  else if (key === 'v') toggleCam();
  else if (key === 'c') toggleChat();
  else return;
  event.preventDefault();
}

// --- floating controls: show on movement, hide when the pointer rests --------

let idleTimer = 0;
function wake() {
  $('stage').classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const keepOpen = !$('chat').hidden || !$('settings').hidden || $('floatbar').matches(':hover');
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
    const grid = $('grid').getBoundingClientRect();
    pipWindow = await window.documentPictureInPicture.requestWindow({
      width: Math.min(Math.round(grid.width) || 960, 1280),
      height: Math.min(Math.round(grid.height) || 540, 720),
    });
    for (const sheet of document.querySelectorAll('link[rel="stylesheet"]')) {
      pipWindow.document.head.appendChild(sheet.cloneNode(true));
    }
    pipWindow.document.body.className = 'at-table popout';
    pipWindow.document.body.appendChild($('stage'));
    watchPointer(pipWindow.document);
    pipWindow.document.addEventListener('keydown', onKey);
    pipWindow.addEventListener('pagehide', () => {
      document.body.appendChild($('stage'));
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
if ('documentPictureInPicture' in window) $('popout').hidden = false;

// --- start --------------------------------------------------------------------

async function init() {
  const branding = await loadBranding();
  tableName = branding.tableName || tableName;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  const hint = describeInstall();
  $('install-hint').textContent = hint;
  $('install-hint').hidden = !hint;
  $('install-note').textContent = hint;
  try {
    const info = await api('GET', '/api/me');
    me = info.user;
    $('whoami').textContent = me.displayName;
    $('admin-link').hidden = me.role !== 'admin';
    $('admin-link-2').hidden = me.role !== 'admin';
  } catch (err) {
    location.href = '/login';
  }
}
init();
