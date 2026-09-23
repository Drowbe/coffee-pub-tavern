'use strict';

// Coffee Pub Tavern server: accounts, pages, images and LiveKit tokens.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const yauzl = require('yauzl');
const { AsyncLocalStorage } = require('async_hooks');
const { AccessToken, RoomServiceClient, DataPacket_Kind } = require('livekit-server-sdk');
const { ModuleManager, LIMITS: MODULE_LIMITS, compareVersions } = require('./modules');
const { buildModule, bundledModules, zipFiles } = require('./module-build');
const { ModuleLinks } = require('./module-links');
const { Backgrounds } = require('./backgrounds');
const { ModuleBus } = require('./module-bus');
const { ChatHistory } = require('./chat-history');
const { ModuleLimits } = require('./module-limits');
const { ModuleSettings, SettingError } = require('./module-settings');
const { GeocodeCache, askService, keyOf: keyOfPlace, ENOUGH } = require('./geocode');
const { RegionCutJobs, RegionCutError } = require('./region-cut');
const { pmtilesZoomRange } = require('./pmtiles-header');
const { ModuleUploads } = require('./module-uploads');
const { inspectHead } = require('./image-clean');
const { Ai, AiError } = require('./ai');
const { EventEmitter } = require('events');
const { ModuleData } = require('./module-data');
const { ModuleHooks } = require('./module-hooks');
const { Store, StoreError, SLOTS, PARTICIPANT_SLOTS, CHARACTER_SLOTS, ROOM_PROFILES, ROOM_PROFILE_SLOTS, LEGACY_SLOTS, ROLE_PERMISSIONS, IMAGE_TYPES, MAX_IMAGE_BYTES, LOBBY, randomToken, cleanText } = require('./store');
const auth = require('./auth');
const { buildEnvironment, flushEnvironment } = require('./environment');
const { HostRegistry, HostError, cleanSlug } = require('./host-registry');

const {
  PORT = 3000,
  DATA_DIR = path.join(__dirname, '..', 'data'),
  LIVEKIT_HOST = 'localhost:7880',
  LIVEKIT_API_URL = '',
  LIVEKIT_API_KEY = '',
  LIVEKIT_API_SECRET = '',
  TAVERN_ADMIN_USER = 'admin',
  TAVERN_ADMIN_PASSWORD = '',
  TAVERN_ADMIN_KEY = '', // pre-account releases used this; accepted as the admin password
  TAVERN_REVISION = 'dev',
  BASE_DOMAIN = '',
  PREVIOUS_BASE_DOMAINS = '',
  MIGRATE_TENANT_SLUG = '',
  HOST_ADMIN_LOGIN = '',
  HOST_ADMIN_PASSWORD = '',
  PRODUCT_NAME = 'Coffee Pub Tavern', // the product's own name, still being chosen -- configuration, never code
  CONTACT_EMAIL = '',
} = process.env;

const VERSION = `v${require('../package.json').version} (${String(TAVERN_REVISION).slice(0, 7)})`;

if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET are required.');
  process.exit(1);
}

// --- environments (one host, many environments: documentation/plans/plan-tenants.md, phase 1) -----------------
// With no BASE_DOMAIN there is exactly one environment, built straight from DATA_DIR: today's install, unchanged.
// With BASE_DOMAIN set, one environment per tenant (DATA_DIR/tenants/<slug>/), resolved from the request's
// hostname by the resolver middleware below (see "the door"). Either way, request handlers keep reading `store`,
// `modules` and the rest by the names they use today: those names are Proxies that forward to whichever
// environment the current request (or, outside a request, an explicit envContext.run call) resolved.
const envContext = new AsyncLocalStorage();
const environments = new Map(); // slug ('' for the default/no-BASE_DOMAIN environment) -> a built environment
const DEFAULT_SLUG = '';

function currentEnvironment() {
  const env = envContext.getStore();
  if (!env) throw new Error('no environment resolved for this request');
  return env;
}

// A Proxy standing in for one of the current environment's services, by name: every property access resolves
// against envContext's current environment, and a method comes back bound to the real instance (never the
// Proxy), so `store.someMethod()` runs against the right environment's real `store`, whichever one is current.
// Works uniformly for a class instance, a plain Map, or an EventEmitter -- everything under the seam.
function proxyFor(name) {
  const forward = (trap) => (_target, ...args) => trap(currentEnvironment()[name], ...args);
  return new Proxy(Object.create(null), {
    get: forward((real, prop) => {
      const value = Reflect.get(real, prop, real);
      return typeof value === 'function' ? value.bind(real) : value;
    }),
    set: forward((real, prop, value) => Reflect.set(real, prop, value)),
    has: forward((real, prop) => Reflect.has(real, prop)),
    deleteProperty: forward((real, prop) => Reflect.deleteProperty(real, prop)),
    ownKeys: forward((real) => Reflect.ownKeys(real)),
    getOwnPropertyDescriptor: forward((real, prop) => Reflect.getOwnPropertyDescriptor(real, prop)),
  });
}

const store = proxyFor('store');
const modules = proxyFor('modules');
const moduleData = proxyFor('moduleData');
const moduleHooks = proxyFor('moduleHooks');
const chatHistory = proxyFor('chatHistory');
const chatPosts = proxyFor('chatPosts');
const moduleLinks = proxyFor('moduleLinks');
const moduleBus = proxyFor('moduleBus');
const moduleSettings = proxyFor('moduleSettings');
const ai = proxyFor('ai');
const moduleUploads = proxyFor('moduleUploads');
const geocodeCache = proxyFor('geocodeCache');
const regionCutJobs = proxyFor('regionCutJobs');
const moduleLimits = proxyFor('moduleLimits');
const limiter = proxyFor('limiter');
const presence = proxyFor('presence');
const invites = proxyFor('invites');
const inviteEvents = proxyFor('inviteEvents');
const roomIconSvgs = proxyFor('roomIconSvgs');
const moduleActivity = proxyFor('moduleActivity');
function noteActivity(...args) { return currentEnvironment().noteActivity(...args); }

// The registry of environments (DATA_DIR/host.json): which tenants exist, their plans, the host admins. Only
// built when BASE_DOMAIN is set -- a self-hosted install with no base domain never has this file.
const hostRegistry = BASE_DOMAIN ? new HostRegistry(DATA_DIR) : null;
if (hostRegistry) {
  hostRegistry.setBaseDomain(BASE_DOMAIN);
  hostRegistry.setPreviousBaseDomains(PREVIOUS_BASE_DOMAINS);
}

// First start with BASE_DOMAIN set and data at DATA_DIR/tavern.json (a pre-tenant install): refuses to start
// until told which environment that data becomes.
function migrateIfNeeded() {
  if (!BASE_DOMAIN || !fs.existsSync(path.join(DATA_DIR, 'tavern.json'))) return;
  if (!MIGRATE_TENANT_SLUG) {
    console.error(`BASE_DOMAIN is set and ${path.join(DATA_DIR, 'tavern.json')} is a pre-tenant install. Set MIGRATE_TENANT_SLUG=<slug> for one start to move it to that environment, then remove it.`);
    process.exit(1);
  }
  const slug = cleanSlug(MIGRATE_TENANT_SLUG);
  const dest = path.join(DATA_DIR, 'tenants', slug);
  if (fs.existsSync(dest)) throw new Error(`${dest} already exists; migration already ran`);
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(DATA_DIR)) {
    if (['host.json', 'fontawesome-pro', 'tenants', 'tenants-deleted'].includes(entry)) continue;
    fs.renameSync(path.join(DATA_DIR, entry), path.join(dest, entry));
  }
  hostRegistry.addTenant({ slug, name: slug, plan: { modules: 'all' } });
  console.log(`Migrated the existing install to the "${slug}" environment (${dest}).`);
}
migrateIfNeeded();

// Build (or fetch the already-built) environment for a slug, from its own data directory. Only ever called for
// a slug the caller already knows is real (the default, or one host.json names) -- the resolver 404s before this.
function environmentFor(slug) {
  const key = slug || DEFAULT_SLUG;
  let env = environments.get(key);
  if (env) return env;
  const dataDir = slug ? path.join(DATA_DIR, 'tenants', slug) : DATA_DIR;
  env = buildEnvironment(dataDir, {
    slug: slug || null,
    admin: slug ? null : { login: TAVERN_ADMIN_USER, password: TAVERN_ADMIN_PASSWORD || TAVERN_ADMIN_KEY },
  });
  environments.set(key, env);
  return env;
}

if (!BASE_DOMAIN) {
  environmentFor(DEFAULT_SLUG); // the one environment, built eagerly, exactly as today
} else {
  for (const t of hostRegistry.listTenants()) environmentFor(t.slug); // every existing tenant, built at startup
  if (HOST_ADMIN_LOGIN && HOST_ADMIN_PASSWORD && hostRegistry.listAdmins().length === 0) {
    hostRegistry.addAdmin({ login: HOST_ADMIN_LOGIN, passwordHash: auth.hashPassword(HOST_ADMIN_PASSWORD) });
    console.log(`Host admin "${HOST_ADMIN_LOGIN}" created from the environment.`);
  }
}

// Every environment's own writes still owed to disk (chat, AI usage, saved places, the activity log -- each
// debounced, not synchronous like everything else under the seam).
function flushAllEnvironments() {
  for (const env of environments.values()) flushEnvironment(env);
}
process.on('exit', flushAllEnvironments);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));

// --- LiveKit ---------------------------------------------------------------

function livekitWsUrl(req) {
  return `${auth.isSecure(req) ? 'wss' : 'ws'}://${LIVEKIT_HOST}`;
}

function livekitApiUrl() {
  if (LIVEKIT_API_URL) return LIVEKIT_API_URL;
  const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(LIVEKIT_HOST);
  return `${local ? 'http' : 'https'}://${LIVEKIT_HOST}`;
}

const roomService = new RoomServiceClient(livekitApiUrl(), LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

// `media` is whether they may send and receive the conference's audio and video
// (the "See and join the conference" permission); without it they still connect,
// for chat and the modules, and are online, but carry no media. `inCall` is
// whether they start in the conference: everyone else sees a person who is not
// in it as present in the room, with no tile.
async function mintToken({ identity, name, room, publisher, media = publisher, inCall = media }) {
  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity, name, ttl: publisher ? '24h' : '12h' });
  if (publisher) token.attributes = { call: media && inCall ? 'on' : 'off' };
  token.addGrant({
    room,
    roomJoin: true,
    canPublish: media,
    canSubscribe: publisher ? media : true,
    canPublishData: publisher,
    canUpdateOwnMetadata: publisher, // to say whether they are in the conference (the "call" attribute)
    hidden: !publisher, // OBS viewers do not show up at the table
  });
  return token.toJwt();
}

// Each Tavern room is its own LiveKit room: the Lobby keeps the base name
// (so links and the Studio from before rooms still work), the others hang
// their id off it. One LiveKit behind every environment (plan-tenants.md): with BASE_DOMAIN set, the base name
// is prefixed with the environment's own slug, so two environments with the same "room" setting never collide --
// the smallest safe thing ahead of phase 4's own naming. With no BASE_DOMAIN (env.slug is null) this is exactly
// today's name, unchanged.
function livekitBase() {
  const env = currentEnvironment();
  return env.slug ? `${env.slug}-${store.settings.room}` : store.settings.room;
}
function livekitRoomName(roomId) {
  const base = livekitBase();
  return !roomId || roomId === LOBBY ? base : `${base}-${roomId}`;
}

function roomIdOfLivekit(name) {
  const base = livekitBase();
  if (name === base) return LOBBY;
  return name.startsWith(`${base}-`) ? name.slice(base.length + 1) : null;
}

// Who is at the table right now, in whichever room, straight from LiveKit.
async function participants() {
  try {
    const active = await roomService.listRooms();
    const out = [];
    for (const lk of active) {
      const roomId = roomIdOfLivekit(lk.name);
      if (!roomId) continue;
      const list = await roomService.listParticipants(lk.name).catch(() => []);
      for (const p of list) {
        if (p.permission?.hidden) continue;
        const tracks = p.tracks || [];
        const mic = tracks.find((t) => t.source === 2 /* MICROPHONE */);
        const cam = tracks.find((t) => t.source === 1 /* CAMERA */);
        out.push({
          key: p.identity,
          name: p.name,
          room: roomId,
          joinedAt: Number(p.joinedAt || 0),
          inCall: p.attributes?.call !== 'off',
          micOn: !!mic && !mic.muted,
          cameraOn: !!cam && !cam.muted,
        });
      }
    }
    return out;
  } catch (err) {
    return [];
  }
}

// The LiveKit room a user is in right now, or null.
async function roomOf(key) {
  const p = (await participants()).find((x) => x.key === key);
  return p ? livekitRoomName(p.room) : null;
}

// The room the stream currently hears: the first online admin's room, or the
// Lobby if no admin is at the table. With the usual single GM this is
// exactly "wherever the GM is"; with more than one online admin, whichever
// is earliest in the user list wins.
function activeRoomId(online) {
  for (const u of store.users) {
    if (u.role !== 'admin') continue;
    const p = online.get(u.key);
    if (p) return followableRoomId(p.room);
  }
  return LOBBY;
}

// A private aside is off the record entirely -- the stream should keep
// hearing wherever the admin was a moment ago, not cut away to (or hide
// behind) a room Studio is told to treat as not-recording. Walk back to the
// nearest non-private ancestor, normally just the one `origin` hop.
function followableRoomId(roomId) {
  const room = store.roomById(roomId);
  if (room?.private && room.origin) return followableRoomId(room.origin);
  return roomId;
}

// Whether activeRoom actually means anything right now: with no admin
// online there's no "wherever the GM is" to compare against, and view.js's
// aside dim treatment needs to know that rather than reading activeRoom's
// Lobby fallback as a real room everyone else is suddenly "aside" from.
function hasOnlineAdmin(online) {
  return store.users.some((u) => u.role === 'admin' && online.has(u.key));
}

// --- helpers ---------------------------------------------------------------

function baseUrl(req) {
  return `${auth.isSecure(req) ? 'https' : 'http'}://${req.get('x-forwarded-host') || req.get('host')}`;
}

function currentUser(req) {
  if (req._user !== undefined) return req._user;
  req._user = auth.readSession(store.sessionSecret, auth.sessionToken(req), (key) => store.userByKey(key));
  return req._user;
}

// A hint, not a session: on a real sign-in at this environment (never the host admin's own), remembers which
// slugs this browser has used, most recent first, so the product page's own Sign in can offer them back without
// the host ever learning who anyone is (see "Sign in from the product page" in plan-tenants.md). Only set with a
// base domain; never cleared on sign-out, since it names no person, just a short list of addresses.
function setEnvHint(req, res) {
  if (!BASE_DOMAIN) return;
  const env = currentEnvironment();
  if (!env.slug) return;
  const existing = (auth.parseCookies(req.get('cookie')).env_hint || '').split(',').map((s) => s.trim()).filter(Boolean);
  const slugs = [env.slug, ...existing.filter((s) => s !== env.slug)].slice(0, 5);
  res.cookie('env_hint', slugs.join(','), { domain: BASE_DOMAIN, path: '/', sameSite: 'lax', secure: auth.isSecure(req), maxAge: 365 * 86400000, httpOnly: false });
}

function hasStreamKey(req) {
  const given = String(req.query.s || req.get('x-stream-key') || '');
  const wanted = store.streamKey;
  return given.length === wanted.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(wanted));
}

function isAdmin(req) {
  return currentUser(req)?.role === 'admin';
}

// Stream access: an admin session or the stream key (OBS, the Studio app).
function hasStreamAccess(req) {
  return isAdmin(req) || hasStreamKey(req);
}

// A guest's own reads (the table roster, everyone's pictures): any request
// carrying a room's current guest token, on top of a real session or the
// stream key. Not scoped to that one room -- same broad-but-low-stakes
// trust as the stream key above, and lets a guest see the table they're
// actually sitting at without an account to check room membership against.
function hasGuestAccess(req) {
  const token = req.query.guest;
  return typeof token === 'string' && !!store.roomByGuestToken(token);
}

function requireUser(req, res, next) {
  if (!currentUser(req)) return res.status(401).json({ error: 'sign in first' });
  next();
}

function requireAdmin(req, res, next) {
  if (!currentUser(req)) return res.status(401).json({ error: 'sign in first' });
  if (!isAdmin(req)) return res.status(403).json({ error: 'admins only' });
  next();
}

function requireStream(req, res, next) {
  if (!hasStreamAccess(req)) return res.status(403).json({ error: 'stream key required' });
  next();
}

function publicUser(req, u) {
  // Every room this person actually belongs to right now (never the Lobby --
  // per-room images are for the rooms an admin picked them into, not the
  // one everyone is always in), each with which of their own images override
  // the defaults there.
  const rooms = {};
  for (const room of store.rooms) {
    if (room.isLobby || !room.members.includes(u.key)) continue;
    rooms[room.id] = {
      images: Object.fromEntries(SLOTS.map((slot) => [slot, !!u.rooms[room.id]?.images?.[slot]])),
      useDefaultImages: u.rooms[room.id]?.useDefaultImages !== false,
      permissions: store.roomFlags(u.key, room.id), // the stored ticks, for the profile page
      effective: store.roomPermissions(u.key, room.id), // what they can actually do there
    };
  }
  return {
    key: u.key,
    login: u.login,
    displayName: u.displayName,
    role: u.role,
    hasPassword: !!u.passwordHash,
    link: u.linkToken ? `${baseUrl(req)}/j/${u.linkToken}` : null,
    images: Object.fromEntries(SLOTS.map((slot) => [slot, !!u.images[slot]])),
    rooms,
    permissions: store.roomPermissions(u.key, null), // their role's, outside any one room
    player: { ...u.player, effective: store.effectivePlayer(u) },
    callPrefs: u.callPrefs,
    viewUrl: `${baseUrl(req)}/view/${u.key}`,
    createdAt: u.createdAt,
  };
}

// What the table and the view pages need about everyone: name and the
// talking colour, so tiles and frames match.
function tableUser(u) {
  const p = store.effectivePlayer(u);
  return { key: u.key, displayName: u.displayName, isAdmin: u.role === 'admin', border: p.border, borderColor: p.borderColor, borderWidth: p.borderWidth, mutedBorder: p.mutedBorder, mutedColor: p.mutedColor, plate: p.plate, plateLayout: p.plateLayout, plateColor: p.plateColor, plateTextColor: p.plateTextColor, plateFontSize: p.plateFontSize, plateOpacity: p.plateOpacity, plateTextCase: p.plateTextCase, charBorder: p.charBorder, charBorderColor: p.charBorderColor, charMutedBorder: p.charMutedBorder, charMutedColor: p.charMutedColor, charBorderWidth: p.charBorderWidth, pictureBackground: p.pictureBackground, pictureColor: p.pictureColor, pictureScale: p.pictureScale, images: Object.fromEntries(SLOTS.map((slot) => [slot, !!u.images[slot]])) };
}

function branding() {
  const s = store.settings;
  return { serverName: s.serverName, homeIcon: s.homeIcon || 'couch', tableName: s.tableName, room: s.room, loginText: s.loginText, language: s.language || 'en', clock: s.clock === '24' ? '24' : '12', currency: s.currency || 'USD', allowRegistration: Boolean(s.allowRegistration), maxQuality: s.maxQuality || 720, allowScreenShare: s.allowScreenShare !== false, allowAsides: s.allowAsides !== false, allowPrivate: s.allowPrivate !== false, allowReactions: s.allowReactions !== false, conferenceEnabled: s.conferenceEnabled !== false, activeThemeId: s.activeThemeId || null, hasIcon: !!store.iconPath(), hasBackground: !!store.siteImagePath('background'), version: VERSION, border: s.border, borderColor: s.borderColor, borderWidth: s.borderWidth || 6, mutedBorder: s.mutedBorder !== false, mutedColor: s.mutedColor || '#b8503f', plate: Boolean(s.plate), plateLayout: s.plateLayout || 'lower-left', plateColor: s.plateColor || '#000000', plateTextColor: s.plateTextColor || '#f1e6d8', plateFontSize: s.plateFontSize || 16, plateOpacity: s.plateOpacity ?? 60, plateTextCase: s.plateTextCase || 'default', charBorder: Boolean(s.charBorder), charBorderColor: s.charBorderColor || '#6fae6b', charMutedBorder: Boolean(s.charMutedBorder), charMutedColor: s.charMutedColor || '#b8503f', charBorderWidth: s.charBorderWidth || 6, pictureBackground: Boolean(s.pictureBackground), pictureColor: s.pictureColor || '#1a1410', pictureScale: s.pictureScale || 100, offlineDim: s.offlineDim ?? 0, offlineTint: s.offlineTint || '#000000', offlineTintOpacity: s.offlineTintOpacity ?? 0, asideDim: s.asideDim ?? 0, asideTint: s.asideTint || '#000000', asideTintOpacity: s.asideTintOpacity ?? 0, privateDim: s.privateDim ?? 0, privateTint: s.privateTint || '#000000', privateTintOpacity: s.privateTintOpacity ?? 0, reactions: Array.isArray(s.reactions) ? s.reactions : [], icons: Array.isArray(s.icons) ? s.icons : [], guestImages: Object.fromEntries(PARTICIPANT_SLOTS.map((slot) => [slot, !!store.guestImagePath(slot)])), defaultImages: Object.fromEntries(PARTICIPANT_SLOTS.map((slot) => [slot, !!store.defaultImagePath(slot)])) };
}

