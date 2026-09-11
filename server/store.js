'use strict';

// Users, settings and images live in DATA_DIR (a Docker volume in production):
//   tavern.json          users, settings, secrets
//   images/<key>/<slot>  one image per user slot (novideo, normal, talking, muted)
//   images/site/icon     the server icon
// Everything is loaded once and written back whole; a table's worth of users
// does not need a database.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Image slots. Player: what the player's video box shows when the camera is
// off, plus optional overlays drawn on the video while they talk or are muted.
// Character: an optional base image plus overlays for the character box.
const SLOTS = ['player', 'playerTalking', 'playerMuted', 'character', 'talking', 'muted'];
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
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const DEFAULT_SETTINGS = {
  serverName: 'Coffee Pub Tavern',
  tableName: 'The Table',
  room: 'tavern',
  loginText: 'Your browser will ask for camera and microphone once. Nothing to install.',
  // Defaults for every player's video box; a user can override their own.
  border: true,
  borderColor: DEFAULT_BORDER_COLOR,
  badge: true,
};

function cleanColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : '';
}

function cleanTri(value) {
  return value === true || value === false ? value : null;
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
    };
    if (!raw.secrets?.session || !raw.secrets?.stream) {
      this.data = data;
      this.save();
    }
    return data;
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
    const player = u.player && typeof u.player === 'object' ? u.player : {};
    return {
      key,
      login: cleanLogin(u.login) || key,
      displayName: cleanText(u.displayName, 40) || cleanLogin(u.login) || key,
      role: ROLES.includes(u.role) ? u.role : 'user',
      passwordHash: typeof u.passwordHash === 'string' ? u.passwordHash : null,
      linkToken: typeof u.linkToken === 'string' && u.linkToken ? u.linkToken : null,
      images,
      // null means "use the server default"
      player: { border: cleanTri(player.border), borderColor: cleanColor(player.borderColor), badge: cleanTri(player.badge) },
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
    if (patch.border !== undefined) s.border = Boolean(patch.border);
    if (patch.borderColor !== undefined && cleanColor(patch.borderColor)) s.borderColor = cleanColor(patch.borderColor);
    if (patch.badge !== undefined) s.badge = Boolean(patch.badge);
    this.save();
    return s;
  }

  // A user's video-box settings with the server defaults filled in.
  effectivePlayer(user) {
    const s = this.data.settings;
    return {
      border: user.player.border === null ? s.border : user.player.border,
      borderColor: user.player.borderColor || s.borderColor,
      badge: user.player.badge === null ? s.badge : user.player.badge,
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
    if (!cleaned) throw new StoreError('login is required');
    if (this.userByLogin(cleaned)) throw new StoreError('that login is taken');
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
      if (!cleaned) throw new StoreError('login is required');
      const other = this.userByLogin(cleaned);
      if (other && other.key !== key) throw new StoreError('that login is taken');
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
    if (patch.player && typeof patch.player === 'object') {
      if (patch.player.border !== undefined) user.player.border = cleanTri(patch.player.border);
      if (patch.player.borderColor !== undefined) {
        // an invalid colour is ignored; an empty one goes back to the default
        const colour = cleanColor(patch.player.borderColor);
        if (colour || patch.player.borderColor === '') user.player.borderColor = colour;
      }
      if (patch.player.badge !== undefined) user.player.badge = cleanTri(patch.player.badge);
    }
    this.save();
    return user;
  }

  removeUser(key) {
    const user = this.userByKey(key);
    if (!user) throw new StoreError('no such user', 404);
    if (user.role === 'admin' && this.adminCount() <= 1) throw new StoreError('keep at least one admin');
    this.data.users = this.data.users.filter((u) => u.key !== key);
    this.save();
    fs.rmSync(path.join(this.imagesDir, key), { recursive: true, force: true });
    return user;
  }

  adminCount() {
    return this.data.users.filter((u) => u.role === 'admin').length;
  }

  // --- images -------------------------------------------------------------

  imagePath(key, slot) {
    const user = this.userByKey(key);
    const file = user?.images?.[slot];
    if (!file) return null;
    const full = path.join(this.imagesDir, key, file);
    return fs.existsSync(full) ? full : null;
  }

  // The file to serve for a slot. Only the player image has a fallback (the
  // initials plate is drawn by the server); every other slot is optional and
  // simply absent when not set, so overlays stay transparent.
  resolveImage(key, slot) {
    const full = this.imagePath(key, slot);
    return full ? { file: full, slot } : null;
  }

  setImage(key, slot, buffer, contentType) {
    const user = this.userByKey(key);
    if (!user) throw new StoreError('no such user', 404);
    if (!SLOTS.includes(slot)) throw new StoreError('unknown image slot');
    const ext = IMAGE_TYPES[contentType];
    if (!ext) throw new StoreError('PNG, JPEG, GIF or WebP only');
    if (!buffer || buffer.length === 0) throw new StoreError('empty upload');
    if (buffer.length > MAX_IMAGE_BYTES) throw new StoreError('image is larger than 5 MB');
    const dir = path.join(this.imagesDir, key);
    fs.mkdirSync(dir, { recursive: true });
    const previous = user.images[slot];
    const file = `${slot}-${Date.now().toString(36)}.${ext}`;
    fs.writeFileSync(path.join(dir, file), buffer);
    user.images[slot] = file;
    this.save();
    if (previous && previous !== file) fs.rmSync(path.join(dir, previous), { force: true });
    return file;
  }

  removeImage(key, slot) {
    const user = this.userByKey(key);
    if (!user) throw new StoreError('no such user', 404);
    const previous = user.images[slot];
    delete user.images[slot];
    this.save();
    if (previous) fs.rmSync(path.join(this.imagesDir, key, previous), { force: true });
  }

  // Site icon: images/site/icon.<ext>
  iconPath() {
    const dir = path.join(this.imagesDir, 'site');
    if (!fs.existsSync(dir)) return null;
    const file = fs.readdirSync(dir).find((f) => f.startsWith('icon.'));
    return file ? path.join(dir, file) : null;
  }

  setIcon(buffer, contentType) {
    const ext = IMAGE_TYPES[contentType];
    if (!ext) throw new StoreError('PNG, JPEG, GIF or WebP only');
    if (!buffer || buffer.length === 0) throw new StoreError('empty upload');
    if (buffer.length > MAX_IMAGE_BYTES) throw new StoreError('image is larger than 5 MB');
    this.removeIcon();
    const dir = path.join(this.imagesDir, 'site');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `icon.${ext}`), buffer);
  }

  removeIcon() {
    const existing = this.iconPath();
    if (existing) fs.rmSync(existing, { force: true });
  }
}

class StoreError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

module.exports = { Store, StoreError, SLOTS, LEGACY_SLOTS, ROLES, IMAGE_TYPES, MAX_IMAGE_BYTES, DEFAULT_BORDER_COLOR, randomToken, cleanText, cleanLogin };
