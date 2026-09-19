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
// off, plus optional overlays drawn on top while they talk, are muted, are
// aside, or are in a Private Conversation. Character: an optional base
// image plus the same set of overlays for the character box.
// Participant box: offline, online (the camera-off picture), talking,
// muted, aside, private. Character box: characterOffline, character
// (online), talking, muted, characterAside, characterPrivate.
// 'profile' is the player's own photo (header, table tiles, profile page); the
// rest are the admin-set OBS pictures for the Participant and Character boxes.
// The slot keys themselves stay the old "player*" names underneath -- OBS
// scenes and view links already reference them -- only their label changed.
const PARTICIPANT_SLOTS = ['playerOffline', 'player', 'playerTalking', 'playerMuted', 'playerAside', 'playerPrivate'];
const CHARACTER_SLOTS = ['characterOffline', 'character', 'talking', 'muted', 'characterAside', 'characterPrivate'];
// 'background' is a player's own chosen still image behind their camera in
// the call itself (an alternative to blur) -- unrelated to the OBS
// Participant/Character boxes above, but self-service the same way 'profile' is.
const SLOTS = ['profile', 'background', ...PARTICIPANT_SLOTS, ...CHARACTER_SLOTS];
// A room's profile decides which of the two image groups above are even
// offered for it, on a member's per-room section and (eventually) in
// Studio's publish UI: Roleplaying wants both, the other two just one.
const ROOM_PROFILES = ['roleplaying', 'participants', 'characters'];
// A room's optional "launch" link (their VTT, wiki, playlist, whatever) --
// shown as a button next to Join and in the in-call toolbar. The icon is
// picked from the admin's Font Awesome list (Theme tab), stored as that
// icon's id, so a bad value can't render nothing. This is the starting list.
const STARTER_ICONS = [
  'link', 'globe', 'gamepad', 'dice-d20', 'dice-d6', 'scroll', 'book',
  'book-open', 'map', 'compass', 'music', 'headphones', 'video', 'tv',
  'comments', 'wand-magic-sparkles', 'chess', 'users', 'house', 'star', 'couch',
];
const DEFAULT_ICONS = STARTER_ICONS.map((name) => ({ id: name, classes: `fa-solid fa-${name}`, label: name.replace(/-/g, ' ') }));
const DEFAULT_ROOM_LINK_ICON = 'link';
const DEFAULT_HOME_ICON = 'couch';
const ROOM_PROFILE_SLOTS = {
  roleplaying: [...PARTICIPANT_SLOTS, ...CHARACTER_SLOTS],
  participants: PARTICIPANT_SLOTS,
  characters: CHARACTER_SLOTS,
};
// Where the name plate sits on the Participant box. bottom-full spans the
// whole width, flush with the bottom edge (no side margin, unlike the rest).
const PLATE_LAYOUTS = ['upper-left', 'upper-right', 'lower-left', 'lower-right', 'bottom-center', 'bottom-full'];
// How the plate's text is cased, independent of however it was actually
// typed as a display name.
const PLATE_TEXT_CASES = ['default', 'upper', 'lower', 'sentence'];
// Pre-0.3 names, accepted on the way in and on image routes.
const LEGACY_SLOTS = { novideo: 'player', normal: 'character' };
const DEFAULT_BORDER_COLOR = '#6fae6b';
const ROLES = ['admin', 'user'];
// Per-room grants on a member (user.rooms[roomId].permissions). Just one:
// Moderator, which gives them the whole Moderator role (Settings > Roles)
// in that room only -- anything else is a role-level permission, not a
// per-room one.
const ROOM_PERMISSIONS = ['moderator'];
// The four roles (Settings > Roles): no custom roles yet. Admin always has
// every permission and can't be edited; the other three are a grid of
// on/off per permission, defaults below. The last group are enforced by
// the server (kick/mute/invite, asides and private calls); the Table ones
// are enforced by the page itself, since chat, reactions and screen share
// travel peer to peer through LiveKit with no server hop to check.
const ROLE_PERMISSIONS = [
  { key: 'chat', label: 'Send chat messages', group: 'In the Room' },
  { key: 'sendPictures', label: 'Send pictures in chat', group: 'In the Room' },
  { key: 'react', label: 'Use reactions', group: 'In the Room' },
  { key: 'shareScreen', label: 'Share their screen', group: 'In the Room' },
  { key: 'privateCall', label: 'Start a private conversation', group: 'Asides' },
  { key: 'startAside', label: 'Step aside with someone (recorded)', group: 'Asides' },
  { key: 'canMute', label: 'Mute other people', group: 'Moderation' },
  { key: 'canKick', label: 'Kick other people', group: 'Moderation' },
  { key: 'canInvite', label: "Manage a room's guest link", group: 'Moderation' },
  { key: 'image_profile', label: 'Profile photo', group: 'Images' },
  { key: 'image_background', label: 'Call background', group: 'Images' },
  { key: 'image_playerOffline', label: 'Participant: Offline', group: 'Images' },
  { key: 'image_player', label: 'Participant: Online', group: 'Images' },
  { key: 'image_playerTalking', label: 'Participant: Talking', group: 'Images' },
  { key: 'image_playerMuted', label: 'Participant: Muted', group: 'Images' },
  { key: 'image_playerAside', label: 'Participant: Aside', group: 'Images' },
  { key: 'image_playerPrivate', label: 'Participant: Private', group: 'Images' },
  { key: 'image_characterOffline', label: 'Character: Offline', group: 'Images' },
  { key: 'image_character', label: 'Character: Online', group: 'Images' },
  { key: 'image_talking', label: 'Character: Talking', group: 'Images' },
  { key: 'image_muted', label: 'Character: Muted', group: 'Images' },
  { key: 'image_characterAside', label: 'Character: Aside', group: 'Images' },
  { key: 'image_characterPrivate', label: 'Character: Private', group: 'Images' },
];
// Images: everyone but an admin starts with just the profile photo and the
// call background; the OBS pictures are the admin's until a role is given them.
const IMAGE_KEYS = ROLE_PERMISSIONS.filter((p) => p.group === 'Images').map((p) => p.key);
const imageDefaults = (own) => Object.fromEntries(IMAGE_KEYS.map((k) => [k, own && (k === 'image_profile' || k === 'image_background')]));
const EDITABLE_ROLES = ['moderator', 'user', 'guest'];
const ROLE_DEFAULTS = {
  moderator: { ...Object.fromEntries(ROLE_PERMISSIONS.map((p) => [p.key, true])), ...imageDefaults(true) },
  user: { chat: true, sendPictures: true, react: true, shareScreen: true, privateCall: true, startAside: false, canMute: false, canKick: false, canInvite: false, ...imageDefaults(true) },
  guest: { chat: true, sendPictures: true, react: true, shareScreen: true, privateCall: false, startAside: false, canMute: false, canKick: false, canInvite: false, ...imageDefaults(false) },
};
function cleanRoomPermissions(p) {
  return Object.fromEntries(ROOM_PERMISSIONS.map((k) => [k, Boolean(p?.[k])]));
}
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