function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  const text = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] || '?').slice(0, 2);
  return text.toUpperCase();
}

function escapeXml(text) {
  return String(text).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]);
}

function initialsSvg(name) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">` +
    `<rect width="400" height="400" rx="24" fill="#241c16"/>` +
    `<text x="200" y="222" text-anchor="middle" font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="150" font-weight="700" fill="#c8873a">${escapeXml(initials(name))}</text>` +
    `</svg>`;
}

function sendImage(res, file) {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(file);
}

// The generic guest picture, when the admin hasn't set one -- a person
// glyph rather than initials, since a guest tile has no name to draw from
// server-side (that only lives in the LiveKit token, not in our data).
function guestSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">` +
    `<rect width="400" height="400" rx="24" fill="#241c16"/>` +
    `<circle cx="200" cy="155" r="70" fill="#c8873a"/>` +
    `<path d="M60 360c0-90 63-150 140-150s140 60 140 150" fill="#c8873a"/>` +
    `</svg>`;
}

// --- app -------------------------------------------------------------------

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '64kb' }));

const publicDir = path.join(__dirname, '..', 'public');
const clientDist = path.join(__dirname, '..', 'node_modules', 'livekit-client', 'dist');
const page = (name) => path.join(publicDir, name);
const rawZip = express.raw({ type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'], limit: MODULE_LIMITS.zipBytes + 1024 });
const rawImage = express.raw({ type: Object.keys(IMAGE_TYPES), limit: MAX_IMAGE_BYTES + 1024 });

// --- the host console and its API (documentation/plans/plan-tenants.md) ----------------------------------------
// A separate mini-app, reached only at admin.<base>: never mounted on the main app directly, so a request routed
// here can never fall through to a tenant's own routes below (which need an environment resolved, and none is,
// for the host admin -- see requireHostAdmin, its own session, auth.HOST_COOKIE, never a tenant's).
const hostRouter = express.Router();
const hostLimiter = new auth.LoginLimiter();

function currentHostAdmin(req) {
  if (req._hostAdmin !== undefined) return req._hostAdmin;
  req._hostAdmin = hostRegistry ? auth.readSession(hostRegistry.sessionSecret, auth.sessionToken(req, auth.HOST_COOKIE), (key) => hostRegistry.findAdminByKey(key)) : null;
  return req._hostAdmin;
}
function requireHostAdmin(req, res, next) {
  if (!currentHostAdmin(req)) return res.status(401).json({ error: 'sign in first' });
  next();
}
function sendHostError(err, res) {
  if (err instanceof HostError) return res.status(err.status).json({ error: err.message });
  throw err;
}

hostRouter.use(express.static(publicDir, { index: false }));
hostRouter.get('/', (_req, res) => res.sendFile(page('host.html')));

hostRouter.post('/api/host/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (hostLimiter.blocked(ip)) return res.status(429).json({ error: 'too many attempts, try again in a few minutes' });
  const found = hostRegistry.findAdminByLogin(req.body?.login);
  const ok = found && auth.verifyPassword(req.body?.password || '', found.passwordHash);
  if (!ok) { hostLimiter.fail(ip); return res.status(401).json({ error: 'wrong username or password' }); }
  hostLimiter.clear(ip);
  const token = auth.issueSession(hostRegistry.sessionSecret, found);
  auth.setSessionCookie(req, res, token, auth.HOST_COOKIE);
  res.json({ admin: { key: found.key, login: found.login } });
});
hostRouter.post('/api/host/logout', (req, res) => { auth.clearSessionCookie(req, res, auth.HOST_COOKIE); res.json({ ok: true }); });
hostRouter.get('/api/host/me', (req, res) => {
  const found = currentHostAdmin(req);
  if (!found) return res.status(401).json({ error: 'sign in first' });
  res.json({ admin: { key: found.key, login: found.login } });
});

// What a tenant is using, from its own already-built environment (building it if it is not running yet -- an
// admin looking at the list is reason enough to have it up). Storage isn't walked here (a real figure needs
// reading the whole directory); left null until that is worth the cost.
function tenantUsage(slug) {
  const env = environmentFor(slug);
  return { members: env.store.users.length, storageBytes: null, aiCallsThisMonth: env.ai.usageView?.().callsThisMonth ?? null, spaces: env.store.rooms.length };
}
hostRouter.get('/api/host/tenants', requireHostAdmin, (_req, res) => {
  res.json({ tenants: hostRegistry.listTenants().map((t) => ({ ...t, usage: tenantUsage(t.slug) })) });
});
hostRouter.post('/api/host/tenants', requireHostAdmin, (req, res) => {
  try {
    const tenant = hostRegistry.addTenant({ slug: req.body?.slug, name: req.body?.name, plan: req.body?.plan });
    const env = environmentFor(tenant.slug); // the fresh directory and its services, built now
    const owner = req.body?.owner;
    if (owner?.login && owner?.password) env.store.addUser({ login: owner.login, displayName: owner.displayName || owner.login, role: 'admin', passwordHash: auth.hashPassword(owner.password) });
    res.status(201).json({ tenant });
  } catch (err) {
    sendHostError(err, res);
  }
});
hostRouter.patch('/api/host/tenants/:slug', requireHostAdmin, (req, res) => {
  try {
    res.json({ tenant: hostRegistry.updateTenant(req.params.slug, req.body || {}) });
  } catch (err) {
    sendHostError(err, res);
  }
});
hostRouter.delete('/api/host/tenants/:slug', requireHostAdmin, (req, res) => {
  try {
    if (!hostRegistry.findTenant(req.params.slug)) throw new HostError('no such environment', 404);
    hostRegistry.removeTenant(req.params.slug);
    const env = environments.get(req.params.slug);
    if (env) { flushEnvironment(env); environments.delete(req.params.slug); }
    const from = path.join(DATA_DIR, 'tenants', req.params.slug);
    if (fs.existsSync(from)) {
      const to = path.join(DATA_DIR, 'tenants-deleted', `${req.params.slug}-${Date.now()}`);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from, to);
    }
    res.json({ ok: true });
  } catch (err) {
    sendHostError(err, res);
  }
});

// A tenant's whole directory, walked into [name, bytes] pairs for zipFiles (server/module-build.js), or read back
// out of a zip on restore (a general-purpose reader, not modules.js's own readZip -- a tenant's own data is
// whatever shape it is, not the narrow set of file types a module's zip is allowed).
function walkFiles(dir, base = dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walkFiles(full, base, out);
    else if (st.isFile()) out.push([path.relative(base, full).split(path.sep).join('/'), fs.readFileSync(full)]);
  }
  return out;
}
function readTenantZip(buffer) {
  return new Promise((resolve, reject) => {
    const MAX_FILES = 20000;
    const MAX_TOTAL = 500 * 1024 * 1024;
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(new Error("that isn't a readable zip file"));
      const files = [];
      let total = 0;
      const fail = (message) => { zip.close(); reject(new Error(message)); };
      zip.on('error', () => fail("that isn't a readable zip file"));
      zip.on('end', () => resolve(files));
      zip.on('entry', (entry) => {
        const name = entry.fileName;
        if (name.endsWith('/')) return zip.readEntry(); // a folder
        if (files.length >= MAX_FILES) return fail(`too many files (more than ${MAX_FILES})`);
        const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (mode === 0o120000) return fail('symbolic links are not allowed');
        total += entry.uncompressedSize;
        if (total > MAX_TOTAL) return fail(`the backup is larger than ${MAX_TOTAL / (1024 * 1024)} MB`);
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr) return fail("that isn't a readable zip file");
          const chunks = [];
          stream.on('data', (c) => chunks.push(c));
          stream.on('error', () => fail("that isn't a readable zip file"));
          stream.on('end', () => { files.push([name, Buffer.concat(chunks)]); zip.readEntry(); });
        });
      });
      zip.readEntry();
    });
  });
}
hostRouter.post('/api/host/tenants/:slug/backup', requireHostAdmin, (req, res) => {
  if (!hostRegistry.findTenant(req.params.slug)) return res.status(404).json({ error: 'no such environment' });
  const env = environments.get(req.params.slug);
  if (env) flushEnvironment(env); // every debounced write is on disk before it is zipped
  const dir = path.join(DATA_DIR, 'tenants', req.params.slug);
  const zip = zipFiles(fs.existsSync(dir) ? walkFiles(dir) : []);
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${req.params.slug}-backup.zip"` });
  res.send(zip);
});
const rawHostZip = express.raw({ type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'], limit: 500 * 1024 * 1024 });
hostRouter.post('/api/host/tenants/:slug/restore', requireHostAdmin, rawHostZip, async (req, res) => {
  if (!hostRegistry.findTenant(req.params.slug)) return res.status(404).json({ error: 'no such environment' });
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'choose a zip file to restore' });
  try {
    const files = await readTenantZip(req.body);
    const env = environments.get(req.params.slug);
    if (env) { flushEnvironment(env); environments.delete(req.params.slug); } // rebuilt fresh from the restored files, next asked for
    const dir = path.join(DATA_DIR, 'tenants', req.params.slug);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, data] of files) {
      const full = path.join(dir, name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, data);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || "that isn't a readable zip file" });
  }
});

hostRouter.get('/api/host/settings', requireHostAdmin, (_req, res) => {
  res.json({ baseDomain: BASE_DOMAIN, version: VERSION, hostAdmins: hostRegistry.listAdmins(), productName: PRODUCT_NAME, contactEmail: CONTACT_EMAIL || null });
});
hostRouter.post('/api/host/admins', requireHostAdmin, (req, res) => {
  try {
    const password = String(req.body?.password || '');
    if (password.length < 8) throw new HostError('a password needs at least 8 characters');
    res.status(201).json({ admin: hostRegistry.addAdmin({ login: req.body?.login, passwordHash: auth.hashPassword(password) }) });
  } catch (err) {
    sendHostError(err, res);
  }
});
hostRouter.delete('/api/host/admins/:key', requireHostAdmin, (req, res) => {
  try {
    hostRegistry.removeAdmin(req.params.key);
    res.json({ ok: true });
  } catch (err) {
    sendHostError(err, res);
  }
});
// The product itself, for the landing page (the bare base domain) and the console (admin.<base>): public, no
// session needed, and harmless anywhere else it happens to be reached. name and contact are configuration, never
// code, since the product's own name is still being chosen. Registered on hostRouter here (admin.<base> only
// ever reaches it through here anyway); the main app's own copy is registered after the resolver below, not
// here, so an old-base-domain request still 301s instead of this one route quietly bypassing that.
function productInfo(_req, res) {
  res.json({ name: PRODUCT_NAME, contact: CONTACT_EMAIL || null, baseDomain: BASE_DOMAIN || null, version: VERSION });
}
hostRouter.get('/api/product', productInfo);
// One environment's public name, for the product page's own Sign in (a slug is an address already, so confirming
// one exists reveals nothing): { slug, name } for an active or pastDue environment, 404 for anything else --
// unknown, suspended, or a slug that does not even look like one (checked before it ever reaches the registry).
function productEnvironment(req, res) {
  if (!hostRegistry) return res.status(404).json({ error: 'not found' });
  let slug;
  try {
    slug = cleanSlug(req.query.slug);
  } catch {
    return res.status(404).json({ error: 'not found' });
  }
  const tenant = hostRegistry.findTenant(slug);
  if (!tenant || (tenant.status !== 'active' && tenant.status !== 'pastDue')) return res.status(404).json({ error: 'not found' });
  res.json({ slug: tenant.slug, name: tenant.name });
}
hostRouter.get('/api/product/environment', productEnvironment);
// The same, as a list, for the product page's own Sign in dropdown: every active or pastDue environment, sorted
// by name, suspended ones left out entirely (not even a slug -- there is nothing for a visitor to do with one).
function productEnvironments(_req, res) {
  if (!hostRegistry) return res.json({ environments: [] });
  const environments = hostRegistry
    .listTenants()
    .filter((t) => t.status === 'active' || t.status === 'pastDue')
    .map((t) => ({ slug: t.slug, name: t.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json({ environments });
}
hostRouter.get('/api/product/environments', productEnvironments);
hostRouter.use((_req, res) => res.status(404).json({ error: 'not found' }));

// --- the door: resolve an environment for this request, or route to the host console -----------------------
// With no BASE_DOMAIN every request is the one environment (today's behaviour, unchanged). With BASE_DOMAIN set:
// admin.<base> is the console above; <base> alone is a plain "this is the host" page (sign-up is phase 5, not
// this); <slug>.<base> resolves that environment; anything else is a plain 404. A request at an old base domain
// (PREVIOUS_BASE_DOMAINS) is redirected (301) to the same path at the current one, before any of that -- see
// "Previous base domains" in plan-tenants.md. The resolver never reads a path, only the hostname.
if (BASE_DOMAIN) {
  app.use((req, res, next) => {
    const host = (req.hostname || '').toLowerCase();
    const oldBase = hostRegistry.previousBaseDomains().find((d) => host === d || host.endsWith(`.${d}`));
    if (oldBase) {
      const newHost = host === oldBase ? BASE_DOMAIN : `${host.slice(0, host.length - oldBase.length - 1)}.${BASE_DOMAIN}`;
      // req.hostname (host, above) is always port-stripped, for matching against BASE_DOMAIN, which never has one;
      // the redirect target still needs the request's own port carried through, or it silently lands on the
      // scheme's default port instead -- invisible behind a real proxy (the port is implicit there), but wrong for
      // local development, where BASE_DOMAIN is often "localhost" at some other port than 80/443.
      const requestHost = req.get('host') || '';
      const port = requestHost.includes(':') ? requestHost.slice(requestHost.lastIndexOf(':')) : '';
      return res.redirect(301, `${auth.isSecure(req) ? 'https' : 'http'}://${newHost}${newHost.includes(':') ? '' : port}${req.originalUrl}`);
    }
    if (host === `admin.${BASE_DOMAIN}`) return hostRouter(req, res, next);
    // The bare base domain: the product's own landing page (public/landing.html), never any one environment's
    // page -- no store is ever resolved here (see the "no environment" fallback in /theme.css and siteIcon
    // above). Only the handful of paths that page actually needs are let through; anything else is a plain 404,
    // same as an unknown subdomain.
    if (host === BASE_DOMAIN) {
      if (req.path === '/') return res.sendFile(page('landing.html'));
      const BARE_BASE_PATHS = ['/landing.css', '/landing.js', '/style.css', '/theme.css', '/img/site/icon', '/api/product', '/api/product/environment', '/api/product/environments'];
      if (BARE_BASE_PATHS.includes(req.path) || req.path.startsWith('/fa/')) return next();
      return res.status(404).type('text').send('not found');
    }
    if (host.endsWith(`.${BASE_DOMAIN}`)) {
      const slug = host.slice(0, host.length - BASE_DOMAIN.length - 1);
      if (!hostRegistry.findTenant(slug)) return res.status(404).type('text').send('not found');
      return envContext.run(environmentFor(slug), next);
    }
    return res.status(404).type('text').send('not found');
  });
} else {
  app.use((req, res, next) => envContext.run(environmentFor(DEFAULT_SLUG), next));
}
app.get('/api/product', productInfo);
app.get('/api/product/environment', productEnvironment);
app.get('/api/product/environments', productEnvironments);

// Pages ----------------------------------------------------------------------

app.get('/', (req, res) => {
  if (!currentUser(req)) return res.redirect('/login');
  res.sendFile(page('room.html'));
});

// A guest link: the same page, in guest mode (room.js reads the token from
// the URL itself -- see guestToken there). No account, so no redirect to
// sign in; a dead or turned-off link is handled client-side instead.
app.get('/guest/:token', (_req, res) => {
  res.sendFile(page('room.html'));
});

app.get('/login', (req, res) => {
  if (currentUser(req)) return res.redirect(String(req.query.next || '/').startsWith('/') ? String(req.query.next || '/') : '/');
  res.sendFile(page('login.html'));
});

// Self sign-up (only does anything once an admin turns it on in Settings)
// and accepting an invite (always works, whether or not sign-up is open --
// an admin handed it out on purpose) share the same page; register.js tells
// the two apart from the URL.
app.get('/register', (req, res) => {
  if (currentUser(req)) return res.redirect('/');
  res.sendFile(page('register.html'));
});
app.get('/invite/:token', (req, res) => {
  if (currentUser(req)) return res.redirect('/');
  res.sendFile(page('register.html'));
});

// Personal link: signs the user in and drops them at the table.
app.get('/j/:token', (req, res) => {
  const user = store.userByLinkToken(req.params.token);
  if (!user) return res.status(404).sendFile(page('bad-link.html'));
  auth.setSessionCookie(req, res, auth.issueSession(store.sessionSecret, user));
  setEnvHint(req, res);
  res.redirect('/');
});

app.get('/logout', (req, res) => {
  auth.clearSessionCookie(req, res);
  res.redirect('/login');
});

app.get('/profile', (req, res) => {
  if (!currentUser(req)) return res.redirect('/login?next=/profile');
  res.sendFile(page('profile.html'));
});
app.get('/me', (_req, res) => res.redirect('/profile')); // the profile page's old address
app.get('/module-settings', (req, res) => {
  if (!currentUser(req)) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  res.sendFile(page('module-settings.html'));
});

// An admin editing someone else's profile: the same page, in edit mode --
// see public/profile.js, which tells the two apart by the URL.
app.get('/profile/:key', (req, res) => {
  if (!currentUser(req)) return res.redirect(`/login?next=/profile/${encodeURIComponent(req.params.key)}`);
  if (!isAdmin(req)) return res.status(403).send('Admins only.');
  res.sendFile(page('profile.html'));
});

app.get('/admin', (req, res) => {
  if (!currentUser(req)) return res.redirect('/login?next=/admin');
  if (!isAdmin(req)) return res.status(403).send('Admins only.');
  res.sendFile(page('admin.html'));
});

// A room's own page, the same idea as a user's profile page: click it in
// Manage > Rooms and land here instead of editing it inline in the list.
app.get('/rooms/:id', (req, res) => {
  if (!currentUser(req)) return res.redirect(`/login?next=/rooms/${encodeURIComponent(req.params.id)}`);
  if (!isAdmin(req)) return res.status(403).send('Admins only.');
  res.sendFile(page('roomconfig.html'));
});

// OBS view of one user: /view/<key>?s=<stream key>&mode=auto|video|avatar&audio=1&plate=1
app.get('/view/:key', (req, res) => {
  if (!hasStreamAccess(req)) return res.status(403).send('This view needs the stream key (?s=...).');
  if (!store.userByKey(req.params.key)) return res.status(404).send('No such user.');
  res.sendFile(page('view.html'));
});

// Images ---------------------------------------------------------------------

// The server icon: the one set on the Settings tab, else the Coffee Pub
// brandmark. Also mounted at the conventional /favicon.ico path -- pages set
// their own <link rel="icon"> (see brand.js), but plenty of browsers and
// tools still fetch that path directly (bookmarks, tab previews, before any
// page JS has run) and got a bare 404 without this.
function siteIcon(_req, res) {
  // No environment at the bare base domain (the landing page): the bundled default, same as any environment
  // that has not set its own.
  const env = envContext.getStore();
  const file = env && env.store.iconPath();
  if (file) return sendImage(res, file);
  res.set('Cache-Control', 'no-cache').sendFile(path.join(publicDir, 'icon.png'));
}
app.get('/img/site/icon', siteIcon);
app.get('/favicon.ico', siteIcon);
// The sign-in background: nothing until one is set.
app.get('/img/site/background', (_req, res) => {
  const file = store.siteImagePath('background');
  if (file) return sendImage(res, file);
  res.status(404).end();
});

// A room's picture: nothing until one is set.
app.get('/img/room/:id', (req, res) => {
  if (!currentUser(req) && !hasStreamAccess(req)) return res.status(403).end();
  const file = store.roomImagePath(req.params.id);
  if (file) return sendImage(res, file);
  res.status(404).end();
});

// The shared guest picture set (see the guest-link routes): one Participant
// box, standing in for every guest's own images since they have none. The
// room tile asks for 'profile' the same way it does for a real member, so
// that falls back to the Online picture (or the generic glyph) same as it.
app.get('/img/guest/:slot', (req, res) => {
  if (!currentUser(req) && !hasStreamAccess(req) && !hasGuestAccess(req)) return res.status(403).end();
  const wanted = LEGACY_SLOTS[req.params.slot] || req.params.slot;
  const slot = PARTICIPANT_SLOTS.includes(wanted) ? wanted : 'player';
  const file = store.guestImagePath(slot);
  if (file) return sendImage(res, file);
  if (slot !== 'player' || req.query.fallback === 'none') return res.status(404).end();
  res.set('Cache-Control', 'no-cache').type('image/svg+xml').send(guestSvg());
});

// The server-wide Default Images set -- what effectiveImage() falls back
// to for any member who (and whose room, if any) hasn't set their own.
// For previewing the set itself on the Settings page; 404s when unset,
// same as any other optional slot.
app.get('/img/default/:slot', (req, res) => {
  if (!currentUser(req) && !hasStreamAccess(req) && !hasGuestAccess(req)) return res.status(403).end();
  const wanted = LEGACY_SLOTS[req.params.slot] || req.params.slot;
  const slot = PARTICIPANT_SLOTS.includes(wanted) ? wanted : null;
  const file = slot && store.defaultImagePath(slot);
  if (file) return sendImage(res, file);
  res.status(404).end();
});

// A user's image for a slot. The profile photo always renders (an initials
// plate when none is set); every other slot is optional and 404s when unset,
// so overlays and the Participant/Character boxes stay transparent. Signed-in
// users, stream key holders and guests with a valid room link. ?room=<id>
// resolves that room's own picture for this slot if it has one, falling
// back to the default the same as OBS would -- 'profile' never has a room
// override, so the param is ignored for it.
app.get('/img/:key/:slot', (req, res) => {
  if (!currentUser(req) && !hasStreamAccess(req) && !hasGuestAccess(req)) return res.status(403).end();
  const user = store.userByKey(req.params.key);
  if (!user) return res.status(404).end();
  const wanted = LEGACY_SLOTS[req.params.slot] || req.params.slot;
  const slot = SLOTS.includes(wanted) ? wanted : 'profile';
  const roomId = slot !== 'profile' && typeof req.query.room === 'string' ? req.query.room : null;
  if (req.query.roomOnly === '1') {
    // Just this room's own picture -- no fallback to the member's global or default one.
    const own = roomId && store.usesRoomImages(user.key, roomId) && store.resolveImage(user.key, slot, roomId);
    return own ? sendImage(res, own.file) : res.status(404).end();
  }
  const resolved = store.effectiveImage(user.key, slot, roomId);
  if (resolved) return sendImage(res, resolved.file);
  if (slot !== 'profile' || req.query.fallback === 'none') return res.status(404).end();
  res.set('Cache-Control', 'no-cache').type('image/svg+xml').send(initialsSvg(user.displayName));
});

// Web app manifest, so the table installs as a chromeless window
// (Chrome/Edge "Install app", Safari "Add to Dock").
app.get('/manifest.webmanifest', (_req, res) => {
  const s = store.settings;
  const custom = store.iconPath();
  const icons = [];
  if (custom && /\.png$/.test(custom)) icons.push({ src: '/img/site/icon', sizes: 'any', type: 'image/png' });
  icons.push({ src: '/icon.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' });
  res.set('Cache-Control', 'no-cache').type('application/manifest+json').json({
    name: s.serverName,
    short_name: s.serverName.length > 12 ? 'Tavern' : s.serverName,
    description: `${s.serverName}: voice and video for the table`,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#1a1410',
    theme_color: '#1a1410',
    icons,
  });
});

// Static assets, including the LiveKit browser client and Font Awesome
// (the one icon set every page uses) served from node_modules.
app.use('/lib/livekit-client.esm.mjs', express.static(path.join(clientDist, 'livekit-client.esm.mjs')));
const faDir = path.dirname(require.resolve('@fortawesome/fontawesome-free/package.json'));
// An admin's own Font Awesome Pro package, dropped at DATA_DIR/fontawesome-pro/ (the "Web" download from their own Font
// Awesome account: css/, webfonts/ and svgs/, the same shape as the bundled Free set) -- never fetched, never in the image,
// never a token anywhere in this repo, so the shared image every self-hoster pulls stays Free-only and the licence stays
// the admin's own. Present, it is served (and looked up for an icon's SVG) ahead of Free; a style or icon it does not have
// falls back to Free, so nothing breaks if it is partial or absent.
const faProDir = path.join(DATA_DIR, 'fontawesome-pro');
const hasFaPro = fs.existsSync(path.join(faProDir, 'css'));
app.use('/fa/css', express.static(path.join(faProDir, 'css'), { maxAge: '7d' }), express.static(path.join(faDir, 'css'), { maxAge: '7d' }));
app.use('/fa/webfonts', express.static(path.join(faProDir, 'webfonts'), { maxAge: '30d' }), express.static(path.join(faDir, 'webfonts'), { maxAge: '30d' }));

// Background blur's own dependencies, all self-hosted for the same reason
// livekit-client is: nothing this page needs is fetched from a CDN at
// runtime. track-processors imports "livekit-client" and
// "@mediapipe/tasks-vision" by bare package name -- room.html's import map
// points those at the second and third routes below.
const trackProcessorsDist = path.join(__dirname, '..', 'node_modules', '@livekit', 'track-processors', 'dist');
const visionDir = path.join(__dirname, '..', 'node_modules', '@mediapipe', 'tasks-vision');
app.use('/lib/track-processors.mjs', express.static(path.join(trackProcessorsDist, 'index.mjs')));
app.use('/lib/tasks-vision.mjs', express.static(path.join(visionDir, 'vision_bundle.mjs')));
app.use('/lib/mediapipe-wasm', express.static(path.join(visionDir, 'wasm'), { maxAge: '30d' }));

// A server-rendered stylesheet, not a static one: whatever theme colors an
// admin has set (Manage > Settings > Theme), as :root overrides -- linked
// after style.css on every page, so the cascade lets it win without
// touching style.css itself. Nothing set yet means an empty file, so an
// untouched server looks exactly like style.css's own built-in defaults.
// This is also why the popped-out call window (room.js clones every
// <link rel="stylesheet"> into that new window) picks up the theme for
// free -- it's just another stylesheet link, not a runtime JS override
// that would need its own copy into that second document.
app.get('/theme.css', (_req, res) => {
  res.set('Content-Type', 'text/css');
  res.set('Cache-Control', 'no-cache');
  // No environment at the bare base domain (the landing page): no theme there either, same as one that has not set one.
  const env = envContext.getStore();
  const theme = env && env.store.activeTheme();
  if (!theme) return res.send('');
  const vars = [
    ['--bg', theme.bg],
    ['--bg-section', theme.bgSection],
    ['--border', theme.border],
    ['--text', theme.text],
    ['--text-dim', theme.textDim],
    ['--accent', theme.accent],
    ['--on-accent', theme.onAccent],
    // Optional ones: only when the theme sets them; otherwise style.css derives them.
    ['--bg-card', theme.card],
    ['--header-bg', theme.headerBg],
    ['--header-text', theme.headerText],
    ['--icon', theme.icon],
    ['--icon-hover', theme.iconHover],
    ['--primary-hover', theme.primaryHover],
    ['--secondary', theme.secondary],
    ['--secondary-text', theme.secondaryText],
    ['--secondary-hover', theme.secondaryHover],
  ].filter(([, value]) => value);
  res.send(`:root {\n${vars.map(([name, value]) => `  ${name}: ${value};`).join('\n')}\n}\n`);
});

app.use(express.static(publicDir, { index: false }));

// Public API ------------------------------------------------------------------

app.get('/api/branding', (_req, res) => res.json(branding()));

app.get('/api/config', (req, res) => res.json({ livekitUrl: livekitWsUrl(req), ...branding() }));

app.post('/api/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (limiter.blocked(ip)) return res.status(429).json({ error: 'too many attempts, try again in a few minutes' });
  const user = store.userByLogin(req.body?.login);
  const ok = user && user.passwordHash && auth.verifyPassword(req.body?.password || '', user.passwordHash);
  if (!ok) {
    limiter.fail(ip);
    return res.status(401).json({ error: 'wrong username or password' });
  }
  limiter.clear(ip);
  const token = auth.issueSession(store.sessionSecret, user);
  auth.setSessionCookie(req, res, token);
  setEnvHint(req, res);
  res.json({ user: publicUser(req, user), token });
});

// Self sign-up: only works while an admin has it turned on. A self-signed
// account is a normal user, in the Lobby like everyone (that's automatic,
// not something to grant).
app.post('/api/register', (req, res) => {
  if (!store.settings.allowRegistration) return res.status(403).json({ error: 'sign-up is turned off' });
  const { login, displayName, password } = req.body || {};
  if (!password) throw new StoreError('a password is required');
  const user = store.addUser({ login, displayName, role: 'user', passwordHash: auth.hashPassword(password) });
  const token = auth.issueSession(store.sessionSecret, user);
  auth.setSessionCookie(req, res, token);
  setEnvHint(req, res);
  res.status(201).json({ user: publicUser(req, user) });
});

// An admin-made invite: signs someone up straight into the rooms it was
// made with. Works even while general sign-up is off -- an admin handed
// this out on purpose.
app.post('/api/invites', requireAdmin, (req, res) => {
  const invite = store.createInvite((req.body || {}).rooms);
  res.status(201).json({ invite: { ...invite, url: `${baseUrl(req)}/invite/${invite.token}` } });
});
app.get('/api/invites/:token', (req, res) => {
  const invite = store.inviteByToken(req.params.token);
  if (!invite) return res.status(404).json({ error: 'this invite is gone or has expired' });
  res.json({ invite: { rooms: invite.rooms.map((id) => store.roomById(id)).filter(Boolean).map((r) => r.name), expiresAt: invite.expiresAt } });
});
app.post('/api/invites/:token/accept', (req, res) => {
  const invite = store.inviteByToken(req.params.token);
  if (!invite) return res.status(404).json({ error: 'this invite is gone or has expired' });
  const { login, displayName, password } = req.body || {};
  if (!password) throw new StoreError('a password is required');
  const user = store.addUser({ login, displayName, role: 'user', passwordHash: auth.hashPassword(password) });
  for (const roomId of invite.rooms) {
    const room = store.roomById(roomId);
    if (room) store.updateRoom(roomId, { members: [...room.members, user.key] });
  }
  store.removeInvite(invite.token);
  const token = auth.issueSession(store.sessionSecret, user);
  auth.setSessionCookie(req, res, token);
  setEnvHint(req, res);
  res.status(201).json({ user: publicUser(req, user) });
});

app.post('/api/logout', (req, res) => {
  auth.clearSessionCookie(req, res);
  res.json({ ok: true });
});

app.get('/api/me', requireUser, (req, res) => {
  const user = currentUser(req);
  res.json({
    user: publicUser(req, user),
    ...branding(),
    livekitUrl: livekitWsUrl(req),
    streamKey: user.role === 'admin' ? store.streamKey : undefined,
  });
});

// LiveKit token for a room (the Lobby unless asked): players need a session
// and must belong to the room; OBS viewers need the stream key.
app.post('/api/token', async (req, res) => {
  const roomId = typeof req.body?.room === 'string' && req.body.room ? req.body.room : LOBBY;
  const tavernRoom = store.roomById(roomId);
  if (!tavernRoom) return res.status(404).json({ error: 'no such room' });
  const room = livekitRoomName(roomId);
  if (req.body?.role === 'viewer') {
    if (!hasStreamAccess(req)) return res.status(403).json({ error: 'stream key required' });
    const identity = `obs-${Date.now().toString(36)}-${randomToken(4)}`;
    return res.json({ token: await mintToken({ identity, name: 'OBS', room, publisher: false }), livekitUrl: livekitWsUrl(req), identity, room, roomId });
  }
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'sign in first' });
  if (!tavernRoom.members.includes(user.key) && !isAdmin(req)) return res.status(403).json({ error: 'you are not in that room' });
  const media = Boolean(store.roomPermissions(user.key, roomId).conference);
  const token = await mintToken({ identity: user.key, name: user.displayName, room, publisher: true, media, inCall: req.body?.call !== false });
  res.json({ token, livekitUrl: livekitWsUrl(req), identity: user.key, room, roomId, conference: media });
});

