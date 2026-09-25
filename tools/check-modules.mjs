#!/usr/bin/env node
/*
 * check-modules.mjs -- run server/modules.js's manifest cleaning on its own (server/modules.js:cleanManifest), no server,
 * no filesystem beyond what it needs. Focused on the parts easy to get wrong by hand in a module.json.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { cleanManifest, permissionDefaults, PERMISSION_KEY_RE, ModuleError, ModuleManager } = createRequire(import.meta.url)('../server/modules.js');
let n = 0;
const test = (name, fn) => { fn(); n += 1; };

// The smallest manifest cleanManifest will accept: an environment-scope module with one page.
const base = () => ({ id: 'thing', name: 'Thing', version: '1.0.0', scope: ['environment'], surfaces: { page: { entry: 'page.html' } } });
const files = new Set(['page.html', 'panel.html']);

test('a setting keeps a help paragraph longer than a one-line hint', () => {
  const long = 'A world PMTiles file to cut a region from with "Add a region", below. the host reads only the part it cuts, over https range requests, never the whole file. Protomaps publishes a daily build at https://maps.protomaps.com/builds; its address is dated and changes most days (for example https://build.protomaps.com/20260921.pmtiles), so check that page for todays, or point this at your own stable copy. Left empty, cutting a region is off.';
  assert.ok(long.length > 200 && long.length <= 600, 'the fixture itself must sit between the old and new ceilings');
  const m = cleanManifest({ ...base(), settings: [{ key: 'worldSource', label: 'World file', type: 'url', scope: 'environment', default: '', help: long }] }, files);
  assert.equal(m.settings[0].help, long); // not cut off mid-sentence
});

test('an absurdly long help is still capped, not unbounded', () => {
  const m = cleanManifest({ ...base(), settings: [{ key: 'x', label: 'X', type: 'boolean', scope: 'environment', default: false, help: 'y'.repeat(1000) }] }, files);
  assert.equal(m.settings[0].help.length, 600);
});

test('line breaks in a setting\'s help are kept, not collapsed', () => {
  const m = cleanManifest({ ...base(), settings: [{ key: 'x', label: 'X', type: 'boolean', scope: 'environment', default: false, help: 'First line.\n\nSecond line.' }] }, files);
  assert.equal(m.settings[0].help, 'First line.\n\nSecond line.');
});

test('a choice option\'s own help is unaffected (already had the wider ceiling)', () => {
  const m = cleanManifest({ ...base(), settings: [{ key: 'x', label: 'X', type: 'choice', scope: 'environment', default: 'a', options: [{ value: 'a', label: 'A', help: 'z'.repeat(700) }, { value: 'b', label: 'B' }] }] }, files);
  assert.equal(m.settings[0].options[0].help.length, 600);
});

test('a manifest\'s scopes are environment, space and person; the old names are read as them until plan-names step 5c', () => {
  const both = { page: { entry: 'page.html' }, panel: { entry: 'panel.html' } };
  const m = cleanManifest({ ...base(), scope: ['environment', 'space', 'person'], surfaces: both, settings: [{ key: 'a', label: 'A', type: 'boolean', scope: 'space' }, { key: 'b', label: 'B', type: 'boolean' }] }, files);
  assert.deepEqual(m.scope, ['environment', 'space', 'person']);
  assert.deepEqual(m.settings.map((d) => d.scope), ['space', 'environment'], 'a setting with no scope is the environment\'s');
  const old = cleanManifest({ ...base(), scope: ['server', 'room'], surfaces: both, settings: [{ key: 'a', label: 'A', type: 'boolean', scope: 'room' }, { key: 'n', label: 'N', type: 'note', scope: 'server' }], install: { auto: true, settingsFrom: 'server' } }, files);
  assert.deepEqual([old.scope, old.settings.map((d) => d.scope), old.install.settingsFrom], [['environment', 'space'], ['space', 'environment'], 'environment']);
  assert.throws(() => cleanManifest({ ...base(), scope: ['nowhere'] }, files), /"scope" must include "environment", "space", or both/);
  assert.throws(() => cleanManifest({ ...base(), scope: ['space'] }, files), /the "space" scope needs a surfaces.panel/);
  assert.throws(() => cleanManifest({ ...base(), settings: [{ key: 'f', label: 'F', type: 'file', scope: 'space' }] }, files), /its scope must be "environment"/);
});

test('bad input still throws a ModuleError, same as before', () => {
  assert.throws(() => cleanManifest({ ...base(), id: '' }, files), ModuleError);
});

test('a permission\'s defaults are keyed by the editable roles: member, read under its old name user too (plan-names step 4)', () => {
  const perm = (d) => cleanManifest({ ...base(), permissions: [{ key: 'view', label: 'View', default: d }] }, files).permissions[0].default;
  assert.deepEqual(perm({ user: true, guest: true }), { member: true, guest: true, moderator: true });
  assert.deepEqual(perm({ member: true }), { member: true, guest: false, moderator: true });
  assert.deepEqual(perm({ member: false, user: true, moderator: false }), { member: false, guest: false, moderator: false }, 'the new name wins');
  // What the Roles grid reads (ModuleManager.permissionList), from the stored manifest as its author wrote it.
  assert.deepEqual(permissionDefaults({ user: true, guest: true, moderator: true }), { moderator: true, member: true, guest: true });
  assert.deepEqual(permissionDefaults({ user: true }), { moderator: false, member: true, guest: false }, 'a missing moderator stays off, as before');
  assert.deepEqual(permissionDefaults({ member: false, user: true }), { moderator: false, member: false, guest: false });
  assert.deepEqual(permissionDefaults(undefined), { moderator: false, member: false, guest: false });
});

// Every bundled module's own permissions (modules/<id>/module.json) against the rule install applies, so a key the
// server would refuse fails here rather than at install. Also: each listed once, and each access guard names one.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('every bundled module\'s permission keys pass the server\'s rule, once each, and its access guards name them', () => {
  const problems = [];
  const dirs = fs.readdirSync(path.join(ROOT, 'modules'), { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(ROOT, 'modules', d.name, 'module.json')));
  assert.ok(dirs.length > 0, 'the bundled modules were found');
  for (const d of dirs) {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', d.name, 'module.json'), 'utf8'));
    const keys = (Array.isArray(manifest.permissions) ? manifest.permissions : []).map((p) => p && p.key);
    for (const key of keys) {
      if (typeof key !== 'string' || !PERMISSION_KEY_RE.test(key)) problems.push(`modules/${d.name}/module.json: permission key ${JSON.stringify(key)} must match ${PERMISSION_KEY_RE} (lowercase letters, digits and underscores)`);
    }
    for (const key of new Set(keys.filter((k, i) => keys.indexOf(k) !== i))) problems.push(`modules/${d.name}/module.json: permission "${key}" is listed twice`);
    for (const [kind, named] of Object.entries(manifest.access && typeof manifest.access === 'object' ? manifest.access : {})) {
      if (named && !keys.includes(named)) problems.push(`modules/${d.name}/module.json: access.${kind} names "${named}", which is not one of its permissions`);
    }
  }
  assert.deepEqual(problems, []);
  // The rule itself, as the server applies it.
  assert.throws(() => cleanManifest({ ...base(), permissions: [{ key: 'manageAny', label: 'x' }] }, files), /lowercase letters, digits or underscores/);
  assert.equal(cleanManifest({ ...base(), permissions: [{ key: 'manage_any', label: 'x' }] }, files).permissions[0].key, 'manage_any');
});

// ModuleManager.update against a throwaway registry (under the system temp folder): a refused update changes nothing,
// not the module and not the modules that need it, in memory or on disk (GitHub #17).
test('a refused module update changes nothing, including the modules that need it; a valid one still applies', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-modules-'));
  try {
    const put = (id, m) => {
      const d = path.join(dir, 'modules', id, 'versions', '1.0.0');
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'module.json'), JSON.stringify({ id, name: id, version: '1.0.0', ...m }));
    };
    const panel = { page: { entry: 'page.html' }, panel: { entry: 'panel.html' } };
    put('base', { scope: ['environment', 'space'], surfaces: panel });
    put('child', { scope: ['environment'], requires: ['base'], surfaces: { page: { entry: 'page.html' } } });
    const entry = (id) => ({ id, versions: ['1.0.0'], version: '1.0.0', enabled: true, allSpaces: false, spaces: ['s1'], approved: { permissions: [], hooks: [], refs: [], events: [], actions: [] }, source: 'upload' });
    const file = path.join(dir, 'modules', 'registry.json');
    fs.writeFileSync(file, JSON.stringify({ modules: { base: entry('base'), child: entry('child') }, autoInstalled: [] }, null, 2));
    const before = fs.readFileSync(file, 'utf8');
    const mm = new ModuleManager(dir);
    const snapshot = () => JSON.stringify(mm.registry);
    const memory = snapshot();
    const refused = [
      [{ enabled: false, force: true, runMode: 'nowhere' }, /runMode must be "page" or "sandbox"/],
      [{ enabled: false, force: true, runMode: 'page' }, /accepting the risk/],
      [{ enabled: false, force: true, allSpaces: true, spaces: 'not a list' }, /spaces must be a list/],
      [{ enabled: false, force: true, runMode: 'sandbox', spaces: 7 }, /spaces must be a list/],
      [{ enabled: false }, /needs base; turn it off too\?/],
    ];
    for (const [patch, message] of refused) {
      assert.throws(() => mm.update('base', patch), message);
      assert.equal(snapshot(), memory, `refused ${JSON.stringify(patch)} left the registry as it was, in memory`);
      assert.equal(fs.readFileSync(file, 'utf8'), before, `refused ${JSON.stringify(patch)} left the registry as it was, on disk`);
    }
    // A valid update still applies all of it, dependents included.
    const view = mm.update('base', { enabled: false, force: true, runMode: 'sandbox', allSpaces: true, spaces: ['s2', 'gone', 's2'] }, { spaceExists: (s) => s !== 'gone' });
    assert.deepEqual([view.enabled, view.runMode, view.allSpaces, view.spaces], [false, 'sandbox', true, ['s2']]);
    assert.equal(mm.registry.modules.child.enabled, false, 'what needs it went off with it');
    const disk = JSON.parse(fs.readFileSync(file, 'utf8')).modules;
    assert.deepEqual([disk.base.enabled, disk.base.runMode, disk.base.allSpaces, disk.base.spaces, disk.child.enabled], [false, 'sandbox', true, ['s2'], false]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`check-modules: ${n} groups OK`);