// A user's own mic/camera processing settings -- everything in the call
// settings popover except which physical device to use (that's per-machine,
// stays in the browser's own localStorage) so they follow the account
// wherever it signs in, not just the browser that last set them.
const QUALITY_OPTIONS = [360, 540, 720];
const BACKGROUND_MODES = ['none', 'blur', 'image'];
// "Mod+KeyD" style strings (see public/hotkeys.js): Mod is Cmd on a Mac,
// Ctrl elsewhere, same as Google Meet's own mute/camera shortcuts.
const HOTKEY_RE = /^(?:(?:Mod|Ctrl|Meta|Alt|Shift)\+){0,4}[A-Za-z0-9]{1,20}$/;
const DEFAULT_CALL_PREFS = {
  gain: 100, gate: 0, noise: true, echo: true, agc: true, ptt: false,
  quality: 720, mirror: true, background: 'none', masterVolume: 100,
  pttKey: 'Space', muteKey: 'Mod+KeyD', camKey: 'Mod+KeyE',
};

const DEFAULT_SETTINGS = {
  serverName: 'Coffee Pub Tavern',
  homeIcon: DEFAULT_HOME_ICON,
  tableName: 'The Table',
  room: 'tavern',
  loginText: 'Your browser will ask for camera and microphone once. Nothing to install.',
  // Self-service sign-up at /register, off by default. A self-registered
  // account is a normal user, added automatically like everyone is to the
  // Lobby, with no password requirement beyond what they pick.
  allowRegistration: false,
  // Call features, on by default -- an admin can turn any of these off
  // server-wide. maxQuality caps the "Quality" picker (see QUALITY_OPTIONS)
  // rather than adding a new tier of its own.
  maxQuality: 720,
  allowScreenShare: true,
  allowAsides: true,
  allowPrivate: true,
  allowReactions: true,
  // Saved color themes (see /theme.css and the :root comment in style.css)
  // -- each one the same seven colors, named and kept around so an admin
  // can switch back without re-picking them. activeThemeId null means "use
  // style.css's own built-in default" (also what "Default" in the chooser
  // resolves to), so a server that's never touched this looks exactly like
  // it always has, byte for byte, rather than round-tripping the same
  // colors back through an extra stylesheet. The two below ship pre-made
  // (see BUILTIN_THEMES/seedBuiltinThemes below for how) -- an admin can
  // edit or delete either exactly like one of their own.
  themes: [],
  activeThemeId: null,
  // Overrides to ROLE_DEFAULTS per editable role -- only what an admin has
  // actually changed, so a permission added later starts at its default.
  roles: {},
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
  plateLayout: 'lower-left',
  plateColor: '#000000',
  plateTextColor: '#f1e6d8',
  plateFontSize: 16,
  plateOpacity: 60,
  plateTextCase: 'default',
  // Behind the Offline / Online picture in the player box: a colour (or
  // transparent) and the picture's size as a percentage of the box.
  pictureBackground: false,
  pictureColor: '#1a1410',
  pictureScale: 100,
  // Dim and tint the OBS view (view.js) renders for a Participant/Character
  // box whose person isn't actually "here" right now: offline entirely,
  // online but in a pulled-aside room while the stream is following someone
  // else (see activeRoom), or in a Private Conversation specifically (its
  // own separate set, since that one also forces the live video off
  // unconditionally -- see isPrivate in view.js -- and an admin may want it
  // to read differently on stream than an ordinary aside). Global, not
  // per-user -- this used to be an OBS filter on Studio's side, moved here
  // since that filter corrupted these sources' alpha transparency. Two
  // independent effects per state, each optional: Dim is a plain
  // brightness reduction (0 = untouched, 100 = black); Tint is a colour
  // overlay with its own opacity (0 = invisible regardless of colour, 100
  // = the colour solid). All 0 by default: nothing about how a stream
  // looks changes until an admin turns one of these on.
  offlineDim: 0,
  offlineTint: '#000000',
  offlineTintOpacity: 0,
  asideDim: 0,
  asideTint: '#000000',
  asideTintOpacity: 0,
  privateDim: 0,
  privateTint: '#000000',
  privateTintOpacity: 0,
  // Font Awesome icons picked on the Theme tab: { id, classes, label }.
  icons: DEFAULT_ICONS,
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

// Shipped pre-made (see seedBuiltinThemes() below), fixed ids so seeding is
// idempotent -- colors read straight off each real site's own computed
// styles (button/link accent, body text, page background), not eyeballed.
// Colors a theme may set beyond the seven base ones. null means "Auto": the
// stylesheet derives it from the base colors (style.css :root), so a theme
// that never touches one keeps following its accent, background and so on.
const THEME_OPTIONAL = ['card', 'headerBg', 'headerText', 'icon', 'iconHover', 'primaryHover', 'secondary', 'secondaryText', 'secondaryHover'];
const BUILTIN_THEMES = [
  { id: 'staying-blonde', name: 'Staying Blonde', bg: '#ffffff', bgSection: '#f7f9fa', border: '#e1e8e8', text: '#333333', textDim: '#767676', accent: '#0dc9ca', onAccent: '#ffffff' },
  { id: 'willhavebeen', name: 'willhavebeen', bg: '#ffffff', bgSection: '#f7f7f7', border: '#e0e0e0', text: '#333333', textDim: '#767676', accent: '#e45628', onAccent: '#ffffff' },
];

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

// The Font Awesome icons an admin has picked: { id, classes, label }. Only
// fa-* class names survive, so whatever was pasted can't smuggle anything else.
function cleanIcons(value) {
  if (!Array.isArray(value)) return null;
  const seen = new Set();
  const out = [];
  for (const i of value) {
    if (!i || typeof i !== 'object') continue;
    const tokens = String(i.classes || '').split(/\s+/).filter((t) => /^fa-[a-z0-9-]+$/.test(t)).slice(0, 8);
    if (!tokens.length) continue;
    const classes = tokens.join(' ');
    const name = tokens.filter((t) => !/^fa-(solid|regular|brands|light|thin|duotone|sharp|fw|lg|xs|sm|2x|3x)$/.test(t)).pop() || 'icon';
    const label = cleanText(i.label, 40) || name.replace(/^fa-/, '').replace(/-/g, ' ');
    let id = typeof i.id === 'string' ? i.id.trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) : '';
    if (!id || seen.has(id)) id = `${name.slice(3, 30)}${seen.has(name.slice(3, 30)) ? '-' + randomKey(4) : ''}`;
    seen.add(id);
    out.push({ id, classes, label });
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

// Accepts a bare domain ("example.com") as well as a full URL, and only
// ever returns http(s) links -- anything else (or unparseable) is dropped
// rather than stored, since it's rendered straight into a link href.
function cleanRoomLink(value) {
  let link = cleanText(value, 500);
  if (!link) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(link)) link = `https://${link}`;
  try {
    const url = new URL(link);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
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
      data.rooms.unshift(this.sanitizeRoom({ id: LOBBY, name: 'Lobby', description: 'Everyone at the table.', members: [], createdAt: new Date().toISOString() }));
    }
    // Ships BUILTIN_THEMES exactly once -- a flag rather than "seed
    // whatever's missing by id" every load, so deleting one (an admin
    // decides they don't want it) sticks instead of it reappearing on the
    // next restart.
    let seededThemes = false;
    if (!data.settings.builtinThemesSeeded) {
      for (const builtin of BUILTIN_THEMES) {
        if (!data.settings.themes.some((t) => t.id === builtin.id)) data.settings.themes.push(builtin);
      }
      data.settings.builtinThemesSeeded = true;
      seededThemes = true;
    }
    // Same once-only idea for the starter Font Awesome icons: a list saved
    // before they existed keeps what it has and gains the starters up front.
    // Themes saved before "Card background" existed call the section color bgCard.
    for (const theme of data.settings.themes || []) {
      if (theme.bgCard !== undefined && theme.bgSection === undefined) {
        theme.bgSection = theme.bgCard;
        delete theme.bgCard;
        seededThemes = true; // just to persist the rename
      }
    }
    let seededIcons = false;
    if (!data.settings.iconsSeeded) {
      const have = Array.isArray(raw.settings?.icons) ? raw.settings.icons : [];
      data.settings.icons = [...DEFAULT_ICONS.filter((d) => !have.some((i) => i.id === d.id)), ...have].map((i) => ({ ...i }));
      data.settings.iconsSeeded = true;
      seededIcons = true;
    }
    if (!raw.secrets?.session || !raw.secrets?.stream || !Array.isArray(raw.rooms) || seededThemes || seededIcons) {
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
      // An aside is still part of the recording -- Studio mutes/dims the
      // members who stepped out, but the two of them stay on stream. A
      // *private* aside is a real off-the-record word: Studio hides those
      // sources entirely, and the admin stepping into one must not drag the
      // stream's "follow the admin" room along with them (see activeRoomId
      // in server/index.js). Only meaningful on an ephemeral room.
      private: Boolean(r.private),
      // Which image sections a member's per-room section (and Studio) offer
      // for this room -- see ROOM_PROFILE_SLOTS.
      profile: ROOM_PROFILES.includes(r.profile) ? r.profile : 'roleplaying',
      // An optional external link (their VTT, wiki, playlist...) offered as
      // a button next to Join and in the in-call toolbar. null when unset.
      link: cleanRoomLink(r.link),
      linkIcon: typeof r.linkIcon === 'string' && /^[a-z0-9-]{1,40}$/.test(r.linkIcon) ? r.linkIcon : DEFAULT_ROOM_LINK_ICON,
      // A standing door code: anyone with this room's guest link joins it
      // with just a name, no account. null while off. See enableGuestLink.
      guestToken: typeof r.guestToken === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(r.guestToken) ? r.guestToken : null,
      // Whether this room allows a guest link at all. Default on: existing
      // rooms from before this setting existed keep working as before.
      allowGuests: r.allowGuests === undefined ? true : Boolean(r.allowGuests),
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
        // Existing rooms that already have their own pictures keep using them
        // (an unset flag reads as "custom" for those); a room with none yet
        // starts on the account defaults.
        rooms[roomId] = {
          images: roomImages,
          useDefaultImages: typeof r.useDefaultImages === 'boolean' ? r.useDefaultImages : Object.keys(roomImages).length === 0,
          permissions: cleanRoomPermissions(r.permissions),
        };
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
      callPrefs: this.sanitizeCallPrefs(u.callPrefs),
      createdAt: typeof u.createdAt === 'string' ? u.createdAt : new Date().toISOString(),
    };
  }

  // Validates just the fields present in `patch` against `base` (the
  // existing value, or the defaults when there is none yet) -- an invalid
  // field is dropped rather than falling back to the default, so a bad
  // value on one field in a PATCH never resets an already-valid other one.
  sanitizeCallPrefs(patch, base = DEFAULT_CALL_PREFS) {
    const p = patch && typeof patch === 'object' ? patch : {};
    const c = { ...base };
    if (p.gain !== undefined) { const n = Math.round(Number(p.gain)); if (Number.isFinite(n)) c.gain = Math.max(0, Math.min(300, n)); }
    if (p.gate !== undefined) { const n = Math.round(Number(p.gate)); if (Number.isFinite(n)) c.gate = Math.max(0, Math.min(60, n)); }
    if (p.noise !== undefined) c.noise = Boolean(p.noise);
    if (p.echo !== undefined) c.echo = Boolean(p.echo);
    if (p.agc !== undefined) c.agc = Boolean(p.agc);
    if (p.ptt !== undefined) c.ptt = Boolean(p.ptt);
    if (p.quality !== undefined && QUALITY_OPTIONS.includes(Number(p.quality))) {
      // this.data isn't assigned yet the very first time this runs --
      // load() calls sanitizeUser() (and so this) while still building the
      // object load() is about to assign to this.data. Falls back to the
      // same default the cap itself defaults to, which is a no-op clamp.
      c.quality = Math.min(Number(p.quality), this.data?.settings?.maxQuality || 720);
    }
    if (p.mirror !== undefined) c.mirror = Boolean(p.mirror);
    if (p.background !== undefined && BACKGROUND_MODES.includes(p.background)) c.background = p.background;
    if (p.masterVolume !== undefined) { const n = Math.round(Number(p.masterVolume)); if (Number.isFinite(n)) c.masterVolume = Math.max(0, Math.min(100, n)); }
    if (p.pttKey !== undefined && HOTKEY_RE.test(p.pttKey)) c.pttKey = p.pttKey;
    if (p.muteKey !== undefined && HOTKEY_RE.test(p.muteKey)) c.muteKey = p.muteKey;
    if (p.camKey !== undefined && HOTKEY_RE.test(p.camKey)) c.camKey = p.camKey;
    return c;
  }

  setCallPrefs(key, patch) {
    const user = this.userByKey(key);
    if (!user) throw new StoreError('no such user', 404);
    user.callPrefs = this.sanitizeCallPrefs(patch, user.callPrefs);
    this.save();
    return user.callPrefs;
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

  iconIds() {
    return (this.data.settings.icons || []).map((i) => i.id);
  }

  updateSettings(patch) {
    const s = this.data.settings;
    if (patch.serverName !== undefined) s.serverName = cleanText(patch.serverName, 60) || DEFAULT_SETTINGS.serverName;
    if (patch.homeIcon !== undefined) {
      if (!this.iconIds().includes(patch.homeIcon)) throw new StoreError('unknown home icon');
      s.homeIcon = patch.homeIcon;
    }
    if (patch.tableName !== undefined) s.tableName = cleanText(patch.tableName, 60) || DEFAULT_SETTINGS.tableName;
    if (patch.loginText !== undefined) s.loginText = String(patch.loginText ?? '').trim().slice(0, 1000);
    if (patch.allowRegistration !== undefined) s.allowRegistration = Boolean(patch.allowRegistration);
    if (patch.maxQuality !== undefined && QUALITY_OPTIONS.includes(Number(patch.maxQuality))) s.maxQuality = Number(patch.maxQuality);
    if (patch.allowScreenShare !== undefined) s.allowScreenShare = Boolean(patch.allowScreenShare);
    if (patch.allowAsides !== undefined) s.allowAsides = Boolean(patch.allowAsides);
    if (patch.allowPrivate !== undefined) s.allowPrivate = Boolean(patch.allowPrivate);
    if (patch.allowReactions !== undefined) s.allowReactions = Boolean(patch.allowReactions);
    // null/empty picks "Default" (style.css's own built-in palette); any
    // other value must be one of the saved themes' ids.
    if (patch.activeThemeId !== undefined) {
      if (!patch.activeThemeId) s.activeThemeId = null;
      else if (s.themes.some((t) => t.id === patch.activeThemeId)) s.activeThemeId = patch.activeThemeId;
      else throw new StoreError('no such theme');
    }
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
    if (patch.plateLayout !== undefined && PLATE_LAYOUTS.includes(patch.plateLayout)) s.plateLayout = patch.plateLayout;
    if (patch.plateColor !== undefined && cleanColor(patch.plateColor)) s.plateColor = cleanColor(patch.plateColor);
    if (patch.plateTextColor !== undefined && cleanColor(patch.plateTextColor)) s.plateTextColor = cleanColor(patch.plateTextColor);
    if (patch.plateFontSize !== undefined) {
      const n = Math.round(Number(patch.plateFontSize));
      if (Number.isFinite(n)) s.plateFontSize = Math.max(10, Math.min(40, n));
    }
    if (patch.plateOpacity !== undefined) {
      const n = Math.round(Number(patch.plateOpacity));
      if (Number.isFinite(n)) s.plateOpacity = Math.max(0, Math.min(100, n));
    }
    if (patch.plateTextCase !== undefined && PLATE_TEXT_CASES.includes(patch.plateTextCase)) s.plateTextCase = patch.plateTextCase;
    if (patch.pictureBackground !== undefined) s.pictureBackground = Boolean(patch.pictureBackground);
    if (patch.pictureColor !== undefined && cleanColor(patch.pictureColor)) s.pictureColor = cleanColor(patch.pictureColor);
    if (patch.pictureScale !== undefined) {
      const n = Math.round(Number(patch.pictureScale));
      if (Number.isFinite(n)) s.pictureScale = Math.max(20, Math.min(100, n));
    }
    // Dim/Tint/Tint opacity, identically shaped for each of the three
    // states -- one small helper rather than the same nine-line block
    // written out three times.
    const applyDimTint = (prefix) => {
      if (patch[`${prefix}Dim`] !== undefined) {
        const n = Math.round(Number(patch[`${prefix}Dim`]));
        if (Number.isFinite(n)) s[`${prefix}Dim`] = Math.max(0, Math.min(100, n));
      }
      if (patch[`${prefix}Tint`] !== undefined && cleanColor(patch[`${prefix}Tint`])) s[`${prefix}Tint`] = cleanColor(patch[`${prefix}Tint`]);
      if (patch[`${prefix}TintOpacity`] !== undefined) {
        const n = Math.round(Number(patch[`${prefix}TintOpacity`]));
        if (Number.isFinite(n)) s[`${prefix}TintOpacity`] = Math.max(0, Math.min(100, n));
      }
    };
    applyDimTint('offline');
    applyDimTint('aside');
    applyDimTint('private');
    if (patch.reactions !== undefined) {
      const reactions = cleanReactions(patch.reactions);
      if (reactions) s.reactions = reactions;
    }
    if (patch.icons !== undefined) {
      const icons = cleanIcons(patch.icons);
      if (icons) s.icons = icons;
    }
    this.save();
    return s;
  }

  // --- themes ---------------------------------------------------------------
  // Same seven colors as the :root comment in style.css, named and saved so
  // an admin can switch back to one without re-picking every color. Every
  // field is required (a half-specified theme would fall back to whatever
  // stale value style.css's own default carries for the rest, which reads
  // as a bug once it's a named, switchable thing rather than a single
  // live override).
  sanitizeTheme(t) {
    const bg = cleanColor(t?.bg);
    const bgSection = cleanColor(t?.bgSection) || cleanColor(t?.bgCard); // bgCard is the old name
    const border = cleanColor(t?.border);
    const text = cleanColor(t?.text);
    const textDim = cleanColor(t?.textDim);
    const accent = cleanColor(t?.accent);
    const onAccent = cleanColor(t?.onAccent);
    if (!bg || !bgSection || !border || !text || !textDim || !accent || !onAccent) return null;
    const optional = Object.fromEntries(THEME_OPTIONAL.map((key) => [key, cleanColor(t?.[key]) || null]));
    return { id: t.id, name: cleanText(t.name, 40) || 'Theme', bg, bgSection, border, text, textDim, accent, onAccent, ...optional };
  }

  get themes() {
    return this.data.settings.themes;
  }

  addTheme(fields) {
    let id;
    do id = randomKey();
    while (this.data.settings.themes.some((t) => t.id === id));
    const theme = this.sanitizeTheme({ ...fields, id });
    if (!theme) throw new StoreError('every color is required');
    this.data.settings.themes.push(theme);
    this.save();
    return theme;
  }

  updateTheme(id, patch) {
    const theme = this.data.settings.themes.find((t) => t.id === id);
    if (!theme) throw new StoreError('no such theme', 404);
    if (patch.name !== undefined) theme.name = cleanText(patch.name, 40) || theme.name;
    if (patch.bgSection === undefined && patch.bgCard !== undefined) patch = { ...patch, bgSection: patch.bgCard }; // the old name
    for (const key of ['bg', 'bgSection', 'border', 'text', 'textDim', 'accent', 'onAccent']) {
      if (patch[key] === undefined) continue;
      const c = cleanColor(patch[key]);
      if (c) theme[key] = c;
    }
    for (const key of THEME_OPTIONAL) {
      if (patch[key] === undefined) continue;
      theme[key] = cleanColor(patch[key]) || null; // null puts it back on Auto
    }
    this.save();
    return theme;
  }

  removeTheme(id) {
    const theme = this.data.settings.themes.find((t) => t.id === id);
    if (!theme) throw new StoreError('no such theme', 404);
    this.data.settings.themes = this.data.settings.themes.filter((t) => t.id !== id);
    if (this.data.settings.activeThemeId === id) this.data.settings.activeThemeId = null;
    this.save();
    return theme;
  }

  // The colors /theme.css should actually render, or null for "Default"
  // (style.css's own built-in palette, no override needed).
  activeTheme() {
    const id = this.data.settings.activeThemeId;
    return id ? this.data.settings.themes.find((t) => t.id === id) || null : null;
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
      plateLayout: PLATE_LAYOUTS.includes(s.plateLayout) ? s.plateLayout : DEFAULT_SETTINGS.plateLayout,
      plateColor: s.plateColor || DEFAULT_SETTINGS.plateColor,
      plateTextColor: s.plateTextColor || DEFAULT_SETTINGS.plateTextColor,
      plateFontSize: s.plateFontSize || DEFAULT_SETTINGS.plateFontSize,
      plateOpacity: s.plateOpacity ?? DEFAULT_SETTINGS.plateOpacity,
      plateTextCase: PLATE_TEXT_CASES.includes(s.plateTextCase) ? s.plateTextCase : DEFAULT_SETTINGS.plateTextCase,
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

  addRoom({ name, description, members, profile, link, linkIcon }) {
    let id;
    do id = randomKey();
    while (this.data.rooms.some((r) => r.id === id));
    const room = this.sanitizeRoom({ id, name: name || 'New room', description, members, profile, link, linkIcon, createdAt: new Date().toISOString() });
    room.members = room.members.filter((k) => this.userByKey(k));
    this.data.rooms.push(room);
    this.save();
    return this.roomById(id);
  }

  // A "pull aside" room for exactly the members given (typically an admin
  // and one player). No name worth keeping server-side; the client builds
  // one from the other member's display name. `origin` is the room they
  // were pulled out of, so they can all be sent back to it later. `priv`
  // marks a real off-the-record word rather than an in-fiction private
  // moment -- see the `private` field's comment in sanitizeRoom.
  addAsideRoom(members, origin, priv = false) {
    let id;
    do id = randomKey();
    while (this.data.rooms.some((r) => r.id === id));
    const room = this.sanitizeRoom({ id, name: 'Aside', description: '', members, ephemeral: true, origin, private: priv, createdAt: new Date().toISOString() });
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
    if (patch.link !== undefined) {
      if (patch.link) {
        const link = cleanRoomLink(patch.link);
        if (!link) throw new StoreError('link must be a valid http(s) URL');
        room.link = link;
      } else {
        room.link = null;
      }
    }
    if (patch.linkIcon !== undefined) {
      if (!this.iconIds().includes(patch.linkIcon)) throw new StoreError('unknown link icon');
      room.linkIcon = patch.linkIcon;
    }
    if (patch.allowGuests !== undefined) {
      room.allowGuests = Boolean(patch.allowGuests);
      if (!room.allowGuests && room.guestToken) room.guestToken = null;
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
    if (!room.allowGuests) throw new StoreError('this room does not allow guests', 403);
    if (!room.guestToken) {
      room.guestToken = randomToken(20);
      this.save();
    }
    return room.guestToken;
  }

  regenerateGuestLink(id) {
    const room = this.data.rooms.find((r) => r.id === id);
    if (!room) throw new StoreError('no such room', 404);
    if (!room.allowGuests) throw new StoreError('this room does not allow guests', 403);
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

  roomEntry(user, roomId) {
    return (user.rooms[roomId] ??= { images: {}, useDefaultImages: true, permissions: cleanRoomPermissions() });
  }

  // Whether this room's own pictures (if any) stand in for the account's
  // defaults -- off by default, see "Use Default Profile Images".
  usesRoomImages(key, roomId) {
    const entry = this.userByKey(key)?.rooms?.[roomId];
    return !!entry && entry.useDefaultImages === false;
  }

  // --- roles -------------------------------------------------------------
  // Every permission for a role: admin all on, the others defaults plus
  // whatever an admin changed.
  // Permissions enabled modules add to the Roles grid (see ModuleManager.permissionList);
  // the server sets this once modules are loaded.
  extraPermissions = () => [];

  // Every permission the Roles grid knows: the built-in ones, then the modules'.
  allPermissions() {
    return [...ROLE_PERMISSIONS, ...this.extraPermissions()];
  }

  roleSet(role) {
    const extras = this.extraPermissions();
    if (role === 'admin') return Object.fromEntries([...ROLE_PERMISSIONS, ...extras].map((p) => [p.key, true]));
    const defaultsFor = { moderator: 'moderator', user: 'user', guest: 'guest' }[role] || 'user';
    const base = { ...(ROLE_DEFAULTS[role] || ROLE_DEFAULTS.user), ...Object.fromEntries(extras.map((p) => [p.key, Boolean(p.defaults?.[defaultsFor])])) };
    const set = { ...base };
    for (const [k, v] of Object.entries(this.data.settings.roles?.[role] || {})) if (k in base) set[k] = Boolean(v);
    return set;
  }

  roles() {
    return Object.fromEntries(['admin', ...EDITABLE_ROLES].map((r) => [r, this.roleSet(r)]));
  }

  setRolePermissions(role, patch) {
    if (!EDITABLE_ROLES.includes(role)) throw new StoreError('that role cannot be changed');
    const mine = (this.data.settings.roles[role] ??= {});
    for (const p of this.allPermissions()) if (patch?.[p.key] !== undefined) mine[p.key] = Boolean(patch[p.key]);
    this.save();
    return this.roles();
  }

  // What someone can actually do in one room: their role's permissions,
  // plus the whole Moderator role if they're marked Moderator there.
  roomPermissions(key, roomId) {
    const user = this.userByKey(key);
    if (!user) return this.roleSet('guest');
    if (user.role === 'admin') return this.roleSet('admin');
    const set = this.roleSet(user.role);
    const flags = cleanRoomPermissions(user.rooms?.[roomId]?.permissions);
    if (flags.moderator) Object.assign(set, Object.fromEntries(Object.entries(this.roleSet('moderator')).filter(([, v]) => v)));
    return set;
  }

  // The stored per-room ticks themselves, for editing (admins read as all on).
  roomFlags(key, roomId) {
    const user = this.userByKey(key);
    if (!user) return cleanRoomPermissions();
    if (user.role === 'admin') return Object.fromEntries(ROOM_PERMISSIONS.map((k) => [k, true]));
    return cleanRoomPermissions(user.rooms?.[roomId]?.permissions);
  }

  setRoomPrefs(key, roomId, patch) {
    const user = this.userByKey(key);
    if (!user) throw new StoreError('no such user', 404);
    const room = this.roomById(roomId);
    if (!room || room.isLobby) throw new StoreError('no such room', 404);
    if (!room.members.includes(key)) throw new StoreError('not a member of that room');
    const entry = this.roomEntry(user, roomId);
    if (patch.useDefaultImages !== undefined) entry.useDefaultImages = Boolean(patch.useDefaultImages);
    if (patch.permissions && typeof patch.permissions === 'object') {
      for (const k of ROOM_PERMISSIONS) if (patch.permissions[k] !== undefined) entry.permissions[k] = Boolean(patch.permissions[k]);
    }
    this.save();
    return entry;
  }

  removeMember(roomId, key) {
    const room = this.data.rooms.find((r) => r.id === roomId);
    if (!room || room.id === LOBBY) throw new StoreError('no such room', 404);
    if (!room.members.includes(key)) throw new StoreError('not in that room', 404);
    room.members = room.members.filter((k) => k !== key);
    this.save();
    return this.roomById(roomId);
  }

  imageBucket(user, roomId) {
    if (!roomId) return user.images;
    return this.roomEntry(user, roomId).images;
  }

  imagePath(key, slot, roomId) {
    const user = this.userByKey(key);
    if (!user) return null;
    const file = roomId ? user.rooms[roomId]?.images?.[slot] : user.images[slot];
    if (!file) return null;
    const full = path.join(this.imageDir(key, roomId), file);
    return fs.existsSync(full) ? full : null;
  }

  // The file to serve for a slot. The profile picture always has a
  // fallback (the initials plate, drawn by the server, not stored here);
  // a Participant slot falls back further, to the server-wide Default
  // Images set below, before finally going transparent; every other slot
  // (Character, background) is simply absent when unset.
  resolveImage(key, slot, roomId) {
    const full = this.imagePath(key, slot, roomId);
    return full ? { file: full, slot } : null;
  }

  // The room's own picture if it has one for this slot, else this same
  // user's own picture (no room override), else -- Participant slots only
  // -- the server-wide Default Images picture, else nothing at all. What
  // OBS actually wants to show for a given user in a given room.
  effectiveImage(key, slot, roomId) {
    const own = (roomId && this.usesRoomImages(key, roomId) && this.resolveImage(key, slot, roomId)) || this.resolveImage(key, slot);
    if (own) return own;
    if (!PARTICIPANT_SLOTS.includes(slot)) return null;
    const file = this.defaultImagePath(slot);
    return file ? { file, slot } : null;
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

  // Default images: images/default/<slot>.<ext>, the server-wide Participant
  // picture a member's own effectiveImage() falls back to once they (and
  // their room, if any) have neither set one -- see effectiveImage above.
  defaultImagePath(slot) {
    if (!PARTICIPANT_SLOTS.includes(slot)) return null;
    const dir = path.join(this.imagesDir, 'default');
    if (!fs.existsSync(dir)) return null;
    const file = fs.readdirSync(dir).find((f) => f.startsWith(`${slot}.`));
    return file ? path.join(dir, file) : null;
  }

  setDefaultImage(slot, buffer, contentType) {
    if (!PARTICIPANT_SLOTS.includes(slot)) throw new StoreError('unknown image', 404);
    const ext = IMAGE_TYPES[contentType];
    if (!ext) throw new StoreError('PNG, JPEG, GIF or WebP only');
    if (!buffer || buffer.length === 0) throw new StoreError('empty upload');
    if (buffer.length > MAX_IMAGE_BYTES) throw new StoreError(`image is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB`);
    this.removeDefaultImage(slot);
    const dir = path.join(this.imagesDir, 'default');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${slot}.${ext}`), buffer);
  }

  removeDefaultImage(slot) {
    const existing = this.defaultImagePath(slot);
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
  LEGACY_SLOTS, ROLES, ROLE_PERMISSIONS, IMAGE_TYPES, MAX_IMAGE_BYTES, DEFAULT_BORDER_COLOR, LOBBY, randomToken, cleanText, cleanLogin,
};
