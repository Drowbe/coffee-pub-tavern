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
      [with_({ plan: 'pro' }), '"plan" is not a template field; the fields are id, name, description, version, words, icons, moduleNames, moduleIcons, modules, settings, lobby, spaceDefaults, reactions, theme, iconSet.'],
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

  await test('made from a template, its modules are in every space but the Lobby; the Calendar, made for it, is there too', async () => {
    const env = freshEnvironment('lobby-rule');
    env.modules.aiReady = () => true;
    await templates.applyTemplate(env, travel);
    for (const id of ['travel', 'places', 'maps', 'research']) assert.equal(env.modules.isOnIn(id, LOBBY), false, `${id} not in the Lobby`);
    const trip = env.store.addSpace({ name: 'Lisbon' });
    for (const id of ['travel', 'places', 'maps', 'research', 'calendar']) assert.equal(env.modules.isOnIn(id, trip.id), true, `${id} in a new trip`);
    assert.equal(env.modules.isOnIn('calendar', LOBBY), true, 'the Calendar is allowed in the Lobby, and on');
    const registry = JSON.parse(fs.readFileSync(path.join(env.modules.dir, 'registry.json'), 'utf8')).modules;
    assert.ok(Object.values(registry).every((e) => !(e.spaces || []).includes(LOBBY)), 'nothing adds the Lobby to a module\'s spaces');
  });

  // A switch (the switching addendum): the offer, then only what is confirmed, never turning anything off.
  const switchSnapshot = (env) => ({ ...snapshot(env), words: env.store.settings.words || null });
  await test('a switch offers what the template would add, and applying the confirmed part twice gives the same environment', async () => {
    const env = freshEnvironment('switch');
    env.modules.aiReady = () => true;
    const icons = env.store.iconIds();
    env.store.updateSettings({ homeIcon: icons[icons.length - 1], conferenceEnabled: false, words: { member: { one: 'player', many: 'players' } } });
    const owned = { homeIcon: env.store.settings.homeIcon, words: env.store.settings.words };
    const opts = { allowed: (id) => id !== 'research', name: (id) => `name of ${id}` };
    const offer = templates.offerFor(env, travel, opts);
    assert.deepEqual(offer.modules.map((m) => [m.id, m.allowed, m.why || null]), [['travel', true, null], ['places', true, null], ['maps', true, null], ['research', false, 'not in the plan'], ['calendar', true, null], ['conference', true, null]]);
    assert.equal(offer.modules[0].name, 'name of travel');
    assert.deepEqual(offer.lobby, { name: 'Home base', description: 'Everyone on every trip.' });
    assert.deepEqual(offer.spaceDefaults, { profile: 'participants' });
    // Only Maps, the conference and the new-space profile ticked (and Research, which the plan refuses, asked for too).
    const confirm = { modules: ['maps', 'conference', 'research', 'not-offered'], lobby: false, spaceDefaults: true };
    const first = await templates.applyOffer(env, travel, confirm, opts);
    const once = switchSnapshot(env);
    assert.deepEqual(first, [{ id: 'research', why: 'not in the plan' }]);
    assert.deepEqual([once.modules.maps.slice(1), once.modules.places.slice(1)], [[true, true], [true, true]], 'Maps, with Places which it needs');
    assert.equal(once.modules.travel, undefined, 'the Planner, not ticked, is not installed');
    assert.deepEqual([once.settings.conferenceEnabled, once.settings.spaceDefaults, once.lobby[0]], [true, { profile: 'participants' }, 'Lobby'], 'the conference on, the profile taken, the Lobby left as it was');
    assert.deepEqual([env.store.settings.homeIcon, env.store.settings.words], [owned.homeIcon, owned.words], 'the owner\'s home icon and words untouched');
    assert.equal(env.modules.isOnIn('maps', LOBBY), false, 'not in the Lobby');
    const second = await templates.applyOffer(env, travel, confirm, opts);
    assert.deepEqual(second, first);
    assert.deepEqual(switchSnapshot(env), once, 'twice: the same');
    // What is left to offer: only what is still missing.
    assert.deepEqual(templates.offerFor(env, travel, opts).modules.map((m) => m.id), ['travel', 'research', 'calendar']);
    assert.equal(templates.offerFor(env, travel, opts).spaceDefaults, null);
  });

  await test('a switch never turns the conference or a module off, and nothing ticked changes nothing', async () => {
    const env = freshEnvironment('never-off');
    env.modules.aiReady = () => true; // Research on too (without an AI service it stays off, and a switch offers it)
    await templates.applyTemplate(env, travel);
    const before = snapshot(env);
    const noConference = { ...travel, modules: travel.modules.filter((m) => m !== 'conference' && m !== 'maps') };
    assert.deepEqual(templates.offerFor(env, noConference).modules, [], 'everything it lists is on already');
    assert.deepEqual(await templates.applyOffer(env, noConference, {}), []);
    assert.deepEqual(snapshot(env), before, 'the conference still on, Maps still on');
  });

  await test('the home icon is stored only as the owner\'s choice, so a template\'s shows after a switch; an old stored default is not a choice', async () => {
    const { Store } = require('../server/store.js');
    const fresh = freshEnvironment('home-icon');
    const appFile = path.join(fresh.store.dir, 'app.json');
    assert.equal(JSON.parse(fs.readFileSync(appFile, 'utf8')).settings.homeIcon, null, 'a new environment stores no home icon');
    assert.equal(fresh.store.homeIcon, 'couch', 'and shows the default');
    templates.useLive(fresh.store, travel);
    assert.equal(fresh.store.homeIcon, 'suitcase-rolling', 'a template switched to shows its own');
    fresh.store.updateSettings({ homeIcon: 'couch' });
    assert.equal(fresh.store.homeIcon, 'couch', 'an owner who picks the default keeps it, under a template too');
    assert.equal(new Store(fresh.store.dir).settings.homeIcon, 'couch', 'and after a restart');
    // Data from before: the default stored as if chosen, with no mark that it was looked at.
    const old = JSON.parse(fs.readFileSync(appFile, 'utf8'));
    delete old.settings.homeIconChoiceSeeded;
    fs.writeFileSync(appFile, JSON.stringify(old));
    const reloaded = new Store(fresh.store.dir);
    assert.deepEqual([reloaded.settings.homeIcon, reloaded.settings.homeIconChoiceSeeded], [null, true], 'an old stored default is read as not chosen, once');
    reloaded.templateHomeIcon = 'suitcase-rolling';
    assert.equal(reloaded.homeIcon, 'suitcase-rolling');
    // An old owner's real choice (anything but the default) is kept.
    const chose = JSON.parse(fs.readFileSync(appFile, 'utf8'));
    delete chose.settings.homeIconChoiceSeeded;
    chose.settings.homeIcon = 'suitcase-rolling';
    fs.writeFileSync(appFile, JSON.stringify(chose));
    assert.equal(new Store(fresh.store.dir).settings.homeIcon, 'suitcase-rolling');
  });

  // --- addendum 2: templates grow (#68) -----------------------------------------------------------------------------
  const templateFile = require('../server/template-file.js');
  const set = (over = {}) => ({ bg: '#ffffff', bgSection: '#f5f7f8', border: '#dde3e6', text: '#222222', textDim: '#6b7479', accent: '#1c7c8c', onAccent: '#ffffff', ...over });
  const harbour = { name: 'Harbour', author: 'Thomas', light: set(), dark: null };
  const grown = (over = {}) => ({ ...structuredClone(travelRaw), id: 'harbour', name: 'Harbour', version: 1, reactions: [{ id: 'wave', glyph: '👋', label: 'Wave' }], theme: harbour, ...over });

  await test('the new fields are checked: version, reactions and an embedded theme (checked as a theme import is)', () => {
    const problems = (raw) => templates.problemsOf(raw, { bundled });
    assert.deepEqual(problems(grown()), []);
    assert.deepEqual(problems(grown({ version: 0 })), ['"version" must be a whole number, 1 or more.']);
    assert.deepEqual(problems(grown({ reactions: [{ label: 'x' }] })), ['reactions[0]: each reaction needs a glyph of 1 to 8 characters.']);
    assert.deepEqual(problems(grown({ reactions: [{ glyph: '👋', size: 3 }] })), ['reactions[0]: a reaction takes only id, glyph and label.']);
    assert.deepEqual(problems(grown({ theme: { ...harbour, light: set({ bg: 'red; background: url(x)' }) } })), ['theme: This theme has no complete light or dark set: each needs all seven base colors.']);
    assert.deepEqual(problems(grown({ theme: { ...harbour, glow: 1 } })), ['theme: "glow" is not part of a theme.']);
    const clean = templates.cleanTemplate(grown());
    assert.deepEqual([clean.version, clean.reactions[0].id, clean.theme.name, clean.theme.author, clean.theme.light.bg], [1, 'wave', 'Harbour', 'Thomas', '#ffffff']);
    assert.equal(templates.cleanTemplate(travelRaw).version, 1, 'a bundled file without a version is version 1');
  });

  await test('applied once: reactions become the environment\'s, the theme is added and made active; twice gives the same', async () => {
    const env = freshEnvironment('grown');
    env.modules.aiReady = () => true;
    const t = templates.cleanTemplate(grown());
    await templates.applyTemplate(env, t);
    const once = { reactions: env.store.settings.reactions, active: env.store.settings.activeThemeId, themes: env.store.themes.length };
    assert.deepEqual(once.reactions.map((r) => r.id), ['wave']);
    assert.equal(env.store.themes.find((x) => x.id === once.active).name, 'Harbour');
    await templates.applyTemplate(env, t);
    assert.deepEqual({ reactions: env.store.settings.reactions, active: env.store.settings.activeThemeId, themes: env.store.themes.length }, once, 'the theme is not added twice');
  });

  await test('a newer version offers only what is new, the rest unticked; confirming applies only what is ticked', async () => {
    const env = freshEnvironment('update');
    env.modules.aiReady = () => true;
    const v1 = templates.cleanTemplate(grown({ modules: ['travel', 'places', 'chat', 'conference'] }));
    await templates.applyTemplate(env, v1);
    assert.deepEqual(templates.offerFor(env, v1).modules, [], 'nothing new in the same version');
    const v2 = templates.cleanTemplate(grown({ version: 2, modules: ['travel', 'places', 'calendar', 'chat', 'conference'], reactions: [{ id: 'cheer', glyph: '🎉', label: 'Cheer' }] }));
    const offer = templates.offerFor(env, v2);
    assert.deepEqual([offer.modules.map((m) => m.id), offer.reactions.map((r) => r.id), offer.theme], [['calendar'], ['cheer'], null], 'the new module and reactions; the theme already in use is not offered');
    await templates.applyOffer(env, v2, { modules: ['calendar'], reactions: false });
    assert.deepEqual([env.modules.view('calendar').enabled, env.store.settings.reactions.map((r) => r.id)], [true, ['wave']], 'the module on; the reactions, not ticked, kept');
  });

  await test('template files: a round trip gives the same template; newer, too big and not a file are refused; unknown keys dropped and listed', () => {
    const t = templates.cleanTemplate(grown());
    const file = templateFile.templateToFile(t);
    assert.equal(file.magpieTemplate, 1);
    assert.equal('magpieTheme' in file.theme, false);
    const back = templateFile.readTemplateFile(JSON.stringify(file), { bundled });
    assert.deepEqual(back.dropped, []);
    assert.deepEqual(templates.cleanTemplate(back.raw), t);
    assert.equal(templateFile.templateFileName('Harbour Trips'), 'harbour-trips.magpie-template.json');
    const refused = (input, sentence) => assert.throws(() => templateFile.readTemplateFile(input, { bundled }), (err) => err instanceof templateFile.TemplateFileError && err.message === sentence);
    refused({ ...file, magpieTemplate: 2 }, templateFile.NEWER);
    refused({ ...file, magpieTemplate: undefined }, templateFile.NOT_A_TEMPLATE_FILE);
    refused('not json', templateFile.NOT_A_TEMPLATE_FILE);
    refused(JSON.stringify({ ...file, description: 'x'.repeat(70 * 1024) }), templateFile.NOT_A_TEMPLATE_FILE);
    refused({ ...file, modules: ['travel'] }, 'modules: "chat" must be listed; Chat can\'t be switched off yet.');
    const extra = templateFile.readTemplateFile({ ...file, plan: 'pro', theme: { ...file.theme, glow: 1, light: { ...file.theme.light, shine: '#000000' } } }, { bundled });
    assert.deepEqual(extra.dropped, ['plan', 'theme.glow', 'theme.light.shine']);
  });

  // A bundled template's version is raised by hand when its applied-once part changes (PM's decision 6, addendum 2):
  // tools/template-versions.json keeps each one's fingerprint beside its version. `--update` records the current ones
  // (after raising the version).
  await test('a bundled template whose applied-once part changed has a new version', () => {
    const file = path.join(ROOT, 'tools', 'template-versions.json');
    const now = Object.fromEntries([...templates.all().values()].map((t) => [t.id, { version: t.version, fingerprint: templates.appliedOnceFingerprint(t) }]));
    if (process.argv.includes('--update') || !fs.existsSync(file)) fs.writeFileSync(file, `${JSON.stringify(now, null, 2)}\n`);
    const recorded = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [id, cur] of Object.entries(now)) {
      const was = recorded[id];
      if (!was) throw new Error(`templates/${id}.json is not in tools/template-versions.json; run node tools/check-templates.mjs --update`);
      if (was.fingerprint !== cur.fingerprint && cur.version <= was.version) throw new Error(`templates/${id}.json changed what it applies once (its modules, settings, Lobby, space defaults, reactions, icon set or theme) but kept version ${cur.version}; raise "version", then run node tools/check-templates.mjs --update`);
      if (was.fingerprint !== cur.fingerprint || was.version !== cur.version) throw new Error(`templates/${id}.json has a new version; record it with node tools/check-templates.mjs --update`);
    }
  });

  await test('iconSet: checked, added to the icon list once at creation, and offered on a new version only if it changed', async () => {
    const problems = (raw) => templates.problemsOf(raw, { bundled });
    assert.deepEqual(problems(grown({ iconSet: ['anchor', 'no-such-icon-at-all'] })), ['iconSet: "no-such-icon-at-all" is not a Font Awesome Free solid icon.']);
    assert.deepEqual(problems(grown({ iconSet: ['anchor', 'anchor'] })), ['iconSet: "anchor" is listed twice.']);
    const env = freshEnvironment('icon-set');
    const v1 = templates.cleanTemplate(grown({ iconSet: ['anchor', 'ship'] }));
    await templates.applyTemplate(env, v1);
    assert.ok(['anchor', 'ship'].every((id) => env.store.iconIds().includes(id)), 'added at creation');
    const applied = templates.partFingerprints(v1);
    // The owner changes their reactions and removes an icon: a new version that changed neither offers neither.
    env.store.updateSettings({ reactions: [{ id: 'mine', glyph: '⭐', label: 'Mine' }], icons: env.store.settings.icons.filter((i) => i.id !== 'ship') });
    const v2 = templates.cleanTemplate(grown({ version: 2, iconSet: ['anchor', 'ship'] }));
    const quiet = templates.offerFor(env, v2, { applied });
    assert.deepEqual([quiet.reactions, quiet.iconSet, quiet.theme, quiet.modules], [null, null, null, []], 'nothing the template didn\'t change');
    assert.notEqual(templates.offerFor(env, v2, {}).reactions, null, 'without fingerprints: by the environment as it is (a record from before)');
    const v3 = templates.cleanTemplate(grown({ version: 3, iconSet: ['anchor', 'ship', 'compass'] }));
    const offer = templates.offerFor(env, v3, { applied });
    assert.deepEqual([offer.iconSet, offer.reactions], [['ship', 'compass'].filter((id) => !env.store.iconIds().includes(id)), null], 'the changed icon set, only what is missing; reactions unchanged, not offered');
    await templates.applyOffer(env, v3, { iconSet: true }, { applied });
    assert.ok(env.store.iconIds().includes('compass'));
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
