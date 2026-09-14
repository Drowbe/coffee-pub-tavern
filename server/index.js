'use strict';

// Coffee Pub Tavern server: accounts, pages, images and LiveKit tokens.

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { AccessToken, RoomServiceClient, DataPacket_Kind } = require('livekit-server-sdk');
const { Store, StoreError, SLOTS, LEGACY_SLOTS, IMAGE_TYPES, MAX_IMAGE_BYTES, LOBBY, randomToken } = require('./store');
const auth = require('./auth');

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
} = process.env;

const VERSION = `v${require('../package.json').version} (${String(TAVERN_REVISION).slice(0, 7)})`;

if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET are required.');
  process.exit(1);
}

const store = new Store(DATA_DIR);
const limiter = new auth.LoginLimiter();

// Make sure the admin from the environment exists with that password. This is
// also the way back in after a forgotten password: change the value, restart.
function bootstrapAdmin() {
  const password = TAVERN_ADMIN_PASSWORD || TAVERN_ADMIN_KEY;
  const login = TAVERN_ADMIN_USER || 'admin';
  if (password) {
    const existing = store.userByLogin(login);
    const passwordHash = auth.hashPassword(password);
    if (existing) {
      if (!auth.verifyPassword(password, existing.passwordHash) || existing.role !== 'admin') {
        store.updateUser(existing.key, { passwordHash, role: 'admin' });
        console.log(`Admin "${login}" updated from the environment.`);
      }
    } else {
      store.addUser({ login, displayName: login, role: 'admin', passwordHash });
      console.log(`Admin "${login}" created from the environment.`);
    }
    return;
  }
  if (store.adminCount() === 0) {
    const generated = randomToken(9);
    store.addUser({ login, displayName: login, role: 'admin', passwordHash: auth.hashPassword(generated) });
    console.log(`No admin yet and no TAVERN_ADMIN_PASSWORD set. Created "${login}" with password: ${generated}`);
  }
}
bootstrapAdmin();

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

async function mintToken({ identity, name, room, publisher }) {
  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity, name, ttl: publisher ? '24h' : '12h' });
  token.addGrant({
    room,
    roomJoin: true,
    canPublish: publisher,
    canSubscribe: true,
    canPublishData: publisher,
    hidden: !publisher, // OBS viewers do not show up at the table
  });
  return token.toJwt();
}

// Each Tavern room is its own LiveKit room: the Lobby keeps the base name
// (so links and the Studio from before rooms still work), the others hang
// their id off it.
function livekitRoomName(roomId) {
  return !roomId || roomId === LOBBY ? store.settings.room : `${store.settings.room}-${roomId}`;
}

function roomIdOfLivekit(name) {
  const base = store.settings.room;
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
    if (p) return p.room;
  }
  return LOBBY;
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
  return {
    key: u.key,
    login: u.login,
    displayName: u.displayName,
    role: u.role,
    hasPassword: !!u.passwordHash,
    link: u.linkToken ? `${baseUrl(req)}/j/${u.linkToken}` : null,
    images: Object.fromEntries(SLOTS.map((slot) => [slot, !!u.images[slot]])),
    player: { ...u.player, effective: store.effectivePlayer(u) },
    viewUrl: `${baseUrl(req)}/view/${u.key}`,
    createdAt: u.createdAt,
  };
}

// What the table and the view pages need about everyone: name and the
// talking colour, so tiles and frames match.
function tableUser(u) {
  const p = store.effectivePlayer(u);
  return { key: u.key, displayName: u.displayName, border: p.border, borderColor: p.borderColor, borderWidth: p.borderWidth, mutedBorder: p.mutedBorder, mutedColor: p.mutedColor, plate: p.plate, charBorder: p.charBorder, charBorderColor: p.charBorderColor, charMutedBorder: p.charMutedBorder, charMutedColor: p.charMutedColor, charBorderWidth: p.charBorderWidth, pictureBackground: p.pictureBackground, pictureColor: p.pictureColor, pictureScale: p.pictureScale, images: Object.fromEntries(SLOTS.map((slot) => [slot, !!u.images[slot]])) };
}

function branding() {
  const s = store.settings;
  return { serverName: s.serverName, tableName: s.tableName, room: s.room, loginText: s.loginText, hasIcon: !!store.iconPath(), hasBackground: !!store.siteImagePath('background'), version: VERSION, border: s.border, borderColor: s.borderColor, borderWidth: s.borderWidth || 6, mutedBorder: s.mutedBorder !== false, mutedColor: s.mutedColor || '#b8503f', plate: Boolean(s.plate), charBorder: Boolean(s.charBorder), charBorderColor: s.charBorderColor || '#6fae6b', charMutedBorder: Boolean(s.charMutedBorder), charMutedColor: s.charMutedColor || '#b8503f', charBorderWidth: s.charBorderWidth || 6, pictureBackground: Boolean(s.pictureBackground), pictureColor: s.pictureColor || '#1a1410', pictureScale: s.pictureScale || 100, reactions: Array.isArray(s.reactions) ? s.reactions : [] };
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

// --- app -------------------------------------------------------------------

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '64kb' }));