// Guests: no account, just a name and a room's guest link (see the
// guest-link routes above). Public -- there's nothing to sign in with.
app.get('/api/guest-link/:token', (req, res) => {
  const tavernRoom = store.roomByGuestToken(req.params.token);
  if (!tavernRoom) return res.status(404).json({ error: 'that guest link is off or wrong' });
  res.json({ roomId: tavernRoom.id, roomName: tavernRoom.name });
});
app.post('/api/guest-join', async (req, res) => {
  const tavernRoom = store.roomByGuestToken(req.body?.token);
  if (!tavernRoom) return res.status(404).json({ error: 'that guest link is off or wrong' });
  const name = cleanText(req.body?.name, 40);
  if (!name) return res.status(400).json({ error: 'a name is required' });
  const identity = `guest-${randomToken(8)}`;
  const room = livekitRoomName(tavernRoom.id);
  const permissions = store.roleSet('guest');
  const token = await mintToken({ identity, name, room, publisher: true, media: Boolean(permissions.conference), inCall: req.body?.call !== false });
  res.json({ token, livekitUrl: livekitWsUrl(req), identity, room, roomId: tavernRoom.id, roomName: tavernRoom.name, guestToken: req.body.token, permissions });
});

// A user may replace or clear their own profile photo. This is separate from
// the Player box's Online picture, which only an admin sets (it may be part
// of a matched set of OBS images).
// Any image slot is self-service once the user's role has its "Images"
// permission (Manage > Roles): by default the profile photo and the call
// background (a still behind their own camera, an alternative to blur).
function requireImageRight(req, res, next) {
  const slot = LEGACY_SLOTS[req.params.slot] || req.params.slot;
  if (!SLOTS.includes(slot)) return res.status(400).json({ error: 'unknown image slot' });
  const user = currentUser(req);
  if (!store.roleSet(user.role)[`image_${slot}`]) return res.status(403).json({ error: 'your role can\'t change that image' });
  req.imageSlot = slot;
  next();
}
app.put('/api/me/images/:slot', requireUser, requireImageRight, rawImage, (req, res) => {
  store.setImage(currentUser(req).key, req.imageSlot, req.body, req.get('content-type'));
  res.json({ ok: true });
});
app.delete('/api/me/images/:slot', requireUser, requireImageRight, (req, res) => {
  store.removeImage(currentUser(req).key, req.imageSlot);
  res.json({ ok: true });
});
// The same for a room's own pictures, and the switch that turns them on.
function requireOwnRoom(req, res, next) {
  const room = store.roomById(req.params.roomId);
  if (!room || !room.members.includes(currentUser(req).key)) return res.status(403).json({ error: 'not a member of that room' });
  next();
}
app.put('/api/me/rooms/:roomId/images/:slot', requireUser, requireOwnRoom, requireImageRight, rawImage, (req, res) => {
  const user = currentUser(req);
  store.setImage(user.key, req.imageSlot, req.body, req.get('content-type'), req.params.roomId);
  res.json({ user: publicUser(req, store.userByKey(user.key)) });
});
app.delete('/api/me/rooms/:roomId/images/:slot', requireUser, requireOwnRoom, requireImageRight, (req, res) => {
  const user = currentUser(req);
  store.removeImage(user.key, req.imageSlot, req.params.roomId);
  res.json({ user: publicUser(req, store.userByKey(user.key)) });
});
app.patch('/api/me/rooms/:roomId', requireUser, requireOwnRoom, (req, res) => {
  const user = currentUser(req);
  const set = store.roleSet(user.role);
  if (!Object.entries(set).some(([k, v]) => v && k.startsWith('image_') && k !== 'image_profile' && k !== 'image_background')) {
    return res.status(403).json({ error: 'your role can\'t change room images' });
  }
  store.setRoomPrefs(user.key, req.params.roomId, { useDefaultImages: req.body?.useDefaultImages });
  res.json({ user: publicUser(req, store.userByKey(user.key)) });
});

// A user's own mic/camera processing settings (gain, noise suppression,
// echo cancellation, auto gain, push to talk, quality, mirror, background
// mode, master volume) -- not which physical device to use, that stays
// local to the browser. Self-service, and admin can set it for someone
// else from their profile page the same way images work.
app.patch('/api/me/call-prefs', requireUser, (req, res) => {
  res.json({ callPrefs: store.setCallPrefs(currentUser(req).key, req.body || {}) });
});
app.patch('/api/users/:key/call-prefs', requireAdmin, (req, res) => {
  res.json({ callPrefs: store.setCallPrefs(req.params.key, req.body || {}) });
});

// Everyone at the table: names, talking colours and Player options for the
// tiles and view pages, who is at the table right now and in which room,
// and the rooms themselves (with the ones the caller may join marked).
// Who is on the site right now, in a room or not: a page tells the server it is open every half minute
// (POST /api/presence), and a person counts as present for a little longer than that. Held in memory, so it
// starts empty when the server does and fills within half a minute.
const PRESENT_MS = 75 * 1000;
const isPresent = (key) => Date.now() - (presence.get(key) || 0) < PRESENT_MS;
app.post('/api/presence', requireUser, (req, res) => {
  presence.set(currentUser(req).key, Date.now());
  res.json({ ok: true });
});

// An invitation to a conversation of two: a private room (off the record, like an aside) for the inviter and the
// person invited, who is told wherever they have Tavern open (the notification stream) and can join or decline.
// It lives a couple of minutes; the room is swept away when nobody is in it, as any aside is.
const INVITE_MS = 2 * 60 * 1000;
app.post('/api/table/invite', requireUser, (req, res) => {
  const me = currentUser(req);
  const to = store.userByKey(String(req.body?.to || ''));
  if (!to || to.key === me.key) return res.status(400).json({ error: 'pick someone else to invite' });
  if (store.settings.allowPrivate === false) return res.status(403).json({ error: 'private conversations are turned off' });
  if (!store.roomPermissions(me.key, null).privateCall) return res.status(403).json({ error: "you can't start a private conversation" });
  if (!isPresent(to.key)) return res.status(409).json({ error: `${to.displayName} is not online right now` });
  const room = store.addAsideRoom([me.key, to.key], null, true);
  const invite = { id: randomToken(), from: me.key, to: to.key, roomId: room.id, at: Date.now() };
  invites.set(invite.id, invite);
  for (const [id, i] of invites) if (Date.now() - i.at > INVITE_MS) invites.delete(id);
  inviteEvents.emit('invite', { ...invite, fromName: me.displayName });
  res.json({ room, invite: { id: invite.id } });
});
// Declining just ends the invitation; the inviter is not told anything unfriendly, the room simply stays empty.
app.post('/api/table/invite/:id/decline', requireUser, (req, res) => {
  const invite = invites.get(req.params.id);
  if (invite && invite.to === currentUser(req).key) invites.delete(invite.id);
  res.json({ ok: true });
});

app.get('/api/table', async (req, res) => {
  const user = currentUser(req);
  if (!user && !hasStreamAccess(req) && !hasGuestAccess(req)) return res.status(401).json({ error: 'sign in first' });
  const online = await participants();
  const byKey = new Map(online.map((p) => [p.key, p]));
  store.pruneAsideRooms(byKey);
  res.json({
    ...branding(),
    users: store.users.map((u) => ({ ...tableUser(u), online: byKey.has(u.key), present: byKey.has(u.key) || isPresent(u.key), room: byKey.get(u.key)?.room || null, inCall: byKey.get(u.key)?.inCall ?? false })),
    rooms: store.rooms.map((r) => ({ ...r, mine: !user || r.members.includes(user.key) || user.role === 'admin' })),
    activeRoom: activeRoomId(byKey),
    adminOnline: hasOnlineAdmin(byKey),
  });
});

// An admin pulls one or more people who are currently in their room into a
// new room with them, for a word away from the rest of the table. LiveKit
// here is a single, un-clustered node, so there is no server-side "move a
// live participant" primitive to lean on: the admin's own browser gets the
// new room directly in this response and reconnects itself; everyone else
// pulled gets a data-channel nudge (the same mechanism chat already uses)
// telling their page which room to reconnect to.
// An ordinary aside is a GM move -- pulling someone into an in-fiction
// private moment, admin only. A Private Conversation is a real off-the-
// record word, which any two (or more) people at the table should be able
// to step into together without needing the admin to broker it -- so this
// route allows any signed-in user, but still requires admin for anything
// that isn't private.
app.post('/api/table/pull-aside', requireUser, async (req, res) => {
  try {
    const initiator = currentUser(req);
    const priv = Boolean(req.body?.private);
    if (priv && store.settings.allowPrivate === false) return res.status(403).json({ error: 'private conversations are turned off' });
    if (!priv && store.settings.allowAsides === false) return res.status(403).json({ error: 'asides are turned off' });
    const raw = req.body?.with;
    const keys = [...new Set(Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [])];
    const targets = keys.filter((k) => k !== initiator.key).map((k) => store.userByKey(k)).filter(Boolean);
    if (!targets.length) return res.status(400).json({ error: 'pick someone to pull aside' });
    const initiatorRoom = await roomOf(initiator.key);
    if (!initiatorRoom) return res.status(400).json({ error: 'you need to be at the table yourself to pull someone aside' });
    const perms = store.roomPermissions(initiator.key, roomIdOfLivekit(initiatorRoom));
    if (priv ? !perms.privateCall : !perms.startAside) return res.status(403).json({ error: priv ? 'you can\'t start a private conversation' : 'you can\'t pull someone into an aside' });
    const here = new Map((await participants()).map((p) => [p.key, p]));
    for (const target of targets) {
      const there = here.get(target.key);
      if (!there || livekitRoomName(there.room) !== initiatorRoom) return res.status(404).json({ error: `${target.displayName} is not with you right now` });
      if (!there.inCall) return res.status(409).json({ error: `${target.displayName} is not in the conference right now` });
    }
    const room = store.addAsideRoom([initiator.key, ...targets.map((t) => t.key)], roomIdOfLivekit(initiatorRoom), priv);
    // byAdmin tells the target's client whether to just go (an admin's
    // call) or ask first -- see the 'pull-aside' handler in room.js.
    const payload = new TextEncoder().encode(
      JSON.stringify({ type: 'pull-aside', roomId: room.id, byAdmin: initiator.role === 'admin', private: priv, from: initiator.displayName })
    );
    await roomService.sendData(initiatorRoom, payload, DataPacket_Kind.RELIABLE, { destinationIdentities: targets.map((t) => t.key), topic: 'pull-aside' });
    // Everyone left behind: a private word is private from the table, not
    // invisible to it -- this is what lets their tiles turn into "in an
    // aside" placeholders right away instead of just looking like they hung
    // up until the next poll catches up.
    const bystanderPayload = new TextEncoder().encode(JSON.stringify({ type: 'aside-started', roomId: room.id, members: room.members }));
    await roomService.sendData(initiatorRoom, bystanderPayload, DataPacket_Kind.RELIABLE, { topic: 'aside-started' }).catch(() => {});
    res.json({ room });
  } catch (err) {
    res.status(502).json({ error: `LiveKit: ${err.message}` });
  }
});

