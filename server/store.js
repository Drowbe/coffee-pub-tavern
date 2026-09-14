'use strict';

// Users, rooms, settings and images live in DATA_DIR (a Docker volume in production):
//   tavern.json          users, rooms, settings, secrets
//   images/<key>/<slot>  one image per user slot (player, character, talking, muted...)
//   images/site/<name>   the server icon and the sign-in background
//   images/rooms/<id>    a room's picture
// Everything is loaded once and written back whole; a table's worth of users
// does not need a database.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Image slots. Participant: what the video box shows when the camera is
// off, plus optional overlays drawn on the video while they talk or are muted.
// Character: an optional base image plus overlays for the character box.
// Participant box: offline, online (the camera-off picture), talking, muted.
// Character box: characterOffline, character (online), talking, muted.
// 'profile' is the player's own photo (header, table tiles, profile page); the
// rest are the admin-set OBS pictures for the Participant and Character boxes.
// The slot keys themselves stay the old "player*" names underneath -- OBS
// scenes and view links already reference them -- only their label changed.
const PARTICIPANT_SLOTS = ['playerOffline', 'player', 'playerTalking', 'playerMuted'];
const CHARACTER_SLOTS = ['characterOffline', 'character', 'talking', 'muted'];
// 'background' is a player's own chosen still image behind their camera in
// the call itself (an alternative to blur) -- unrelated to the OBS
// Participant/Character boxes above, but self-service the same way 'profile' is.
const SLOTS = ['profile', 'background', ...PARTICIPANT_SLOTS, ...CHARACTER_SLOTS];
// A room's profile decides which of the two image groups above are even
// offered for it, on a member's per-room section and (eventually) in
// Studio's publish UI: Roleplaying wants both, the other two just one.
const ROOM_PROFILES = ['roleplaying', 'participants', 'characters'];
const ROOM_PROFILE_SLOTS = {
  roleplaying: [...PARTICIPANT_SLOTS, ...CHARACTER_SLOTS],
  participants: PARTICIPANT_SLOTS,
  characters: CHARACTER_SLOTS,
};
// Pre-0.3 names, accepted on the way in and on image routes.
const LEGACY_SLOTS = { novideo: 'player', normal: 'character' };
const DEFAULT_BORDER_COLOR = '#6fae6b';
const ROLES = ['admin', 'user'];
const IMAGE_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const SITE_IMAGES = ['icon', 'background'];
// Every user belongs to the Lobby; it cannot be deleted.
const LOBBY = 'lobby';

const DEFAULT_SETTINGS = {
  serverName: 'Coffee Pub Tavern',
  tableName: 'The Table',
  room: 'tavern',
  loginText: 'Your browser will ask for camera and microphone once. Nothing to install.',
  // Self-service sign-up at /register, off by default. A self-registered
  // account is a normal user, added automatically like everyone is to the
  // Lobby, with no password requirement beyond what they pick.
  allowRegistration: false,
  // Defaults for every player's video box; a user can override their own.
  border: true,
  borderColor: DEFAULT_BORDER_COLOR,
  borderWidth: 6, // px, drawn on the OBS view, talking and muted alike
  mutedBorder: true,
  mutedColor: '#b8503f',
  // Character box borders: off unless the admin wants them, same colours.
  charBorder: false,
  charBorderColor: DEFAULT_BORDER_COLOR,
  charMutedBorder: false,
  charMutedColor: '#b8503f',
  charBorderWidth: 6,
  plate: false, // the name plate is server-wide
  // Behind the Offline / Online picture in the player box: a colour (or
  // transparent) and the picture's size as a percentage of the box.
  pictureBackground: false,
  pictureColor: '#1a1410',
  pictureScale: 100,
  // The reaction tray at the table: id (also the 1-6 shortcut order and the
  // data-channel payload), glyph (what's drawn), label (button title/alt).
  reactions: [
    { id: 'heart', glyph: '❤️', label: 'Heart' },
    { id: 'up', glyph: '👍', label: 'Thumbs up' },
    { id: 'down', glyph: '👎', label: 'Thumbs down' },
    { id: 'laugh', glyph: '😂', label: 'Laugh' },
    { id: 'question', glyph: '❓', label: 'Question' },
    { id: 'nat20', glyph: '🎲', label: 'Nat 20!' },
  ],
};