const publicDir = path.join(__dirname, '..', 'public');
const clientDist = path.join(__dirname, '..', 'node_modules', 'livekit-client', 'dist');
const page = (name) => path.join(publicDir, name);
const rawImage = express.raw({ type: Object.keys(IMAGE_TYPES), limit: MAX_IMAGE_BYTES + 1024 });

// Pages ----------------------------------------------------------------------

app.get('/', (req, res) => {
  if (!currentUser(req)) return res.redirect('/login');
  res.sendFile(page('room.html'));
});

app.get('/login', (req, res) => {
  if (currentUser(req)) return res.redirect(String(req.query.next || '/').startsWith('/') ? String(req.query.next || '/') : '/');
  res.sendFile(page('login.html'));
});

// Personal link: signs the user in and drops them at the table.
app.get('/j/:token', (req, res) => {
  const user = store.userByLinkToken(req.params.token);
  if (!user) return res.status(404).sendFile(page('bad-link.html'));
  auth.setSessionCookie(req, res, auth.issueSession(store.sessionSecret, user));
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

// OBS view of one user: /view/<key>?s=<stream key>&mode=auto|video|avatar&audio=1&plate=1
app.get('/view/:key', (req, res) => {
  if (!hasStreamAccess(req)) return res.status(403).send('This view needs the stream key (?s=...).');
  if (!store.userByKey(req.params.key)) return res.status(404).send('No such user.');
  res.sendFile(page('view.html'));
});

// Images ---------------------------------------------------------------------

// The server icon: the one set on the Settings tab, else the Coffee Pub brandmark.
app.get('/img/site/icon', (_req, res) => {
  const file = store.iconPath();
  if (file) return sendImage(res, file);
  res.set('Cache-Control', 'no-cache').sendFile(path.join(publicDir, 'icon.png'));
});
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

// A user's image for a slot. The profile photo always renders (an initials
// plate when none is set); every other slot is optional and 404s when unset,
// so overlays and the Player/Character boxes stay transparent. Signed-in
// users and stream key holders.
app.get('/img/:key/:slot', (req, res) => {
  if (!currentUser(req) && !hasStreamAccess(req)) return res.status(403).end();
  const user = store.userByKey(req.params.key);
  if (!user) return res.status(404).end();
  const wanted = LEGACY_SLOTS[req.params.slot] || req.params.slot;
  const slot = SLOTS.includes(wanted) ? wanted : 'profile';
  const resolved = store.resolveImage(user.key, slot);
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

// Static assets, including the LiveKit browser client and Font Awesome Free
// (the one icon set every page uses) served from node_modules.
app.use('/lib/livekit-client.esm.mjs', express.static(path.join(clientDist, 'livekit-client.esm.mjs')));
const faDir = path.dirname(require.resolve('@fortawesome/fontawesome-free/package.json'));
app.use('/fa/css', express.static(path.join(faDir, 'css'), { maxAge: '7d' }));
app.use('/fa/webfonts', express.static(path.join(faDir, 'webfonts'), { maxAge: '30d' }));
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
    return res.status(401).json({ error: 'wrong login or password' });
  }
  limiter.clear(ip);
  const token = auth.issueSession(store.sessionSecret, user);
  auth.setSessionCookie(req, res, token);
  res.json({ user: publicUser(req, user), token });
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
  const token = await mintToken({ identity: user.key, name: user.displayName, room, publisher: true });
  res.json({ token, livekitUrl: livekitWsUrl(req), identity: user.key, room, roomId });
});

// A user may replace or clear their own profile photo. This is separate from
// the Player box's Online picture, which only an admin sets (it may be part
// of a matched set of OBS images).
app.put('/api/me/images/profile', requireUser, rawImage, (req, res) => {
  store.setImage(currentUser(req).key, 'profile', req.body, req.get('content-type'));
  res.json({ ok: true });
});
app.delete('/api/me/images/profile', requireUser, (req, res) => {
  store.removeImage(currentUser(req).key, 'profile');
  res.json({ ok: true });
});

// Everyone at the table: names, talking colours and Player options for the
// tiles and view pages, who is at the table right now and in which room,
// and the rooms themselves (with the ones the caller may join marked).
app.get('/api/table', async (req, res) => {
  const user = currentUser(req);
  if (!user && !hasStreamAccess(req)) return res.status(401).json({ error: 'sign in first' });
  const online = await participants();
  const byKey = new Map(online.map((p) => [p.key, p]));
  store.pruneAsideRooms(byKey);
  res.json({
    ...branding(),
    users: store.users.map((u) => ({ ...tableUser(u), online: byKey.has(u.key), room: byKey.get(u.key)?.room || null })),
    rooms: store.rooms.map((r) => ({ ...r, mine: !user || r.members.includes(user.key) || user.role === 'admin' })),
    activeRoom: activeRoomId(byKey),
  });
});

// An admin pulls one or more people who are currently in their room into a
// new room with them, for a word away from the rest of the table. LiveKit
// here is a single, un-clustered node, so there is no server-side "move a
// live participant" primitive to lean on: the admin's own browser gets the
// new room directly in this response and reconnects itself; everyone else
// pulled gets a data-channel nudge (the same mechanism chat already uses)
// telling their page which room to reconnect to.
app.post('/api/table/pull-aside', requireAdmin, async (req, res) => {
  try {
    const admin = currentUser(req);
    const raw = req.body?.with;
    const keys = [...new Set(Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [])];
    const targets = keys.filter((k) => k !== admin.key).map((k) => store.userByKey(k)).filter(Boolean);
    if (!targets.length) return res.status(400).json({ error: 'pick someone to pull aside' });
    const adminRoom = await roomOf(admin.key);
    if (!adminRoom) return res.status(400).json({ error: 'you need to be at the table yourself to pull someone aside' });
    for (const target of targets) {
      const targetRoom = await roomOf(target.key);
      if (targetRoom !== adminRoom) return res.status(404).json({ error: `${target.displayName} is not with you right now` });
    }
    const room = store.addAsideRoom([admin.key, ...targets.map((t) => t.key)], roomIdOfLivekit(adminRoom));
    const payload = new TextEncoder().encode(JSON.stringify({ type: 'pull-aside', roomId: room.id }));
    await roomService.sendData(adminRoom, payload, DataPacket_Kind.RELIABLE, { destinationIdentities: targets.map((t) => t.key), topic: 'pull-aside' });
    // Everyone left behind: a private word is private from the table, not
    // invisible to it -- this is what lets their tiles turn into "in an
    // aside" placeholders right away instead of just looking like they hung
    // up until the next poll catches up.
    const bystanderPayload = new TextEncoder().encode(JSON.stringify({ type: 'aside-started', roomId: room.id, members: room.members }));
    await roomService.sendData(adminRoom, bystanderPayload, DataPacket_Kind.RELIABLE, { topic: 'aside-started' }).catch(() => {});
    res.json({ room });
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
  });
});

