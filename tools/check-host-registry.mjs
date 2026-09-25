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

test('host.json is private to the server, and every managed AI key in it is encrypted', () => {
  const dir = freshDir();
  const file = path.join(dir, 'host.json');
  // A managed key saved in the clear before keys were encrypted: sealed on load, still usable.
  fs.writeFileSync(file, JSON.stringify({ ai: { openai: { model: 'gpt-4o-mini', key: 'sk-host-plain' } } }), { mode: 0o644 });
  const r = new HostRegistry(dir);
  const text = () => fs.readFileSync(file, 'utf8');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.ok(!text().includes('sk-host-plain'), 'host.json never holds a plain managed key after load');
  assert.match(JSON.parse(text()).ai.openai.key, /^aesgcm\$/);
  assert.equal(r.managedAi.openai.key, 'sk-host-plain');
  // A key set from the console is sealed too, and a later save of another field keeps it.
  r.setManagedAi('anthropic', { model: 'claude-x', key: 'sk-ant-typed' });
  assert.ok(!text().includes('sk-ant-typed'));
  r.setManagedAi('anthropic', { model: 'claude-y' });
  assert.equal(new HostRegistry(dir).managedAi.anthropic.key, 'sk-ant-typed');
  assert.equal(new HostRegistry(dir).managedAi.anthropic.model, 'claude-y');
  fs.rmSync(dir, { recursive: true, force: true });
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
  // GitHub #16: the name and plan sent with a refused status are not applied, now or by the next save.
  assert.throws(() => r.updateEnvironment('acme', { name: 'Lost', plan: { members: 3 }, status: 'nonsense' }), HostError);
  assert.equal(r.findEnvironment('acme').name, 'Acme Inc');
  assert.equal(r.findEnvironment('acme').plan.members, 20);
  r.updateEnvironment('acme', {});
  assert.equal(new HostRegistry(dir).findEnvironment('acme').name, 'Acme Inc');

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
      assert.deepEqual(names.recordedParts(app), ['names-table', 'names-roles', 'names-spaces', 'names-pointers', 'names-objects', 'names-asides'], `${slug}: each environment part recorded once`);
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
    assert.deepEqual(betaApp.migrations.map((m) => [m.id, m.moved]), names.ENVIRONMENT_PARTS.map((p) => [p.id, []]), 'a new environment records its parts as run, moving nothing');
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
  await liveTest('live: roles in an environment: the owner and the host admin\'s sign-in have every right, a member does not, an environment may have no owner, and Studio\'s bearer requests get the same new role values as the pages', async () => {
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

    // The words (plan-environment-templates step 1): the owner's own beside the resolved ones, per environment.
    const settingsOf = async () => (await call(server, 'acme', 'GET', '/api/settings', { cookie: owner.cookie })).json.settings;
    assert.deepEqual((await settingsOf()).ownWords, {}, 'no words of the owner\'s own yet');
    const saved = await call(server, 'acme', 'PATCH', '/api/settings', { cookie: owner.cookie, body: { words: { space: { one: 'trip', many: 'trips' } } } });
    assert.equal(saved.status, 200, saved.text);
    assert.deepEqual(saved.json.settings.ownWords, { space: { one: 'trip', many: 'trips' } }, 'PATCH answers them too');
    const withWords = await settingsOf();
    assert.deepEqual(withWords.ownWords, { space: { one: 'trip', many: 'trips' } }, 'ownWords is the stored set, unresolved');
    assert.deepEqual([withWords.words.space, withWords.words.member.one], [{ one: 'trip', many: 'trips', a: 'a trip' }, 'member'], 'words stays resolved, every key');
    assert.equal((await call(server, 'acme', 'GET', '/api/branding')).json.ownWords, undefined, 'the public branding carries only the resolved words');
    assert.equal((await call(server, 'acme', 'GET', '/api/me', { cookie: member.cookie })).json.ownWords, undefined, 'a member does not get the owner\'s set');
    assert.deepEqual(await call(server, 'acme', 'GET', '/api/spaces/nope', { cookie: owner.cookie }).then((r) => [r.status, r.json]), [404, { error: 'no such trip' }], 'the server\'s sentences follow the words');
    assert.equal((await call(server, 'beta', 'GET', '/api/branding')).json.words.space.one, 'space', 'another environment keeps its own words');
    assert.deepEqual(await call(server, 'acme', 'PATCH', '/api/settings', { cookie: owner.cookie, body: { words: { host: { one: 'boss', many: 'bosses' } } } }).then((r) => [r.status, r.json]), [400, { error: "The host word is the host's own and can't be changed." }]);
    assert.deepEqual(await call(server, 'acme', 'PATCH', '/api/settings', { cookie: member.cookie, body: { words: { space: null } } }).then((r) => [r.status, r.json]), [403, { error: 'owners only' }]);
    assert.deepEqual((await call(server, 'acme', 'PATCH', '/api/settings', { cookie: owner.cookie, body: { words: { space: null } } })).json.settings.ownWords, {}, 'null clears it');
    assert.equal('words' in readJson(acmeFile).settings, false, 'and the stored key goes with the last word');
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

    // The Studio alias is gone (plan-names step 10): a bearer request (Studio's) answers exactly what the pages' cookie
    // request does, the new names only.
    const bearerMe = (await call(server, 'acme', 'GET', '/api/me', { bearer: owner.token })).json;
    assert.deepEqual([bearerMe.user.role, typeof bearerMe.streamKey], ['owner', 'string'], 'Studio reads owner for an owner, and gets the stream key');
    for (const old of ['tableName', 'serverName']) assert.equal(old in bearerMe, false, `no ${old} on /api/me`);
    assert.equal((await call(server, 'acme', 'GET', '/api/me', { bearer: boss.token })).json.user.role, 'admin');
    assert.equal((await call(server, 'acme', 'GET', '/api/me', { bearer: member.token })).json.user.role, 'member');
    const bearerStatus = (await call(server, 'acme', 'GET', '/api/status', { bearer: owner.token })).json;
    const cookieStatus = (await call(server, 'acme', 'GET', '/api/status', { cookie: owner.cookie })).json;
    const byLogin = (st) => Object.fromEntries(st.users.map((u) => [u.login, u.role]));
    assert.deepEqual(byLogin(bearerStatus), { owner: 'owner', pat: 'member', boss: 'admin', newbie: 'member' });
    assert.deepEqual(byLogin(cookieStatus), byLogin(bearerStatus));
    assert.deepEqual(Object.keys(bearerStatus).sort(), Object.keys(cookieStatus).sort(), 'the same fields as the pages get');
    for (const old of ['tableName', 'serverName', 'rooms', 'activeRoom']) assert.equal(old in bearerStatus, false, `no ${old} on /api/status`);
    assert.equal(bearerStatus.users.some((u) => u.online && 'room' in u.online), false, 'no users[].online.room');
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

  await liveTest('live: restoring a backup made before names-spaces migrates it, and it reads back through the new routes', async () => {
    // The fixture's environment as a backup from before the upgrade: rooms, users[].rooms, images/rooms/, room-<id>.json.
    const entries = [];
    const walk = (rel) => {
      for (const e of fs.readdirSync(path.join(FIXTURE, rel), { withFileTypes: true })) {
        const child = rel ? `${rel}/${e.name}` : e.name;
        if (child === 'host') continue;
        if (e.isDirectory()) walk(child); else entries.push([child, fs.readFileSync(path.join(FIXTURE, child))]);
      }
    };
    walk('');
    const restored = await call(server, 'admin', 'POST', '/api/host/environments/bravo/restore', { cookie, body: zipFiles(entries), type: 'application/zip' });
    assert.deepEqual([restored.status, restored.json], [200, { ok: true }]);
    const s = 'fixture-stream-key-0';
    const presence = await call(server, 'bravo', 'GET', `/api/presence?s=${s}`);
    assert.equal(presence.status, 200, presence.text);
    assert.deepEqual(presence.json.spaces.map((r) => r.id), ['lobby', 'keep01'], 'the spaces, read back (the fixture\'s empty aside is swept away by the read, as any empty aside is)');
    assert.equal(presence.json.spaces.find((r) => r.id === 'keep01').hasImage, true);
    assert.equal((await call(server, 'bravo', 'GET', `/img/space/keep01?s=${s}`)).text, 'a space picture (fixture)\n', 'the space\'s picture at its new address');
    assert.equal((await call(server, 'bravo', 'GET', `/img/memberkey1/player?space=keep01&spaceOnly=1&s=${s}`)).text, 'a member\'s picture in The Keep (fixture)\n', 'a member\'s picture in the space');
    const redirected = await call(server, 'bravo', 'GET', `/img/room/keep01?s=${s}`);
    assert.deepEqual([redirected.status, redirected.headers.location], [301, `/img/space/keep01?s=${s}`]);
    const envDir = path.join(data, 'environments', 'bravo');
    const app = readJson(path.join(envDir, 'app.json'));
    assert.deepEqual(names.recordedParts(app), ['names-table', 'names-roles', 'names-spaces', 'names-pointers', 'names-objects', 'names-asides']);
    assert.ok(Array.isArray(app.spaces) && !('rooms' in app) && app.settings.environmentName === 'Fixture Table');
    for (const rel of ['modules/todo/data/space-keep01.json', 'modules/todo/data/environment.json', 'modules/research/uploads/space-keep01', 'chat.json']) assert.ok(fs.existsSync(path.join(envDir, rel)), rel);
    assert.ok('spaces' in readJson(path.join(envDir, 'chat.json')));
    // Every restored file, and every copy the migration keeps, is private to the server's user.
    for (const rel of [['app.json'], ['chat.json'], ['modules', 'todo', 'data', 'environment.json'], ['pre-names', 'names-table', 'app.json']]) {
      assert.equal(fs.statSync(path.join(envDir, ...rel)).mode & 0o777, 0o600, `${rel.join('/')} is private after a restore`);
    }
  });

  await liveTest('live: a module scope other than environment, space, spaces or person is refused, never read as the environment', async () => {
    const made = await call(server, 'admin', 'POST', '/api/host/environments', { cookie, body: { slug: 'scopes', name: 'Scopes', owner: { login: 'owner', password: 'owner-password-1' } } });
    assert.equal(made.status, 201, made.text);
    const owner = cookieOf(await call(server, 'scopes', 'POST', '/api/login', { body: { login: 'owner', password: 'owner-password-1' } }));
    const as = (method, url, body) => call(server, 'scopes', method, url, { cookie: owner, body });
    const keep = (await as('POST', '/api/spaces', { name: 'The Keep' })).json.space.id;
    assert.ok((await as('POST', '/api/modules/bundled/todo/install')).status < 300);
    assert.equal((await as('PATCH', '/api/modules/todo', { enabled: true, spaces: [keep] })).status, 200);
    const BAD = { error: 'scope must be environment, space, spaces or person' };
    const envFile = path.join(data, 'environments', 'scopes', 'modules', 'todo', 'data', 'environment.json');
    for (const q of [`scope=room&room=${keep}`, 'scope=server', 'scope=bogus']) {
      const put = await as('PUT', `/api/modules/todo/data/task:t9?${q}`, { value: { title: 'x' } });
      assert.deepEqual([put.status, put.json], [400, BAD], `PUT ${q}`);
      const get = await as('GET', `/api/modules/todo/data/task:t9?${q}`);
      assert.deepEqual([get.status, get.json], [400, BAD], `GET ${q}`);
      assert.deepEqual([(await as('GET', `/api/modules/todo/uploads?${q}`)).status, (await as('GET', `/api/objects/search?from=todo&${q}`)).status], [400, 400], `uploads and search, ${q}`);
    }
    const spaces = await as('PUT', '/api/modules/todo/data/task:t9?scope=spaces', { value: { title: 'x' } });
    assert.deepEqual([spaces.status, spaces.json], [400, { error: 'scope must be environment, space or person here' }]);
    assert.ok(!fs.existsSync(envFile), 'nothing was written to the environment\'s data');
    for (const scope of ['room', 'server', 'bogus']) {
      const pub = await as('POST', '/api/bus/publish', { module: 'todo', name: 'changed', scope, room: keep });
      assert.deepEqual([pub.status, pub.json], [400, BAD], `publish, scope ${scope}`);
      assert.equal((await as('GET', `/api/bus/events?module=todo&scope=${scope}&room=${keep}`)).status, 400);
    }
    const busPerson = await as('POST', '/api/bus/publish', { module: 'todo', name: 'changed', scope: 'person' });
    assert.deepEqual([busPerson.status, busPerson.json], [400, { error: 'scope must be environment or space here' }]);
    for (const to of ['room', 'server']) {
      const note = await as('POST', `/api/modules/todo/notify?scope=space&space=${keep}`, { to, title: 'Hello' });
      assert.deepEqual([note.status, note.json], [400, { error: 'to must be space, environment or a person\'s key' }], `notify to ${to}`);
      const sched = await as('POST', `/api/modules/todo/schedule?scope=space&space=${keep}`, { key: 'k', at: Date.now() + 60000, notify: { to, title: 'Hello' } });
      assert.deepEqual([sched.status, sched.json], [400, { error: 'to must be space, environment or a person\'s key' }], `schedule notify to ${to}`);
    }
    assert.equal((await as('PUT', `/api/modules/todo/data/task:t9?scope=space&space=${keep}`, { value: { title: 'x' } })).status, 200, 'the new names still work');
    assert.equal((await as('POST', `/api/modules/todo/notify?scope=space&space=${keep}`, { to: 'space', title: 'Hello' })).status, 200);
    assert.ok(!fs.existsSync(envFile));
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
    // The first start kept the copies (asserted above); a start after it deleted them (plan-names step 10).
    assert.deepEqual(names.recordedParts(readJson(path.join(data, 'host.json'))), ['names-environment', 'names-copies-removed'], 'the later starts deleted the copies and recorded only that');
    assert.deepEqual(names.recordedParts(JSON.parse(before)), ['names-environment', 'names-copies-removed']);
    assert.equal(fs.existsSync(path.join(data, 'pre-names-host')), false, 'pre-names-host/ is gone');
    assert.equal(fs.existsSync(path.join(data, 'environments', 'acme', 'pre-names')), false, 'and each environment\'s pre-names/');
    assert.equal(names.recordedParts(readJson(path.join(data, 'environments', 'acme', 'app.json'))).at(-1), 'names-copies-removed');
    await server.stop();
    server = null;
    const settled = fs.readFileSync(path.join(data, 'host.json'), 'utf8');
    server = await startServer(data, hostedEnv);
    assert.equal(fs.readFileSync(path.join(data, 'host.json'), 'utf8'), settled, 'a later start records nothing more');
    await server.stop();
    server = null;
  });

  const NO_LONGER_READ = (old, now) => `${old} is no longer read: use ${now} instead.`;
  await liveTest('live: the pre-environment move with MIGRATE_ENVIRONMENT_SLUG', async () => {
    const single = path.join(liveDir, 'single-MIGRATE_ENVIRONMENT_SLUG');
    fs.cpSync(FIXTURE, single, { recursive: true, filter: (src) => !path.relative(FIXTURE, src).startsWith('host') });
    server = await startServer(single, { ...hostedEnv, MIGRATE_ENVIRONMENT_SLUG: 'keep' });
    assert.ok(!server.output().includes('MIGRATE_TENANT_SLUG'), server.output());
    assert.ok(fs.existsSync(path.join(single, 'environments', 'keep', 'app.json')) && !fs.existsSync(path.join(single, 'app.json')));
    assert.ok(fs.existsSync(path.join(single, 'environments', 'keep', 'modules', 'todo', 'data', 'space-keep01.json')), 'the module data moved with it, then took its new name when the environment was built');
    const host = readJson(path.join(single, 'host.json'));
    assert.deepEqual(host.environments.map((e) => e.slug), ['keep']);
    assert.deepEqual(host.migrations.map((m) => [m.id, m.moved]), [['names-environment', []], ['names-copies-removed', []]]);
    assert.equal(fs.existsSync(path.join(single, 'pre-names-host')), false, 'nothing old to copy');
    assert.equal((await call(server, 'keep', 'GET', '/api/me')).status, 401, 'the moved environment opens');
    await server.stop();
    server = null;
  });

  // MIGRATE_TENANT_SLUG is no longer read (plan-names step 10): set alone, the start says so and the data stays where it
  // is; beside the new name, only the new name is used, and the old one is still named.
  await liveTest('live: MIGRATE_TENANT_SLUG alone is no longer read: the start names it, and nothing moves', async () => {
    const single = path.join(liveDir, 'single-old-slug-name');
    fs.cpSync(FIXTURE, single, { recursive: true, filter: (src) => !path.relative(FIXTURE, src).startsWith('host') });
    const stopped = await startServer(single, { ...hostedEnv, MIGRATE_TENANT_SLUG: 'keep' }).then((s) => { server = s; return null; }, (err) => err);
    const output = stopped ? stopped.message : server.output();
    assert.ok(output.includes(NO_LONGER_READ('MIGRATE_TENANT_SLUG', 'MIGRATE_ENVIRONMENT_SLUG')), output);
    assert.ok(!fs.existsSync(path.join(single, 'environments', 'keep')), 'nothing moved under the old name');
    assert.ok(fs.existsSync(path.join(single, 'app.json')), 'the install\'s data is where it was');
    if (server) { await server.stop(); server = null; }
  });

  await liveTest('live: MIGRATE_TENANT_SLUG beside MIGRATE_ENVIRONMENT_SLUG: the new name is used, the old one named', async () => {
    const single = path.join(liveDir, 'single-both-slugs');
    fs.cpSync(FIXTURE, single, { recursive: true, filter: (src) => !path.relative(FIXTURE, src).startsWith('host') });
    server = await startServer(single, { ...hostedEnv, MIGRATE_ENVIRONMENT_SLUG: 'keep', MIGRATE_TENANT_SLUG: 'old-name' });
    assert.ok(server.output().includes(NO_LONGER_READ('MIGRATE_TENANT_SLUG', 'MIGRATE_ENVIRONMENT_SLUG')), server.output());
    assert.ok(fs.existsSync(path.join(single, 'environments', 'keep', 'app.json')));
    assert.ok(!fs.existsSync(path.join(single, 'environments', 'old-name')), 'only the new name is used');
    await server.stop();
    server = null;
  });

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
      const keep = (await call(server, 'acme', 'POST', '/api/spaces', { cookie: owner, body: { name: 'The Keep' } })).json.space.id;
      const callsNow = async () => (await call(server, 'acme', 'GET', '/api/environment', { cookie: owner })).json.usage.callsNow;
      const token = (space) => call(server, 'acme', 'POST', '/api/token', { cookie: owner, body: { space } });

      // Other environments' calls only: new names of acme-aside and acme-table, their old shapes, and QA's acme-table-lobby.
      setCalls({ 'acme-aside.lobby': ['x1'], 'acme-table.lobby': ['x2'], 'acme-aside-table': ['x3'], 'acme-table-table': ['x4'], [`acme-table-table-${keep}`]: ['x5'], 'acme-table-lobby': ['x6'], lobby: ['x7'] });
      assert.equal(await callsNow(), 0, 'none of them is acme\'s');
      const first = await token('lobby');
      assert.equal(first.status, 200, `acme's owner is not refused by other environments' calls: ${first.text}`);
      assert.equal(first.json.call, 'acme.lobby', 'the new hosted name');
      assert.equal((await token(keep)).json.call, `acme.${keep}`);
      const presence = (await call(server, 'acme', 'GET', '/api/presence', { cookie: owner })).json;
      assert.equal(presence.users.find((u) => u.key === ownerKey).online, false, 'nobody in another environment\'s call is placed here');

      // One of acme's own calls running: counted, and a second is refused, while joining the running one is not.
      setCalls({ 'acme-aside.lobby': ['x1'], [`acme.${keep}`]: [ownerKey] });
      assert.equal(await callsNow(), 1);
      const refused = await token('lobby');
      assert.deepEqual([refused.status, refused.json], [403, { error: 'This environment\'s plan allows 1 call at once; one is running in The Keep' }]);
      assert.equal((await token(keep)).status, 200, 'joining the running call is never refused');
      const placed = (await call(server, 'acme', 'GET', '/api/presence', { cookie: owner })).json.users.find((u) => u.key === ownerKey);
      assert.deepEqual([placed.online, placed.space], [true, keep]);

      // acme's own call under its old name (someone in it across the upgrade): counted and placed, and joining it is joining.
      setCalls({ 'acme-table': [ownerKey], 'acme-aside-table': ['x3'] });
      assert.equal(await callsNow(), 1);
      assert.equal((await token('lobby')).status, 200, 'the Lobby\'s call is running under its old name: joining');
      assert.equal((await token(keep)).status, 403, 'a second call is refused');
      assert.equal((await call(server, 'acme', 'GET', '/api/presence', { cookie: owner })).json.users.find((u) => u.key === ownerKey).space, 'lobby');
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
  const GONE_LINE = (old, now) => `${old} is no longer read: use ${now} instead.`; // plan-names step 10
  const OWNER_IGNORED = "OWNER_PASSWORD is ignored: owners are made in Manage. Use ADMIN_PASSWORD for the server's admin.";
  const signInSingle = async (login, password) => {
    const res = await call(server, '', 'POST', '/api/login', { body: { login, password } });
    return res.status === 200 ? { cookie: cookieOf(res), key: res.json.user.key, role: res.json.user.role } : res.status;
  };

  await liveTest('live: hosted: ADMIN_LOGIN and ADMIN_PASSWORD make the host admin and reset its password on each start, leaving other host admins alone; HOST_ADMIN_* are no longer read, and say so; OWNER_PASSWORD is ignored', async () => {
    const hosted = path.join(liveDir, 'hosted-admin');
    const hostIn = async (login, password) => (await call(server, 'admin', 'POST', '/api/host/login', { body: { login, password } })).status;
    // Only the old names: no longer read (plan-names step 10). The start says so, and makes no host admin from them.
    server = await startServer(hosted, { BASE_DOMAIN: 'localhost', HOST_ADMIN_LOGIN: 'boss', HOST_ADMIN_PASSWORD: 'host-password-1', OWNER_PASSWORD: 'never-used-1' });
    for (const line of [GONE_LINE('HOST_ADMIN_LOGIN', 'ADMIN_LOGIN'), GONE_LINE('HOST_ADMIN_PASSWORD', 'ADMIN_PASSWORD'), OWNER_IGNORED]) assert.ok(server.output().includes(line), `${line}\n${server.output()}`);
    assert.ok(!/Host admin "boss" created/.test(server.output()), server.output());
    assert.equal(await hostIn('boss', 'host-password-1'), 401, 'the old names make nobody');
    await server.stop();
    // The new names make the host admin.
    server = await startServer(hosted, { BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'boss', ADMIN_PASSWORD: 'host-password-1' });
    assert.ok(server.output().includes('Host admin "boss" created from the environment.'), server.output());
    assert.equal(await hostIn('boss', 'host-password-1'), 200);
    const bossCookie = cookieOf(await call(server, 'admin', 'POST', '/api/host/login', { body: { login: 'boss', password: 'host-password-1' } }));
    assert.equal((await call(server, 'admin', 'POST', '/api/host/admins', { cookie: bossCookie, body: { login: 'second', password: 'second-password-1' } })).status, 201, 'a second host admin, made on the console');
    await server.stop();
    // The new names, same login, new password: reset, and the second host admin untouched.
    const before = readJson(path.join(hosted, 'host.json')).hostAdmins.find((a) => a.login === 'second');
    server = await startServer(hosted, { BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'boss', ADMIN_PASSWORD: 'host-password-2' });
    assert.ok(server.output().includes('Host admin "boss" password reset from the environment.'), server.output());
    assert.ok(!/is now ADMIN_|is no longer read/.test(server.output()), 'no old name set, no line');
    assert.equal(await hostIn('boss', 'host-password-1'), 401);
    assert.equal(await hostIn('boss', 'host-password-2'), 200);
    assert.equal(await hostIn('second', 'second-password-1'), 200, 'the other host admin still signs in');
    assert.deepEqual(readJson(path.join(hosted, 'host.json')).hostAdmins.find((a) => a.login === 'second'), before, 'and is exactly as it was');
    assert.equal(readJson(path.join(hosted, 'host.json')).hostAdmins.length, 2);
    await server.stop();
    // The same again: nothing to do. A new login: another host admin made beside the others.
    server = await startServer(hosted, { BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'boss', ADMIN_PASSWORD: 'host-password-2', TAVERN_ADMIN_USER: 'x', TAVERN_ADMIN_PASSWORD: 'y', TAVERN_ADMIN_KEY: 'z', ADMIN_KEY: 'w', ADMIN_MFA_LOCKOUT_BYPASS: 'true' });
    assert.ok(!/Host admin "boss" (created|password reset)/.test(server.output()), server.output());
    assert.ok(server.output().includes(GONE_LINE('TAVERN_ADMIN_USER', 'ADMIN_LOGIN')), server.output());
    for (const old of ['TAVERN_ADMIN_PASSWORD', 'TAVERN_ADMIN_KEY', 'ADMIN_KEY']) assert.ok(server.output().includes(GONE_LINE(old, 'ADMIN_PASSWORD')), server.output());
    assert.ok(!/ignored on a server with environments/.test(server.output()), 'one line per old name, no other');
    assert.equal(await hostIn('boss', 'y'), 401, 'the old password names set no password');
    assert.ok(server.output().includes('The lockout bypass (ADMIN_MFA_LOCKOUT_BYPASS) is on: every owner and host admin skips'), 'hosted: the host admins');
    await server.stop();
    server = await startServer(hosted, { BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'chief', ADMIN_PASSWORD: 'chief-password-1', ADMIN_USER: 'ignored-here' });
    assert.ok(server.output().includes('Host admin "chief" created from the environment.'));
    assert.ok(server.output().includes(GONE_LINE('ADMIN_USER', 'ADMIN_LOGIN')), 'ADMIN_USER is read nowhere now, and says so');
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

  await liveTest('live: a single install moved into an environment: its AI key and two-step secrets move to the host\'s key, and every secret file is private', async () => {
    const auth = require('../server/auth.js');
    const crypto = require('node:crypto');
    const single = path.join(liveDir, 'single-secrets-then-hosted');
    server = await startServer(single, { ADMIN_LOGIN: 'gm', ADMIN_PASSWORD: 'admin-password-1' });
    await server.stop();
    // The install's own secrets: its key, an AI key and a live two-step secret encrypted with it, and a pending one
    // encrypted with some other key (which the move can't read, so leaves as it is). All left readable by others,
    // as an install from before files were kept private would have them.
    const installKey = crypto.randomBytes(32);
    const otherKey = crypto.randomBytes(32);
    fs.writeFileSync(path.join(single, 'secrets.key'), installKey.toString('hex'), { mode: 0o644 });
    fs.writeFileSync(path.join(single, 'ai.json'), JSON.stringify({ source: 'custom', provider: 'compatible', address: 'http://127.0.0.1:9', model: 'm', key: auth.encryptSecret('sk-moved', installKey), enabled: true }), { mode: 0o644 });
    const appFile = path.join(single, 'app.json');
    const app = readJson(appFile);
    const unreadable = auth.encryptSecret('pending-elsewhere', otherKey);
    app.users[0].mfa = { secret: auth.encryptSecret('TOTPSECRETLIVE', installKey), enrolledAt: '2026-09-01T00:00:00.000Z', recovery: [], version: 1, lastStep: null, pending: { secret: unreadable, startedAt: '2026-09-02T00:00:00.000Z' } };
    fs.writeFileSync(appFile, JSON.stringify(app));
    fs.chmodSync(appFile, 0o644);
    server = await startServer(single, { ...hostedEnv, MIGRATE_ENVIRONMENT_SLUG: 'keep' });
    assert.ok(server.output().includes('Moved 2 encrypted secrets of "keep" (the AI key, two-step sign-in) to the host\'s key.'), server.output());
    assert.ok(server.output().includes('1 encrypted secret of "keep" could not be read with the install\'s key and was left as it was: the AI key has to be entered again, and anyone affected has to set up two-step sign-in again.'), server.output());
    const envDir = path.join(single, 'environments', 'keep');
    const hostKey = Buffer.from(readJson(path.join(single, 'host.json')).secrets.key, 'hex');
    assert.equal(auth.decryptSecret(readJson(path.join(envDir, 'ai.json')).key, hostKey), 'sk-moved', 'the AI key reads with the host\'s key');
    const gm = readJson(path.join(envDir, 'app.json')).users.find((u) => u.login === 'gm');
    assert.equal(auth.decryptSecret(gm.mfa.secret, hostKey), 'TOTPSECRETLIVE', 'the two-step secret reads with the host\'s key');
    assert.equal(gm.mfa.pending.secret, unreadable, 'one the install\'s key could not read is left exactly as it was');
    assert.equal(gm.role, 'owner', 'and the admin still becomes the owner');
    for (const file of [path.join(single, 'host.json'), path.join(envDir, 'app.json'), path.join(envDir, 'ai.json'), path.join(envDir, 'secrets.key')]) {
      assert.equal(fs.statSync(file).mode & 0o777, 0o600, `${path.relative(single, file)} is private`);
    }
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

  // ADMIN_USER and TAVERN_ADMIN_USER are no longer read (plan-names step 10): the login is ADMIN_LOGIN, or "admin".
  // TAVERN_ADMIN_PASSWORD, TAVERN_ADMIN_KEY and ADMIN_KEY are no longer read either (Thomas, after step 10): set alone
  // on a fresh install, the admin gets a random password, logged, and the old value signs nobody in.
  const oldSingle = [
    ['ADMIN_USER', { ADMIN_USER: 'gm', ADMIN_PASSWORD: 'admin-password-1' }, 'admin', 'admin-password-1', [GONE_LINE('ADMIN_USER', 'ADMIN_LOGIN')]],
    ['ADMIN_LOGIN beside ADMIN_USER', { ADMIN_LOGIN: 'gm', ADMIN_USER: 'old', ADMIN_PASSWORD: 'admin-password-1' }, 'gm', 'admin-password-1', [GONE_LINE('ADMIN_USER', 'ADMIN_LOGIN')]],
    ['TAVERN_ADMIN_USER beside ADMIN_PASSWORD', { TAVERN_ADMIN_USER: 'gm', ADMIN_PASSWORD: 'admin-password-1' }, 'admin', 'admin-password-1', [GONE_LINE('TAVERN_ADMIN_USER', 'ADMIN_LOGIN')]],
  ];
  const oldPasswordNames = ['TAVERN_ADMIN_PASSWORD', 'TAVERN_ADMIN_KEY', 'ADMIN_KEY'];
  for (const old of oldPasswordNames) {
    await liveTest(`live: a single install with ${old} alone: not read, the start says so, and a random admin password is made instead`, async () => {
      const single = path.join(liveDir, `single-old-${old}`);
      server = await startServer(single, { [old]: 'old-password-1' });
      assert.ok(server.output().includes(GONE_LINE(old, 'ADMIN_PASSWORD')), server.output());
      assert.ok(!/stops working in a later release/.test(server.output()), server.output());
      const made = /No admin yet and no ADMIN_PASSWORD set\. Created "admin" with password: (\S+)/.exec(server.output());
      assert.ok(made, server.output());
      assert.equal(await signInSingle('admin', 'old-password-1'), 401, `${old}: the old value is not the password`);
      assert.equal((await signInSingle('admin', made[1])).role, 'admin');
      await server.stop();
      server = null;
    });
  }
  for (const [what, vars, login, password, lines] of oldSingle) {
    await liveTest(`live: a single install with ${what}: the old login name is not read, and the start says so`, async () => {
      const single = path.join(liveDir, `single-old-${what.replace(/\W+/g, '-')}`);
      server = await startServer(single, vars);
      for (const line of lines) assert.ok(server.output().includes(line), `${line}\n${server.output()}`);
      assert.equal((await signInSingle(login, password)).role, 'admin');
      for (const old of [vars.ADMIN_USER, vars.TAVERN_ADMIN_USER]) if (old && old !== login) assert.equal(await signInSingle(old, password), 401, `${old}: the old name is not used`);
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
      migrations: ['names-table', 'names-roles'].map((id) => ({ id, at: '2026-09-24T00:00:00.000Z', moved: [] })),
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
    // Only the copies go on this start (plan-names step 10: they wait one start after the parts that made them).
    const withoutCopiesPart = (text) => { const a = JSON.parse(text); return { ...a, migrations: a.migrations.filter((m) => m.id !== 'names-copies-removed') }; };
    assert.deepEqual(withoutCopiesPart(fs.readFileSync(path.join(single, 'app.json'), 'utf8')), JSON.parse(after), 'and changes nothing else');
    assert.equal(fs.existsSync(path.join(single, 'pre-names')), false, 'pre-names/ gone');
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

  // Plan-names step 5c: an installed module with an old manifest, one that requires it, and a module whose author renamed a
  // permission (`replaces`), on a hosted server (each start line names the environment) and a single install (no name).
  const putModules = (envDir) => {
    const put = (id, m) => {
      const d = path.join(envDir, 'modules', id, 'versions', '1.0.0');
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'module.json'), JSON.stringify({ id, name: id, version: '1.0.0', surfaces: { page: { entry: 'page.html' } }, ...m }));
      fs.writeFileSync(path.join(d, 'page.html'), '<p>x</p>');
    };
    put('oldmod', { scope: ['server'] });
    put('depmod', { scope: ['environment'], requires: ['oldmod'] });
    put('renamer', { scope: ['environment'], permissions: [{ key: 'view_page', label: 'See the page', replaces: 'links', default: { member: false, moderator: false, guest: false } }], access: { read: 'view_page' } });
    const entry = (id, permissions = []) => ({ id, versions: ['1.0.0'], version: '1.0.0', enabled: true, allSpaces: false, spaces: [], approved: { permissions, hooks: [], refs: [], events: [], actions: [] }, source: 'upload' });
    fs.writeFileSync(path.join(envDir, 'modules', 'registry.json'), JSON.stringify({ modules: { oldmod: entry('oldmod'), depmod: entry('depmod'), renamer: entry('renamer', ['view_page']) }, autoInstalled: ['stream'] }));
    const appFile = path.join(envDir, 'app.json');
    const app = readJson(appFile);
    app.settings.roles = { ...(app.settings.roles || {}), member: { ...((app.settings.roles || {}).member || {}), 'module.renamer.links': true } };
    fs.writeFileSync(appFile, JSON.stringify(app));
  };
  const waitFor = async (text) => { for (let i = 0; i < 100 && !server.output().includes(text); i += 1) await new Promise((r) => setTimeout(r, 50)); assert.ok(server.output().includes(text), `${text}\n${server.output()}`); };
  await liveTest('live: an outdated module and what requires it do not run, the start names them (and the environment, when hosted), and a renamed permission keeps its grants', async () => {
    const hosted = path.join(liveDir, 'hosted-outdated');
    server = await startServer(hosted, hostedEnv);
    const host = await signInHost(server);
    assert.equal((await call(server, 'admin', 'POST', '/api/host/environments', { cookie: host, body: { slug: 'deps', name: 'Deps', owner: { login: 'owner', password: 'owner-password-1' } } })).status, 201);
    await server.stop();
    const envDir = path.join(hosted, 'environments', 'deps');
    putModules(envDir);
    server = await startServer(hosted, hostedEnv);
    await waitFor('[deps] Module "depmod" 1.0.0 can\'t run until "oldmod", which it requires, is updated.');
    await waitFor('[deps] Module "oldmod" 1.0.0 can\'t run until it is updated: module.json uses the old scope "server"; use "environment" (Magpie renamed the server to the environment).');
    await waitFor('[deps] Carried the member role\'s choice for module.renamer.links over to module.renamer.view_page.');
    assert.deepEqual(readJson(path.join(envDir, 'app.json')).settings.roles.member, { 'module.renamer.view_page': true }, 'the grant carried, the old key gone');
    const owner = cookieOf(await call(server, 'deps', 'POST', '/api/login', { body: { login: 'owner', password: 'owner-password-1' } }));
    const as = (method, url, body) => call(server, 'deps', method, url, { cookie: owner, body });
    const byId = Object.fromEntries((await as('GET', '/api/modules')).json.modules.map((m) => [m.id, m]));
    assert.deepEqual([byId.oldmod.enabled, byId.oldmod.outdatedVersions, byId.depmod.enabled, byId.depmod.needsUpdate, byId.depmod.missing, byId.renamer.enabled], [false, ['1.0.0'], false, ['oldmod'], [], true]);
    assert.equal((await as('GET', '/api/modules/depmod/context?scope=environment')).status, 404, 'what requires it does not run');
    assert.ok(!JSON.stringify((await as('GET', '/api/modules/nav')).json).includes('"depmod"'));
    const on = await as('PATCH', '/api/modules/depmod', { enabled: true });
    assert.deepEqual([on.status, on.json], [409, { error: 'depmod needs oldmod, which needs an update from its author.' }]);
    assert.equal((await as('PATCH', '/api/modules/oldmod', { enabled: false })).status, 200, 'turning the outdated one off asks nothing about what requires it');
    await server.stop();
    // A single install: the same lines, with no environment named.
    const single = path.join(liveDir, 'single-outdated');
    server = await startServer(single, { ADMIN_PASSWORD: 'admin-password-1' });
    await server.stop();
    putModules(single);
    server = await startServer(single, { ADMIN_PASSWORD: 'admin-password-1' });
    await waitFor('Module "depmod" 1.0.0 can\'t run until "oldmod", which it requires, is updated.');
    await waitFor('Carried the member role\'s choice for module.renamer.links over to module.renamer.view_page.');
    assert.ok(!/\[\w+\] (Module|Carried|Updated)/.test(server.output()), server.output());
    await server.stop();
    server = null;
  });

  // QA's case: bundled modules installed before step 5c, where one requires another that sorts after it (Maps needs Places),
  // and one that gains a new permission off for every role (Stream). On start each is updated, requirements first; none
  // fails, and each ends on, as it was.
  await liveTest('live: outdated bundled modules are updated requirements first, and each ends on as it was', async () => {
    const single = path.join(liveDir, 'single-bundled');
    server = await startServer(single, { ADMIN_PASSWORD: 'admin-password-1' });
    await server.stop();
    const modulesDir = path.join(single, 'modules');
    fs.mkdirSync(modulesDir, { recursive: true });
    const registry = fs.existsSync(path.join(modulesDir, 'registry.json')) ? readJson(path.join(modulesDir, 'registry.json')) : { modules: {}, autoInstalled: [] };
    const oldVersion = (v) => { const [a, b, c] = v.split('.').map(Number); return c > 0 ? `${a}.${b}.${c - 1}` : b > 0 ? `${a}.${b - 1}.99` : `${a - 1}.99.99`; };
    const current = {};
    for (const id of ['maps', 'places', 'stream']) {
      const now = readJson(path.join(ROOT, 'modules', id, 'module.json'));
      current[id] = now.version;
      const version = oldVersion(now.version);
      const d = path.join(modulesDir, id, 'versions', version);
      fs.rmSync(path.join(modulesDir, id, 'versions'), { recursive: true, force: true });
      fs.mkdirSync(d, { recursive: true });
      // The same module in the old names, as a build before 5c installed it; Stream with its old permission.
      const old = { ...now, version, scope: now.scope.map((x) => (x === 'environment' ? 'server' : x === 'space' ? 'room' : x)) };
      if (id === 'stream') old.permissions = [{ key: 'links', label: 'See the stream links', default: { user: false, guest: false, moderator: false } }];
      fs.writeFileSync(path.join(d, 'module.json'), JSON.stringify(old));
      const approved = { permissions: (old.permissions || []).map((p) => p.key), hooks: Object.keys(now.hooks || {}).filter((h) => now.hooks[h]), refs: now.refs?.consumes || [], events: now.events?.subscribes || [], actions: now.actions?.uses || [] };
      registry.modules[id] = { id, versions: [version], version, enabled: true, allSpaces: true, spaces: [], approved, source: 'bundled', installedAt: '2026-09-01T00:00:00.000Z' };
    }
    registry.autoInstalled = [...new Set([...(registry.autoInstalled || []), 'stream'])];
    fs.writeFileSync(path.join(modulesDir, 'registry.json'), JSON.stringify(registry));
    server = await startServer(single, { ADMIN_PASSWORD: 'admin-password-1' });
    for (const id of ['maps', 'places', 'stream']) await waitFor(`Updated "${id}" from ${oldVersion(current[id])} to ${current[id]}: the version installed was built for an older Magpie.`);
    const out = server.output();
    assert.ok(!out.includes('Could not update'), out);
    assert.ok(out.indexOf('Updated "places"') < out.indexOf('Updated "maps"'), `Places before Maps:\n${out}`);
    assert.ok(out.includes(`Updated "stream" from ${oldVersion(current.stream)} to ${current.stream}: the version installed was built for an older Magpie. It stays on: its new permission (view_page) is off for every role, so only owners have it.`), out);
    const admin = cookieOf(await call(server, '', 'POST', '/api/login', { body: { login: 'admin', password: 'admin-password-1' } }));
    const byId = Object.fromEntries((await call(server, '', 'GET', '/api/modules', { cookie: admin })).json.modules.map((m) => [m.id, m]));
    for (const id of ['maps', 'places', 'stream']) assert.deepEqual([id, byId[id].version, byId[id].enabled, byId[id].missing, byId[id].needsUpdate], [id, current[id], true, [], []]);
    // An ordinary space: the Lobby keeps only the modules made for it (plan-modules, the Lobby addendum).
    const side = (await call(server, '', 'POST', '/api/spaces', { cookie: admin, body: { name: 'Side' } })).json.space.id;
    assert.equal((await call(server, '', 'GET', `/api/modules/maps/context?scope=space&space=${side}`, { cookie: admin })).status, 200, 'Maps runs');
    await server.stop();
    server = null;
  });

  // Bundled modules stay in step with the server: an older bundled copy in the new names (as a build from step 6 left it) is
  // updated on start when the update asks for nothing new, keeping on, spaces and data; one that asks for something new
  // waits and keeps running; and a module's storage.renamed moves its stored keys in every scope, once, before anyone opens it.
  await liveTest('live: bundled modules are updated to the shipped version when that needs no approval; storage.renamed moves stored keys once', async () => {
    const single = path.join(liveDir, 'single-in-step');
    server = await startServer(single, { ADMIN_PASSWORD: 'admin-password-1' });
    const waitFor = async (text) => { for (let i = 0; i < 100 && !server.output().includes(text); i += 1) await new Promise((r) => setTimeout(r, 50)); assert.ok(server.output().includes(text), `${text}\n${server.output()}`); };
    await waitFor('Auto-installed and enabled "stream"');
    // An ordinary space for the Planner's data: the Lobby keeps only the modules made for it (the Lobby addendum).
    const side = (await call(server, '', 'POST', '/api/spaces', { cookie: cookieOf(await call(server, '', 'POST', '/api/login', { body: { login: 'admin', password: 'admin-password-1' } })), body: { name: 'Side' } })).json.space.id;
    await server.stop();
    const modulesDir = path.join(single, 'modules');
    const registry = readJson(path.join(modulesDir, 'registry.json'));
    const older = (v) => { const [a, b, c] = v.split('.').map(Number); return c > 0 ? `${a}.${b}.${c - 1}` : `${a}.${b - 1}.99`; };
    const current = {};
    for (const id of ['places', 'maps', 'todo', 'travel']) {
      const now = readJson(path.join(ROOT, 'modules', id, 'module.json'));
      current[id] = now.version;
      const version = older(now.version);
      const d = path.join(modulesDir, id, 'versions', version);
      fs.mkdirSync(d, { recursive: true });
      const { storage, ...before } = now; // the installed copy predates the rename
      fs.writeFileSync(path.join(d, 'module.json'), JSON.stringify({ ...before, version }));
      const approved = { permissions: (now.permissions || []).map((p) => p.key), hooks: Object.keys(now.hooks || {}).filter((h) => now.hooks[h]), refs: now.refs?.consumes || [], events: now.events?.subscribes || [], actions: now.actions?.uses || [] };
      // The To-do's installed copy was approved before it used notifications: its update asks for something new.
      if (id === 'todo') approved.hooks = approved.hooks.filter((h) => h !== 'notify');
      registry.modules[id] = { id, versions: [version], version, enabled: true, allSpaces: true, spaces: [], approved, source: 'bundled', installedAt: '2026-09-01T00:00:00.000Z' };
    }
    fs.writeFileSync(path.join(modulesDir, 'registry.json'), JSON.stringify(registry));
    // The Planner's items under their old keys, in a space and in the environment; one whose new key is already taken.
    const entry = (value) => ({ value, version: 3, updatedAt: '2026-09-01T00:00:00.000Z', by: 'someone' });
    const dataDir = path.join(modulesDir, 'travel', 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, `space-${side}.json`), JSON.stringify({ 'trip:main': entry({ title: 'Lisbon' }), 'item:a1': entry({ title: 'Ferry to Cacilhas', date: '2026-10-01' }), 'item:c1': entry({ title: 'old copy' }), 'plan:c1': entry({ title: 'new copy' }) }));
    fs.writeFileSync(path.join(dataDir, 'environment.json'), JSON.stringify({ 'item:e1': entry({ title: 'Passports' }) }));
    server = await startServer(single, { ADMIN_PASSWORD: 'admin-password-1' });
    for (const id of ['places', 'maps', 'travel']) await waitFor(`Updated "${id}" from ${older(current[id])} to ${current[id]}, the version this server ships.`);
    await waitFor(`"todo" ${current.todo} is here, but it asks for something new, so it waits for an owner to update it in Modules; ${older(current.todo)} keeps running.`);
    await waitFor('Renamed "travel"\'s stored keys from item: to plan: (2 in 2 places; kept 1 whose new name was already taken).');
    const out = server.output();
    assert.ok(out.indexOf('Updated "places"') < out.indexOf('Updated "maps"'), `Places before Maps:\n${out}`);
    const space = readJson(path.join(dataDir, `space-${side}.json`));
    assert.deepEqual(Object.keys(space).sort(), ['item:c1', 'plan:a1', 'plan:c1', 'trip:main'], 'moved, and the taken name never overwritten');
    assert.deepEqual([space['plan:a1'], space['plan:c1'].value.title, space['item:c1'].value.title], [entry({ title: 'Ferry to Cacilhas', date: '2026-10-01' }), 'new copy', 'old copy'], 'value, version, time and author kept');
    assert.deepEqual(Object.keys(readJson(path.join(dataDir, 'environment.json'))), ['plan:e1']);
    const admin = cookieOf(await call(server, '', 'POST', '/api/login', { body: { login: 'admin', password: 'admin-password-1' } }));
    const as = (method, url, body) => call(server, '', method, url, { cookie: admin, body });
    const byId = Object.fromEntries((await as('GET', '/api/modules')).json.modules.map((m) => [m.id, m]));
    for (const id of ['places', 'maps', 'travel']) assert.deepEqual([id, byId[id].version, byId[id].enabled, byId[id].allSpaces], [id, current[id], true, true]);
    assert.deepEqual([byId.todo.version, byId.todo.enabled], [older(current.todo), true], 'the To-do waits, still on, on its old version');
    assert.equal((await as('GET', `/api/modules/maps/context?scope=space&space=${side}`)).status, 200, 'Maps runs');
    // Found as plan: objects without anyone having opened the Planner.
    const found = await as('GET', `/api/objects/search?from=todo&scope=space&space=${side}&q=ferry`);
    assert.deepEqual(found.json.summaries.map((x) => [x.kind, x.ref.id, x.title]), [['plan', 'a1', 'Ferry to Cacilhas']]);
    const resolved = await as('POST', '/api/objects/resolve', { from: 'todo', refs: [{ module: 'travel', kind: 'plan', id: 'a1', scope: 'space', space: side }, { module: 'travel', kind: 'plan', id: 'e1', scope: 'environment' }] });
    assert.deepEqual(resolved.json.summaries.map((x) => x.title), ['Ferry to Cacilhas', 'Passports']);
    assert.deepEqual(readJson(path.join(modulesDir, 'registry.json')).modules.travel.renamed.map((r) => [r.from, r.to]), [['item:', 'plan:']]);
    await server.stop();
    // Every start, not once: an old key written again after the rename (an old page still open) is moved on the next start.
    const again = readJson(path.join(dataDir, `space-${side}.json`));
    again['item:z9'] = entry({ title: 'late' });
    fs.writeFileSync(path.join(dataDir, `space-${side}.json`), JSON.stringify(again));
    server = await startServer(single, { ADMIN_PASSWORD: 'admin-password-1' });
    await waitFor(`"todo" ${current.todo} is here`);
    await waitFor('Renamed "travel"\'s stored keys from item: to plan: (1 in 1 place; kept 1 whose new name was already taken).');
    assert.ok(!server.output().includes('Updated "'), server.output());
    assert.deepEqual(Object.keys(readJson(path.join(dataDir, `space-${side}.json`))).sort(), ['item:c1', 'plan:a1', 'plan:c1', 'plan:z9', 'trip:main']);
    await server.stop();
    // The conflict already counted is not logged, or added to the activity, again.
    server = await startServer(single, { ADMIN_PASSWORD: 'admin-password-1' });
    await waitFor(`"todo" ${current.todo} is here`);
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(!server.output().includes('Renamed'), server.output());
    await server.stop();
    server = null;
  });

  // QA's case: storage.renamed across a rollback. The stored keys always match the version that runs: rolling back to a
  // version from before a rename moves the keys back, and rolling forward again moves every key under the old prefix,
  // including one the older version wrote meanwhile.
  await liveTest('live: storage.renamed follows the running version across a rollback and back, and strands no key', async () => {
    const single = path.join(liveDir, 'single-rename-rollback');
    server = await startServer(single, { ADMIN_PASSWORD: 'admin-password-1' });
    const admin = cookieOf(await call(server, '', 'POST', '/api/login', { body: { login: 'admin', password: 'admin-password-1' } }));
    const as = (method, url, body, type) => call(server, '', method, url, { cookie: admin, body, type });
    const side = (await as('POST', '/api/spaces', { name: 'Side' })).json.space.id; // not the Lobby (the Lobby addendum)
    assert.equal((await as('POST', '/api/modules/bundled/todo/install')).status, 201);
    assert.equal((await as('PATCH', '/api/modules/todo', { enabled: true, allSpaces: true })).status, 200);
    const shipped = readJson(path.join(ROOT, 'modules', 'todo', 'module.json'));
    for (const id of ['t1', 't2', 't3']) assert.equal((await as('PUT', `/api/modules/todo/data/task:${id}?scope=space&space=${side}`, { value: { title: id } })).status, 200);
    // The next version renames task: to job:, as an author would (an uploaded copy of the To-do).
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'check-rename-todo-'));
    fs.cpSync(path.join(ROOT, 'modules', 'todo'), copy, { recursive: true });
    const [a, b, c] = shipped.version.split('.').map(Number);
    const next = `${a}.${b}.${c + 1}`;
    fs.writeFileSync(path.join(copy, 'module.json'), JSON.stringify({ ...shipped, version: next, storage: { renamed: [{ from: 'task:', to: 'job:' }] } }));
    const { buildModule } = require('../server/module-build.js');
    const up = await as('POST', '/api/modules', buildModule(copy).zip, 'application/zip');
    fs.rmSync(copy, { recursive: true, force: true });
    assert.equal(up.status, 201, up.text);
    const keys = () => Object.keys(readJson(path.join(single, 'modules', 'todo', 'data', `space-${side}.json`))).sort();
    assert.deepEqual(keys(), ['job:t1', 'job:t2', 'job:t3'], 'renamed on install');
    // Back to the version from before the rename: its keys are where it looks for them.
    assert.equal((await as('POST', '/api/modules/todo/rollback', { version: shipped.version })).status, 200);
    assert.deepEqual(keys(), ['task:t1', 'task:t2', 'task:t3'], 'moved back on rollback');
    assert.equal((await as('GET', `/api/modules/todo/data?scope=space&space=${side}&prefix=task:`)).json.items.length, 3, 'the older version finds them');
    assert.equal((await as('PUT', `/api/modules/todo/data/task:rb?scope=space&space=${side}`, { value: { title: 'written while rolled back' } })).status, 200);
    // And forward again: every key under the old prefix moves, the one written meanwhile too.
    assert.equal((await as('POST', '/api/modules/todo/rollback', { version: next })).status, 200);
    assert.deepEqual(keys(), ['job:rb', 'job:t1', 'job:t2', 'job:t3']);
    assert.deepEqual(readJson(path.join(single, 'modules', 'registry.json')).modules.todo.renamed.map((r) => [r.from, r.to, r.version]), [['task:', 'job:', next]], 'recorded with the version that introduced it');
    // QA's second case: a newer version that no longer declares the rename keeps it; nothing moves back.
    const copy2 = fs.mkdtempSync(path.join(os.tmpdir(), 'check-rename-todo-'));
    fs.cpSync(path.join(ROOT, 'modules', 'todo'), copy2, { recursive: true });
    const later = `${a}.${b}.${c + 2}`;
    fs.writeFileSync(path.join(copy2, 'module.json'), JSON.stringify({ ...shipped, version: later }));
    const logBefore = server.output().length;
    const up2 = await as('POST', '/api/modules', buildModule(copy2).zip, 'application/zip');
    fs.rmSync(copy2, { recursive: true, force: true });
    assert.equal(up2.status, 201, up2.text);
    assert.deepEqual(keys(), ['job:rb', 'job:t1', 'job:t2', 'job:t3'], 'the keys stay renamed');
    assert.ok(!server.output().slice(logBefore).includes('Moved back'), server.output());
    assert.deepEqual(readJson(path.join(single, 'modules', 'registry.json')).modules.todo.renamed.map((r) => [r.from, r.to, r.version]), [['task:', 'job:', next]]);
    await server.stop();
    // A key under the old prefix on disk (an old page's late write) is moved on the next start.
    const file = path.join(single, 'modules', 'todo', 'data', `space-${side}.json`);
    fs.writeFileSync(file, JSON.stringify({ ...readJson(file), 'task:late': { value: { title: 'late' }, version: 1, updatedAt: '2026-09-01T00:00:00.000Z', by: 'k' } }));
    server = await startServer(single, { ADMIN_PASSWORD: 'admin-password-1' });
    for (let i = 0; i < 100 && !keys().includes('job:late'); i += 1) await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(keys(), ['job:late', 'job:rb', 'job:t1', 'job:t2', 'job:t3'], 'still applied by the later version that no longer declares it');
    // And back to the version from before the rename: undone, so it finds its keys.
    const admin2 = cookieOf(await call(server, '', 'POST', '/api/login', { body: { login: 'admin', password: 'admin-password-1' } }));
    assert.equal((await call(server, '', 'POST', '/api/modules/todo/rollback', { cookie: admin2, body: { version: shipped.version } })).status, 200);
    assert.deepEqual(keys(), ['task:late', 'task:rb', 'task:t1', 'task:t2', 'task:t3']);
    assert.ok(server.output().includes(`Moved back "todo"'s stored keys from job: to task:, since ${shipped.version} is from before that rename (5 in 1 place).`), server.output());
    assert.deepEqual(readJson(path.join(single, 'modules', 'registry.json')).modules.todo.renamed, []);
    await server.stop();
    server = null;
  });

  // plan-environment-templates step 2: a module's display name and icon in this environment, and a manifest's text in the
  // environment's words.
  await liveTest('live: a module\'s display name and icon show wherever its name does; a refused change changes nothing; manifest text follows the words', async () => {
    const single = path.join(liveDir, 'single-display');
    server = await startServer(single, { ADMIN_PASSWORD: 'admin-password-1' });
    const waitFor = async (text) => { for (let i = 0; i < 100 && !server.output().includes(text); i += 1) await new Promise((r) => setTimeout(r, 50)); assert.ok(server.output().includes(text), `${text}\n${server.output()}`); };
    const admin = cookieOf(await call(server, '', 'POST', '/api/login', { body: { login: 'admin', password: 'admin-password-1' } }));
    const as = (method, url, body) => call(server, '', method, url, { cookie: admin, body });
    const side = (await as('POST', '/api/spaces', { name: 'Side' })).json.space.id; // not the Lobby (the Lobby addendum)
    assert.equal((await as('POST', '/api/modules/bundled/travel/install')).status, 201);
    await waitFor('Auto-installed and enabled "stream"');
    assert.equal((await as('PATCH', '/api/modules/travel', { enabled: true, allSpaces: true })).status, 200);
    const planner = async () => (await as('GET', '/api/modules')).json.modules.find((m) => m.id === 'travel');
    const before = await planner();
    assert.deepEqual([before.name, before.displayName, before.displayIcon, before.ownDisplayName, before.ownDisplayIcon], ['Planner', null, null, null, null], 'no display name: reads as today');
    const stream = async () => (await as('GET', '/api/modules')).json.modules.find((m) => m.id === 'stream');
    assert.equal((await stream()).settings.find((d) => d.key === 'asideDim').label, 'Aside: dim (%)', 'a placeholder in the default words reads as the text did');
    assert.match(before.description, /the events, tasks and polls your space already has\.$/);

    const saved = await as('PATCH', '/api/modules/travel', { displayName: '  Itinerary  ', displayIcon: 'compass' });
    assert.equal(saved.status, 200, saved.text);
    assert.deepEqual([saved.json.module.name, saved.json.module.version, saved.json.module.icon, saved.json.module.displayName, saved.json.module.displayIcon], ['Planner', before.version, before.icon, 'Itinerary', 'compass'], 'the module\'s own name, version and icon stay beside the display ones');
    const shown = (list) => list.find((m) => m.id === 'travel');
    const nav = shown((await as('GET', '/api/modules/nav')).json.modules);
    assert.deepEqual([nav.name, nav.icon], ['Itinerary', 'compass'], 'the nav');
    const widget = shown((await as('GET', '/api/modules/widgets')).json.widgets);
    assert.deepEqual([widget.name, widget.icon, widget.title], ['Itinerary', 'compass', 'Trips'], 'the dashboard: the widget keeps its own title');
    const canvas = shown((await as('GET', `/api/modules/for-space?space=${side}`)).json.modules);
    assert.deepEqual([canvas.name, canvas.icon], ['Itinerary', 'compass'], 'the canvas');
    const context = (await as('GET', '/api/modules/travel/context?scope=environment')).json.module;
    assert.deepEqual([context.name, context.icon, context.version], ['Itinerary', 'compass', before.version], 'host.info.module');
    assert.ok((await as('GET', '/api/roles')).json.permissions.some((p) => p.key === 'module.travel.view' && p.group === 'Module: Itinerary'), 'the Roles grid');

    const refused = [
      [{ displayName: '<b>Trips</b>' }, 'A display name is plain text, without < or >.'],
      [{ displayName: 'x'.repeat(41) }, 'A display name can be at most 40 characters.'],
      [{ displayName: 7 }, "A display name must be text, or null to use the module's own name."],
      [{ displayIcon: 'no-such-icon' }, "There is no icon called no-such-icon in this environment's icons."],
      [{ displayName: 'Changed', spaces: 'lobby' }, 'spaces must be a list'],
    ];
    const registryFile = path.join(single, 'modules', 'registry.json');
    const appBefore = fs.readFileSync(path.join(single, 'app.json'), 'utf8');
    const registryBefore = fs.readFileSync(registryFile, 'utf8');
    for (const [body, error] of refused) assert.deepEqual(await as('PATCH', '/api/modules/travel', body).then((r) => [r.status, r.json]), [400, { error }], JSON.stringify(body));
    assert.equal(fs.readFileSync(path.join(single, 'app.json'), 'utf8'), appBefore, 'a refused change changes nothing');
    assert.equal(fs.readFileSync(registryFile, 'utf8'), registryBefore);
    assert.deepEqual(await as('PATCH', '/api/modules/nope', { displayName: 'x' }).then((r) => [r.status, r.json]), [404, { error: 'no such module' }]);

    // A module's own icon, not in the environment's icon list: Planner's, and a built-in's (Chat's), are allowed.
    assert.equal((await as('PATCH', '/api/modules/places', { displayIcon: 'suitcase-rolling' })).status, 404, 'Places is not installed here');
    const own = await as('PATCH', '/api/modules/travel', { displayIcon: 'suitcase-rolling' });
    assert.deepEqual([own.status, own.json.module.displayIcon], [200, 'suitcase-rolling'], own.text);
    assert.equal((await as('PATCH', '/api/modules/travel', { displayIcon: 'message' })).json.module.displayIcon, 'message', 'Chat\'s own icon');
    await as('PATCH', '/api/modules/travel', { displayIcon: 'compass' });
    const conference = await as('PATCH', '/api/modules/conference', { displayName: 'Call', displayIcon: 'video' });
    assert.deepEqual([conference.status, conference.json.module.name, conference.json.module.displayName], [200, 'Conference', 'Call'], 'a built-in module takes a display name');
    assert.deepEqual((await as('GET', '/api/modules/for-space?space=lobby')).json.builtin.find((b) => b.id === 'conference'), { id: 'conference', name: 'Call', icon: 'video' });
    assert.deepEqual(await as('PATCH', '/api/modules/conference', { enabled: false }).then((r) => [r.status, r.json]), [400, { error: 'Call is built in, so only its display name and icon can be changed here.' }]);

    assert.equal((await as('PATCH', '/api/settings', { words: { aside: { one: 'huddle', many: 'huddles' }, space: { one: 'trip', many: 'trips' }, module: { one: 'tool', many: 'tools' } } })).status, 200);
    assert.equal((await stream()).settings.find((d) => d.key === 'asideDim').label, 'Huddle: dim (%)', 'a manifest\'s placeholders in the owner\'s words');
    assert.match((await planner()).description, /the events, tasks and polls your trip already has\.$/);
    assert.ok((await as('GET', '/api/roles')).json.permissions.some((p) => p.group === 'Tool: Itinerary'));
    assert.match((await as('GET', '/api/modules')).json.bundled.find((m) => m.id === 'places').description, /your trip cares about/, 'the Available list too');

    // Uninstalling with its data clears its display name; a plain uninstall keeps it.
    assert.equal((await as('PATCH', '/api/modules/stream', { displayName: 'Broadcast' })).status, 200);
    assert.equal((await as('DELETE', '/api/modules/stream')).status, 200);
    assert.equal(readJson(path.join(single, 'app.json')).settings.moduleNames.stream, 'Broadcast', 'a plain uninstall keeps it');
    assert.equal((await as('POST', '/api/modules/bundled/stream/install')).status, 201);
    assert.equal((await as('DELETE', '/api/modules/stream?keepData=0')).status, 200);
    assert.equal(readJson(path.join(single, 'app.json')).settings.moduleNames?.stream, undefined, 'uninstalling with its data clears it');
    const reset = await as('PATCH', '/api/modules/travel', { displayName: null, displayIcon: null });
    assert.deepEqual([reset.json.module.displayName, reset.json.module.displayIcon], [null, null]);
    await as('PATCH', '/api/modules/conference', { displayName: '', displayIcon: null });
    const settings = readJson(path.join(single, 'app.json')).settings;
    assert.deepEqual(['moduleNames' in settings, 'moduleIcons' in settings], [false, false], 'nothing stored once every display name is cleared');
    assert.equal(shown((await as('GET', '/api/modules/nav')).json.modules).name, 'Planner');
    await server.stop();
    server = null;
  });

  // plan-environment-templates step 3: an environment made from a template on the console, what it tells the owner and
  // the console, and a restart that applies nothing again.
  await liveTest('live: an environment made from the travel template reports its template, skips what the plan leaves out, and keeps the template\'s values readable under the owner\'s', async () => {
    const hosted = path.join(liveDir, 'hosted-template');
    const start = () => startServer(hosted, { BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'boss', ADMIN_PASSWORD: 'host-password-3' });
    server = await start();
    const boss = cookieOf(await call(server, 'admin', 'POST', '/api/host/login', { body: { login: 'boss', password: 'host-password-3' } }));
    assert.deepEqual((await call(server, 'admin', 'GET', '/api/host/templates', { cookie: boss })).json.templates.map((t) => t.id), ['travel']);
    assert.deepEqual(await call(server, 'admin', 'POST', '/api/host/environments', { cookie: boss, body: { slug: 'nope', name: 'Nope', template: 'camping' } }).then((r) => [r.status, r.json]), [400, { error: 'There is no template called camping.' }]);
    for (const template of [['travel'], { id: 'travel' }, 7]) assert.deepEqual(await call(server, 'admin', 'POST', '/api/host/environments', { cookie: boss, body: { slug: 'nope', name: 'Nope', template } }).then((r) => [r.status, r.json]), [400, { error: 'A template is named by its id, such as travel.' }], JSON.stringify(template));
    const plan = { modules: fs.readdirSync(path.join(ROOT, 'modules')).filter((m) => m !== 'maps') };
    assert.equal((await call(server, 'admin', 'POST', '/api/host/environments', { cookie: boss, body: { slug: 'trips', name: 'Trips', plan, template: 'travel', owner: { login: 'olga', password: 'olga-password-1' } } })).status, 201);
    const listed = async () => (await call(server, 'admin', 'GET', '/api/host/environments', { cookie: boss })).json.environments.find((e) => e.slug === 'trips').template;
    let template;
    for (let i = 0; i < 100 && !(template = await listed())?.appliedAt; i += 1) await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual([template.id, template.name, template.skipped.map((x) => [x.id, x.name, x.why])[0]], ['travel', 'Travel', ['maps', 'Maps', 'not in the plan']]);
    const owner = cookieOf(await call(server, 'trips', 'POST', '/api/login', { body: { login: 'olga', password: 'olga-password-1' } }));
    const settingsOf = async () => (await call(server, 'trips', 'GET', '/api/settings', { cookie: owner })).json.settings;
    let st = await settingsOf();
    assert.deepEqual([st.template.id, st.words.space.one, st.homeIcon, st.ownHomeIcon, st.templateWords, st.templateHomeIcon, st.spaceDefaults], ['travel', 'trip', 'suitcase-rolling', null, { space: { one: 'trip', many: 'trips' } }, 'suitcase-rolling', { profile: 'participants' }]);
    await call(server, 'trips', 'PATCH', '/api/settings', { cookie: owner, body: { words: { space: { one: 'journey', many: 'journeys' } }, homeIcon: 'couch' } });
    await call(server, 'trips', 'PATCH', '/api/modules/travel', { cookie: owner, body: { displayName: 'Plans' } });
    st = await settingsOf();
    assert.deepEqual([st.words.space.one, st.homeIcon, st.templateWords.space.one, st.templateHomeIcon], ['journey', 'couch', 'trip', 'suitcase-rolling'], 'the template\'s stay readable under the owner\'s');
    const travel = (await call(server, 'trips', 'GET', '/api/modules', { cookie: owner })).json.modules.find((m) => m.id === 'travel');
    assert.deepEqual([travel.displayName, travel.ownDisplayName, travel.templateDisplayName, travel.templateDisplayIcon], ['Plans', 'Plans', 'Itinerary', null]);
    const places = (await call(server, 'trips', 'GET', '/api/modules', { cookie: owner })).json.modules.find((m) => m.id === 'places');
    assert.deepEqual([places.templateDisplayName, places.templateDisplayIcon], [null, null]);
    await server.stop();
    server = await start();
    const again = (await call(server, 'admin', 'GET', '/api/host/environments', { cookie: (cookieOf(await call(server, 'admin', 'POST', '/api/host/login', { body: { login: 'boss', password: 'host-password-3' } }))) })).json.environments.find((e) => e.slug === 'trips').template;
    assert.deepEqual(again, template, 'after a restart the console reads the same record');
    assert.ok(!server.output().includes('Applied the'), `nothing applied again:\n${server.output()}`);
    // A Travel backup restored into an environment made with no template: the console follows the restored record.
    const boss2 = cookieOf(await call(server, 'admin', 'POST', '/api/host/login', { body: { login: 'boss', password: 'host-password-3' } }));
    assert.equal((await call(server, 'admin', 'POST', '/api/host/environments', { cookie: boss2, body: { slug: 'plain', name: 'Plain' } })).status, 201);
    const plainTemplate = async () => (await call(server, 'admin', 'GET', '/api/host/environments', { cookie: boss2 })).json.environments.find((e) => e.slug === 'plain').template;
    assert.equal(await plainTemplate(), null);
    const backup = await call(server, 'admin', 'POST', '/api/host/environments/trips/backup', { cookie: boss2 });
    assert.equal(backup.status, 200);
    assert.equal((await call(server, 'admin', 'POST', '/api/host/environments/plain/restore', { cookie: boss2, body: backup.raw, type: 'application/zip' })).status, 200);
    const restored = await plainTemplate();
    assert.deepEqual([restored.id, restored.name, restored.appliedAt, restored.skipped[0].id], ['travel', 'Travel', template.appliedAt, 'maps']);
    assert.equal(readJson(path.join(hosted, 'host.json')).environments.find((e) => e.slug === 'plain').template, 'travel', 'the registry follows the record');
    assert.equal((await call(server, 'plain', 'GET', '/api/branding')).json.words.space.one, 'journey', 'the owner\'s own word travels with the backup too');
    assert.ok(!/\[plain\] Applied the/.test(server.output()), 'a restored record is not applied again');
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