function cleanWidth(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(1, Math.min(24, n)) : null;
}

function cleanColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : '';
}

function cleanTri(value) {
  return value === true || value === false ? value : null;
}

// A reaction tray: { id, glyph, label } entries, ids unique and
// URL/topic-safe. An empty array is valid -- an admin can turn the tray off.
// A caller need not supply an id (the admin page's own editor does not
// track one either): one is made up from the label or glyph, falling back
// to a random one, rather than silently dropping the entry.
function cleanReactions(value) {
  if (!Array.isArray(value)) return null;
  const slug = (text) => String(text || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  const seen = new Set();
  const out = [];
  for (const r of value) {
    if (!r || typeof r !== 'object') continue;
    const glyph = cleanText(r.glyph, 8);
    if (!glyph) continue;
    const label = cleanText(r.label, 40) || glyph;
    let id = typeof r.id === 'string' ? r.id.trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) : '';
    if (!id) id = slug(label) || slug(glyph);
    if (!id || seen.has(id)) id = `r${randomKey(6)}`;
    seen.add(id);
    out.push({ id, glyph, label });
  }
  return out;
}

// Short, URL-safe, unambiguous: 8 lowercase letters and digits, no 0/o/1/l/i.
const KEY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
function randomKey(length = 8) {
  let key = '';
  for (let i = 0; i < length; i += 1) key += KEY_ALPHABET[crypto.randomInt(KEY_ALPHABET.length)];
  return key;
}

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function cleanText(value, max = 60) {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, max);
}

