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

// Starts server/index.js on its own data directory with PORT=0, so the system gives it a free port on every address it
// binds (nothing to reserve first, and no other session can take it in between); resolves once it is listening, with
// the port it logged.
async function startServer(dataDir, env = {}) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ...env },
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
  return {
    port,
    output: () => out,
    stop: () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); }),
  };
}

// One request to the server as `host` (a subdomain of localhost, or '' for the bare base domain).
function call(server, host, method, urlPath, { body, type, cookie, accept, bearer } = {}) {
  const payload = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  const headers = { host: `${host ? `${host}.` : ''}localhost:${server.port}`, accept: accept || 'application/json' };
  if (payload) { headers['content-type'] = type || 'application/json'; headers['content-length'] = payload.length; }
  if (cookie) headers.cookie = cookie;
  if (bearer) headers.authorization = `Bearer ${bearer}`;
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
const hostedEnv = { BASE_DOMAIN: 'localhost', ADMIN_LOGIN: HOST_LOGIN, ADMIN_PASSWORD: HOST_PASSWORD };
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
    assert.deepEqual(list.json.environments.map((e) => [e.slug, e.refused]), [['acme', null], ['bravo', null]]);
    // Each environment's own part (names-table) runs when it is built: the old settings gone, recorded once, the copy kept.
    for (const slug of ['acme', 'bravo']) {
      assert.equal((await call(server, slug, 'GET', '/api/branding')).status, 200);
      const envDir = path.join(data, 'environments', slug);
      const app = readJson(path.join(envDir, 'app.json'));
      assert.equal(app.version, 2, `${slug}: version 2`);
      assert.deepEqual(names.recordedParts(app), ['names-table', 'names-roles'], `${slug}: each environment part recorded once`);
      assert.equal('tableName' in app.settings || 'room' in app.settings, false, `${slug}: tableName and room gone`);
      assert.ok('tableName' in readJson(path.join(envDir, 'pre-names', 'names-table', 'app.json')).settings, `${slug}: the original kept`);
    }
    // names-roles in acme: its owner, member and the host admin's stand-in.
    const acme = readJson(path.join(data, 'environments', 'acme', 'app.json'));
    assert.deepEqual(acme.users.map((u) => [u.login, u.role]), [['owner', 'owner'], ['pat', 'member'], ['boss', 'admin']]);
    assert.deepEqual(acme.settings.roles, { member: { startAside: true }, guest: { react: false } });
    assert.equal((await call(server, 'admin', 'GET', '/api/host/environments')).status, 401, 'signed out: refused');
    const made = await call(server, 'admin', 'POST', '/api/host/environments', { cookie, body: { slug: 'beta', name: 'Beta', owner: { login: 'owner', password: 'owner-password-1' } } });
    assert.equal(made.status, 201, made.text);
    assert.equal(made.json.environment.slug, 'beta');
    assert.ok(fs.existsSync(path.join(data, 'environments', 'beta', 'app.json')));
    const betaApp = readJson(path.join(data, 'environments', 'beta', 'app.json'));
    assert.deepEqual(betaApp.migrations.map((m) => [m.id, m.moved]), [['names-table', []], ['names-roles', []]], 'a new environment records its parts as run, moving nothing');
    assert.deepEqual(betaApp.users.map((u) => [u.login, u.role]), [['owner', 'owner']], 'the owner the console makes is an owner');
    assert.ok(!fs.existsSync(path.join(data, 'environments', 'beta', 'pre-names')), 'and keeps no copy');
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

  // --- roles (plan-names step 4), in acme as the fixture left it: an owner, a member, the host admin's stand-in ---
  const cookieOf = (res) => [].concat(res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  await liveTest('live: roles in an environment: the owner and the host admin\'s sign-in have every right, a member does not, an environment may have no owner, and Studio\'s bearer requests get the old role values', async () => {
    const signIn = async (login, password) => {
      const res = await call(server, 'acme', 'POST', '/api/login', { body: { login, password } });
      assert.equal(res.status, 200, `${login} signs in: ${res.text}`);
      return { cookie: cookieOf(res), token: res.json.token, key: res.json.user.key, role: res.json.user.role };
    };
    const owner = await signIn('owner', 'fixture-owner-password-1');
    const member = await signIn('pat', 'fixture-owner-password-1');
    const boss = await signIn(HOST_LOGIN, HOST_PASSWORD);
    assert.deepEqual([owner.role, member.role, boss.role], ['owner', 'member', 'admin']);
    const acmeFile = path.join(data, 'environments', 'acme', 'app.json');
    assert.deepEqual(readJson(acmeFile).users.filter((u) => u.hostAdmin).map((u) => [u.login, u.role]), [['boss', 'admin']], 'the host admin\'s sign-in is stored as admin, and no second stand-in is made');
    for (const [who, s] of [['owner', owner], ['host admin', boss]]) {
      for (const [method, url] of [['GET', '/api/users'], ['GET', '/api/roles'], ['GET', '/api/settings'], ['GET', '/api/modules'], ['GET', '/api/status']]) {
        assert.equal((await call(server, 'acme', method, url, { cookie: s.cookie })).status, 200, `${who}: ${method} ${url}`);
      }
      const me = (await call(server, 'acme', 'GET', '/api/me', { cookie: s.cookie })).json;
      assert.ok(Object.values(me.user.permissions).every(Boolean), `${who}: every permission`);
      assert.equal(typeof me.streamKey, 'string', `${who}: the stream key`);
    }
    const ownerMe = (await call(server, 'acme', 'GET', '/api/me', { cookie: owner.cookie })).json;
    assert.deepEqual([ownerMe.user.role, ownerMe.environment.owner, ownerMe.environment.hostAdmin], ['owner', true, false]);
    const bossMe = (await call(server, 'acme', 'GET', '/api/me', { cookie: boss.cookie })).json;
    assert.deepEqual([bossMe.user.role, bossMe.environment.owner, bossMe.environment.hostAdmin], ['admin', false, true]);
    for (const url of ['/api/users', '/api/roles', '/api/settings']) {
      assert.deepEqual(await call(server, 'acme', 'GET', url, { cookie: member.cookie }).then((r) => [r.status, r.json]), [403, { error: 'owners only' }], `member: ${url}`);
    }
    assert.equal((await call(server, 'acme', 'GET', '/admin', { cookie: member.cookie, accept: 'text/html' })).text, 'Owners only.');
    const memberMe = (await call(server, 'acme', 'GET', '/api/me', { cookie: member.cookie })).json;
    assert.equal(memberMe.streamKey, undefined, 'a member gets no stream key');
    assert.equal(memberMe.user.permissions.startAside, true, 'the custom member permission (was settings.roles.user) applies');
    const roles = (await call(server, 'acme', 'GET', '/api/roles', { cookie: owner.cookie })).json.roles;
    assert.deepEqual(Object.keys(roles), ['owner', 'moderator', 'member', 'guest']);
    assert.equal(roles.guest.react, false);
    assert.deepEqual((await call(server, 'acme', 'PATCH', '/api/roles/member', { cookie: owner.cookie, body: { canInvite: true } })).json.roles.member.canInvite, true);
    assert.deepEqual(await call(server, 'acme', 'PATCH', '/api/roles/user', { cookie: owner.cookie, body: { canInvite: true } }).then((r) => [r.status, r.json]), [404, { error: 'no such role' }]);
    assert.deepEqual(await call(server, 'acme', 'PATCH', '/api/roles/owner', { cookie: owner.cookie, body: { chat: false } }).then((r) => [r.status, r.json]), [400, { error: "the owner has every permission, so that role can't be changed" }]);

    // No owner is fine (plan-names, Roles): the host admin demotes acme's only owner, the environment keeps working, and makes it owner again.
    assert.equal((await call(server, 'acme', 'PATCH', `/api/users/${owner.key}`, { cookie: boss.cookie, body: { role: 'member' } })).json.user.role, 'member', 'the last owner can be demoted');
    assert.equal(readJson(acmeFile).users.filter((u) => u.role === 'owner').length, 0, 'acme has no owner');
    assert.equal((await call(server, 'acme', 'GET', '/api/users', { cookie: boss.cookie })).status, 200, 'and the host admin still runs it');
    assert.equal((await call(server, 'acme', 'PATCH', `/api/users/${owner.key}`, { cookie: boss.cookie, body: { role: 'owner' } })).json.user.role, 'owner');
    assert.deepEqual(await call(server, 'acme', 'PATCH', `/api/users/${boss.key}`, { cookie: owner.cookie, body: { role: 'member' } }).then((r) => [r.status, r.json]), [400, { error: "this account is the host admin's, so its role can't be changed here" }]);
    assert.deepEqual(await call(server, 'acme', 'PATCH', `/api/users/${member.key}`, { cookie: owner.cookie, body: { role: 'user' } }).then((r) => [r.status, r.json]), [400, { error: 'role must be owner or member' }]);
    assert.deepEqual(await call(server, 'acme', 'PATCH', `/api/users/${member.key}`, { cookie: owner.cookie, body: { role: 'admin' } }).then((r) => [r.status, r.json]), [400, { error: 'role must be owner or member' }]);
    assert.deepEqual(await call(server, 'acme', 'PATCH', `/api/users/${owner.key}`, { cookie: owner.cookie, body: { role: 'member' } }).then((r) => [r.status, r.json]), [400, { error: 'you cannot demote yourself' }]);
    const made = await call(server, 'acme', 'POST', '/api/users', { cookie: owner.cookie, body: { login: 'newbie', password: 'newbie-password-1' } });
    assert.deepEqual([made.status, made.json.user.role], [201, 'member'], 'an account made with no role is a member');
    assert.deepEqual(await call(server, 'acme', 'POST', '/api/users', { cookie: owner.cookie, body: { login: 'sneaky', role: 'admin' } }).then((r) => [r.status, r.json]), [400, { error: 'role must be owner or member' }], 'nobody is made admin by hand');
    assert.equal((await call(server, 'acme', 'PATCH', `/api/users/${member.key}`, { cookie: owner.cookie, body: { role: 'owner' } })).json.user.role, 'owner');
    assert.equal((await call(server, 'acme', 'PATCH', `/api/users/${member.key}`, { cookie: boss.cookie, body: { role: 'member' } })).json.user.role, 'member', 'with two owners, one can step down');

    // The Studio alias: a bearer request answers the old role values, the pages' cookie request the new ones.
    const bearerMe = (await call(server, 'acme', 'GET', '/api/me', { bearer: owner.token })).json;
    assert.deepEqual([bearerMe.user.role, typeof bearerMe.streamKey], ['admin', 'string'], 'Studio reads admin for an owner, and gets the stream key');
    assert.equal((await call(server, 'acme', 'GET', '/api/me', { bearer: boss.token })).json.user.role, 'admin');
    assert.equal((await call(server, 'acme', 'GET', '/api/me', { bearer: member.token })).json.user.role, 'user');
    const bearerStatus = (await call(server, 'acme', 'GET', '/api/status', { bearer: owner.token })).json;
    const cookieStatus = (await call(server, 'acme', 'GET', '/api/status', { cookie: owner.cookie })).json;
    const byLogin = (st) => Object.fromEntries(st.users.map((u) => [u.login, u.role]));
    assert.deepEqual(byLogin(bearerStatus), { owner: 'admin', pat: 'user', boss: 'admin', newbie: 'user' });
    assert.deepEqual(byLogin(cookieStatus), { owner: 'owner', pat: 'member', boss: 'admin', newbie: 'member' });
    assert.equal((await call(server, 'acme', 'GET', '/api/status', { bearer: member.token })).status, 403, 'a member\'s bearer token is no stream access');
    const streamKey = ownerMe.streamKey;
    const byKey = (await call(server, 'acme', 'GET', `/api/status?s=${encodeURIComponent(streamKey)}`)).json;
    assert.deepEqual(byLogin(byKey), byLogin(cookieStatus), 'the stream key alone signs nobody in: the new values');
    assert.equal((await call(server, 'acme', 'DELETE', `/api/users/${made.json.user.key}`, { cookie: owner.cookie })).status, 200);
  });

  await liveTest('live: restore refuses each hand-made newer or unreadable backup, and the environment is unchanged', async () => {
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
    const unreadable = {
      'app.json that is not JSON': [['app.json', Buffer.from('{ not json')]],
      'app.json holding a list': [['app.json', Buffer.from('[]')]],
      'app.json holding null': [['./app.json', Buffer.from('null')]],
      'tavern.json alone, not JSON': [['tavern.json', Buffer.from('{ not')], ['images/x.png', Buffer.from('x')]],
      'a good app.json, then a broken one landing last': [['app.json', good], ['app.json', Buffer.from('"text"')]],
    };
    for (const [what, entries] of Object.entries(unreadable)) {
      const res = await call(server, 'admin', 'POST', '/api/host/environments/beta/restore', { cookie, body: zipFiles(entries), type: 'application/zip' });
      assert.deepEqual([res.status, res.json], [400, { error: "This backup's data can't be read, so nothing was restored." }], what);
      assert.deepEqual(fs.readFileSync(appFile), good, `${what}: app.json unchanged`);
      assert.ok(!fs.existsSync(path.join(data, 'environments', 'beta', 'tavern.json')) && !fs.existsSync(path.join(data, 'environments', 'beta', 'images', 'x.png')), `${what}: nothing landed`);
    }
    assert.equal((await call(server, 'beta', 'POST', '/api/login', { body: { login: 'owner', password: 'owner-password-1' } })).status, 200, 'the environment still opens, as it was');
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
    assert.deepEqual(product.json.environments.map((e) => e.slug), ['acme', 'bravo'], 'left out of the sign-in list');
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
    assert.deepEqual((await call(server, '', 'GET', '/api/product/environments')).json.environments.map((e) => e.slug), ['acme', 'beta', 'bravo']);
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

  // --- call names against a stand-in LiveKit (plan-names decision 14; QA on step 3) ---
  // A small Twirp JSON server answering ListRooms and ListParticipants from `calls` ({ name: [identity, ...] }), so
  // the calls cap and callsNow can be checked with other environments' calls running beside this one's.
  const calls = {};
  const standIn = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const ask = body ? JSON.parse(body) : {};
      let answer = {};
      if (req.url.endsWith('/ListRooms')) answer = { rooms: Object.entries(calls).map(([name, people]) => ({ sid: `RM_${name}`, name, numParticipants: people.length })) };
      else if (req.url.endsWith('/ListParticipants')) answer = { participants: (calls[ask.room] || []).map((identity) => ({ sid: `PA_${identity}`, identity, name: identity, joinedAt: '1', permission: { hidden: false }, tracks: [], attributes: {} })) };
      else { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(answer));
    });
  });
  await new Promise((resolve) => standIn.listen(0, '127.0.0.1', resolve));
  const setCalls = (next) => { for (const k of Object.keys(calls)) delete calls[k]; Object.assign(calls, next); };
  try {
    await liveTest('live: the calls cap and callsNow count only this environment\'s calls, never another\'s that starts with its slug', async () => {
      const data = path.join(liveDir, 'calls');
      fs.mkdirSync(data);
      server = await startServer(data, { ...hostedEnv, LIVEKIT_API_URL: `http://127.0.0.1:${standIn.address().port}` });
      const hostCookie = await signInHost(server);
      for (const slug of ['acme', 'acme-aside', 'acme-table']) {
        const made = await call(server, 'admin', 'POST', '/api/host/environments', { cookie: hostCookie, body: { slug, name: slug, owner: { login: 'owner', password: 'owner-password-1' } } });
        assert.equal(made.status, 201, made.text);
      }
      assert.equal((await call(server, 'admin', 'PATCH', '/api/host/environments/acme', { cookie: hostCookie, body: { plan: { calls: 1 } } })).status, 200);
      const signIn = await call(server, 'acme', 'POST', '/api/login', { body: { login: 'owner', password: 'owner-password-1' } });
      const owner = [].concat(signIn.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
      const ownerKey = signIn.json.user.key;
      const keep = (await call(server, 'acme', 'POST', '/api/rooms', { cookie: owner, body: { name: 'The Keep' } })).json.room.id;
      const callsNow = async () => (await call(server, 'acme', 'GET', '/api/environment', { cookie: owner })).json.usage.callsNow;
      const token = (room) => call(server, 'acme', 'POST', '/api/token', { cookie: owner, body: { room } });

      // Other environments' calls only: new names of acme-aside and acme-table, their old shapes, and QA's acme-table-lobby.
      setCalls({ 'acme-aside.lobby': ['x1'], 'acme-table.lobby': ['x2'], 'acme-aside-table': ['x3'], 'acme-table-table': ['x4'], [`acme-table-table-${keep}`]: ['x5'], 'acme-table-lobby': ['x6'], lobby: ['x7'] });
      assert.equal(await callsNow(), 0, 'none of them is acme\'s');
      const first = await token('lobby');
      assert.equal(first.status, 200, `acme's owner is not refused by other environments' calls: ${first.text}`);
      assert.equal(first.json.room, 'acme.lobby', 'the new hosted name');
      assert.equal((await token(keep)).json.room, `acme.${keep}`);
      const presence = (await call(server, 'acme', 'GET', '/api/presence', { cookie: owner })).json;
      assert.equal(presence.users.find((u) => u.key === ownerKey).online, false, 'nobody in another environment\'s call is placed here');

      // One of acme's own calls running: counted, and a second is refused, while joining the running one is not.
      setCalls({ 'acme-aside.lobby': ['x1'], [`acme.${keep}`]: [ownerKey] });
      assert.equal(await callsNow(), 1);
      const refused = await token('lobby');
      assert.deepEqual([refused.status, refused.json], [403, { error: 'This environment\'s plan allows 1 call at once; one is running in The Keep' }]);
      assert.equal((await token(keep)).status, 200, 'joining the running call is never refused');
      const placed = (await call(server, 'acme', 'GET', '/api/presence', { cookie: owner })).json.users.find((u) => u.key === ownerKey);
      assert.deepEqual([placed.online, placed.room], [true, keep]);

      // acme's own call under its old name (someone in it across the upgrade): counted and placed, and joining it is joining.
      setCalls({ 'acme-table': [ownerKey], 'acme-aside-table': ['x3'] });
      assert.equal(await callsNow(), 1);
      assert.equal((await token('lobby')).status, 200, 'the Lobby\'s call is running under its old name: joining');
      assert.equal((await token(keep)).status, 403, 'a second call is refused');
      assert.equal((await call(server, 'acme', 'GET', '/api/presence', { cookie: owner })).json.users.find((u) => u.key === ownerKey).room, 'lobby');
      await server.stop();
      server = null;
    });
  } finally {
    standIn.close();
  }

  // --- an app.json that is there but is not valid JSON is refused, never started as empty ---
  await liveTest('live: a hosted environment whose app.json is not valid JSON answers 503, the others run, and the file is untouched', async () => {
    const data = path.join(liveDir, 'calls');
    const appFile = path.join(data, 'environments', 'acme-table', 'app.json');
    fs.writeFileSync(appFile, '{ not json');
    server = await startServer(data, hostedEnv);
    assert.ok(server.output().includes(`${appFile} is not valid JSON`) && server.output().includes('Fix or restore this file, then start again.'), server.output());
    const api = await call(server, 'acme-table', 'GET', '/api/me');
    assert.deepEqual([api.status, api.json], [503, { error: names.REFUSED_UNREADABLE }]);
    assert.equal((await call(server, 'acme', 'GET', '/api/me')).status, 401, 'the other environments still run');
    const list = await call(server, 'admin', 'GET', '/api/host/environments', { cookie: await signInHost(server) });
    const refused = list.json.environments.find((e) => e.slug === 'acme-table').refused;
    assert.deepEqual([refused.reason, refused.file], ['unreadable', 'environments/acme-table/app.json']);
    assert.equal(fs.readFileSync(appFile, 'utf8'), '{ not json', 'never written over');
    await server.stop();
    server = null;
  });

  // --- the server's admin (plan-names decision 7, amended): ADMIN_LOGIN and ADMIN_PASSWORD on every install ---
  const OLD_LINE = (old, now) => `${old} is now ${now}; the old name stops working in a later release.`;
  const OWNER_IGNORED = "OWNER_PASSWORD is ignored: owners are made in Manage. Use ADMIN_PASSWORD for the server's admin.";
  const signInSingle = async (login, password) => {
    const res = await call(server, '', 'POST', '/api/login', { body: { login, password } });
    return res.status === 200 ? { cookie: cookieOf(res), key: res.json.user.key, role: res.json.user.role } : res.status;
  };

  await liveTest('live: hosted: ADMIN_LOGIN and ADMIN_PASSWORD make the host admin and reset its password on each start, leaving other host admins alone; HOST_ADMIN_* still work, logged; OWNER_PASSWORD is ignored', async () => {
    const hosted = path.join(liveDir, 'hosted-admin');
    const hostIn = async (login, password) => (await call(server, 'admin', 'POST', '/api/host/login', { body: { login, password } })).status;
    // Only the old names: they still make the host admin, and say so.
    server = await startServer(hosted, { BASE_DOMAIN: 'localhost', HOST_ADMIN_LOGIN: 'boss', HOST_ADMIN_PASSWORD: 'host-password-1', OWNER_PASSWORD: 'never-used-1' });
    for (const line of [OLD_LINE('HOST_ADMIN_LOGIN', 'ADMIN_LOGIN'), OLD_LINE('HOST_ADMIN_PASSWORD', 'ADMIN_PASSWORD'), OWNER_IGNORED, 'Host admin "boss" created from the environment.']) assert.ok(server.output().includes(line), `${line}\n${server.output()}`);
    assert.equal(await hostIn('boss', 'host-password-1'), 200);
    const bossCookie = cookieOf(await call(server, 'admin', 'POST', '/api/host/login', { body: { login: 'boss', password: 'host-password-1' } }));
    assert.equal((await call(server, 'admin', 'POST', '/api/host/admins', { cookie: bossCookie, body: { login: 'second', password: 'second-password-1' } })).status, 201, 'a second host admin, made on the console');
    await server.stop();
    // The new names, same login, new password: reset, and the second host admin untouched.
    const before = readJson(path.join(hosted, 'host.json')).hostAdmins.find((a) => a.login === 'second');
    server = await startServer(hosted, { BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'boss', ADMIN_PASSWORD: 'host-password-2' });
    assert.ok(server.output().includes('Host admin "boss" password reset from the environment.'), server.output());
    assert.ok(!/is now ADMIN_/.test(server.output()), 'no old name set, no line');
    assert.equal(await hostIn('boss', 'host-password-1'), 401);
    assert.equal(await hostIn('boss', 'host-password-2'), 200);
    assert.equal(await hostIn('second', 'second-password-1'), 200, 'the other host admin still signs in');
    assert.deepEqual(readJson(path.join(hosted, 'host.json')).hostAdmins.find((a) => a.login === 'second'), before, 'and is exactly as it was');
    assert.equal(readJson(path.join(hosted, 'host.json')).hostAdmins.length, 2);
    await server.stop();
    // The same again: nothing to do. A new login: another host admin made beside the others.
    server = await startServer(hosted, { BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'boss', ADMIN_PASSWORD: 'host-password-2', TAVERN_ADMIN_USER: 'x', TAVERN_ADMIN_PASSWORD: 'y', ADMIN_MFA_LOCKOUT_BYPASS: 'true' });
    assert.ok(!/Host admin "boss" (created|password reset)/.test(server.output()), server.output());
    assert.ok(server.output().includes('TAVERN_ADMIN_USER, TAVERN_ADMIN_PASSWORD are ignored on a server with environments: use ADMIN_LOGIN and ADMIN_PASSWORD for the host admin.'), server.output());
    assert.ok(server.output().includes('The lockout bypass (ADMIN_MFA_LOCKOUT_BYPASS) is on: every owner and host admin skips'), 'hosted: the host admins');
    await server.stop();
    server = await startServer(hosted, { BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'chief', ADMIN_PASSWORD: 'chief-password-1', ADMIN_USER: 'ignored-here' });
    assert.ok(server.output().includes('Host admin "chief" created from the environment.'));
    assert.ok(!server.output().includes('ADMIN_USER is now'), 'a hosted server does not read ADMIN_USER, as before');
    assert.ok(server.output().includes('ADMIN_USER is ignored on a server with environments: use ADMIN_LOGIN and ADMIN_PASSWORD for the host admin.'), 'and says it is ignored');
    assert.deepEqual(readJson(path.join(hosted, 'host.json')).hostAdmins.map((a) => a.login), ['boss', 'second', 'chief']);
    assert.equal(await hostIn('boss', 'host-password-2'), 200);
    await server.stop();
    server = null;
  });

  await liveTest('live: a single install moved into an environment: its admin becomes that environment\'s owner, and the host admin is the server\'s admin', async () => {
    const single = path.join(liveDir, 'single-then-hosted');
    server = await startServer(single, { ADMIN_LOGIN: 'gm', ADMIN_PASSWORD: 'admin-password-1' });
    await server.stop();
    server = await startServer(single, { ...hostedEnv, MIGRATE_ENVIRONMENT_SLUG: 'keep' });
    assert.ok(server.output().includes('The install\'s admin ("gm") is now the "keep" environment\'s owner; the server\'s admin is the host admin.'), server.output());
    const users = readJson(path.join(single, 'environments', 'keep', 'app.json')).users;
    assert.deepEqual(users.map((u) => [u.login, u.role]), [['gm', 'owner']]);
    const res = await call(server, 'keep', 'POST', '/api/login', { body: { login: 'gm', password: 'admin-password-1' } });
    assert.deepEqual([res.status, res.json.user.role], [200, 'owner']);
    assert.equal((await call(server, 'admin', 'POST', '/api/host/login', { body: { login: HOST_LOGIN, password: HOST_PASSWORD } })).status, 200);
    await server.stop();
    server = null;
  });

  await liveTest('live: a single install: ADMIN_LOGIN and ADMIN_PASSWORD make the admin, reset its password on each start, and it has every right and a fixed role', async () => {
    const single = path.join(liveDir, 'single-admin');
    server = await startServer(single, { ADMIN_LOGIN: 'gm', ADMIN_PASSWORD: 'admin-password-1', OWNER_PASSWORD: 'never-used-1', ADMIN_MFA_LOCKOUT_BYPASS: 'true' });
    assert.ok(server.output().includes("The lockout bypass (ADMIN_MFA_LOCKOUT_BYPASS) is on: every owner and the server's admin skips two-step sign-in entirely."), server.output());
    assert.ok(server.output().includes('Admin "gm" created from the environment.'), server.output());
    assert.ok(server.output().includes(OWNER_IGNORED), 'OWNER_PASSWORD: logged as ignored');
    assert.equal(await signInSingle('gm', 'never-used-1'), 401, 'OWNER_PASSWORD is not used');
    const gm = await signInSingle('gm', 'admin-password-1');
    assert.equal(gm.role, 'admin');
    const me = (await call(server, '', 'GET', '/api/me', { cookie: gm.cookie })).json;
    assert.deepEqual([me.user.role, me.environment.owner, me.environment.hostAdmin, typeof me.streamKey], ['admin', false, false, 'string']);
    assert.ok(Object.values(me.user.permissions).every(Boolean), 'every permission');
    for (const url of ['/api/users', '/api/roles', '/api/settings', '/api/modules', '/api/status']) assert.equal((await call(server, '', 'GET', url, { cookie: gm.cookie })).status, 200, url);
    assert.equal(readJson(path.join(single, 'app.json')).users.filter((u) => u.role === 'owner').length, 0, 'no owner, and that is fine');
    // An owner made in Manage works, and cannot change the admin.
    const made = await call(server, '', 'POST', '/api/users', { cookie: gm.cookie, body: { login: 'olive', role: 'owner', password: 'olive-password-1' } });
    assert.deepEqual([made.status, made.json.user.role], [201, 'owner']);
    const olive = await signInSingle('olive', 'olive-password-1');
    assert.equal((await call(server, '', 'GET', '/api/users', { cookie: olive.cookie })).status, 200, 'the owner runs Manage');
    const refused = async (method, url, body) => { const r = await call(server, '', method, url, { cookie: olive.cookie, body }); return [r.status, r.json]; };
    assert.deepEqual(await refused('PATCH', `/api/users/${gm.key}`, { role: 'owner' }), [400, { error: "this account is the server's admin, so its role can't be changed here" }]);
    assert.deepEqual(await refused('PATCH', `/api/users/${gm.key}`, { password: 'taken-over-1' }), [400, { error: "this account is the server's admin: it signs in with ADMIN_LOGIN and ADMIN_PASSWORD, so its sign-in can't be changed here" }]);
    assert.deepEqual(await refused('PATCH', `/api/users/${gm.key}`, { login: 'someone' }), [400, { error: "this account is the server's admin: it signs in with ADMIN_LOGIN and ADMIN_PASSWORD, so its sign-in can't be changed here" }]);
    assert.deepEqual(await refused('POST', `/api/users/${gm.key}/link`), [400, { error: "this account is the server's admin: it signs in with ADMIN_LOGIN and ADMIN_PASSWORD, so its sign-in can't be changed here" }]);
    assert.deepEqual(await refused('DELETE', `/api/users/${gm.key}`), [400, { error: "this account is the server's admin, so it can't be removed here" }]);
    assert.deepEqual(await refused('DELETE', `/api/users/${gm.key}/mfa`), [400, { error: "this account is the server's admin: it recovers its two-step sign-in with ADMIN_PASSWORD and the lockout bypass, so it can't be reset here" }]);
    assert.equal((await call(server, '', 'DELETE', `/api/users/${olive.key}/mfa`, { cookie: gm.cookie })).status, 200, 'an owner\'s reset of another account still works');
    assert.equal((await call(server, '', 'PATCH', `/api/users/${gm.key}`, { cookie: olive.cookie, body: { displayName: 'Game Master' } })).json.user.displayName, 'Game Master', 'its name can be changed');
    assert.equal((await call(server, '', 'PATCH', `/api/users/${olive.key}`, { cookie: gm.cookie, body: { role: 'member' } })).json.user.role, 'member', 'the admin demotes the only owner: no owner is fine');
    const bearer = (await call(server, '', 'GET', '/api/me', { bearer: (await call(server, '', 'POST', '/api/login', { body: { login: 'gm', password: 'admin-password-1' } })).json.token })).json;
    assert.equal(bearer.user.role, 'admin', 'Studio reads admin');
    await server.stop();
    // The same password again: nothing to do, and nobody signed out.
    server = await startServer(single, { ADMIN_LOGIN: 'gm', ADMIN_PASSWORD: 'admin-password-1' });
    assert.ok(!/Admin "gm" (created|updated)/.test(server.output()), server.output());
    assert.equal((await call(server, '', 'GET', '/api/me', { cookie: gm.cookie })).status, 200, 'the session made before the restart still works');
    await server.stop();
    // A changed password: reset on the next start.
    server = await startServer(single, { ADMIN_LOGIN: 'gm', ADMIN_PASSWORD: 'admin-password-2' });
    assert.ok(server.output().includes('Admin "gm" updated from the environment.'), server.output());
    assert.equal(await signInSingle('gm', 'admin-password-1'), 401);
    assert.equal((await signInSingle('gm', 'admin-password-2')).role, 'admin');
    await server.stop();
    server = null;
  });

  const oldSingle = [
    ['ADMIN_USER', { ADMIN_USER: 'gm', ADMIN_PASSWORD: 'admin-password-1' }, 'gm', 'admin-password-1', [OLD_LINE('ADMIN_USER', 'ADMIN_LOGIN')]],
    ['ADMIN_LOGIN beside ADMIN_USER, the new name winning', { ADMIN_LOGIN: 'gm', ADMIN_USER: 'old', ADMIN_PASSWORD: 'admin-password-1' }, 'gm', 'admin-password-1', [OLD_LINE('ADMIN_USER', 'ADMIN_LOGIN')]],
    ['TAVERN_ADMIN_USER and TAVERN_ADMIN_PASSWORD', { TAVERN_ADMIN_USER: 'gm', TAVERN_ADMIN_PASSWORD: 'admin-password-1' }, 'gm', 'admin-password-1', [OLD_LINE('TAVERN_ADMIN_USER', 'ADMIN_LOGIN'), OLD_LINE('TAVERN_ADMIN_PASSWORD', 'ADMIN_PASSWORD')]],
  ];
  for (const [what, vars, login, password, lines] of oldSingle) {
    await liveTest(`live: a single install with ${what}: the admin, with the old names logged`, async () => {
      const single = path.join(liveDir, `single-old-${what.replace(/\W+/g, '-')}`);
      server = await startServer(single, vars);
      for (const line of lines) assert.ok(server.output().includes(line), `${line}\n${server.output()}`);
      assert.equal((await signInSingle(login, password)).role, 'admin');
      if (vars.ADMIN_USER && vars.ADMIN_LOGIN) assert.equal(await signInSingle(vars.ADMIN_USER, password), 401, 'the old name is not used');
      await server.stop();
      server = null;
    });
  }

  await liveTest('live: a single install with OWNER_PASSWORD alone: ignored, logged, and a random admin password is made and logged instead', async () => {
    const single = path.join(liveDir, 'single-owner-password');
    server = await startServer(single, { OWNER_PASSWORD: 'owner-password-1' });
    assert.ok(server.output().includes(OWNER_IGNORED));
    const made = /No admin yet and no ADMIN_PASSWORD set\. Created "admin" with password: (\S+)/.exec(server.output());
    assert.ok(made, server.output());
    assert.equal(await signInSingle('admin', 'owner-password-1'), 401);
    assert.equal((await signInSingle('admin', made[1])).role, 'admin');
    await server.stop();
    server = null;
  });

  await liveTest('live: a single install upgraded by step 4: its ADMIN_LOGIN account, made an owner then, is the admin again; other owners stay owners; once only', async () => {
    const single = path.join(liveDir, 'single-from-step-4');
    fs.mkdirSync(single);
    // As step 4 left it: names-roles recorded, the compose account an owner, and a second owner.
    const hash = require('../server/auth.js').hashPassword('step4-password-1');
    fs.writeFileSync(path.join(single, 'app.json'), JSON.stringify({
      version: 2,
      migrations: names.ENVIRONMENT_PARTS.map((p) => ({ id: p.id, at: '2026-09-24T00:00:00.000Z', moved: [] })),
      settings: {},
      users: [
        { key: 'gmkey00001', login: 'gm', displayName: 'GM', role: 'owner', passwordHash: hash, rooms: {} },
        { key: 'olivekey01', login: 'olive', displayName: 'Olive', role: 'owner', passwordHash: hash, rooms: {} },
        { key: 'patkey0001', login: 'pat', displayName: 'Pat', role: 'member', passwordHash: hash, rooms: {} },
      ],
      rooms: [],
    }));
    server = await startServer(single, { ADMIN_LOGIN: 'gm', ADMIN_PASSWORD: 'step4-password-1' });
    assert.ok(server.output().includes('Admin "gm" updated from the environment.'), server.output());
    const roles = () => Object.fromEntries(readJson(path.join(single, 'app.json')).users.map((u) => [u.login, u.role]));
    assert.deepEqual(roles(), { gm: 'admin', olive: 'owner', pat: 'member' });
    const gm = await signInSingle('gm', 'step4-password-1');
    assert.ok(Object.values((await call(server, '', 'GET', '/api/me', { cookie: gm.cookie })).json.user.permissions).every(Boolean));
    await server.stop();
    const after = fs.readFileSync(path.join(single, 'app.json'), 'utf8');
    server = await startServer(single, { ADMIN_LOGIN: 'gm', ADMIN_PASSWORD: 'step4-password-1' });
    assert.ok(!/Admin "gm" (created|updated)/.test(server.output()), 'the next start has nothing to do');
    assert.equal(fs.readFileSync(path.join(single, 'app.json'), 'utf8'), after, 'and changes nothing');
    await server.stop();
    // With no password set, an install with accounts gets nothing made and nobody promoted: step 4's data as it was
    // (the compose account an owner, login the default "admin" too), started with no variables at all.
    const step4 = after.replace('"role": "admin"', '"role": "owner"').replace('"login": "gm"', '"login": "admin"');
    fs.writeFileSync(path.join(single, 'app.json'), step4);
    server = await startServer(single, {});
    assert.ok(server.output().includes('This install has no server admin. Set ADMIN_LOGIN and ADMIN_PASSWORD, then restart, to have one.'), server.output());
    assert.ok(!/Admin "|Created "/.test(server.output()), 'nothing made');
    assert.deepEqual(roles(), { admin: 'owner', olive: 'owner', pat: 'member' }, 'nobody promoted, not even the owner with the default login');
    await server.stop();
    server = await startServer(single, { ADMIN_LOGIN: 'pat' });
    assert.equal(roles().pat, 'member', 'a member is not made admin without a password');
    await server.stop();
    server = null;
  });

  await liveTest('live: a single install whose app.json is not valid JSON stops, naming the file; a missing one starts fresh', async () => {
    const single = path.join(liveDir, 'single-unreadable');
    fs.mkdirSync(single);
    fs.writeFileSync(path.join(single, 'app.json'), '{ not json');
    let stopped = null;
    try { server = await startServer(single, { ADMIN_PASSWORD: 'admin-password-1' }); } catch (err) { stopped = err; }
    assert.ok(stopped, 'the start stops');
    assert.match(stopped.message, /the server stopped \(1\)/);
    assert.ok(stopped.message.includes(`${path.join(single, 'app.json')} is not valid JSON`) && stopped.message.includes('Fix or restore this file, then start again.'), stopped.message);
    assert.equal(fs.readFileSync(path.join(single, 'app.json'), 'utf8'), '{ not json');
    server = null;
    const fresh = path.join(liveDir, 'single-fresh');
    server = await startServer(fresh, { ADMIN_PASSWORD: 'admin-password-1' });
    assert.equal((await call(server, '', 'POST', '/api/login', { body: { login: 'admin', password: 'admin-password-1' } })).status, 200);
    await server.stop();
    server = null;
  });
} finally {
  if (server) await server.stop();
  fs.rmSync(liveDir, { recursive: true, force: true });
}

if (failed) {
  console.error(`check-host-registry: ${failed} group${failed === 1 ? '' : 's'} failed`);
  process.exit(1);
}
console.log(`check-host-registry: ${n} groups OK`);