// Admin-only recall: every Private Conversation pulled out of the admin's
// own current room gets a data-channel warning -- their own page runs a
// 10-second countdown, then reconnects them back here itself (see the
// 'recall' topic in room.js), rather than being yanked back instantly.
// Doesn't touch ordinary asides: the admin is always already in those, so
// there's nothing to recall them from that "Back to the table" doesn't
// already cover.
app.post('/api/table/recall', requireAdmin, async (req, res) => {
  try {
    const admin = currentUser(req);
    const adminRoom = await roomOf(admin.key);
    if (!adminRoom) return res.status(400).json({ error: 'you need to be at the table yourself to recall anyone' });
    const originId = roomIdOfLivekit(adminRoom);
    const destRoom = store.roomById(originId);
    const privateRooms = store.rooms.filter((r) => r.ephemeral && r.private && r.origin === originId);
    if (!privateRooms.length) return res.status(400).json({ error: 'nobody is off in a private conversation from here right now' });
    const payload = new TextEncoder().encode(JSON.stringify({ type: 'recall', roomId: originId, roomName: destRoom?.name || 'the table' }));
    await Promise.all(privateRooms.map((r) => roomService.sendData(livekitRoomName(r.id), payload, DataPacket_Kind.RELIABLE, { topic: 'recall' }).catch(() => {})));
    res.json({ recalled: privateRooms.length });
  } catch (err) {
    res.status(502).json({ error: `LiveKit: ${err.message}` });
  }
});

// Whoever clicks "Back to the table" while in a pull-aside room returns to
// the room it was pulled from (the Lobby if that room is gone by now), and
// takes the room's other member(s) with them the same way pull-aside does:
// a data-channel nudge, since leaving would otherwise be as one-sided as
// arriving used to be.
app.post('/api/table/return', requireUser, async (req, res) => {
  try {
    const me = currentUser(req);
    const mine = (await participants()).find((p) => p.key === me.key);
    if (!mine) return res.status(400).json({ error: 'you need to be at the table' });
    const current = store.roomById(mine.room);
    if (!current || !current.ephemeral) return res.status(400).json({ error: 'not in a pull-aside room' });
    const dest = (current.origin && store.roomById(current.origin)) || store.roomById(LOBBY);
    const others = current.members.filter((k) => k !== me.key);
    if (others.length) {
      const payload = new TextEncoder().encode(JSON.stringify({ type: 'return-to-table', roomId: dest.id }));
      // Best-effort: I still get to leave even if the others cannot be nudged.
      await roomService
        .sendData(livekitRoomName(mine.room), payload, DataPacket_Kind.RELIABLE, { destinationIdentities: others, topic: 'return-to-table' })
        .catch(() => {});
    }
    res.json({ room: dest });
  } catch (err) {
    res.status(502).json({ error: `LiveKit: ${err.message}` });
  }
});

// Stream API (OBS pages and the Studio app) ---------------------------------

app.get('/api/status', requireStream, async (req, res) => {
  const online = await participants();
  const byKey = new Map(online.map((p) => [p.key, p]));
  store.pruneAsideRooms(byKey);
  res.json({
    ...branding(),
    users: store.users.map((u) => ({ ...publicUser(req, u), online: byKey.get(u.key) || null })),
    table: store.users.map(tableUser),
    rooms: store.rooms,
    activeRoom: activeRoomId(byKey),
    adminOnline: hasOnlineAdmin(byKey),
  });
});

// Rooms: the Lobby (everyone) plus the rooms an admin curates. Signed-in
// users and stream key holders can read them; admins change them.
app.get('/api/rooms', (req, res) => {
  if (!currentUser(req) && !hasStreamAccess(req)) return res.status(401).json({ error: 'sign in first' });
  res.json({ rooms: store.rooms });
});
app.post('/api/rooms', requireAdmin, (req, res) => {
  const { name, description, members, profile, link, linkIcon } = req.body || {};
  res.json({ room: store.addRoom({ name, description, members, profile, link, linkIcon }) });
});
app.post('/api/rooms/order', requireAdmin, (req, res) => {
  res.json({ rooms: store.reorderRooms((req.body || {}).order) });
});
app.get('/api/rooms/:id', requireAdmin, (req, res) => {
  const room = store.roomById(req.params.id);
  if (!room) return res.status(404).json({ error: 'no such room' });
  res.json({ room });
});
app.patch('/api/rooms/:id', requireAdmin, (req, res) => {
  res.json({ room: store.updateRoom(req.params.id, req.body || {}) });
});
app.delete('/api/rooms/:id', requireAdmin, (req, res) => {
  store.removeRoom(req.params.id);
  moduleSettings.forgetRoom(req.params.id);
  chatHistory.forgetRoom(req.params.id);
  res.json({ ok: true });
});
app.put('/api/rooms/:id/image', requireAdmin, rawImage, (req, res) => {
  store.setRoomImage(req.params.id, req.body, req.get('content-type'));
  res.json({ room: store.roomById(req.params.id) });
});
app.delete('/api/rooms/:id/image', requireAdmin, (req, res) => {
  store.removeRoomImage(req.params.id);
  res.json({ room: store.roomById(req.params.id) });
});

// A room's guest link: anyone actually in the room can turn it on, copy it,
// regenerate it or turn it off -- there's no account behind a guest to gate
// this on, unlike everything else admin-only above. create/regenerate
// (POST) mirror the personal-link routes above; DELETE turns it off.
function requireRoomMember(req, res, next) {
  const room = store.roomById(req.params.id);
  if (!room) return res.status(404).json({ error: 'no such room' });
  if (!room.members.includes(currentUser(req).key) && !isAdmin(req)) return res.status(403).json({ error: 'you are not in that room' });
  next();
}
// Managing the link needs Can Invite for that room (admins always can) --
// being in the room alone no longer is enough.
function requireCanInvite(req, res, next) {
  if (!store.roomPermissions(currentUser(req).key, req.params.id).canInvite) return res.status(403).json({ error: 'you can\'t invite people to this room' });
  next();
}
app.post('/api/rooms/:id/guest-link', requireUser, requireRoomMember, requireCanInvite, (req, res) => {
  const guestToken = req.body?.regenerate ? store.regenerateGuestLink(req.params.id) : store.enableGuestLink(req.params.id);
  res.json({ room: store.roomById(req.params.id), guestUrl: `${baseUrl(req)}/guest/${guestToken}` });
});
app.delete('/api/rooms/:id/guest-link', requireUser, requireRoomMember, requireCanInvite, (req, res) => {
  store.disableGuestLink(req.params.id);
  res.json({ room: store.roomById(req.params.id) });
});

// Admin API -------------------------------------------------------------------

app.get('/api/users', requireAdmin, (req, res) => {
  res.json({ users: store.users.map((u) => publicUser(req, u)) });
});

app.get('/api/users/:key', requireAdmin, (req, res) => {
  const user = store.userByKey(req.params.key);
  if (!user) return res.status(404).json({ error: 'no such user' });
  res.json({ user: publicUser(req, user) });
});

app.post('/api/users', requireAdmin, (req, res) => {
  const { login, displayName, role, password, passwordless } = req.body || {};
  const user = store.addUser({ login, displayName, role, passwordHash: password ? auth.hashPassword(password) : null });
  if (passwordless) store.updateUser(user.key, { linkToken: randomToken() });
  res.status(201).json({ user: publicUser(req, store.userByKey(user.key)) });
});

app.patch('/api/users/:key', requireAdmin, (req, res) => {
  const { login, displayName, role, password, player } = req.body || {};
  const patch = {};
  if (login !== undefined) patch.login = login;
  if (displayName !== undefined) patch.displayName = displayName;
  if (role !== undefined) patch.role = role;
  if (password !== undefined) patch.passwordHash = password ? auth.hashPassword(password) : null;
  if (player !== undefined) patch.player = player;
  const self = currentUser(req);
  if (self.key === req.params.key && role !== undefined && role !== 'admin') {
    return res.status(400).json({ error: 'you cannot demote yourself' });
  }
  const user = store.updateUser(req.params.key, patch);
  res.json({ user: publicUser(req, user) });
});

app.delete('/api/users/:key', requireAdmin, (req, res) => {
  if (currentUser(req).key === req.params.key) return res.status(400).json({ error: 'you cannot delete yourself' });
  store.removeUser(req.params.key);
  res.json({ ok: true });
});

// Personal link: create or regenerate (POST), turn off (DELETE).
app.post('/api/users/:key/link', requireAdmin, (req, res) => {
  const user = store.updateUser(req.params.key, { linkToken: randomToken() });
  res.json({ user: publicUser(req, user) });
});
app.delete('/api/users/:key/link', requireAdmin, (req, res) => {
  const user = store.updateUser(req.params.key, { linkToken: null });
  res.json({ user: publicUser(req, user) });
});

app.put('/api/users/:key/images/:slot', requireAdmin, rawImage, (req, res) => {
  store.setImage(req.params.key, LEGACY_SLOTS[req.params.slot] || req.params.slot, req.body, req.get('content-type'));
  res.json({ user: publicUser(req, store.userByKey(req.params.key)) });
});
app.delete('/api/users/:key/images/:slot', requireAdmin, (req, res) => {
  const slot = LEGACY_SLOTS[req.params.slot] || req.params.slot;
  if (!SLOTS.includes(slot)) return res.status(400).json({ error: 'unknown image slot' });
  store.removeImage(req.params.key, slot);
  res.json({ user: publicUser(req, store.userByKey(req.params.key)) });
});

// A room-specific override for one of that same person's image slots --
// stands in for their default only inside that one room (someone in two
// campaigns with two different characters). Admin-only, same as the
// defaults themselves.
// Per-room settings for one member: which pictures apply there, and what
// they're allowed to do (Permissions on their profile's Rooms tab).
app.patch('/api/users/:key/rooms/:roomId', requireAdmin, (req, res) => {
  store.setRoomPrefs(req.params.key, req.params.roomId, req.body || {});
  res.json({ user: publicUser(req, store.userByKey(req.params.key)) });
});
app.delete('/api/rooms/:id/members/:key', requireAdmin, (req, res) => {
  store.removeMember(req.params.id, req.params.key);
  res.json({ user: publicUser(req, store.userByKey(req.params.key)) });
});
app.put('/api/users/:key/rooms/:roomId/images/:slot', requireAdmin, rawImage, (req, res) => {
  store.setImage(req.params.key, LEGACY_SLOTS[req.params.slot] || req.params.slot, req.body, req.get('content-type'), req.params.roomId);
  res.json({ user: publicUser(req, store.userByKey(req.params.key)) });
});
app.delete('/api/users/:key/rooms/:roomId/images/:slot', requireAdmin, (req, res) => {
  const slot = LEGACY_SLOTS[req.params.slot] || req.params.slot;
  if (!SLOTS.includes(slot)) return res.status(400).json({ error: 'unknown image slot' });
  store.removeImage(req.params.key, slot, req.params.roomId);
  res.json({ user: publicUser(req, store.userByKey(req.params.key)) });
});

// Admin, or a member the admin gave Can Kick / Can Mute for the room both of
// them are in right now (never against an admin) -- see Permissions on a
// user's profile, Rooms tab.
async function canModerate(req, targetKey, permission) {
  const actor = currentUser(req);
  const room = await roomOf(targetKey);
  if (!room) return { error: [404, 'not at the table'] };
  if (actor.role === 'admin') return { room };
  const target = store.userByKey(targetKey);
  if (!target || target.role === 'admin' || target.key === actor.key) return { error: [403, 'not allowed'] };
  if ((await roomOf(actor.key)) !== room) return { error: [403, 'not allowed'] };
  if (!store.roomPermissions(actor.key, roomIdOfLivekit(room))[permission]) return { error: [403, 'not allowed'] };
  return { room };
}

app.post('/api/users/:key/kick', requireUser, async (req, res) => {
  try {
    const { room, error } = await canModerate(req, req.params.key, 'canKick');
    if (error) return res.status(error[0]).json({ error: error[1] });
    await roomService.removeParticipant(room, req.params.key);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: `LiveKit: ${err.message}` });
  }
});

app.post('/api/users/:key/mute', requireUser, async (req, res) => {
  try {
    const { room, error } = await canModerate(req, req.params.key, 'canMute');
    if (error) return res.status(error[0]).json({ error: error[1] });
    const info = await roomService.getParticipant(room, req.params.key);
    const mic = (info.tracks || []).find((t) => t.source === 2);
    if (!mic) return res.status(404).json({ error: 'no microphone track' });
    await roomService.mutePublishedTrack(room, req.params.key, mic.sid, req.body?.muted !== false);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: `LiveKit: ${err.message}` });
  }
});

// Settings > Roles: the permission list and every role's grid of on/off.
// Modules (Manage > Modules): upload a zip, approve what it asks for, turn it
// on, roll back, uninstall. See docs/MODULES.md.
// The two panes that ship with Tavern, listed beside the installed modules. They are always on and
// cannot be removed (for now); their permissions are the built-in ones on the Roles tab.
const BUILTIN_MODULES = [
  { id: 'conference', name: 'Conference', icon: 'video', description: 'Voice and video for the room: the tiles, the toolbar, reactions, asides and the OBS views.', permissions: 'Share their screen, Use reactions, and the Asides group', switchable: true, setting: 'conferenceEnabled', needs: 'Needs a LiveKit server.', turnOff: 'Video and audio stop for everyone in every room. Chat, presence and modules keep working.', turnOn: 'Voice and video for the room. It needs a LiveKit server.' },
  { id: 'chat', name: 'Chat', icon: 'message', description: 'Text chat for the room, with pictures and formatting.', permissions: 'Send chat messages and Send pictures in chat' },
];
// Modules that ship with this Tavern (the modules/ folder of the deployment), and where each stands:
// not installed, installed and current, or installed with a newer version available. Installing or
// updating one builds its zip on the server, so nothing has to be uploaded; it then goes through the
// same approval as any zip (an update that asks for something new waits for the admin).
const BUNDLED_DIR = path.join(__dirname, '..', 'modules');
function bundledList() {
  const installed = new Map(modules.list().map((m) => [m.id, m.version]));
  return bundledModules(BUNDLED_DIR).map((m) => {
    const have = installed.get(m.id) || null;
    return {
      id: m.id, name: m.name, icon: m.icon, description: m.description, version: m.version, installed: have,
      update: Boolean(have) && compareVersions(m.version, have) > 0 && !modules.view(m.id)?.versions.includes(m.version),
    };
  });
}
app.get('/api/modules', requireAdmin, (_req, res) => res.json({ modules: modules.list(), builtin: BUILTIN_MODULES.map((b) => (b.setting ? { ...b, enabled: store.settings[b.setting] !== false } : b)), bundled: bundledList(), limits: { zipBytes: MODULE_LIMITS.zipBytes } }));
app.post('/api/modules/bundled/:id/install', requireAdmin, async (req, res) => {
  const id = req.params.id;
  if (!bundledModules(BUNDLED_DIR).some((m) => m.id === id)) return res.status(404).json({ error: 'that module does not ship with this Tavern' });
  const { zip } = buildModule(path.join(BUNDLED_DIR, id));
  res.status(201).json({ module: await modules.install(zip, { source: 'bundled' }) });
});
app.post('/api/modules', requireAdmin, rawZip, async (req, res) => {
  res.status(201).json({ module: await modules.install(req.body) });
});
app.patch('/api/modules/:id', requireAdmin, (req, res) => {
  res.json({ module: modules.update(req.params.id, req.body || {}, { roomExists: (id) => !!store.roomById(id) }) });
});
app.post('/api/modules/:id/rollback', requireAdmin, (req, res) => {
  res.json({ module: modules.rollback(req.params.id, String(req.body?.version || '')) });
});
app.delete('/api/modules/:id', requireAdmin, (req, res) => {
  modules.uninstall(req.params.id, { keepData: req.query.keepData !== '0' });
  moduleData.forget(req.params.id);
  if (req.query.keepData === '0') {
    moduleHooks.forget(req.params.id);
    moduleHooks.dropModule(req.params.id);
    moduleLinks.dropModule(req.params.id);
    moduleBus.dropModule(req.params.id);
    moduleSettings.forgetModule(req.params.id);
  }
  res.json({ ok: true });
});

// --- module runtime -------------------------------------------------------
// What an installed, enabled module can do once it is running: be served, list
// where it shows up, and read and write its own data. The page hosting a
// module's frame makes these calls on the frame's behalf (see
// public/module-host.js); the frame itself never talks to the server.

// Who is asking: a signed-in user, or a guest carrying a room's guest token.
function moduleViewer(req) {
  const user = currentUser(req);
  if (user) return { user, guestRoom: null };
  const token = req.query.guest;
  const guestRoom = typeof token === 'string' ? store.roomByGuestToken(token) : null;
  return guestRoom ? { user: null, guestRoom } : null;
}

// Whether someone may see a room's module at all: on for that room, and in it.
function moduleRoomAccess(entry, who, room) {
  if (!(entry.allRooms || entry.rooms.includes(room.id))) return false;
  if (who.user) return who.user.role === 'admin' || room.members.includes(who.user.key);
  return who.guestRoom.id === room.id;
}

function modulePerms(who, roomId) {
  return who.user ? store.roomPermissions(who.user.key, roomId) : store.roleSet('guest');
}

function moduleCan(manifest, perms, need) {
  const guard = need && manifest.access?.[need];
  return !guard || Boolean(perms[`module.${manifest.id}.${guard}`]);
}

// Resolve the module, scope and permission for a data call. Sends the error
// itself and returns null when the caller may not.
function moduleAccess(req, res, need) {
  const found = modules.enabled(req.params.id);
  if (!found) return void res.status(404).json({ error: 'no such module' });
  const { manifest, entry } = found;
  const who = moduleViewer(req);
  if (!who) return void res.status(401).json({ error: 'sign in first' });
  const scope = req.query.scope === 'room' ? 'room' : req.query.scope === 'person' ? 'person' : 'server';
  if (!manifest.scope.includes(scope)) return void res.status(400).json({ error: `this module has no ${scope} scope` });
  let roomId = null;
  if (scope === 'person') {
    // A person's own data (their profile's): only they can reach it, not even an administrator, because the place it is kept
    // is named by who is asking.
    if (!who.user) return void res.status(403).json({ error: 'guests have no personal data' });
  } else if (scope === 'room') {
    const room = store.roomById(String(req.query.room || ''));
    if (!room) return void res.status(404).json({ error: 'no such room' });
    if (!moduleRoomAccess(entry, who, room)) return void res.status(403).json({ error: 'this module is not available in that room for you' });
    roomId = room.id;
  } else if (!who.user) {
    return void res.status(403).json({ error: 'guests can only use room modules' });
  }
  const perms = modulePerms(who, roomId);
  if (!moduleCan(manifest, perms, need)) return void res.status(403).json({ error: 'your role can\'t do that in this module' });
  return { manifest, entry, scope, roomId, scopeKey: scope === 'room' ? `room:${roomId}` : scope === 'person' ? `person:${who.user.key}` : 'server', who, perms, by: who.user?.key || 'guest' };
}

// --- chat history --------------------------------------------------------------------------------
// Chat travels live over LiveKit; the sender also posts the text here so someone who joins later reads what
// was said (see server/chat-history.js for what is kept and for how long). Only a real room keeps history, never
// an aside. Reading needs the "open and read the chat" permission, posting "send chat messages", and the person
// must be in the room (or an admin, or a guest of that room).
function chatRoomFor(req, res, permission) {
  const who = moduleViewer(req);
  if (!who) return void res.status(401).json({ error: 'sign in first' });
  const room = store.roomById(req.params.id);
  if (!room) return void res.status(404).json({ error: 'no such room' });
  const allowed = who.user ? who.user.role === 'admin' || room.members.includes(who.user.key) : who.guestRoom.id === room.id;
  if (!allowed) return void res.status(403).json({ error: 'you are not in that room' });
  const perms = who.user ? store.roomPermissions(who.user.key, room.id) : store.roleSet('guest');
  if (!perms[permission]) return void res.status(403).json({ error: 'your role cannot do that' });
  return { who, room };
}

app.get('/api/rooms/:id/chat', (req, res) => {
  const found = chatRoomFor(req, res, 'chatRead');
  if (!found) return;
  res.json({ messages: found.room.ephemeral ? [] : chatHistory.list(found.room.id) });
});

app.post('/api/rooms/:id/chat', (req, res) => {
  const found = chatRoomFor(req, res, 'chat');
  if (!found) return;
  const { who, room } = found;
  if (room.ephemeral) return res.json({ message: null });
  const key = who.user ? who.user.key : `guest:${room.id}`;
  const now = Date.now();
  const recent = (chatPosts.get(key) || []).filter((t) => now - t < 10000);
  if (recent.length >= 30) return res.status(429).json({ error: 'too many messages, slow down' });
  chatPosts.set(key, [...recent, now]);
  const message = chatHistory.add(room.id, {
    by: who.user ? who.user.key : 'guest',
    who: who.user ? who.user.displayName : req.body?.name,
    text: req.body?.text,
  });
  res.json({ message });
});

