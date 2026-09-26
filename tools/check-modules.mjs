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

const { cleanManifest, cleanStorage, oldNameIn, OUTDATED, permissionDefaults, pendingWidensNothing, PERMISSION_KEY_RE, ModuleError, ModuleManager } = createRequire(import.meta.url)('../server/modules.js');
let n = 0;
const { ModuleData } = createRequire(import.meta.url)('../server/module-data.js');
const test = (name, fn) => { fn(); n += 1; };

// The smallest manifest cleanManifest will accept: an environment-scope module with one page.
const base = () => ({ id: 'thing', name: 'Thing', version: '1.0.0', scope: ['environment'], surfaces: { page: { entry: 'page.html' } } });
const files = new Set(['page.html', 'canvas.html']);

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

test('a manifest\'s scopes are environment, space and person', () => {
  const both = { page: { entry: 'page.html' }, canvas: { entry: 'canvas.html', width: 500, height: 9999, mode: ['dock', 'sideways'] } };
  const m = cleanManifest({ ...base(), scope: ['environment', 'space', 'person'], surfaces: both, settings: [{ key: 'a', label: 'A', type: 'boolean', scope: 'space' }, { key: 'b', label: 'B', type: 'boolean' }, { key: 'c', label: 'C', type: 'boolean', scope: 'person' }], install: { auto: true, settingsFrom: 'environment' } }, files);
  assert.deepEqual(m.scope, ['environment', 'space', 'person']);
  assert.deepEqual(m.surfaces.canvas, { entry: 'canvas.html', width: 500, height: 1000, mode: ['dock'], lobby: false, menu: true }, 'surfaces.canvas: its size kept within bounds, its modes only dock and float, not in the Lobby unless it says so, listed in the menu unless it says not');
  assert.equal(cleanManifest({ ...base(), scope: ['environment', 'space'], surfaces: { page: { entry: 'page.html' }, canvas: { entry: 'canvas.html', menu: false } } }, files).surfaces.canvas.menu, false);
  assert.throws(() => cleanManifest({ ...base(), scope: ['environment', 'space'], surfaces: { page: { entry: 'page.html' }, canvas: { entry: 'canvas.html', menu: 'no' } } }, files), /surfaces.canvas.menu must be true or false/);
  assert.deepEqual(m.settings.map((d) => d.scope), ['space', 'environment', 'person'], 'a setting with no scope is the environment\'s');
  assert.equal(m.install.settingsFrom, 'environment');
  assert.throws(() => cleanManifest({ ...base(), scope: ['nowhere'] }, files), /"scope" must include "environment", "space", or both/);
  assert.throws(() => cleanManifest({ ...base(), scope: ['space'] }, files), /the "space" scope needs a surfaces.canvas/);
  assert.throws(() => cleanManifest({ ...base(), settings: [{ key: 'f', label: 'F', type: 'file', scope: 'space' }] }, files), /its scope must be "environment"/);
});

// Plan-names step 5c, the hard break: each old name in a manifest is refused with its one sentence, naming the field
// and what to use instead.
const OLD_SURFACE = 'panel'; // surfaces.canvas before plan-names step 6
const OLD_SUMMARY = 'card'; // refs.produces[].summary before plan-names step 7
const OLD_MANIFESTS = [
  [{ scope: ['environment', 'room'] }, 'module.json uses the old scope "room"; use "space" (Magpie renamed rooms to spaces).'],
  [{ scope: ['server'] }, 'module.json uses the old scope "server"; use "environment" (Magpie renamed the server to the environment).'],
  [{ settings: [{ key: 'a', label: 'A', type: 'boolean', scope: 'room' }] }, 'module.json: setting "a" uses the old scope "room"; use "space" (Magpie renamed rooms to spaces).'],
  [{ settings: [{ key: 'n', label: 'N', type: 'note', scope: 'server' }] }, 'module.json: setting "n" uses the old scope "server"; use "environment" (Magpie renamed the server to the environment).'],
  [{ install: { auto: true, settingsFrom: 'server' } }, 'module.json: install.settingsFrom uses the old name "server"; use "environment" (Magpie renamed the server to the environment).'],
  [{ permissions: [{ key: 'view', label: 'View', default: { user: true } }] }, 'module.json: permission "view" names the old role "user" in its default; use "member" (Magpie renamed the user role to member).'],
  // Plan-names step 6: the canvas surface's old name.
  [{ scope: ['environment', 'space'], surfaces: { page: { entry: 'page.html' }, [OLD_SURFACE]: { entry: 'canvas.html' } } }, "module.json uses the old surfaces.panel; use surfaces.canvas (Magpie renamed a module's panel to its place on the canvas)."],
  // Plan-names step 7: a kind's summary was its card; refused even beside a summary.
  [{ refs: { produces: [{ kind: 'note', key: 'note:{id}', [OLD_SUMMARY]: { title: 'title' } }] } }, 'module.json: refs kind "note" uses the old card; use summary (Magpie renamed an object\'s card to its summary).'],
  [{ refs: { produces: [{ kind: 'note', key: 'note:{id}', summary: { title: 'title' } }, { kind: 'memo', key: 'memo:{id}', summary: { title: 'title' }, [OLD_SUMMARY]: { title: 'title' } }] } }, 'module.json: refs kind "memo" uses the old card; use summary (Magpie renamed an object\'s card to its summary).'],
];
test('a manifest with an old name is refused with a sentence naming the field and what to use', () => {
  for (const [part, sentence] of OLD_MANIFESTS) {
    assert.equal(oldNameIn({ ...base(), ...part }), sentence);
    assert.throws(() => cleanManifest({ ...base(), ...part }, files), (err) => err instanceof ModuleError && err.status === 400 && err.message === sentence, sentence);
  }
  assert.equal(oldNameIn(base()), null);
});

