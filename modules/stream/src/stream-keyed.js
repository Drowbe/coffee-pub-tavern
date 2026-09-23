// Stream: the keyed page, one player's box for a streaming program.
//   /view/<key>?s=<access key>&kind=player|character&plate=1&audio=0&reactions=0&debug=1
//
// player:    the camera when it is on, the Online picture when it is off, the Offline picture (or nothing)
//            away from the table; the talking or muted border and the name plate, plus the Talking / Muted /
//            Aside / Private pictures laid on top (Aside and Private also dim and tint per the module's
//            settings, and a private conversation always keeps the live camera off). Audio plays unless
//            audio=0; whether it reaches the mixer is the streaming program's own option on the source.
// character: the Character picture (Offline away from the table, nothing when unset) with Talking on top
//            while they speak and Muted while muted. Made to sit over a character bar. No audio.
// Both float the player's reactions up the box unless reactions=0. Older links: mode=auto|video -> player,
// mode=avatar|status -> character.
//
// The host does the connecting (host.media.watch), the roster (host.presence), the pictures (host.images)
// and the settings (host.settings); this file decides what the box shows.
(async () => {
  const host = (document.currentScript && document.currentScript.host) || window.host;
  const root = host.root;
  const $ = (id) => root.getElementById(id);
  /*__LIB__*/

  const box = $('box');
  const msg = (text) => { if (!debug) return; $('msg').textContent = text; $('msg').hidden = !text; };

  let info;
  try {
    info = await host.ready();
  } catch (err) {
    $('msg').textContent = `Could not start: ${err.message}`;
    $('msg').hidden = false;
    return;
  }
  const ctx = info.context || {};
  const wanted = ctx.subject || '';
  const q = ctx.query || {};
  const legacy = { auto: 'player', video: 'player', avatar: 'character', status: 'character' };
  const kind = q.kind === 'character' || q.kind === 'player' ? q.kind : legacy[q.mode] || 'player';
  box.dataset.kind = kind;
  const forcePlate = q.plate === '1';
  const withReactions = q.reactions !== '0';
  const withAudio = kind === 'player' && q.audio !== '0';
  const debug = q.debug === '1';
  if (!wanted) { $('msg').textContent = 'No player in the address.'; $('msg').hidden = false; return; }

  // Slots this kind draws, as blob URLs (null when the person has none).
  const slots = kind === 'player' ? ['playerOffline', 'player', 'playerTalking', 'playerMuted', 'playerAside', 'playerPrivate'] : ['characterOffline', 'character', 'talking', 'muted', 'characterAside', 'characterPrivate'];
  const images = Object.fromEntries(slots.map((s) => [s, null]));
  let bgImage = null;
  let settings = {};
  let REACTIONS = {}; // id -> glyph, from the server's reaction list
  let displayName = '';

  // Whichever room the person is in right now (the Lobby while they are away); the box follows them from room
  // to room, and that room's own pictures for a slot follow along too.
  let playerRoom = 'lobby';
  let imageRoom = 'lobby'; // playerRoom, or an aside's origin room: whose pictures apply
  let lastImageRoom = null;
  let tableOnline = false; // server-tracked presence, not this page's own connection
  let isAside = false; // online, but not in the room the stream is following: for the dim and tint
  let inAside = false; // stepped away into an aside themselves: for the Aside overlay picture
  let isPrivate = false; // in a private conversation: its own dim and tint, and never the live camera
  // What the host's viewer connection says about them right now.
  let live = { online: false, cameraOn: false, micOn: false, speaking: false, name: null };
  let videoEl = null;

  // Each kind draws its own borders: the Participant's or the Character's, both server-wide settings.
  const borders = () => (kind === 'player'
    ? { talk: settings.border !== false, talkColor: settings.borderColor || '#6fae6b', mute: settings.mutedBorder !== false, muteColor: settings.mutedColor || '#b8503f', width: settings.borderWidth || 6 }
    : { talk: Boolean(settings.charBorder), talkColor: settings.charBorderColor || '#6fae6b', mute: Boolean(settings.charMutedBorder), muteColor: settings.charMutedColor || '#b8503f', width: settings.charBorderWidth || 6 });

  function hexToRgba(hex, level) {
    const n = parseInt(String(hex).slice(1), 16) || 0;
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(100, level)) / 100})`;
  }

  async function loadImages() {
    for (const slot of slots) {
      const url = await host.images.get(wanted, slot, { room: imageRoom }).catch(() => null);
      if (images[slot]) host.images.release(images[slot]);
      images[slot] = url;
    }
    if (kind === 'player') {
      const url = await host.images.get(wanted, 'background', { room: imageRoom }).catch(() => null);
      if (bgImage) host.images.release(bgImage);
      bgImage = url;
    }
    render();
  }

  function applySettings(values) {
    settings = values || {};
    const b = borders();
    box.style.setProperty('--talk', b.talkColor);
    box.style.setProperty('--talk-w', `${b.width}px`);
    box.style.setProperty('--mute', b.muteColor);
    const scale = kind === 'player' ? settings.pictureScale || 100 : 100;
    box.style.setProperty('--pic-inset', `${(100 - scale) / 2}%`);
    box.style.setProperty('--pic-scale', scale);
    box.style.setProperty('--pic-bg', settings.pictureColor || '#1a1410');
    box.classList.toggle('picture-bg', kind === 'player' && Boolean(settings.pictureBackground));
    box.style.setProperty('--plate-bg', settings.plateColor || '#000000');
    box.style.setProperty('--plate-opacity', `${settings.plateOpacity ?? 60}%`);
    box.style.setProperty('--plate-color', settings.plateTextColor || '#f1e6d8');
    box.style.setProperty('--plate-size', `${settings.plateFontSize || 16}px`);
    $('plate').dataset.plate = settings.plateLayout || 'lower-left';
    render();
  }

  function applyPresence(p) {
    REACTIONS = Object.fromEntries((p.reactions || []).map((r) => [r.id, r.glyph]));
    const me = (p.people || []).find((u) => u.key === wanted);
    if (me) {
      displayName = me.name || '';
      playerRoom = (me.online && me.room) || 'lobby';
      const inRoom = (p.rooms || []).find((r) => r.id === playerRoom);
      imageRoom = inRoom && inRoom.ephemeral && inRoom.origin ? inRoom.origin : playerRoom;
      tableOnline = Boolean(me.online);
      isAside = tableOnline && Boolean(p.adminOnline) && me.room !== p.activeRoom;
      const room = tableOnline ? inRoom : null;
      inAside = tableOnline && Boolean(room && room.ephemeral) && !(room && room.private);
      isPrivate = Boolean(room && room.ephemeral && room.private);
    } else {
      tableOnline = false;
      isAside = false;
      inAside = false;
      isPrivate = false;
    }
    if (imageRoom !== lastImageRoom) {
      lastImageRoom = imageRoom;
      loadImages();
    }
    if (watcher) watcher.follow(playerRoom);
    render();
  }

  function setImage(el, src) {
    el.hidden = !src;
    if (src && el.getAttribute('src') !== src) el.src = src;
  }

  function plateCase(text) {
    const c = settings.plateTextCase || 'default';
    if (c === 'upper') return text.toUpperCase();
    if (c === 'lower') return text.toLowerCase();
    if (c === 'sentence') { const lower = text.toLowerCase(); return lower.charAt(0).toUpperCase() + lower.slice(1); }
    return text;
  }

  function render() {
    const online = live.online;
    // A private conversation: never the live camera (the one genuinely sensitive thing), and shown as muted
    // regardless of the real microphone, since Studio mutes their audio input. Everything else draws as usual.
    const muted = (online && !live.micOn) || isPrivate;
    const talking = online && live.speaking && live.micOn && !isPrivate;
    let state = 'blank'; // nothing; offline: the Offline picture; image: the online picture; video: the camera
    if (kind === 'player') {
      if (online && live.cameraOn && videoEl && !isPrivate) state = 'video';
      else if (online) state = 'image';
      else if (images.playerOffline) state = 'offline';
      if (videoEl) videoEl.hidden = state !== 'video';
      setImage($('base'), state === 'image' ? images.player : state === 'offline' ? images.playerOffline : null);
      setImage($('overlay-talking'), talking ? images.playerTalking : null);
      setImage($('overlay-muted'), muted ? images.playerMuted : null);
      setImage($('overlay-aside'), inAside ? images.playerAside : null);
      setImage($('overlay-private'), isPrivate ? images.playerPrivate : null);
    } else {
      state = online ? 'image' : images.characterOffline ? 'offline' : 'blank';
      setImage($('base'), online ? images.character : state === 'offline' ? images.characterOffline : null);
      setImage($('overlay-talking'), talking ? images.talking : null);
      setImage($('overlay-muted'), muted ? images.muted : null);
      setImage($('overlay-aside'), inAside ? images.characterAside : null);
      setImage($('overlay-private'), isPrivate ? images.characterPrivate : null);
    }
    const showBg = kind === 'player' && Boolean(settings.pictureBackground) && (state === 'image' || state === 'offline') && Boolean(bgImage);
    setImage($('bg-image'), showBg ? bgImage : null);
    const b = borders();
    box.classList.toggle('talking', b.talk && talking && state !== 'blank');
    box.classList.toggle('muted-frame', b.mute && muted && state !== 'blank');
    const showPlate = forcePlate || (kind === 'player' && Boolean(settings.plate));
    $('plate').hidden = !(showPlate && state !== 'blank');
    if (showPlate) $('plate').textContent = plateCase(live.name || displayName || wanted);
    box.dataset.state = state;
    // Dim (a brightness filter over the box) and tint (a colour with its own opacity) per state, independent of
    // each other and not gated on a picture being there: someone with none should still read as offline.
    const prefix = !tableOnline ? 'offline' : isPrivate ? 'private' : isAside ? 'aside' : null;
    const tintOpacity = prefix ? Number(settings[`${prefix}TintOpacity`]) || 0 : 0;
    const tint = prefix && tintOpacity > 0 ? hexToRgba(settings[`${prefix}Tint`] || '#000000', tintOpacity) : null;
    $('dim').hidden = !tint;
    if (tint) box.style.setProperty('--dim', tint);
    const dimLevel = prefix ? Number(settings[`${prefix}Dim`]) || 0 : 0;
    box.style.setProperty('--brightness', String(1 - Math.max(0, Math.min(100, dimLevel)) / 100));
    msg(online ? '' : 'waiting for player');
  }

  function showReaction(id) {
    const glyph = REACTIONS[id];
    if (!glyph || !withReactions) return;
    const el = document.createElement('span');
    el.className = 'reaction';
    el.textContent = glyph;
    el.style.left = `${20 + Math.random() * 60}%`;
    el.addEventListener('animationend', () => el.remove());
    setTimeout(() => el.remove(), 3000); // a hidden tab never fires animationend
    box.appendChild(el);
  }

  // Settings first (the colours), then the roster (which room), then the connection that follows it.
  applySettings(await host.settings.get().catch(() => ({})));
  host.settings.onChange(applySettings);
  let watcher = null;
  const first = await host.presence.get().catch(() => null);
  if (first) applyPresence(first);
  watcher = await host.media.watch(wanted, { video: kind === 'player', audio: withAudio, room: playerRoom }, {
    state: (s) => { live = s; render(); },
    video: (el) => {
      if (videoEl && videoEl !== el) videoEl.remove();
      videoEl = el;
      if (el) box.prepend(el);
      render();
    },
    audio: (el) => { if (el) box.appendChild(el); },
    reaction: showReaction,
    connection: (c) => msg(c.connected ? '' : c.error || 'disconnected'),
  });
  host.presence.onChange(applyPresence);
})();
