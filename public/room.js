// The table: players see and hear each other.
import { Room, RoomEvent, Track, createLocalTracks } from '/lib/livekit-client.esm.mjs';
import { loadBranding, api } from '/brand.js';

// Elements by id, wherever the stage currently lives (the page or the pop-out
// window, which takes the whole stage with it).
const stageEl = document.getElementById('stage');
const $ = (id) => (id === 'stage' ? stageEl : document.getElementById(id) || stageEl.querySelector(`#${id}`));
const room = new Room({ adaptiveStream: true, dynacast: true });
const tiles = new Map(); // participant identity (user key) -> tile element
let me = null;
let tableName = 'The Table';
const tableUsers = new Map(); // key -> { displayName, borderColor, online, room, ... } from /api/table
let tableRooms = []; // the rooms, with `mine` for the ones I may join
let currentRoom = null; // the room I am in, once joined

async function loadTable() {
  try {
    const { users, rooms } = await api('GET', '/api/table');
    tableUsers.clear();
    for (const u of users) tableUsers.set(u.key, u);
    tableRooms = rooms || [];
    for (const [key, tile] of tiles) {
      const colour = tableUsers.get(key)?.borderColor;
      if (colour) tile.style.setProperty('--talk', colour);
    }
    renderRooms();
  } catch (err) {
    // default colour stands
  }
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
    card.querySelector('.room-choice-name').textContent = r.name;
    card.querySelector('.room-choice-desc').textContent = r.description;
    card.querySelector('.room-choice-desc').hidden = !r.description;
    const img = card.querySelector('.room-choice-image');
    const src = r.hasImage ? `/img/room/${encodeURIComponent(r.id)}` : '';
    img.hidden = !src;
    if (src && img.dataset.src !== src) {
      img.dataset.src = src;
      img.src = src;
    }
    const members = r.members.map((k) => tableUsers.get(k)).filter(Boolean);
    const here = members.filter((u) => u.online && u.room === r.id).length;
    card.querySelector('.room-choice-count').textContent = here ? `${here} of ${members.length} here now` : `${members.length} member${members.length === 1 ? '' : 's'}`;
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
      img.src = `/img/${encodeURIComponent(u.key)}/player`;
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
    el.title = here ? `${u.displayName} is here` : elsewhere ? `${u.displayName} is in ${elsewhere.name}` : u.displayName;
  }
  for (const el of [...list.children]) if (!keep.has(el.dataset.key)) el.remove();
}
setInterval(() => {
  if (!$('join').hidden) loadTable();
}, 5000);
$('rooms').addEventListener('click', (event) => {
  const button = event.target.closest('[data-join]');
  if (button) join(button.dataset.join);
});
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
  placeholder.src = `/img/${encodeURIComponent(participant.identity)}/player`;
  const colour = tableUsers.get(participant.identity)?.borderColor;
  if (colour) tile.style.setProperty('--talk', colour);
  tile.appendChild(placeholder);
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

// --- layouts and ordering -----------------------------------------------------

