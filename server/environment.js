// One environment's own services: everything under the seam server/index.js reaches by name (store, modules,
// moduleData, moduleHooks, chatHistory, moduleLinks, moduleBus, moduleSettings, ai, moduleUploads, geocodeCache,
// regionCutJobs, and the smaller in-memory state beside them), built once from one data directory. This is
// phase 1 of documentation/plans/plan-tenants.md: with no BASE_DOMAIN there is exactly one environment, built
// from DATA_DIR directly -- this file is what that construction always was, factored out so index.js can build
// the same set again for each environment's own directory (DATA_DIR/environments/<slug>/), and index.js's request handlers
// keep reading `store`, `modules` and the rest by the names they use today (see the AsyncLocalStorage + Proxy
// wiring in index.js, right after this file's exports are required).
//
// What is NOT built here, because it is the host's, not any one environment's: the LiveKit room-service client
// (one call service, shared -- phase 4 prefixes its room names per environment), the pre-made backgrounds and Font
// Awesome files (part of the app itself, or an admin's own Pro package at DATA_DIR/fontawesome-pro -- see the
// migration note in plan-tenants.md: that folder and host.json are the two things a migration never moves).
'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { Store, randomToken } = require('./store');
const { ModuleManager } = require('./modules');
const { ModuleData } = require('./module-data');
const { ModuleHooks } = require('./module-hooks');
const { ChatHistory } = require('./chat-history');
const { ModuleLinks } = require('./module-links');
const { ModuleBus } = require('./module-bus');
const { ModuleSettings } = require('./module-settings');
const { Ai } = require('./ai');
const { ModuleUploads } = require('./module-uploads');
const { GeocodeCache } = require('./geocode');
const { RegionCutJobs } = require('./region-cut');
const { ModuleLimits } = require('./module-limits');
const auth = require('./auth');
const { migrateEnvironment } = require('./migrate-names');

// The same read-access guard index.js's route handlers use (its own moduleCan), needed here only for
// ModuleHooks' resolveRecipients. Duplicated rather than shared, since it is three lines and pure, and this file
// must not require index.js (index.js requires this one).
function moduleCan(manifest, perms, need) {
  const guard = need && manifest.access?.[need];
  return !guard || Boolean(perms[`module.${manifest.id}.${guard}`]);
}