// --- a module's page reading every room the viewer belongs to ---------------
// A module with a server page and a room panel (the Calendar) can show, on its page, what is
// stored in each of the viewer's rooms. Only rooms the viewer is a member of count (not every
// room an admin could open), the module must be on for the room, and the viewer's role must
// be allowed to read it there. Read-only: writes always go to one scope.

// A Font Awesome icon as inline SVG, for a module's sandboxed frame, which cannot load the icon font.
function iconSvg(id) {
  if (roomIconSvgs.has(id)) return roomIconSvgs.get(id);
  const icon = (store.settings.icons || []).find((i) => i.id === id);
  const classes = icon?.classes || `fa-solid fa-${id}`;
  const style = /fa-brands/.test(classes) ? 'brands' : /fa-regular/.test(classes) ? 'regular' : 'solid';
  const name = classes.split(/\s+/).filter((c) => c.startsWith('fa-')).map((c) => c.slice(3)).find((n) => !['solid', 'regular', 'brands', 'fw'].includes(n));
  const svg = name && /^[a-z0-9-]+$/.test(name) ? faSvg(style, name) : null;
  roomIconSvgs.set(id, svg);
  return svg;
}

// An icon's SVG, from the admin's Pro package first (if it has this style and icon), then the bundled Free set; null if
// neither does. `style`/`name` are checked by the caller (a route param or a value already drawn from known-good data).
function faSvg(style, name) {
  for (const dir of hasFaPro ? [faProDir, faDir] : [faDir]) {
    try {
      return fs.readFileSync(path.join(dir, 'svgs', style, `${name}.svg`), 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim();
    } catch {
      // try the next place, or give up
    }
  }
  return null;
}

// A Font Awesome icon as inline SVG, by style and name, for a module's widget in a sandboxed frame (which cannot
// load the icon font). Anyone signed in may ask; only the free set's own files are ever read.
app.get('/api/icons/:style/:name', requireUser, (req, res) => {
  const { style, name } = req.params;
  if (!['solid', 'regular', 'brands'].includes(style) || !/^[a-z0-9-]{1,40}$/.test(name)) return res.status(400).json({ error: 'no such icon' });
  const svg = faSvg(style, name);
  if (!svg) return res.status(404).json({ error: 'no such icon' });
  res.type('image/svg+xml').set('Cache-Control', 'private, max-age=86400').send(svg);
});

// The viewer's rooms for this module, or null after sending the error.
function moduleRoomsFor(req, res) {
  const found = modules.enabled(req.params.id);
  if (!found) return void res.status(404).json({ error: 'no such module' });
  const who = moduleViewer(req);
  if (!who?.user) return void res.status(403).json({ error: 'guests can only use room modules' });
  const { manifest, entry } = found;
  if (!manifest.scope.includes('room')) return void res.status(400).json({ error: 'this module has no room scope' });
  if (!moduleCan(manifest, modulePerms(who, null), 'read')) return void res.status(403).json({ error: 'your role can\'t do that in this module' });
  const rooms = store.rooms.filter((r) => !r.ephemeral && r.members.includes(who.user.key)
    && (entry.allRooms || entry.rooms.includes(r.id)) && moduleCan(manifest, modulePerms(who, r.id), 'read'));
  return { manifest, rooms };
}
const roomSummary = (r) => {
  const icon = r.linkIcon && r.linkIcon !== 'link' ? r.linkIcon : 'message';
  return { id: r.id, name: r.name, icon, svg: iconSvg(icon) };
};

app.get('/api/modules/:id/rooms-data', (req, res) => {
  const found = moduleRoomsFor(req, res);
  if (!found) return;
  const rooms = found.rooms.map(roomSummary);
  if (req.query.info) return res.json({ rooms });
  const prefix = typeof req.query.prefix === 'string' ? req.query.prefix : '';
  const items = found.rooms.flatMap((r) => moduleData.list(found.manifest.id, `room:${r.id}`, prefix).map((item) => ({ ...item, roomId: r.id })));
  res.json({ rooms, items });
});

// --- refs: one module pointing at another's items ---------------------------
// Modules cannot reach each other's storage, and that stays. Tavern knows nothing about any module's
// items; it offers conduits. A module declares in its manifest the kinds of item it lets others point
// at (`refs.produces`: a kind, the stored key its items live under, which stored fields make up a
// small card, and whether it can open one or show what links to it) and which kinds it wants to point
// at (`refs.consumes`: named kinds, or "*" for whatever other modules share; approved by an admin).
// The consumer stores only a pointer ({ module, kind, id, scope, room }) and asks Tavern for the card
// whenever it draws it. Tavern answers only what the viewer could already see in the producing
// module: it must be enabled, the viewer must hold its read permission in that scope (and be in the
// room), and the consumer must have been approved for that kind. What comes back is the card, never
// the stored record. Nothing here names a module: a module installed tomorrow takes part by declaring.

const refError = (status, message) => Object.assign(new Error(message), { status });
const REF_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const refScopeKey = (ref) => (ref.scope === 'room' ? `room:${ref.room}` : 'server');
const refShape = (r) => r && typeof r === 'object' && typeof r.module === 'string' && typeof r.kind === 'string' && REF_ID_RE.test(String(r.id ?? ''))
  && (r.scope === 'server' || r.scope === 'person' || (r.scope === 'room' && typeof r.room === 'string' && r.room.length <= 64));

// Whether the consumer's manifest declares, and the admin approved, linking to provider:kind.
function consumerMayLink(consumer, provider, kind) {
  const want = `${provider}:${kind}`;
  const declared = consumer.manifest.refs.consumes;
  const approved = consumer.entry.approved?.refs || [];
  return (declared.includes('*') || declared.includes(want)) && (approved.includes('*') || approved.includes(want));
}

// Check that this viewer may look at one scope of `provider`'s items of `kind`. Through a consumer
// (`from`, which must have been approved for the kind), or, for backlinks, with no consumer at all
// (`skipConsumer`): a module may always see what points at its own items, as far as the viewer may.
function refScope(who, { provider, kind, scope, room, from, skipConsumer = false }) {
  const found = modules.enabled(provider);
  if (!found) throw refError(404, 'no such module');
  const produce = found.manifest.refs.produces.find((p) => p.kind === kind);
  if (!produce) throw refError(404, 'that module does not share that kind of item');
  let consumer = null;
  if (!skipConsumer) {
    if (!from) throw refError(400, 'say which module is asking');
    consumer = modules.enabled(from);
    if (!consumer) throw refError(404, 'no such module');
    if (!consumerMayLink(consumer, provider, kind)) throw refError(403, 'that module has not been approved to link to those items');
  }
  const { manifest, entry } = found;
  let scopeKey;
  let perms;
  if (scope === 'room') {
    const r = store.roomById(String(room || ''));
    if (!r) throw refError(404, 'no such room');
    if (!manifest.scope.includes('room')) throw refError(400, 'that module has no room scope');
    if (!moduleRoomAccess(entry, who, r)) throw refError(403, 'that module is not available in that room for you');
    // The asking module must itself be on in that room, and readable by the viewer.
    if (consumer && (!moduleRoomAccess(consumer.entry, who, r) || !moduleCan(consumer.manifest, modulePerms(who, r.id), 'read'))) throw refError(403, 'the linking module is not available in that room for you');
    perms = modulePerms(who, r.id);
    scopeKey = `room:${r.id}`;
  } else if (scope === 'person') {
    // The viewer's own items, kept for them alone; a pointer to someone else's simply finds nothing here.
    if (!who.user) throw refError(403, 'guests have no personal data');
    if (!manifest.scope.includes('person')) throw refError(400, 'that module has no personal scope');
    if (consumer && !moduleCan(consumer.manifest, modulePerms(who, null), 'read')) throw refError(403, 'the linking module is not available to you');
    perms = modulePerms(who, null);
    scopeKey = `person:${who.user.key}`;
  } else {
    if (!who.user) throw refError(403, 'guests can only use room modules');
    if (!manifest.scope.includes('server')) throw refError(400, 'that module has no server scope');
    if (consumer && !moduleCan(consumer.manifest, modulePerms(who, null), 'read')) throw refError(403, 'the linking module is not available to you');
    perms = modulePerms(who, null);
    scopeKey = 'server';
  }
  if (!moduleCan(manifest, perms, 'read')) throw refError(403, 'your role can\'t see that module');
  return { manifest, produce, scopeKey, ref: { module: provider, kind, scope: scope === 'room' ? 'room' : scope === 'person' ? 'person' : 'server', ...(scope === 'room' ? { room: String(room) } : {}) } };
}

// The card for one stored item: only the fields the producer named, trimmed and typed.
function refCard({ manifest, produce, ref }, id, value, withText = false) {
  const text = (v) => (typeof v === 'string' ? v.slice(0, 200) : typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const field = (name) => (produce.card[name] ? value?.[produce.card[name]] : undefined);
  const card = {
    ref: { ...ref, id },
    kind: produce.kind,
    kindName: produce.name,
    open: produce.open,
    module: { id: manifest.id, name: manifest.name, icon: manifest.icon },
    title: String(text(field('title')) ?? '').trim() || 'Untitled',
  };
  const subtitle = text(field('subtitle'));
  if (subtitle !== undefined && subtitle !== '') card.subtitle = subtitle;
  for (const name of ['when', 'end']) {
    const v = text(field(name));
    if (v !== undefined && v !== '') card[name] = v;
  }
  for (const name of ['allDay', 'done']) if (typeof field(name) === 'boolean') card[name] = field(name);
  // A short label a module may give its items to group or colour them ("eat", "stay"): lower case letters, digits and dashes.
  const category = text(field('category'));
  if (typeof category === 'string' && /^[A-Za-z0-9-]{1,20}$/.test(category)) card.category = category.toLowerCase();
  // The item's own words (a note's body), plain and up to 8 KB. Left out of the cards people browse; the server reads it only
  // for the AI hook, as the person asking.
  if (withText) { const t = field('text'); if (typeof t === 'string' && t.trim()) card.text = t.replace(/\p{Cc}(?<!\n)/gu, ' ').slice(0, 8000); }
  // A place on the map, if the item has one: { lat, lng, name? }, checked; anything else is left out.
  const place = field('place');
  if (place && typeof place === 'object' && Number.isFinite(place.lat) && Number.isFinite(place.lng) && Math.abs(place.lat) <= 90 && Math.abs(place.lng) <= 180) {
    card.place = { lat: place.lat, lng: place.lng, ...(typeof place.name === 'string' && place.name.trim() ? { name: place.name.replace(/\p{Cc}/gu, ' ').trim().slice(0, 120) } : {}) };
  }
  return card;
}

function resolveRef(who, ref, from, opts = {}) {
  if (!refShape(ref)) throw refError(400, 'that is not a valid reference');
  const at = refScope(who, { provider: ref.module, kind: ref.kind, scope: ref.scope, room: ref.room, from, ...opts });
  const item = moduleData.get(at.manifest.id, at.scopeKey, at.produce.key.replace('{id}', String(ref.id)));
  if (!item || !item.value) throw refError(404, 'that item is no longer there');
  return refCard(at, String(ref.id), item.value, opts.withText === true);
}

// The kinds the consumer may point at: every kind of every other enabled module it was approved for.
function consumableKinds(consumerId) {
  const consumer = modules.enabled(consumerId);
  if (!consumer) return [];
  const out = [];
  for (const { manifest } of modules.enabledAll()) {
    if (manifest.id === consumerId) continue;
    for (const p of manifest.refs.produces) {
      if (consumerMayLink(consumer, manifest.id, p.kind)) out.push({ module: manifest.id, moduleName: manifest.name, icon: manifest.icon, kind: p.kind, name: p.name, open: p.open, events: (manifest.events?.publishes || []).filter((e) => e.kind === p.kind).map((e) => ({ name: e.name, label: e.label, data: e.data || {} })) });
    }
  }
  return out;
}

const refAnswer = (fn) => {
  try {
    return fn();
  } catch (err) {
    if (!err.status) throw err;
    // `state` says what to draw: the item is gone, or it exists but this viewer may not see it (never more than they may know).
    return { error: err.message, status: err.status, ...(err.status === 404 ? { state: 'gone' } : err.status === 403 ? { state: 'hidden' } : {}) };
  }
};

// Cards for a list of pointers, one answer each (a card, or why not).
app.post('/api/refs/resolve', (req, res) => {
  const who = moduleViewer(req);
  if (!who) return res.status(401).json({ error: 'sign in first' });
  const from = String(req.body?.from || '');
  const refs = Array.isArray(req.body?.refs) ? req.body.refs.slice(0, 50) : [];
  res.json({ cards: refs.map((ref) => refAnswer(() => resolveRef(who, ref, from)) ) .map((c, i) => (c.error ? { ref: refs[i], ...c } : c)) });
});

// The kinds the asking module may link to, so it does not have to know other modules by name.
app.get('/api/refs/kinds', (req, res) => {
  if (!moduleViewer(req)) return res.status(401).json({ error: 'sign in first' });
  res.json({ kinds: consumableKinds(String(req.query.from || '')) });
});

// Items the asking module could link to, in one scope: every kind it was approved to consume.
app.get('/api/refs/search', (req, res) => {
  const who = moduleViewer(req);
  if (!who) return res.status(401).json({ error: 'sign in first' });
  const from = String(req.query.from || '');
  if (!modules.enabled(from)) return res.status(404).json({ error: 'no such module' });
  const scope = req.query.scope === 'room' ? 'room' : req.query.scope === 'person' ? 'person' : 'server';
  const q = String(req.query.q || '').trim().toLowerCase();
  const cards = [];
  for (const k of consumableKinds(from)) {
    let at;
    try {
      at = refScope(who, { provider: k.module, kind: k.kind, scope, room: req.query.room, from });
    } catch {
      continue; // not on for this scope, or not for this viewer
    }
    const prefix = at.produce.key.replace('{id}', '');
    for (const item of moduleData.list(k.module, at.scopeKey, prefix)) {
      if (!item.value || !REF_ID_RE.test(item.key.slice(prefix.length))) continue;
      const card = refCard(at, item.key.slice(prefix.length), item.value);
      if (q && !`${card.title} ${card.subtitle || ''}`.toLowerCase().includes(q)) continue;
      cards.push(card);
    }
  }
  // Newest dates first, undated last.
  cards.sort((a, b) => String(b.when ?? '').localeCompare(String(a.when ?? '')) || a.title.localeCompare(b.title));
  res.json({ cards: cards.slice(0, 50) });
});

// One item, by address (the same answer the batch gives).
app.get('/api/modules/:id/refs/:kind/:refId', (req, res) => {
  const who = moduleViewer(req);
  if (!who) return res.status(401).json({ error: 'sign in first' });
  const out = refAnswer(() => ({ card: resolveRef(who, { module: req.params.id, kind: req.params.kind, id: req.params.refId, scope: req.query.scope, room: req.query.room }, String(req.query.from || '')) }));
  res.status(out.status || 200).json(out);
});

// Links: a module tells Tavern which items one of its items points at, so the items pointed at can
// ask what points at them. `module` is the asking module, `from` one of its own items, `to` the items
// it now points at (the whole list: it replaces the last). Each target must be something the viewer
// can see and the module is approved to link to, and the viewer must be able to write to the module.
app.post('/api/refs/links', (req, res) => {
  const who = moduleViewer(req);
  if (!who) return res.status(401).json({ error: 'sign in first' });
  const asker = String(req.body?.module || '');
  const from = req.body?.from;
  const found = modules.enabled(asker);
  if (!found) return res.status(404).json({ error: 'no such module' });
  if (!refShape(from) || from.module !== asker) return res.status(400).json({ error: 'a module can only say what its own items point at' });
  if (from.scope === 'person') return res.status(400).json({ error: 'personal items are private, so they are not linked' });
  if (!found.manifest.refs.produces.some((p) => p.kind === from.kind)) return res.status(400).json({ error: 'that module does not share that kind of item' });
  // The viewer must be allowed to change the asking module's data in that scope.
  let perms;
  if (from.scope === 'room') {
    const r = store.roomById(String(from.room || ''));
    if (!r || !moduleRoomAccess(found.entry, who, r)) return res.status(403).json({ error: 'that module is not available in that room for you' });
    perms = modulePerms(who, r.id);
  } else {
    if (!who.user) return res.status(403).json({ error: 'guests can only use room modules' });
    perms = modulePerms(who, null);
  }
  if (!moduleCan(found.manifest, perms, 'write')) return res.status(403).json({ error: 'your role can\'t do that in this module' });
  const tos = [];
  for (const to of (Array.isArray(req.body?.to) ? req.body.to : []).slice(0, 20)) {
    if (to && to.scope === 'person') continue; // a shared link never points into someone's private data
    try {
      resolveRef(who, to, asker);
      tos.push(to);
    } catch (err) {
      if (!err.status) throw err; // one that cannot be seen or is gone is left out
    }
  }
  moduleLinks.set(from, tos, who.user?.key || 'guest');
  res.json({ links: tos.length });
});

// What points at an item (`dir=to`, for the module that owns it, if it shows backlinks) or what it
// points at (`dir=from`): cards, each only for what the viewer may see.
app.get('/api/refs/links', (req, res) => {
  const who = moduleViewer(req);
  if (!who) return res.status(401).json({ error: 'sign in first' });
  let ref;
  try {
    ref = JSON.parse(String(req.query.ref || ''));
  } catch {
    return res.status(400).json({ error: 'that is not a valid reference' });
  }
  const asker = String(req.query.from || '');
  const found = modules.enabled(asker);
  if (!found) return res.status(404).json({ error: 'no such module' });
  if (!refShape(ref) || ref.module !== asker) return res.status(400).json({ error: 'a module can only ask about its own items' });
  const produce = found.manifest.refs.produces.find((p) => p.kind === ref.kind);
  if (!produce) return res.status(400).json({ error: 'that module does not share that kind of item' });
  const dir = req.query.dir === 'from' ? 'from' : 'to';
  if (dir === 'to' && !produce.backlinks) return res.status(403).json({ error: 'that kind of item does not show what links to it' });
  // The asking module's own item must itself be visible to the viewer.
  try {
    resolveRef(who, ref, null, { skipConsumer: true });
  } catch (err) {
    if (!err.status) throw err;
    return res.status(err.status).json({ error: err.message });
  }
  const cards = [];
  for (const other of dir === 'to' ? moduleLinks.to(ref) : moduleLinks.from(ref)) {
    try {
      cards.push(dir === 'to' ? resolveRef(who, other, null, { skipConsumer: true }) : resolveRef(who, other, asker));
    } catch (err) {
      if (!err.status) throw err; // gone, or not for this viewer
    }
  }
  res.json({ cards });
});

// --- events and actions: modules reacting to and asking things of each other -------------------
// Like refs, Tavern is only the conduit. A module declares in module.json the events it publishes and
// the ones it wants to hear (`events`), and the actions it provides and the ones it wants to ask
// for (`actions`); an admin approves what a module hears and asks for; this code checks who may do
// what and carries the messages, and knows nothing of what any of them mean. An event is delivered
// live to the modules that may hear it and kept a while for those not open at the time. An action
// request waits in the providing module's queue until a person has that module open: its page claims
// the request (one page only), does it under its own rules, and reports back.

const busMay = (rules, approved, want) => (rules.includes('*') || rules.includes(want)) && (approved.includes('*') || approved.includes(want));
const mayHear = ({ manifest, entry }, publisher, name) => busMay(manifest.events.subscribes, entry.approved?.events || [], `${publisher}:${name}`);
const mayUse = ({ manifest, entry }, provider, action) => busMay(manifest.actions.uses, entry.approved?.actions || [], `${provider}:${action}`);

// Resolve one module's place (the server, or a room) for this viewer with the permission needed.
function busPlace(who, moduleId, scope, room, need) {
  const found = modules.enabled(moduleId);
  if (!found) throw refError(404, 'no such module');
  const { manifest, entry } = found;
  let scopeKey;
  let perms;
  let roomId = null;
  if (scope === 'room') {
    const r = store.roomById(String(room || ''));
    if (!r) throw refError(404, 'no such room');
    if (!manifest.scope.includes('room')) throw refError(400, 'that module has no room scope');
    if (!moduleRoomAccess(entry, who, r)) throw refError(403, 'that module is not available in that room for you');
    perms = modulePerms(who, r.id);
    scopeKey = `room:${r.id}`;
    roomId = r.id;
  } else {
    if (!who.user) throw refError(403, 'guests can only use room modules');
    if (!manifest.scope.includes('server')) throw refError(400, 'that module has no server scope');
    perms = modulePerms(who, null);
    scopeKey = 'server';
  }
  if (!moduleCan(manifest, perms, need)) throw refError(403, 'your role can\'t do that in this module');
  return { found, scopeKey, roomId, perms };
}

const busScope = (v) => (v === 'room' ? 'room' : 'server');
const busRoute = (fn) => (req, res) => {
  const who = moduleViewer(req);
  if (!who) return res.status(401).json({ error: 'sign in first' });
  try {
    res.json(fn(who, req));
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
};
const publicEvent = (e) => ({ id: e.id, at: e.at, module: e.module, name: e.name, ref: e.ref, data: e.data });
const publicAction = (a) => ({ id: a.id, at: a.at, from: a.from, name: a.action, input: a.input, by: store.userByKey(a.by)?.displayName || 'someone' });

// A module says something happened. It must have declared the event, and the person must be able to
// change that module here (they are the reason it happened).
app.post('/api/bus/publish', busRoute((who, req) => {
  const { module: id, name, ref, data, scope, room } = req.body || {};
  const at = busPlace(who, String(id || ''), busScope(scope), room, 'write');
  if (overLimit(at.found.manifest.id, who.user?.key, 'event')) throw refError(429, limitMessage);
  if (!at.found.manifest.events.publishes.some((p) => p.name === name)) throw refError(400, 'that module does not publish that event');
  let pointer = null;
  if (ref !== undefined && ref !== null) {
    if (!refShape(ref) || ref.module !== id || !at.found.manifest.refs.produces.some((p) => p.kind === ref.kind) || refScopeKey(ref) !== at.scopeKey) {
      throw refError(400, 'an event can only point at one of its module\'s own items, in the same place');
    }
    pointer = { module: ref.module, kind: ref.kind, id: String(ref.id), scope: ref.scope, ...(ref.scope === 'room' ? { room: ref.room } : {}) };
  }
  const event = moduleBus.publish({ module: id, name, ref: pointer, data, scopeKey: at.scopeKey, by: who.user?.key || 'guest' });
  if (!event) throw refError(400, 'the event\'s data is too large');
  return { id: event.id };
}));

// What a module missed, in its own place: the events it may hear (declared and approved) about
// modules the person can see. `after=now` says where things stand, to start listening from.
app.get('/api/bus/events', busRoute((who, req) => {
  const at = busPlace(who, String(req.query.module || ''), busScope(req.query.scope), req.query.room, 'read');
  if (req.query.after === 'now') return { events: [], latest: moduleBus.latestEvent(at.scopeKey) };
  const after = Number(req.query.after) || 0;
  const events = [];
  for (const e of moduleBus.eventsAfter(at.scopeKey, after)) {
    if (!mayHear(at.found, e.module, e.name)) continue;
    try {
      busPlace(who, e.module, busScope(req.query.scope), req.query.room, 'read');
    } catch {
      continue; // a module the person cannot see here
    }
    events.push(publicEvent(e));
    if (events.length >= 100) break;
  }
  return { events, latest: events.length ? events[events.length - 1].id : moduleBus.latestEvent(at.scopeKey) };
}));

// The actions the asking module may request here: every one, of every other module, it was approved for.
app.get('/api/bus/actions', busRoute((who, req) => {
  const from = String(req.query.from || '');
  const scope = busScope(req.query.scope);
  const asker = busPlace(who, from, scope, req.query.room, 'read');
  // `accepts=module:kind` keeps the actions that take a pointer to that kind of item; `self=1` also lists the
  // asking module's own, which it may always use.
  const accepts = String(req.query.accepts || '');
  const takes = (input) => !accepts || Object.values(input).some((t) => { const b = t.replace(/\?$/, ''); return b === 'ref' || b === `ref:${accepts}`; });
  const actions = [];
  for (const { manifest } of modules.enabledAll()) {
    const own = manifest.id === from;
    if (own && req.query.self !== '1') continue;
    for (const a of manifest.actions.provides) {
      if (!takes(a.input)) continue;
      if (!own) {
        if (!mayUse(asker.found, manifest.id, a.name)) continue;
        try {
          busPlace(who, manifest.id, scope, req.query.room, a.local ? 'read' : 'write'); // you can ask only for what you could do yourself
        } catch {
          continue;
        }
      }
      actions.push({ action: `${manifest.id}:${a.name}`, module: manifest.id, moduleName: manifest.name, icon: manifest.icon, name: a.name, label: a.label, input: a.input, ...(a.needs ? { needs: a.needs } : {}), ...(own ? { own: true } : {}) });
    }
  }
  return { actions };
}));

// Check an action's input against what the module said it takes; only those fields come out.
function busInput(who, shape, input) {
  const out = {};
  const given = input && typeof input === 'object' ? input : {};
  for (const [field, type] of Object.entries(shape)) {
    const optional = type.endsWith('?');
    const base = optional ? type.slice(0, -1) : type;
    const v = given[field];
    if (v === undefined || v === null || v === '') {
      if (!optional) throw refError(400, `${field} is needed`);
      continue;
    }
    if (base === 'string' || base === 'text') {
      if (typeof v !== 'string') throw refError(400, `${field} must be text`);
      out[field] = v.replace(/\p{Cc}/gu, ' ').trim().slice(0, base === 'string' ? 200 : 1000);
      if (!out[field] && !optional) throw refError(400, `${field} is needed`);
    } else if (base === 'date') {
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())) throw refError(400, `${field} must be a date`);
      out[field] = v;
    } else if (base === 'datetime') {
      const d = new Date(v);
      if (typeof v !== 'string' || Number.isNaN(d.getTime())) throw refError(400, `${field} must be a date and time`);
      out[field] = d.toISOString();
    } else if (base === 'boolean') {
      if (typeof v !== 'boolean') throw refError(400, `${field} must be true or false`);
      out[field] = v;
    } else if (base === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw refError(400, `${field} must be a number`);
      out[field] = v;
    } else if (base === 'ref' || base.startsWith('ref:')) {
      if (!refShape(v)) throw refError(400, `${field} must be a reference`);
      if (base !== 'ref' && base !== `ref:${v.module}:${v.kind}`) throw refError(400, `${field} must be a ${base.slice(4).replace(':', ' ')}`);
      resolveRef(who, v, null, { skipConsumer: true }); // the asker must be able to see what it points at
      out[field] = { module: v.module, kind: v.kind, id: String(v.id), scope: v.scope, ...(v.scope === 'room' ? { room: v.room } : {}) };
    }
  }
  return out;
}

// One module asks another to do something. Queued for the module that owns the action.
app.post('/api/bus/actions/request', busRoute((who, req) => {
  const { from, action, input, scope, room } = req.body || {};
  const [providerId, name] = String(action || '').split(':');
  const sc = busScope(scope);
  const asker = busPlace(who, String(from || ''), sc, room, 'read');
  if (overLimit(asker.found.manifest.id, who.user?.key, 'action')) throw refError(429, limitMessage);
  const provider = busPlace(who, String(providerId || ''), sc, room, 'read');
  const def = provider.found.manifest.actions.provides.find((a) => a.name === name);
  if (!def) throw refError(404, 'that module does not offer that action');
  if (!mayUse(asker.found, providerId, name)) throw refError(403, 'that module has not been approved to ask for that');
  if (!def.local) busPlace(who, String(providerId), sc, room, 'write'); // asking for a change takes the right to make it
  const request = moduleBus.request({ from, provider: providerId, action: name, input: busInput(who, def.input, input), scopeKey: provider.scopeKey, by: who.user?.key || 'guest', local: def.local });
  return { id: request.id, status: request.status };
}));

// The providing module's page: what is waiting, take one, say how it went.
app.get('/api/bus/actions/pending', busRoute((who, req) => {
  const at = busPlace(who, String(req.query.module || ''), busScope(req.query.scope), req.query.room, 'read');
  let canWrite = true;
  try { busPlace(who, String(req.query.module || ''), busScope(req.query.scope), req.query.room, 'write'); } catch { canWrite = false; }
  // A view (`local`) is for the person who asked, from their own page; anything else waits for a page that may make the change.
  return { actions: moduleBus.pending(String(req.query.module), at.scopeKey).filter((a) => (a.local ? a.by === (who.user?.key || 'guest') : canWrite)).map(publicAction) };
}));
app.post('/api/bus/actions/claim', busRoute((who, req) => {
  const { module: id, id: requestId, scope, room } = req.body || {};
  const at = busPlace(who, String(id || ''), busScope(scope), room, 'read');
  const waiting = moduleBus.actionById(Number(requestId));
  if (waiting && waiting.local) { if (waiting.by !== (who.user?.key || 'guest')) return { ok: false }; } else busPlace(who, String(id || ''), busScope(scope), room, 'write');
  const request = moduleBus.claim(Number(requestId), id, at.scopeKey);
  return request ? { ok: true, action: publicAction(request) } : { ok: false };
}));
app.post('/api/bus/actions/complete', busRoute((who, req) => {
  const { module: id, id: requestId, scope, room, result } = req.body || {};
  const at = busPlace(who, String(id || ''), busScope(scope), room, 'read');
  const done = moduleBus.actionById(Number(requestId));
  if (done && done.local) { if (done.by !== (who.user?.key || 'guest')) return { ok: false }; } else busPlace(who, String(id || ''), busScope(scope), room, 'write');
  const clean = { ok: Boolean(result?.ok) };
  if (typeof result?.error === 'string') clean.error = result.error.slice(0, 200);
  // A small piece of plain data may come back with the result (up to about 8 KB of JSON), for a view that asks a question.
  if (result?.data !== undefined) {
    try {
      const text = JSON.stringify(result.data);
      if (text && text.length <= 8000) clean.data = JSON.parse(text);
    } catch (err) { /* not plain data: left out */ }
  }
  if (refShape(result?.ref) && result.ref.module === id) clean.ref = { module: result.ref.module, kind: result.ref.kind, id: String(result.ref.id), scope: result.ref.scope, ...(result.ref.scope === 'room' ? { room: result.ref.room } : {}) };
  return { ok: Boolean(moduleBus.complete(Number(requestId), id, at.scopeKey, clean)) };
}));
// The asking module: how did it go?
app.get('/api/bus/actions/status', busRoute((who, req) => {
  const from = String(req.query.from || '');
  const at = busPlace(who, from, busScope(req.query.scope), req.query.room, 'read');
  const request = moduleBus.actionById(Number(req.query.id));
  if (!request || request.from !== from || request.scopeKey !== at.scopeKey) throw refError(404, 'no such request');
  return { status: request.status, result: request.result };
}));

// --- what modules have been doing ------------------------------------------------------------
// The last things modules did through Tavern (data they saved, events they published, actions they asked
// for), so an admin can see, above all for a module running in the page, what it has been up to. Only
// what passes through Tavern is seen: a module in the page can also do things Tavern never hears of.
// Kept across a restart (DATA_DIR/modules/activity.json, written a few seconds after a change and on exit).
// Built per environment in server/environment.js (moduleActivity, noteActivity); the event wiring below it
// (a change, a published event, an action asked for -> a line in the activity list) is wired there too.

// How often a module may do things through Tavern (see server/module-limits.js). Over the limit is a 429 and, the
// first time in a while, a line in the activity list so an admin can see which module is being slowed.
function overLimit(moduleId, by, kind) {
  const r = moduleLimits.take(moduleId, by || 'guest', kind);
  if (r.ok) return null;
  if (r.first) noteActivity(moduleId, `was slowed: too many ${kind === 'write' ? 'saves' : kind + 's'} in a minute`, by, null);
  return r;
}
const limitMessage = 'this module is doing that too often; try again in a moment';
app.get('/api/modules/activity', requireAdmin, (_req, res) => {
  res.json({
    activity: moduleActivity.slice(-100).reverse().map((a) => ({ ...a, moduleName: modules.enabled(a.module)?.manifest.name || a.module, byName: store.userByKey(a.by)?.displayName || (a.by === 'guest' ? 'a guest' : a.by) })),
  });
});

// Modules with a page of their own that this viewer can open: the header nav.
// The pre-made backgrounds that ship with Tavern (see server/backgrounds.js), for the picker beside an image slot.
const backgrounds = new Backgrounds(path.join(publicDir, 'assets', 'images', 'backgrounds'));
app.get('/api/backgrounds', (req, res) => {
  if (!currentUser(req)) return res.status(401).json({ error: 'sign in first' });
  res.json({ backgrounds: backgrounds.all() });
});

// Every enabled module with a server page this viewer may read -- not only the ones shown as a main-nav
// icon (public/module.js also asks this to find a module's own page at all, by direct link or a room's
// own "open this"; `nav` just says whether brand.js's topbar should offer an icon for it too).
app.get('/api/modules/nav', (req, res) => {
  const who = moduleViewer(req);
  if (!who?.user) return res.json({ modules: [] });
  const perms = modulePerms(who, null);
  res.json({
    modules: modules.enabledAll()
      .filter(({ manifest }) => manifest.scope.includes('server') && manifest.surfaces.page && moduleCan(manifest, perms, 'read'))
      .map(({ manifest, entry }) => ({ id: manifest.id, name: manifest.name, icon: manifest.icon, version: manifest.version, scope: manifest.scope, runMode: modules.runModeOf(entry), page: manifest.surfaces.page.entry, widget: Boolean(manifest.surfaces.widget), nav: Boolean(manifest.surfaces.page.nav) })),
  });
});

// The widgets for the dashboard on the rooms page: enabled modules with a surfaces.widget that this person may
// read, in the order the modules ask for. A guest has no dashboard.
app.get('/api/modules/widgets', (req, res) => {
  const who = moduleViewer(req);
  if (!who?.user) return res.json({ widgets: [] });
  const perms = modulePerms(who, null);
  const widgets = modules.enabledAll()
    .filter(({ manifest }) => manifest.scope.includes('server') && manifest.surfaces.widget && moduleCan(manifest, perms, 'read'))
    .map(({ manifest, entry }) => ({
      id: manifest.id, name: manifest.name, icon: manifest.icon, version: manifest.version, scope: manifest.scope, runMode: modules.runModeOf(entry),
      title: manifest.surfaces.widget.title || manifest.name, size: manifest.surfaces.widget.size, order: manifest.surfaces.widget.order, entry: manifest.surfaces.widget.entry,
    }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  res.json({ widgets });
});

// --- module settings -------------------------------------------------------------------------------------
// What a module declares (module.json `settings`) and what people choose (server/module-settings.js). A module reads
// the values that apply to the viewer; the forms that change them are drawn by Tavern on the Modules tab (the server's),
// a room's own page (the room's) and the profile page (a person's own). Who may change what: the server's, an admin; a
// room's, an admin or one of that room's moderators; a person's own, that person.

// --- AI, for the modules that ask ---------------------------------------------------------------------------------------------
// One server-wide setting (see ai.js); the key never leaves the server and is never sent back. A module asks through the `ai` hook:
// the server checks the person's role and the room, reads the chosen items as that person, asks the service the admin set up, and
// returns text with any cards the model wrote (each checked). Nothing is kept: no question, no answer, no item text. The activity
// list gets who, which module and task, and how many tokens.
function sendAiError(err, res) {
  if (err instanceof AiError) return res.status(err.status).json({ error: err.message });
  throw err;
}
app.get('/api/ai', requireAdmin, (_req, res) => res.json({ ai: ai.view(), usage: ai.usageView(), dependents: modules.aiDependents() }));
app.post('/api/ai/models', requireAdmin, async (req, res) => {
  try {
    res.json({ models: await ai.listModels({ provider: String(req.body?.provider || ''), address: req.body?.address, key: req.body?.key }) });
  } catch (err) {
    sendAiError(err, res);
  }
});
app.put('/api/ai', requireAdmin, (req, res) => {
  try {
    const before = ai.view();
    // Turning AI off (however the patch does it) while a module depends on it: the admin's page should have asked first (as it
    // does for a module others `requires`); a caller that skipped that, or forces past it, is handled the same way.
    if (before.enabled && !ai.previewEnabled(req.body || {}) && req.body?.force !== true) {
      const dependents = modules.aiDependents();
      if (dependents.length) throw new AiError(`${dependents.map((m) => m.name).join(' and ')} needs the AI service; turn ${dependents.length === 1 ? 'it' : 'them'} off too?`);
    }
    const after = ai.set(req.body || {});
    if (before.enabled && !after.enabled) for (const m of modules.aiDependents()) modules.update(m.id, { enabled: false, force: true });
    noteActivity('tavern', `changed the AI setting (${after.provider}${after.keySet && !before.keySet ? ', key set' : ''})`, currentUser(req)?.key, null);
    res.json({ ai: after, usage: ai.usageView(), dependents: modules.aiDependents() });
  } catch (err) {
    sendAiError(err, res);
  }
});
// Whether AI is available to this person here (for a page to show or hide its buttons): { available, why? }.
function aiAllowed(ctx) {
  const user = ctx.who.user;
  if (!user) return { ok: false, why: 'guests cannot use AI' };
  if (!ai.ready()) return { ok: false, why: 'AI is not set up on this server' };
  const room = ctx.roomId ? store.roomById(ctx.roomId) : null;
  if (room && room.aiOff) return { ok: false, why: 'AI is turned off in this room' };
  const perms = ctx.roomId ? store.roomPermissions(user.key, ctx.roomId) : store.roleSet(user.role);
  if (!perms.useAi) return { ok: false, why: 'your role may not use AI' };
  return { ok: true };
}
app.get('/api/modules/:id/ai', (req, res) => {
  const ctx = moduleAccess(req, res, 'read');
  if (!ctx || !requireHook(ctx, res, 'ai')) return;
  const a = aiAllowed(ctx);
  res.json({ available: a.ok, why: a.why || '' });
});
app.post('/api/modules/:id/ai', async (req, res) => {
  const ctx = moduleAccess(req, res, 'write');
  if (!ctx || !requireHook(ctx, res, 'ai')) return;
  const allowed = aiAllowed(ctx);
  if (!allowed.ok) return res.status(403).json({ error: allowed.why });
  if (overLimit(ctx.manifest.id, ctx.by, 'ai')) return res.status(429).json({ error: limitMessage });
  const refs = Array.isArray(req.body?.items) ? req.body.items.slice(0, 12) : [];
  // The items are read as this person: only what they may see, and only kinds this module produces or was approved to link to.
  const items = [];
  const given = [];
  for (const ref of refs) {
    try {
      const own = ref && ref.module === ctx.manifest.id;
      const card = resolveRef(ctx.who, ref, ctx.manifest.id, { withText: true, skipConsumer: own });
      const bits = [card.subtitle, card.when ? `date: ${card.when}` : '', card.place && card.place.name ? `place: ${card.place.name}` : ''].filter(Boolean);
      items.push({ title: card.title, text: [card.text, ...bits].filter(Boolean).join('\n') || card.title });
      given.push(card.ref);
    } catch {
      // an item that is gone, or that this person may not see, is simply left out
    }
  }
  try {
    const task = String(req.body?.task || '');
    const out = await ai.run(task, items, req.body?.question);
    noteActivity(ctx.manifest.id, `used AI to ${task} (${out.tokens} tokens)`, ctx.by, ctx.scopeKey);
    res.json({ text: out.text, cards: (out.cards || []).map((c) => ({ ...c, sources: (c.sources || []).map((n) => given[n - 1]).filter(Boolean) })), tags: out.tags, used: out.used.map((n) => given[n - 1]).filter(Boolean), tokens: out.tokens });
  } catch (err) {
    sendAiError(err, res);
  }
});

// --- files a module's people upload ---------------------------------------------------------------------------------------
// A module that declares `uploads` keeps pictures per scope (server, room, person), with the same read and write permissions as
// its data. The server checks what arrives from the bytes themselves and takes out what rides along (see image-clean.js).
const rawUpload = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: 10 * 1024 * 1024 + 1024 });
function uploadAccess(req, res, need) {
  const ctx = moduleAccess(req, res, need);
  if (!ctx) return null;
  if (!ctx.manifest.uploads) { res.status(404).json({ error: 'this module keeps no uploaded files' }); return null; }
  return ctx;
}
const uploadView = (f) => ({ id: f.id, name: f.name, type: f.type, size: f.size, by: f.by, at: f.at, taken: f.taken, camera: f.camera, hasPosition: f.hasPosition, position: f.position, hasThumb: !!f.thumb });
app.get('/api/modules/:id/uploads', (req, res) => {
  const ctx = uploadAccess(req, res, 'read');
  if (!ctx) return;
  res.json({ files: moduleUploads.list(ctx.manifest.id, ctx.scopeKey).map(uploadView) });
});
app.post('/api/modules/:id/uploads', rawUpload, (req, res) => {
  const ctx = uploadAccess(req, res, 'write');
  if (!ctx) return;
  if (overLimit(ctx.manifest.id, ctx.by, 'upload')) return res.status(429).json({ error: limitMessage });
  if (!Buffer.isBuffer(req.body)) return res.status(415).json({ error: 'send the picture itself, as a JPEG, PNG or WebP' });
  const file = moduleUploads.put(ctx.manifest.id, ctx.scopeKey, ctx.manifest.uploads, { bytes: req.body, name: req.query.name, by: ctx.by, keepPosition: req.query.keepPosition === '1' });
  res.status(201).json({ file: uploadView(file) });
});
// What the start of a picture says about itself, for a page that will resize it (a resize loses the picture's own facts): send its
// first ~256 KB. The answer goes only to the person who sent it.
app.post('/api/modules/:id/uploads/inspect', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: 300 * 1024 }), (req, res) => {
  const ctx = uploadAccess(req, res, 'write');
  if (!ctx) return;
  if (overLimit(ctx.manifest.id, ctx.by, 'upload')) return res.status(429).json({ error: limitMessage });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(415).json({ error: 'send the start of the picture' });
  res.json(inspectHead(req.body));
});
app.put('/api/modules/:id/uploads/:fid/thumb', rawUpload, (req, res) => {
  const ctx = uploadAccess(req, res, 'write');
  if (!ctx) return;
  const meta = moduleUploads.meta(ctx.manifest.id, ctx.scopeKey, req.params.fid);
  if (!meta) return res.status(404).json({ error: 'no such file' });
  if (meta.by !== ctx.by && ctx.who.user?.role !== 'admin') return res.status(403).json({ error: 'only the person who added it can do that' });
  if (!Buffer.isBuffer(req.body)) return res.status(415).json({ error: 'send the thumbnail itself, as a JPEG, PNG or WebP' });
  res.json({ file: uploadView(moduleUploads.putThumb(ctx.manifest.id, ctx.scopeKey, ctx.manifest.uploads, req.params.fid, req.body)) });
});
function sendUpload(req, res, thumb) {
  const ctx = uploadAccess(req, res, 'read');
  if (!ctx) return;
  const f = moduleUploads.read(ctx.manifest.id, ctx.scopeKey, req.params.fid, thumb);
  if (!f) return res.status(404).json({ error: 'no such file' });
  // A picture and nothing else, whatever it claims to be, and never run as a page; kept private to the person and their browser.
  res.set({ 'Content-Type': f.type, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Cache-Control': 'private, max-age=3600' }).send(f.bytes);
}
app.get('/api/modules/:id/uploads/:fid', (req, res) => sendUpload(req, res, false));
app.get('/api/modules/:id/uploads/:fid/thumb', (req, res) => sendUpload(req, res, true));
app.delete('/api/modules/:id/uploads/:fid', (req, res) => {
  const ctx = uploadAccess(req, res, 'write');
  if (!ctx) return;
  const meta = moduleUploads.meta(ctx.manifest.id, ctx.scopeKey, req.params.fid);
  if (!meta) return res.status(404).json({ error: 'no such file' });
  // The person who added a file, or an administrator, removes it. (A module decides who may remove its items; this is the guard on the bytes.)
  if (meta.by !== ctx.by && ctx.who.user?.role !== 'admin') return res.status(403).json({ error: 'only the person who added it can remove it' });
  moduleUploads.remove(ctx.manifest.id, ctx.scopeKey, req.params.fid);
  res.json({ ok: true });
});

// --- place search, from the server -----------------------------------------------------------------------------------------
// A module that declares `geocoder` in its manifest has its searches for places answered here: from the saved places first, then
// (when there are too few) from the service its settings name, keeping what comes back if the admin allows it. See geocode.js.
function geocodeAccess(req, res, need) {
  const ctx = moduleAccess(req, res, need);
  if (!ctx) return null;
  if (!ctx.manifest.geocoder) { res.status(404).json({ error: 'this module has no place search' }); return null; }
  return ctx;
}
// Where this module's search goes now: { name, address, credit } or null when none is chosen.
function geocodeSetup(manifest) {
  const g = manifest.geocoder;
  const values = moduleSettings.values(manifest, 'server', {});
  const chosen = values[g.provider];
  const known = g.providers[chosen];
  if (known) return { name: known.name, address: known.address, credit: known.credit, save: g.save ? values[g.save] === true : false };
  if (chosen === g.custom && typeof values[g.address] === 'string' && /^https?:\/\//i.test(values[g.address])) return { name: 'the search service', address: values[g.address], credit: '', save: g.save ? values[g.save] === true : false };
  return null;
}
app.get('/api/modules/:id/geocode', async (req, res) => {
  const ctx = geocodeAccess(req, res, 'read');
  if (!ctx) return;
  const q = String(req.query.q || '').trim().slice(0, 200);
  if (q.length < 2) return res.json({ results: [], configured: true });
  const setup = geocodeSetup(ctx.manifest);
  if (!setup) return res.json({ results: [], configured: false });
  if (overLimit(ctx.manifest.id, ctx.who.user?.key, 'search')) return res.status(429).json({ error: limitMessage });
  const near = req.query.lat !== undefined ? { lat: Number(req.query.lat), lon: Number(req.query.lon) } : null;
  const id = ctx.manifest.id;
  const pick = (r, source, from) => ({ key: r.key, title: r.name, sub: r.address, lat: r.lat, lng: r.lng, source, from });
  // Saved places first: enough of them and the outside service is not asked.
  const saved = setup.save ? geocodeCache.search(id, q, near, 10).map((r) => pick(r, 'server', 'Saved on this server')) : [];
  if (saved.length >= ENOUGH) return res.json({ results: saved.slice(0, 8), configured: true, credit: setup.credit });
  try {
    const found = await askService(setup.address, q, near);
    const kept = setup.save ? geocodeCache.remember(id, found) : found.map((p) => ({ ...p, key: keyOfPlace(p) }));
    const fromService = kept.map((r) => pick(r, 'service', `From ${setup.name}`));
    const seen = new Set(saved.map((r) => r.key));
    res.json({ results: [...saved, ...fromService.filter((r) => !seen.has(r.key))].slice(0, 8), configured: true, credit: setup.credit });
  } catch (err) {
    if (saved.length) return res.json({ results: saved, configured: true, credit: setup.credit });
    res.status(502).json({ error: 'search is not available right now' });
  }
});
// Someone picked a result (or saved it as a place): mark it used, which protects it from being purged.
app.post('/api/modules/:id/geocode/use', (req, res) => {
  const ctx = geocodeAccess(req, res, 'write');
  if (!ctx) return;
  res.json({ ok: geocodeCache.markUsed(ctx.manifest.id, String(req.body?.key || '')) });
});
// For the admin: how many places are saved, and removing them by their mark.
app.get('/api/modules/:id/geocode/stats', requireAdmin, (req, res) => {
  const found = modules.enabled(req.params.id);
  if (!found || !found.manifest.geocoder) return res.status(404).json({ error: 'no such place search' });
  res.json(geocodeCache.stats(found.manifest.id));
});
app.post('/api/modules/:id/geocode/purge', requireAdmin, (req, res) => {
  const found = modules.enabled(req.params.id);
  if (!found || !found.manifest.geocoder) return res.status(404).json({ error: 'no such place search' });
  const what = req.body?.what === 'all' ? 'all' : req.body?.what === 'unused' ? 'unused' : null;
  if (!what) return res.status(400).json({ error: 'say what to remove: unused or all' });
  const days = Number(req.body?.olderThanDays);
  res.json({ removed: geocodeCache.purge(found.manifest.id, what, Number.isFinite(days) && days > 0 ? days : 0), ...geocodeCache.stats(found.manifest.id) });
});
// --- cutting a region out of a larger PMTiles file, from the server -----------------------------------------------------------
// A module that declares `regionSource` (see server/region-cut.js and documentation/plans/plan-map-region-download.md) offers
// "Add a region" in its Module Configuration: cut a piece of a world file into one of its own file folders. Admin only, since
// it can take a while and reads a server setting (the world file's address).
function sendRegionCutError(err, res) {
  if (err instanceof RegionCutError) return res.status(err.status).json({ error: err.message });
  throw err;
}
// Where this module's world file is, from its own settings: { address, folder }, or null when nothing is set up.
function regionSourceOf(manifest) {
  const r = manifest.regionSource;
  if (!r) return null;
  const address = moduleSettings.values(manifest, 'server', {})[r.address];
  return typeof address === 'string' && address ? { address, folder: r.folder } : null;
}
function regionCutSetup(req, res) {
  const found = modules.enabled(req.params.id);
  if (!found) { res.status(404).json({ error: 'no such module' }); return null; }
  const setup = regionSourceOf(found.manifest);
  if (!setup) { res.status(404).json({ error: 'this module has no world file set up to cut from' }); return null; }
  return { manifest: found.manifest, setup };
}
const boxFromBody = (b) => ({ minLon: Number(b?.minLon), minLat: Number(b?.minLat), maxLon: Number(b?.maxLon), maxLat: Number(b?.maxLat) });
// A place's rough rectangle, from whichever enabled module has a place search configured (never named here: found the same
// way any other generic conduit is, by what a module declares, not by which one it happens to be). Places is the one that
// offers this today; anything with a `geocoder` in its manifest would be found the same way.
// Returns null when no enabled module has a configured search, otherwise `{ name, box }` (box null when nothing matched).
async function findRegionBox(q) {
  for (const { manifest } of modules.enabledAll()) {
    if (!manifest.geocoder) continue;
    const setup = geocodeSetup(manifest);
    if (!setup) continue;
    const found = await askService(setup.address, q, null);
    const best = found.find((p) => p.extent);
    return best ? { name: best.name, box: best.extent } : { name: null, box: null };
  }
  return null;
}
// "Add a region": type a place's name, get back its rough rectangle to cut, before anything is fetched for real.
app.get('/api/modules/:id/region-cut/find', requireAdmin, async (req, res) => {
  const ctx = regionCutSetup(req, res);
  if (!ctx) return;
  const q = String(req.query.q || '').trim().slice(0, 200);
  if (q.length < 2) return res.status(400).json({ error: 'type a place name first' });
  try {
    const found = await findRegionBox(q);
    if (found === null) return res.status(404).json({ error: 'no place search is set up on this server (a module with one, such as Places, names where to look)' });
    res.json(found.box ? { found: true, name: found.name, box: found.box } : { found: false });
  } catch (err) {
    res.status(502).json({ error: 'search is not available right now' });
  }
});
// How big a cut would be, without downloading it: the admin confirms before "Add a region" commits to anything.
app.post('/api/modules/:id/region-cut/estimate', requireAdmin, async (req, res) => {
  const ctx = regionCutSetup(req, res);
  if (!ctx) return;
  try {
    res.json(await regionCutJobs.estimate({ source: ctx.setup.address, box: boxFromBody(req.body), maxZoom: Number(req.body?.maxZoom), minZoom: req.body?.minZoom !== undefined ? Number(req.body.minZoom) : undefined }));
  } catch (err) {
    sendRegionCutError(err, res);
  }
});
// Start the real cut; the job runs in the background, followed over the stream route below.
app.post('/api/modules/:id/region-cut', requireAdmin, async (req, res) => {
  const ctx = regionCutSetup(req, res);
  if (!ctx) return;
  try {
    const out = await regionCutJobs.start({
      moduleId: ctx.manifest.id,
      scopeKey: 'server',
      source: ctx.setup.address,
      folder: ctx.setup.folder,
      name: String(req.body?.name || ''),
      box: boxFromBody(req.body),
      minZoom: req.body?.minZoom !== undefined ? Number(req.body.minZoom) : undefined,
      maxZoom: Number(req.body?.maxZoom),
      by: currentUser(req)?.key,
    });
    res.status(202).json(out);
  } catch (err) {
    sendRegionCutError(err, res);
  }
});
// Progress, in words and a percentage, over server-sent events; a late subscriber gets the job's current state first, and
// one already finished (or one Tavern has never heard of) is told so at once rather than hanging.
app.get('/api/modules/:id/region-cut/:jobId/stream', requireAdmin, (req, res) => {
  const env = currentEnvironment(); // captured once: the close handler below fires later, outside this request
  const found = modules.enabled(req.params.id);
  if (!found || !found.manifest.regionSource) return res.status(404).json({ error: 'no such module' });
  const job = regionCutJobs.view(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'that cut is not running (it may have finished a while ago)' });
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  res.write(`event: progress\ndata: ${JSON.stringify({ percent: job.percent, message: job.message })}\n\n`);
  if (job.status !== 'running') {
    res.write(`event: ${job.status}\ndata: ${JSON.stringify(job.status === 'done' ? { name: job.name } : { error: job.error })}\n\n`);
    return res.end();
  }
  const { jobId } = req.params;
  const cleanup = () => { regionCutJobs.off('progress', onProgress); regionCutJobs.off('done', onDone); regionCutJobs.off('error', onErr); };
  const onProgress = (id, p) => { if (id === jobId) res.write(`event: progress\ndata: ${JSON.stringify(p)}\n\n`); };
  const onDone = (id, d) => { if (id !== jobId) return; res.write(`event: done\ndata: ${JSON.stringify(d)}\n\n`); cleanup(); res.end(); };
  const onErr = (id, error) => { if (id !== jobId) return; res.write(`event: error\ndata: ${JSON.stringify({ error })}\n\n`); cleanup(); res.end(); };
  regionCutJobs.on('progress', onProgress);
  regionCutJobs.on('done', onDone);
  regionCutJobs.on('error', onErr);
  req.on('close', () => envContext.run(env, cleanup));
});
// A settings change -> a line in the activity list: wired per environment in server/environment.js, on that
// environment's own real moduleSettings (this used to be one top-level listener; now it's one per environment).
function sendSettingError(err, res) {
  if (err instanceof SettingError) return res.status(err.status).json({ error: err.message });
  throw err;
}

// --- files an admin placed for a module ---------------------------------------------------------------------
// Some modules need a large file that cannot be uploaded through a page (a map's tile archive, gigabytes): the operator
// copies it into the folder the module's `file` setting names inside its own folder (DATA_DIR/modules/<module id>/<folder>/), the admin picks it in the module's settings, and the module reads
// it here, by range, like any static file. Nothing else in that folder is reachable, and only by name.
// Where a module's files live: a folder of its own inside its folder in the data folder, named by the `file` setting's `folder`
// in its manifest (DATA_DIR/modules/<id>/<folder>/). Uninstalling and updating never touch it.
const moduleFilesDir = (id, folder) => path.resolve(DATA_DIR, 'modules', id, folder);
const FILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
// What is in a module's folder: the usable files, and each thing skipped with the reason, so an admin whose file does not
// show up is told why. A link to a file (a NAS shortcut) counts as the file.
function inspectModuleFiles(id, sub) {
  const folder = moduleFilesDir(id, sub);
  const out = { folder, exists: false, files: [], sizes: {}, zooms: {}, skipped: [] };
  let names;
  try {
    names = fs.readdirSync(folder);
    out.exists = true;
  } catch {
    return out;
  }
  for (const name of names.sort()) {
    if (!FILE_NAME_RE.test(name)) {
      out.skipped.push({ name: name.slice(0, 100), reason: 'a name may use letters, digits, dot, dash and underscore, and must start with a letter or digit, up to 100 characters' });
      continue;
    }
    let st = null;
    try { st = fs.statSync(path.join(folder, name)); } catch { /* a broken link */ }
    if (st && st.isFile()) {
      out.files.push(name);
      out.sizes[name] = st.size;
      // How detailed a map file is (street-level or not), read from its own header -- the file's own truth, so this
      // works whether it was cut with "Add a region" or dropped in by hand.
      if (/\.pmtiles$/i.test(name)) {
        const z = pmtilesZoomRange(path.join(folder, name));
        if (z) out.zooms[name] = z;
      }
    } else out.skipped.push({ name, reason: st ? 'not a regular file (a folder or something else)' : 'a link that leads nowhere' });
  }
  return out;
}
const listModuleFiles = (id, sub) => inspectModuleFiles(id, sub).files;
// The path of a file a module's file settings can name, or null.
const moduleFilePath = (manifest, name) => {
  if (!FILE_NAME_RE.test(name)) return null;
  for (const d of manifest.settings || []) if ((d.type === 'file' || d.type === 'files') && listModuleFiles(manifest.id, d.folder).includes(name)) return path.join(moduleFilesDir(manifest.id, d.folder), name);
  return null;
};
// The same, in words, for the log and for the picker.
function describeModuleFiles(id, sub) {
  const f = inspectModuleFiles(id, sub);
  if (!f.exists) return `${f.folder} does not exist yet`;
  const skipped = f.skipped.map((s) => `${s.name} (${s.reason})`).join('; ');
  return `${f.folder} has ${f.files.length} usable file${f.files.length === 1 ? '' : 's'}${f.files.length ? ': ' + f.files.join(', ') : ''}${f.skipped.length ? `; Tavern ignored ${f.skipped.length}: ${skipped}` : ''}`;
}
// A file for a module page, with range requests (what a map archive is read with). Needs the same access as reading
// the module's data in that place.
app.get('/api/modules/:id/files/:name', (req, res) => {
  const ctx = moduleAccess(req, res, 'read');
  if (!ctx) return;
  const name = req.params.name;
  const file = moduleFilePath(ctx.manifest, name);
  if (!file) return res.status(404).json({ error: 'no such file' });
  res.sendFile(file, { acceptRanges: true, headers: { 'Cache-Control': 'private, max-age=3600', 'Content-Type': 'application/octet-stream' } });
});
// Remove a file an admin placed for the module (a `file`/`files` setting) -- gone for good, so admin only. Also
// un-ticks it from any `files` setting that had it, and clears a `file` setting that pointed to it, so nothing on
// the module's own settings keeps naming a file that is no longer there.
app.delete('/api/modules/:id/files/:name', requireAdmin, (req, res) => {
  const found = modules.enabled(req.params.id);
  if (!found) return res.status(404).json({ error: 'no such module' });
  const name = req.params.name;
  const file = moduleFilePath(found.manifest, name);
  if (!file) return res.status(404).json({ error: 'no such file' });
  try {
    fs.unlinkSync(file);
  } catch (err) {
    return res.status(500).json({ error: `the file could not be removed: ${err.message}` });
  }
  const by = currentUser(req)?.key || null;
  const values = moduleSettings.values(found.manifest, 'server', {});
  for (const d of found.manifest.settings || []) {
    if (d.type === 'files' && Array.isArray(values[d.key]) && values[d.key].includes(name)) {
      moduleSettings.set(found.manifest, 'server', {}, { [d.key]: values[d.key].filter((n) => n !== name) }, by);
    } else if (d.type === 'file' && values[d.key] === name) {
      moduleSettings.set(found.manifest, 'server', {}, { [d.key]: '' }, by);
    }
  }
  res.json({ ok: true });
});

// The values that apply to the viewer, for the module itself.
app.get('/api/modules/:id/settings/values', (req, res) => {
  const ctx = moduleAccess(req, res, 'read');
  if (!ctx) return;
  res.json({ values: moduleSettings.effective(ctx.manifest, { roomId: ctx.roomId, userKey: ctx.who.user?.key || null }) });
});

// Who may change the settings of a scope, and where they are kept; sends the error itself and returns null when not.
function settingsPlace(req, res, scope) {
  const user = currentUser(req);
  if (!user) return void res.status(401).json({ error: 'sign in first' });
  if (scope === 'server') {
    if (user.role !== 'admin') return void res.status(403).json({ error: 'only an admin changes the server\'s settings' });
    return { user, ctx: {} };
  }
  if (scope === 'person') return { user, ctx: { userKey: user.key } };
  if (scope === 'room') {
    const room = store.roomById(String(req.query.room || req.body?.room || ''));
    if (!room) return void res.status(404).json({ error: 'no such room' });
    // A moderator is a member ticked as one in that room (an admin ticks it on the member's profile).
    if (!(user.role === 'admin' || (room.members.includes(user.key) && store.roomFlags(user.key, room.id).moderator))) return void res.status(403).json({ error: 'only an admin or the room\'s moderators change its settings' });
    return { user, ctx: { roomId: room.id }, room };
  }
  return void res.status(404).json({ error: 'no such kind of setting' });
}
const withValues = (manifest, scope, ctx) => {
  const values = moduleSettings.values(manifest, scope, ctx);
  return manifest.settings.filter((d) => d.scope === scope).map((d) => ({ ...d, value: values[d.key], ...(d.type === 'file' || d.type === 'files' ? (({ files, ...rest }) => ({ available: files, ...rest }))(inspectModuleFiles(manifest.id, d.folder)) : {}) }));
};

// The modules that have settings of a scope here, each with its settings and their values.
app.get('/api/module-settings/:scope', (req, res) => {
  const place = settingsPlace(req, res, req.params.scope);
  if (!place) return;
  const scope = req.params.scope;
  const out = modules.enabledAll()
    .filter(({ manifest, entry }) => manifest.settings.some((d) => d.scope === scope) && (scope !== 'room' || entry.allRooms || entry.rooms.includes(place.room.id)))
    .map(({ manifest }) => ({ id: manifest.id, name: manifest.name, icon: manifest.icon, settings: withValues(manifest, scope, place.ctx) }));
  res.json({ modules: out });
});
app.put('/api/modules/:id/settings/:scope', (req, res) => {
  const place = settingsPlace(req, res, req.params.scope);
  if (!place) return;
  const found = modules.enabled(req.params.id);
  if (!found) return res.status(404).json({ error: 'no such module' });
  try {
    for (const [key, v] of Object.entries(req.body?.values || {})) {
      const def = found.manifest.settings.find((d) => d.key === key);
      if (def && def.type === 'files' && Array.isArray(v)) { const have = listModuleFiles(found.manifest.id, def.folder); const gone = v.find((n) => !have.includes(n)); if (gone) throw new SettingError(`${def.label}: there is no file called ${gone} for this module`); }
      if (def && def.type === 'file' && v && !listModuleFiles(found.manifest.id, def.folder).includes(v)) throw new SettingError(`${def.label}: there is no file called ${v} for this module`);
    }
    moduleSettings.set(found.manifest, req.params.scope, place.ctx, req.body?.values, place.user.key);
    res.json({ settings: withValues(found.manifest, req.params.scope, place.ctx) });
  } catch (err) {
    sendSettingError(err, res);
  }
});

// Who is looking and what they may do in this module, for the frame's hello.
app.get('/api/modules/:id/context', (req, res) => {
  const ctx = moduleAccess(req, res, 'read');
  if (!ctx) return;
  const { manifest, perms, who } = ctx;
  res.json({
    user: who.user ? { key: who.user.key, name: who.user.displayName, role: who.user.role } : { key: 'guest', name: 'Guest', role: 'guest' },
    permissions: Object.fromEntries(manifest.permissions.map((p) => [p.key, Boolean(perms[`module.${manifest.id}.${p.key}`])])),
    module: { id: manifest.id, name: manifest.name, version: manifest.version, icon: manifest.icon },
    // How the server shows language, time and money (Manage > Settings), for every module to follow.
    locale: { language: store.settings.language || 'en', clock: store.settings.clock === '24' ? '24' : '12', currency: store.settings.currency || 'USD' },
  });
});

// Modules with a panel in one room, for the call's Modules button.
app.get('/api/modules/for-room', (req, res) => {
  const who = moduleViewer(req);
  if (!who) return res.status(401).json({ error: 'sign in first' });
  const room = store.roomById(String(req.query.room || ''));
  if (!room) return res.status(404).json({ error: 'no such room' });
  const perms = modulePerms(who, room.id);
  res.json({
    modules: modules.enabledAll()
      .filter(({ manifest, entry }) => manifest.scope.includes('room') && manifest.surfaces.panel && moduleRoomAccess(entry, who, room) && moduleCan(manifest, perms, 'read'))
      .map(({ manifest, entry }) => ({ id: manifest.id, name: manifest.name, icon: manifest.icon, version: manifest.version, scope: manifest.scope, runMode: modules.runModeOf(entry), panel: manifest.surfaces.panel, permissions: manifest.permissions.map((p) => `module.${manifest.id}.${p.key}`).filter((k) => perms[k]) })),
  });
});

// One module's own page, for its full-width server page: the shell page
// (public/module.html) reads the module id from the address.
// A room panel popped out into its own window opens the same page with the
// room in the query (and a guest's link token, if that is who is looking).
app.get('/modules/:id', (req, res) => {
  if (!currentUser(req) && !hasGuestAccess(req)) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  res.sendFile(page('module.html'));
});

// The module's own files. Sandboxed by header, so even opened directly they
// run with no access to Tavern's pages or cookies, and can only load their own files.
app.get('/m/:id/:version/*path', (req, res) => {
  const rel = [].concat(req.params.path).join('/');
  const file = modules.resolveFile(req.params.id, req.params.version, rel);
  if (!file) return res.status(404).end();
  // A module that runs in the page (not in a frame) is loaded in parts: its styles, its markup and its
  // script, taken from its single HTML file, each for the page to place in the module's own container.
  const part = req.query.part;
  if (part === 'css' || part === 'body' || part === 'js') {
    const found = modules.enabled(req.params.id);
    if (!found || modules.runModeOf(found.entry) !== 'page' || !/\.html?$/i.test(file)) return res.status(403).json({ error: 'that module does not run in the page' });
    const html = fs.readFileSync(file, 'utf8');
    const grab = (re) => [...html.matchAll(re)].map((m) => m[1]).join('\n');
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
    if (part === 'css') return res.type('text/css').send(grab(/<style\b[^>]*>([\s\S]*?)<\/style>/gi));
    if (part === 'js') return res.type('application/javascript').send(grab(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi));
    const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html);
    return res.type('text/html').send((body ? body[1] : html).replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, ''));
  }
  res.set({
    'Content-Security-Policy': "sandbox allow-scripts allow-forms; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
    'X-Content-Type-Options': 'nosniff',
    // A sandboxed frame has an opaque origin, so its own scripts and fonts load as cross-origin.
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Cache-Control': 'no-cache',
  });
  if (!/\.html?$/i.test(file)) return res.sendFile(file, { dotfiles: 'deny' });
  // A module's HTML pages get the SDK and the base styles inline, so a module
  // needs no <script> or <link> for them (and works even where a sandboxed
  // frame is not allowed to load its own subresources). A page that already
  // includes /sdk/host.js keeps what it has; <meta name="sdk-base"
  // content="none"> leaves the base styles out.
  let html = fs.readFileSync(file, 'utf8');
  if (!html.includes('/sdk/host.js')) {
    const sdk = fs.readFileSync(path.join(publicDir, 'sdk', 'host.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
    const css = /<meta[^>]+name=["']sdk-base["'][^>]+content=["']none["']/i.test(html) ? '' : fs.readFileSync(path.join(publicDir, 'sdk', 'host.css'), 'utf8');
    const inject = `${css ? `<style id="sdk-base">${css}</style>` : ''}<script id="sdk-script">${sdk}</script>`;
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + inject) : inject + html;
  }
  res.type('html').send(html);
});

app.get('/api/modules/:id/data', (req, res) => {
  const ctx = moduleAccess(req, res, 'read');
  if (!ctx) return;
  res.json({ items: moduleData.list(ctx.manifest.id, ctx.scopeKey, typeof req.query.prefix === 'string' ? req.query.prefix : '') });
});
app.get('/api/modules/:id/data/:key', (req, res) => {
  const ctx = moduleAccess(req, res, 'read');
  if (!ctx) return;
  const item = moduleData.get(ctx.manifest.id, ctx.scopeKey, req.params.key);
  if (!item) return res.status(404).json({ error: 'not found' });
  res.json({ item });
});
function sendModuleConflict(err, res) {
  if (err.status === 409) return res.status(409).json({ error: err.message, current: err.current || null });
  throw err;
}
app.put('/api/modules/:id/data/:key', (req, res) => {
  const ctx = moduleAccess(req, res, 'write');
  if (!ctx) return;
  const slow = overLimit(ctx.manifest.id, ctx.by, 'write');
  if (slow) return void res.set('Retry-After', String(slow.retrySeconds)).status(429).json({ error: limitMessage });
  try {
    res.json({ item: moduleData.put(ctx.manifest.id, ctx.scopeKey, req.params.key, req.body?.value, { expected: Number.isInteger(req.body?.version) ? req.body.version : null, by: ctx.by }) });
  } catch (err) {
    sendModuleConflict(err, res);
  }
});
app.delete('/api/modules/:id/data/:key', (req, res) => {
  const ctx = moduleAccess(req, res, 'write');
  if (!ctx) return;
  const slow = overLimit(ctx.manifest.id, ctx.by, 'write');
  if (slow) return void res.set('Retry-After', String(slow.retrySeconds)).status(429).json({ error: limitMessage });
  try {
    const expected = req.query.version !== undefined ? Number(req.query.version) : null;
    res.json(moduleData.remove(ctx.manifest.id, ctx.scopeKey, req.params.key, { expected: Number.isInteger(expected) ? expected : null, by: ctx.by }));
  } catch (err) {
    sendModuleConflict(err, res);
  }
});

// Live changes to one module's data in one scope, pushed as server-sent events.
// The page hosting the module's frame listens and forwards them into the frame.
// Hooks: schedule something for later, or tell people now. The module must
// have declared the hook in its manifest (enabling it approved that).
function requireHook(ctx, res, hook) {
  if (ctx.manifest.hooks[hook]) return true;
  res.status(403).json({ error: `this module did not ask for the ${hook} hook` });
  return false;
}
function sendHookError(err, res) {
  if (err instanceof StoreError) return res.status(err.status).json({ error: err.message });
  throw err;
}
app.post('/api/modules/:id/schedule', (req, res) => {
  const ctx = moduleAccess(req, res, 'write');
  if (!ctx || !requireHook(ctx, res, 'schedule')) return;
  const slow = overLimit(ctx.manifest.id, ctx.by, 'schedule');
  if (slow) return void res.set('Retry-After', String(slow.retrySeconds)).status(429).json({ error: limitMessage });
  try {
    res.json(moduleHooks.schedule(ctx, req.body || {}));
  } catch (err) {
    sendHookError(err, res);
  }
});
app.delete('/api/modules/:id/schedule/:key', (req, res) => {
  const ctx = moduleAccess(req, res, 'write');
  if (!ctx || !requireHook(ctx, res, 'schedule')) return;
  res.json(moduleHooks.cancel(ctx, req.params.key));
});
app.post('/api/modules/:id/notify', (req, res) => {
  const ctx = moduleAccess(req, res, 'write');
  if (!ctx || !requireHook(ctx, res, 'notify')) return;
  const slow = overLimit(ctx.manifest.id, ctx.by, 'notify');
  if (slow) return void res.set('Retry-After', String(slow.retrySeconds)).status(429).json({ error: limitMessage });
  try {
    const to = typeof req.body?.to === 'string' ? req.body.to : ctx.scope === 'room' ? 'room' : 'server';
    res.json({ delivered: moduleHooks.deliver({ module: ctx.manifest.id, scopeKey: ctx.scopeKey, roomId: ctx.roomId }, { ...req.body, to }, { by: ctx.by }) });
  } catch (err) {
    sendHookError(err, res);
  }
});

// A signed-in person's own notifications: the list, marking them read, and a
// live stream so a toast can appear the moment one arrives.
app.get('/api/notifications', requireUser, (req, res) => {
  const list = moduleHooks.list(currentUser(req).key).filter((n) => modules.enabled(n.module));
  const byModule = {};
  for (const n of list) if (!n.read) byModule[n.module] = (byModule[n.module] || 0) + 1;
  res.json({ notifications: list, byModule, unread: Object.values(byModule).reduce((a, b) => a + b, 0) });
});
app.post('/api/notifications/read', requireUser, (req, res) => {
  moduleHooks.markRead(currentUser(req).key, { module: typeof req.body?.module === 'string' ? req.body.module : null, id: typeof req.body?.id === 'string' ? req.body.id : null });
  res.json({ ok: true });
});
app.get('/api/notifications/stream', requireUser, (req, res) => {
  const env = currentEnvironment(); // captured once: the close handler below fires later, outside this request
  const key = currentUser(req).key;
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  const onNote = ({ userKey, notification }) => {
    if (userKey !== key || !modules.enabled(notification.module)) return;
    const { manifest } = modules.enabled(notification.module);
    res.write(`event: notification\ndata: ${JSON.stringify({ ...notification, moduleName: manifest.name, icon: manifest.icon })}\n\n`);
  };
  moduleHooks.on('notification', onNote);
  const onInvite = (invite) => {
    if (invite.to !== key || Date.now() - invite.at > INVITE_MS) return;
    res.write(`event: invite\ndata: ${JSON.stringify({ id: invite.id, roomId: invite.roomId, fromName: invite.fromName })}\n\n`);
  };
  inviteEvents.on('invite', onInvite);
  const beat = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => envContext.run(env, () => {
    clearInterval(beat);
    moduleHooks.off('notification', onNote);
    inviteEvents.off('invite', onInvite);
  }));
});

// One live stream for every module on a page. A browser allows only a handful of long-lived
// connections to one site (six over HTTP/1.1), and a stream per module (two for a room panel) used
// up all of them with three modules open, so nothing else could load. This carries every module's
// changes and fired schedules, each labelled with its module and where it happened, and filtered
// to what the viewer may read:
//   with ?room=<id>   scope 'room' (that room) and 'server'   -- a room's panes
//   without a room    scope 'server' and 'rooms' (the viewer's own rooms) -- a module's server page
app.get('/api/modules/stream', (req, res) => {
  const env = currentEnvironment(); // captured once: the close handler below fires later, outside this request
  const who = moduleViewer(req);
  if (!who) return res.status(401).json({ error: 'sign in first' });
  const room = req.query.room ? store.roomById(String(req.query.room)) : null;
  if (req.query.room && !room) return res.status(404).json({ error: 'no such room' });
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  // Where a change belongs for this viewer, or null if they may not see it.
  const place = (moduleId, scopeKey) => {
    const found = modules.enabled(moduleId);
    if (!found) return null;
    const { manifest, entry } = found;
    if (scopeKey === 'server') {
      return who.user && moduleCan(manifest, modulePerms(who, null), 'read') ? { scope: 'server', roomId: null } : null;
    }
    if (scopeKey.startsWith('person:')) {
      // Someone's own data: told only to that person, on whatever page of theirs shows the module.
      return who.user && scopeKey === `person:${who.user.key}` && moduleCan(manifest, modulePerms(who, null), 'read') ? { scope: 'person', roomId: null } : null;
    }
    if (!scopeKey.startsWith('room:')) return null;
    const r = store.roomById(scopeKey.slice(5));
    if (!r) return null;
    if (room) {
      return r.id === room.id && moduleRoomAccess(entry, who, r) && moduleCan(manifest, modulePerms(who, r.id), 'read') ? { scope: 'room', roomId: r.id } : null;
    }
    const mine = who.user && !r.ephemeral && r.members.includes(who.user.key) && (entry.allRooms || entry.rooms.includes(r.id));
    return mine && moduleCan(manifest, modulePerms(who, r.id), 'read') ? { scope: 'rooms', roomId: r.id } : null;
  };
  const onChange = (change) => {
    const at = place(change.module, change.scopeKey);
    if (at) res.write(`event: change\ndata: ${JSON.stringify({ ...change, ...at })}\n\n`);
  };
  const onFire = (fire) => {
    const at = place(fire.module, fire.scopeKey);
    if (at && at.scope !== 'rooms') res.write(`event: schedule\ndata: ${JSON.stringify({ module: fire.module, key: fire.key, payload: fire.payload, ...at })}\n\n`);
  };
  // What points at (or from) an item changed: only the pointers go, and the module asks again for what it may see.
  const onLinks = ({ refs }) => {
    for (const ref of refs) {
      const at = place(ref.module, refScopeKey(ref));
      if (at) res.write(`event: links\ndata: ${JSON.stringify({ module: ref.module, ref, ...at })}\n\n`);
    }
  };
  // A module said something happened: sent to every module here that may hear it (the host delivers it to those frames).
  const onBus = (ev) => {
    const at = place(ev.module, ev.scopeKey);
    if (!at) return;
    const subscribers = modules.enabledAll().filter((m) => m.manifest.id !== ev.module && mayHear(m, ev.module, ev.name) && place(m.manifest.id, ev.scopeKey)).map((m) => m.manifest.id);
    if (subscribers.length) res.write(`event: bus\ndata: ${JSON.stringify({ ...publicEvent(ev), scope: at.scope, subscribers })}\n\n`);
  };
  // A request for a module to do something: the providing module's frames are told; one claims it.
  const onAction = (r) => {
    if (r.local && r.by !== (who.user?.key || 'guest')) return; // a view is for the person who asked
    const at = place(r.provider, r.scopeKey);
    if (at) res.write(`event: action\ndata: ${JSON.stringify({ ...publicAction(r), provider: r.provider, scope: at.scope })}\n\n`);
  };
  // A setting of a module changed: its pages here read their values again.
  const onSettings = (c) => {
    if (c.scope === 'person' && c.userKey !== who.user?.key) return;
    if (c.scope === 'room' && !(room && room.id === c.roomId) && !(who.user && store.roomById(c.roomId)?.members.includes(who.user.key))) return;
    res.write(`event: settings\ndata: ${JSON.stringify({ module: c.module, scope: c.scope, roomId: c.roomId })}\n\n`);
  };
  moduleSettings.on('change', onSettings);
  moduleData.on('change', onChange);
  moduleHooks.on('fire', onFire);
  moduleLinks.on('change', onLinks);
  moduleBus.on('event', onBus);
  moduleBus.on('action', onAction);
  const beat = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => envContext.run(env, () => {
    clearInterval(beat);
    moduleSettings.off('change', onSettings);
    moduleData.off('change', onChange);
    moduleHooks.off('fire', onFire);
    moduleLinks.off('change', onLinks);
    moduleBus.off('event', onBus);
    moduleBus.off('action', onAction);
  }));
});

