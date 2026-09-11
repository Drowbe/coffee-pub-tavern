'use strict';

// Coffee Pub Tavern server: serves the pages and mints LiveKit access tokens.

const path = require('path');
const express = require('express');
const { AccessToken } = require('livekit-server-sdk');

const {
  PORT = 3000,
  LIVEKIT_HOST = 'localhost:7880',
  LIVEKIT_API_KEY = '',
  LIVEKIT_API_SECRET = '',
  TAVERN_JOIN_KEY = '',
  TAVERN_ADMIN_KEY = '',
} = process.env;

if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET are required (see .env.example).');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.use(express.json());

const publicDir = path.join(__dirname, '..', 'public');
const clientDist = path.join(__dirname, '..', 'node_modules', 'livekit-client', 'dist');

// Pages
app.get('/', (_req, res) => res.redirect('/t/tavern'));
app.get('/t/:room', (_req, res) => res.sendFile(path.join(publicDir, 'room.html')));
app.get('/view/:room/:name', (_req, res) => res.sendFile(path.join(publicDir, 'view.html')));

// Static assets, including the LiveKit browser client served from node_modules.
app.use('/lib/livekit-client.esm.mjs', express.static(path.join(clientDist, 'livekit-client.esm.mjs')));
app.use(express.static(publicDir));

function clean(value, max = 40) {
  return String(value || '')
    .trim()
    .slice(0, max);
}

// WebSocket URL the browser should use for LiveKit.
function livekitUrl(req) {
  const secure = req.secure || req.get('x-forwarded-proto') === 'https';
  return `${secure ? 'wss' : 'ws'}://${LIVEKIT_HOST}`;
}

app.get('/api/config', (req, res) => {
  res.json({ livekitUrl: livekitUrl(req) });
});

// Mint a token for a player joining a table.
// Stage 1: a shared join key. Stage 4 replaces this with per-player links.
app.post('/api/token', async (req, res) => {
  const room = clean(req.body.room);
  const name = clean(req.body.name);
  const key = clean(req.body.key, 200);
  const role = req.body.role === 'viewer' ? 'viewer' : 'player';
  if (!room || !name) return res.status(400).json({ error: 'room and name are required' });
  const required = role === 'viewer' ? TAVERN_ADMIN_KEY : TAVERN_JOIN_KEY;
  if (!required || key !== required) return res.status(403).json({ error: 'wrong key' });

  const identity = role === 'viewer' ? `obs-${name}-${Date.now().toString(36)}` : name;
  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    name,
    ttl: role === 'viewer' ? '12h' : '24h',
  });
  token.addGrant({
    room,
    roomJoin: true,
    canPublish: role === 'player',
    canSubscribe: true,
    canPublishData: role === 'player',
    hidden: role === 'viewer', // OBS viewers do not show up in the grid
  });
  res.json({ token: await token.toJwt(), livekitUrl: livekitUrl(req), identity });
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.listen(Number(PORT), () => {
  console.log(`Coffee Pub Tavern listening on :${PORT}, LiveKit at ${LIVEKIT_HOST}`);
});
