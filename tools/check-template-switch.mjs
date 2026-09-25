#!/usr/bin/env node
/*
 * check-template-switch.mjs -- switching a template (plan-environment-templates.md, "Addendum: switching a template",
 * GitHub #59) and the Lobby kept for being together (plan-modules.md, "Addendum: the Lobby is for being together",
 * GitHub #63), against real servers on throwaway DATA_DIRs:
 *   - a single install: the start-up sync (To-do switched off in the Lobby only, its data kept, logged), "every space"
 *     leaving the Lobby out, the Calendar allowed there, the refusals with the module's display name and the Lobby's
 *     own name; an owner switching to travel (the words at once, the owner's own word and home icon kept, the offer),
 *     confirming part of the offer, 409s, switching to none, the history, and a switched template never applied on a
 *     restart;
 *   - a hosted server: the host switching an environment made with no template, the plan's refusal in the offer and
 *     recorded as skipped when confirmed, the console's list showing it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    n += 1;
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}\n${err.stack || err}`);
  }
};
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

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
  const waitFor = async (text) => {
    for (let i = 0; i < 200 && !out.includes(text); i += 1) await new Promise((r) => setTimeout(r, 50));
    assert.ok(out.includes(text), `${text}\n${out}`);
  };
  return { port, output: () => out, waitFor, stop: () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); }) };
}

// One request, as `host` (a subdomain of localhost, or '' for 127.0.0.1 on a single install).
function call(server, host, method, urlPath, { body, cookie } = {}) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const headers = { host: host ? `${host}.localhost:${server.port}` : `127.0.0.1:${server.port}`, accept: 'application/json' };
  if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = payload.length; }
  if (cookie) headers.cookie = cookie;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.port, method, path: urlPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, json, text, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const cookieOf = (res) => [].concat(res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-template-switch-'));
let server = null;
try {
  // --- a single install ------------------------------------------------------------------------------------------
  const single = path.join(base, 'single');
  const env = { ADMIN_PASSWORD: 'admin-password-1' };
  server = await startServer(single, env);
  let cookie = cookieOf(await call(server, '', 'POST', '/api/login', { body: { login: 'admin', password: 'admin-password-1' } }));
  let as = (method, url, body) => call(server, '', method, url, { cookie, body });
  const side = (await as('POST', '/api/spaces', { name: 'Side' })).json.space.id;
  for (const id of ['todo', 'polls', 'calendar']) assert.equal((await as('POST', `/api/modules/bundled/${id}/install`)).status, 201, id);
  assert.equal((await as('PATCH', '/api/modules/todo', { enabled: true, spaces: [side] })).status, 200);
  assert.equal((await as('PATCH', '/api/modules/polls', { enabled: true, allSpaces: true })).status, 200);
  assert.equal((await as('PATCH', '/api/modules/calendar', { enabled: true, allSpaces: true })).status, 200);
  await server.stop();
  // To-do on in the Lobby as an older build allowed, with data there.
  const registryFile = path.join(single, 'modules', 'registry.json');
  const registry = readJson(registryFile);
  registry.modules.todo.spaces = ['lobby', side];
  fs.writeFileSync(registryFile, JSON.stringify(registry));
  const lobbyData = path.join(single, 'modules', 'todo', 'data', 'space-lobby.json');
  fs.mkdirSync(path.dirname(lobbyData), { recursive: true });
  fs.writeFileSync(lobbyData, JSON.stringify({ 'task:a': { value: { title: 'kept' }, version: 1, updatedAt: '2026-09-01T00:00:00.000Z', by: 'x' } }));
  server = await startServer(single, env);
  cookie = cookieOf(await call(server, '', 'POST', '/api/login', { body: { login: 'admin', password: 'admin-password-1' } }));
  as = (method, url, body) => call(server, '', method, url, { cookie, body });
  const lobbySentence = (name) => `${name} can't be turned on in Lobby, which is kept for chat, the call and a few modules made for it.`;

  await test('on start, To-do is switched off in the Lobby only, logged, its data kept', async () => {
    await server.waitFor('To-do is no longer on in Lobby; it stays on in its other spaces.');
    assert.deepEqual(readJson(registryFile).modules.todo.spaces, [side]);
    assert.ok(fs.existsSync(lobbyData), 'its Lobby data is kept');
  });

  await test('the Lobby lists only the modules made for it; every other space lists them all', async () => {
    const ids = async (space) => (await as('GET', `/api/modules/for-space?space=${space}`)).json.modules.map((m) => m.id).sort();
    assert.deepEqual(await ids('lobby'), ['calendar'], 'Polls in every space leaves the Lobby out; the Calendar is allowed');
    assert.deepEqual(await ids(side), ['calendar', 'polls', 'todo']);
    assert.deepEqual((await as('GET', '/api/modules/for-space?space=lobby')).json.builtin.map((b) => b.id), ['conference', 'chat'], 'chat and the conference are the built-ins, as before');
    assert.equal((await as('GET', '/api/modules')).json.modules.find((m) => m.id === 'polls').lobby, false);
    assert.equal((await as('GET', '/api/modules')).json.modules.find((m) => m.id === 'calendar').lobby, true);
  });

  await test('a module not made for the Lobby is refused there with its display name and the Lobby\'s own name', async () => {
    assert.deepEqual(await as('PATCH', '/api/modules/todo', { spaces: ['lobby', side] }).then((r) => [r.status, r.json]), [400, { error: lobbySentence('To-do') }]);
    assert.deepEqual(readJson(registryFile).modules.todo.spaces, [side], 'nothing changed');
    assert.equal((await as('PATCH', '/api/modules/polls', { displayName: 'Votes' })).status, 200);
    assert.deepEqual(await as('PATCH', '/api/modules/polls', { spaces: ['lobby'] }).then((r) => [r.status, r.json]), [400, { error: lobbySentence('Votes') }], 'its display name');
    assert.deepEqual(await as('GET', '/api/modules/todo/data?scope=space&space=lobby').then((r) => [r.status, r.json]), [404, { error: lobbySentence('To-do') }], 'its data there is shown nowhere');
    const page = await as('GET', '/modules/todo?space=lobby');
    assert.deepEqual([page.status, page.text], [404, lobbySentence('To-do')]);
    assert.equal((await as('PATCH', '/api/modules/calendar', { spaces: ['lobby'] })).status, 200, 'the Calendar may be');
    assert.equal((await as('GET', `/api/modules/todo/data?scope=space&space=${side}`)).status, 200, 'another space is as before');
  });

  const words = async () => (await call(server, '', 'GET', '/api/branding')).json;
  await test('an owner switches to travel: the words at once, the owner\'s own word and home icon kept, and the offer', async () => {
    const icon = (await as('GET', '/api/settings')).json.settings.icons.at(-1).id;
    assert.equal((await as('PATCH', '/api/settings', { words: { member: { one: 'player', many: 'players' } }, homeIcon: icon })).status, 200);
    assert.deepEqual(await as('PATCH', '/api/settings', { template: 'nope' }).then((r) => [r.status, r.json]), [400, { error: 'There is no template called nope.' }]);
    assert.deepEqual(await as('PATCH', '/api/settings', { template: 5 }).then((r) => [r.status, r.json]), [400, { error: 'A template is named by its id, or "none" for no template.' }]);
    const r = await as('PATCH', '/api/settings', { template: 'travel' });
    assert.equal(r.status, 200, r.text);
    assert.ok(r.json.settings, 'the settings, as before');
    assert.deepEqual([r.json.template.id, r.json.template.name, r.json.template.offerOpen, r.json.template.appliedAt], ['travel', 'Travel', true, null]);
    assert.deepEqual(r.json.offer.modules.map((m) => [m.id, m.allowed]), [['travel', true], ['places', true], ['maps', true], ['research', true]], 'the Calendar is on in every space already; the conference is on');
    assert.deepEqual(r.json.offer.lobby, { name: 'Home base', description: 'Everyone on every trip.' });
    assert.deepEqual(r.json.offer.spaceDefaults, { profile: 'participants' });
    const b = await words();
    assert.deepEqual([b.words.space.one, b.words.member.one, b.homeIcon], ['trip', 'player', icon], 'the template\'s words at once; the owner\'s own still win');
    assert.equal((await as('GET', '/api/modules')).json.modules.some((m) => m.id === 'travel'), false, 'nothing turned on before it is confirmed');
    const again = await as('PATCH', '/api/settings', { template: 'travel' });
    assert.deepEqual([again.status, again.json.template.offerOpen], [200, true], 'the same template: nothing changes');
    const view = (await as('GET', '/api/environment/template')).json;
    assert.deepEqual([view.template.id, view.template.source, view.offer.modules.length, view.choices.map((c) => c.id)], ['travel', 'bundled', 4, ['travel']]);
  });

  await test('confirming part of the offer turns on only that, in every space but the Lobby; then 409', async () => {
    assert.deepEqual(await as('POST', '/api/environment/template/apply', { modules: 'travel' }).then((r) => [r.status, r.json]), [400, { error: 'Name the modules to turn on as a list of their ids.' }]);
    const r = await as('POST', '/api/environment/template/apply', { modules: ['travel', 'maps'], lobby: false, spaceDefaults: true });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.json.template.offerOpen, typeof r.json.template.appliedAt, r.json.offer, r.json.template.skipped], [false, 'string', null, []]);
    const mods = Object.fromEntries((await as('GET', '/api/modules')).json.modules.map((m) => [m.id, m]));
    for (const id of ['travel', 'places', 'maps']) assert.deepEqual([id, mods[id].enabled, mods[id].allSpaces], [id, true, true]);
    assert.equal(mods.research, undefined, 'Research, not ticked, not installed');
    const lobby = (await as('GET', '/api/modules/for-space?space=lobby')).json.modules.map((m) => m.id);
    assert.deepEqual(lobby.sort(), ['calendar'], 'the Lobby keeps its own');
    assert.ok((await as('GET', `/api/modules/for-space?space=${side}`)).json.modules.some((m) => m.id === 'travel'));
    assert.equal((await as('GET', '/api/spaces')).json.spaces.find((s) => s.id === 'lobby').name, 'Lobby', 'the Lobby\'s name, not ticked, kept');
    assert.equal((await as('POST', '/api/spaces', { name: 'Lisbon' })).json.space.profile, 'participants', 'the new-space profile, ticked, taken');
    assert.deepEqual(await as('POST', '/api/environment/template/apply', {}).then((r2) => [r2.status, r2.json]), [409, { error: 'This template has already been applied.' }]);
  });

  await test('switching to none: the words go back, the modules stay on, the owner\'s own kept; then 409; the history', async () => {
    const r = await as('PATCH', '/api/settings', { template: 'none' });
    assert.deepEqual([r.status, r.json.template, r.json.offer], [200, null, null]);
    const b = await words();
    assert.deepEqual([b.words.space.one, b.words.member.one], ['space', 'player']);
    assert.equal((await as('GET', '/api/modules')).json.modules.find((m) => m.id === 'travel').enabled, true, 'still on');
    assert.deepEqual(await as('POST', '/api/environment/template/apply', {}).then((r2) => [r2.status, r2.json]), [409, { error: 'This environment has no template to apply.' }]);
    const app = readJson(path.join(single, 'app.json'));
    assert.deepEqual(app.templateHistory.map((h) => [h.from, h.to]), [[null, 'travel'], ['travel', null]]);
    assert.ok(app.templateHistory.every((h) => typeof h.by === 'string' && h.by !== 'host' && h.at));
  });

  await test('a switched template is never applied on its own at a restart; switching back offers only what is missing', async () => {
    assert.equal((await as('PATCH', '/api/settings', { template: 'travel' })).status, 200);
    await server.stop();
    server = await startServer(single, env);
    cookie = cookieOf(await call(server, '', 'POST', '/api/login', { body: { login: 'admin', password: 'admin-password-1' } }));
    as = (method, url, body) => call(server, '', method, url, { cookie, body });
    const view = (await as('GET', '/api/environment/template')).json;
    assert.deepEqual([view.template.offerOpen, view.template.appliedAt], [true, null]);
    assert.deepEqual(view.offer.modules.map((m) => m.id), ['research'], 'only what is missing');
    assert.ok(!server.output().includes('Applied the "travel" template'), server.output());
    assert.equal((await as('GET', '/api/spaces')).json.spaces.find((s) => s.id === 'lobby').name, 'Lobby');
  });
  await test('a single install imports, exports and deletes its own templates; one in use can\'t be deleted', async () => {
    const travel = await as('GET', '/api/templates/travel/export');
    assert.deepEqual([travel.status, travel.headers['content-disposition']], [200, 'attachment; filename="travel.magpie-template.json"'], 'a bundled one exports');
    assert.deepEqual(await as('POST', '/api/templates/import', travel.json).then((r) => [r.status, r.json]), [409, { error: 'There is already a template called travel.' }]);
    const mine = await as('POST', '/api/templates/import?id=my-trips', { ...travel.json, name: 'My trips' });
    assert.deepEqual([mine.status, mine.json.template.source, mine.json.template.name], [201, 'imported', 'My trips'], mine.text);
    assert.deepEqual((await as('GET', '/api/environment/template')).json.choices.map((c) => [c.id, c.source]), [['my-trips', 'imported'], ['travel', 'bundled']]);
    assert.equal((await as('PATCH', '/api/settings', { template: 'my-trips' })).status, 200);
    assert.deepEqual(await as('DELETE', '/api/templates/my-trips').then((r) => [r.status, r.json]), [409, { error: 'This environment uses this template. Switch to another one first.' }]);
    assert.equal((await as('PATCH', '/api/settings', { template: 'travel' })).status, 200);
    assert.equal((await as('DELETE', '/api/templates/my-trips')).status, 200);
    assert.deepEqual(await as('DELETE', '/api/templates/travel').then((r) => [r.status, r.json]), [403, { error: "Bundled templates can't be deleted." }]);
    assert.deepEqual(await as('POST', '/api/templates/import', '{ not json').then((r) => [r.status, r.json]), [400, { error: "That isn't a Magpie template file." }]);
  });
  await server.stop();
  server = null;

  // --- a hosted server --------------------------------------------------------------------------------------------
  const hosted = path.join(base, 'hosted');
  server = await startServer(hosted, { BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'boss', ADMIN_PASSWORD: 'host-password-1' });
  const host = cookieOf(await call(server, 'admin', 'POST', '/api/host/login', { body: { login: 'boss', password: 'host-password-1' } }));
  const console_ = (method, url, body) => call(server, 'admin', method, url, { cookie: host, body });

  await test('hosted: the host switches an environment made with no template; the plan\'s refusal is in the offer and recorded', async () => {
    const made = await console_('POST', '/api/host/environments', { slug: 'beta', name: 'Beta', plan: { modules: ['travel', 'places', 'research', 'calendar', 'stream'] }, owner: { login: 'owner', password: 'owner-password-1' } });
    assert.equal(made.status, 201, made.text);
    assert.deepEqual(await console_('PATCH', '/api/host/environments/beta', { template: 'nope' }).then((r) => [r.status, r.json]), [400, { error: 'There is no template called nope.' }]);
    assert.deepEqual(await console_('PATCH', '/api/host/environments/nope', { template: 'travel' }).then((r) => [r.status, r.json]), [404, { error: 'no such environment' }]);
    const r = await console_('PATCH', '/api/host/environments/beta', { template: 'travel' });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.json.environment.slug, r.json.environment.template.offerOpen], ['beta', true]);
    assert.deepEqual(r.json.environment.offer.modules.find((m) => m.id === 'maps'), { id: 'maps', name: 'Maps', allowed: false, why: 'not in the plan' });
    const review = await console_('GET', '/api/host/environments/beta/template');
    assert.equal(review.status, 200, review.text);
    assert.deepEqual([review.json.template.id, review.json.template.offerOpen, review.json.offer.modules.length, review.json.choices.map((c) => c.id)], ['travel', true, r.json.environment.offer.modules.length, ['travel']], 'the console reads the offer without switching again');
    assert.deepEqual(await console_('GET', '/api/host/environments/nope/template').then((x) => [x.status, x.json]), [404, { error: 'no such environment' }]);
    assert.equal(readJson(path.join(hosted, 'environments', 'beta', 'app.json')).templateHistory.length, 1, 'reading it switched nothing');
    const shownIcon = (await call(server, 'beta', 'GET', '/api/branding')).json.homeIcon;
    assert.equal(shownIcon, 'suitcase-rolling', 'an environment made with no template shows the template\'s home icon after a switch');
    const listed = (await console_('GET', '/api/host/environments')).json.environments.find((e) => e.slug === 'beta');
    assert.deepEqual([listed.template.id, listed.template.offerOpen], ['travel', true]);
    const ids = r.json.environment.offer.modules.map((m) => m.id);
    const applied = await console_('POST', '/api/host/environments/beta/template/apply', { modules: ids, lobby: true, spaceDefaults: true });
    assert.equal(applied.status, 200, applied.text);
    assert.deepEqual(applied.json.environment.template.skipped.map((x) => [x.id, x.why]), [['maps', 'not in the plan'], ['research', 'Research needs the AI service installed and turned on first']], 'the plan\'s refusal, and Research waiting for the AI service as at creation');
    assert.equal(applied.json.environment.template.offerOpen, false);
    const owner = cookieOf(await call(server, 'beta', 'POST', '/api/login', { body: { login: 'owner', password: 'owner-password-1' } }));
    const lobby = (await call(server, 'beta', 'GET', '/api/spaces', { cookie: owner })).json.spaces.find((s) => s.id === 'lobby');
    assert.equal(lobby.name, 'Home base', 'the Lobby\'s name, ticked, taken');
    assert.deepEqual((await call(server, 'beta', 'GET', '/api/modules/for-space?space=lobby', { cookie: owner })).json.modules.map((m) => m.id), ['calendar'], 'the Planner is not in "Home base"');
    assert.equal((await call(server, 'beta', 'GET', '/api/environment', { cookie: owner })).json.template.id, 'travel');
    const history = readJson(path.join(hosted, 'environments', 'beta', 'app.json')).templateHistory;
    assert.deepEqual(history.map((h) => [h.from, h.to, h.by]), [[null, 'travel', 'host']]);
    assert.equal((await console_('PATCH', '/api/host/environments/beta', { template: 'none' })).json.environment.template, null);
  });

  // --- addendum 2: the host's own templates and template files (#68) ------------------------------------------------
  await test('hosted: a host template is made, used, edited (live at once, a new module offered), hidden, refused deletion, exported and imported', async () => {
    const set = { bg: '#ffffff', bgSection: '#f5f7f8', border: '#dde3e6', text: '#222222', textDim: '#6b7479', accent: '#1c7c8c', onAccent: '#ffffff' };
    const harbour = { id: 'harbour', name: 'Harbour', description: 'Sailing trips.', words: { space: { one: 'voyage', many: 'voyages' } }, modules: ['travel', 'places', 'chat', 'conference'], reactions: [{ id: 'wave', glyph: '👋', label: 'Wave' }], theme: { name: 'Harbour', light: set, dark: null } };
    const made = await console_('POST', '/api/host/templates', harbour);
    assert.equal(made.status, 201, made.text);
    assert.deepEqual([made.json.template.source, made.json.template.version, made.json.template.hidden], ['host', 1, false]);
    assert.deepEqual(await console_('POST', '/api/host/templates', { ...harbour, id: 'travel' }).then((r) => [r.status, r.json]), [409, { error: 'There is already a template called travel.' }]);
    const bad = await console_('POST', '/api/host/templates', { ...harbour, id: 'bad', modules: ['travel'] });
    assert.deepEqual([bad.status, bad.json.error], [400, 'modules: "chat" must be listed; Chat can\'t be switched off yet.']);
    assert.equal((await console_('POST', '/api/host/environments', { slug: 'sail', name: 'Sail', template: 'harbour', owner: { login: 'owner', password: 'owner-password-1' } })).status, 201);
    const owner = cookieOf(await call(server, 'sail', 'POST', '/api/login', { body: { login: 'owner', password: 'owner-password-1' } }));
    const asOwner = (method, url, body) => call(server, 'sail', method, url, { cookie: owner, body });
    for (let i = 0; i < 100 && !server.output().includes('[sail] Applied the "harbour" template'); i += 1) await new Promise((r) => setTimeout(r, 50));
    const settings = (await asOwner('GET', '/api/settings')).json.settings;
    assert.deepEqual([settings.words.space.one, settings.reactions.map((r) => r.id), settings.template.source, settings.template.appliedVersion], ['voyage', ['wave'], 'host', 1]);
    assert.equal((await asOwner('GET', '/api/themes')).json.themes.find((t) => t.id === settings.activeThemeId).name, 'Harbour', 'its theme added and active');
    const list = (await console_('GET', '/api/host/templates')).json.templates;
    assert.deepEqual(list.find((t) => t.id === 'harbour').usedBy, ['sail']);
    assert.equal(list.find((t) => t.id === 'travel').source, 'bundled');
    // An edit: the words at once, the version up, the new module offered on the Template tab, nothing forced.
    const edited = await console_('PATCH', '/api/host/templates/harbour', { words: { space: { one: 'sail', many: 'sails' } }, modules: [...harbour.modules, 'calendar'] });
    assert.deepEqual([edited.status, edited.json.template.version], [200, 2], edited.text);
    assert.equal((await call(server, 'sail', 'GET', '/api/branding')).json.words.space.one, 'sail', 'live at once');
    const tab = (await asOwner('GET', '/api/environment/template')).json;
    assert.deepEqual([tab.template.version, tab.template.appliedVersion, tab.template.offerOpen, tab.offer.modules.map((m) => m.id)], [2, 1, true, ['calendar']]);
    assert.equal((await asOwner('GET', '/api/modules')).json.modules.some((m) => m.id === 'calendar'), false, 'nothing forced');
    const applied = await asOwner('POST', '/api/environment/template/apply', { modules: ['calendar'] });
    assert.deepEqual([applied.status, applied.json.template.appliedVersion, applied.json.template.offerOpen], [200, 2, false]);
    assert.deepEqual(await console_('PATCH', '/api/host/templates/travel', { name: 'x' }).then((r) => [r.status, r.json]), [403, { error: "Bundled templates can't be edited; export one to start your own." }]);
    // Hidden: gone from new choices; the environment keeps it.
    assert.equal((await console_('PATCH', '/api/host/templates/harbour', { hidden: true })).json.template.version, 2, 'hiding is not a new version');
    assert.deepEqual(await console_('POST', '/api/host/environments', { slug: 'sail2', name: 'Sail 2', template: 'harbour' }).then((r) => [r.status, r.json]), [400, { error: 'There is no template called harbour.' }]);
    assert.equal((await asOwner('GET', '/api/environment/template')).json.choices.some((c) => c.id === 'harbour'), true, 'the one it has is still listed for it');
    assert.deepEqual(await console_('DELETE', '/api/host/templates/harbour').then((r) => [r.status, r.json]), [409, { error: 'Environments use this template: Sail. Hide it instead.' }]);
    // Export, then import under a new id; an import with a taken id is refused.
    const file = await console_('GET', '/api/host/templates/harbour/export');
    assert.equal(file.headers['content-disposition'], 'attachment; filename="harbour.magpie-template.json"');
    assert.deepEqual([file.json.magpieTemplate, file.json.version, file.json.theme.name], [1, 2, 'Harbour']);
    assert.deepEqual(await console_('POST', '/api/host/templates/import', file.json).then((r) => [r.status, r.json]), [409, { error: 'There is already a template called harbour.' }]);
    const copy = await console_('POST', '/api/host/templates/import?id=harbour-copy', { ...file.json, extra: 1 });
    assert.deepEqual([copy.status, copy.json.template.id, copy.json.template.version, copy.json.dropped], [201, 'harbour-copy', 2, ['extra']], 'the file\'s version kept');
    assert.deepEqual(await console_('POST', '/api/host/templates/import', { ...file.json, magpieTemplate: 2 }).then((r) => [r.status, r.json]), [400, { error: 'This template was made by a newer version of Magpie.' }]);
    assert.equal((await console_('DELETE', '/api/host/templates/harbour-copy')).status, 200, 'an unused one can be deleted');
    // Owners on a hosted server export only their own template; import and delete are the host's.
    const own = await asOwner('GET', '/api/templates/harbour/export');
    assert.deepEqual([own.status, own.json.id, own.json.version], [200, 'harbour', 2]);
    assert.deepEqual(await asOwner('GET', '/api/templates/travel/export').then((r) => [r.status, r.json]), [403, { error: 'On a hosted server, the host manages templates.' }]);
    assert.deepEqual(await asOwner('POST', '/api/templates/import', own.json).then((r) => [r.status, r.json]), [403, { error: 'On a hosted server, the host manages templates.' }]);
    // A newer version that changed only the words: the Template tab offers nothing (every part fingerprinted when applied).
    assert.equal((await console_('PATCH', '/api/host/templates/harbour', { words: { space: { one: 'crossing', many: 'crossings' } } })).json.template.version, 3);
    const after = (await asOwner('GET', '/api/environment/template')).json;
    assert.deepEqual([after.template.version, after.template.offerOpen, after.offer], [3, false, null], 'no offer: nothing it applies once changed');
    const card = () => console_('GET', '/api/host/environments').then((r) => r.json.environments.find((e) => e.slug === 'sail').template);
    assert.deepEqual(await card().then((t) => [t.version, t.appliedVersion, t.offerOpen]), [3, 2, false], 'the console\'s card agrees');
    assert.equal((await console_('PATCH', '/api/host/templates/harbour', { modules: [...harbour.modules, 'calendar', 'polls'] })).json.template.version, 4);
    assert.deepEqual(await card().then((t) => [t.version, t.appliedVersion, t.offerOpen]), [4, 2, true], 'a changed module list flags the card');
  });

  await test('hosted: the host settings list the modules the image ships, with names and icons, for the template editor', async () => {
    const mods = (await console_('GET', '/api/host/settings')).json.modules;
    assert.deepEqual(mods.slice(0, 2), [{ id: 'conference', name: 'Conference', icon: 'video' }, { id: 'chat', name: 'Chat', icon: 'message' }]);
    assert.deepEqual(mods.find((m) => m.id === 'travel'), { id: 'travel', name: 'Planner', icon: 'suitcase-rolling' });
    assert.deepEqual((await call(server, 'admin', 'GET', '/api/host/settings')).status, 401, 'host only');
  });
} finally {
  if (server) await server.stop();
  fs.rmSync(base, { recursive: true, force: true });
}

if (failed) {
  console.error(`check-template-switch: ${failed} group${failed === 1 ? '' : 's'} failed`);
  process.exit(1);
}
console.log(`check-template-switch: ${n} groups OK`);
