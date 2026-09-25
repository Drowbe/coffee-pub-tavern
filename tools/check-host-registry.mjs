#!/usr/bin/env node
/*
 * check-host-registry.mjs -- run server/host-registry.js on its own: slugs, environments, host admins,
 * previousBaseDomains, and that a fresh registry (or a stale one) still loads to something sane. Then the
 * server itself, started with BASE_DOMAIN=localhost on a copy of an old-format hosted directory
 * (tools/fixtures/names-v1/host/): the host's Names migration on start, the console's /api/host/environments,
 * restores refusing hand-made newer backups, an environment refused at startup, and the pre-environment move.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { HostRegistry, HostError, cleanSlug } = require('../server/host-registry.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
const test = (name, fn) => { fn(); n += 1; };
const freshDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'host-registry-'));

test('a slug is 3 to 30 letters, digits and hyphens, and never a reserved word', () => {
  assert.equal(cleanSlug('acme'), 'acme');
  assert.equal(cleanSlug('  Acme-Adventures  '), 'acme-adventures');
  assert.throws(() => cleanSlug('ab'), HostError);
  assert.throws(() => cleanSlug('a'.repeat(31)), HostError);
  assert.throws(() => cleanSlug('-acme'), HostError);
  assert.throws(() => cleanSlug('acme-'), HostError);
  assert.throws(() => cleanSlug('has space'), HostError);
  assert.throws(() => cleanSlug('www'), HostError);
  assert.throws(() => cleanSlug('host'), HostError);
  assert.throws(() => cleanSlug('admin'), HostError);
});

test('a fresh registry has a session secret, no environments, no admins', () => {
  const dir = freshDir();
  const r = new HostRegistry(dir);
  assert.equal(typeof r.sessionSecret, 'string');
  assert.ok(r.sessionSecret.length >= 20);
  assert.deepEqual(r.listEnvironments(), []);
  assert.deepEqual(r.listAdmins(), []);
  assert.ok(fs.existsSync(path.join(dir, 'host.json')), 'a fresh registry is on disk right away, not only after a real change');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the same secret survives a reload, not a fresh one each time', () => {
  const dir = freshDir();
  const secret = new HostRegistry(dir).sessionSecret;
  assert.equal(new HostRegistry(dir).sessionSecret, secret);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('environments: add, find, update, remove', () => {
  const dir = freshDir();
  const r = new HostRegistry(dir);
  const t = r.addEnvironment({ slug: 'Acme', name: 'Acme Adventures' });
  assert.equal(t.slug, 'acme'); // cleaned
  assert.equal(t.status, 'active');
  assert.deepEqual(t.plan, { name: null, modules: 'all', members: null, storageBytes: null, aiCallsPerMonth: null, calls: null });
  assert.throws(() => r.addEnvironment({ slug: 'acme', name: 'Again' }), (e) => e instanceof HostError && e.status === 409);
  assert.deepEqual(r.findEnvironment('acme'), t);
  assert.equal(r.findEnvironment('nope'), null);

  const updated = r.updateEnvironment('acme', { name: 'Acme Inc', plan: { modules: ['places', 'travel'], members: 20 } });
  assert.equal(updated.name, 'Acme Inc');
  assert.deepEqual(updated.plan.modules, ['places', 'travel']);
  assert.equal(updated.plan.members, 20);
  assert.throws(() => r.updateEnvironment('nope', {}), (e) => e instanceof HostError && e.status === 404);

  const pastDue = r.updateEnvironment('acme', { status: 'pastDue' });
  assert.equal(pastDue.status, 'pastDue');
  assert.ok(pastDue.pastDueSince);
  const active = r.updateEnvironment('acme', { status: 'active' });
  assert.equal(active.pastDueSince, null);
  assert.throws(() => r.updateEnvironment('acme', { status: 'nonsense' }), HostError);

  r.removeEnvironment('acme');
  assert.equal(r.findEnvironment('acme'), null);
  assert.throws(() => r.removeEnvironment('acme'), (e) => e instanceof HostError && e.status === 404);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a freshly added environment already has the usage and delete-request defaults, not just a plan', () => {
  const dir = freshDir();
  const r = new HostRegistry(dir);
  const t = r.addEnvironment({ slug: 'acme', name: 'Acme' });
  assert.equal(t.deleteRequestedAt, null);
  assert.equal(t.deleteRequestReason, '');
  assert.deepEqual(t.usage, { storageBytes: 0, measuredAt: null, aiMonth: '', aiCalls: 0 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a deletion request is set and withdrawn, and shows on the environment record either way', () => {
  const dir = freshDir();
  const r = new HostRegistry(dir);
  r.addEnvironment({ slug: 'acme', name: 'Acme' });
  const set = r.requestEnvironmentDeletion('acme', 'moving on');
  assert.ok(set.deleteRequestedAt);
  assert.equal(set.deleteRequestReason, 'moving on');
  assert.ok(r.findEnvironment('acme').deleteRequestedAt);
  r.withdrawEnvironmentDeletion('acme');
  assert.equal(r.findEnvironment('acme').deleteRequestedAt, null);
  assert.equal(r.findEnvironment('acme').deleteRequestReason, '');
  assert.throws(() => r.requestEnvironmentDeletion('nope', ''), (e) => e instanceof HostError && e.status === 404);
  assert.throws(() => r.withdrawEnvironmentDeletion('nope'), (e) => e instanceof HostError && e.status === 404);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('storage usage is cached on the environment record, measuredAt set each time', () => {
  const dir = freshDir();
  const r = new HostRegistry(dir);
  r.addEnvironment({ slug: 'acme', name: 'Acme' });
  r.recordStorageUsage('acme', 1234.7);
  assert.equal(r.findEnvironment('acme').usage.storageBytes, 1235); // rounded
  assert.ok(r.findEnvironment('acme').usage.measuredAt);
  r.recordStorageUsage('nope', 999); // silently does nothing for an unknown slug
  fs.rmSync(dir, { recursive: true, force: true });
});

test('AI calls are counted per month, rolling over rather than accumulating forever', () => {
  const dir = freshDir();
  const r = new HostRegistry(dir);
  r.addEnvironment({ slug: 'acme', name: 'Acme' });
  assert.equal(r.aiCallsThisMonth('acme'), 0);
  r.recordAiCall('acme');
  r.recordAiCall('acme');
  assert.equal(r.aiCallsThisMonth('acme'), 2);
  const environment = r.data.environments.find((t) => t.slug === 'acme');
  environment.usage.aiMonth = '2000-01'; // simulate a stale month from before now
  environment.usage.aiCalls = 999;
  assert.equal(r.aiCallsThisMonth('acme'), 0); // a stale month never counts
  r.recordAiCall('acme');
  assert.equal(r.aiCallsThisMonth('acme'), 1); // rolled over, not added to the stale count
  assert.equal(r.aiCallsThisMonth('nope'), 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an environment record survives a reload, and a slug that no longer validates is dropped rather than crashing', () => {
  const dir = freshDir();
  new HostRegistry(dir).addEnvironment({ slug: 'acme', name: 'Acme' });
  assert.equal(new HostRegistry(dir).findEnvironment('acme').name, 'Acme');
  fs.writeFileSync(path.join(dir, 'host.json'), JSON.stringify({ environments: [{ slug: 'ok-one', name: 'Fine' }, { slug: 'a', name: 'Too short now' }] }));
  const reloaded = new HostRegistry(dir);
  assert.deepEqual(reloaded.listEnvironments().map((t) => t.slug), ['ok-one']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('host admins: add, find, remove, never the last one', () => {
  const dir = freshDir();
  const r = new HostRegistry(dir);
  const a = r.addAdmin({ login: 'Boss', passwordHash: 'x' });
  assert.equal(a.login, 'boss'); // cleaned
  assert.ok(a.key);
  assert.equal(r.findAdminByLogin('BOSS').key, a.key);
  assert.equal(r.findAdminByKey(a.key).login, 'boss');
  assert.throws(() => r.addAdmin({ login: 'boss', passwordHash: 'y' }), (e) => e instanceof HostError && e.status === 409);
  assert.throws(() => r.removeAdmin(a.key), /last host admin/);
  const b = r.addAdmin({ login: 'second', passwordHash: 'z' });
  r.removeAdmin(a.key);
  assert.equal(r.findAdminByKey(a.key), null);
  assert.equal(r.listAdmins().length, 1);
  assert.throws(() => r.removeAdmin('nope'), (e) => e instanceof HostError && e.status === 404);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('previousBaseDomains: set from a comma-separated string or an array, deduplicated', () => {
  const dir = freshDir();
  const r = new HostRegistry(dir);
  r.setPreviousBaseDomains('Old.example.com, ancient.example.com, old.example.com');
  assert.deepEqual(r.previousBaseDomains(), ['old.example.com', 'ancient.example.com']);
  r.setPreviousBaseDomains(['fresh.example.com']);
  assert.deepEqual(r.previousBaseDomains(), ['fresh.example.com']);
  r.setPreviousBaseDomains('');
  assert.deepEqual(r.previousBaseDomains(), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the plan catalog always has a free entry, even from nothing or a bad one', () => {
  const dir = freshDir();
  const r = new HostRegistry(dir);
  assert.deepEqual(r.plansCatalog(), { free: { name: 'Free', caps: { modules: 'all', members: null, storageBytes: null, aiCallsPerMonth: null, calls: null } } });
  const set = r.setPlansCatalog({ pro: { name: 'Pro', caps: { modules: 'all', members: 50, storageBytes: 1000, aiCallsPerMonth: 500, calls: 5 } } });
  assert.ok(set.free, 'free is synthesized back in even when left out of a PUT');
  assert.deepEqual(set.pro.caps, { modules: 'all', members: 50, storageBytes: 1000, aiCallsPerMonth: 500, calls: 5 });
  assert.deepEqual(r.setPlansCatalog(null), { free: { name: 'Free', caps: { modules: 'all', members: null, storageBytes: null, aiCallsPerMonth: null, calls: null } } });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('billing: paid takes the named plan from the catalog, lapsed/cancelled start the grace once', () => {
  const dir = freshDir();
  const r = new HostRegistry(dir);
  r.addEnvironment({ slug: 'acme', name: 'Acme' });
  r.setPlansCatalog({ pro: { name: 'Pro', caps: { modules: 'all', members: 50, storageBytes: null, aiCallsPerMonth: null, calls: 5 } } });

  const paid = r.applyBillingEvent('acme', 'pro', 'paid');
  assert.equal(paid.status, 'active');
  assert.deepEqual(paid.plan, { name: 'pro', modules: 'all', members: 50, storageBytes: null, aiCallsPerMonth: null, calls: 5 });

  const lapsed = r.applyBillingEvent('acme', 'pro', 'lapsed');
  assert.equal(lapsed.status, 'pastDue');
  assert.ok(lapsed.pastDueSince);
  const again = r.applyBillingEvent('acme', 'pro', 'lapsed');
  assert.equal(again.pastDueSince, lapsed.pastDueSince, 'a second lapsed event does not restart the grace clock');

  assert.throws(() => r.applyBillingEvent('acme', 'nope', 'paid'), HostError);
  assert.throws(() => r.applyBillingEvent('acme', 'pro', 'bogus'), HostError);
  assert.throws(() => r.applyBillingEvent('nope', 'pro', 'paid'), (e) => e instanceof HostError && e.status === 404);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the grace: an environment pastDue past 14 days is degraded to free, one still within it is left alone', () => {
  const dir = freshDir();
  const r = new HostRegistry(dir);
  r.addEnvironment({ slug: 'stale', name: 'Stale' });
  r.addEnvironment({ slug: 'fresh', name: 'Fresh' });
  r.setPlansCatalog({ free: { name: 'Free', caps: { modules: 'all', members: 3, storageBytes: null, aiCallsPerMonth: null, calls: null } } });
  r.applyBillingEvent('stale', 'free', 'lapsed');
  r.applyBillingEvent('fresh', 'free', 'lapsed');
  const staleEnvironment = r.data.environments.find((t) => t.slug === 'stale');
  staleEnvironment.pastDueSince = new Date(Date.now() - 15 * 86400000).toISOString();
  r.save();

  r.degradeStalePastDue();
  const stale = r.findEnvironment('stale');
  assert.equal(stale.status, 'active');
  assert.equal(stale.plan.name, 'free');
  assert.equal(stale.pastDueSince, null);
  assert.ok(stale.degradedAt);
  const fresh = r.findEnvironment('fresh');
  assert.equal(fresh.status, 'pastDue', 'still inside its 14-day grace, untouched');
  assert.equal(fresh.degradedAt, null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a host admin has a secretsKey from the start, 32 random bytes hex, stable across a reload', () => {
  const dir = freshDir();
  const key = new HostRegistry(dir).secretsKey;
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(new HostRegistry(dir).secretsKey, key);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a host admin's own second factor: start, enable, a step and a recovery code spent, disable", () => {
  const dir = freshDir();
  const r = new HostRegistry(dir);
  const a = r.addAdmin({ login: 'boss', passwordHash: 'x' });
  assert.equal(a.mfaEnrolled, false);
  assert.equal(r.listAdmins()[0].mfaEnrolled, false);

  r.hostAdminMfaStart(a.key, 'cipher-1');
  assert.equal(r.findAdminByKey(a.key).mfa.pending.secret, 'cipher-1');
  assert.equal(r.findAdminByKey(a.key).mfa.secret, null, 'unconfirmed until enable');

  const enabled = r.hostAdminMfaEnable(a.key, ['hash-1', 'hash-2']);
  assert.equal(enabled.secret, 'cipher-1');
  assert.equal(enabled.version, 1);
  assert.deepEqual(enabled.recovery, ['hash-1', 'hash-2']);
  assert.equal(r.listAdmins()[0].mfaEnrolled, true);
  assert.throws(() => r.hostAdminMfaEnable(a.key, []), HostError, 'nothing pending the second time');

  r.hostAdminMfaRecordStep(a.key, 42);
  assert.equal(r.findAdminByKey(a.key).mfa.lastStep, 42);

  r.hostAdminMfaSpendRecovery(a.key, 'hash-1');
  const afterSpend = r.findAdminByKey(a.key);
  assert.deepEqual(afterSpend.mfa.recovery, ['hash-2']);
  assert.equal(afterSpend.mfa.version, 2, 'spending a recovery code bumps version too');

  r.hostAdminMfaDisable(a.key);
  assert.equal(r.findAdminByKey(a.key).mfa, null);
  assert.equal(r.listAdmins()[0].mfaEnrolled, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- the server, hosted ---------------------------------------------------------------------------------------
const names = require('../server/migrate-names.js');
const { zipFiles } = require('../server/module-build.js');
const FIXTURE = path.join(ROOT, 'tools', 'fixtures', 'names-v1');
const HOST_LOGIN = 'boss';
const HOST_PASSWORD = 'check-host-password-1';
let failed = 0;
const liveTest = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`check-host-registry: ${name}: ${err.stack || err.message}`); }
};

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}

// Starts server/index.js on its own port and data directory; resolves once it is listening.
async function startServer(dataDir, env = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), DATA_DIR: dataDir, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 20000);
    const onData = () => { if (/listening on :/.test(out)) { clearTimeout(timer); resolve(); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
  return {
    port,
    output: () => out,
    stop: () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); }),
  };
}

// One request to the server as `host` (a subdomain of localhost, or '' for the bare base domain).
function call(server, host, method, urlPath, { body, type, cookie, accept } = {}) {
  const payload = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  const headers = { host: `${host ? `${host}.` : ''}localhost:${server.port}`, accept: accept || 'application/json' };
  if (payload) { headers['content-type'] = type || 'application/json'; headers['content-length'] = payload.length; }
  if (cookie) headers.cookie = cookie;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.port, method, path: urlPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(raw.toString('utf8')); } catch { json = null; }
        resolve({ status: res.statusCode, headers: res.headers, raw, text: raw.toString('utf8'), json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
async function signInHost(server) {
  const res = await call(server, 'admin', 'POST', '/api/host/login', { body: { login: HOST_LOGIN, password: HOST_PASSWORD } });
  assert.equal(res.status, 200, `host sign-in: ${res.text}`);
  return [].concat(res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
}

const liveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'host-registry-live-'));
const hostedEnv = { BASE_DOMAIN: 'localhost', HOST_ADMIN_LOGIN: HOST_LOGIN, HOST_ADMIN_PASSWORD: HOST_PASSWORD };
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
let server = null;
try {
  const data = path.join(liveDir, 'hosted');
  fs.cpSync(path.join(FIXTURE, 'host'), data, { recursive: true });
  const oldHost = readJson(path.join(data, 'host.json'));
  let cookie = '';
  let betaBackup = null;

  await liveTest('live: an old-format host migrates on start, and the console answers under /api/host/environments', async () => {
    server = await startServer(data, hostedEnv);
    const host = readJson(path.join(data, 'host.json'));
    assert.deepEqual(names.recordedParts(host), ['names-environment']);
    assert.equal('tenants' in host, false);
    assert.deepEqual(host.environments.map((e) => e.slug), oldHost.tenants.map((e) => e.slug));
    assert.ok(fs.existsSync(path.join(data, 'environments', 'acme', 'app.json')) && !fs.existsSync(path.join(data, 'tenants')));
    assert.ok(fs.existsSync(path.join(data, 'environments-deleted', 'gone-1767225600000')) && !fs.existsSync(path.join(data, 'tenants-deleted')));
    assert.ok(fs.existsSync(path.join(data, 'pre-names-host', 'names-environment', 'host.json')));
    cookie = await signInHost(server);
    assert.equal((await call(server, 'admin', 'GET', '/api/host/tenants', { cookie })).status, 404, 'the old route is gone, with no alias');
    const list = await call(server, 'admin', 'GET', '/api/host/environments', { cookie });
    assert.equal(list.status, 200);
    assert.equal('tenants' in list.json, false);
    assert.deepEqual(list.json.environments.map((e) => [e.slug, e.refused]), [['acme', null]]);
    assert.equal((await call(server, 'admin', 'GET', '/api/host/environments')).status, 401, 'signed out: refused');
    const made = await call(server, 'admin', 'POST', '/api/host/environments', { cookie, body: { slug: 'beta', name: 'Beta', owner: { login: 'owner', password: 'owner-password-1' } } });
    assert.equal(made.status, 201, made.text);
    assert.equal(made.json.environment.slug, 'beta');
    assert.ok(fs.existsSync(path.join(data, 'environments', 'beta', 'app.json')));
    const again = await call(server, 'admin', 'POST', '/api/host/environments', { cookie, body: { slug: 'beta', name: 'Beta' } });
    assert.deepEqual([again.status, again.json], [409, { error: '"beta" is already in use' }]);
    const edited = await call(server, 'admin', 'PATCH', '/api/host/environments/beta', { cookie, body: { name: 'Beta Two', plan: { members: 10 } } });
    assert.equal(edited.status, 200);
    assert.deepEqual([edited.json.environment.name, edited.json.environment.plan.members], ['Beta Two', 10]);
    assert.deepEqual((await call(server, 'admin', 'PATCH', '/api/host/environments/nope', { cookie, body: {} })).json, { error: 'no such environment' });
    const backup = await call(server, 'admin', 'POST', '/api/host/environments/beta/backup', { cookie });
    assert.equal(backup.status, 200);
    assert.equal(backup.headers['content-type'], 'application/zip');
    betaBackup = backup.raw;
    const signIn = await call(server, 'beta', 'POST', '/api/login', { body: { login: 'owner', password: 'owner-password-1' } });
    assert.equal(signIn.status, 200, `the new environment's owner signs in: ${signIn.text}`);
  });

  await liveTest('live: restore refuses each hand-made newer backup, and the environment is unchanged', async () => {
    const appFile = path.join(data, 'environments', 'beta', 'app.json');
    const good = fs.readFileSync(appFile);
    const newer = Buffer.from(JSON.stringify({ version: 2, migrations: [{ id: 'names-from-the-future', at: '', moved: [] }] }));
    const zips = {
      './app.json': [['./app.json', newer]],
      'a repeated app.json, the newer copy last': [['app.json', good], ['app.json', newer]],
      'tavern.json alone': [['tavern.json', newer]],
      'tavern.json beside a good app.json': [['app.json', good], ['tavern.json', newer]],
    };
    for (const [what, entries] of Object.entries(zips)) {
      const res = await call(server, 'admin', 'POST', '/api/host/environments/beta/restore', { cookie, body: zipFiles(entries), type: 'application/zip' });
      assert.deepEqual([res.status, res.json], [400, { error: 'This backup is from a newer version of Magpie.' }], what);
      assert.deepEqual(fs.readFileSync(appFile), good, `${what}: app.json unchanged`);
      assert.ok(!fs.existsSync(path.join(data, 'environments', 'beta', 'tavern.json')), `${what}: nothing landed`);
    }
    const empty = await call(server, 'admin', 'POST', '/api/host/environments/beta/restore', { cookie, body: Buffer.alloc(0), type: 'application/zip' });
    assert.deepEqual([empty.status, empty.json], [400, { error: 'choose a zip file to restore' }]);
    const missing = await call(server, 'admin', 'POST', '/api/host/environments/nope/restore', { cookie, body: betaBackup, type: 'application/zip' });
    assert.deepEqual([missing.status, missing.json], [404, { error: 'no such environment' }]);
  });

  await liveTest('live: an environment refused at startup is skipped, answers 503, and a good restore brings it back', async () => {
    await server.stop();
    const appFile = path.join(data, 'environments', 'beta', 'app.json');
    fs.writeFileSync(appFile, JSON.stringify({ ...readJson(appFile), version: 2, migrations: [{ id: 'names-from-the-future', at: '', moved: [] }] }));
    server = await startServer(data, hostedEnv);
    assert.match(server.output(), /names-from-the-future", which this version of Magpie does not know: this data is from a newer version of Magpie, so it will not be opened here\. This environment is skipped and answers 503/);
    const product = await call(server, '', 'GET', '/api/product/environments');
    assert.deepEqual(product.json.environments.map((e) => e.slug), ['acme'], 'left out of the sign-in list');
    const page = await call(server, 'beta', 'GET', '/', { accept: 'text/html' });
    assert.equal(page.status, 503);
    assert.match(page.headers['content-type'], /text\/html/);
    assert.ok(page.text.includes(names.REFUSED_NEWER), page.text);
    const api = await call(server, 'beta', 'GET', '/api/me');
    assert.deepEqual([api.status, api.json], [503, { error: "This environment's data is from a newer version of Magpie." }]);
    assert.equal((await call(server, 'acme', 'GET', '/api/me')).status, 401, 'the other environment still runs');
    cookie = await signInHost(server);
    const list = await call(server, 'admin', 'GET', '/api/host/environments', { cookie });
    const beta = list.json.environments.find((e) => e.slug === 'beta');
    assert.equal(beta.refused.reason, 'newer');
    assert.equal(beta.refused.file, 'environments/beta/app.json');
    assert.ok(beta.refused.message.includes('names-from-the-future') && !Number.isNaN(Date.parse(beta.refused.at)));
    assert.deepEqual(beta.usage, { members: null, storageBytes: null, aiCallsThisMonth: null, spaces: null });
    const restored = await call(server, 'admin', 'POST', '/api/host/environments/beta/restore', { cookie, body: betaBackup, type: 'application/zip' });
    assert.deepEqual([restored.status, restored.json], [200, { ok: true }]);
    const after = await call(server, 'admin', 'GET', '/api/host/environments', { cookie });
    assert.equal(after.json.environments.find((e) => e.slug === 'beta').refused, null);
    assert.deepEqual((await call(server, '', 'GET', '/api/product/environments')).json.environments.map((e) => e.slug), ['acme', 'beta']);
    assert.equal((await call(server, 'beta', 'GET', '/api/me')).status, 401, 'opens again, without a restart');
  });

  await liveTest('live: delete moves the environment to environments-deleted/', async () => {
    const res = await call(server, 'admin', 'DELETE', '/api/host/environments/beta', { cookie });
    assert.deepEqual([res.status, res.json], [200, { ok: true }]);
    assert.ok(!fs.existsSync(path.join(data, 'environments', 'beta')));
    assert.ok(fs.readdirSync(path.join(data, 'environments-deleted')).some((d) => d.startsWith('beta-')));
    await server.stop();
    server = null;
    const before = fs.readFileSync(path.join(data, 'host.json'), 'utf8');
    server = await startServer(data, hostedEnv);
    assert.deepEqual(names.recordedParts(readJson(path.join(data, 'host.json'))), ['names-environment'], 'a later start records nothing more');
    assert.equal(JSON.parse(before).migrations.length, 1);
    await server.stop();
    server = null;
  });

  const moves = [
    ['MIGRATE_TENANT_SLUG', { MIGRATE_TENANT_SLUG: 'keep' }, true],
    ['MIGRATE_ENVIRONMENT_SLUG', { MIGRATE_ENVIRONMENT_SLUG: 'keep' }, false],
    ['both set, the new name winning', { MIGRATE_ENVIRONMENT_SLUG: 'keep', MIGRATE_TENANT_SLUG: 'old-name' }, true],
  ];
  for (const [what, vars, logs] of moves) {
    await liveTest(`live: the pre-environment move with ${what}`, async () => {
      const single = path.join(liveDir, `single-${what.replace(/\W+/g, '-')}`);
      fs.cpSync(FIXTURE, single, { recursive: true, filter: (src) => !path.relative(FIXTURE, src).startsWith('host') });
      server = await startServer(single, { ...hostedEnv, ...vars });
      assert.equal(/MIGRATE_TENANT_SLUG is now MIGRATE_ENVIRONMENT_SLUG; the old name stops working in a later release\./.test(server.output()), logs, server.output());
      assert.ok(fs.existsSync(path.join(single, 'environments', 'keep', 'app.json')) && !fs.existsSync(path.join(single, 'app.json')));
      assert.ok(!fs.existsSync(path.join(single, 'environments', 'old-name')), 'only the new name is used');
      assert.ok(fs.existsSync(path.join(single, 'environments', 'keep', 'modules', 'todo', 'data', 'room-keep01.json')));
      const host = readJson(path.join(single, 'host.json'));
      assert.deepEqual(host.environments.map((e) => e.slug), ['keep']);
      assert.deepEqual(host.migrations.map((m) => [m.id, m.moved]), [['names-environment', []]]);
      assert.equal(fs.existsSync(path.join(single, 'pre-names-host')), false, 'nothing old to copy');
      assert.equal((await call(server, 'keep', 'GET', '/api/me')).status, 401, 'the moved environment opens');
      await server.stop();
      server = null;
    });
  }
} finally {
  if (server) await server.stop();
  fs.rmSync(liveDir, { recursive: true, force: true });
}

if (failed) {
  console.error(`check-host-registry: ${failed} group${failed === 1 ? '' : 's'} failed`);
  process.exit(1);
}
console.log(`check-host-registry: ${n} groups OK`);