test('a kind of object names the stored fields of its summary, and only those', () => {
  const produces = (p) => cleanManifest({ ...base(), refs: { produces: [{ kind: 'note', key: 'note:{id}', ...p }] } }, files).refs.produces[0];
  const kind = produces({ name: 'Note', open: true, summary: { title: 'title', subtitle: 'body', when: 'due', done: 'done', nonsense: 'x' } });
  assert.deepEqual(kind, { kind: 'note', name: 'Note', key: 'note:{id}', summary: { title: 'title', subtitle: 'body', when: 'due', done: 'done' }, open: true, backlinks: false });
  assert.ok(!('card' in kind), 'no card');
  assert.throws(() => produces({ summary: { subtitle: 'body' } }), (err) => err instanceof ModuleError && err.message === 'module.json: refs "note" needs a summary.title');
  assert.throws(() => produces({ summary: { title: 'no spaces allowed' } }), (err) => err instanceof ModuleError && err.message === 'module.json: refs "note" summary.title must name a stored field');
});

test('storage.renamed: key prefixes a module renamed, checked, each refusal one sentence', () => {
  assert.deepEqual(cleanManifest({ ...base(), storage: { renamed: [{ from: 'item:', to: 'plan:', extra: 1 }] } }, files).storage, { renamed: [{ from: 'item:', to: 'plan:' }] });
  assert.deepEqual(cleanManifest(base(), files).storage, { renamed: [] }, 'none: an empty list');
  const refused = [
    [[], 'module.json: "storage" must be an object, such as { "renamed": [{ "from": "item:", "to": "plan:" }] }.'],
    [{ renamed: 'item:' }, 'module.json: storage.renamed must be a list of at most 10 { "from", "to" } key prefixes.'],
    [{ renamed: Array(11).fill({ from: 'a:', to: 'b:' }) }, 'module.json: storage.renamed must be a list of at most 10 { "from", "to" } key prefixes.'],
    [{ renamed: [{ from: 'item:' }] }, 'module.json: each storage.renamed entry needs a "from" and a "to" key prefix.'],
    [{ renamed: [{ from: 'item :', to: 'plan:' }] }, 'module.json: storage.renamed "item :" to "plan:": a key prefix is 1 to 64 letters, digits and . _ : / -.'],
    [{ renamed: [{ from: '', to: 'plan:' }] }, 'module.json: storage.renamed "" to "plan:": a key prefix is 1 to 64 letters, digits and . _ : / -.'],
    [{ renamed: [{ from: 'item:', to: 'item:x' }] }, 'module.json: storage.renamed "item:" to "item:x": one prefix must not start with the other.'],
    [{ renamed: [{ from: 'a:', to: 'b:' }, { from: 'a:', to: 'c:' }] }, 'module.json: storage.renamed lists "a:" more than once.'],
    // A set that would move a key back: a:→b: with b:→a: (QA), and the same by a longer prefix.
    [{ renamed: [{ from: 'a:', to: 'b:' }, { from: 'b:', to: 'a:' }] }, 'module.json: storage.renamed "b:" to "a:" would move keys back under "a:", which an earlier entry renames from.'],
    [{ renamed: [{ from: 'a:', to: 'b:' }, { from: 'b:', to: 'a:x' }] }, 'module.json: storage.renamed "b:" to "a:x" would move keys back under "a:", which an earlier entry renames from.'],
  ];
  assert.deepEqual(cleanStorage({ renamed: [{ from: 'a:', to: 'b:' }, { from: 'b:', to: 'c:' }] }).renamed.map((r) => r.to), ['b:', 'c:'], 'a chain moves forward: allowed');
  for (const [storage, sentence] of refused) {
    assert.throws(() => cleanStorage(storage), (err) => err instanceof ModuleError && err.status === 400 && err.message === sentence, sentence);
    assert.throws(() => cleanManifest({ ...base(), storage }, files), (err) => err.message === sentence);
  }
});

