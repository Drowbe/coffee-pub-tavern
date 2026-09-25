'use strict';

// Users, spaces, settings and images live in DATA_DIR (a Docker volume in production):
//   app.json             users, spaces, settings, secrets
//   images/<key>/<slot>  one image per user slot (player, character, talking, muted...)
//   images/site/<name>   the server icon and the sign-in background
//   images/spaces/<id>    a space's picture
// Everything is loaded once and written back whole; a group's worth of users
// does not need a database.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const words = require('./words');

// Image slots. Participant: what the video box shows when the camera is
// off, plus optional overlays drawn on top while they talk, are muted, are
// aside, or are in a Private Conversation. Character: an optional base
// image plus the same set of overlays for the character box.
// Participant box: offline, online (the camera-off picture), talking,
// muted, aside, private. Character box: characterOffline, character
// (online), talking, muted, characterAside, characterPrivate.
// 'profile' is the player's own photo (header, call tiles, profile page); the
// rest are the admin-set OBS pictures for the Participant and Character boxes.
// The slot keys themselves stay the old "player*" names underneath -- OBS
// scenes and view links already reference them -- only their label changed.
const PARTICIPANT_SLOTS = ['playerOffline', 'player', 'playerTalking', 'playerMuted', 'playerAside', 'playerPrivate'];
const CHARACTER_SLOTS = ['characterOffline', 'character', 'talking', 'muted', 'characterAside', 'characterPrivate'];
// 'background' is a player's own chosen still image behind their camera in
// the call itself (an alternative to blur) -- unrelated to the OBS
// Participant/Character boxes above, but self-service the same way 'profile' is.
const SLOTS = ['profile', 'background', ...PARTICIPANT_SLOTS, ...CHARACTER_SLOTS];
// A space's profile decides which of the two image groups above are even
// offered for it, on a member's per-space section and (eventually) in
// Studio's publish UI: Roleplaying wants both, the other two just one.
const SPACE_PROFILES = ['roleplaying', 'participants', 'characters'];
// A space's optional "launch" link (their VTT, wiki, playlist, whatever) --
// shown as a button next to Join and in the in-call toolbar. The icon is
// picked from the admin's Font Awesome list (Theme tab), stored as that
// icon's id, so a bad value can't render nothing. This is the starting list.
const STARTER_ICONS = [
  'link', 'globe', 'gamepad', 'dice-d20', 'dice-d6', 'scroll', 'book',
  'book-open', 'map', 'compass', 'music', 'headphones', 'video', 'tv',
  'comments', 'wand-magic-sparkles', 'chess', 'users', 'house', 'star', 'couch',
];
const DEFAULT_ICONS = STARTER_ICONS.map((name) => ({ id: name, classes: `fa-solid fa-${name}`, label: name.replace(/-/g, ' ') }));
const DEFAULT_SPACE_LINK_ICON = 'link';
const DEFAULT_HOME_ICON = 'couch';
// A module's display name (settings.moduleNames), at most this long.
const MODULE_NAME_MAX = 40;
// What is wrong with a display name (tidied: its whitespace collapsed), in one sentence, or null. The owner's and a
// template's alike (server/templates.js).
function displayNameProblem(name) {
  if (/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(name)) return "A display name can't hold control or text-direction characters.";
  if (/[<>]/.test(name)) return 'A display name is plain text, without < or >.';
  if (name.length > MODULE_NAME_MAX) return `A display name can be at most ${MODULE_NAME_MAX} characters.`;
  return null;
}
// The template record in app.json (plan-environment-templates.md, "Recording"), or null when there is none or it is
// not one.
function cleanTemplateRecord(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(raw.id)) return null;
  const skipped = Array.isArray(raw.skipped) ? raw.skipped.filter((x) => x && typeof x.id === 'string').map((x) => ({ id: x.id.slice(0, 40), why: String(x.why ?? '').slice(0, 300) })) : [];
  return { id: raw.id, appliedAt: typeof raw.appliedAt === 'string' ? raw.appliedAt : null, skipped };
}
const SPACE_PROFILE_SLOTS = {
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
// An account's role (plan-names, "Roles", decision 7): `owner` runs the environment, `member` is everyone else with
// an account, and `admin` is the server's admin: on a hosted server the host admin's stand-in account inside an
// environment (hostAdmin: true, see resolveLoginUser in index.js), on a single-environment install the account
// ADMIN_LOGIN and ADMIN_PASSWORD make (see buildEnvironment). A guest has no account, and a moderator is a per-space
// grant (below), so neither is an account's role. Only owner and member can be given to an account by hand; admin
// comes only from the host or the server's start (setServerAdmin), and an admin's role, login and password are not
// changed here. An environment may have no owner.
const ROLES = ['admin', 'owner', 'member'];
const ASSIGNABLE_ROLES = ['owner', 'member'];
// Who has every right in the environment: its owners, and the admin.
const OWNER_RIGHTS = ['owner', 'admin'];
const hasOwnerRights = (user) => Boolean(user) && OWNER_RIGHTS.includes(user.role);
// Per-space grants on a member (user.spaces[spaceId].permissions). Just one:
// Moderator, which gives them the whole Moderator role (Settings > Roles)
// in that space only -- anything else is a role-level permission, not a
// per-space one.
const SPACE_PERMISSIONS = ['moderator'];
// The four roles (Settings > Roles): no custom roles yet. Owner always has
// every permission and can't be edited; the other three are a grid of
// on/off per permission, defaults below. The last group are enforced by
// the server (kick/mute/invite, asides and private calls); the in-call ones
// are enforced by the page itself, since chat, reactions and screen share
// travel peer to peer through LiveKit with no server hop to check.
const ROLE_PERMISSIONS = [
  { key: 'conference', label: 'See and join the conference', group: '{Modules}' },
  { key: 'chatRead', label: 'Open and read the chat', group: '{Modules}' },
  { key: 'chat', label: 'Send chat messages', group: 'In the {Space}' },
  { key: 'sendPictures', label: 'Send pictures in chat', group: 'In the {Space}' },
  { key: 'react', label: 'Use reactions', group: 'In the {Space}' },
  { key: 'shareScreen', label: 'Share their screen', group: 'In the {Space}' },
  { key: 'privateCall', label: 'Start a private conversation', group: '{Asides}' },
  { key: 'startAside', label: 'Step aside with someone (recorded)', group: '{Asides}' },
  { key: 'canMute', label: 'Mute other people', group: 'Moderation' },
  { key: 'canKick', label: 'Kick other people', group: 'Moderation' },
  { key: 'canInvite', label: "Manage {a space}'s {guest} link", group: 'Moderation' },
  { key: 'useAi', label: 'Use AI in {modules} (needs an AI service set up)', group: 'AI' },
  { key: 'image_profile', label: 'Profile photo', group: 'Images' },
  { key: 'image_background', label: 'Call background', group: 'Images' },
  { key: 'image_playerOffline', label: 'Participant: Offline', group: 'Images' },
  { key: 'image_player', label: 'Participant: Online', group: 'Images' },
  { key: 'image_playerTalking', label: 'Participant: Talking', group: 'Images' },
  { key: 'image_playerMuted', label: 'Participant: Muted', group: 'Images' },
  { key: 'image_playerAside', label: 'Participant: {Aside}', group: 'Images' },
  { key: 'image_playerPrivate', label: 'Participant: Private', group: 'Images' },
  { key: 'image_characterOffline', label: 'Character: Offline', group: 'Images' },
  { key: 'image_character', label: 'Character: Online', group: 'Images' },
  { key: 'image_talking', label: 'Character: Talking', group: 'Images' },
  { key: 'image_muted', label: 'Character: Muted', group: 'Images' },
  { key: 'image_characterAside', label: 'Character: {Aside}', group: 'Images' },
  { key: 'image_characterPrivate', label: 'Character: Private', group: 'Images' },
];
// Images: everyone but an owner starts with just the profile photo and the
// call background; the OBS pictures are the owner's until a role is given them.
const IMAGE_KEYS = ROLE_PERMISSIONS.filter((p) => p.group === 'Images').map((p) => p.key);
const imageDefaults = (own) => Object.fromEntries(IMAGE_KEYS.map((k) => [k, own && (k === 'image_profile' || k === 'image_background')]));
const EDITABLE_ROLES = ['moderator', 'member', 'guest'];
const ROLE_DEFAULTS = {
  moderator: { ...Object.fromEntries(ROLE_PERMISSIONS.map((p) => [p.key, true])), useAi: false, ...imageDefaults(true) },
  member: { conference: true, chatRead: true, chat: true, sendPictures: true, react: true, shareScreen: true, privateCall: true, startAside: false, canMute: false, canKick: false, canInvite: false, useAi: false, ...imageDefaults(true) },
  guest: { conference: true, chatRead: true, chat: true, sendPictures: true, react: true, shareScreen: true, privateCall: false, startAside: false, canMute: false, canKick: false, canInvite: false, useAi: false, ...imageDefaults(false) },
};
function cleanSpacePermissions(p) {
  return Object.fromEntries(SPACE_PERMISSIONS.map((k) => [k, Boolean(p?.[k])]));
}
// A user's own second factor (documentation/plans/plan-mfa.md), or null. `secret` and `pending.secret` are
// already encrypted by the time they reach here -- this only checks the shape, never the plaintext, which
// this class never sees. A pending-only enrolment (no confirmed secret yet, `start` called but not `enable`)
// is a real, legitimate on-disk state, kept as its own thing rather than folded into "no factor at all".
function sanitizeMfa(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const hasSecret = typeof raw.secret === 'string' && raw.secret;
  const pending = raw.pending && typeof raw.pending === 'object' && typeof raw.pending.secret === 'string' && typeof raw.pending.startedAt === 'string'
    ? { secret: raw.pending.secret, startedAt: raw.pending.startedAt }
    : null;
  if (!hasSecret && !pending) return null;
  return {
    secret: hasSecret ? raw.secret : null,
    enrolledAt: typeof raw.enrolledAt === 'string' ? raw.enrolledAt : null,
    recovery: Array.isArray(raw.recovery) ? raw.recovery.filter((h) => typeof h === 'string') : [],
    version: Number.isFinite(raw.version) ? raw.version : 0,
    lastStep: Number.isFinite(raw.lastStep) ? raw.lastStep : null,
    pending,
  };
}
// The old policy, a four-way string (documentation/plans/plan-mfa.md, before "Regaining access" was redesigned
// around the switches), becomes a plain boolean: 'everyone' meant mandatory for everyone, so that is the only
// case that carries forward as true; 'owners' (mandatory for admins only) has no boolean equivalent and reads
// as false, same as 'optional' and 'off' always did (the old 'off' is now the server's own ENABLE_MFA instead,
// not a per-environment setting at all). Read once, on load; the old key is dropped from what comes back, so
// the very next save leaves it out of the file for good.
function migrateMfaSettings(raw) {
  const settings = raw && typeof raw === 'object' ? raw : {};
  const { mfa, ...rest } = settings;
  if (typeof rest.mfaRequired !== 'boolean') rest.mfaRequired = mfa === 'everyone';
  return rest;
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

// The languages the interface comes in (a setting; only English so far).
const LANGUAGES = ['en'];
// The currencies the server setting accepts: the ISO 4217 codes Node's own Intl knows (the page lists the same ones).
const CURRENCIES = new Set(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') : []);
const DEFAULT_SETTINGS = {
  environmentName: 'Coffee Pub Tavern', // a sentinel for a never-renamed install; environmentFor() replaces it once, on start
  homeIcon: DEFAULT_HOME_ICON,
  loginText: 'Your browser will ask for camera and microphone once. Nothing to install.',
  // Self-service sign-up at /register, off by default. A self-registered
  // account is a normal user, added automatically like everyone is to the
  // Lobby, with no password requirement beyond what they pick.
  allowRegistration: false,
  // Two-step sign-in policy (documentation/plans/plan-mfa.md): off by default (anyone may still enrol and is
  // then asked; this only makes it mandatory). Whether the feature is offered at all is the server's own
  // ENABLE_MFA, not a per-environment setting. Bites at the next sign-in, never an already-open session.
  mfaRequired: false,
  // Call features, on by default -- an admin can turn any of these off
  // server-wide. maxQuality caps the "Quality" picker (see QUALITY_OPTIONS)
  // rather than adding a new tier of its own.
  maxQuality: 720,
  allowScreenShare: true,
  allowAsides: true,
  allowPrivate: true,
  allowReactions: true,
  // The video and voice conference. Off, nobody (an admin included) has the "See and join the conference" permission, so joins carry
  // no media and the space page shows no conference; chat, presence and the modules carry on.
  conferenceEnabled: true,
  // Language, time and money: how the server and every module show them. The clock is 12-hour by default; the
  // currency is the one amounts are shown in unless a trip says otherwise; only English is available so far.
  language: 'en',
  clock: '12',
  currency: 'USD',
  // Saved color themes (see /theme.css and the :root comment in style.css)
  // -- each one a light and a dark set of the same seven colors, named and
  // kept around so an admin can switch back without re-picking them.
  // activeThemeId null means Strong Coffee, the built-in default (see
  // DEFAULT_THEME): dark, it is style.css's own palette byte for byte,
  // rather than round-tripping the same colors back through an extra
  // stylesheet. The two in BUILTIN_THEMES ship pre-made -- an admin can
  // edit or delete either exactly like one of their own. themeMode picks
  // the light or the dark set of whichever theme is live.
  themes: [],
  activeThemeId: null,
  themeMode: 'dark',
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
  // online but in a pulled-aside space while the stream is following someone
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
  // The reaction tray in the call: id (also the 1-6 shortcut order and the
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
const THEME_BASE = ['bg', 'bgSection', 'border', 'text', 'textDim', 'accent', 'onAccent'];
// Every theme has a light and a dark set of those colors (either may be
// missing; the other then shows in both modes), and the server's themeMode
// picks which one is live.
// Strong Coffee is the built-in default ("Default" in the chooser, no
// stored theme): its dark set is style.css's own :root, so /theme.css sends
// nothing for it, and its light set is this one.
const DEFAULT_THEME = {
  name: 'Strong Coffee',
  dark: { bg: '#1a1410', bgSection: '#241c16', border: '#3b2e24', text: '#f1e6d8', textDim: '#a8998a', accent: '#c8873a', onAccent: '#1a1206' },
  light: { bg: '#faf6f1', bgSection: '#f1e9df', border: '#ded0bf', text: '#2b2119', textDim: '#76675a', accent: '#a8692a', onAccent: '#ffffff' },
};
const BUILTIN_THEMES = [
  {
    id: 'staying-blonde',
    name: 'Calming Teal',
    light: { bg: '#ffffff', bgSection: '#f7f9fa', border: '#e1e8e8', text: '#333333', textDim: '#767676', accent: '#0dc9ca', onAccent: '#ffffff' },
    dark: { bg: '#111a1b', bgSection: '#182325', border: '#2a3b3d', text: '#e4eeee', textDim: '#8ea3a4', accent: '#0dc9ca', onAccent: '#062021' },
  },
  {
    id: 'willhavebeen',
    name: 'Burnt Orange',
    light: { bg: '#ffffff', bgSection: '#f7f7f7', border: '#e0e0e0', text: '#333333', textDim: '#767676', accent: '#e45628', onAccent: '#ffffff' },
    dark: { bg: '#1a1512', bgSection: '#241d19', border: '#3c302a', text: '#eee8e3', textDim: '#a69a91', accent: '#e45628', onAccent: '#ffffff' },
  },
];
// What the built-ins were called before they had a light and a dark set:
// renamed once, unless an admin had already renamed them.
const BUILTIN_OLD_NAMES = { 'staying-blonde': 'Staying Blonde', willhavebeen: 'willhavebeen' };

// One mode's colors: the seven required, the optional ones null on Auto.
function cleanThemeColors(c) {
  if (!c || typeof c !== 'object') return null;
  const base = Object.fromEntries(THEME_BASE.map((key) => [key, cleanColor(c[key])]));
  base.bgSection ||= cleanColor(c.bgCard); // bgCard is the old name
  if (THEME_BASE.some((key) => !base[key])) return null;
  return { ...base, ...Object.fromEntries(THEME_OPTIONAL.map((key) => [key, cleanColor(c[key]) || null])) };
}

// Light or dark, by how bright a background is.
function colorMode(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.5 ? 'light' : 'dark';
}

const cleanMode = (mode) => (mode === 'light' ? 'light' : 'dark');

function cleanWidth(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(1, Math.min(24, n)) : null;
}

// A theme's author: plain text (no control characters) up to 60 characters, or '' for none.
function cleanAuthor(value) {
  return typeof value === 'string' ? cleanText(value.replace(/\p{Cc}/gu, ' '), 60) : '';
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
function cleanSpaceLink(value) {
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
    this.file = path.join(dir, 'app.json');
    // A rename from before this file was called app.json: move it once, so nobody's data goes missing under the
    // new name and nobody needs to touch anything by hand.
    const legacyFile = path.join(dir, 'tavern.json');
    if (!fs.existsSync(this.file) && fs.existsSync(legacyFile)) fs.renameSync(legacyFile, this.file);
    this.imagesDir = path.join(dir, 'images');
    fs.mkdirSync(this.imagesDir, { recursive: true });
    this.data = this.load();
    // The words this environment's template gives (plan-environment-templates.md): none until templates are built,
    // so every key reads the owner's word or the default.
    this.templateWords = null;
    // The module display names and icons this environment's template gives, by module id (step 3; none until then).
    this.templateModuleNames = null;
    this.templateModuleIcons = null;
    this.templateHomeIcon = null; // the template's home icon, for an environment whose own homeIcon is unset
    // The icons installed and built-in modules have of their own (their manifests'), which a display icon may also be;
    // set by the environment's build (environment.js, index.js).
    this.moduleIconIds = () => [];
  }

  load() {
    // A missing app.json is a new environment. One that is there but is not valid JSON is never started as empty
    // (the first save would write over everything in it): the environment's build refuses it first
    // (server/migrate-names.js, refuseUnreadable), and Store refuses it too, in case it changed since.
    let raw = {};
    let text = null;
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw new StoreError(`Could not read ${this.file} (${err.message}). Fix or restore this file, then start again.`, 500);
    }
    if (text !== null) {
      // An install from before app.json was kept private (or restored, or copied by hand) may have it readable by
      // others: made private to the server's user on every load. Best effort -- a file this user doesn't own stays as is.
      try { fs.chmodSync(this.file, 0o600); } catch { /* not ours to change */ }
      try {
        raw = JSON.parse(text);
      } catch (err) {
        throw new StoreError(`${this.file} is not valid JSON (${err.message}). Fix or restore this file, then start again.`, 500);
      }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      const what = raw === null ? 'null' : Array.isArray(raw) ? 'a list' : `a ${typeof raw}`;
      throw new StoreError(`${this.file} is not an environment's data (it holds ${what}, not an object). Fix or restore this file, then start again.`, 500);
    }
    const data = {
      // 1 until the Names migration's first part runs (server/migrate-names.js), which records itself here as
      // `migrations`; both are kept exactly as found, so the record survives every later save.
      version: Number.isInteger(raw.version) && raw.version > 1 ? raw.version : 1,
      ...(Array.isArray(raw.migrations) ? { migrations: raw.migrations } : {}),
      // The template this environment was made from (plan-environment-templates.md, decision 14): its own record, not a
      // names migration part. { id, appliedAt (null until applied), skipped: [{ id, why }] }.
      ...(cleanTemplateRecord(raw.template) ? { template: cleanTemplateRecord(raw.template) } : {}),
      secrets: {
        session: raw.secrets?.session || randomToken(32),
        stream: raw.secrets?.stream || randomToken(18),
      },
      settings: { ...DEFAULT_SETTINGS, ...migrateMfaSettings(raw.settings) },
      users: Array.isArray(raw.users) ? raw.users.map((u) => this.sanitizeUser(u)).filter(Boolean) : [],
      spaces: Array.isArray(raw.spaces) ? raw.spaces.map((r) => this.sanitizeSpace(r)).filter(Boolean) : [],
      invites: Array.isArray(raw.invites) ? raw.invites.map((i) => this.sanitizeInvite(i)).filter(Boolean) : [],
    };
    if (!data.spaces.some((r) => r.id === LOBBY)) {
      data.spaces.unshift(this.sanitizeSpace({ id: LOBBY, name: 'Lobby', description: 'Where everyone meets.', members: [], createdAt: new Date().toISOString() }));
    }
    // Ships BUILTIN_THEMES exactly once -- a flag rather than "seed
    // whatever's missing by id" every load, so deleting one (an admin
    // decides they don't want it) sticks instead of it reappearing on the
    // next restart.
    let seededThemes = false;
    // A copy, never DEFAULT_SETTINGS' own array, which every store shares.
    data.settings.themes = Array.isArray(data.settings.themes) ? [...data.settings.themes] : [];
    if (!data.settings.builtinThemesSeeded) {
      for (const builtin of BUILTIN_THEMES) {
        if (!data.settings.themes.some((t) => t.id === builtin.id)) data.settings.themes.push(structuredClone(builtin));
      }
      data.settings.builtinThemesSeeded = true;
      seededThemes = true;
    }
    // Themes saved before light and dark hold one set of colors at the top
    // level (the oldest calling the section color bgCard): that set becomes
    // the mode its background reads as.
    data.settings.themes = data.settings.themes.map((theme) => {
      if (theme.light !== undefined || theme.dark !== undefined) return theme;
      seededThemes = true;
      return this.sanitizeTheme(theme);
    }).filter(Boolean);
    // Once: the built-ins take their new names and gain the mode they were
    // missing, and the mode starts as whatever the live theme already was,
    // so nothing changes by itself.
    if (!data.settings.themeModesSeeded) {
      const active = data.settings.themes.find((t) => t.id === data.settings.activeThemeId);
      data.settings.themeMode = active && !active.dark ? 'light' : 'dark';
      for (const builtin of BUILTIN_THEMES) {
        const theme = data.settings.themes.find((t) => t.id === builtin.id);
        if (!theme) continue;
        if (theme.name === BUILTIN_OLD_NAMES[builtin.id]) theme.name = builtin.name;
        theme.light ||= this.sanitizeTheme(builtin).light;
        theme.dark ||= this.sanitizeTheme(builtin).dark;
      }
      data.settings.themeModesSeeded = true;
      seededThemes = true;
    }
    // Same once-only idea for the starter Font Awesome icons: a list saved
    // before they existed keeps what it has and gains the starters up front.
    let seededIcons = false;
    if (!data.settings.iconsSeeded) {
      const have = Array.isArray(raw.settings?.icons) ? raw.settings.icons : [];
      data.settings.icons = [...DEFAULT_ICONS.filter((d) => !have.some((i) => i.id === d.id)), ...have].map((i) => ({ ...i }));
      data.settings.iconsSeeded = true;
      seededIcons = true;
    }
    if (!raw.secrets?.session || !raw.secrets?.stream || !Array.isArray(raw.spaces) || seededThemes || seededIcons) {
      this.data = data;
      this.save();
    }
    return data;
  }

  sanitizeSpace(r) {
    if (!r || typeof r !== 'object') return null;
    const id = typeof r.id === 'string' && /^[a-z0-9]{4,16}$/.test(r.id) ? r.id : null;
    if (!id) return null;
    return {
      id,
      name: cleanText(r.name, 40) || (id === LOBBY ? 'Lobby' : this.word('space', { cap: true })),
      description: String(r.description ?? '').trim().slice(0, 300),
      members: Array.isArray(r.members) ? [...new Set(r.members.filter((k) => typeof k === 'string'))] : [],
      createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
      // A "pull aside" space: not shown on the manage page's Spaces tab, not
      // hand-editable, and swept away once nobody online is actually in it.
      ephemeral: Boolean(r.ephemeral),
      // The space an ephemeral space was pulled out of, so leaving the aside
      // can return everyone there instead of always landing on the Lobby.
      origin: typeof r.origin === 'string' && /^[a-z0-9]{4,16}$/.test(r.origin) ? r.origin : null,
      // An aside is still part of the recording -- Studio mutes/dims the
      // members who stepped out, but the two of them stay on stream. A
      // *private* aside is a real off-the-record word: Studio hides those
      // sources entirely, and the admin stepping into one must not drag the
      // stream's "follow the admin" space along with them (see activeRoomId
      // in server/index.js). Only meaningful on an ephemeral space.
      private: Boolean(r.private),
      // Which image sections a member's per-space section (and Studio) offer
      // for this space -- see SPACE_PROFILE_SLOTS.
      profile: SPACE_PROFILES.includes(r.profile) ? r.profile : 'roleplaying',
      // An optional external link (their VTT, wiki, playlist...) offered as
      // a button next to Join and in the in-call toolbar. null when unset.
      link: cleanSpaceLink(r.link),
      linkIcon: typeof r.linkIcon === 'string' && /^[a-z0-9-]{1,40}$/.test(r.linkIcon) ? r.linkIcon : DEFAULT_SPACE_LINK_ICON,
      // A standing door code: anyone with this space's guest link joins it
      // with just a name, no account. null while off. See enableGuestLink.
      guestToken: typeof r.guestToken === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(r.guestToken) ? r.guestToken : null,
      // Whether this space allows a guest link at all. Default on: existing
      // spaces from before this setting existed keep working as before.
      allowGuests: r.allowGuests === undefined ? true : Boolean(r.allowGuests),
    };
  }

  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    // Private to the server's own user: it holds password hashes, session and link tokens. The mode is set again in
    // case an old .tmp was left behind by a crash (a mode given to writeFileSync only applies to a file it creates).
    fs.writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
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
    // Per-space image overrides: a space's picture set stands in for the
    // defaults above only for that space, so the same person can be one
    // character in one campaign and another in a different one.
    const spaces = {};
    if (u.spaces && typeof u.spaces === 'object') {
      for (const [spaceId, r] of Object.entries(u.spaces)) {
        if (!r || typeof r !== 'object') continue;
        const spaceImages = {};
        for (const slot of SLOTS) {
          if (typeof r.images?.[slot] === 'string') spaceImages[slot] = r.images[slot];
        }
        // Existing spaces that already have their own pictures keep using them
        // (an unset flag reads as "custom" for those); a space with none yet
        // starts on the account defaults.
        spaces[spaceId] = {
          images: spaceImages,
          useDefaultImages: typeof r.useDefaultImages === 'boolean' ? r.useDefaultImages : Object.keys(spaceImages).length === 0,
          permissions: cleanSpacePermissions(r.permissions),
        };
      }
    }
    return {
      key,
      login: cleanLogin(u.login) || key,
      displayName: cleanText(u.displayName, 40) || cleanLogin(u.login) || key,
      // The stand-in is always `admin`; anything else reads as it is stored, or as a member when it is no role at all
      // (the names-roles migration has already renamed the old values, so this only ever meets them in hand-made data).
      role: u.hostAdmin ? 'admin' : ROLES.includes(u.role) ? u.role : 'member',
      passwordHash: typeof u.passwordHash === 'string' ? u.passwordHash : null,
      // A user record that stands in for a host admin signed in here (see resolveLoginUser in index.js): its own
      // passwordHash is always null, so nothing inside the environment can ever authenticate as it directly -- the
      // check always goes back to the host registry.
      hostAdmin: Boolean(u.hostAdmin),
      linkToken: typeof u.linkToken === 'string' && u.linkToken ? u.linkToken : null,
      mfa: sanitizeMfa(u.mfa),
      images,
      spaces,
      player: {}, // borders and the plate are server-wide now; older per-user values are dropped
      callPrefs: this.sanitizeCallPrefs(u.callPrefs),
      // Their own light or dark (GitHub #62); left off while they follow the environment's default mode.
      ...(u.themeMode === 'light' || u.themeMode === 'dark' ? { themeMode: u.themeMode } : {}),
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

  // Every level's and role's words for this environment (server/words.js): the owner's, else the template's, else
  // the default.
  resolvedWords() {
    return words.resolve(this.data.settings.words, this.templateWords);
  }

  // The template's own words, unresolved ({ <key>: { one, many, a? } }), or null for an environment with no template.
  templateWordsView() {
    return this.templateWords ? words.ownOnly(this.templateWords) : null;
  }

  // The owner's own words as stored (settings.words), unresolved: { <key>: { one, many, a? } }, {} when none are set.
  ownWords() {
    return words.ownOnly(this.data.settings.words);
  }

  // --- module display names and icons (plan-environment-templates.md, "Module display names and icons") -------
  // What a module is called and shown as in this environment, by module id (installed, bundled or built in): the
  // owner's own (settings.moduleNames / settings.moduleIcons), else the template's, else null, meaning the module's
  // own name and icon from its manifest. `ownName`/`ownIcon`: the owner's alone, for Manage's fields.
  moduleDisplay(id) {
    const own = (map) => { const v = this.data.settings[map]?.[id]; return typeof v === 'string' && v ? v : null; };
    const from = (map) => { const v = map && typeof map === 'object' ? map[id] : null; return typeof v === 'string' && v ? v : null; };
    const ownName = own('moduleNames');
    const ownIcon = own('moduleIcons');
    // An icon applies only while it can be drawn (displayIconIds); one that cannot now (its module uninstalled, its
    // entry taken off the icon list) is kept as the owner's, and reported as such, but reads the next one down.
    const icons = this.displayIconIds();
    const icon = [ownIcon, from(this.templateModuleIcons)].find((i) => i && icons.includes(i)) || null;
    // templateName/templateIcon: what the template gives, whether or not the owner's own is set over it.
    return { name: ownName || from(this.templateModuleNames), icon, ownName, ownIcon, templateName: from(this.templateModuleNames), templateIcon: from(this.templateModuleIcons) };
  }

  // What a display icon may be: one the pages can draw as a module's icon (`fa-solid fa-<id>`), so one of this
  // environment's icons whose classes are exactly that, or any installed or built-in module's own icon.
  // A template's module icons count too: server/templates.js only takes Font Awesome Free solid icons.
  displayIconIds() {
    const solid = (this.data.settings.icons || []).filter((i) => i.classes === `fa-solid fa-${i.id}`).map((i) => i.id);
    const template = this.templateModuleIcons && typeof this.templateModuleIcons === 'object' ? Object.values(this.templateModuleIcons) : [];
    return [...new Set([...solid, ...this.moduleIconIds(), ...template])];
  }

  // The template this environment was made from, as recorded, or null (server/templates.js).
  get templateRecord() {
    return this.data.template || null;
  }

  recordTemplate(record) {
    const clean = cleanTemplateRecord(record);
    if (clean) this.data.template = clean;
    else delete this.data.template;
    this.save();
  }

  // The home icon people see: the owner's (settings.homeIcon), else the template's, else the default.
  get homeIcon() {
    return this.data.settings.homeIcon || this.templateHomeIcon || DEFAULT_HOME_ICON;
  }

  // A change to a module's display name and icon, checked: { displayName?, displayIcon? }, each a value or null (or
  // '' for the name) to go back to the template's or the module's own. Answers the cleaned change; throws a StoreError
  // (one sentence) and changes nothing when either is refused. applyModuleDisplay() saves it.
  // `id`: the module's, so an icon it already has is always accepted back unchanged, even one that cannot be drawn now.
  checkModuleDisplay(id, { displayName, displayIcon } = {}) {
    const draft = {};
    if (displayName !== undefined) {
      if (displayName === null || displayName === '') draft.name = null;
      else if (typeof displayName !== 'string') throw new StoreError(`A display name must be text, or null to use the ${this.word('module')}'s own name.`);
      else {
        const name = displayName.replace(/\s+/g, ' ').trim(); // tabs and new lines read as spaces
        const problem = displayNameProblem(name);
        if (problem) throw new StoreError(problem);
        draft.name = name || null;
      }
    }
    if (displayIcon !== undefined) {
      if (displayIcon === null || displayIcon === '') draft.icon = null;
      else if (typeof displayIcon !== 'string') throw new StoreError(`An icon must be one of this ${this.word('environment')}'s icons, or null to use the ${this.word('module')}'s own.`);
      else if (displayIcon === this.data.settings.moduleIcons?.[id] || this.displayIconIds().includes(displayIcon)) draft.icon = displayIcon;
      else if (this.iconIds().includes(displayIcon)) throw new StoreError(`The icon ${displayIcon.slice(0, 40)} is not a solid Font Awesome icon, so it can't be ${this.word('module', { a: true })}'s icon.`);
      else throw new StoreError(`There is no icon called ${displayIcon.slice(0, 40)} in this ${this.word('environment')}'s icons.`);
    }
    return draft;
  }

  applyModuleDisplay(id, draft) {
    const set = (map, value) => {
      const next = { ...(this.data.settings[map] || {}) };
      if (value) next[id] = value;
      else delete next[id];
      if (Object.keys(next).length) this.data.settings[map] = next;
      else delete this.data.settings[map];
    };
    if (draft.name !== undefined) set('moduleNames', draft.name);
    if (draft.icon !== undefined) set('moduleIcons', draft.icon);
    if (draft.name !== undefined || draft.icon !== undefined) this.save();
  }

  // One level's or role's word in this environment (server/words.js's format): the defaults while app.json is still
  // being read.
  word(key, options) {
    return words.format(this.data ? this.resolvedWords() : null, key, options);
  }

  // Every field is checked into a draft first and the draft applied at the end, so a refused field
  // (a StoreError) leaves the settings exactly as they were, the other fields in the patch included.
  updateSettings(patch) {
    const s = { ...this.data.settings };
    // The owner's words (settings.words): only the keys given change, null returning one to the template's or the
    // default; a refused word refuses the whole patch. Left out of the settings altogether while none are set.
    let clearWords = false;
    if (patch.words !== undefined) {
      const { words: next, error } = words.applyPatch(s.words, patch.words);
      if (error) throw new StoreError(error);
      if (Object.keys(next).length) s.words = next;
      else { delete s.words; clearWords = true; }
    }
    if (patch.environmentName !== undefined) s.environmentName = cleanText(patch.environmentName, 60) || DEFAULT_SETTINGS.environmentName;
    // null (or '') goes back to the template's home icon, else the default.
    if (patch.homeIcon !== undefined) {
      if (patch.homeIcon === null || patch.homeIcon === '') s.homeIcon = null;
      else if (!this.iconIds().includes(patch.homeIcon)) throw new StoreError('unknown home icon');
      else s.homeIcon = patch.homeIcon;
    }
    // What a new space starts with (a template sets it; plan-environment-templates.md, spaceDefaults): its profile.
    // null clears it (a new space then starts as roleplaying); anything but profile inside it is refused.
    let clearSpaceDefaults = false;
    if (patch.spaceDefaults !== undefined) {
      const given = patch.spaceDefaults;
      if (given === null) { delete s.spaceDefaults; clearSpaceDefaults = true; }
      else if (!given || typeof given !== 'object' || Array.isArray(given) || Object.keys(given).some((k) => k !== 'profile')) throw new StoreError('spaceDefaults takes only profile.');
      else if (!SPACE_PROFILES.includes(given.profile)) throw new StoreError('profile must be roleplaying, participants or characters');
      else s.spaceDefaults = { profile: given.profile };
    }
    if (patch.loginText !== undefined) s.loginText = String(patch.loginText ?? '').trim().slice(0, 1000);
    if (patch.allowRegistration !== undefined) s.allowRegistration = Boolean(patch.allowRegistration);
    if (patch.mfaRequired !== undefined) s.mfaRequired = Boolean(patch.mfaRequired);
    if (patch.maxQuality !== undefined && QUALITY_OPTIONS.includes(Number(patch.maxQuality))) s.maxQuality = Number(patch.maxQuality);
    if (patch.allowScreenShare !== undefined) s.allowScreenShare = Boolean(patch.allowScreenShare);
    if (patch.allowAsides !== undefined) s.allowAsides = Boolean(patch.allowAsides);
    if (patch.allowPrivate !== undefined) s.allowPrivate = Boolean(patch.allowPrivate);
    if (patch.allowReactions !== undefined) s.allowReactions = Boolean(patch.allowReactions);
    if (patch.conferenceEnabled !== undefined) s.conferenceEnabled = Boolean(patch.conferenceEnabled);
    if (patch.language !== undefined) s.language = LANGUAGES.includes(patch.language) ? patch.language : DEFAULT_SETTINGS.language;
    if (patch.clock !== undefined) s.clock = String(patch.clock) === '24' ? '24' : '12';
    if (patch.currency !== undefined) {
      const code = String(patch.currency || '').trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) throw new StoreError('a currency is a three-letter code, such as USD');
      // An unknown code is refused, unless it is the one already set (an older value saved as it was, not lost).
      if (!CURRENCIES.has(code) && code !== String(s.currency || '').toUpperCase()) throw new StoreError(`${code} is not a currency this server knows. Choose one from the list, such as USD.`);
      s.currency = code;
    }
    // null/empty picks "Default" (style.css's own built-in palette); any
    // other value must be one of the saved themes' ids.
    if (patch.activeThemeId !== undefined) {
      if (!patch.activeThemeId) s.activeThemeId = null;
      else if (s.themes.some((t) => t.id === patch.activeThemeId)) s.activeThemeId = patch.activeThemeId;
      else throw new StoreError('no such theme');
    }
    if (patch.themeMode !== undefined) {
      if (patch.themeMode !== 'light' && patch.themeMode !== 'dark') throw new StoreError('the mode is light or dark');
      s.themeMode = patch.themeMode;
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
    Object.assign(this.data.settings, s);
    if (clearWords) delete this.data.settings.words;
    if (clearSpaceDefaults) delete this.data.settings.spaceDefaults;
    this.save();
    return this.data.settings;
  }

  // --- themes ---------------------------------------------------------------
  // Same seven colors as the :root comment in style.css, named and saved so
  // an admin can switch back to one without re-picking every color, in a
  // light and a dark set. Every one of the seven is required in a set (a
  // half-specified one would fall back to whatever stale value style.css's
  // own default carries for the rest, which reads as a bug once it's a
  // named, switchable thing rather than a single live override).
  sanitizeTheme(t) {
    let light = cleanThemeColors(t?.light);
    let dark = cleanThemeColors(t?.dark);
    if (!light && !dark) {
      // One set at the top level: a caller, or a theme saved before light and dark.
      const colors = cleanThemeColors(t);
      if (!colors) return null;
      if (colorMode(colors.bg) === 'light') light = colors;
      else dark = colors;
    }
    // Who made it, when it came in from a theme file (documentation/plans/plan-themes.md): plain text up to 60
    // characters, kept so a theme exported again still names them. A theme made in Manage has none.
    const author = cleanAuthor(t.author);
    return { id: t.id, name: cleanText(t.name, 40) || 'Theme', ...(author ? { author } : {}), light, dark };
  }

  get themes() {
    return this.data.settings.themes;
  }

  // Strong Coffee, the built-in default: its name and both sets, for the chooser.
  get defaultTheme() {
    return this.sanitizeTheme({ ...DEFAULT_THEME, id: null });
  }

  // fields: a name, the mode these colors are for, and the colors.
  addTheme(fields) {
    let id;
    do id = randomKey();
    while (this.data.settings.themes.some((t) => t.id === id));
    const colors = cleanThemeColors(fields);
    if (!colors) throw new StoreError('every color is required');
    const theme = { id, name: cleanText(fields.name, 40) || 'Theme', light: null, dark: null, [cleanMode(fields.mode)]: colors };
    this.data.settings.themes.push(theme);
    this.save();
    return theme;
  }

  // Colors in the patch go to its mode's set; a set the theme did not have
  // yet starts from the other one.
  updateTheme(id, patch) {
    const theme = this.data.settings.themes.find((t) => t.id === id);
    if (!theme) throw new StoreError('no such theme', 404);
    if (patch.name !== undefined) theme.name = cleanText(patch.name, 40) || theme.name;
    if (patch.bgSection === undefined && patch.bgCard !== undefined) patch = { ...patch, bgSection: patch.bgCard }; // the old name
    const mode = cleanMode(patch.mode);
    const set = { ...(theme[mode] || theme.light || theme.dark) };
    let changed = false;
    for (const key of THEME_BASE) {
      if (patch[key] === undefined) continue;
      const c = cleanColor(patch[key]);
      if (c) set[key] = c;
      changed = true;
    }
    for (const key of THEME_OPTIONAL) {
      if (patch[key] === undefined) continue;
      set[key] = cleanColor(patch[key]) || null; // null puts it back on Auto
      changed = true;
    }
    if (changed) theme[mode] = set;
    this.save();
    return theme;
  }

  // A theme read from a theme file (server/theme-file.js has already checked it: { name, author?, light, dark },
  // at least one set whole): added as a new theme with a new id, and a name already in use is never overwritten --
  // it becomes "Name (2)", then "(3)" and so on (plan-themes decision 2). Never changes the active theme or the mode.
  importTheme(fields) {
    const clean = this.sanitizeTheme({ id: null, name: fields.name, author: fields.author, light: fields.light, dark: fields.dark });
    if (!clean || (!clean.light && !clean.dark)) throw new StoreError('This theme has no complete light or dark set: each needs all seven base colors.');
    let id;
    do id = randomKey();
    while (this.data.settings.themes.some((t) => t.id === id));
    const theme = { ...clean, id, name: this.freeThemeName(clean.name) };
    this.data.settings.themes.push(theme);
    this.save();
    return theme;
  }

  // `name`, or "name (2)", "(3)"... when a theme (Strong Coffee included) already has it, ignoring case; the
  // number always fits inside the 40 characters a name may have.
  freeThemeName(name) {
    const lower = (x) => String(x || '').trim().toLowerCase();
    const taken = new Set([...this.data.settings.themes.map((t) => t.name), DEFAULT_THEME.name].map(lower));
    if (!taken.has(lower(name))) return name;
    for (let n = 2; ; n += 1) {
      const suffix = ` (${n})`;
      const candidate = `${name.slice(0, 40 - suffix.length).trimEnd()}${suffix}`;
      if (!taken.has(lower(candidate))) return candidate;
    }
  }

  removeTheme(id) {
    const theme = this.data.settings.themes.find((t) => t.id === id);
    if (!theme) throw new StoreError('no such theme', 404);
    this.data.settings.themes = this.data.settings.themes.filter((t) => t.id !== id);
    if (this.data.settings.activeThemeId === id) this.data.settings.activeThemeId = null;
    this.save();
    return theme;
  }

  // Both of the live theme's sets, for /theme.css to send at once (server/theme-css.js): { light, dark }, a theme
  // with only one set showing it in both modes, and null for Strong Coffee dark (style.css's own palette).
  activeThemeSets() {
    const s = this.data.settings;
    const theme = s.activeThemeId ? s.themes.find((t) => t.id === s.activeThemeId) : null;
    if (!theme) return { light: this.defaultTheme.light, dark: null };
    return { light: theme.light || theme.dark || null, dark: theme.dark || theme.light || null };
  }

  // A person's own light or dark (GitHub #62): 'light' or 'dark', or null to follow the environment's default mode
  // again (the key is then left off the account altogether). Anything else is refused and nothing changes.
  setThemeMode(key, mode) {
    const user = this.userByKey(key);
    if (!user) throw new StoreError('no such user', 404);
    if (mode !== null && mode !== 'light' && mode !== 'dark') throw new StoreError('the mode is light or dark, or null to follow the default');
    if (mode === null) delete user.themeMode;
    else user.themeMode = mode;
    this.save();
    return user.themeMode || null;
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

  addUser({ login, displayName, role, passwordHash, hostAdmin }) {
    const cleaned = cleanLogin(login);
    if (!cleaned) throw new StoreError('username is required');
    if (role !== undefined && !hostAdmin && !ASSIGNABLE_ROLES.includes(role)) throw new StoreError('role must be owner or member');
    if (this.userByLogin(cleaned)) throw new StoreError('that username is taken');
    const user = this.sanitizeUser({
      key: this.newKey(),
      login: cleaned,
      displayName: displayName || cleaned,
      role,
      passwordHash: passwordHash || null,
      hostAdmin,
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
    // The admin's sign-in is the host's (the stand-in) or the server start's (ADMIN_LOGIN and ADMIN_PASSWORD), never
    // an owner's to change: its role, login, password and personal link are refused here.
    if (user.role === 'admin') {
      const serverAdmin = !user.hostAdmin;
      if (patch.role !== undefined && patch.role !== user.role) throw new StoreError(serverAdmin ? "this account is the server's admin, so its role can't be changed here" : "this account is the host admin's, so its role can't be changed here");
      if ((patch.login !== undefined && cleanLogin(patch.login) !== user.login) || patch.passwordHash !== undefined || patch.linkToken) {
        throw new StoreError(serverAdmin ? "this account is the server's admin: it signs in with ADMIN_LOGIN and ADMIN_PASSWORD, so its sign-in can't be changed here" : "this account signs in through the host console, so its sign-in can't be changed here");
      }
    }
    // Checked into a draft, applied at the end: a refused field changes nothing.
    const draft = { ...user };
    if (patch.login !== undefined) {
      const cleaned = cleanLogin(patch.login);
      if (!cleaned) throw new StoreError('username is required');
      const other = this.userByLogin(cleaned);
      if (other && other.key !== key) throw new StoreError('that username is taken');
      draft.login = cleaned;
    }
    if (patch.displayName !== undefined) draft.displayName = cleanText(patch.displayName, 40) || draft.login;
    if (patch.role !== undefined && patch.role !== user.role) {
      if (!ASSIGNABLE_ROLES.includes(patch.role)) throw new StoreError('role must be owner or member');
      draft.role = patch.role;
    }
    if (patch.passwordHash !== undefined) draft.passwordHash = patch.passwordHash || null;
    if (patch.linkToken !== undefined) draft.linkToken = patch.linkToken || null;
    Object.assign(user, draft);
    this.save();
    return user;
  }

  // --- two-step sign-in (documentation/plans/plan-mfa.md) -------------------------------------------------
  // The secret and the recovery codes arrive already encrypted/hashed (server/index.js, server/auth.js) --
  // this class only ever stores and returns exactly what it is given, the same separation passwordHash
  // already keeps.

  // Kept unconfirmed until mfaEnable; another start simply replaces it (server/index.js drops one over an
  // hour old rather than sweeping it here).
  mfaStart(key, secretCipher) {
    const user = this.userByKey(key);
    if (!user) throw new StoreError('no such user', 404);
    user.mfa = user.mfa || { secret: null, enrolledAt: null, recovery: [], version: 0, lastStep: null, pending: null };
    user.mfa.pending = { secret: secretCipher, startedAt: new Date().toISOString() };
    this.save();
    return user.mfa;
  }

  // Confirms the pending secret as the real one and replaces the recovery codes; version always goes up, so
  // re-enrolling (over an existing factor, e.g. a lost device replaced without an admin's help) signs out
  // every session and trusted browser under the old one, the same as a reset does.
  mfaEnable(key, recoveryHashes) {
    const user = this.userByKey(key);
    if (!user) throw new StoreError('no such user', 404);
    if (!user.mfa?.pending) throw new StoreError('start enrolment first');
    user.mfa = { secret: user.mfa.pending.secret, enrolledAt: new Date().toISOString(), recovery: recoveryHashes, version: (user.mfa.version || 0) + 1, lastStep: null, pending: null };
    this.save();
    return user.mfa;
  }

  // Removes the factor entirely -- by the person themselves (a correct code) or an admin's reset. Nulling it
  // out is itself what signs that person out everywhere: userStamp folds in mfa.version, which only exists
  // on a non-null mfa, so the stamp changes the moment this runs (documentation/plans/plan-mfa.md, "Resetting").
  mfaDisable(key) {
    const user = this.userByKey(key);
    if (!user) throw new StoreError('no such user', 404);
    user.mfa = null;
    this.save();
  }

  // The step just used, so it (and anything at or before it) is refused next time -- the one-time part of a
  // one-time code.
  mfaRecordStep(key, step) {
    const user = this.userByKey(key);
    if (!user?.mfa) return;
    user.mfa.lastStep = step;
    this.save();
  }

  // A spent recovery code is gone, and -- since using one means the normal device is unavailable, a
  // security-relevant event in its own right -- version goes up too, signing out every other session and
  // trusted browser this person has, not just resuming this one.
  mfaSpendRecovery(key, hash) {
    const user = this.userByKey(key);
    if (!user?.mfa) return;
    user.mfa.recovery = user.mfa.recovery.filter((h) => h !== hash);
    user.mfa.version = (user.mfa.version || 0) + 1;
    this.save();
  }

  removeUser(key) {
    const user = this.userByKey(key);
    if (!user) throw new StoreError('no such user', 404);
    if (user.role === 'admin' && !user.hostAdmin) throw new StoreError("this account is the server's admin, so it can't be removed here");
    this.data.users = this.data.users.filter((u) => u.key !== key);
    for (const space of this.data.spaces) space.members = space.members.filter((k) => k !== key);
    this.save();
    fs.rmSync(path.join(this.imagesDir, key), { recursive: true, force: true });
    return user;
  }

  // Owners only: the admin is not one.
  ownerCount() {
    return this.data.users.filter((u) => u.role === 'owner').length;
  }

  // The single-environment install's admin, from ADMIN_LOGIN and ADMIN_PASSWORD on every start (buildEnvironment):
  // makes an existing account the admin (an install upgraded by step 4 had made it an owner) and, when given, sets its
  // password hash. The one way an account becomes `admin` other than the host's stand-in.
  setServerAdmin(key, passwordHash) {
    const user = this.userByKey(key);
    if (!user) throw new StoreError('no such user', 404);
    if (user.hostAdmin) throw new StoreError("this account is the host admin's");
    user.role = 'admin';
    if (passwordHash !== undefined) user.passwordHash = passwordHash;
    this.save();
    return user;
  }

  // The server's own admin on a single-environment install: role admin, not the host's stand-in.
  serverAdmins() {
    return this.data.users.filter((u) => u.role === 'admin' && !u.hostAdmin);
  }

  // --- spaces --------------------------------------------------------------
  // The Lobby holds everyone; other spaces hold the members an admin picks.

  get spaces() {
    const everyone = this.data.users.map((u) => u.key);
    return this.data.spaces.map((r) => ({
      ...r,
      members: r.id === LOBBY ? everyone : r.members.filter((k) => everyone.includes(k)),
      isLobby: r.id === LOBBY,
      hasImage: !!this.spaceImagePath(r.id),
    }));
  }

  spaceById(id) {
    return this.spaces.find((r) => r.id === id) || null;
  }

  // The Spaces tab's own order (the Lobby always stays first): reorder to
  // match `order`, a full or partial list of space ids -- anything named
  // that exists moves into that order, anything left out keeps its place
  // relative to the rest, nothing is ever dropped.
  reorderSpaces(order) {
    if (!Array.isArray(order)) throw new StoreError('order must be a list of space ids');
    const rest = this.data.spaces.filter((r) => r.id !== LOBBY);
    const wanted = order.filter((id) => id !== LOBBY && rest.some((r) => r.id === id));
    const byId = new Map(rest.map((r) => [r.id, r]));
    const reordered = [...wanted.map((id) => byId.get(id)), ...rest.filter((r) => !wanted.includes(r.id))];
    const lobby = this.data.spaces.find((r) => r.id === LOBBY);
    this.data.spaces = lobby ? [lobby, ...reordered] : reordered;
    this.save();
    return this.spaces;
  }

  addSpace({ name, description, members, profile, link, linkIcon }) {
    let id;
    do id = randomKey();
    while (this.data.spaces.some((r) => r.id === id));
    const startsWith = profile ?? this.data.settings.spaceDefaults?.profile; // the environment's default (a template's)
    const space = this.sanitizeSpace({ id, name: name || `New ${this.word('space')}`, description, members, profile: startsWith, link, linkIcon, createdAt: new Date().toISOString() });
    space.members = space.members.filter((k) => this.userByKey(k));
    this.data.spaces.push(space);
    this.save();
    return this.spaceById(id);
  }

  // A "pull aside" space for exactly the members given (typically an admin
  // and one player). No name worth keeping server-side; the client builds
  // one from the other member's display name. `origin` is the space they
  // were pulled out of, so they can all be sent back to it later. `priv`
  // marks a real off-the-record word rather than an in-fiction private
  // moment -- see the `private` field's comment in sanitizeSpace.
  addAside(members, origin, priv = false) {
    let id;
    do id = randomKey();
    while (this.data.spaces.some((r) => r.id === id));
    const space = this.sanitizeSpace({ id, name: this.word('aside', { cap: true }), description: '', members, ephemeral: true, origin, private: priv, createdAt: new Date().toISOString() });
    space.members = space.members.filter((k) => this.userByKey(k));
    this.data.spaces.push(space);
    this.save();
    return this.spaceById(id);
  }

  // Sweep aside spaces nobody is actually in any more. `online` is the
  // key -> { space, ... } map this request already built from LiveKit, so
  // this costs nothing extra to call on every /api/presence and /api/status.
  // A space this young is spared even if it looks empty: the members who are
  // meant to be in it were only just told to reconnect there (a disconnect,
  // a fresh token and a new WebRTC connect all take a moment), and the very
  // first poll after creation would otherwise see nobody there yet and
  // delete it before anyone arrives.
  pruneAsides(online) {
    const GRACE_MS = 20000;
    const now = Date.now();
    const before = this.data.spaces.length;
    this.data.spaces = this.data.spaces.filter((r) => {
      if (!r.ephemeral) return true;
      if (now - new Date(r.createdAt).getTime() < GRACE_MS) return true;
      return r.members.some((k) => online.get(k)?.space === r.id);
    });
    if (this.data.spaces.length !== before) this.save();
  }

  updateSpace(id, patch) {
    const space = this.data.spaces.find((r) => r.id === id);
    if (!space) throw new StoreError(`no such ${this.word('space')}`, 404);
    // Checked into a draft, applied at the end: a refused field changes nothing.
    const draft = { ...space };
    if (patch.name !== undefined) draft.name = cleanText(patch.name, 40) || draft.name;
    if (patch.description !== undefined) draft.description = String(patch.description ?? '').trim().slice(0, 300);
    if (patch.members !== undefined && id !== LOBBY) {
      if (!Array.isArray(patch.members)) throw new StoreError('members must be a list of user keys');
      draft.members = [...new Set(patch.members.filter((k) => typeof k === 'string' && this.userByKey(k)))];
    }
    if (patch.aiOff !== undefined) draft.aiOff = patch.aiOff === true; // this space does not use AI, whatever a role may do
    if (patch.profile !== undefined) {
      if (!SPACE_PROFILES.includes(patch.profile)) throw new StoreError('profile must be roleplaying, participants or characters');
      draft.profile = patch.profile;
    }
    if (patch.link !== undefined) {
      if (patch.link) {
        const link = cleanSpaceLink(patch.link);
        if (!link) throw new StoreError('link must be a valid http(s) URL');
        draft.link = link;
      } else {
        draft.link = null;
      }
    }
    if (patch.linkIcon !== undefined) {
      if (!this.iconIds().includes(patch.linkIcon)) throw new StoreError('unknown link icon');
      draft.linkIcon = patch.linkIcon;
    }
    if (patch.allowGuests !== undefined) {
      draft.allowGuests = Boolean(patch.allowGuests);
      if (!draft.allowGuests && draft.guestToken) draft.guestToken = null;
    }
    Object.assign(space, draft);
    this.save();
    return this.spaceById(id);
  }

  removeSpace(id) {
    if (id === LOBBY) throw new StoreError('the Lobby cannot be deleted');
    const space = this.data.spaces.find((r) => r.id === id);
    if (!space) throw new StoreError(`no such ${this.word('space')}`, 404);
    this.data.spaces = this.data.spaces.filter((r) => r.id !== id);
    this.save();
    this.removeSpaceImage(id);
    return space;
  }

  // --- guests -----------------------------------------------------------
  // A space's guest link: reusable until turned off or regenerated, unlike
  // the sign-up invites above. Anyone already in the space can manage it --
  // there's no account behind it to gate on.

  enableGuestLink(id) {
    const space = this.data.spaces.find((r) => r.id === id);
    if (!space) throw new StoreError(`no such ${this.word('space')}`, 404);
    if (!space.allowGuests) throw new StoreError(`this ${this.word('space')} does not allow ${this.word('guest', { many: true })}`, 403);
    if (!space.guestToken) {
      space.guestToken = randomToken(20);
      this.save();
    }
    return space.guestToken;
  }

  regenerateGuestLink(id) {
    const space = this.data.spaces.find((r) => r.id === id);
    if (!space) throw new StoreError(`no such ${this.word('space')}`, 404);
    if (!space.allowGuests) throw new StoreError(`this ${this.word('space')} does not allow ${this.word('guest', { many: true })}`, 403);
    space.guestToken = randomToken(20);
    this.save();
    return space.guestToken;
  }

  disableGuestLink(id) {
    const space = this.data.spaces.find((r) => r.id === id);
    if (!space) throw new StoreError(`no such ${this.word('space')}`, 404);
    if (space.guestToken) {
      space.guestToken = null;
      this.save();
    }
  }

  spaceByGuestToken(token) {
    if (typeof token !== 'string' || !token) return null;
    return this.data.spaces.find((r) => r.guestToken && r.guestToken === token) || null;
  }

  // --- invites --------------------------------------------------------------
  // A link an admin hands out that signs someone up and drops them straight
  // into the spaces picked when it was made (the Lobby always, everyone is
  // there already). Single use, expires on its own after a week.

  sanitizeInvite(i) {
    if (!i || typeof i !== 'object') return null;
    const token = typeof i.token === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(i.token) ? i.token : null;
    if (!token) return null;
    return {
      token,
      spaces: Array.isArray(i.spaces) ? [...new Set(i.spaces.filter((id) => typeof id === 'string'))] : [],
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

  createInvite(spaces) {
    const wanted = (Array.isArray(spaces) ? spaces : []).filter((id) => id !== LOBBY && this.data.spaces.some((r) => r.id === id));
    const invite = this.sanitizeInvite({ token: randomToken(24), spaces: wanted });
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

  spaceImagePath(id) {
    const dir = path.join(this.imagesDir, 'spaces');
    if (!/^[a-z0-9]{4,16}$/.test(id) || !fs.existsSync(dir)) return null;
    const file = fs.readdirSync(dir).find((f) => f.startsWith(`${id}.`));
    return file ? path.join(dir, file) : null;
  }

  setSpaceImage(id, buffer, contentType) {
    if (!this.data.spaces.some((r) => r.id === id)) throw new StoreError(`no such ${this.word('space')}`, 404);
    const ext = IMAGE_TYPES[contentType];
    if (!ext) throw new StoreError('PNG, JPEG, GIF or WebP only');
    if (!buffer || buffer.length === 0) throw new StoreError('empty upload');
    if (buffer.length > MAX_IMAGE_BYTES) throw new StoreError(`image is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB`);
    this.removeSpaceImage(id);
    const dir = path.join(this.imagesDir, 'spaces');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.${ext}`), buffer);
  }

  removeSpaceImage(id) {
    const existing = this.spaceImagePath(id);
    if (existing) fs.rmSync(existing, { force: true });
  }

  // --- images -------------------------------------------------------------
  // A slot's file lives at images/<key>/<file>, or images/<key>/spaces/<spaceId>/<file>
  // for a space-specific override -- a second, independent picture set for
  // the same slot, that only applies inside that one space.

  imageDir(key, spaceId) {
    return spaceId ? path.join(this.imagesDir, key, 'spaces', spaceId) : path.join(this.imagesDir, key);
  }

  spaceEntry(user, spaceId) {
    return (user.spaces[spaceId] ??= { images: {}, useDefaultImages: true, permissions: cleanSpacePermissions() });
  }

  // Whether this space's own pictures (if any) stand in for the account's
  // defaults -- off by default, see "Use Default Profile Images".
  usesSpaceImages(key, spaceId) {
    const entry = this.userByKey(key)?.spaces?.[spaceId];
    return !!entry && entry.useDefaultImages === false;
  }

  // --- roles -------------------------------------------------------------
  // Every permission for a role: owner (and the host admin's stand-in) all on,
  // the others defaults plus whatever an owner changed.
  // Permissions enabled modules add to the Roles grid (see ModuleManager.permissionList);
  // the server sets this once modules are loaded.
  extraPermissions = () => [];

  // Every permission the Roles grid knows: the built-in ones, then the modules'.
  // The built-in labels and groups name levels by {space}-style placeholders, filled with this environment's words.
  allPermissions() {
    const resolved = this.resolvedWords();
    return [...ROLE_PERMISSIONS.map((p) => ({ ...p, label: words.fill(p.label, resolved), group: words.fill(p.group, resolved) })), ...this.extraPermissions()];
  }

  roleSet(role) {
    const set = this.roleSetRaw(role);
    if (this.settings.conferenceEnabled === false) set.conference = false;
    return set;
  }

  roleSetRaw(role) {
    const extras = this.extraPermissions();
    if (OWNER_RIGHTS.includes(role)) return Object.fromEntries([...ROLE_PERMISSIONS, ...extras].map((p) => [p.key, true]));
    const defaultsFor = EDITABLE_ROLES.includes(role) ? role : 'member';
    const base = { ...ROLE_DEFAULTS[defaultsFor], ...Object.fromEntries(extras.map((p) => [p.key, Boolean(p.defaults?.[defaultsFor])])) };
    const set = { ...base };
    for (const [k, v] of Object.entries(this.data.settings.roles?.[role] || {})) if (k in base) set[k] = Boolean(v);
    return set;
  }

  roles() {
    return Object.fromEntries(['owner', ...EDITABLE_ROLES].map((r) => [r, this.roleSetRaw(r)]));
  }

  setRolePermissions(role, patch) {
    if (OWNER_RIGHTS.includes(role)) throw new StoreError(`the ${this.word('owner')} has every permission, so that role can't be changed`);
    if (!EDITABLE_ROLES.includes(role)) throw new StoreError('no such role', 404);
    const mine = (this.data.settings.roles[role] ??= {});
    for (const p of this.allPermissions()) if (patch?.[p.key] !== undefined) mine[p.key] = Boolean(patch[p.key]);
    this.save();
    return this.roles();
  }

  // A module permission renamed by its author (a manifest's `replaces`): each role's own choice for the old key is
  // carried to the new one, unless that role already has a choice for the new key, and the old key is removed. Answers
  // the roles whose choice was carried (empty when there was nothing to carry, so running it again does nothing).
  carryRoleGrant(oldKey, newKey) {
    const carried = [];
    let changed = false;
    for (const [role, set] of Object.entries(this.data.settings.roles || {})) {
      if (!set || typeof set !== 'object' || !Object.prototype.hasOwnProperty.call(set, oldKey)) continue;
      if (!Object.prototype.hasOwnProperty.call(set, newKey)) { set[newKey] = Boolean(set[oldKey]); carried.push(role); }
      delete set[oldKey];
      changed = true;
    }
    if (changed) this.save();
    return carried;
  }

  // What someone can actually do in one space: their role's permissions,
  // plus the whole Moderator role if they're marked Moderator there.
  spacePermissions(key, spaceId) {
    const user = this.userByKey(key);
    if (!user) return this.roleSet('guest');
    if (hasOwnerRights(user)) return this.roleSet('owner');
    const set = this.roleSet(user.role);
    const flags = cleanSpacePermissions(user.spaces?.[spaceId]?.permissions);
    if (flags.moderator) Object.assign(set, Object.fromEntries(Object.entries(this.roleSet('moderator')).filter(([, v]) => v)));
    return set;
  }

  // The stored per-space ticks themselves, for editing (owners read as all on).
  spaceFlags(key, spaceId) {
    const user = this.userByKey(key);
    if (!user) return cleanSpacePermissions();
    if (hasOwnerRights(user)) return Object.fromEntries(SPACE_PERMISSIONS.map((k) => [k, true]));
    return cleanSpacePermissions(user.spaces?.[spaceId]?.permissions);
  }

  setSpacePrefs(key, spaceId, patch) {
    const user = this.userByKey(key);
    if (!user) throw new StoreError('no such user', 404);
    const space = this.spaceById(spaceId);
    if (!space || space.isLobby) throw new StoreError(`no such ${this.word('space')}`, 404);
    if (!space.members.includes(key)) throw new StoreError(`not ${this.word('member', { a: true })} of that ${this.word('space')}`);
    const entry = this.spaceEntry(user, spaceId);
    if (patch.useDefaultImages !== undefined) entry.useDefaultImages = Boolean(patch.useDefaultImages);
    if (patch.permissions && typeof patch.permissions === 'object') {
      for (const k of SPACE_PERMISSIONS) if (patch.permissions[k] !== undefined) entry.permissions[k] = Boolean(patch.permissions[k]);
    }
    this.save();
    return entry;
  }

  removeMember(spaceId, key) {
    const space = this.data.spaces.find((r) => r.id === spaceId);
    if (!space || space.id === LOBBY) throw new StoreError(`no such ${this.word('space')}`, 404);
    if (!space.members.includes(key)) throw new StoreError(`not in that ${this.word('space')}`, 404);
    space.members = space.members.filter((k) => k !== key);
    this.save();
    return this.spaceById(spaceId);
  }

  imageBucket(user, spaceId) {
    if (!spaceId) return user.images;
    return this.spaceEntry(user, spaceId).images;
  }

  imagePath(key, slot, spaceId) {
    const user = this.userByKey(key);
    if (!user) return null;
    const file = spaceId ? user.spaces[spaceId]?.images?.[slot] : user.images[slot];
    if (!file) return null;
    const full = path.join(this.imageDir(key, spaceId), file);
    return fs.existsSync(full) ? full : null;
  }

  // The file to serve for a slot. The profile picture always has a
  // fallback (the initials plate, drawn by the server, not stored here);
  // a Participant slot falls back further, to the server-wide Default
  // Images set below, before finally going transparent; every other slot
  // (Character, background) is simply absent when unset.
  resolveImage(key, slot, spaceId) {
    const full = this.imagePath(key, slot, spaceId);
    return full ? { file: full, slot } : null;
  }

  // The space's own picture if it has one for this slot, else this same
  // user's own picture (no space override), else -- Participant slots only
  // -- the server-wide Default Images picture, else nothing at all. What
  // OBS actually wants to show for a given user in a given space.
  effectiveImage(key, slot, spaceId) {
    const own = (spaceId && this.usesSpaceImages(key, spaceId) && this.resolveImage(key, slot, spaceId)) || this.resolveImage(key, slot);
    if (own) return own;
    if (!PARTICIPANT_SLOTS.includes(slot)) return null;
    const file = this.defaultImagePath(slot);
    return file ? { file, slot } : null;
  }

  setImage(key, slot, buffer, contentType, spaceId) {
    const user = this.userByKey(key);
    if (!user) throw new StoreError('no such user', 404);
    if (!SLOTS.includes(slot)) throw new StoreError('unknown image slot');
    if (spaceId && !this.spaceById(spaceId)) throw new StoreError(`no such ${this.word('space')}`, 404);
    const ext = IMAGE_TYPES[contentType];
    if (!ext) throw new StoreError('PNG, JPEG, GIF or WebP only');
    if (!buffer || buffer.length === 0) throw new StoreError('empty upload');
    if (buffer.length > MAX_IMAGE_BYTES) throw new StoreError(`image is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB`);
    const dir = this.imageDir(key, spaceId);
    fs.mkdirSync(dir, { recursive: true });
    const bucket = this.imageBucket(user, spaceId);
    const previous = bucket[slot];
    const file = `${slot}-${Date.now().toString(36)}.${ext}`;
    fs.writeFileSync(path.join(dir, file), buffer);
    bucket[slot] = file;
    this.save();
    if (previous && previous !== file) fs.rmSync(path.join(dir, previous), { force: true });
    return file;
  }

  removeImage(key, slot, spaceId) {
    const user = this.userByKey(key);
    if (!user) throw new StoreError('no such user', 404);
    const bucket = spaceId ? user.spaces[spaceId]?.images : user.images;
    const previous = bucket?.[slot];
    if (bucket) delete bucket[slot];
    this.save();
    if (previous) fs.rmSync(path.join(this.imageDir(key, spaceId), previous), { force: true });
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
  // their space, if any) have neither set one -- see effectiveImage above.
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
  Store, StoreError, SLOTS, PARTICIPANT_SLOTS, CHARACTER_SLOTS, SPACE_PROFILES, SPACE_PROFILE_SLOTS,
  LEGACY_SLOTS, ROLES, ASSIGNABLE_ROLES, hasOwnerRights, ROLE_PERMISSIONS, IMAGE_TYPES, MAX_IMAGE_BYTES, DEFAULT_BORDER_COLOR, LOBBY, randomToken, cleanText, cleanLogin,
  sanitizeMfa, CURRENCIES, QUALITY_OPTIONS, LANGUAGES, BUILTIN_THEME_IDS: BUILTIN_THEMES.map((t) => t.id), displayNameProblem,
  THEME_BASE, THEME_OPTIONAL, DEFAULT_THEME, cleanColor, cleanAuthor,
  DEFAULT_HOME_ICON,
};