app.get('/api/modules/:id/events', (req, res) => {
  const env = currentEnvironment(); // captured once: the close handler below fires later, outside this request
  // scope=rooms: changes in any of the viewer's rooms (a module's page showing them all).
  const all = req.query.scope === 'rooms' ? moduleRoomsFor(req, res) : null;
  if (req.query.scope === 'rooms' && !all) return;
  const ctx = all ? { manifest: all.manifest, scopeKey: null } : moduleAccess(req, res, 'read');
  if (!ctx) return;
  const roomIds = all ? new Set(all.rooms.map((r) => r.id)) : null;
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  const onChange = (change) => {
    if (change.module !== ctx.manifest.id) return;
    if (roomIds) {
      const roomId = change.scopeKey.startsWith('room:') ? change.scopeKey.slice(5) : null;
      if (!roomIds.has(roomId)) return;
      return void res.write(`event: change\ndata: ${JSON.stringify({ ...change, roomId })}\n\n`);
    }
    if (change.scopeKey !== ctx.scopeKey) return;
    res.write(`event: change\ndata: ${JSON.stringify(change)}\n\n`);
  };
  const onFire = (fire) => {
    if (roomIds || fire.module !== ctx.manifest.id || fire.scopeKey !== ctx.scopeKey) return;
    res.write(`event: schedule\ndata: ${JSON.stringify({ key: fire.key, payload: fire.payload })}\n\n`);
  };
  moduleData.on('change', onChange);
  moduleHooks.on('fire', onFire);
  const beat = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => envContext.run(env, () => {
    clearInterval(beat);
    moduleData.off('change', onChange);
    moduleHooks.off('fire', onFire);
  }));
});

