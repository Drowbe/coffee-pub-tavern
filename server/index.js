'use strict';

// Coffee Pub Tavern server: accounts, pages, images and LiveKit tokens.

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');
const { Store, StoreError, SLOTS, IMAGE_TYPES, MAX_IMAGE_BYTES, randomToken } = require('./store');
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

// Who is at the table right now, straight from LiveKit.
async function participants() {
  try {
    const list = await roomService.listParticipants(store.settings.room);
    return list
      .filter((p) => !p.permission?.hidden)
      .map((p) => {
        const tracks = p.tracks || [];
        const mic = tracks.find((t) => t.source === 2 /* MICROPHONE */);
        const cam = tracks.find((t) => t.source === 1 /* CAMERA */);
        return {
          key: p.identity,
          name: p.name,
          joinedAt: Number(p.joinedAt || 0),
          micOn: !!mic && !mic.muted,
          cameraOn: !!cam && !cam.muted,
        };
      });
  } catch (err) {
    return [];
  }
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
    viewUrl: `${baseUrl(req)}/view/${u.key}`,
    createdAt: u.createdAt,
  };
}

function branding() {
  const s = store.settings;
  return { serverName: s.serverName, tableName: s.tableName, room: s.room, loginText: s.loginText, hasIcon: !!store.iconPath(), version: VERSION };
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

const DEFAULT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">` +
  `<rect width="128" height="128" rx="28" fill="#241c16"/>` +
  `<text x="64" y="86" text-anchor="middle" font-size="64">&#9749;</text></svg>`;

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

app.get('/me', (req, res) => {
  if (!currentUser(req)) return res.redirect('/login?next=/me');
  res.sendFile(page('me.html'));
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

app.get('/img/site/icon', (_req, res) => {
  const file = store.iconPath();
  if (file) return sendImage(res, file);
  res.set('Cache-Control', 'no-cache').type('image/svg+xml').send(DEFAULT_ICON_SVG);
});

// A user's image for a slot, with the fallback chain and an initials plate at
// the end, so an <img> always renders. Signed-in users and stream key holders.
app.get('/img/:key/:slot', (req, res) => {
  if (!currentUser(req) && !hasStreamAccess(req)) return res.status(403).end();
  const user = store.userByKey(req.params.key);
  if (!user) return res.status(404).end();
  const slot = SLOTS.includes(req.params.slot) ? req.params.slot : 'novideo';
  const resolved = store.resolveImage(user.key, slot);
  if (resolved) return sendImage(res, resolved.file);
  if (req.query.fallback === 'none') return res.status(404).end();
  res.set('Cache-Control', 'no-cache').type('image/svg+xml').send(initialsSvg(user.displayName));
});

// Static assets, including the LiveKit browser client served from node_modules.
app.use('/lib/livekit-client.esm.mjs', express.static(path.join(clientDist, 'livekit-client.esm.mjs')));
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

// LiveKit token: players need a session; OBS viewers need the stream key.
app.post('/api/token', async (req, res) => {
  const room = store.settings.room;
  if (req.body?.role === 'viewer') {
    if (!hasStreamAccess(req)) return res.status(403).json({ error: 'stream key required' });
    const identity = `obs-${Date.now().toString(36)}-${randomToken(4)}`;
    return res.json({ token: await mintToken({ identity, name: 'OBS', room, publisher: false }), livekitUrl: livekitWsUrl(req), identity, room });
  }
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'sign in first' });
  const token = await mintToken({ identity: user.key, name: user.displayName, room, publisher: true });
  res.json({ token, livekitUrl: livekitWsUrl(req), identity: user.key, room });
});

// A user may replace or clear their own no-video image.
app.put('/api/me/images/novideo', requireUser, rawImage, (req, res) => {
  store.setImage(currentUser(req).key, 'novideo', req.body, req.get('content-type'));
  res.json({ ok: true });
});
app.delete('/api/me/images/novideo', requireUser, (req, res) => {
  store.removeImage(currentUser(req).key, 'novideo');
  res.json({ ok: true });
});

// Stream API (OBS pages and the Studio app) ---------------------------------

app.get('/api/status', requireStream, async (req, res) => {
  const online = await participants();
  const byKey = new Map(online.map((p) => [p.key, p]));
  res.json({
    ...branding(),
    users: store.users.map((u) => ({ ...publicUser(req, u), online: byKey.get(u.key) || null })),
  });
});

// Admin API -------------------------------------------------------------------

app.get('/api/users', requireAdmin, (req, res) => {
  res.json({ users: store.users.map((u) => publicUser(req, u)) });
});

app.post('/api/users', requireAdmin, (req, res) => {
  const { login, displayName, role, password, passwordless } = req.body || {};
  const user = store.addUser({ login, displayName, role, passwordHash: password ? auth.hashPassword(password) : null });
  if (passwordless) store.updateUser(user.key, { linkToken: randomToken() });
  res.status(201).json({ user: publicUser(req, store.userByKey(user.key)) });
});

app.patch('/api/users/:key', requireAdmin, (req, res) => {
  const { login, displayName, role, password } = req.body || {};
  const patch = {};
  if (login !== undefined) patch.login = login;
  if (displayName !== undefined) patch.displayName = displayName;
  if (role !== undefined) patch.role = role;
  if (password !== undefined) patch.passwordHash = password ? auth.hashPassword(password) : null;
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
  store.setImage(req.params.key, req.params.slot, req.body, req.get('content-type'));
  res.json({ user: publicUser(req, store.userByKey(req.params.key)) });
});
app.delete('/api/users/:key/images/:slot', requireAdmin, (req, res) => {
  if (!SLOTS.includes(req.params.slot)) return res.status(400).json({ error: 'unknown image slot' });
  store.removeImage(req.params.key, req.params.slot);
  res.json({ user: publicUser(req, store.userByKey(req.params.key)) });
});

app.post('/api/users/:key/kick', requireAdmin, async (req, res) => {
  try {
    await roomService.removeParticipant(store.settings.room, req.params.key);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: `LiveKit: ${err.message}` });
  }
});

app.post('/api/users/:key/mute', requireAdmin, async (req, res) => {
  try {
    const info = await roomService.getParticipant(store.settings.room, req.params.key);
    const mic = (info.tracks || []).find((t) => t.source === 2);
    if (!mic) return res.status(404).json({ error: 'no microphone track' });
    await roomService.mutePublishedTrack(store.settings.room, req.params.key, mic.sid, req.body?.muted !== false);
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
app.put('/api/settings/icon', requireAdmin, rawImage, (req, res) => {
  store.setIcon(req.body, req.get('content-type'));
  res.json({ settings: branding() });
});
app.delete('/api/settings/icon', requireAdmin, (_req, res) => {
  store.removeIcon();
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
