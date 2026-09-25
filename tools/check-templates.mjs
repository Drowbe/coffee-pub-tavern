#!/usr/bin/env node
/*
 * check-templates.mjs -- the bundled environment templates (templates/<id>.json; documentation/plans/
 * plan-environment-templates.md, "check-templates"): each is valid by the server's own rules (server/templates.js), a
 * template that breaks one is refused with its sentence, and applying one to a throwaway environment gives the same
 * result twice, with a module the plan leaves out recorded as skipped.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const templates = require('../server/templates.js');
const { buildEnvironment } = require('../server/environment.js');
const { bundledModules } = require('../server/module-build.js');
const { LOBBY } = require('../server/store.js');

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`check-templates: ${name}: ${err.stack || err.message}`); }
};
const bundled = bundledModules(path.join(ROOT, 'modules')).map((m) => m.id);
const travelRaw = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'travel.json'), 'utf8'));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-templates-'));
const built = [];
const quiet = () => {};
const freshEnvironment = (name) => {
  const env = buildEnvironment(path.join(base, name), { log: quiet });
  built.push(env);
  return env;
};

try {
  await test('every bundled template is valid, and the server loads them all', () => {
    const loaded = templates.loadTemplates();
    const files = fs.readdirSync(path.join(ROOT, 'templates')).filter((f) => f.endsWith('.json'));
    assert.equal(loaded.size, files.length);
    for (const f of files) assert.deepEqual(templates.problemsOf(JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', f), 'utf8')), { file: f, bundled }), [], f);
    assert.deepEqual(templates.list().map((t) => t.id), [...loaded.keys()]);
  });

  await test('the travel template is the one decided (decisions 10 and 17)', () => {
    const t = templates.get('travel');
    assert.deepEqual(t.words, { space: { one: 'trip', many: 'trips' } });
    assert.deepEqual(t.modules, ['travel', 'places', 'maps', 'research', 'calendar', 'chat', 'conference']);
    assert.deepEqual([t.moduleNames.travel, t.icons.home, t.lobby.name, t.lobby.description, t.spaceDefaults.profile], ['Itinerary', 'suitcase-rolling', 'Home base', 'Everyone on every trip.', 'participants']);
  });

  await test('a template that breaks a rule is refused, each with its sentence', () => {
    const with_ = (patch) => ({ ...structuredClone(travelRaw), ...patch });
    const problems = (raw, file = 'travel.json') => templates.problemsOf(raw, { file, bundled });
    const cases = [
      [with_({ modules: ['travel', 'conference'] }), 'modules: "chat" must be listed; Chat can\'t be switched off yet.'],
      [with_({ modules: ['travel', 'chat', 'nope'] }), 'modules: "nope" is not a bundled or built-in module.'],
      [with_({ modules: ['chat', 'chat'] }), 'modules: "chat" is listed twice.'],
      [with_({ words: { host: { one: 'boss', many: 'bosses' } } }), 'words: "host" is the host\'s own word and a template can\'t change it.'],
      [with_({ words: { admin: { one: 'chief', many: 'chiefs' } } }), 'words: "admin" is the host\'s own word and a template can\'t change it.'],
      [with_({ words: { lobby: { one: 'a', many: 'b' } } }), 'words: there is no word called "lobby"; the words are environment, space, aside, canvas, module, object, owner, moderator, member, guest.'],
      [with_({ words: { space: { one: 'trip' } } }), 'words: The word for space needs both its singular and its plural.'],
      [with_({ icons: { home: 'discord' } }), 'icons.home: "discord" is not a Font Awesome Free solid icon.'],
      [with_({ icons: { home: 'no-such-icon-at-all' } }), 'icons.home: "no-such-icon-at-all" is not a Font Awesome Free solid icon.'],
      [with_({ moduleIcons: { travel: 'fa-route' } }), 'moduleIcons.travel: "fa-route" is not a Font Awesome Free solid icon.'],
      [with_({ moduleNames: { travel: '<b>Trips</b>' } }), 'moduleNames.travel: A display name is plain text, without < or >.'],
      [with_({ moduleNames: { nope: 'Nope' } }), 'moduleNames: "nope" is not a bundled or built-in module.'],
      [with_({ settings: { environmentName: 'x' } }), 'settings: "environmentName" is not a setting a template can give; those are language, clock, currency, loginText, allowRegistration, mfaRequired, maxQuality, allowScreenShare, allowAsides, allowPrivate, allowReactions, activeThemeId, themeMode.'],
      [with_({ settings: { clock: 24 } }), 'settings: 24 is not a value "clock" takes.'],
      [with_({ spaceDefaults: { profile: 'players' } }), 'spaceDefaults.profile must be one of roleplaying, participants, characters.'],
      [with_({ lobby: { name: 'x'.repeat(41) } }), 'lobby.name must be text of 1 to 40 characters.'],
      [with_({ plan: 'pro' }), '"plan" is not a template field; the fields are id, name, description, words, icons, moduleNames, moduleIcons, modules, settings, lobby, spaceDefaults.'],
    ];
    for (const [raw, sentence] of cases) assert.deepEqual(problems(raw), [sentence], sentence);
    assert.deepEqual(problems(travelRaw, 'trips.json'), ['"id" must match the file\'s name (trips.json).']);
    // A server with an invalid template in its folder does not start (loadTemplates throws, naming the file).
    const dir = path.join(base, 'bad-templates');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'travel.json'), JSON.stringify(with_({ modules: ['travel'] })));
    assert.throws(() => templates.loadTemplates({ dir }), /templates\/travel\.json: modules: "chat" must be listed/);
  });

  // The once-only part, twice: the same environment either way (only the time it was applied differs).
  const snapshot = (env) => {
    const app = JSON.parse(fs.readFileSync(path.join(env.store.dir, 'app.json'), 'utf8'));
    const registry = JSON.parse(fs.readFileSync(path.join(env.modules.dir, 'registry.json'), 'utf8'));
    const lobby = app.spaces.find((s) => s.id === LOBBY);
    return {
      settings: { conferenceEnabled: app.settings.conferenceEnabled, homeIcon: app.settings.homeIcon, spaceDefaults: app.settings.spaceDefaults, icons: app.settings.icons.map((i) => i.id) },
      lobby: [lobby.name, lobby.description],
      modules: Object.fromEntries(Object.entries(registry.modules).map(([id, e]) => [id, [e.version, e.enabled, e.allSpaces]])),
    };
  };
  const travel = templates.get('travel');
  await test('applying twice gives the same environment: settings, the Lobby, space defaults, icons, modules on in every space', async () => {
    const env = freshEnvironment('twice');
    env.modules.aiReady = () => true; // an AI service set up, so Research can be on
    const first = await templates.applyTemplate(env, travel);
    const once = snapshot(env);
    const second = await templates.applyTemplate(env, travel);
    assert.deepEqual(second, first);
    assert.deepEqual(snapshot(env), once);
    assert.deepEqual(first, []);
    assert.deepEqual(once.lobby, ['Home base', 'Everyone on every trip.']);
    assert.deepEqual([once.settings.conferenceEnabled, once.settings.homeIcon, once.settings.spaceDefaults], [true, null, { profile: 'participants' }]);
    assert.ok(once.settings.icons.includes('suitcase-rolling'), 'the home icon joins the icon list');
    for (const id of ['travel', 'places', 'maps', 'research', 'calendar']) assert.deepEqual(once.modules[id].slice(1), [true, true], id);
    assert.equal(env.modules.enabled('maps') !== null, true, 'Maps runs (Places, which it needs, came first)');
    assert.equal(env.store.addSpace({ name: 'Lisbon' }).profile, 'participants', 'a new trip starts with the Participants profile');
    assert.equal(env.store.addSpace({ name: 'Game night', profile: 'roleplaying' }).profile, 'roleplaying', 'unless told otherwise');
    const before = JSON.stringify(env.store.settings);
    assert.throws(() => env.store.updateSettings({ spaceDefaults: { profile: 'characters', evil: 1 }, clock: '24' }), (err) => err.status === 400 && err.message === 'spaceDefaults takes only profile.');
    assert.throws(() => env.store.updateSettings({ spaceDefaults: 'characters' }), /spaceDefaults takes only profile\./);
    assert.equal(JSON.stringify(env.store.settings), before, 'a refused change changes nothing');
    env.store.updateSettings({ spaceDefaults: null });
    assert.equal('spaceDefaults' in env.store.settings, false, 'null clears it');
    assert.equal('spaceDefaults' in JSON.parse(fs.readFileSync(path.join(env.store.dir, 'app.json'), 'utf8')).settings, false, 'on disk too');
    assert.equal(env.store.addSpace({ name: 'Later' }).profile, 'roleplaying');
  });

  await test('a module that installs but can\'t be on yet (Research, with no AI service) is in every space, off, and recorded with why', async () => {
    const env = freshEnvironment('no-ai');
    assert.deepEqual(await templates.applyTemplate(env, travel), [{ id: 'research', why: 'Research needs the AI service installed and turned on first' }]);
    const research = env.modules.view('research');
    assert.deepEqual([research.enabled, research.allSpaces], [false, true]);
  });

  await test('a module the plan leaves out is skipped and recorded; what needs a skipped one is skipped too', async () => {
    const noMaps = freshEnvironment('no-maps');
    noMaps.modules.aiReady = () => true;
    assert.deepEqual(await templates.applyTemplate(noMaps, travel, { allowed: (id) => id !== 'maps' }), [{ id: 'maps', why: 'not in the plan' }]);
    assert.equal(noMaps.modules.isInstalled('maps'), false);
    assert.equal(noMaps.modules.enabled('places') !== null, true);
    const noPlaces = freshEnvironment('no-places');
    noPlaces.modules.aiReady = () => true;
    const skipped = await templates.applyTemplate(noPlaces, travel, { allowed: (id) => id !== 'places', name: (id) => ({ places: 'Places' })[id] || id });
    assert.deepEqual(skipped, [{ id: 'places', why: 'not in the plan' }, { id: 'maps', why: 'needs Places, which was skipped' }]);
  });

  await test('a template that leaves the conference out switches it off', async () => {
    const env = freshEnvironment('no-conference');
    await templates.applyTemplate(env, { ...travel, modules: ['chat', 'polls'], lobby: {}, settings: { clock: '24', allowAsides: false } });
    assert.deepEqual([env.store.settings.conferenceEnabled, env.store.settings.clock, env.store.settings.allowAsides], [false, '24', false]);
    assert.equal(env.modules.enabled('polls') !== null, true);
  });

  await test('the live part: words, the home icon and module names and icons, the owner\'s over the template\'s', () => {
    const env = freshEnvironment('live');
    env.store.updateSettings({ homeIcon: null }); // as applying the template leaves it: unset, the template's
    templates.useLive(env.store, travel);
    assert.deepEqual(env.store.resolvedWords().space, { one: 'trip', many: 'trips', a: 'a trip' });
    assert.equal(env.store.homeIcon, 'suitcase-rolling');
    assert.equal(env.store.moduleDisplay('travel').name, 'Itinerary');
    env.store.updateSettings({ words: { space: { one: 'journey', many: 'journeys' } }, homeIcon: 'couch' });
    assert.deepEqual([env.store.resolvedWords().space.one, env.store.homeIcon], ['journey', 'couch']);
    env.store.updateSettings({ words: { space: null }, homeIcon: null });
    assert.deepEqual([env.store.resolvedWords().space.one, env.store.homeIcon], ['trip', 'suitcase-rolling'], 'null goes back to the template\'s');
    // What the template gives stays readable under the owner's own (for Manage's "the template's" hints).
    env.store.updateSettings({ words: { space: { one: 'journey', many: 'journeys' } } });
    env.store.applyModuleDisplay('travel', { name: 'Plans', icon: 'compass' });
    assert.deepEqual([env.store.templateWordsView(), env.store.templateHomeIcon], [{ space: { one: 'trip', many: 'trips' } }, 'suitcase-rolling']);
    const d = env.store.moduleDisplay('travel');
    assert.deepEqual([d.name, d.templateName, d.templateIcon], ['Plans', 'Itinerary', null]);
    assert.equal(env.modules.view('travel'), null, 'not installed here');
    env.store.updateSettings({ words: { space: null } });
    env.store.applyModuleDisplay('travel', { name: null, icon: null });
    templates.useLive(env.store, null);
    assert.deepEqual([env.store.templateWordsView(), env.store.moduleDisplay('travel').templateName], [null, null]);
    assert.deepEqual([env.store.resolvedWords().space.one, env.store.homeIcon, env.store.moduleDisplay('travel').name], ['space', 'couch', null], 'no template: the defaults');
  });
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}
if (failed) {
  console.error(`check-templates: ${failed} group${failed === 1 ? '' : 's'} failed`);
  process.exit(1);
}
console.log(`check-templates: OK (${n} groups, ${templates.list().length} template${templates.list().length === 1 ? '' : 's'})`);
process.exit(0);
