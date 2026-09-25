#!/usr/bin/env node
/*
 * check-origin.mjs -- writes only from this origin (server/index.js, sameOriginOnly). A SameSite=Lax cookie still goes
 * along with a request from another origin on the same site, and on a hosted server every environment and the host
 * console share one (*.BASE_DOMAIN). A real server with a base domain, on a throwaway DATA_DIR, reached by Host header:
 *   - a sample of POST, PUT, PATCH and DELETE routes of each kind (an environment's owner routes, a member's own,
 *     module data and settings, the bus, uploads, the theme import, the host console) is refused with the one sentence
 *     when it carries a cookie and Sec-Fetch-Site says same-site or cross-site, or its Origin is another environment,
 *     the console, the bare base domain or "null" -- and nothing it would have done happens;
 *   - the same requests pass the rule from their own origin (also behind a proxy, X-Forwarded-*), with
 *     Sec-Fetch-Site: none, with neither header (old browsers, curl), with a Bearer token, and with no cookie at all
 *     (webhooks); GET is never refused;
 *   - POST /login is exempt: the landing page at the bare base domain posts its sign-in form there across origins;
 *   - the rule runs before any body parser, and /login is the only exemption.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SENTENCE = 'This request came from another site, so it was refused.';
const BASE = 'magpie.test';

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    n += 1;
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}\n${err.stack || err}`);
  }
};

await test('the rule runs for every write before any body is parsed, and only POST /login is exempt', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
  const mount = src.indexOf('app.use((req, res, next) => (WRITE_METHODS.has(req.method) && !CROSS_ORIGIN_EXEMPT.has(req.path) ? sameOriginOnly(req, res, next) : next()));');
  assert.ok(mount > 0, 'sameOriginOnly is mounted for every write');
  const firstParser = src.search(/app\.use\(express\.(json|text|raw|urlencoded)\(/);
  assert.ok(mount < firstParser, 'before the first body parser');
  assert.ok(mount < src.indexOf('if (BASE_DOMAIN) {\n  app.use((req, res, next) => {'), 'before the door, so the host console is covered too');
  assert.match(src, /const WRITE_METHODS = new Set\(\['POST', 'PUT', 'PATCH', 'DELETE'\]\);/);
  assert.match(src, /const CROSS_ORIGIN_EXEMPT = new Set\(\['\/login'\]\);/);
  assert.ok(src.includes(`error: '${SENTENCE}'`));
});

// --- a real server with a base domain --------------------------------------------------------------------------
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-origin-'));
const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  cwd: ROOT,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, BASE_DOMAIN: BASE, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ADMIN_LOGIN: 'host', ADMIN_PASSWORD: 'hostpass1234' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (d) => { out += d; });
child.stderr.on('data', (d) => { out += d; });
const port = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 20000);
  const onData = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
});
const hostOf = (sub) => `${sub ? `${sub}.` : ''}${BASE}:${port}`;
const originOf = (sub) => `http://${hostOf(sub)}`;

// One request by Host header: { status, json, text, cookies }.
function call(method, sub, urlPath, { headers = {}, body, type = 'application/json' } = {}) {
  const payload = body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: { host: hostOf(sub), accept: 'application/json', ...(payload ? { 'content-type': type, 'content-length': payload.length } : {}), ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { text += d; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        const cookies = (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]);
        resolve({ status: res.status || res.statusCode, json, text, cookies, location: res.headers.location });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const refused = (r) => r.status === 403 && r.json?.error === SENTENCE;

try {
  const hostLogin = await call('POST', 'admin', '/api/host/login', { body: { login: 'host', password: 'hostpass1234' } });
  assert.equal(hostLogin.status, 200, hostLogin.text);
  const hostCookie = hostLogin.cookies.join('; ');
  for (const slug of ['aaa', 'bbb']) {
    const made = await call('POST', 'admin', '/api/host/environments', { headers: { cookie: hostCookie }, body: { slug, name: `Env ${slug}`, owner: { login: `own${slug}`, password: 'ownerpass1234' } } });
    assert.equal(made.status, 201, made.text);
  }
  const login = await call('POST', 'aaa', '/api/login', { body: { login: 'ownaaa', password: 'ownerpass1234' } });
  assert.equal(login.status, 200, login.text);
  const token = login.json.token;
  const ownerCookie = `app_session=${token}`;
  const state = async () => ({
    streamKey: (await call('GET', 'aaa', '/api/settings', { headers: { cookie: ownerCookie } })).json.streamKey,
    spaces: (await call('GET', 'aaa', '/api/spaces', { headers: { cookie: ownerCookie } })).json.spaces.map((s) => s.name).sort(),
    themes: (await call('GET', 'aaa', '/api/themes', { headers: { cookie: ownerCookie } })).json.themes.map((t) => t.name).sort(),
    environmentName: (await call('GET', 'aaa', '/api/settings', { headers: { cookie: ownerCookie } })).json.settings.environmentName,
    hostName: (await call('GET', 'admin', '/api/host/environments', { headers: { cookie: hostCookie } })).json.environments.find((e) => e.slug === 'bbb').name,
  });
  const set = { bg: '#ffffff', bgSection: '#f5f7f8', border: '#dde3e6', text: '#222222', textDim: '#6b7479', accent: '#1c7c8c', onAccent: '#ffffff' };
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a8b90000000049454e44ae426082', 'hex');
  // [what, method, subdomain, path, body, type, cookie]
  const ROUTES = [
    ['owner: make a space', 'POST', 'aaa', '/api/spaces', { name: 'Cross' }],
    ['owner: settings', 'PATCH', 'aaa', '/api/settings', { environmentName: 'Taken over' }],
    ['owner: delete a theme', 'DELETE', 'aaa', '/api/themes/staying-blonde'],
    ['owner: a new stream key (no body)', 'POST', 'aaa', '/api/stream-key/regenerate'],
    ['owner: the site icon (raw image)', 'PUT', 'aaa', '/api/settings/icon', png, 'image/png'],
    ['owner: theme import (text/plain)', 'POST', 'aaa', '/api/themes/import', JSON.stringify({ magpieTheme: 1, name: 'Cross', light: set }), 'text/plain'],
    ['member: own settings', 'PATCH', 'aaa', '/api/me', { themeMode: 'light' }],
    ['member: sign out', 'POST', 'aaa', '/api/logout'],
    ['module data: write', 'PUT', 'aaa', '/api/modules/stream/data/check', { value: 1 }],
    ['module data: delete', 'DELETE', 'aaa', '/api/modules/stream/data/check'],
    ['module settings', 'PUT', 'aaa', '/api/modules/stream/settings/user', { values: {} }],
    ['module upload', 'POST', 'aaa', '/api/modules/stream/uploads', png, 'image/png'],
    ['the bus', 'POST', 'aaa', '/api/bus/publish', { topic: 'x', payload: {} }],
    ['host console: rename an environment', 'PATCH', 'admin', '/api/host/environments/bbb', { name: 'Taken over' }, undefined, 'host'],
    ['host console: plans', 'PUT', 'admin', '/api/host/plans', {}, undefined, 'host'],
    ['host console: sign out', 'POST', 'admin', '/api/host/logout', undefined, undefined, 'host'],
  ];
  const cookieFor = (kind) => (kind === 'host' ? hostCookie : ownerCookie);

  await test('a write carrying a cookie from another origin on the site is refused with the sentence, for every kind of route, and does nothing', async () => {
    const before = await state();
    for (const [what, method, sub, route, body, type, kind] of ROUTES) {
      const others = [sub === 'aaa' ? 'bbb' : 'aaa', sub === 'admin' ? '' : 'admin', ''].map(originOf);
      const variants = [
        { 'sec-fetch-site': 'same-site' },
        { 'sec-fetch-site': 'cross-site' },
        ...others.map((origin) => ({ origin })),
        { origin: 'null' },
        { origin: originOf(sub), 'sec-fetch-site': 'same-site' },
        { origin: others[0], 'sec-fetch-site': 'same-origin' },
      ];
      for (const headers of variants) {
        for (const t of type ? [type] : ['text/plain', 'application/x-www-form-urlencoded', 'application/json']) {
          const r = await call(method, sub, route, { headers: { cookie: cookieFor(kind), ...headers }, body: body ?? (method === 'DELETE' ? undefined : '{}'), type: t });
          assert.ok(refused(r), `${what}: ${method} ${route} ${t} ${JSON.stringify(headers)} -> ${r.status} ${r.text.slice(0, 120)}`);
        }
      }
    }
    assert.deepEqual(await state(), before);
    // Still signed in: the refused sign-outs did nothing.
    assert.equal((await call('GET', 'aaa', '/api/me', { headers: { cookie: ownerCookie } })).status, 200);
    assert.equal((await call('GET', 'admin', '/api/host/me', { headers: { cookie: hostCookie } })).status, 200);
  });

  await test('the rule lets through: no cookie (webhooks), GET, a Bearer token, and a request from its own origin, proxied or not, or with neither header', async () => {
    for (const [what, method, sub, route, body, type] of ROUTES) {
      const r = await call(method, sub, route, { headers: { origin: originOf('bbb'), 'sec-fetch-site': 'same-site' }, body: body ?? (method === 'DELETE' ? undefined : '{}'), type: type || 'application/json' });
      assert.ok(!refused(r), `${what}: no cookie is not the rule's to refuse -> ${r.status} ${r.text.slice(0, 120)}`);
    }
    const hook = await call('POST', 'admin', '/api/host/billing', { body: { slug: 'aaa', plan: 'free', event: 'paid' } });
    assert.ok(!refused(hook), `the billing webhook: ${hook.status}`);
    assert.equal((await call('GET', 'aaa', '/api/settings', { headers: { cookie: ownerCookie, origin: originOf('bbb'), 'sec-fetch-site': 'same-site' } })).status, 200, 'GET');
    const mine = { themeMode: 'dark' };
    for (const headers of [
      { cookie: ownerCookie, origin: originOf('aaa'), 'sec-fetch-site': 'same-origin' },
      { cookie: ownerCookie, 'sec-fetch-site': 'none' },
      { cookie: ownerCookie },
      { cookie: ownerCookie, origin: `https://aaa.${BASE}`, 'x-forwarded-proto': 'https', 'x-forwarded-host': `aaa.${BASE}` }, // behind a proxy
      { authorization: `Bearer ${token}`, origin: originOf('bbb'), 'sec-fetch-site': 'cross-site' },
      { authorization: `Bearer ${token}`, cookie: ownerCookie, origin: originOf('bbb') },
    ]) {
      const r = await call('PATCH', 'aaa', '/api/me', { headers, body: mine });
      assert.equal(r.status, 200, `${JSON.stringify(headers)} -> ${r.text.slice(0, 120)}`);
    }
    const console = await call('PATCH', 'admin', '/api/host/environments/bbb', { headers: { cookie: hostCookie, origin: originOf('admin'), 'sec-fetch-site': 'same-origin' }, body: { name: 'Env bbb' } });
    assert.equal(console.status, 200, console.text);
  });

  await test('POST /login is exempt: the landing page\'s sign-in form posts there from the bare base domain, cookie or not', async () => {
    for (const cookie of [undefined, ownerCookie]) {
      const r = await call('POST', 'aaa', '/login', { headers: { origin: originOf(''), 'sec-fetch-site': 'same-site', ...(cookie ? { cookie } : {}) }, body: 'login=ownaaa&password=ownerpass1234&next=%2F', type: 'application/x-www-form-urlencoded' });
      assert.equal(r.status, 303, r.text);
      assert.equal(r.location, '/');
      assert.ok(r.cookies.some((c) => c.startsWith('app_session=')), 'signed in');
    }
  });
} finally {
  await new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
  fs.rmSync(dataDir, { recursive: true, force: true });
}

if (failed) {
  console.error(`check-origin: ${failed} group${failed === 1 ? '' : 's'} failed`);
  process.exit(1);
}
console.log(`check-origin: ${n} groups OK`);
