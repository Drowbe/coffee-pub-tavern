#!/usr/bin/env node
/*
 * check-one-input.mjs -- Chat /ai threads, command validation, and space-level object check
 * (plan-one-input.md, #58). Manifest refusals run in-process; HTTP cases use a throwaway server.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { cleanManifest, ModuleError } = createRequire(import.meta.url)('../server/modules.js');
const { AiThreads, AI_THREAD_LIMITS } = createRequire(import.meta.url)('../server/ai-threads.js');

let n = 0;
const files = new Set(['page.html', 'canvas.html']);
const both = { page: { entry: 'page.html' }, canvas: { entry: 'canvas.html' } };
const local = [{ name: 'addNote', label: 'Add a note', local: true, input: { text: 'string' } }];
const manifest = (extra) => cleanManifest({
  id: 'thing', name: 'Thing', version: '1.0.0', scope: ['environment', 'space'], surfaces: both,
  actions: { provides: local }, ...extra,
}, files);

assert.deepEqual(manifest({ commands: [{ name: 'r', label: 'Add a note', action: 'addNote' }] }).commands[0].action, 'addNote');
n += 1;
for (const [commands, re] of [
  [[{ name: 'R', action: 'addNote' }], /1 to 12 lowercase letters or digits/],
  [[{ name: 'ai', action: 'addNote' }], /reserved/],
  [[{ name: 'r', action: '' }], /not in actions.provides/],
  [[{ name: 'r', action: 'saveNote' }], /must be local/],
]) {
  assert.throws(() => manifest({
    actions: { provides: commands[0].action === 'saveNote' ? [{ name: 'saveNote', input: { title: 'string' } }] : local },
    commands,
  }), (err) => err instanceof ModuleError && re.test(err.message));
  n += 1;
}

const tmpThreads = fs.mkdtempSync(path.join(os.tmpdir(), 'check-ai-threads-'));
const store = new AiThreads(tmpThreads);
const old = Date.now() - (AI_THREAD_LIMITS.MAX_AGE_MS + 1000);
store.threads['s:u'] = [
  { id: 'old', at: old, role: 'user', text: 'gone' },
  ...Array.from({ length: 201 }, (_, i) => ({ id: `n${i}`, at: Date.now(), role: i % 2 ? 'ai' : 'user', text: `m${i}` })),
];
const kept = store.list('s', 'u');
assert.equal(kept.length, 200);
assert.equal(kept[0].text, 'm1');
assert.ok(!kept.some((e) => e.text === 'gone'));
n += 1;
fs.rmSync(tmpThreads, { recursive: true, force: true });

const seen = [];
const aiServer = http.createServer((req, res) => {
  seen.push(req.url);
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message: { content: 'A short answer.' } }], usage: { total_tokens: 12 } }));
});
await new Promise((r) => aiServer.listen(0, '127.0.0.1', r));
const aiAddress = `http://127.0.0.1:${aiServer.address().port}`;

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-one-input-'));
fs.writeFileSync(path.join(dataDir, 'ai.json'), JSON.stringify({
  source: 'custom', provider: 'compatible', address: aiAddress, model: 'stand-in-model', key: 'sk-test', enabled: true,
}));

let child = null;
let port = 0;
async function startServer() {
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir,
      LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ADMIN_PASSWORD: 'testpass1234',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 25000);
    const onData = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
}
const stopServer = () => new Promise((resolve) => { if (!child || child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });

async function call(method, urlPath, { body, cookie, raw, type } = {}) {
  const headers = { accept: 'application/json' };
  if (cookie) headers.cookie = `app_session=${cookie}`;
  let payload;
  if (raw !== undefined) {
    headers['content-type'] = type || 'text/plain';
    payload = raw;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

await startServer();
try {
  const login = async (name, password) => {
    const r = await call('POST', '/api/login', { body: { login: name, password } });
    assert.equal(r.status, 200, `${name} signs in: ${r.text}`);
    return r.json.token;
  };
  const owner = await login('admin', 'testpass1234');
  const member = (await call('POST', '/api/users', { cookie: owner, body: { login: 'pat', displayName: 'Pat', role: 'member', password: 'memberpass1234' } })).json.user;
  const other = (await call('POST', '/api/users', { cookie: owner, body: { login: 'sam', displayName: 'Sam', role: 'member', password: 'memberpass1234' } })).json.user;
  const space = (await call('POST', '/api/spaces', { cookie: owner, body: { name: 'Trip', members: [member.key, other.key] } })).json.space;
  const pat = await login('pat', 'memberpass1234');
  const sam = await login('sam', 'memberpass1234');

  const chat = await call('GET', `/api/spaces/${space.id}/chat`, { cookie: pat });
  assert.equal(chat.status, 200, chat.text);
  assert.ok(Array.isArray(chat.json.messages));
  n += 1;

  const asked = await call('POST', `/api/spaces/${space.id}/ai`, { cookie: pat, body: { question: 'What is Faro?' } });
  assert.equal(asked.status, 200, asked.text);
  assert.match(asked.json.text, /short answer/i);
  const thread = await call('GET', `/api/spaces/${space.id}/ai/thread`, { cookie: pat });
  assert.equal(thread.status, 200, thread.text);
  assert.equal(thread.json.entries.length, 2);
  assert.equal(thread.json.entries[0].role, 'user');
  assert.equal(thread.json.entries[1].role, 'ai');
  n += 1;

  const peek = await call('GET', `/api/spaces/${space.id}/ai/thread?user=${member.key}`, { cookie: sam });
  assert.equal(peek.status, 403, peek.text);
  const theirs = await call('GET', `/api/spaces/${space.id}/ai/thread`, { cookie: sam });
  assert.equal(theirs.status, 200, theirs.text);
  assert.equal((theirs.json.entries || []).length, 0);
  n += 1;

  const unsigned = await call('POST', `/api/spaces/${space.id}/ai`, { body: { question: 'hello there' } });
  assert.equal(unsigned.status, 401, unsigned.text);
  n += 1;

  const aside = await call('POST', '/api/spaces/not-a-space/ai', { cookie: pat, body: { question: 'hello there' } });
  assert.equal(aside.status, 404, aside.text);
  n += 1;

  await call('PATCH', `/api/spaces/${space.id}`, { cookie: owner, body: { aiOff: true } });
  const off = await call('POST', `/api/spaces/${space.id}/ai`, { cookie: pat, body: { question: 'hello there' } });
  assert.equal(off.status, 403, off.text);
  await call('PATCH', `/api/spaces/${space.id}`, { cookie: owner, body: { aiOff: false } });
  n += 1;

  const fence = '```magpie\n{"title":"Faro","content":"A city in Portugal."}\n```';
  const check = await call('POST', `/api/spaces/${space.id}/objects/check`, { cookie: pat, raw: fence, type: 'text/plain' });
  assert.equal(check.status, 200, check.text);
  assert.equal(check.json.objects.length, 1);
  assert.equal(check.json.objects[0].title, 'Faro');
  n += 1;

  const unknown = await call('POST', `/api/spaces/${space.id}/command`, { cookie: pat, body: { name: 'zzzz', text: 'hi' } });
  assert.equal(unknown.status, 404, unknown.text);
  assert.match(unknown.json.error || '', /No command \/zzzz/);
  n += 1;

  // chat/ai is 6 per minute; one ask already ran above.
  for (let i = 0; i < 5; i += 1) {
    const extra = await call('POST', `/api/spaces/${space.id}/ai`, { cookie: pat, body: { question: `again ${i}` } });
    assert.equal(extra.status, 200, extra.text);
  }
  const limited = await call('POST', `/api/spaces/${space.id}/ai`, { cookie: pat, body: { question: 'one too many' } });
  assert.equal(limited.status, 429, limited.text);
  n += 1;
} finally {
  await stopServer();
  aiServer.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

const unsetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-one-input-off-'));
let child2 = null;
let port2 = 0;
child2 = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  cwd: ROOT,
  env: {
    PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: unsetDir,
    LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ADMIN_PASSWORD: 'testpass1234',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out2 = '';
child2.stdout.on('data', (d) => { out2 += d; });
child2.stderr.on('data', (d) => { out2 += d; });
port2 = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => { child2.kill(); reject(new Error(`unset server did not start:\n${out2}`)); }, 25000);
  const onData = () => { const m = /listening on :(\d+)/.exec(out2); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
  child2.stdout.on('data', onData);
  child2.stderr.on('data', onData);
  child2.once('exit', (code) => { clearTimeout(timer); reject(new Error(`unset server stopped (${code}):\n${out2}`)); });
});
try {
  const r = await fetch(`http://127.0.0.1:${port2}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'admin', password: 'testpass1234' }) });
  const token = (await r.json()).token;
  const spaces = await fetch(`http://127.0.0.1:${port2}/api/spaces`, { headers: { cookie: `app_session=${token}` } });
  const list = (await spaces.json()).spaces || [];
  const spaceId = list[0]?.id || (await (await fetch(`http://127.0.0.1:${port2}/api/spaces`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `app_session=${token}` }, body: JSON.stringify({ name: 'A' }) })).json()).space.id;
  const asked = await fetch(`http://127.0.0.1:${port2}/api/spaces/${spaceId}/ai`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: `app_session=${token}` }, body: JSON.stringify({ question: 'hello there' }),
  });
  assert.equal(asked.status, 503);
  n += 1;
} finally {
  await new Promise((resolve) => { child2.once('exit', resolve); child2.kill('SIGTERM'); });
  fs.rmSync(unsetDir, { recursive: true, force: true });
}

console.log(`check-one-input: OK (${n} checks)`);
