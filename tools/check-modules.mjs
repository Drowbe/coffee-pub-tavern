#!/usr/bin/env node
/*
 * check-modules.mjs -- run server/modules.js's manifest cleaning on its own (server/modules.js:cleanManifest), no server,
 * no filesystem beyond what it needs. Focused on the parts easy to get wrong by hand in a module.json.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { cleanManifest, permissionDefaults, PERMISSION_KEY_RE, ModuleError } = createRequire(import.meta.url)('../server/modules.js');
let n = 0;
const test = (name, fn) => { fn(); n += 1; };

// The smallest manifest cleanManifest will accept: a server-scope module with one page.
const base = () => ({ id: 'thing', name: 'Thing', version: '1.0.0', scope: ['server'], surfaces: { page: { entry: 'page.html' } } });
const files = new Set(['page.html']);

test('a setting keeps a help paragraph longer than a one-line hint', () => {
  const long = 'A world PMTiles file to cut a region from with "Add a region", below. the host reads only the part it cuts, over https range requests, never the whole file. Protomaps publishes a daily build at https://maps.protomaps.com/builds; its address is dated and changes most days (for example https://build.protomaps.com/20260921.pmtiles), so check that page for todays, or point this at your own stable copy. Left empty, cutting a region is off.';
  assert.ok(long.length > 200 && long.length <= 600, 'the fixture itself must sit between the old and new ceilings');
  const m = cleanManifest({ ...base(), settings: [{ key: 'worldSource', label: 'World file', type: 'url', scope: 'server', default: '', help: long }] }, files);
  assert.equal(m.settings[0].help, long); // not cut off mid-sentence
});

test('an absurdly long help is still capped, not unbounded', () => {
  const m = cleanManifest({ ...base(), settings: [{ key: 'x', label: 'X', type: 'boolean', scope: 'server', default: false, help: 'y'.repeat(1000) }] }, files);
  assert.equal(m.settings[0].help.length, 600);
});

test('line breaks in a setting\'s help are kept, not collapsed', () => {
  const m = cleanManifest({ ...base(), settings: [{ key: 'x', label: 'X', type: 'boolean', scope: 'server', default: false, help: 'First line.\n\nSecond line.' }] }, files);
  assert.equal(m.settings[0].help, 'First line.\n\nSecond line.');
});

test('a choice option\'s own help is unaffected (already had the wider ceiling)', () => {
  const m = cleanManifest({ ...base(), settings: [{ key: 'x', label: 'X', type: 'choice', scope: 'server', default: 'a', options: [{ value: 'a', label: 'A', help: 'z'.repeat(700) }, { value: 'b', label: 'B' }] }] }, files);
  assert.equal(m.settings[0].options[0].help.length, 600);
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

console.log(`check-modules: ${n} groups OK`);
