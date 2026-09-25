#!/usr/bin/env node
/*
 * check-secrets.mjs -- who sees the secrets that let someone in, run against a real single-environment server
 * on a throwaway DATA_DIR (GitHub #61):
 *   - a person's personal link (/j/<token>, a sign-in in itself) goes to an owner and to the person themselves,
 *     never to an access-key holder, and never in GET /api/status (not even to an owner, not even to Studio);
 *   - a space's guest link (guestToken) goes to an owner and to a member of that space who may manage its guest
 *     link (canInvite), never to a member without it, a member of another space, a guest, or an access-key holder;
 *   - app.json and ai.json are private to the server's user (mode 600), and ai.json never holds a plain key once
 *     the server has loaded it -- and the saved, encrypted key still reaches the AI service (a stand-in here).
 * No network beyond localhost.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

// A stand-in AI service: lists models, and remembers the key each request carried.
const seen = [];
const aiServer = http.createServer((req, res) => {
  seen.push(req.headers.authorization || '');
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ data: [{ id: 'stand-in-model' }] }));
});
await new Promise((r) => aiServer.listen(0, '127.0.0.1', r));
const aiAddress = `http://127.0.0.1:${aiServer.address().port}`;

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-secrets-'));
// An AI key saved in the clear, as every install had it before keys were encrypted: sealed when the server loads it.
fs.writeFileSync(path.join(dataDir, 'ai.json'), JSON.stringify({ source: 'custom', provider: 'compatible', address: aiAddress, model: 'stand-in-model', key: 'sk-plain-before', enabled: true }), { mode: 0o644 });

let child = null;
let port = 0;
async function startServer() {
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ADMIN_PASSWORD: 'testpass1234' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 20000);
    const onData = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
}
const stopServer = () => new Promise((resolve) => { if (!child || child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
await startServer();

async function call(method, urlPath, { body, token, cookie } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = `app_session=${cookie}`;
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
const signIn = async (login, password) => {
  const r = await call('POST', '/api/login', { body: { login, password } });
  assert.equal(r.status, 200, `${login} signs in: ${r.text}`);
  return r.json.token;
};

try {
  const owner = await signIn('admin', 'testpass1234');
  const me = (await call('GET', '/api/me', { cookie: owner })).json;
  const streamKey = me.streamKey;
  assert.ok(streamKey, 'the owner is given the access key');
  const ownerKey = me.user.key;
  // The audit's exploit needs an owner with a personal link (the ADMIN_LOGIN account can't have one): a real owner.
  const gm = (await call('POST', '/api/users', { cookie: owner, body: { login: 'gm', displayName: 'GM', role: 'owner', passwordless: true } })).json.user;
  const gmLink = gm.link;
  assert.match(gmLink, /\/j\/[A-Za-z0-9_-]+$/, 'the owner who made gm sees gm\'s personal link');
  const gmToken = gmLink.split('/j/')[1];
  const mk = async (login) => (await call('POST', '/api/users', { cookie: owner, body: { login, displayName: login, role: 'member', password: 'memberpass1234', passwordless: true } })).json.user;
  const alice = await mk('alice'); // in both spaces, may manage the first one's guest link
  const bob = await mk('bob'); // in both spaces, may manage neither's
  const carol = await mk('carol'); // in the second space only
  const one = (await call('POST', '/api/spaces', { cookie: owner, body: { name: 'One', members: [alice.key, bob.key] } })).json.space;
  const two = (await call('POST', '/api/spaces', { cookie: owner, body: { name: 'Two', members: [alice.key, bob.key, carol.key] } })).json.space;
  const r1 = await call('PATCH', `/api/users/${alice.key}/spaces/${one.id}`, { cookie: owner, body: { permissions: { moderator: true } } });
  assert.equal(r1.status, 200, r1.text);
  const tokenOne = (await call('POST', `/api/spaces/${one.id}/guest-link`, { cookie: owner, body: {} })).json.space.guestToken;
  const tokenTwo = (await call('POST', `/api/spaces/${two.id}/guest-link`, { cookie: owner, body: {} })).json.space.guestToken;
  assert.ok(tokenOne && tokenTwo, 'both spaces have a guest link');
  const [aliceT, bobT, carolT] = [await signIn('alice', 'memberpass1234'), await signIn('bob', 'memberpass1234'), await signIn('carol', 'memberpass1234')];

  const tokensIn = (spaces) => Object.fromEntries(spaces.filter((s) => s.id === one.id || s.id === two.id).map((s) => [s.name, s.guestToken]));
  const noLinks = (users) => users.every((u) => !('link' in u));
  const anyTokenText = (text) => text.includes(tokenOne) || text.includes(tokenTwo);

  await test('the access key never reads a personal link or a guest link (the audit\'s two exploits)', async () => {
    // The link itself works (so not finding it below means something): it signs in as gm, an owner.
    const signedInByLink = await fetch(`http://127.0.0.1:${port}/j/${gmToken}`, { redirect: 'manual' });
    const stolen = (signedInByLink.headers.get('set-cookie') || '').split(';')[0];
    assert.equal((await call('GET', '/api/settings', { cookie: stolen.replace(/^app_session=/, '') })).status, 200, 'gm\'s link signs in as an owner');
    // Every read the access key allows: gm's link token appears in none of them.
    for (const route of ['/api/status', '/api/spaces', '/api/presence']) {
      const r = await call('GET', `${route}?s=${streamKey}`);
      assert.equal(r.status, 200, route);
      assert.ok(!r.text.includes(gmToken), `gm's personal link is not in ${route}`);
    }
    const status = await call('GET', `/api/status?s=${streamKey}`);
    assert.equal(status.status, 200);
    assert.ok(noLinks(status.json.users), 'no personal link in /api/status');
    assert.ok(!status.text.includes('/j/'), 'no /j/ link anywhere in /api/status');
    assert.ok(!anyTokenText(status.text), 'no guest token anywhere in /api/status');
    const spaces = await call('GET', `/api/spaces?s=${streamKey}`);
    assert.equal(spaces.status, 200);
    assert.ok(!anyTokenText(spaces.text), 'no guest token in /api/spaces');
    const presence = await call('GET', `/api/presence?s=${streamKey}`);
    assert.ok(!anyTokenText(presence.text), 'no guest token in /api/presence');
    // And so the owner-only settings stay shut to a key holder.
    assert.equal((await call('GET', `/api/settings?s=${streamKey}`)).status, 401);
  });

  await test('a guest reads the presence roster without any space\'s guest link', async () => {
    const r = await call('GET', `/api/presence?guest=${tokenOne}`);
    assert.equal(r.status, 200);
    assert.deepEqual(tokensIn(r.json.spaces), { One: null, Two: null });
  });

  await test('a member sees a guest link only for a space where they may manage it', async () => {
    for (const route of ['/api/spaces', '/api/presence']) {
      assert.deepEqual(tokensIn((await call('GET', route, { token: aliceT })).json.spaces), { One: tokenOne, Two: null }, `alice, ${route}`);
      assert.deepEqual(tokensIn((await call('GET', route, { token: bobT })).json.spaces), { One: null, Two: null }, `bob, ${route}`);
      assert.deepEqual(tokensIn((await call('GET', route, { token: carolT })).json.spaces), { One: null, Two: null }, `carol, ${route}`);
    }
  });

  await test('an owner still sees every guest link and every personal link where they manage them', async () => {
    assert.deepEqual(tokensIn((await call('GET', '/api/spaces', { cookie: owner })).json.spaces), { One: tokenOne, Two: tokenTwo });
    assert.deepEqual(tokensIn((await call('GET', '/api/presence', { cookie: owner })).json.spaces), { One: tokenOne, Two: tokenTwo });
    const users = (await call('GET', '/api/users', { cookie: owner })).json.users;
    assert.ok(users.every((u) => 'link' in u), 'Manage users lists every personal link');
    assert.match(users.find((u) => u.key === alice.key).link, /\/j\//);
    assert.match((await call('GET', `/api/users/${bob.key}`, { cookie: owner })).json.user.link, /\/j\//);
  });

  await test('/api/status never carries a personal link, even for an owner or Studio; its other fields are unchanged', async () => {
    const cookieStatus = await call('GET', '/api/status', { cookie: owner });
    assert.ok(noLinks(cookieStatus.json.users));
    assert.deepEqual(tokensIn(cookieStatus.json.spaces), { One: tokenOne, Two: tokenTwo }, 'an owner still sees guest links there');
    const studio = await call('GET', '/api/status', { token: owner });
    assert.equal(studio.status, 200);
    assert.ok(noLinks(studio.json.users));
    for (const field of ['key', 'login', 'displayName', 'role', 'images', 'spaces', 'permissions', 'player', 'viewUrl', 'online']) assert.ok(field in studio.json.users[0], `users[].${field}`);
    assert.equal(studio.json.users.find((u) => u.key === ownerKey).role, 'admin', 'the Studio alias still applies');
  });

  await test('a person sees their own personal link, and nobody else\'s', async () => {
    const mine = (await call('GET', '/api/me', { token: aliceT })).json.user;
    assert.match(mine.link, /\/j\//);
    assert.equal((await call('GET', '/api/users', { token: aliceT })).status, 403);
    assert.equal((await call('GET', `/api/status?s=${streamKey}`, { token: aliceT })).json.users.some((u) => 'link' in u), false);
  });

  await test('app.json, ai.json and secrets.key are private to the server\'s user', () => {
    for (const name of ['app.json', 'ai.json', 'secrets.key']) assert.equal(fs.statSync(path.join(dataDir, name)).mode & 0o777, 0o600, name);
  });

  await test('ai.json never holds a plain key once loaded, and the encrypted key still reaches the service', async () => {
    const text = () => fs.readFileSync(path.join(dataDir, 'ai.json'), 'utf8');
    assert.ok(!text().includes('sk-plain-before'), 'the plain key saved before is sealed on load');
    assert.match(JSON.parse(text()).key, /^aesgcm\$/);
    // Listing models with no key typed uses the saved one: the stand-in sees the real key.
    seen.length = 0;
    const listed = await call('POST', '/api/ai/models', { cookie: owner, body: { provider: 'compatible', address: aiAddress } });
    assert.equal(listed.status, 200, listed.text);
    assert.equal(seen.at(-1), 'Bearer sk-plain-before');
    // A key typed in the AI settings is sealed before it is saved.
    const put = await call('PUT', '/api/ai', { cookie: owner, body: { key: 'sk-typed-now' } });
    assert.equal(put.status, 200, put.text);
    assert.equal(put.json.ai.keySet, true);
    assert.equal(put.json.ai.keyUnreadable, false);
    assert.ok(!text().includes('sk-typed-now'));
    seen.length = 0;
    await call('POST', '/api/ai/models', { cookie: owner, body: { provider: 'compatible', address: aiAddress } });
    assert.equal(seen.at(-1), 'Bearer sk-typed-now');
  });

  await test('an upgrade makes files left readable by others private; a key another host encrypted is one plain sentence, and saving other fields still works', async () => {
    // The Assistant needs the AI service: installed and on, so switching AI off would have to switch it off too.
    const one2 = one.id;
    assert.equal((await call('POST', '/api/modules/bundled/assistant/install', { cookie: owner, body: {} })).status, 201);
    const on = await call('PATCH', '/api/modules/assistant', { cookie: owner, body: { enabled: true, allSpaces: true } });
    assert.equal(on.status, 200, on.text);
    await stopServer();
    // An install from before files were kept private, and a secrets key that isn't the one the AI key was saved with
    // (data restored onto a different host).
    for (const name of ['app.json', 'ai.json', 'secrets.key']) fs.chmodSync(path.join(dataDir, name), 0o644);
    fs.writeFileSync(path.join(dataDir, 'secrets.key'), (await import('node:crypto')).randomBytes(32).toString('hex'));
    fs.chmodSync(path.join(dataDir, 'secrets.key'), 0o644);
    await startServer();
    for (const name of ['app.json', 'ai.json', 'secrets.key']) assert.equal(fs.statSync(path.join(dataDir, name)).mode & 0o777, 0o600, `${name} is private after the upgrade`);
    const owner2 = await signIn('admin', 'testpass1234');
    const sentence = "the saved AI key can't be read on this server; enter the key again";
    const view = (await call('GET', '/api/ai', { cookie: owner2 })).json.ai;
    assert.deepEqual([view.keySet, view.keyUnreadable, view.keyProblem, view.enabled], [false, true, sentence, true]);
    // Saving another field: no "turn it off too?", AI stays on, the Assistant stays on; the key sentence is the one complaint.
    const saved = await call('PUT', '/api/ai', { cookie: owner2, body: { model: 'other-model' } });
    assert.equal(saved.status, 200, saved.text);
    assert.deepEqual([saved.json.ai.model, saved.json.ai.enabled, saved.json.ai.keyProblem], ['other-model', true, sentence]);
    const mods = (await call('GET', '/api/modules', { cookie: owner2 })).json.modules;
    assert.equal(mods.find((m) => m.id === 'assistant').enabled, true, 'the Assistant is still on');
    const asked = await call('POST', `/api/modules/assistant/ai?scope=space&space=${one2}`, { cookie: owner2, body: { task: 'ask', question: 'hello there', objects: [] } });
    assert.deepEqual([asked.status, asked.json], [403, { error: "the AI key can't be read on this server; an owner needs to enter it again" }]);
    assert.deepEqual(await call('POST', '/api/ai/models', { cookie: owner2, body: { provider: 'compatible', address: aiAddress } }).then((r) => [r.status, r.json]), [400, { error: sentence }]);
    // Entering the key again: it answers.
    const again = await call('PUT', '/api/ai', { cookie: owner2, body: { key: 'sk-entered-again', model: 'stand-in-model' } });
    assert.deepEqual([again.status, again.json.ai.keyUnreadable, again.json.ai.keyProblem], [200, false, null]);
    seen.length = 0;
    await call('POST', '/api/ai/models', { cookie: owner2, body: { provider: 'compatible', address: aiAddress } });
    assert.equal(seen.at(-1), 'Bearer sk-entered-again');
  });
} finally {
  await stopServer();
  aiServer.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

if (failed) {
  console.error(`check-secrets: ${failed} group${failed === 1 ? '' : 's'} failed`);
  process.exit(1);
}
console.log(`check-secrets: ${n} groups OK`);