const DEFAULT_PREFS = {
  layout: 'grid', order: [], pinned: null, follow: true,
  micId: '', camId: '', gain: 100, gate: 0, noise: true, echo: true, agc: true, ptt: false,
  quality: 720, mirror: true, volumes: {}, popout: null,
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

function setLayout(layout, announce = false) {
  prefs.layout = LAYOUTS.includes(layout) ? layout : 'grid';
  savePrefs();
  $('layout-select').value = prefs.layout;
  applyLayout();
  if (announce) setStatus(`layout: ${prefs.layout}`);
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
  if (prefs.layout === 'spotlight' && tiles.size > 1) {
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
  const n = tiles.size;
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
  $('layout-select').value = prefs.layout;
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
    const volume = prefs.volumes[participant.identity];
    if (volume !== undefined) track.setVolume(volume);
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
  applyLayout();
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

// --- reactions ------------------------------------------------------------------
// A reaction travels over the data channel (topic "reaction"), like chat but
// never stored: every table page and every OBS view page of that player
// floats it up from their tile for a couple of seconds.

const REACTIONS = { heart: '❤️', up: '👍', down: '👎', laugh: '😂', question: '❓', nat20: '🎲' };
const REACTION_KEYS = ['heart', 'up', 'down', 'laugh', 'question', 'nat20'];
const encoder = new TextEncoder();
const decoder = new TextDecoder();

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
  if (open) {
    $('settings').hidden = true;
    $('settings-toggle').classList.remove('on');
  }
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

function setVolume(participant, volume) {
  prefs.volumes[participant.identity] = volume;
  savePrefs();
  const pub = participant.getTrackPublication(Track.Source.Microphone);
  if (pub?.track?.setVolume) pub.track.setVolume(volume);
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
  $('mic').title = on ? 'Push to talk: hold Space (M toggles)' : 'Microphone (M)';
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
    if (topic !== 'reaction' || !participant) return;
    try {
      const data = JSON.parse(decoder.decode(payload));
      if (data.type === 'reaction') showReaction(participant.identity, data.id);
    } catch (err) {
      // not ours
    }
  })
  .on(RoomEvent.Reconnecting, () => setStatus('reconnecting...'))
  .on(RoomEvent.Reconnected, () => setStatus(`in ${tableName}`))
  .on(RoomEvent.Disconnected, () => {
    closeMic();
    closePopout();
    setStatus('left the table');
    currentRoom = null;
    document.body.classList.remove('at-table');
    $('stage').hidden = true;
    $('join').hidden = false;
    $('topbar').hidden = false;
    for (const [, tile] of tiles) tile.remove();
    tiles.clear();
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
  for (const [kind, select] of [['audioinput', $('mic-select')], ['videoinput', $('cam-select')]]) {
    select.textContent = '';
    for (const d of devices.filter((d) => d.kind === kind)) {
      const option = document.createElement('option');
      option.value = d.deviceId;
      option.textContent = d.label || kind;
      select.appendChild(option);
    }
    const wanted = kind === 'audioinput' ? prefs.micId : prefs.camId;
    if (wanted && [...select.options].some((o) => o.value === wanted)) select.value = wanted;
  }
}

// --- join / leave ---------------------------------------------------------------

async function join(roomId = 'lobby') {
  $('join-error').hidden = true;
  for (const b of document.querySelectorAll('[data-join]')) b.disabled = true;
  try {
    setStatus('connecting...');
    const { token, livekitUrl } = await api('POST', '/api/token', { room: roomId });
    await loadTable();
    currentRoom = tableRooms.find((r) => r.id === roomId) || { id: roomId, name: tableName };
    tableName = currentRoom.name;
    await room.connect(livekitUrl, token);
    console.debug('[tavern] connected to', roomId);
    $('join').hidden = true;
    $('topbar').hidden = true;
    $('stage').hidden = false;
    document.body.classList.add('at-table');
    wake();
    setStatus(`in ${tableName}`);

    tileFor(room.localParticipant);
    applyMirror();
    for (const p of room.remoteParticipants.values()) {
      tileFor(p);
      updateMuted(p);
    }
    // Ask for the microphone and the camera separately: a player with no
    // camera (or who declines it) still joins with audio, and the other way
    // round. Each one that works is published; each that fails is reported.
    const missing = [];
    let haveMic = false;
    let haveCam = false;
    try {
      const track = await openMic();
      await room.localParticipant.publishTrack(track, { source: Track.Source.Microphone, name: 'microphone' });
      haveMic = true;
      console.debug('[tavern] published audio');
      if (prefs.ptt) await room.localParticipant.setMicrophoneEnabled(false);
    } catch (err) {
      console.warn('[tavern] no microphone:', err.message);
      missing.push('microphone');
    }
    try {
      let tracks;
      try {
        tracks = await createLocalTracks({ video: videoConstraints() });
      } catch (err) {
        if (!prefs.camId) throw err;
        prefs.camId = ''; // the remembered camera is gone
        savePrefs();
        tracks = await createLocalTracks({ video: videoConstraints() });
      }
      for (const track of tracks) await room.localParticipant.publishTrack(track);
      haveCam = true;
      console.debug('[tavern] published video');
    } catch (err) {
      console.warn('[tavern] no camera:', err.message);
      missing.push('camera');
    }
    updateMuted(room.localParticipant);
    updateCamera(room.localParticipant);
    await fillDevices();
    reflectMic();
    $('cam').classList.toggle('on', haveCam);
    $('cam').classList.toggle('off', !haveCam);
    if (missing.length) setStatus(`in ${tableName} (no ${missing.join(' or ')})`);
  } catch (err) {
    setStatus('', false);
    $('join-error').textContent = err.message;
    $('join-error').hidden = false;
    await room.disconnect().catch(() => {});
  } finally {
    for (const b of document.querySelectorAll('[data-join]')) b.disabled = false;
  }
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
  } catch (err) {
    setStatus(`camera: ${err.message}`, true);
  }
  const on = room.localParticipant.isCameraEnabled;
  $('cam').classList.toggle('on', on);
  $('cam').classList.toggle('off', !on);
  updateCamera(room.localParticipant);
}

$('mic').addEventListener('click', toggleMic);
$('cam').addEventListener('click', toggleCam);
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
$('gain').addEventListener('input', (e) => {
  prefs.gain = Number(e.target.value);
  savePrefs();
  applyMicSettings();
});
$('gate').addEventListener('input', (e) => {
  prefs.gate = Number(e.target.value);
  savePrefs();
  applyMicSettings();
});
for (const id of ['noise', 'echo', 'agc']) {
  $(id).addEventListener('change', async (e) => {
    prefs[id] = e.target.checked;
    savePrefs();
    if (mic.ctx) await openMic().catch((err) => setStatus(`microphone: ${err.message}`, true));
  });
}
$('talk-mode').addEventListener('change', (e) => setPushToTalk(e.target.value === 'ptt'));
$('quality').addEventListener('change', async (e) => {
  prefs.quality = Number(e.target.value);
  savePrefs();
  await restartCamera();
});
$('mirror').addEventListener('change', (e) => {
  prefs.mirror = e.target.checked;
  savePrefs();
  applyMirror();
});

function applyMirror() {
  const tile = room.localParticipant && tiles.get(room.localParticipant.identity);
  if (tile) tile.classList.toggle('mirror', prefs.mirror);
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

$('layout').addEventListener('click', () => setLayout(LAYOUTS[(LAYOUTS.indexOf(prefs.layout) + 1) % LAYOUTS.length], true));
$('layout-select').addEventListener('change', (e) => setLayout(e.target.value));
$('follow-speaker').addEventListener('change', (e) => {
  prefs.follow = e.target.checked;
  savePrefs();
  applyLayout();
});
window.addEventListener('resize', applyLayout);

$('settings-toggle').addEventListener('click', () => {
  $('settings').hidden = !$('settings').hidden;
  $('settings-toggle').classList.toggle('on', !$('settings').hidden);
  if (!$('settings').hidden) toggleTray(false);
});
$('react-toggle').addEventListener('click', () => toggleTray());
$('react-tray').addEventListener('click', (event) => {
  const button = event.target.closest('[data-reaction]');
  if (!button) return;
  sendReaction(button.dataset.reaction);
  toggleTray(false);
});

// Keyboard: M mic, V camera, C chat, L layout, R reactions, 1 to 6 send a
// reaction, Space held = talk (push to talk mode), unless typing in a field.
document.addEventListener('keydown', onKey);
document.addEventListener('keyup', onKeyUp);
function typing(event) {
  const target = event.target;
  return target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
}
function onKeyUp(event) {
  if (event.key === ' ' && prefs.ptt && pttHeld && !typing(event)) {
    pttHeld = false;
    room.localParticipant.setMicrophoneEnabled(false).then(reflectMic).catch(() => {});
    event.preventDefault();
  }
}
function onKey(event) {
  if (!document.body.classList.contains('at-table')) return;
  if (typing(event)) return;
  if (event.key === ' ' && prefs.ptt) {
    event.preventDefault();
    if (event.repeat || pttHeld) return;
    pttHeld = true;
    room.localParticipant.setMicrophoneEnabled(true).then(reflectMic).catch(() => {});
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === 'm') toggleMic();
  else if (key === 'v') toggleCam();
  else if (key === 'c') toggleChat();
  else if (key === 'l') setLayout(LAYOUTS[(LAYOUTS.indexOf(prefs.layout) + 1) % LAYOUTS.length], true);
  else if (key === 'r') toggleTray();
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
    watchPointer(pipWindow.document);
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
  $('layout-select').value = prefs.layout;
  $('follow-speaker').checked = prefs.follow;
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
  $('mic').classList.toggle('ptt', prefs.ptt);
  applyLayout();
  const hint = describeInstall();
  $('install-hint').textContent = hint;
  $('install-hint').hidden = !hint;
  $('install-note').textContent = hint;
  try {
    const info = await api('GET', '/api/me');
    me = info.user;
    $('whoami').textContent = me.displayName;
    $('whoami-img').src = `/img/${encodeURIComponent(me.key)}/player?v=${Date.now()}`;
    $('whoami-img').hidden = false;
    $('admin-link').hidden = me.role !== 'admin';
    $('admin-link-2').hidden = me.role !== 'admin';
    await loadTable(); // the join screen's member grid
  } catch (err) {
    location.href = '/login';
  }
}
init();