test('a stored-key rename moves every key with the prefix in every scope, never overwrites a taken name, and does nothing twice', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-modules-rename-'));
  try {
    const data = path.join(dir, 'm', 'data');
    fs.mkdirSync(data, { recursive: true });
    const e = (title, version = 2) => ({ value: { title }, version, updatedAt: '2026-01-01T00:00:00.000Z', by: 'k' });
    fs.writeFileSync(path.join(data, 'environment.json'), JSON.stringify({ 'item:1': e('one'), 'itemish': e('not the prefix') }));
    fs.writeFileSync(path.join(data, 'space-abcd.json'), JSON.stringify({ 'item:2': e('two', 5), 'item:3': e('old three'), 'plan:3': e('new three') }));
    fs.writeFileSync(path.join(data, 'person-memberkey1.json'), JSON.stringify({ 'item:4': e('four') }));
    fs.writeFileSync(path.join(data, 'space-efgh.json'), JSON.stringify({ 'plan:5': e('already') }));
    fs.writeFileSync(path.join(data, 'notes.txt'), 'not a scope');
    const md = new ModuleData(dir);
    assert.equal(md.get('m', 'space:abcd', 'item:2').version, 5, 'read before, so the cache is warm');
    const untouched = fs.readFileSync(path.join(data, 'space-efgh.json'), 'utf8');
    assert.deepEqual(md.renamePrefix('m', 'item:', 'plan:'), { moved: 3, kept: 1, scopes: 3 });
    const read = (f) => JSON.parse(fs.readFileSync(path.join(data, f), 'utf8'));
    assert.deepEqual(Object.keys(read('environment.json')).sort(), ['itemish', 'plan:1']);
    assert.deepEqual(read('space-abcd.json'), { 'plan:2': e('two', 5), 'item:3': e('old three'), 'plan:3': e('new three') });
    assert.deepEqual(Object.keys(read('person-memberkey1.json')), ['plan:4']);
    assert.equal(fs.readFileSync(path.join(data, 'space-efgh.json'), 'utf8'), untouched, 'nothing to move: not written');
    assert.equal(md.get('m', 'space:abcd', 'plan:2').value.title, 'two', 'the cache follows');
    assert.equal(md.get('m', 'space:abcd', 'item:2'), null);
    assert.equal(new ModuleData(dir).get('m', 'person:memberkey1', 'plan:4').value.title, 'four', 'and the files');
    assert.deepEqual(md.renamePrefix('m', 'item:', 'plan:'), { moved: 0, kept: 1, scopes: 0 }, 'again: only the taken one, left as it is');
    assert.deepEqual(md.renamePrefix('none', 'item:', 'plan:'), { moved: 0, kept: 0, scopes: 0 }, 'a module with no data');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('bad input still throws a ModuleError, same as before', () => {
  assert.throws(() => cleanManifest({ ...base(), id: '' }, files), ModuleError);
});

test('a permission\'s defaults are keyed by the editable roles: moderator, member, guest', () => {
  const perm = (d) => cleanManifest({ ...base(), permissions: [{ key: 'view', label: 'View', default: d }] }, files).permissions[0].default;
  assert.deepEqual(perm({ member: true, guest: true }), { member: true, guest: true, moderator: true });
  assert.deepEqual(perm({ member: true }), { member: true, guest: false, moderator: true });
  assert.deepEqual(perm({ member: true, moderator: false }), { member: true, guest: false, moderator: false });
  // What the Roles grid reads (ModuleManager.permissionList), from the stored manifest as its author wrote it.
  assert.deepEqual(permissionDefaults({ member: true, guest: true, moderator: true }), { moderator: true, member: true, guest: true });
  assert.deepEqual(permissionDefaults({ member: true }), { moderator: false, member: true, guest: false }, 'a missing moderator stays off, as before');
  assert.deepEqual(permissionDefaults(undefined), { moderator: false, member: false, guest: false });
});

// Every bundled module's own permissions (modules/<id>/module.json) against the rule install applies, so a key the
// server would refuse fails here rather than at install. Also: each listed once, and each access guard names one.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('every bundled module\'s manifest uses only the new names, and its permission keys pass the server\'s rule, once each, and its access guards name them', () => {
  const problems = [];
  const dirs = fs.readdirSync(path.join(ROOT, 'modules'), { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(ROOT, 'modules', d.name, 'module.json')));
  assert.ok(dirs.length > 0, 'the bundled modules were found');
  for (const d of dirs) {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', d.name, 'module.json'), 'utf8'));
    const keys = (Array.isArray(manifest.permissions) ? manifest.permissions : []).map((p) => p && p.key);
    for (const key of keys) {
      if (typeof key !== 'string' || !PERMISSION_KEY_RE.test(key)) problems.push(`modules/${d.name}/module.json: permission key ${JSON.stringify(key)} must match ${PERMISSION_KEY_RE} (lowercase letters, digits and underscores)`);
    }
    const old = oldNameIn(manifest);
    if (old) problems.push(`modules/${d.name}/${old}`);
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
    const surfaces = { page: { entry: 'page.html' }, canvas: { entry: 'canvas.html' } };
    put('base', { scope: ['environment', 'space'], surfaces });
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

// An installed module whose stored manifest uses an old name (plan-names step 5c): kept and shown, but it can't run,
// can't be turned on, and no version of it in the old names can be rolled back to. The registry keeps the owner's
// choice, so a fixed version runs again as it was.
test('an installed module with an old manifest does not run, says why, and cannot be turned on', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-modules-'));
  try {
    const put = (id, version, m) => {
      const d = path.join(dir, 'modules', id, 'versions', version);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'module.json'), JSON.stringify({ id, name: id, version, ...m }));
    };
    const surfaces = { page: { entry: 'page.html' }, canvas: { entry: 'canvas.html' } };
    put('old', '1.0.0', { scope: ['environment', 'space'], surfaces });
    put('old', '0.9.0', { scope: ['server', 'room'], surfaces });
    put('needer', '1.0.0', { scope: ['environment'], requires: ['old'], surfaces: { page: { entry: 'page.html' } } });
    const entry = (id, version, versions) => ({ id, versions, version, enabled: true, allSpaces: true, spaces: [], approved: { permissions: [], hooks: [], refs: [], events: [], actions: [] }, source: 'upload' });
    const file = path.join(dir, 'modules', 'registry.json');
    fs.writeFileSync(file, JSON.stringify({ modules: { old: entry('old', '0.9.0', ['0.9.0', '1.0.0']), needer: entry('needer', '1.0.0', ['1.0.0']) }, autoInstalled: [] }, null, 2));
    const before = fs.readFileSync(file, 'utf8');
    const mm = new ModuleManager(dir);
    assert.equal(mm.enabled('old'), null, 'it does not run');
    assert.equal(mm.resolveFile('old', '0.9.0', 'page.html'), null, 'its files are not served');
    const view = mm.view('old');
    assert.deepEqual(view.outdatedVersions, ['0.9.0'], 'the installed versions in the old names');
    assert.deepEqual([view.enabled, view.outdated, view.outdatedWhy], [false, OUTDATED, 'module.json uses the old scope "server"; use "environment" (Magpie renamed the server to the environment).']);
    // What requires it does not run either, and says it waits on an update rather than on being turned on.
    assert.equal(mm.enabled('needer'), null, 'what requires it does not run');
    assert.deepEqual(mm.enabledAll().map(({ manifest }) => manifest.id), []);
    const needer = mm.view('needer');
    assert.deepEqual([needer.enabled, needer.needsUpdate, needer.missing, needer.outdated], [false, ['old'], [], null]);
    assert.throws(() => mm.update('needer', { enabled: true }), (err) => err.status === 409 && err.message === 'needer needs old, which needs an update from its author.');
    assert.throws(() => mm.update('old', { enabled: true }), (err) => err.status === 409 && err.message === 'old was built for an older Magpie and needs an update from its author.');
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'nothing was written at start or by the refused updates');
    // Turning the outdated one off does not ask about what requires it: that is not running.
    assert.equal(mm.update('old', { enabled: false }).enabled, false);
    assert.equal(mm.registry.modules.needer.enabled, true, 'its own choice kept');
    // QA's case: the fixed version arrives while the requirement is off. What requires it still does not run (its own
    // choice kept), and says what is missing; turning the requirement on runs both.
    assert.equal(mm.rollback('old', '1.0.0').enabled, false);
    assert.equal(mm.enabled('needer'), null, 'a module whose requirement is off never runs');
    assert.deepEqual([mm.view('needer').enabled, mm.view('needer').needsUpdate, mm.view('needer').missing], [false, [], ['old']]);
    assert.deepEqual(mm.enabledAll().map(({ manifest }) => manifest.id), []);
    assert.equal(mm.update('old', { enabled: true }).enabled, true);
    assert.deepEqual([mm.view('needer').enabled, mm.view('needer').needsUpdate, mm.view('needer').missing], [true, [], []]);
    assert.deepEqual([mm.view('old').outdated, mm.view('old').outdatedVersions], [null, ['0.9.0']], 'the old version is still marked while it is kept');
    assert.throws(() => mm.rollback('old', '0.9.0'), (err) => err.status === 409 && err.message === "old 0.9.0 was built for an older Magpie, so it can't be rolled back to.");
    assert.equal(mm.registry.modules.old.version, '1.0.0');
    // Uninstalling what it requires turns it off, as before.
    mm.uninstall('old');
    assert.equal(mm.registry.modules.needer.enabled, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The bundled update at start (index.js, updateOutdatedBundled) keeps a module on when all it newly asks for is
// permissions off for every role: those give nobody but owners anything. Anything else still waits for approval.
test('a bundled update widens nothing only when every new request is a permission off for every role', () => {
  const none = { permissions: [], hooks: [], refs: [], events: [], actions: [] };
  const perms = [{ key: 'view_page', default: { member: false, moderator: false, guest: false } }, { key: 'closed', default: {} }, { key: 'open', default: { member: true } }, { key: 'mods', default: { moderator: true } }, { key: 'guests', default: { guest: true } }];
  assert.equal(pendingWidensNothing(none, perms), true, 'nothing new');
  assert.equal(pendingWidensNothing({ ...none, permissions: ['view_page', 'closed'] }, perms), true, 'permissions off for every role');
  for (const key of ['open', 'mods', 'guests']) assert.equal(pendingWidensNothing({ ...none, permissions: ['view_page', key] }, perms), false, `${key} is on for a role`);
  assert.equal(pendingWidensNothing({ ...none, permissions: ['unknown'] }, perms), false, 'a permission it cannot read');
  for (const kind of ['hooks', 'refs', 'events', 'actions']) assert.equal(pendingWidensNothing({ ...none, [kind]: ['x'] }, perms), false, `a new ${kind} request`);
});

// A permission an author renamed says so (`replaces`), and each role's own choice for the old key is carried to the new
// one once (Store.carryRoleGrant, run by index.js's carryReplacedGrants after any install and at start).
test('a renamed permission carries each role\'s choice for its old key over once, and replaces is checked', () => {
  const m = cleanManifest({ ...base(), permissions: [{ key: 'view_page', label: 'See the page', replaces: 'links', default: {} }] }, files);
  assert.equal(m.permissions[0].replaces, 'links');
  const sentence = 'module.json: permission "view_page" replaces must name a key this module no longer uses';
  assert.throws(() => cleanManifest({ ...base(), permissions: [{ key: 'view_page', label: 'x', replaces: 'links' }, { key: 'see', label: 'y', replaces: 'links' }] }, files), (err) => err.message === 'module.json: permission "see" replaces "links", which permission "view_page" already replaces');
  for (const replaces of ['view_page', 'Bad-Key', 7, 'edit']) {
    assert.throws(() => cleanManifest({ ...base(), permissions: [{ key: 'view_page', label: 'x', replaces }, { key: 'edit', label: 'y' }] }, files), (err) => err.message === sentence, String(replaces));
  }
  const { Store } = createRequire(import.meta.url)('../server/store.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-modules-store-'));
  try {
    const store = new Store(dir);
    store.data.settings.roles = { member: { 'module.stream.links': true, chat: false }, moderator: { 'module.stream.links': false, 'module.stream.view_page': true }, guest: { react: false } };
    store.save();
    assert.deepEqual(store.carryRoleGrant('module.stream.links', 'module.stream.view_page'), ['member'], 'carried where there was no choice for the new key yet');
    const roles = JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8')).settings.roles;
    assert.deepEqual(roles, { member: { chat: false, 'module.stream.view_page': true }, moderator: { 'module.stream.view_page': true }, guest: { react: false } }, 'the old key gone everywhere; a choice already made for the new key kept');
    assert.deepEqual(store.carryRoleGrant('module.stream.links', 'module.stream.view_page'), [], 'once: nothing left to carry');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a manifest\'s text a person reads is filled with the environment\'s words; one with no placeholder is the same object', () => {
  const { fillManifest, manifestTexts } = createRequire(import.meta.url)('../server/modules.js');
  const { resolve } = createRequire(import.meta.url)('../server/words.js');
  const words = resolve({ space: { one: 'trip', many: 'trips' }, module: { one: 'tool', many: 'tools' } }, null);
  const plain = { id: 'p', name: 'Plain', description: 'No placeholders here.', permissions: [{ key: 'v', label: 'View' }] };
  assert.equal(fillManifest(plain, words), plain);
  const m = {
    id: 'demo', name: 'The {Space} Tool', description: 'For every {space}.',
    surfaces: { widget: { title: '{Spaces}' } },
    permissions: [{ key: 'edit', label: 'Edit {a space}' }],
    settings: [{ key: 'k', label: 'Per {module}', help: 'Each {space} {x}', options: [{ value: 'a', label: '{Modules}', help: '{an space}' }] }],
    events: { publishes: [{ name: 'e', label: 'In {a space}' }] },
    actions: { provides: [{ name: 'a', label: 'Open {a module}' }] },
    refs: { produces: [{ kind: 'note', name: '{Space} note' }] },
  };
  const f = fillManifest(m, words);
  assert.notEqual(f, m);
  assert.equal(m.description, 'For every {space}.', 'the stored manifest is untouched');
  assert.deepEqual(manifestTexts(f).map(([o, k]) => o[k]), ['For every trip.', 'Trips', 'Edit a trip', 'Per tool', 'Each trip {x}', 'Tools', 'a trip', 'In a trip', 'Open a tool', 'Trip note']);
  assert.equal(f.name, 'The {Space} Tool', 'a name is a name, never filled');
  assert.equal(fillManifest(m, null).description, 'For every space.', 'no words: the defaults');
});

test('a kind\'s {name} is the module\'s shown name, never a word: the words leave it as it is', () => {
  const { fillManifest } = createRequire(import.meta.url)('../server/modules.js');
  const { resolve } = createRequire(import.meta.url)('../server/words.js');
  const words = resolve({ space: { one: 'trip', many: 'trips' } }, null);
  const only = { id: 'p', name: 'Planner', refs: { produces: [{ kind: 'plan', name: '{name}' }] } };
  assert.equal(fillManifest(only, words), only, 'a {name} alone is no words placeholder: the manifest itself');
  const both = { id: 'p', name: 'Planner', refs: { produces: [{ kind: 'plan', name: '{name} in the {space}' }] } };
  assert.equal(fillManifest(both, words).refs.produces[0].name, '{name} in the trip');
  assert.equal(cleanManifest({ ...base(), refs: { produces: [{ kind: 'plan', key: 'plan:{id}', name: '{name}', summary: { title: 'title' } }] } }, files).refs.produces[0].name, '{name}', 'kept for the server to fill');
});

test('a display name and icon are checked before anything is saved, each with one sentence', () => {
  const { Store } = createRequire(import.meta.url)('../server/store.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-modules-display-'));
  try {
    const store = new Store(dir);
    assert.deepEqual(store.moduleDisplay('travel'), { name: null, icon: null, ownName: null, ownIcon: null, templateName: null, templateIcon: null });
    assert.deepEqual(store.checkModuleDisplay('travel', { displayName: '  Trip   planner ', displayIcon: 'compass' }), { name: 'Trip planner', icon: 'compass' });
    assert.deepEqual(store.checkModuleDisplay('travel', { displayName: '', displayIcon: null }), { name: null, icon: null });
    assert.deepEqual(store.checkModuleDisplay('travel', {}), {});
    assert.deepEqual(store.checkModuleDisplay('travel', { displayName: 'Trip\tplanner\n' }), { name: 'Trip planner' }, 'tabs and new lines read as spaces');
    // Only an icon the pages draw as a module's (fa-solid fa-<id>): a brands or regular one on the list is refused.
    store.updateSettings({ icons: [...store.settings.icons, { id: 'discord', classes: 'fa-brands fa-discord' }, { id: 'my-star', classes: 'fa-regular fa-star' }, { id: 'odd', classes: 'fa-solid fa-star' }] });
    for (const icon of ['discord', 'my-star', 'odd']) assert.throws(() => store.checkModuleDisplay('travel', { displayIcon: icon }), (err) => err.status === 400 && err.message === `The icon ${icon} is not a solid Font Awesome icon, so it can't be a module's icon.`, icon);
    for (const [patch, sentence] of [
      [{ displayName: '<i>x</i>' }, 'A display name is plain text, without < or >.'],
      [{ displayName: 'a\u0007b' }, "A display name can't hold control or text-direction characters."],
      [{ displayName: 'Trip\u202eplanner' }, "A display name can't hold control or text-direction characters."],
      [{ displayName: '\u2066Trips\u2069' }, "A display name can't hold control or text-direction characters."],
      [{ displayName: 'a\u061cb' }, "A display name can't hold control or text-direction characters."],
      [{ displayName: 'x'.repeat(41) }, 'A display name can be at most 40 characters.'],
      [{ displayName: ['x'] }, "A display name must be text, or null to use the module's own name."],
      [{ displayIcon: 3 }, "An icon must be one of this environment's icons, or null to use the module's own."],
      [{ displayIcon: 'unicorn-rocket' }, "There is no icon called unicorn-rocket in this environment's icons."],
    ]) assert.throws(() => store.checkModuleDisplay('travel', patch), (err) => err.status === 400 && err.message === sentence, JSON.stringify(patch));
    store.applyModuleDisplay('travel', { name: 'Itinerary', icon: 'compass' });
    assert.deepEqual(store.moduleDisplay('travel'), { name: 'Itinerary', icon: 'compass', ownName: 'Itinerary', ownIcon: 'compass', templateName: null, templateIcon: null });
    store.templateModuleNames = { travel: 'Journey', places: 'Stops' };
    store.templateModuleIcons = { places: 'map', calendar: 'not-in-the-list' };
    assert.equal(store.moduleDisplay('travel').name, 'Itinerary', 'the owner\'s, over the template\'s');
    assert.deepEqual(store.moduleDisplay('places'), { name: 'Stops', icon: 'map', ownName: null, ownIcon: null, templateName: 'Stops', templateIcon: 'map' }, 'else the template\'s');
    assert.equal(store.moduleDisplay('calendar').icon, 'not-in-the-list', 'a template\'s icon counts as drawable: server/templates.js takes only Font Awesome Free solid icons');
    assert.deepEqual(store.checkModuleDisplay('travel', { displayIcon: 'map' }), { icon: 'map' }, 'and the owner may pick a template\'s icon');
    // Any installed or built-in module's own icon is allowed too, though it is not in the environment's icon list.
    assert.throws(() => store.checkModuleDisplay('travel', { displayIcon: 'suitcase-rolling' }), /There is no icon called suitcase-rolling/);
    store.moduleIconIds = () => ['suitcase-rolling', 'video'];
    assert.deepEqual(store.checkModuleDisplay('travel', { displayIcon: 'suitcase-rolling' }), { icon: 'suitcase-rolling' });
    // Another module's own icon, chosen, then that module gone: kept as the owner's, not drawn, and accepted back as it is.
    store.applyModuleDisplay('places', { icon: 'suitcase-rolling' });
    store.moduleIconIds = () => ['video'];
    assert.deepEqual([store.moduleDisplay('places').icon, store.moduleDisplay('places').ownIcon], ['map', 'suitcase-rolling'], 'the next one down (the template\'s) is shown');
    assert.deepEqual(store.checkModuleDisplay('places', { displayName: 'Stops', displayIcon: 'suitcase-rolling' }), { name: 'Stops', icon: 'suitcase-rolling' }, 'saving only the name keeps it');
    assert.throws(() => store.checkModuleDisplay('travel', { displayIcon: 'suitcase-rolling' }), /There is no icon called suitcase-rolling/, 'but not for another module');
    store.moduleIconIds = () => ['suitcase-rolling', 'video'];
    assert.equal(store.moduleDisplay('places').icon, 'suitcase-rolling', 'and it draws again once that module is back');
    store.applyModuleDisplay('places', { icon: null });
    store.templateModuleIcons = { calendar: 'video' };
    assert.equal(store.moduleDisplay('calendar').icon, 'video', 'a template\'s module icon that is a module\'s own');
    assert.throws(() => store.checkModuleDisplay('travel', { displayIcon: 'unicorn-rocket' }), /There is no icon called unicorn-rocket/);
    store.applyModuleDisplay('travel', { name: null, icon: null });
    assert.equal(store.moduleDisplay('travel').name, 'Journey');
    assert.equal('moduleNames' in store.settings, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The Lobby is for being together (plan-modules, GitHub #63): surfaces.canvas.lobby, the one check, and the start-up
// sync that takes the Lobby out of a module's spaces when it isn't made for it, keeping its data.
test('the Lobby: surfaces.canvas.lobby is checked, the one check keeps other modules out, and the sync switches them off there only', () => {
  const canvas = (lobby) => ({ ...base(), scope: ['space'], surfaces: { canvas: { entry: 'canvas.html', ...(lobby === undefined ? {} : { lobby }) } } });
  assert.equal(cleanManifest(canvas(true), files).surfaces.canvas.lobby, true);
  assert.equal(cleanManifest(canvas(undefined), files).surfaces.canvas.lobby, false, 'absent: never in the Lobby');
  assert.throws(() => cleanManifest(canvas('yes'), files), (err) => err instanceof ModuleError && err.message === 'module.json: surfaces.canvas.lobby must be true or false');
  const bundledLobby = fs.readdirSync(path.join(ROOT, 'modules')).filter((id) => {
    const f = path.join(ROOT, 'modules', id, 'module.json');
    return fs.existsSync(f) && JSON.parse(fs.readFileSync(f, 'utf8')).surfaces?.canvas?.lobby === true;
  });
  assert.deepEqual(bundledLobby, ['calendar'], 'the Calendar declares it, and no other bundled module');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-modules-lobby-'));
  try {
    const put = (id, lobby) => {
      const d = path.join(dir, 'modules', id, 'versions', '1.0.0');
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'module.json'), JSON.stringify({ id, name: id, version: '1.0.0', scope: ['space'], surfaces: { canvas: { entry: 'canvas.html', ...(lobby ? { lobby: true } : {}) } } }));
    };
    put('tasks', false);
    put('every', false);
    put('dates', true);
    const entry = (id, allSpaces, spaces) => ({ id, versions: ['1.0.0'], version: '1.0.0', enabled: true, allSpaces, spaces, approved: { permissions: [], hooks: [], refs: [], events: [], actions: [] }, source: 'upload' });
    const file = path.join(dir, 'modules', 'registry.json');
    fs.writeFileSync(file, JSON.stringify({ modules: { tasks: entry('tasks', false, ['lobby', 's1']), every: entry('every', true, []), dates: entry('dates', true, []) }, autoInstalled: [] }));
    const lobbyData = path.join(dir, 'modules', 'tasks', 'data', 'space-lobby.json');
    fs.mkdirSync(path.dirname(lobbyData), { recursive: true });
    fs.writeFileSync(lobbyData, '{"task:a":{"value":1}}');
    const mm = new ModuleManager(dir);
    const on = (id) => ['lobby', 's1', 's2'].filter((sp) => mm.isOnIn(id, sp));
    assert.deepEqual(on('tasks'), ['s1'], 'on in s1, and never in the Lobby though its spaces still name it');
    assert.deepEqual(on('every'), ['s1', 's2'], '"every space" leaves the Lobby out');
    assert.deepEqual(on('dates'), ['lobby', 's1', 's2'], 'a module made for the Lobby is in it with every space');
    assert.equal(mm.view('tasks').lobby, false);
    assert.equal(mm.view('dates').lobby, true);
    assert.deepEqual(mm.lobbySync(), ['tasks']);
    const disk = JSON.parse(fs.readFileSync(file, 'utf8')).modules;
    assert.deepEqual([disk.tasks.spaces, disk.tasks.allSpaces, disk.every.allSpaces, disk.dates.allSpaces], [['s1'], false, true, true], 'the Lobby taken out, allSpaces never changed');
    assert.equal(fs.readFileSync(lobbyData, 'utf8'), '{"task:a":{"value":1}}', 'its Lobby data kept, untouched');
    assert.deepEqual(mm.lobbySync(), [], 'nothing more the second time');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('commands must name a local action that takes text, and cannot be ai', () => {
  const both = { page: { entry: 'page.html' }, canvas: { entry: 'canvas.html' } };
  const local = [{ name: 'addNote', label: 'Add a note', local: true, input: { text: 'string' } }];
  const ok = cleanManifest({ ...base(), scope: ['environment', 'space'], surfaces: both, actions: { provides: local }, commands: [{ name: 'r', label: 'Add a research note', action: 'addNote', hint: "the note's text" }] }, files);
  assert.deepEqual(ok.commands, [{ name: 'r', label: 'Add a research note', action: 'addNote', hint: "the note's text" }]);
  assert.deepEqual(cleanManifest({ ...base(), scope: ['environment', 'space'], surfaces: both }, files).commands, []);
  const refuse = (commands, actions, re) => {
    assert.throws(() => cleanManifest({ ...base(), scope: ['environment', 'space'], surfaces: both, actions: { provides: actions || local }, commands }, files), re);
  };
  refuse([{ name: 'Research', action: 'addNote' }], local, /1 to 12 lowercase letters or digits/);
  refuse([{ name: 'ai', action: 'addNote' }], local, /reserved/);
  refuse([{ name: 'r', action: 'missing' }], local, /not in actions.provides/);
  refuse([{ name: 'r', action: 'saveNote' }], [{ name: 'saveNote', input: { title: 'string' } }], /must be local/);
  refuse([{ name: 'r', action: 'addNote' }], [{ name: 'addNote', local: true, input: { title: 'string' } }], /must accept/);
});

console.log(`check-modules: ${n} groups OK`);
