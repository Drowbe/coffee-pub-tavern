#!/usr/bin/env node
/*
 * check-host-registry.mjs -- run server/host-registry.js on its own: slugs, tenants, host admins,
 * previousBaseDomains, and that a fresh registry (or a stale one) still loads to something sane.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { HostRegistry, HostError, cleanSlug } = createRequire(import.meta.url)('../server/host-registry.js');
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

test('a fresh registry has a session secret, no tenants, no admins', () => {
  const dir = freshDir();
  const r = new HostRegistry(dir);
  assert.equal(typeof r.sessionSecret, 'string');
  assert.ok(r.sessionSecret.length >= 20);
  assert.deepEqual(r.listTenants(), []);
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

test('tenants: add, find, update, remove', () => {
  const dir = freshDir();
  const r = new HostRegistry(dir);
  const t = r.addTenant({ slug: 'Acme', name: 'Acme Adventures' });
  assert.equal(t.slug, 'acme'); // cleaned
  assert.equal(t.status, 'active');
  assert.deepEqual(t.plan, { modules: 'all', members: null, storageBytes: null, aiCallsPerMonth: null, calls: null });
  assert.throws(() => r.addTenant({ slug: 'acme', name: 'Again' }), (e) => e instanceof HostError && e.status === 409);
  assert.deepEqual(r.findTenant('acme'), t);
  assert.equal(r.findTenant('nope'), null);

  const updated = r.updateTenant('acme', { name: 'Acme Inc', plan: { modules: ['places', 'travel'], members: 20 } });
  assert.equal(updated.name, 'Acme Inc');
  assert.deepEqual(updated.plan.modules, ['places', 'travel']);
  assert.equal(updated.plan.members, 20);
  assert.throws(() => r.updateTenant('nope', {}), (e) => e instanceof HostError && e.status === 404);

  const pastDue = r.updateTenant('acme', { status: 'pastDue' });
  assert.equal(pastDue.status, 'pastDue');
  assert.ok(pastDue.pastDueSince);
  const active = r.updateTenant('acme', { status: 'active' });
  assert.equal(active.pastDueSince, null);
  assert.throws(() => r.updateTenant('acme', { status: 'nonsense' }), HostError);

  r.removeTenant('acme');
  assert.equal(r.findTenant('acme'), null);
  assert.throws(() => r.removeTenant('acme'), (e) => e instanceof HostError && e.status === 404);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a freshly added tenant already has the usage and delete-request defaults, not just a plan', () => {
  const dir = freshDir();
  const r = new HostRegistry(dir);
  const t = r.addTenant({ slug: 'acme', name: 'Acme' });
  assert.equal(t.deleteRequestedAt, null);
  assert.equal(t.deleteRequestReason, '');
  assert.deepEqual(t.usage, { storageBytes: 0, measuredAt: null, aiMonth: '', aiCalls: 0 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a deletion request is set and withdrawn, and shows on the tenant record either way', () => {
  const dir = freshDir();
  const r = new HostRegistry(dir);
  r.addTenant({ slug: 'acme', name: 'Acme' });
  const set = r.requestTenantDeletion('acme', 'moving on');
  assert.ok(set.deleteRequestedAt);
  assert.equal(set.deleteRequestReason, 'moving on');
  assert.ok(r.findTenant('acme').deleteRequestedAt);
  r.withdrawTenantDeletion('acme');
  assert.equal(r.findTenant('acme').deleteRequestedAt, null);
  assert.equal(r.findTenant('acme').deleteRequestReason, '');
  assert.throws(() => r.requestTenantDeletion('nope', ''), (e) => e instanceof HostError && e.status === 404);
  assert.throws(() => r.withdrawTenantDeletion('nope'), (e) => e instanceof HostError && e.status === 404);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('storage usage is cached on the tenant record, measuredAt set each time', () => {
  const dir = freshDir();
  const r = new HostRegistry(dir);
  r.addTenant({ slug: 'acme', name: 'Acme' });
  r.recordStorageUsage('acme', 1234.7);
  assert.equal(r.findTenant('acme').usage.storageBytes, 1235); // rounded
  assert.ok(r.findTenant('acme').usage.measuredAt);
  r.recordStorageUsage('nope', 999); // silently does nothing for an unknown slug
  fs.rmSync(dir, { recursive: true, force: true });
});

test('AI calls are counted per month, rolling over rather than accumulating forever', () => {
  const dir = freshDir();
  const r = new HostRegistry(dir);
  r.addTenant({ slug: 'acme', name: 'Acme' });
  assert.equal(r.aiCallsThisMonth('acme'), 0);
  r.recordAiCall('acme');
  r.recordAiCall('acme');
  assert.equal(r.aiCallsThisMonth('acme'), 2);
  const tenant = r.data.tenants.find((t) => t.slug === 'acme');
  tenant.usage.aiMonth = '2000-01'; // simulate a stale month from before now
  tenant.usage.aiCalls = 999;
  assert.equal(r.aiCallsThisMonth('acme'), 0); // a stale month never counts
  r.recordAiCall('acme');
  assert.equal(r.aiCallsThisMonth('acme'), 1); // rolled over, not added to the stale count
  assert.equal(r.aiCallsThisMonth('nope'), 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a tenant record survives a reload, and a slug that no longer validates is dropped rather than crashing', () => {
  const dir = freshDir();
  new HostRegistry(dir).addTenant({ slug: 'acme', name: 'Acme' });
  assert.equal(new HostRegistry(dir).findTenant('acme').name, 'Acme');
  fs.writeFileSync(path.join(dir, 'host.json'), JSON.stringify({ tenants: [{ slug: 'ok-one', name: 'Fine' }, { slug: 'a', name: 'Too short now' }] }));
  const reloaded = new HostRegistry(dir);
  assert.deepEqual(reloaded.listTenants().map((t) => t.slug), ['ok-one']);
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

console.log(`check-host-registry: ${n} groups OK`);