// Rooms: the Lobby (everyone) plus the rooms an admin curates. Signed-in
// users and stream key holders can read them; admins change them.
app.get('/api/rooms', (req, res) => {
  if (!currentUser(req) && !hasStreamAccess(req)) return res.status(401).json({ error: 'sign in first' });
  res.json({ rooms: store.rooms });
});
app.post('/api/rooms', requireAdmin, (req, res) => {
  const { name, description, members } = req.body || {};
  res.json({ room: store.addRoom({ name, description, members }) });
});
app.patch('/api/rooms/:id', requireAdmin, (req, res) => {
  res.json({ room: store.updateRoom(req.params.id, req.body || {}) });
});
app.delete('/api/rooms/:id', requireAdmin, (req, res) => {
  store.removeRoom(req.params.id);
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

app.post('/api/users/:key/kick', requireAdmin, async (req, res) => {
  try {
    const room = await roomOf(req.params.key);
    if (!room) return res.status(404).json({ error: 'not at the table' });
    await roomService.removeParticipant(room, req.params.key);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: `LiveKit: ${err.message}` });
  }
});

app.post('/api/users/:key/mute', requireAdmin, async (req, res) => {
  try {
    const room = await roomOf(req.params.key);
    if (!room) return res.status(404).json({ error: 'not at the table' });
    const info = await roomService.getParticipant(room, req.params.key);
    const mic = (info.tracks || []).find((t) => t.source === 2);
    if (!mic) return res.status(404).json({ error: 'no microphone track' });
    await roomService.mutePublishedTrack(room, req.params.key, mic.sid, req.body?.muted !== false);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: `LiveKit: ${err.message}` });
  }
});

app.get('/api/settings', requireAdmin, (_req, res) => res.json({ settings: branding(), streamKey: store.streamKey }));
app.patch('/api/settings', requireAdmin, (req, res) => {
  store.updateSettings(req.body || {});
  res.json({ settings: branding() });
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
app.post('/api/stream-key/regenerate', requireAdmin, (_req, res) => {
  res.json({ streamKey: store.regenerateStreamKey() });
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Errors ---------------------------------------------------------------------

app.use((err, _req, res, _next) => {
  if (err instanceof StoreError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'image is larger than 5 MB' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad JSON' });
  console.error(err);
  res.status(500).json({ error: 'server error' });
});

app.listen(Number(PORT), () => {
  console.log(`${store.settings.serverName} ${VERSION} listening on :${PORT}, LiveKit at ${LIVEKIT_HOST}, data in ${DATA_DIR}`);
});