function cleanLogin(value) {
  return cleanText(value, 40).toLowerCase().replace(/\s+/g, '');
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'tavern.json');
    this.imagesDir = path.join(dir, 'images');
    fs.mkdirSync(this.imagesDir, { recursive: true });
    this.data = this.load();
  }

  load() {
    let raw = {};
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (err) {
      raw = {};
    }
    const data = {
      version: 1,
      secrets: {
        session: raw.secrets?.session || randomToken(32),
        stream: raw.secrets?.stream || randomToken(18),
      },
      settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) },
      users: Array.isArray(raw.users) ? raw.users.map((u) => this.sanitizeUser(u)).filter(Boolean) : [],
      rooms: Array.isArray(raw.rooms) ? raw.rooms.map((r) => this.sanitizeRoom(r)).filter(Boolean) : [],
      invites: Array.isArray(raw.invites) ? raw.invites.map((i) => this.sanitizeInvite(i)).filter(Boolean) : [],
    };
    if (!data.rooms.some((r) => r.id === LOBBY)) {
      data.rooms.unshift({ id: LOBBY, name: 'Lobby', description: 'Everyone at the table.', members: [], createdAt: new Date().toISOString() });
    }
    if (!raw.secrets?.session || !raw.secrets?.stream || !Array.isArray(raw.rooms)) {
      this.data = data;
      this.save();
    }
    return data;
  }

  sanitizeRoom(r) {
    if (!r || typeof r !== 'object') return null;
    const id = typeof r.id === 'string' && /^[a-z0-9]{4,16}$/.test(r.id) ? r.id : null;
    if (!id) return null;
    return {
      id,
      name: cleanText(r.name, 40) || (id === LOBBY ? 'Lobby' : 'Room'),
      description: String(r.description ?? '').trim().slice(0, 300),
      members: Array.isArray(r.members) ? [...new Set(r.members.filter((k) => typeof k === 'string'))] : [],
      createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
      // A "pull aside" room: not shown on the manage page's Rooms tab, not
      // hand-editable, and swept away once nobody online is actually in it.
      ephemeral: Boolean(r.ephemeral),
      // The room an ephemeral room was pulled out of, so "Back to the table"
      // can return everyone there instead of always landing on the Lobby.
      origin: typeof r.origin === 'string' && /^[a-z0-9]{4,16}$/.test(r.origin) ? r.origin : null,
      // Which image sections a member's per-room section (and Studio) offer
      // for this room -- see ROOM_PROFILE_SLOTS.
      profile: ROOM_PROFILES.includes(r.profile) ? r.profile : 'roleplaying',
      // A standing door code: anyone with this room's guest link joins it
      // with just a name, no account. null while off. See enableGuestLink.
      guestToken: typeof r.guestToken === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(r.guestToken) ? r.guestToken : null,
    };
  }

  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`);
    fs.renameSync(tmp, this.file);
  }

  sanitizeUser(u) {
    if (!u || typeof u !== 'object') return null;
    const key = typeof u.key === 'string' && /^[a-z0-9]{4,16}$/.test(u.key) ? u.key : null;
    if (!key) return null;
    const images = {};
    for (const [legacy, slot] of Object.entries(LEGACY_SLOTS)) {
      if (typeof u.images?.[legacy] === 'string') images[slot] = u.images[legacy];
    }
    for (const slot of SLOTS) {
      if (typeof u.images?.[slot] === 'string') images[slot] = u.images[slot];
    }
    // Per-room image overrides: a room's picture set stands in for the
    // defaults above only for that room, so the same person can be one
    // character in one campaign and another in a different one.
    const rooms = {};
    if (u.rooms && typeof u.rooms === 'object') {
      for (const [roomId, r] of Object.entries(u.rooms)) {
        if (!r || typeof r !== 'object') continue;
        const roomImages = {};
        for (const slot of SLOTS) {
          if (typeof r.images?.[slot] === 'string') roomImages[slot] = r.images[slot];
        }
        rooms[roomId] = { images: roomImages };
      }
    }
    return {
      key,
      login: cleanLogin(u.login) || key,
      displayName: cleanText(u.displayName, 40) || cleanLogin(u.login) || key,
      role: ROLES.includes(u.role) ? u.role : 'user',
      passwordHash: typeof u.passwordHash === 'string' ? u.passwordHash : null,
      linkToken: typeof u.linkToken === 'string' && u.linkToken ? u.linkToken : null,
      images,
      rooms,
      player: {}, // borders and the plate are server-wide now; older per-user values are dropped
      createdAt: typeof u.createdAt === 'string' ? u.createdAt : new Date().toISOString(),
    };
  }

  // --- secrets ------------------------------------------------------------

  get sessionSecret() {
    return this.data.secrets.session;
  }

  get streamKey() {
    return this.data.secrets.stream;
  }

  regenerateStreamKey() {
    this.data.secrets.stream = randomToken(18);
    this.save();
    return this.data.secrets.stream;
  }

  // --- settings -----------------------------------------------------------

  get settings() {
    return this.data.settings;
  }

  updateSettings(patch) {
    const s = this.data.settings;
    if (patch.serverName !== undefined) s.serverName = cleanText(patch.serverName, 60) || DEFAULT_SETTINGS.serverName;
    if (patch.tableName !== undefined) s.tableName = cleanText(patch.tableName, 60) || DEFAULT_SETTINGS.tableName;
    if (patch.loginText !== undefined) s.loginText = String(patch.loginText ?? '').trim().slice(0, 1000);
    if (patch.allowRegistration !== undefined) s.allowRegistration = Boolean(patch.allowRegistration);
    if (patch.border !== undefined) s.border = Boolean(patch.border);
    if (patch.borderColor !== undefined && cleanColor(patch.borderColor)) s.borderColor = cleanColor(patch.borderColor);
    if (patch.borderWidth !== undefined && cleanWidth(patch.borderWidth)) s.borderWidth = cleanWidth(patch.borderWidth);
    if (patch.mutedBorder !== undefined) s.mutedBorder = Boolean(patch.mutedBorder);
    if (patch.mutedColor !== undefined && cleanColor(patch.mutedColor)) s.mutedColor = cleanColor(patch.mutedColor);
    if (patch.charBorder !== undefined) s.charBorder = Boolean(patch.charBorder);
    if (patch.charBorderColor !== undefined && cleanColor(patch.charBorderColor)) s.charBorderColor = cleanColor(patch.charBorderColor);
    if (patch.charMutedBorder !== undefined) s.charMutedBorder = Boolean(patch.charMutedBorder);
    if (patch.charMutedColor !== undefined && cleanColor(patch.charMutedColor)) s.charMutedColor = cleanColor(patch.charMutedColor);
    if (patch.charBorderWidth !== undefined && cleanWidth(patch.charBorderWidth)) s.charBorderWidth = cleanWidth(patch.charBorderWidth);
    if (patch.plate !== undefined) s.plate = Boolean(patch.plate);
    if (patch.pictureBackground !== undefined) s.pictureBackground = Boolean(patch.pictureBackground);
    if (patch.pictureColor !== undefined && cleanColor(patch.pictureColor)) s.pictureColor = cleanColor(patch.pictureColor);
    if (patch.pictureScale !== undefined) {
      const n = Math.round(Number(patch.pictureScale));
      if (Number.isFinite(n)) s.pictureScale = Math.max(20, Math.min(100, n));
    }
    if (patch.reactions !== undefined) {
      const reactions = cleanReactions(patch.reactions);
      if (reactions) s.reactions = reactions;
    }
    this.save();
    return s;
  }

  // A user's video-box settings with the server defaults filled in.
  effectivePlayer(user) {
    const s = this.data.settings;
    return {
      border: s.border,
      borderColor: s.borderColor,
      borderWidth: s.borderWidth || DEFAULT_SETTINGS.borderWidth,
      mutedBorder: s.mutedBorder !== false,
      mutedColor: s.mutedColor || DEFAULT_SETTINGS.mutedColor,
      plate: Boolean(s.plate),
      charBorder: Boolean(s.charBorder),
      charBorderColor: s.charBorderColor || DEFAULT_BORDER_COLOR,
      charMutedBorder: Boolean(s.charMutedBorder),
      charMutedColor: s.charMutedColor || '#b8503f',
      charBorderWidth: s.charBorderWidth || 6,
      pictureBackground: Boolean(s.pictureBackground),
      pictureColor: s.pictureColor || DEFAULT_SETTINGS.pictureColor,
      pictureScale: s.pictureScale || 100,
    };
  }

  // --- users --------------------------------------------------------------

  get users() {
    return this.data.users;
  }

  userByKey(key) {
    return this.data.users.find((u) => u.key === key) || null;
  }

  userByLogin(login) {
    const wanted = cleanLogin(login);
    return this.data.users.find((u) => u.login === wanted) || null;
  }

  userByLinkToken(token) {
    if (!token) return null;
    return this.data.users.find((u) => u.linkToken && u.linkToken === token) || null;
  }

  newKey() {
    let key;
    do key = randomKey();
    while (this.userByKey(key));
    return key;
  }

  addUser({ login, displayName, role, passwordHash }) {
    const cleaned = cleanLogin(login);
    if (!cleaned) throw new StoreError('username is required');
    if (this.userByLogin(cleaned)) throw new StoreError('that username is taken');
    const user = this.sanitizeUser({
      key: this.newKey(),
      login: cleaned,
      displayName: displayName || cleaned,
      role,
      passwordHash: passwordHash || null,
      images: {},
      createdAt: new Date().toISOString(),
    });
    this.data.users.push(user);
    this.save();
    return user;
  }

  updateUser(key, patch) {
    const user = this.userByKey(key);
    if (!user) throw new StoreError('no such user', 404);
    if (patch.login !== undefined) {
      const cleaned = cleanLogin(patch.login);
      if (!cleaned) throw new StoreError('username is required');
      const other = this.userByLogin(cleaned);
      if (other && other.key !== key) throw new StoreError('that username is taken');
      user.login = cleaned;
    }
    if (patch.displayName !== undefined) user.displayName = cleanText(patch.displayName, 40) || user.login;
    if (patch.role !== undefined) {
      if (!ROLES.includes(patch.role)) throw new StoreError('role must be admin or user');
      if (user.role === 'admin' && patch.role !== 'admin' && this.adminCount() <= 1) {
        throw new StoreError('keep at least one admin');
      }
      user.role = patch.role;
    }
    if (patch.passwordHash !== undefined) user.passwordHash = patch.passwordHash || null;
    if (patch.linkToken !== undefined) user.linkToken = patch.linkToken || null;
    this.save();
    return user;
  }

  removeUser(key) {
    const user = this.userByKey(key);
    if (!user) throw new StoreError('no such user', 404);
    if (user.role === 'admin' && this.adminCount() <= 1) throw new StoreError('keep at least one admin');
    this.data.users = this.data.users.filter((u) => u.key !== key);
    for (const room of this.data.rooms) room.members = room.members.filter((k) => k !== key);
    this.save();
    fs.rmSync(path.join(this.imagesDir, key), { recursive: true, force: true });
    return user;
  }

  adminCount() {
    return this.data.users.filter((u) => u.role === 'admin').length;
  }

  // --- rooms --------------------------------------------------------------
  // The Lobby holds everyone; other rooms hold the members an admin picks.

  get rooms() {
    const everyone = this.data.users.map((u) => u.key);
    return this.data.rooms.map((r) => ({
      ...r,
      members: r.id === LOBBY ? everyone : r.members.filter((k) => everyone.includes(k)),
      isLobby: r.id === LOBBY,
      hasImage: !!this.roomImagePath(r.id),
    }));
  }

  roomById(id) {
    return this.rooms.find((r) => r.id === id) || null;
  }

  // The Rooms tab's own order (the Lobby always stays first): reorder to
  // match `order`, a full or partial list of room ids -- anything named
  // that exists moves into that order, anything left out keeps its place
  // relative to the rest, nothing is ever dropped.
  reorderRooms(order) {
    if (!Array.isArray(order)) throw new StoreError('order must be a list of room ids');
    const rest = this.data.rooms.filter((r) => r.id !== LOBBY);
    const wanted = order.filter((id) => id !== LOBBY && rest.some((r) => r.id === id));
    const byId = new Map(rest.map((r) => [r.id, r]));
    const reordered = [...wanted.map((id) => byId.get(id)), ...rest.filter((r) => !wanted.includes(r.id))];
    const lobby = this.data.rooms.find((r) => r.id === LOBBY);
    this.data.rooms = lobby ? [lobby, ...reordered] : reordered;
    this.save();
    return this.rooms;
  }

  addRoom({ name, description, members, profile }) {
    let id;
    do id = randomKey();
    while (this.data.rooms.some((r) => r.id === id));
    const room = this.sanitizeRoom({ id, name: name || 'New room', description, members, profile, createdAt: new Date().toISOString() });
    room.members = room.members.filter((k) => this.userByKey(k));
    this.data.rooms.push(room);
    this.save();
    return this.roomById(id);
  }

  // A private "pull aside" room for exactly the members given (typically an
  // admin and one player). No name worth keeping server-side; the client
  // builds one from the other member's display name. `origin` is the room
  // they were pulled out of, so they can all be sent back to it later.
  addAsideRoom(members, origin) {
    let id;
    do id = randomKey();
    while (this.data.rooms.some((r) => r.id === id));
    const room = this.sanitizeRoom({ id, name: 'Aside', description: '', members, ephemeral: true, origin, createdAt: new Date().toISOString() });
    room.members = room.members.filter((k) => this.userByKey(k));
    this.data.rooms.push(room);
    this.save();
    return this.roomById(id);
  }

  // Sweep aside rooms nobody is actually in any more. `online` is the
  // key -> { room, ... } map this request already built from LiveKit, so
  // this costs nothing extra to call on every /api/table and /api/status.
  // A room this young is spared even if it looks empty: the members who are
  // meant to be in it were only just told to reconnect there (a disconnect,
  // a fresh token and a new WebRTC connect all take a moment), and the very
  // first poll after creation would otherwise see nobody there yet and
  // delete it before anyone arrives.
  pruneAsideRooms(online) {
    const GRACE_MS = 20000;
    const now = Date.now();
    const before = this.data.rooms.length;
    this.data.rooms = this.data.rooms.filter((r) => {
      if (!r.ephemeral) return true;
      if (now - new Date(r.createdAt).getTime() < GRACE_MS) return true;
      return r.members.some((k) => online.get(k)?.room === r.id);
    });
    if (this.data.rooms.length !== before) this.save();
  }

  updateRoom(id, patch) {
    const room = this.data.rooms.find((r) => r.id === id);
    if (!room) throw new StoreError('no such room', 404);
    if (patch.name !== undefined) room.name = cleanText(patch.name, 40) || room.name;
    if (patch.description !== undefined) room.description = String(patch.description ?? '').trim().slice(0, 300);
    if (patch.members !== undefined && id !== LOBBY) {
      if (!Array.isArray(patch.members)) throw new StoreError('members must be a list of user keys');
      room.members = [...new Set(patch.members.filter((k) => typeof k === 'string' && this.userByKey(k)))];
    }
    if (patch.profile !== undefined) {
      if (!ROOM_PROFILES.includes(patch.profile)) throw new StoreError('profile must be roleplaying, participants or characters');
      room.profile = patch.profile;
    }
    this.save();
    return this.roomById(id);
  }

  removeRoom(id) {
    if (id === LOBBY) throw new StoreError('the Lobby cannot be deleted');
    const room = this.data.rooms.find((r) => r.id === id);
    if (!room) throw new StoreError('no such room', 404);
    this.data.rooms = this.data.rooms.filter((r) => r.id !== id);
    this.save();
    this.removeRoomImage(id);
    return room;
  }

  // --- guests -----------------------------------------------------------
  // A room's guest link: reusable until turned off or regenerated, unlike
  // the sign-up invites above. Anyone already in the room can manage it --
  // there's no account behind it to gate on.

  enableGuestLink(id) {
    const room = this.data.rooms.find((r) => r.id === id);
    if (!room) throw new StoreError('no such room', 404);
    if (!room.guestToken) {
      room.guestToken = randomToken(20);
      this.save();
    }
    return room.guestToken;
  }

  regenerateGuestLink(id) {
    const room = this.data.rooms.find((r) => r.id === id);
    if (!room) throw new StoreError('no such room', 404);
    room.guestToken = randomToken(20);
    this.save();
    return room.guestToken;
  }

  disableGuestLink(id) {
    const room = this.data.rooms.find((r) => r.id === id);
    if (!room) throw new StoreError('no such room', 404);
    if (room.guestToken) {
      room.guestToken = null;
      this.save();
    }
  }

  roomByGuestToken(token) {
    if (typeof token !== 'string' || !token) return null;
    return this.data.rooms.find((r) => r.guestToken && r.guestToken === token) || null;
  }

  // --- invites --------------------------------------------------------------
  // A link an admin hands out that signs someone up and drops them straight
  // into the rooms picked when it was made (the Lobby always, everyone is
  // there already). Single use, expires on its own after a week.

  sanitizeInvite(i) {
    if (!i || typeof i !== 'object') return null;
    const token = typeof i.token === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(i.token) ? i.token : null;
    if (!token) return null;
    return {
      token,
      rooms: Array.isArray(i.rooms) ? [...new Set(i.rooms.filter((id) => typeof id === 'string'))] : [],
      createdAt: typeof i.createdAt === 'string' ? i.createdAt : new Date().toISOString(),
      expiresAt: typeof i.expiresAt === 'string' ? i.expiresAt : new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    };
  }

  // Live invites only -- expired ones are swept out the moment anything asks.
  get invites() {
    const now = Date.now();
    const live = this.data.invites.filter((i) => new Date(i.expiresAt).getTime() > now);
    if (live.length !== this.data.invites.length) {
      this.data.invites = live;
      this.save();
    }
    return live;
  }

  createInvite(rooms) {
    const wanted = (Array.isArray(rooms) ? rooms : []).filter((id) => id !== LOBBY && this.data.rooms.some((r) => r.id === id));
    const invite = this.sanitizeInvite({ token: randomToken(24), rooms: wanted });
    this.data.invites.push(invite);
    this.save();
    return invite;
  }

  inviteByToken(token) {
    return this.invites.find((i) => i.token === token) || null;
  }

  removeInvite(token) {
    this.data.invites = this.data.invites.filter((i) => i.token !== token);
    this.save();
  }

  roomImagePath(id) {
    const dir = path.join(this.imagesDir, 'rooms');
    if (!/^[a-z0-9]{4,16}$/.test(id) || !fs.existsSync(dir)) return null;
    const file = fs.readdirSync(dir).find((f) => f.startsWith(`${id}.`));
    return file ? path.join(dir, file) : null;
  }

  setRoomImage(id, buffer, contentType) {
    if (!this.data.rooms.some((r) => r.id === id)) throw new StoreError('no such room', 404);
    const ext = IMAGE_TYPES[contentType];
    if (!ext) throw new StoreError('PNG, JPEG, GIF or WebP only');
    if (!buffer || buffer.length === 0) throw new StoreError('empty upload');
    if (buffer.length > MAX_IMAGE_BYTES) throw new StoreError(`image is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB`);
    this.removeRoomImage(id);
    const dir = path.join(this.imagesDir, 'rooms');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.${ext}`), buffer);
  }

  removeRoomImage(id) {
    const existing = this.roomImagePath(id);
    if (existing) fs.rmSync(existing, { force: true });
  }

  // --- images -------------------------------------------------------------
  // A slot's file lives at images/<key>/<file>, or images/<key>/rooms/<roomId>/<file>
  // for a room-specific override -- a second, independent picture set for
  // the same slot, that only applies inside that one room.

  imageDir(key, roomId) {
    return roomId ? path.join(this.imagesDir, key, 'rooms', roomId) : path.join(this.imagesDir, key);
  }

  imageBucket(user, roomId) {
    if (!roomId) return user.images;
    return (user.rooms[roomId] ??= { images: {} }).images;
  }

  imagePath(key, slot, roomId) {
    const user = this.userByKey(key);
    if (!user) return null;
    const file = roomId ? user.rooms[roomId]?.images?.[slot] : user.images[slot];
    if (!file) return null;
    const full = path.join(this.imageDir(key, roomId), file);
    return fs.existsSync(full) ? full : null;
  }

  // The file to serve for a slot. Only the profile picture has a fallback
  // (the initials plate is drawn by the server); every other slot is
  // optional and simply absent when not set, so overlays stay transparent.
  resolveImage(key, slot, roomId) {
    const full = this.imagePath(key, slot, roomId);
    return full ? { file: full, slot } : null;
  }

  // The room's own picture if it has one for this slot, else the global
  // default -- what OBS actually wants to show for that room.
  effectiveImage(key, slot, roomId) {
    return (roomId && this.resolveImage(key, slot, roomId)) || this.resolveImage(key, slot);
  }

  setImage(key, slot, buffer, contentType, roomId) {
    const user = this.userByKey(key);
    if (!user) throw new StoreError('no such user', 404);
    if (!SLOTS.includes(slot)) throw new StoreError('unknown image slot');
    if (roomId && !this.roomById(roomId)) throw new StoreError('no such room', 404);
    const ext = IMAGE_TYPES[contentType];
    if (!ext) throw new StoreError('PNG, JPEG, GIF or WebP only');
    if (!buffer || buffer.length === 0) throw new StoreError('empty upload');
    if (buffer.length > MAX_IMAGE_BYTES) throw new StoreError(`image is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB`);
    const dir = this.imageDir(key, roomId);
    fs.mkdirSync(dir, { recursive: true });
    const bucket = this.imageBucket(user, roomId);
    const previous = bucket[slot];
    const file = `${slot}-${Date.now().toString(36)}.${ext}`;
    fs.writeFileSync(path.join(dir, file), buffer);
    bucket[slot] = file;
    this.save();
    if (previous && previous !== file) fs.rmSync(path.join(dir, previous), { force: true });
    return file;
  }

  removeImage(key, slot, roomId) {
    const user = this.userByKey(key);
    if (!user) throw new StoreError('no such user', 404);
    const bucket = roomId ? user.rooms[roomId]?.images : user.images;
    const previous = bucket?.[slot];
    if (bucket) delete bucket[slot];
    this.save();
    if (previous) fs.rmSync(path.join(this.imageDir(key, roomId), previous), { force: true });
  }

  // Site images: images/site/<name>.<ext>. "icon" is the server icon and
  // "background" the picture behind the sign-in page.
  siteImagePath(name) {
    if (!SITE_IMAGES.includes(name)) return null;
    const dir = path.join(this.imagesDir, 'site');
    if (!fs.existsSync(dir)) return null;
    const file = fs.readdirSync(dir).find((f) => f.startsWith(`${name}.`));
    return file ? path.join(dir, file) : null;
  }

  setSiteImage(name, buffer, contentType) {
    if (!SITE_IMAGES.includes(name)) throw new StoreError('unknown image', 404);
    const ext = IMAGE_TYPES[contentType];
    if (!ext) throw new StoreError('PNG, JPEG, GIF or WebP only');
    if (!buffer || buffer.length === 0) throw new StoreError('empty upload');
    if (buffer.length > MAX_IMAGE_BYTES) throw new StoreError(`image is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB`);
    this.removeSiteImage(name);
    const dir = path.join(this.imagesDir, 'site');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.${ext}`), buffer);
  }

  removeSiteImage(name) {
    const existing = this.siteImagePath(name);
    if (existing) fs.rmSync(existing, { force: true });
  }

  iconPath() {
    return this.siteImagePath('icon');
  }

  // Guest images: images/guest/<slot>.<ext>, one shared Participant-only
  // picture set standing in for a real member's own images (guests have no
  // profile, no account, nothing to hang per-guest pictures off of).
  guestImagePath(slot) {
    if (!PARTICIPANT_SLOTS.includes(slot)) return null;
    const dir = path.join(this.imagesDir, 'guest');
    if (!fs.existsSync(dir)) return null;
    const file = fs.readdirSync(dir).find((f) => f.startsWith(`${slot}.`));
    return file ? path.join(dir, file) : null;
  }

  setGuestImage(slot, buffer, contentType) {
    if (!PARTICIPANT_SLOTS.includes(slot)) throw new StoreError('unknown image', 404);
    const ext = IMAGE_TYPES[contentType];
    if (!ext) throw new StoreError('PNG, JPEG, GIF or WebP only');
    if (!buffer || buffer.length === 0) throw new StoreError('empty upload');
    if (buffer.length > MAX_IMAGE_BYTES) throw new StoreError(`image is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB`);
    this.removeGuestImage(slot);
    const dir = path.join(this.imagesDir, 'guest');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${slot}.${ext}`), buffer);
  }

  removeGuestImage(slot) {
    const existing = this.guestImagePath(slot);
    if (existing) fs.rmSync(existing, { force: true });
  }
}

class StoreError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

module.exports = {
  Store, StoreError, SLOTS, PARTICIPANT_SLOTS, CHARACTER_SLOTS, ROOM_PROFILES, ROOM_PROFILE_SLOTS,
  LEGACY_SLOTS, ROLES, IMAGE_TYPES, MAX_IMAGE_BYTES, DEFAULT_BORDER_COLOR, LOBBY, randomToken, cleanText, cleanLogin,
};