app.get('/api/roles', requireAdmin, (_req, res) => res.json({ permissions: store.allPermissions(), roles: store.roles() }));
app.patch('/api/roles/:role', requireAdmin, (req, res) => res.json({ roles: store.setRolePermissions(req.params.role, req.body || {}) }));

app.get('/api/settings', requireAdmin, (_req, res) => res.json({ settings: branding(), streamKey: store.streamKey }));
app.patch('/api/settings', requireAdmin, (req, res) => {
  store.updateSettings(req.body || {});
  res.json({ settings: branding() });
});
// Saved themes: named sets of the same seven colors /theme.css can render --
// switching just repoints activeThemeId (see PATCH /api/settings above),
// no re-picking needed. See store.js's "themes" section for the shape.
app.get('/api/themes', requireAdmin, (_req, res) => res.json({ themes: store.themes, activeThemeId: store.settings.activeThemeId || null }));
app.post('/api/themes', requireAdmin, (req, res) => res.json({ theme: store.addTheme(req.body || {}) }));
app.patch('/api/themes/:id', requireAdmin, (req, res) => res.json({ theme: store.updateTheme(req.params.id, req.body || {}) }));
app.delete('/api/themes/:id', requireAdmin, (req, res) => {
  store.removeTheme(req.params.id);
  res.json({ ok: true });
});
// Site images: icon, background.
const siteImage = (req, res, next) => (req.params.image === 'icon' || req.params.image === 'background' ? next() : res.status(404).json({ error: 'unknown image' }));
app.put('/api/settings/:image', requireAdmin, siteImage, rawImage, (req, res) => {
  store.setSiteImage(req.params.image, req.body, req.get('content-type'));
  res.json({ settings: branding() });
});
app.delete('/api/settings/:image', requireAdmin, siteImage, (req, res) => {
  store.removeSiteImage(req.params.image);
  res.json({ settings: branding() });
});
// Shared by both the guest and the default Participant picture sets below.
const participantImageSlot = (req, res, next) => (PARTICIPANT_SLOTS.includes(req.params.slot) ? next() : res.status(404).json({ error: 'unknown image slot' }));
app.put('/api/settings/guest-images/:slot', requireAdmin, participantImageSlot, rawImage, (req, res) => {
  store.setGuestImage(req.params.slot, req.body, req.get('content-type'));
  res.json({ ok: true });
});
app.delete('/api/settings/guest-images/:slot', requireAdmin, participantImageSlot, (req, res) => {
  store.removeGuestImage(req.params.slot);
  res.json({ ok: true });
});
// The server-wide Default Images set (see /img/default/:slot above).
app.put('/api/settings/default-images/:slot', requireAdmin, participantImageSlot, rawImage, (req, res) => {
  store.setDefaultImage(req.params.slot, req.body, req.get('content-type'));
  res.json({ ok: true });
});
app.delete('/api/settings/default-images/:slot', requireAdmin, participantImageSlot, (req, res) => {
  store.removeDefaultImage(req.params.slot);
  res.json({ ok: true });
});
app.post('/api/stream-key/regenerate', requireAdmin, (_req, res) => {
  res.json({ streamKey: store.regenerateStreamKey() });
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Errors ---------------------------------------------------------------------

app.use((err, _req, res, _next) => {
  if (err instanceof StoreError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.too.large') {
    if (/^\/api\/modules\/[^/]+\/uploads/.test(_req.path)) return res.status(413).json({ error: 'that file is over the size limit' });
    const limit = _req.path.startsWith('/api/modules') ? MODULE_LIMITS.zipBytes : MAX_IMAGE_BYTES;
    return res.status(413).json({ error: `${_req.path.startsWith('/api/modules') ? 'the zip' : 'image'} is larger than ${limit / (1024 * 1024)} MB` });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad JSON' });
  console.error(err);
  res.status(500).json({ error: 'server error' });
});

app.listen(Number(PORT), () => {
  if (!BASE_DOMAIN) {
    envContext.run(environmentFor(DEFAULT_SLUG), () => {
      console.log(`${store.settings.serverName} ${VERSION} listening on :${PORT}, LiveKit at ${LIVEKIT_HOST}, data in ${DATA_DIR}`);
      // A module that takes a file the operator supplies: say where Tavern looks and what it found, once.
      for (const m of modules.list()) for (const d of m.settings || []) if (d.type === 'file' || d.type === 'files') console.log(`${m.name}: looks for "${d.label}" in ${describeModuleFiles(m.id, d.folder)}`);
      if (fs.existsSync(path.join(DATA_DIR, 'module-files'))) console.warn(`Note: ${path.join(DATA_DIR, 'module-files')} is no longer used. A module's files belong in its own folder, DATA_DIR/modules/<module id>/<folder>/ (see the module's settings).`);
    });
    return;
  }
  console.log(`Coffee Pub Tavern ${VERSION} listening on :${PORT}, LiveKit at ${LIVEKIT_HOST}, base domain ${BASE_DOMAIN}, ${environments.size} environment${environments.size === 1 ? '' : 's'}, host console at admin.${BASE_DOMAIN}`);
});