// Builds and wires one environment's full set of services from its own data directory: everything that used to
// run once, globally, at server startup now runs here -- once per environment, whether that is the single
// default environment (no BASE_DOMAIN) or one environment's own directory.
//
// `owner`, when given `{ login, password }`, bootstraps the first owner the same way ADMIN_USER and
// OWNER_PASSWORD (once ADMIN_PASSWORD) always have (updates an existing account's password to match and makes it an
// owner, or creates one, or -- with no password given at all -- makes a random one the first time there is no
// owner yet). This only ever runs for the default environment; a hosted environment's first owner comes from the
// host API's own environment-creation flow instead (its password
// is that owner's own choice, not a value every environment would otherwise share).
//
// `managed`, when given, is the function this environment's own Ai instance calls to read the host's managed
// AI service (documentation/plans/plan-tenants.md, "Managed AI") -- index.js's own, closing over the host
// registry and the AI_* environment variables. Defaults to offering none, for a caller (a test) that does not
// need it.
function buildEnvironment(dataDir, { slug = null, owner = null, log = console.log, managed = () => null } = {}) {
  // The Names migration (documentation/plans/plan-names.md, "The migration") runs before Store reads app.json, so
  // every service below reads this environment's data in its current shape. Throws a MigrationError naming the
  // file when a part cannot finish, and nothing is built.
  migrateEnvironment(dataDir, { log });
  const store = new Store(dataDir);
  const modules = new ModuleManager(dataDir);
  const moduleData = new ModuleData(modules.dir);
  store.extraPermissions = () => modules.permissionList(); // enabled modules' permissions join the Roles grid

  // Who a module notification reaches: people who could see that module in that place.
  const moduleHooks = new ModuleHooks(modules.dir, {
    resolveRecipients: ({ module, roomId }, to) => {
      const found = modules.enabled(module);
      if (!found) return [];
      let keys = [];
      if (to === 'room') keys = roomId ? store.roomById(roomId)?.members || [] : [];
      else if (to === 'server') keys = store.users.map((u) => u.key);
      else keys = store.userByKey(to) ? [to] : [];
      return keys.filter((k) => store.userByKey(k) && moduleCan(found.manifest, store.roomPermissions(k, roomId), 'read'));
    },
  });
  moduleHooks.start();

  const limiter = new auth.LoginLimiter();
  const moduleLimits = new ModuleLimits();

  if (owner) {
    const login = owner.login || 'admin';
    const password = owner.password || owner.key;
    if (password) {
      const existing = store.userByLogin(login);
      const passwordHash = auth.hashPassword(password);
      if (existing) {
        if (!auth.verifyPassword(password, existing.passwordHash) || existing.role !== 'owner') {
          store.updateUser(existing.key, { passwordHash, role: 'owner' });
          log(`Owner "${login}" updated from the environment.`);
        }
      } else {
        store.addUser({ login, displayName: login, role: 'owner', passwordHash });
        log(`Owner "${login}" created from the environment.`);
      }
    } else if (store.ownerCount() === 0) {
      const generated = randomToken(9);
      store.addUser({ login, displayName: login, role: 'owner', passwordHash: auth.hashPassword(generated) });
      log(`No owner yet and no owner password set. Created "${login}" with password: ${generated}`);
    }
  }

  // Who is on the site right now (POST /api/presence) and pending two-person invitations -- both in memory only,
  // never meeting another environment's.
  const presence = new Map(); // user key -> last time a page said it was open
  const invites = new Map(); // id -> { id, from, to, roomId, at }
  const inviteEvents = new EventEmitter();
  inviteEvents.setMaxListeners(0);

  const chatHistory = new ChatHistory(dataDir);
  const chatPosts = new Map(); // who -> recent post times, to keep one person from flooding a room's history

  const moduleLinks = new ModuleLinks(modules.dir);
  const moduleBus = new ModuleBus(modules.dir);
  const moduleSettings = new ModuleSettings(modules.dir);

  const ai = new Ai(dataDir, process.env, undefined, managed);
  modules.aiReady = () => ai.ready(); // a module declaring hooks.ai depends on the AI service the way one module depends on another

  const moduleUploads = new ModuleUploads(modules.dir);
  const geocodeCache = new GeocodeCache(modules.dir);
  const regionCutJobs = new RegionCutJobs(dataDir);

  // A Font Awesome icon as inline SVG, cached by id -- keyed off this environment's own custom icons
  // (store.settings.icons), so two environments' same id can mean two different icons.
  const roomIconSvgs = new Map();

  // What modules have been doing (DATA_DIR/modules/activity.json), for the admin's activity list. Written a few
  // seconds after a change and on the way out (see flushEnvironment).
  const activityFile = path.join(modules.dir, 'activity.json');
  const moduleActivity = (() => {
    try {
      const raw = JSON.parse(fs.readFileSync(activityFile, 'utf8'));
      return Array.isArray(raw) ? raw.slice(-300) : [];
    } catch {
      return [];
    }
  })();
  let activityTimer = null;
  function saveActivity() {
    if (activityTimer) clearTimeout(activityTimer);
    activityTimer = null;
    try {
      fs.mkdirSync(path.dirname(activityFile), { recursive: true });
      fs.writeFileSync(`${activityFile}.tmp`, JSON.stringify(moduleActivity));
      fs.renameSync(`${activityFile}.tmp`, activityFile);
    } catch {
      // the log is a convenience
    }
  }
  function noteActivity(module, what, by, scopeKey) {
    moduleActivity.push({ at: Date.now(), module, what, by: by || null, scope: scopeKey || null });
    if (moduleActivity.length > 300) moduleActivity.shift();
    if (!activityTimer) { activityTimer = setTimeout(saveActivity, 5000); if (activityTimer.unref) activityTimer.unref(); }
  }
  moduleData.on('change', (c) => noteActivity(c.module, `${c.deleted ? 'deleted' : 'saved'} ${c.key}`, c.by, c.scopeKey));
  moduleBus.on('event', (e) => noteActivity(e.module, `published the event ${e.name}`, e.by, e.scopeKey));
  moduleBus.on('action', (a) => noteActivity(a.from, `asked ${a.provider} to ${a.action}`, a.by, a.scopeKey));
  moduleSettings.on('change', (c) => {
    if (c.scope === 'person') return;
    const where = c.scope === 'room' ? ` for ${store.roomById(c.roomId)?.name || 'a room'}` : '';
    noteActivity(c.module, `changed the ${c.scope} settings${where}: ${c.keys.join(', ')}`, c.by, null);
  });
  regionCutJobs.on('done', (id) => { const j = regionCutJobs.jobs.get(id); if (j) noteActivity(j.moduleId, `cut a map region: ${j.name}`, j.by, null); });
  regionCutJobs.on('error', (id, error) => { const j = regionCutJobs.jobs.get(id); if (j) noteActivity(j.moduleId, `could not cut a map region: ${error}`, j.by, null); });

  return {
    slug, dataDir,
    store, modules, moduleData, moduleHooks, chatHistory, moduleLinks, moduleBus, moduleSettings, ai, moduleUploads,
    geocodeCache, regionCutJobs, moduleLimits, limiter, presence, invites, inviteEvents, chatPosts, roomIconSvgs,
    moduleActivity, noteActivity, saveActivity,
  };
}

// Every write this environment might still owe the disk, at shutdown or when it is set aside (suspended, or
// moved to environments-deleted/): each singleton here already writes synchronously on every change except these
// four, which only debounce and flush on the way out.
function flushEnvironment(env) {
  env.chatHistory.flush();
  env.ai.flush();
  env.geocodeCache.flush();
  env.saveActivity();
}

module.exports = { buildEnvironment, flushEnvironment };
