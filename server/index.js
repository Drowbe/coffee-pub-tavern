'use strict';

// The app's own server: accounts, pages, images and LiveKit tokens.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const yauzl = require('yauzl');
const { AsyncLocalStorage } = require('async_hooks');
const { AccessToken, RoomServiceClient, DataPacket_Kind } = require('livekit-server-sdk');
const QRCode = require('qrcode');
const { ModuleManager, LIMITS: MODULE_LIMITS, compareVersions, oldNameIn, pendingWidensNothing } = require('./modules');
const { buildModule, bundledModules, zipFiles } = require('./module-build');
const { ModuleLinks } = require('./module-links');
const { Backgrounds } = require('./backgrounds');
const { ModuleBus } = require('./module-bus');
const { ChatHistory } = require('./chat-history');
const { ModuleLimits } = require('./module-limits');
const { ModuleSettings, SettingError } = require('./module-settings');
const { GeocodeCache, askService, keyOf: keyOfPlace, ENOUGH } = require('./geocode');
const { RegionCutJobs, RegionCutError } = require('./region-cut');
const { pmtilesZoomRange } = require('./pmtiles-header');
const { ModuleUploads } = require('./module-uploads');
const { inspectHead } = require('./image-clean');
const { Ai, AiError, listModelsFor, managedOffer, MANAGED_PROVIDERS } = require('./ai');
const { EventEmitter } = require('events');
const { ModuleData } = require('./module-data');
const { ModuleHooks } = require('./module-hooks');
const { Store, StoreError, SLOTS, PARTICIPANT_SLOTS, CHARACTER_SLOTS, SPACE_PROFILES, SPACE_PROFILE_SLOTS, LEGACY_SLOTS, ROLE_PERMISSIONS, hasOwnerRights, IMAGE_TYPES, MAX_IMAGE_BYTES, LOBBY, randomToken, cleanText } = require('./store');
const auth = require('./auth');
const { buildEnvironment, flushEnvironment } = require('./environment');
const { HostRegistry, HostError, cleanSlug } = require('./host-registry');
const { migrateHost, backupRefusal, refusedAtStartup, refusalSentence, MigrationError, recordedParts } = require('./migrate-names');
const studioAlias = require('./studio-alias');
const callNames = require('./call-names');
const { mountOldLinks } = require('./old-links');
const { currencyCodes } = require('./currencies');

const {
  PORT = 3000,
  DATA_DIR = path.join(__dirname, '..', 'data'),
  LIVEKIT_HOST = 'localhost:7880',
  LIVEKIT_API_URL = '',
  LIVEKIT_API_KEY = '',
  LIVEKIT_API_SECRET = '',
  // The server's admin (plan-names decision 7): made, or its password reset, on every start. On a hosted server the
  // host admin in host.json; on a single-environment install the one environment's `admin` account.
  ADMIN_LOGIN = '',
  ADMIN_PASSWORD = '',
  ADMIN_USER = '', // the old name of ADMIN_LOGIN: still read, with a line on start, until a later release
  ADMIN_KEY = '', // pre-account releases used this; accepted as the admin password
  OWNER_PASSWORD = '', // built in step 4 and dropped: ignored, with a line on start
  TAVERN_ADMIN_USER = '', // deprecated: use ADMIN_LOGIN
  TAVERN_ADMIN_PASSWORD = '', // deprecated: use ADMIN_PASSWORD
  TAVERN_ADMIN_KEY = '', // deprecated: use ADMIN_PASSWORD
  TAVERN_REVISION = 'dev',
  BASE_DOMAIN = '',
  PREVIOUS_BASE_DOMAINS = '',
  MIGRATE_ENVIRONMENT_SLUG = '',
  MIGRATE_TENANT_SLUG = '', // the old name of MIGRATE_ENVIRONMENT_SLUG: still read, with a line on start, until a later release
  HOST_ADMIN_LOGIN = '', // hosted: the old name of ADMIN_LOGIN, still read with a line on start
  HOST_ADMIN_PASSWORD = '', // hosted: the old name of ADMIN_PASSWORD, likewise
  PRODUCT_NAME = 'Coffee Pub Magpie', // the product's own name, still being chosen -- configuration, never code
  CONTACT_EMAIL = '',
  // Seed the host's managed AI service, per company (documentation/plans/plan-tenants.md, "Managed AI, per
  // company"): AI_OPENAI_KEY/AI_ANTHROPIC_KEY name a company's key directly; AI_PROVIDER (with AI_ADDRESS,
  // AI_MODEL, AI_KEY) is the older one-company form, filling whichever company it names -- both still work.
  AI_PROVIDER = '',
  AI_ADDRESS = '',
  AI_MODEL = '',
  AI_KEY = '',
  TAVERN_AI_KEY = '', // deprecated: use AI_KEY (used to be an environment's own key; it is the host's now)
  AI_OPENAI_KEY = '',
  AI_ANTHROPIC_KEY = '',
  // An organisation-level Anthropic key needs its workspace id sent with every call (an id, not a secret).
  AI_ANTHROPIC_WORKSPACE = '',
  // Self-serve and billing (plan-tenants.md, "Phase 5"): SIGNUP gates POST /api/product/signup -- off unless a
  // host explicitly opts in with SIGNUP=on, so a freshly upgraded host never offers public self-service by
  // surprise. BILLING_SECRET signs the billing webhook (x-billing-signature, HMAC-SHA256 of the raw body) --
  // unset, the webhook route answers 404, same as a feature that was never turned on. A plan's own checkout URL
  // is BILLING_CHECKOUT_<PLAN ID>, read directly off process.env where it is used (the plan id is dynamic,
  // host-configured, so it can't be named here).
  SIGNUP = '',
  BILLING_SECRET = '',
  // Two-step sign-in (documentation/plans/plan-mfa.md, "Regaining access"): ENABLE_MFA turns the whole feature
  // on or off, server-wide (default on); ADMIN_MFA_LOCKOUT_BYPASS lets an admin -- an environment's own or a
  // host admin -- back in without the code step or the enrol requirement, at the cost of that account's own
  // second factor being nothing to lean on while it is set. An environment's own policy is settings.mfaRequired
  // instead, a plain on/off through Manage. HOST_MFA_REQUIRED is the host console's; HOST_MFA=required still
  // works too, from before the switches were renamed.
  ENABLE_MFA = 'true',
  ADMIN_MFA_LOCKOUT_BYPASS = 'false',
  HOST_MFA_REQUIRED = 'false',
  HOST_MFA = '',
} = process.env;

// The server's admin (plan-names decisions 7, 15 and 20): ADMIN_LOGIN and ADMIN_PASSWORD, on every kind of install.
// The old names are still read, a new name always winning when both are set, and each old name read says so on every
// start. On a single-environment install those are ADMIN_USER and TAVERN_ADMIN_* (with ADMIN_KEY, the pre-account
// password, still accepted); on a hosted server, HOST_ADMIN_LOGIN and HOST_ADMIN_PASSWORD, the host admin's names
// before. Each kind reads only its own old names, as it always has: a hosted server never read ADMIN_USER or
// TAVERN_ADMIN_*, which named the single install's account, and a single install never read HOST_ADMIN_*.
const oldConfigNames = BASE_DOMAIN
  ? [['HOST_ADMIN_LOGIN', 'ADMIN_LOGIN', HOST_ADMIN_LOGIN], ['HOST_ADMIN_PASSWORD', 'ADMIN_PASSWORD', HOST_ADMIN_PASSWORD]]
  : [['ADMIN_USER', 'ADMIN_LOGIN', ADMIN_USER], ['TAVERN_ADMIN_USER', 'ADMIN_LOGIN', TAVERN_ADMIN_USER], ['TAVERN_ADMIN_PASSWORD', 'ADMIN_PASSWORD', TAVERN_ADMIN_PASSWORD], ['TAVERN_ADMIN_KEY', 'ADMIN_PASSWORD', TAVERN_ADMIN_KEY]];
for (const [old, now, value] of oldConfigNames) if (value) console.warn(`${old} is now ${now}; the old name stops working in a later release.`);
// A hosted server never read the single install's own names; set there, they are said to be ignored, once per start.
if (BASE_DOMAIN) {
  const ignored = [['ADMIN_USER', ADMIN_USER], ['ADMIN_KEY', ADMIN_KEY], ['TAVERN_ADMIN_USER', TAVERN_ADMIN_USER], ['TAVERN_ADMIN_PASSWORD', TAVERN_ADMIN_PASSWORD], ['TAVERN_ADMIN_KEY', TAVERN_ADMIN_KEY]].filter(([, v]) => v).map(([k]) => k);
  if (ignored.length) console.warn(`${ignored.join(', ')} ${ignored.length === 1 ? 'is' : 'are'} ignored on a server with environments: use ADMIN_LOGIN and ADMIN_PASSWORD for the host admin.`);
}
if (OWNER_PASSWORD) console.warn("OWNER_PASSWORD is ignored: owners are made in Manage. Use ADMIN_PASSWORD for the server's admin.");
const adminLogin = ADMIN_LOGIN || (BASE_DOMAIN ? HOST_ADMIN_LOGIN : ADMIN_USER || TAVERN_ADMIN_USER) || 'admin';
const adminPassword = ADMIN_PASSWORD || (BASE_DOMAIN ? HOST_ADMIN_PASSWORD : TAVERN_ADMIN_PASSWORD || ADMIN_KEY || TAVERN_ADMIN_KEY);
if (BASE_DOMAIN && ADMIN_PASSWORD && HOST_ADMIN_PASSWORD && ADMIN_PASSWORD !== HOST_ADMIN_PASSWORD) {
  console.warn(`ADMIN_PASSWORD and HOST_ADMIN_PASSWORD are both set and differ: ADMIN_PASSWORD is used for the host admin "${adminLogin}". Remove HOST_ADMIN_PASSWORD.`);
}
const aiKeyFromEnv = AI_KEY || TAVERN_AI_KEY;
// The environment a single-environment install moves into on its first start with BASE_DOMAIN (plan-names
// decisions 15 and 20): the new name wins when both are set, and the old one says so on every start it is set.
const migrateEnvironmentSlug = MIGRATE_ENVIRONMENT_SLUG || MIGRATE_TENANT_SLUG;
if (MIGRATE_TENANT_SLUG) console.warn('MIGRATE_TENANT_SLUG is now MIGRATE_ENVIRONMENT_SLUG; the old name stops working in a later release.');
const signupEnabled = Boolean(BASE_DOMAIN) && SIGNUP === 'on';
const mfaOffered = ENABLE_MFA !== 'false';
const adminMfaLockoutBypass = ADMIN_MFA_LOCKOUT_BYPASS === 'true';
const hostMfaRequired = HOST_MFA_REQUIRED === 'true' || HOST_MFA === 'required';
// BILLING_CHECKOUT_<PLAN ID>, e.g. BILLING_CHECKOUT_PRO for the plan "pro"; none set means that plan is not
// sold online (plan-tenants.md, "Phase 5").
function checkoutUrlFor(planId) {
  return process.env[`BILLING_CHECKOUT_${String(planId).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`] || null;
}

const VERSION = `v${require('../package.json').version} (${String(TAVERN_REVISION).slice(0, 7)})`;

if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET are required.');
  process.exit(1);
}

// --- environments (one host, many environments: documentation/plans/plan-tenants.md, phase 1) -----------------
// With no BASE_DOMAIN there is exactly one environment, built straight from DATA_DIR: today's install, unchanged.
// With BASE_DOMAIN set, one environment per slug (DATA_DIR/environments/<slug>/), resolved from the request's
// hostname by the resolver middleware below (see "the door"). Either way, request handlers keep reading `store`,
// `modules` and the rest by the names they use today: those names are Proxies that forward to whichever
// environment the current request (or, outside a request, an explicit envContext.run call) resolved.
const envContext = new AsyncLocalStorage();
const environments = new Map(); // slug ('' for the default/no-BASE_DOMAIN environment) -> a built environment
const DEFAULT_SLUG = '';
// Where the modules that ship with this deployment live -- moved up here (out of its old spot near
// bundledList()) because environmentFor()'s auto-install needs it, and environmentFor() runs at module load,
// before that part of the file has executed.
const BUNDLED_DIR = path.join(__dirname, '..', 'modules');

function currentEnvironment() {
  const env = envContext.getStore();
  if (!env) throw new Error('no environment resolved for this request');
  return env;
}

// A Proxy standing in for one of the current environment's services, by name: every property access resolves
// against envContext's current environment, and a method comes back bound to the real instance (never the
// Proxy), so `store.someMethod()` runs against the right environment's real `store`, whichever one is current.
// Works uniformly for a class instance, a plain Map, or an EventEmitter -- everything under the seam.
function proxyFor(name) {
  const forward = (trap) => (_target, ...args) => trap(currentEnvironment()[name], ...args);
  return new Proxy(Object.create(null), {
    get: forward((real, prop) => {
      const value = Reflect.get(real, prop, real);
      return typeof value === 'function' ? value.bind(real) : value;
    }),
    set: forward((real, prop, value) => Reflect.set(real, prop, value)),
    has: forward((real, prop) => Reflect.has(real, prop)),
    deleteProperty: forward((real, prop) => Reflect.deleteProperty(real, prop)),
    ownKeys: forward((real) => Reflect.ownKeys(real)),
    getOwnPropertyDescriptor: forward((real, prop) => Reflect.getOwnPropertyDescriptor(real, prop)),
  });
}

const store = proxyFor('store');
const modules = proxyFor('modules');
const moduleData = proxyFor('moduleData');
const moduleHooks = proxyFor('moduleHooks');
const chatHistory = proxyFor('chatHistory');
const chatPosts = proxyFor('chatPosts');
const moduleLinks = proxyFor('moduleLinks');
const moduleBus = proxyFor('moduleBus');
const moduleSettings = proxyFor('moduleSettings');
const ai = proxyFor('ai');
const moduleUploads = proxyFor('moduleUploads');
const geocodeCache = proxyFor('geocodeCache');
const regionCutJobs = proxyFor('regionCutJobs');
const moduleLimits = proxyFor('moduleLimits');
const limiter = proxyFor('limiter');
const presence = proxyFor('presence');
const invites = proxyFor('invites');
const inviteEvents = proxyFor('inviteEvents');
const iconSvgs = proxyFor('iconSvgs');
const moduleActivity = proxyFor('moduleActivity');
function noteActivity(...args) { return currentEnvironment().noteActivity(...args); }

// The registry of environments (DATA_DIR/host.json): which environments exist, their plans, the host admins. Only
// built when BASE_DOMAIN is set -- a self-hosted install with no base domain never has this file.
// The host's Names migration part (documentation/plans/plan-names.md, "The migration") runs first, before
// host.json is read and before any environment is built; a failure stops the start with the file named.
if (BASE_DOMAIN) {
  try {
    migrateHost(DATA_DIR);
  } catch (err) {
    if (!(err instanceof MigrationError)) throw err;
    console.error(err.message);
    process.exit(1);
  }
}
const hostRegistry = BASE_DOMAIN ? new HostRegistry(DATA_DIR) : null;
if (hostRegistry) {
  hostRegistry.setBaseDomain(BASE_DOMAIN);
  hostRegistry.setPreviousBaseDomains(PREVIOUS_BASE_DOMAINS);
}
// The host's own region-cut jobs, over its shared folders (documentation/plans/plan-tenants.md, "Shared files:
// the host's map") -- lands a cut in DATA_DIR/shared/<module id>/<folder>/ (`under: ''`, no per-environment
// "modules" segment), never DATA_DIR/shared/modules/... An environment's own regionCutJobs (per environment,
// built in buildEnvironment) is untouched; this is the host's own, only reachable from hostRouter.
const sharedRegionCutJobs = BASE_DOMAIN ? new RegionCutJobs(path.join(DATA_DIR, 'shared'), undefined, { under: '' }) : null;

// First start with BASE_DOMAIN set and data still at DATA_DIR's own root (a pre-environment install -- its settings
// file is app.json now, or still tavern.json if it has not been started since that rename): refuses to start
// until told which environment that data becomes.
function migrateIfNeeded() {
  const preEnvironment = fs.existsSync(path.join(DATA_DIR, 'app.json')) || fs.existsSync(path.join(DATA_DIR, 'tavern.json'));
  if (!BASE_DOMAIN || !preEnvironment) return;
  if (!migrateEnvironmentSlug) {
    console.error(`BASE_DOMAIN is set and ${DATA_DIR} is a single-environment install. Set MIGRATE_ENVIRONMENT_SLUG=<slug> for one start to move it to that environment, then remove it.`);
    process.exit(1);
  }
  const slug = cleanSlug(migrateEnvironmentSlug);
  const dest = path.join(DATA_DIR, 'environments', slug);
  if (fs.existsSync(dest)) throw new Error(`${dest} already exists; migration already ran`);
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(DATA_DIR)) {
    if (['host.json', 'fontawesome-pro', 'environments', 'environments-deleted', 'pre-names-host'].includes(entry)) continue;
    fs.renameSync(path.join(DATA_DIR, entry), path.join(dest, entry));
  }
  hostRegistry.addEnvironment({ slug, name: slug, plan: { modules: 'all' } });
  console.log(`Migrated the existing install to the "${slug}" environment (${dest}).`);
  ownersFromServerAdmin(dest);
}
// A single-environment install's admin (role admin, made by ADMIN_LOGIN and ADMIN_PASSWORD) runs that install; once it
// is one environment of a hosted server, the server's admin is the host admin, so that account becomes the
// environment's owner. Data from before the names-roles part needs nothing here: that part makes it an owner.
function ownersFromServerAdmin(dir) {
  const file = path.join(dir, 'app.json');
  let app;
  try { app = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }
  if (!app || !Array.isArray(app.users) || !recordedParts(app).includes('names-roles')) return;
  const moved = app.users.filter((u) => u && u.role === 'admin' && !u.hostAdmin);
  if (!moved.length) return;
  for (const u of moved) u.role = 'owner';
  fs.writeFileSync(file, `${JSON.stringify(app, null, 2)}\n`);
  console.log(`The install's admin (${moved.map((u) => `"${u.login}"`).join(', ')}) is now the "${path.basename(dir)}" environment's owner; the server's admin is the host admin.`);
}
migrateIfNeeded();

// On a first start with BASE_DOMAIN where a shared folder (documentation/plans/plan-tenants.md, "Shared files:
// the host's map") does not exist yet: if exactly one environment has files in its own, pre-shared folder for
// it, those files move to the shared one, so that environment's map keeps working without anyone copying
// anything by hand; more than one, or none, and the folder is simply left to start empty (an admin adds files
// or cuts a region from the host console). Runs once, here, before any environment is built against the new
// shared location.
function migrateSharedFolders() {
  if (!BASE_DOMAIN) return;
  const envDataDirs = hostRegistry.listEnvironments().map((t) => path.join(DATA_DIR, 'environments', t.slug));
  for (const { module: moduleId, folder } of bundledSharedFolders()) {
    const sharedDir = path.resolve(DATA_DIR, 'shared', moduleId, folder);
    if (fs.existsSync(sharedDir)) continue;
    const withFiles = envDataDirs.filter((d) => {
      try { return fs.readdirSync(path.join(d, 'modules', moduleId, folder)).length > 0; } catch { return false; }
    });
    if (withFiles.length === 1) {
      fs.mkdirSync(path.dirname(sharedDir), { recursive: true });
      fs.renameSync(path.join(withFiles[0], 'modules', moduleId, folder), sharedDir);
      console.log(`Moved "${moduleId}"'s "${folder}" files to the shared folder (from ${withFiles[0]}).`);
    }
  }
}
migrateSharedFolders();

// A company's managed slot from the environment alone, before anything saved in host.json is applied:
// AI_OPENAI_KEY/AI_ANTHROPIC_KEY name that company's key directly; AI_PROVIDER (with AI_ADDRESS, AI_MODEL,
// AI_KEY) is the older one-company form, filling whichever company it names. Both still work; when both apply
// to the same company either sets its key.
function envSlot(provider) {
  const fromOneCompanyForm = AI_PROVIDER === provider;
  return {
    key: (provider === 'openai' ? AI_OPENAI_KEY : provider === 'anthropic' ? AI_ANTHROPIC_KEY : '') || (fromOneCompanyForm ? aiKeyFromEnv : ''),
    model: fromOneCompanyForm ? AI_MODEL : '',
    address: provider === 'compatible' && fromOneCompanyForm ? AI_ADDRESS : '',
    workspace: provider === 'anthropic' ? AI_ANTHROPIC_WORKSPACE : '',
  };
}
// One company's managed slot, combining what is saved (host.json, when there is one -- a single-environment
// install has none, so the environment variables are the only way to offer a company at all there) with its
// live environment-variable override: the one place both managedAi (the Ai-facing offer list) and
// hostAiServices (the host console's own view) start from, so they can never disagree about it.
function managedSlot(provider) {
  const saved = hostRegistry ? hostRegistry.managedAi[provider] : null;
  const env = envSlot(provider);
  return {
    model: (saved && saved.model) || env.model || '',
    key: (saved && saved.key) || '',
    address: provider === 'compatible' ? ((saved && saved.address) || env.address || '') : '',
    workspace: provider === 'anthropic' ? ((saved && saved.workspace) || env.workspace || '') : '',
    envKey: env.key,
  };
}
// The host's managed AI offer, every company at once, as an Ai instance reads it: real values, including keys,
// never a view (see hostAiServices for that). In MANAGED_PROVIDERS order, so a fresh environment's own default
// (the first one offered) is openai, then anthropic, then compatible.
function managedAi() {
  const offers = [];
  for (const provider of MANAGED_PROVIDERS) {
    const slot = managedSlot(provider);
    const offer = managedOffer(provider, slot, slot.envKey);
    if (offer) offers.push(offer);
  }
  return offers.length ? offers : null;
}
// The same, for the host console: { provider, model, address, workspace, keySet, keyFromEnvironment, offered },
// one row per company, never a key.
function hostAiServices() {
  return MANAGED_PROVIDERS.map((provider) => {
    const slot = managedSlot(provider);
    const offer = managedOffer(provider, slot, slot.envKey);
    return {
      provider,
      model: offer ? offer.model : slot.model,
      address: slot.address,
      workspace: slot.workspace, // an id, not a secret -- fine to show
      keySet: !!(slot.envKey || slot.key),
      keyFromEnvironment: !!slot.envKey,
      offered: !!offer,
    };
  });
}

// Build (or fetch the already-built) environment for a slug, from its own data directory. Only ever called for
// a slug the caller already knows is real (the default, or one host.json names) -- the resolver 404s before this.
// Environments whose data the Names migration refused (server/migrate-names.js), by slug: { reason ('newer',
// 'unreadable' or 'failed'), file (from DATA_DIR), message (the full sentence the log has), sentence (what a person asking is
// told), at, logged }. An entry stays until that environment builds; each request tries again (so a restore
// brings it back), and the full message is logged once per refusal, not on every request.
const refusals = new Map();
function noteRefusal(key, err) {
  const prior = refusals.get(key);
  if (prior && prior.message === err.message) return prior;
  const refusal = {
    reason: ['newer', 'unreadable'].includes(err.reason) ? err.reason : 'failed',
    file: err.file ? path.relative(DATA_DIR, err.file).split(path.sep).join('/') : null,
    message: err.message,
    sentence: refusalSentence(err),
    at: new Date().toISOString(),
    logged: false,
  };
  refusals.set(key, refusal);
  return refusal;
}
function logRefusalOnce(key) {
  const refusal = refusals.get(key);
  if (!refusal || refusal.logged) return;
  refusal.logged = true;
  console.error(refusal.message);
}
// What the host console shows for a refused environment (null when it is not refused).
function refusalView(slug) {
  const r = refusals.get(slug);
  return r ? { reason: r.reason, file: r.file, message: r.message, at: r.at } : null;
}

function environmentFor(slug) {
  const key = slug || DEFAULT_SLUG;
  let env = environments.get(key);
  if (env) return env;
  const dataDir = slug ? path.join(DATA_DIR, 'environments', slug) : DATA_DIR;
  try {
    env = buildEnvironment(dataDir, {
      slug: slug || null,
      admin: slug ? null : { login: adminLogin, password: adminPassword },
      managed: managedAi,
    });
  } catch (err) {
    if (err instanceof MigrationError) { noteRefusal(key, err); err.slug = key; }
    throw err;
  }
  refusals.delete(key);
  // An environment's own name (settings.environmentName). Still on the shipped sentinel default --
  // a brand new environment, or one never renamed since before this was configurable -- picks its real one up
  // right here: the default environment gets the product's own name, an environment its registry name. Runs on every
  // build, not just the first, so an install that skipped a few versions catches up on its next start too.
  if (env.store.settings.environmentName === 'Coffee Pub Tavern') {
    env.store.updateSettings({ environmentName: slug ? (hostRegistry.findEnvironment(slug)?.name || PRODUCT_NAME) : PRODUCT_NAME });
  }
  environments.set(key, env);
  // An environment that just migrated its own old custom AI setting to "managed" (see Ai's constructor) gives
  // that company's own managed slot a starting point, once, if the host has nothing saved for it yet -- so what
  // worked through the old per-environment AI_KEY keeps working through the host's now instead.
  const aiSeed = env.ai.migrationSeed();
  if (aiSeed && hostRegistry) hostRegistry.seedManagedAi(aiSeed.provider, aiSeed);
  // Fire-and-forget: install() reads a zip asynchronously (yauzl), and environmentFor must stay synchronous --
  // every caller, including the resolver middleware, expects an environment back at once. A few milliseconds'
  // delay before an auto-installed module is actually usable is fine today, since nothing yet depends on it
  // being installed (see plan-stream-module.md's phases: the old GET /view/:key keeps answering on its own
  // until phase 3 removes it); it will matter once that changes, at which point this may need to be awaited.
  autoInstallBundled(env).catch((err) => console.error(`Auto-install failed for "${slug || DEFAULT_SLUG}": ${err.message}`));
  return env;
}

// A bundled module with install.auto (see cleanManifest in modules.js) gets installed and enabled once, ever,
// per environment, so a server updated to a version where some core feature moved into a module is never left
// without it. Never runs again for a module once it has, even if an admin later uninstalls it (modules.
// autoInstalled/markAutoInstalled). settingsFrom: "environment" copies each declared environment-scope setting whose key
// exists in store.settings into the module's own settings, on that same install, for one whose fields used to
// live there -- a value that fails to validate against its declared type is skipped rather than failing the
// whole install (logged either way).
async function autoInstallBundled(env) {
  await updateOutdatedBundled(env);
  for (const bundled of bundledModules(BUNDLED_DIR)) {
    if (!bundled.install?.auto || env.modules.isInstalled(bundled.id) || env.modules.autoInstalled(bundled.id)) continue;
    let installed;
    try {
      const { zip } = buildModule(path.join(BUNDLED_DIR, bundled.id));
      installed = await env.modules.install(zip, { source: 'bundled' });
      env.modules.update(bundled.id, { enabled: true });
    } catch (err) {
      console.error(`Could not auto-install "${bundled.id}": ${err.message}`);
      continue; // not marked -- it never actually installed, so the next start tries again
    }
    env.modules.markAutoInstalled(bundled.id);
    if (bundled.install.settingsFrom === 'environment') {
      try {
        const manifest = env.modules.manifestOf(bundled.id, installed.version);
        const values = {};
        for (const def of manifest.settings || []) {
          if (def.scope === 'environment' && env.store.settings[def.key] !== undefined) values[def.key] = env.store.settings[def.key];
        }
        if (Object.keys(values).length) env.moduleSettings.set(manifest, 'environment', {}, values, null);
      } catch (err) {
        console.error(`Auto-installed "${bundled.id}" but could not carry its settings over: ${err.message}`);
      }
    }
    console.log(`Auto-installed and enabled "${bundled.id}".`);
  }
}

// A bundled module installed before plan-names step 5c has a manifest in the old names, so it can't run (see
// ModuleManager.enabled). When this deployment ships a newer copy in the new names, it is updated to it on the
// environment's first build, the way an owner would press Update, so nothing that was on goes off for good: it keeps
// its on or off, its spaces and its data. Only a module that came from this deployment (source "bundled"); an
// uploaded one waits for its author.
//
// An update that asks for something new waits for an owner's approval, as any update does, with one exception on
// this path only: a new permission that is off for every role (moderator, member and guest) widens nothing, since
// only owners (and the admin) hold it, so a module that was on and asks for nothing else new stays on, and the log
// says so. A new permission on for some role, or any other new request (a hook, a link, an event, an action), still
// waits.
async function updateOutdatedBundled(env) {
  // On a hosted server each line names the environment it is about.
  const where = BASE_DOMAIN && env.slug ? `[${env.slug}] ` : '';
  for (const bundled of requirementsFirst(bundledModules(BUNDLED_DIR))) {
    const entry = env.modules.registry.modules[bundled.id];
    if (!entry || entry.source !== 'bundled' || oldNameIn(bundled)) continue;
    if (!env.modules.manifestOf(bundled.id, entry.version)?.outdated) continue;
    if (compareVersions(bundled.version, [...entry.versions].sort(compareVersions).pop()) <= 0) continue;
    const wasOn = Boolean(entry.enabled);
    try {
      const { zip } = buildModule(path.join(BUNDLED_DIR, bundled.id));
      const view = await env.modules.install(zip, { source: 'bundled' });
      let note = '';
      // Still switched on unless the update asks for something new (install switches it off then); whether it runs also
      // depends on what it requires, which is updated before it (requirementsFirst).
      if (wasOn && !env.modules.registry.modules[bundled.id].enabled) {
        const { pending } = view;
        if (pendingWidensNothing(pending, view.permissions)) {
          // Turned back on as an owner would (approving its new permissions). If something it requires is not on yet
          // (it waits for approval itself), that is not a failure of this update: it says so and stays waiting.
          try {
            env.modules.update(bundled.id, { enabled: true });
            note = ` It stays on: its new permission${pending.permissions.length === 1 ? '' : 's'} (${pending.permissions.join(', ')}) ${pending.permissions.length === 1 ? 'is' : 'are'} off for every role, so only owners have ${pending.permissions.length === 1 ? 'it' : 'them'}.`;
          } catch (err) {
            if (!err.status) throw err;
            note = ` It is off for now: ${err.message}`;
          }
        } else {
          note = ' It waits for an owner to approve what it newly asks for in Modules.';
        }
      }
      console.log(`${where}Updated "${bundled.id}" to ${view.version}: the version installed was built for an older Magpie.${note}`);
    } catch (err) {
      console.error(`${where}Could not update "${bundled.id}", which was built for an older Magpie: ${err.message}`);
    }
  }
  carryReplacedGrants(env);
  for (const m of env.modules.list()) {
    if (m.outdated) console.warn(`${where}Module "${m.id}" ${m.version} can't run until it is updated: ${m.outdatedWhy}`);
    else if (m.needsUpdate.length) console.warn(`${where}Module "${m.id}" ${m.version} can't run until ${m.needsUpdate.map((r) => `"${r}"`).join(' and ')}, which it requires, ${m.needsUpdate.length === 1 ? 'is' : 'are'} updated.`);
  }
}

// Bundled modules with each one after the modules it requires (Places before Maps), so a requirement is updated and
// back on before what needs it is turned back on. Otherwise by id, as bundledModules lists them. A cycle, or a
// requirement that does not ship here, simply keeps the listed order for what is left.
function requirementsFirst(list) {
  const byId = new Map(list.map((m) => [m.id, m]));
  const out = [];
  const placed = new Set();
  const visit = (m, path = new Set()) => {
    if (placed.has(m.id) || path.has(m.id)) return;
    path.add(m.id);
    for (const r of Array.isArray(m.requires) ? m.requires : []) if (byId.has(r)) visit(byId.get(r), path);
    placed.add(m.id);
    out.push(m);
  };
  for (const m of list) visit(m);
  return out;
}

// A permission a module's author renamed (a manifest permission's `replaces`, see cleanManifest): each role's own
// choice for the old key (Manage > Roles, settings.roles) is carried to the new key, once, and the old key removed, so
// nobody gains or loses anything by the rename. By shape: once the old key is gone there is nothing left to carry, so
// running it again does nothing. Run for every installed module, after anything is installed or updated. Recorded in
// the module's activity and the log. (Per-space grants hold only the Moderator tick, never a module's key.)
function carryReplacedGrants(env) {
  const where = BASE_DOMAIN && env.slug ? `[${env.slug}] ` : '';
  for (const m of env.modules.list()) {
    for (const p of m.permissions || []) {
      if (typeof p.replaces !== 'string' || p.replaces === p.key || (m.permissions || []).some((x) => x.key === p.replaces)) continue;
      const from = `module.${m.id}.${p.replaces}`;
      const to = `module.${m.id}.${p.key}`;
      const roles = env.store.carryRoleGrant(from, to);
      if (!roles.length) continue;
      env.noteActivity(m.id, `carried the ${roles.join(', ')} role's choice for "${p.replaces}" over to "${p.key}"`, null, null);
      console.log(`${where}Carried the ${roles.join(', ')} role's choice for ${from} over to ${to}.`);
    }
  }
}

// An environment whose data the Names migration refuses (buildEnvironment throws a MigrationError; see
// server/migrate-names.js): a single-environment install stops, with the file named; on a hosted server that one
// environment is skipped and answers 503 when asked for, while the rest and the console run.
function buildAtStartup(slug) {
  try {
    return environmentFor(slug);
  } catch (err) {
    refusedAtStartup(err, { hosted: Boolean(BASE_DOMAIN) });
    const refusal = refusals.get(slug || DEFAULT_SLUG);
    if (refusal) refusal.logged = true; // refusedAtStartup has just logged it
    return null;
  }
}
if (!BASE_DOMAIN) {
  buildAtStartup(DEFAULT_SLUG); // the one environment, built eagerly, exactly as today
} else {
  for (const t of hostRegistry.listEnvironments()) buildAtStartup(t.slug); // every existing environment, built at startup
  // The host admin ADMIN_LOGIN and ADMIN_PASSWORD name (plan-names decision 7): made, or its password reset, on every
  // start, for recovery. Only that one login; any other host admin is left as it is. The password is written only when
  // it differs, so a restart with the same one signs nobody out.
  if (adminPassword) {
    const found = hostRegistry.findAdminByLogin(adminLogin);
    if (!found) {
      hostRegistry.addAdmin({ login: adminLogin, passwordHash: auth.hashPassword(adminPassword) });
      console.log(`Host admin "${adminLogin}" created from the environment.`);
    } else if (!auth.verifyPassword(adminPassword, found.passwordHash)) {
      hostRegistry.setAdminPasswordHash(found.key, auth.hashPassword(adminPassword));
      console.log(`Host admin "${adminLogin}" password reset from the environment.`);
    }
  }
}

// Every environment's own writes still owed to disk (chat, AI usage, saved places, the activity log -- each
// debounced, not synchronous like everything else under the seam).
function flushAllEnvironments() {
  for (const env of environments.values()) flushEnvironment(env);
}
process.on('exit', flushAllEnvironments);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));

// --- LiveKit ---------------------------------------------------------------

function livekitWsUrl(req) {
  return `${auth.isSecure(req) ? 'wss' : 'ws'}://${LIVEKIT_HOST}`;
}

function livekitApiUrl() {
  if (LIVEKIT_API_URL) return LIVEKIT_API_URL;
  const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(LIVEKIT_HOST);
  return `${local ? 'http' : 'https'}://${LIVEKIT_HOST}`;
}

const callService = new RoomServiceClient(livekitApiUrl(), LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

// `media` is whether they may send and receive the conference's audio and video
// (the "See and join the conference" permission); without it they still connect,
// for chat and the modules, and are online, but carry no media. `inCall` is
// whether they start in the conference: everyone else sees a person who is not
// in it as present in the space, with no tile. `call` is the call's name at the call service (callName).
async function mintToken({ identity, name, call, publisher, media = publisher, inCall = media }) {
  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity, name, ttl: publisher ? '24h' : '12h' });
  if (publisher) token.attributes = { call: media && inCall ? 'on' : 'off' };
  token.addGrant({
    room: call,
    roomJoin: true,
    canPublish: media,
    canSubscribe: publisher ? media : true,
    canPublishData: publisher,
    canUpdateOwnMetadata: publisher, // to say whether they are in the conference (the "call" attribute)
    hidden: !publisher, // OBS viewers do not show up in the call
  });
  return token.toJwt();
}

// A call's name at the call service, and the space a call belongs to (server/call-names.js, plan-names decision
// 14): worked out from the environment's slug and the space, never stored.
function callName(spaceId) {
  const id = spaceId || LOBBY;
  return callNames.callName({ slug: currentEnvironment().slug, spaceId: id, aside: Boolean(store.spaceById(id)?.ephemeral) });
}
function spaceIdOfCall(name) {
  return callNames.spaceIdOfCall(name, {
    slug: currentEnvironment().slug,
    hasSpace: (id) => Boolean(store.spaceById(id)),
    slugs: () => (hostRegistry ? hostRegistry.listEnvironments().map((e) => e.slug) : []),
  });
}

// Who is in a call right now, in whichever space, straight from LiveKit. `call` is the call's own name, for sending
// to it (it may be a name from before the upgrade); it is never sent in an answer (see withoutCall).
async function participants() {
  try {
    const active = await callService.listRooms();
    const out = [];
    for (const lk of active) {
      const spaceId = spaceIdOfCall(lk.name);
      if (!spaceId) continue;
      const list = await callService.listParticipants(lk.name).catch(() => []);
      for (const p of list) {
        if (p.permission?.hidden) continue;
        const tracks = p.tracks || [];
        const mic = tracks.find((t) => t.source === 2 /* MICROPHONE */);
        const cam = tracks.find((t) => t.source === 1 /* CAMERA */);
        out.push({
          key: p.identity,
          name: p.name,
          space: spaceId,
          call: lk.name,
          joinedAt: Number(p.joinedAt || 0),
          inCall: p.attributes?.call !== 'off',
          micOn: !!mic && !mic.muted,
          cameraOn: !!cam && !cam.muted,
        });
      }
    }
    return out;
  } catch (err) {
    return [];
  }
}

// A participant as an answer sends it: everything but the call's own name.
function withoutCall(p) {
  if (!p) return null;
  const { call, ...rest } = p;
  return rest;
}

// The call a user is in right now (its real name at the call service), or null.
async function callOf(key) {
  const p = (await participants()).find((x) => x.key === key);
  return p ? p.call : null;
}

// The space the stream currently hears: the first online owner's space (the
// host admin's stand-in counts as one), or the Lobby if no owner is in a call.
// With the usual single GM this is exactly "wherever the GM is"; with more
// than one online owner, whichever is earliest in the user list wins.
function activeSpaceId(online) {
  for (const u of store.users) {
    if (!hasOwnerRights(u)) continue;
    const p = online.get(u.key);
    if (p) return followableSpaceId(p.space);
  }
  return LOBBY;
}

// A private aside is off the record entirely -- the stream should keep
// hearing wherever the admin was a moment ago, not cut away to (or hide
// behind) an aside Studio is told to treat as not-recording. Walk back to the
// nearest non-private ancestor, normally just the one `origin` hop.
function followableSpaceId(spaceId) {
  const space = store.spaceById(spaceId);
  if (space?.private && space.origin) return followableSpaceId(space.origin);
  return spaceId;
}

// Whether activeSpace actually means anything right now: with no owner
// online there's no "wherever the GM is" to compare against, and view.js's
// aside dim treatment needs to know that rather than reading activeSpace's
// Lobby fallback as a real space everyone else is suddenly "aside" from.
function hasOnlineOwner(online) {
  return store.users.some((u) => hasOwnerRights(u) && online.has(u.key));
}

// --- helpers ---------------------------------------------------------------

function baseUrl(req) {
  return `${auth.isSecure(req) ? 'https' : 'http'}://${req.get('x-forwarded-host') || req.get('host')}`;
}

function currentUser(req) {
  if (req._user !== undefined) return req._user;
  req._user = auth.readSession(store.sessionSecret, auth.sessionToken(req), (key) => store.userByKey(key));
  return req._user;
}

// A hint, not a session: on a real sign-in at this environment (never the host admin's own), remembers which
// slugs this browser has used, most recent first, so the product page's own Sign in can offer them back without
// the host ever learning who anyone is (see "Sign in from the product page" in plan-tenants.md). Only set with a
// base domain; never cleared on sign-out, since it names no person, just a short list of addresses.
function setEnvHint(req, res) {
  if (!BASE_DOMAIN) return;
  const env = currentEnvironment();
  if (!env.slug) return;
  const existing = (auth.parseCookies(req.get('cookie')).env_hint || '').split(',').map((s) => s.trim()).filter(Boolean);
  const slugs = [env.slug, ...existing.filter((s) => s !== env.slug)].slice(0, 5);
  res.cookie('env_hint', slugs.join(','), { domain: BASE_DOMAIN, path: '/', sameSite: 'lax', secure: auth.isSecure(req), maxAge: 365 * 86400000, httpOnly: false });
}

// A login and password checked against this environment's own users first, same as always; when that fails and
// there is a host registry, checked against the host admins there too -- the person running the whole deployment
// should be able to sign into any one of them. A match against the registry never touches that user's password
// inside the environment: it only ensures a user record exists for that login (hostAdmin: true, passwordHash
// always null, so nothing here can ever authenticate as it directly -- see PATCH /api/users/:key's refusal), so
// the check always goes back to the registry, every time. Never applied when a *different*, ordinary user
// already owns that login here: a name collision just means the host admin cannot sign in with that particular
// login at this one environment, never that they take over someone else's account.
function resolveLoginUser(login, password) {
  const user = store.userByLogin(login);
  if (user && user.passwordHash && auth.verifyPassword(password, user.passwordHash)) return user;
  if (!hostRegistry || (user && !user.hostAdmin)) return null;
  const admin = hostRegistry.findAdminByLogin(login);
  if (!admin || !auth.verifyPassword(password, admin.passwordHash)) return null;
  return user || store.addUser({ login, displayName: login, role: 'admin', passwordHash: null, hostAdmin: true });
}

// --- two-step sign-in (documentation/plans/plan-mfa.md) -----------------------------------------------------

// The key that encrypts every TOTP secret at rest: the host's own, shared across every environment, on a host with
// environments (host.json's secretsKey -- an owner's export or the console's backup never carries host.json
// at all); a single file beside the store on a self-hosted install (there is no host.json), made on first use.
// Cached after the first call -- neither source ever changes once the server is up.
let _secretsKeyBuf = null;
function secretsKeyBuf() {
  if (_secretsKeyBuf) return _secretsKeyBuf;
  if (hostRegistry) {
    _secretsKeyBuf = Buffer.from(hostRegistry.secretsKey, 'hex');
    return _secretsKeyBuf;
  }
  const file = path.join(DATA_DIR, 'secrets.key');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  _secretsKeyBuf = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
  return _secretsKeyBuf;
}

// Whether the lockout bypass (ADMIN_MFA_LOCKOUT_BYPASS) applies to this particular person: an environment's own
// owner, or a single-environment install's admin (the account ADMIN_LOGIN names, which the bypass exists to let back
// in) -- never the host admin's own cross sign-in stand-in, which has no real factor of its own to be locked out of
// (documentation/plans/plan-mfa.md, "Regaining access").
function mfaBypassApplies(user) {
  return adminMfaLockoutBypass && (user.role === 'owner' || (user.role === 'admin' && !user.hostAdmin));
}

// Whether the environment's policy requires this particular person to have a second factor: settings.mfaRequired,
// a plain on/off, unless the whole feature is not offered or the lockout bypass excuses this person from it. The
// host admin's own cross sign-in user is never required here -- their own factor lives at the host console,
// under HOST_MFA_REQUIRED, a separate account entirely.
function mfaPolicyRequires(user) {
  if (!mfaOffered || user.hostAdmin || mfaBypassApplies(user)) return false;
  return Boolean(store.settings.mfaRequired);
}

// The pending step: called right after the first factor succeeds, before any session is issued. Returns null
// when nothing more is owed (the feature is not offered at all, the host admin's own cross sign-in, the
// lockout bypass excusing an admin from both the step and the enrol requirement, no factor and the policy
// does not require one, or a valid mfa_trust cookie for this exact person -- readSession's own stamp check
// already busts it on a reset or a fresh enrolment, since userStamp folds in mfa.version); otherwise
// { enrol, pending } for the caller to answer or redirect with instead of a session.
function mfaGate(req, user) {
  if (!mfaOffered || user.hostAdmin || mfaBypassApplies(user)) return null;
  const enrolled = Boolean(user.mfa);
  if (!enrolled && !store.settings.mfaRequired) return null;
  const trust = auth.readSession(store.sessionSecret, auth.sessionToken(req, auth.TRUST_COOKIE), (key) => (key === user.key ? user : null));
  if (trust) return null;
  const purpose = enrolled ? 'verify' : 'enrol';
  return { enrol: !enrolled, pending: auth.issuePending(store.sessionSecret, { userKey: user.key, env: currentEnvironment().slug || '', purpose }) };
}

// Who is enrolling: the signed-in person, or -- with no session yet -- whoever holds a valid 'enrol' pending
// token (a required account with no factor lands here straight from the first factor, with nothing else to
// prove who they are). Null when neither is true.
function mfaSubject(req) {
  const user = currentUser(req);
  if (user) return user;
  const token = req.body?.pending || auth.parseCookies(req.get('cookie'))[auth.PENDING_COOKIE] || null;
  const pend = token && auth.readPending(store.sessionSecret, token, { env: currentEnvironment().slug || '', purpose: 'enrol' });
  return pend ? store.userByKey(pend.u) : null;
}

// Every enrolment and reset route refuses outright while the feature is turned off server-wide: enrolments
// already made are kept either way, nothing here deletes anything (documentation/plans/plan-mfa.md).
function requireMfaOffered(req, res, next) {
  if (!mfaOffered) return res.status(403).json({ error: 'two-step sign-in is not offered on this server' });
  next();
}

// Checks a code against this person's own factor: a TOTP code (recording the step used, so it cannot be
// replayed) or a recovery code (spending it, which bumps mfa.version and so signs out every other session and
// trusted browser -- using one means the normal device is unavailable, a security-relevant event in its own
// right). `onStep`/`onRecovery` persist the outcome; this function only decides whether the code is good.
function verifyMfaCode(mfa, code, { onStep, onRecovery }) {
  if (!mfa) return false;
  const plain = auth.decryptSecret(mfa.secret, secretsKeyBuf());
  const step = plain ? auth.totpVerify(plain, code, mfa.lastStep) : null;
  if (step !== null && step !== undefined) {
    onStep(step);
    return true;
  }
  const hash = mfa.recovery.find((h) => auth.verifyPassword(String(code || '').trim(), h));
  if (hash) {
    onRecovery(hash);
    return true;
  }
  return false;
}

function hasStreamKey(req) {
  const given = String(req.query.s || req.get('x-stream-key') || '');
  const wanted = store.streamKey;
  return given.length === wanted.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(wanted));
}

// An owner, or the host admin signed in through the stand-in: every right in this environment.
function isOwner(req) {
  return hasOwnerRights(currentUser(req));
}

// Stream access: an owner's session or the stream key (OBS, the Studio app).
function hasStreamAccess(req) {
  return isOwner(req) || hasStreamKey(req);
}

// A guest's own reads (the presence roster, everyone's pictures): any request
// carrying a space's current guest token, on top of a real session or the
// stream key. Not scoped to that one space -- same broad-but-low-stakes
// trust as the stream key above, and lets a guest see the call they're
// actually in without an account to check space membership against.
function hasGuestAccess(req) {
  const token = req.query.guest;
  return typeof token === 'string' && !!store.spaceByGuestToken(token);
}

function requireUser(req, res, next) {
  if (!currentUser(req)) return res.status(401).json({ error: 'sign in first' });
  next();
}

function requireOwner(req, res, next) {
  if (!currentUser(req)) return res.status(401).json({ error: 'sign in first' });
  if (!isOwner(req)) return res.status(403).json({ error: 'owners only' });
  next();
}

function requireStream(req, res, next) {
  if (!hasStreamAccess(req)) return res.status(403).json({ error: 'stream key required' });
  next();
}

function publicUser(req, u) {
  // Every space this person actually belongs to right now (never the Lobby --
  // per-space images are for the spaces an owner picked them into, not the
  // one everyone is always in), each with which of their own images override
  // the defaults there.
  const spaces = {};
  for (const space of store.spaces) {
    if (space.isLobby || !space.members.includes(u.key)) continue;
    spaces[space.id] = {
      images: Object.fromEntries(SLOTS.map((slot) => [slot, !!u.spaces[space.id]?.images?.[slot]])),
      useDefaultImages: u.spaces[space.id]?.useDefaultImages !== false,
      permissions: store.spaceFlags(u.key, space.id), // the stored ticks, for the profile page
      effective: store.spacePermissions(u.key, space.id), // what they can actually do there
    };
  }
  return {
    key: u.key,
    login: u.login,
    displayName: u.displayName,
    role: u.role,
    hostAdmin: u.hostAdmin, // signs in through the host console, not a password of its own -- see resolveLoginUser
    hasPassword: !!u.passwordHash,
    mfaEnrolled: Boolean(u.mfa), // the only mfa field a person other than the account itself ever sees
    link: u.linkToken ? `${baseUrl(req)}/j/${u.linkToken}` : null,
    images: Object.fromEntries(SLOTS.map((slot) => [slot, !!u.images[slot]])),
    spaces,
    permissions: store.spacePermissions(u.key, null), // their role's, outside any one space
    player: { ...u.player, effective: store.effectivePlayer(u) },
    callPrefs: u.callPrefs,
    viewUrl: `${baseUrl(req)}/view/${u.key}`,
    createdAt: u.createdAt,
  };
}

// What the call and the view pages need about everyone: name and the
// talking colour, so tiles and frames match.
function presenceUser(u) {
  const p = store.effectivePlayer(u);
  return { key: u.key, displayName: u.displayName, isOwner: hasOwnerRights(u), border: p.border, borderColor: p.borderColor, borderWidth: p.borderWidth, mutedBorder: p.mutedBorder, mutedColor: p.mutedColor, plate: p.plate, plateLayout: p.plateLayout, plateColor: p.plateColor, plateTextColor: p.plateTextColor, plateFontSize: p.plateFontSize, plateOpacity: p.plateOpacity, plateTextCase: p.plateTextCase, charBorder: p.charBorder, charBorderColor: p.charBorderColor, charMutedBorder: p.charMutedBorder, charMutedColor: p.charMutedColor, charBorderWidth: p.charBorderWidth, pictureBackground: p.pictureBackground, pictureColor: p.pictureColor, pictureScale: p.pictureScale, images: Object.fromEntries(SLOTS.map((slot) => [slot, !!u.images[slot]])) };
}

function branding() {
  const s = store.settings;
  return { environmentName: s.environmentName, hosted: Boolean(BASE_DOMAIN), homeIcon: s.homeIcon || 'couch', loginText: s.loginText, language: s.language || 'en', clock: s.clock === '24' ? '24' : '12', currency: s.currency || 'USD', allowRegistration: Boolean(s.allowRegistration), mfaOffered, mfaRequired: Boolean(s.mfaRequired), maxQuality: s.maxQuality || 720, allowScreenShare: s.allowScreenShare !== false, allowAsides: s.allowAsides !== false, allowPrivate: s.allowPrivate !== false, allowReactions: s.allowReactions !== false, conferenceEnabled: s.conferenceEnabled !== false, activeThemeId: s.activeThemeId || null, hasIcon: !!store.iconPath(), hasBackground: !!store.siteImagePath('background'), version: VERSION, border: s.border, borderColor: s.borderColor, borderWidth: s.borderWidth || 6, mutedBorder: s.mutedBorder !== false, mutedColor: s.mutedColor || '#b8503f', plate: Boolean(s.plate), plateLayout: s.plateLayout || 'lower-left', plateColor: s.plateColor || '#000000', plateTextColor: s.plateTextColor || '#f1e6d8', plateFontSize: s.plateFontSize || 16, plateOpacity: s.plateOpacity ?? 60, plateTextCase: s.plateTextCase || 'default', charBorder: Boolean(s.charBorder), charBorderColor: s.charBorderColor || '#6fae6b', charMutedBorder: Boolean(s.charMutedBorder), charMutedColor: s.charMutedColor || '#b8503f', charBorderWidth: s.charBorderWidth || 6, pictureBackground: Boolean(s.pictureBackground), pictureColor: s.pictureColor || '#1a1410', pictureScale: s.pictureScale || 100, offlineDim: s.offlineDim ?? 0, offlineTint: s.offlineTint || '#000000', offlineTintOpacity: s.offlineTintOpacity ?? 0, asideDim: s.asideDim ?? 0, asideTint: s.asideTint || '#000000', asideTintOpacity: s.asideTintOpacity ?? 0, privateDim: s.privateDim ?? 0, privateTint: s.privateTint || '#000000', privateTintOpacity: s.privateTintOpacity ?? 0, reactions: Array.isArray(s.reactions) ? s.reactions : [], icons: Array.isArray(s.icons) ? s.icons : [], guestImages: Object.fromEntries(PARTICIPANT_SLOTS.map((slot) => [slot, !!store.guestImagePath(slot)])), defaultImages: Object.fromEntries(PARTICIPANT_SLOTS.map((slot) => [slot, !!store.defaultImagePath(slot)])) };
}

function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  const text = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] || '?').slice(0, 2);
  return text.toUpperCase();
}

function escapeXml(text) {
  return String(text).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]);
}

function initialsSvg(name) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">` +
    `<rect width="400" height="400" rx="24" fill="#241c16"/>` +
    `<text x="200" y="200" text-anchor="middle" dominant-baseline="central" font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="140" font-weight="700" fill="#c8873a">${escapeXml(initials(name))}</text>` +
    `</svg>`;
}

function sendImage(res, file) {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(file);
}

// The generic guest picture, when the admin hasn't set one -- a person
// glyph rather than initials, since a guest tile has no name to draw from
// server-side (that only lives in the LiveKit token, not in our data).
function guestSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">` +
    `<rect width="400" height="400" rx="24" fill="#241c16"/>` +
    `<circle cx="200" cy="155" r="70" fill="#c8873a"/>` +
    `<path d="M60 360c0-90 63-150 140-150s140 60 140 150" fill="#c8873a"/>` +
    `</svg>`;
}

// --- app -------------------------------------------------------------------

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
// verify stashes the exact bytes received, alongside the parsed req.body -- the billing webhook's signature
// (plan-tenants.md, "Phase 5") is an HMAC over those bytes, not a re-serialization of the parsed object, which
// would not reliably reproduce what the sender actually signed (key order, whitespace).
app.use(express.json({ limit: '64kb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

const publicDir = path.join(__dirname, '..', 'public');
const clientDist = path.join(__dirname, '..', 'node_modules', 'livekit-client', 'dist');
const page = (name) => path.join(publicDir, name);
const rawZip = express.raw({ type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'], limit: MODULE_LIMITS.zipBytes + 1024 });
const rawImage = express.raw({ type: Object.keys(IMAGE_TYPES), limit: MAX_IMAGE_BYTES + 1024 });

// --- the host console and its API (documentation/plans/plan-tenants.md) ----------------------------------------
// A separate mini-app, reached only at admin.<base>: never mounted on the main app directly, so a request routed
// here can never fall through to an environment's own routes below (which need an environment resolved, and none is,
// for the host admin -- see requireHostAdmin, its own session, auth.HOST_COOKIE, never an environment's).
const hostRouter = express.Router();
const hostLimiter = new auth.LoginLimiter();

function currentHostAdmin(req) {
  if (req._hostAdmin !== undefined) return req._hostAdmin;
  req._hostAdmin = hostRegistry ? auth.readSession(hostRegistry.sessionSecret, auth.sessionToken(req, auth.HOST_COOKIE), (key) => hostRegistry.findAdminByKey(key)) : null;
  return req._hostAdmin;
}
function requireHostAdmin(req, res, next) {
  if (!currentHostAdmin(req)) return res.status(401).json({ error: 'sign in first' });
  next();
}
function sendHostError(err, res) {
  if (err instanceof HostError) return res.status(err.status).json({ error: err.message });
  throw err;
}

hostRouter.use(express.static(publicDir, { index: false }));
hostRouter.get('/', (_req, res) => res.sendFile(page('host.html')));

// The host admins' own second step (documentation/plans/plan-mfa.md): HOST_MFA_REQUIRED makes it mandatory,
// same shape as an environment's own gate but keyed on hostRegistry's session secret and its own admin records,
// never an environment's -- 'host' is a reserved slug (see RESERVED_SLUGS), so it can never collide with a real
// environment's own pending tokens even though the cookie names are shared. Every host admin is eligible for
// the lockout bypass (there is no separate role to check, unlike an environment's own admins).
function hostMfaGate(req, admin) {
  if (!mfaOffered || adminMfaLockoutBypass) return null;
  const enrolled = Boolean(admin.mfa);
  if (!enrolled && !hostMfaRequired) return null;
  const trust = auth.readSession(hostRegistry.sessionSecret, auth.sessionToken(req, auth.TRUST_COOKIE), (key) => (key === admin.key ? admin : null));
  if (trust) return null;
  const purpose = enrolled ? 'verify' : 'enrol';
  return { enrol: !enrolled, pending: auth.issuePending(hostRegistry.sessionSecret, { userKey: admin.key, env: 'host', purpose }) };
}
function hostMfaSubject(req) {
  const admin = currentHostAdmin(req);
  if (admin) return admin;
  const token = req.body?.pending || auth.parseCookies(req.get('cookie'))[auth.PENDING_COOKIE] || null;
  const pend = token && auth.readPending(hostRegistry.sessionSecret, token, { env: 'host', purpose: 'enrol' });
  return pend ? hostRegistry.findAdminByKey(pend.u) : null;
}
hostRouter.post('/api/host/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (hostLimiter.blocked(ip)) return res.status(429).json({ error: 'too many attempts, try again in a few minutes' });
  const found = hostRegistry.findAdminByLogin(req.body?.login);
  const ok = found && auth.verifyPassword(req.body?.password || '', found.passwordHash);
  if (!ok) { hostLimiter.fail(ip); return res.status(401).json({ error: 'wrong username or password' }); }
  hostLimiter.clear(ip);
  const gate = hostMfaGate(req, found);
  if (gate) {
    auth.setPendingCookie(req, res, gate.pending);
    return res.json({ mfaRequired: true, enrol: gate.enrol, pending: gate.pending });
  }
  const token = auth.issueSession(hostRegistry.sessionSecret, found);
  auth.setSessionCookie(req, res, token, auth.HOST_COOKIE);
  res.json({ admin: { key: found.key, login: found.login } });
});
hostRouter.post('/api/host/login/verify', (req, res) => {
  const ip = req.ip || 'unknown';
  if (hostLimiter.blocked(ip)) return res.status(429).json({ error: 'too many attempts, try again in a few minutes' });
  const pendingToken = req.body?.pending || auth.parseCookies(req.get('cookie'))[auth.PENDING_COOKIE] || null;
  const pend = pendingToken && auth.readPending(hostRegistry.sessionSecret, pendingToken, { env: 'host', purpose: 'verify' });
  const admin = pend && hostRegistry.findAdminByKey(pend.u);
  if (!admin || !admin.mfa) { hostLimiter.fail(ip); return res.status(401).json({ error: 'sign in again' }); }
  const ok = verifyMfaCode(admin.mfa, req.body?.code, {
    onStep: (step) => hostRegistry.hostAdminMfaRecordStep(admin.key, step),
    onRecovery: (hash) => hostRegistry.hostAdminMfaSpendRecovery(admin.key, hash),
  });
  if (!ok) { hostLimiter.fail(ip); return res.status(401).json({ error: 'wrong code' }); }
  hostLimiter.clear(ip);
  const fresh = hostRegistry.findAdminByKey(admin.key);
  const token = auth.issueSession(hostRegistry.sessionSecret, fresh);
  auth.setSessionCookie(req, res, token, auth.HOST_COOKIE);
  auth.clearSessionCookie(req, res, auth.PENDING_COOKIE);
  if (req.body?.remember) auth.setSessionCookie(req, res, auth.issueSession(hostRegistry.sessionSecret, fresh), auth.TRUST_COOKIE);
  res.json({ admin: { key: fresh.key, login: fresh.login } });
});
hostRouter.post('/api/host/logout', (req, res) => { auth.clearSessionCookie(req, res, auth.HOST_COOKIE); res.json({ ok: true }); });
hostRouter.get('/api/host/me', (req, res) => {
  const found = currentHostAdmin(req);
  if (!found) return res.status(401).json({ error: 'sign in first' });
  res.json({ admin: { key: found.key, login: found.login }, mfaEnrolled: Boolean(found.mfa), mfaRequired: mfaOffered && !adminMfaLockoutBypass && !found.mfa && hostMfaRequired, mfaOffered, mfaBypass: adminMfaLockoutBypass });
});
hostRouter.post('/api/host/me/mfa/start', requireMfaOffered, async (req, res) => {
  const admin = hostMfaSubject(req);
  if (!admin) return res.status(401).json({ error: 'sign in first' });
  const secret = auth.totpSecret();
  hostRegistry.hostAdminMfaStart(admin.key, auth.encryptSecret(secret, secretsKeyBuf()));
  const otpauth = auth.otpauthUrl(PRODUCT_NAME, admin.login, secret);
  const qr = await QRCode.toString(otpauth, { type: 'svg' });
  res.json({ otpauth, qr, secret });
});
hostRouter.post('/api/host/me/mfa/enable', requireMfaOffered, (req, res) => {
  const admin = hostMfaSubject(req);
  if (!admin) return res.status(401).json({ error: 'sign in first' });
  const pending = admin.mfa?.pending;
  if (!pending || Date.now() - new Date(pending.startedAt).getTime() > 3600000) return res.status(400).json({ error: 'start enrolment again' });
  const plain = auth.decryptSecret(pending.secret, secretsKeyBuf());
  const step = plain ? auth.totpVerify(plain, req.body?.code) : null;
  if (step === null || step === undefined) return res.status(401).json({ error: 'wrong code' });
  const recoveryCodes = auth.recoveryCodes();
  hostRegistry.hostAdminMfaEnable(admin.key, recoveryCodes.map((c) => auth.hashPassword(c)));
  hostRegistry.hostAdminMfaRecordStep(admin.key, step);
  const fresh = hostRegistry.findAdminByKey(admin.key);
  // Same reissue as /api/me/mfa/enable, and for the same reason: enabling bumps mfa.version, changing this
  // admin's own userStamp, which would otherwise silently sign an already-signed-in caller out of the very
  // enrolment they just finished.
  const token = auth.issueSession(hostRegistry.sessionSecret, fresh);
  auth.setSessionCookie(req, res, token, auth.HOST_COOKIE);
  auth.clearSessionCookie(req, res, auth.PENDING_COOKIE);
  const out = { recoveryCodes, admin: { key: fresh.key, login: fresh.login }, token };
  res.json(out);
});
hostRouter.post('/api/host/me/mfa/disable', requireMfaOffered, requireHostAdmin, (req, res) => {
  const admin = currentHostAdmin(req);
  if (!admin.mfa) return res.status(400).json({ error: 'no second factor to disable' });
  if (hostMfaRequired && !adminMfaLockoutBypass) return res.status(403).json({ error: 'this deployment requires a second factor for host admins' });
  const ok = verifyMfaCode(admin.mfa, req.body?.code, { onStep: () => {}, onRecovery: () => {} });
  if (!ok) return res.status(401).json({ error: 'wrong code' });
  hostRegistry.hostAdminMfaDisable(admin.key);
  // Same reissue as /api/me/mfa/disable, and for the same reason.
  const token = auth.issueSession(hostRegistry.sessionSecret, hostRegistry.findAdminByKey(admin.key));
  auth.setSessionCookie(req, res, token, auth.HOST_COOKIE);
  res.json({ ok: true, token });
});
// The lockout bypass's own way back in for a host admin: no code, just the account's own password (mirrors
// POST /api/me/mfa/reset).
hostRouter.post('/api/host/me/mfa/reset', requireMfaOffered, requireHostAdmin, (req, res) => {
  const admin = currentHostAdmin(req);
  if (!adminMfaLockoutBypass) return res.status(403).json({ error: 'the lockout bypass (ADMIN_MFA_LOCKOUT_BYPASS) is not turned on' });
  if (!auth.verifyPassword(req.body?.password || '', admin.passwordHash)) return res.status(401).json({ error: 'wrong password' });
  hostRegistry.hostAdminMfaDisable(admin.key);
  const token = auth.issueSession(hostRegistry.sessionSecret, hostRegistry.findAdminByKey(admin.key));
  auth.setSessionCookie(req, res, token, auth.HOST_COOKIE);
  res.json({ ok: true, token });
});
// A host admin resets an owner's factor from the console -- by login, never a key, since the console never
// learns an environment's own user keys (a peer session's amendment to the contract).
hostRouter.delete('/api/host/environments/:slug/owners/:login/mfa', requireHostAdmin, (req, res) => {
  if (!hostRegistry.findEnvironment(req.params.slug)) return res.status(404).json({ error: 'no such environment' });
  const env = environmentFor(req.params.slug);
  const owner = env.store.userByLogin(req.params.login);
  if (!owner || owner.role !== 'owner') return res.status(404).json({ error: 'no owner with that login there' });
  env.store.mfaDisable(owner.key);
  res.json({ ok: true });
});

// What an environment is using, from its own already-built services (building them if it is not running yet -- an
// admin looking at the list is reason enough to have it up). Storage isn't walked here (a real figure needs
// reading the whole directory); left null until that is worth the cost.
function environmentUsage(slug) {
  let env;
  try {
    env = environmentFor(slug);
  } catch (err) {
    // An environment refused by the Names migration (server/migrate-names.js) still lists, with nothing to count,
    // so the console stays usable to back it up or restore it.
    if (!(err instanceof MigrationError)) throw err;
    logRefusalOnce(slug);
    return { members: null, storageBytes: null, aiCallsThisMonth: null, spaces: null };
  }
  return { members: env.store.users.length, storageBytes: null, aiCallsThisMonth: env.ai.usageView?.().callsThisMonth ?? null, spaces: env.store.spaces.length };
}
hostRouter.get('/api/host/environments', requireHostAdmin, (_req, res) => {
  // `refused`: null, or why this environment is not opening (see refusalView), for the console to show.
  res.json({ environments: hostRegistry.listEnvironments().map((t) => { const usage = environmentUsage(t.slug); return { ...t, usage, refused: refusalView(t.slug) }; }) });
});
hostRouter.post('/api/host/environments', requireHostAdmin, (req, res) => {
  try {
    const environment = hostRegistry.addEnvironment({ slug: req.body?.slug, name: req.body?.name, plan: req.body?.plan });
    const env = environmentFor(environment.slug); // the fresh directory and its services, built now
    const owner = req.body?.owner;
    if (owner?.login && owner?.password) env.store.addUser({ login: owner.login, displayName: owner.displayName || owner.login, role: 'owner', passwordHash: auth.hashPassword(owner.password) });
    res.status(201).json({ environment });
  } catch (err) {
    sendHostError(err, res);
  }
});
hostRouter.patch('/api/host/environments/:slug', requireHostAdmin, (req, res) => {
  try {
    res.json({ environment: hostRegistry.updateEnvironment(req.params.slug, req.body || {}) });
  } catch (err) {
    sendHostError(err, res);
  }
});
hostRouter.delete('/api/host/environments/:slug', requireHostAdmin, (req, res) => {
  try {
    if (!hostRegistry.findEnvironment(req.params.slug)) throw new HostError('no such environment', 404);
    hostRegistry.removeEnvironment(req.params.slug);
    const env = environments.get(req.params.slug);
    if (env) { flushEnvironment(env); environments.delete(req.params.slug); }
    const from = path.join(DATA_DIR, 'environments', req.params.slug);
    if (fs.existsSync(from)) {
      const to = path.join(DATA_DIR, 'environments-deleted', `${req.params.slug}-${Date.now()}`);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from, to);
    }
    res.json({ ok: true });
  } catch (err) {
    sendHostError(err, res);
  }
});

// An environment's whole directory, walked into [name, bytes] pairs for zipFiles (server/module-build.js), or read back
// out of a zip on restore (a general-purpose reader, not modules.js's own readZip -- an environment's own data is
// whatever shape it is, not the narrow set of file types a module's zip is allowed).
function walkFiles(dir, base = dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walkFiles(full, base, out);
    else if (st.isFile()) out.push([path.relative(base, full).split(path.sep).join('/'), fs.readFileSync(full)]);
  }
  return out;
}
// Total bytes in a directory tree, without reading any file's contents -- walkFiles reads every file (for
// zipping) and would be wasteful just to measure an environment's own storage use (plan-tenants.md, "Phase 3").
function dirSize(dir) {
  let total = 0;
  let names;
  try { names = fs.readdirSync(dir); } catch { return 0; }
  for (const name of names) {
    const full = path.join(dir, name);
    let st;
    try { st = fs.statSync(full); } catch { continue; } // a broken link, or gone between readdir and stat
    if (st.isDirectory()) total += dirSize(full);
    else if (st.isFile()) total += st.size;
  }
  return total;
}
const STORAGE_MEASURE_MS = 60000;
// An environment's storage use, remeasured at most once a minute and cached on the registry entry
// (HostRegistry.recordStorageUsage) so a page reading it often (the Environment panel, the console's environment
// list) never pays for a fresh directory walk itself.
function environmentStorageBytes(slug, dataDir) {
  const cached = hostRegistry.findEnvironment(slug)?.usage;
  if (cached?.measuredAt && Date.now() - new Date(cached.measuredAt).getTime() < STORAGE_MEASURE_MS) return cached.storageBytes;
  const bytes = dirSize(dataDir);
  hostRegistry.recordStorageUsage(slug, bytes);
  return bytes;
}
// How many of this environment's own spaces have a live call right now (someone actually in it, not just
// created), asked from LiveKit directly -- never cached, so a call ending frees the slot at once. Used by
// /api/environment's usage.callsNow and, at join time, the calls cap itself (plan-tenants.md, "Phase 4").
// spaceIdOfCall already scopes to the current environment's own calls (null for anything else).
async function liveCallCount() {
  try {
    const active = await callService.listRooms();
    return active.filter((lk) => spaceIdOfCall(lk.name) && lk.numParticipants > 0).length;
  } catch {
    return 0;
  }
}

// --- plan caps (plan-tenants.md, "Phase 3: the caps, enforced at the seam") --------------------------------
// A cap is null for none. Self-hosted (no BASE_DOMAIN, or a slug the registry somehow has no environment for) is
// nobody's environment, so it is never capped -- every planCap() reads null there, same as an uncapped plan.
function planCap(name) {
  if (!BASE_DOMAIN || !hostRegistry) return null;
  const environment = hostRegistry.findEnvironment(currentEnvironment().slug);
  return environment ? environment.plan[name] : null;
}
function gbText(bytes) {
  const gb = bytes / (1024 ** 3);
  return (Number.isInteger(gb) ? gb : Math.round(gb * 10) / 10).toString();
}
// Each refuses the one thing at its cap with a 403 and a plain sentence, leaving everything else running;
// returns true (having already answered) when refused, so a caller just does `if (refuseX(res)) return;`.
function refuseOverMembers(res) {
  const cap = planCap('members');
  if (cap === null || store.users.length < cap) return false;
  res.status(403).json({ error: `This environment is at its limit of ${cap} members.` });
  return true;
}
function refuseOverStorage(res) {
  const cap = planCap('storageBytes');
  if (cap === null) return false;
  const env = currentEnvironment();
  if (environmentStorageBytes(env.slug, env.dataDir) < cap) return false;
  res.status(403).json({ error: `This environment has used its ${gbText(cap)} GB of storage.` });
  return true;
}
// Middleware form of refuseOverStorage, for the routes that write bytes to disk (module uploads, profile and
// space pictures, site images) rather than checking it inline.
function checkStorageCap(req, res, next) {
  if (!refuseOverStorage(res)) next();
}
function refuseOverAiCalls(res) {
  const cap = planCap('aiCallsPerMonth');
  if (cap === null || hostRegistry.aiCallsThisMonth(currentEnvironment().slug) < cap) return false;
  res.status(403).json({ error: `This environment has used its ${cap} AI calls for this month.` });
  return true;
}
// 'all' (the default, and every self-hosted install) or a list of module ids. A module already on when a
// plan shrinks under it is untouched here -- this only gates turning one on, never keeps one already running.
function moduleAllowedByPlan(id) {
  const cap = planCap('modules');
  return cap === null || cap === 'all' || (Array.isArray(cap) && cap.includes(id));
}
function refuseModuleNotInPlan(res, id, name) {
  if (moduleAllowedByPlan(id)) return false;
  res.status(403).json({ error: `This environment's plan does not include ${name}.` });
  return true;
}
// The calls cap (plan-tenants.md, "Phase 4"): joining a room already in a call is never refused, so this only
// stops opening a *new* one once the plan's concurrent-call limit is already spent on other spaces. Asked at
// join time, in both the places that mint a real (publishing) token -- /api/token and guest-join alike, since
// a guest link would otherwise be an unmetered way around the same cap.
// `spaceId` is the space being joined: a call already running for it (under its name from before the upgrade too,
// for that one release) is joining, never opening.
async function refuseOverCalls(res, spaceId) {
  const cap = planCap('calls');
  if (cap === null) return false;
  let active;
  try {
    active = await callService.listRooms();
  } catch {
    return false; // can't ask LiveKit -- fail open, same as liveCallCount()
  }
  const live = active.filter((lk) => spaceIdOfCall(lk.name) && lk.numParticipants > 0);
  if (live.some((lk) => spaceIdOfCall(lk.name) === spaceId)) return false;
  if (live.length < cap) return false;
  const runningName = store.spaceById(spaceIdOfCall(live[0].name))?.name || 'another space';
  res.status(403).json({ error: `This environment's plan allows ${cap} call${cap === 1 ? '' : 's'} at once; one is running in ${runningName}` });
  return true;
}
function readEnvironmentZip(buffer) {
  return new Promise((resolve, reject) => {
    const MAX_FILES = 20000;
    const MAX_TOTAL = 500 * 1024 * 1024;
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(new Error("that isn't a readable zip file"));
      const files = [];
      let total = 0;
      const fail = (message) => { zip.close(); reject(new Error(message)); };
      zip.on('error', () => fail("that isn't a readable zip file"));
      zip.on('end', () => resolve(files));
      zip.on('entry', (entry) => {
        const name = entry.fileName;
        if (name.endsWith('/')) return zip.readEntry(); // a folder
        if (files.length >= MAX_FILES) return fail(`too many files (more than ${MAX_FILES})`);
        const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (mode === 0o120000) return fail('symbolic links are not allowed');
        total += entry.uncompressedSize;
        if (total > MAX_TOTAL) return fail(`the backup is larger than ${MAX_TOTAL / (1024 * 1024)} MB`);
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr) return fail("that isn't a readable zip file");
          const chunks = [];
          stream.on('data', (c) => chunks.push(c));
          stream.on('error', () => fail("that isn't a readable zip file"));
          stream.on('end', () => { files.push([name, Buffer.concat(chunks)]); zip.readEntry(); });
        });
      });
      zip.readEntry();
    });
  });
}
hostRouter.post('/api/host/environments/:slug/backup', requireHostAdmin, (req, res) => {
  if (!hostRegistry.findEnvironment(req.params.slug)) return res.status(404).json({ error: 'no such environment' });
  const env = environments.get(req.params.slug);
  if (env) flushEnvironment(env); // every debounced write is on disk before it is zipped
  const dir = path.join(DATA_DIR, 'environments', req.params.slug);
  const zip = zipFiles(fs.existsSync(dir) ? walkFiles(dir) : []);
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${req.params.slug}-backup.zip"` });
  res.send(zip);
});
const rawHostZip = express.raw({ type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'], limit: 500 * 1024 * 1024 });
hostRouter.post('/api/host/environments/:slug/restore', requireHostAdmin, rawHostZip, async (req, res) => {
  if (!hostRegistry.findEnvironment(req.params.slug)) return res.status(404).json({ error: 'no such environment' });
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'choose a zip file to restore' });
  try {
    const files = await readEnvironmentZip(req.body);
    // A backup whose data (app.json, or tavern.json when there is no app.json) cannot be read, or whose app.json (or
    // older tavern.json) records a Names migration part this server does not know (made by a newer Magpie), is
    // refused before anything is replaced. Checked on what would actually land: names as written to disk, the last
    // of any repeated entry.
    const refusal = backupRefusal(files);
    if (refusal) return res.status(400).json({ error: refusal });
    const env = environments.get(req.params.slug);
    if (env) { flushEnvironment(env); environments.delete(req.params.slug); } // rebuilt fresh from the restored files, next asked for
    const dir = path.join(DATA_DIR, 'environments', req.params.slug);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, data] of files) {
      const full = path.join(dir, name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, data);
    }
    // Built now, so the console (and the sign-in list) knows at once whether the restored data opens.
    refusals.delete(req.params.slug);
    try {
      environmentFor(req.params.slug);
    } catch (err) {
      if (!(err instanceof MigrationError)) throw err;
      logRefusalOnce(req.params.slug);
      return res.json({ ok: true, refused: refusalView(req.params.slug) });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || "that isn't a readable zip file" });
  }
});

hostRouter.get('/api/host/settings', requireHostAdmin, (_req, res) => {
  res.json({
    baseDomain: BASE_DOMAIN, version: VERSION, hostAdmins: hostRegistry.listAdmins(), productName: PRODUCT_NAME, contactEmail: CONTACT_EMAIL || null,
    plans: hostRegistry.plansCatalog(), signup: signupEnabled, billingSecretSet: Boolean(BILLING_SECRET),
  });
});
// The plan catalog (plan-tenants.md, "Phase 5"): the console's Plans panel edits a plan's name and its five caps;
// PUT replaces the whole catalog (the same shape GET's own `plans` field is), free always kept present regardless
// of what is sent.
hostRouter.put('/api/host/plans', requireHostAdmin, (req, res) => {
  res.json({ plans: hostRegistry.setPlansCatalog(req.body || {}) });
});
// Provider-agnostic billing webhook: a provider's own format is adapted into this shape outside the app (a
// small relay), which is what keeps every provider's own card handling out of it (plan-tenants.md, "Phase 5").
// No host-admin session -- the sender is never signed in here -- so this route sits outside requireHostAdmin
// entirely and authenticates by signature alone, over the exact bytes received (req.rawBody, see express.json's
// verify above), never a re-serialization of the parsed body.
hostRouter.post('/api/host/billing', (req, res) => {
  if (!BILLING_SECRET) return res.status(404).json({ error: 'not found' });
  const expected = crypto.createHmac('sha256', BILLING_SECRET).update(req.rawBody || Buffer.alloc(0)).digest('hex');
  const given = Buffer.from(String(req.get('x-billing-signature') || ''), 'hex');
  const wanted = Buffer.from(expected, 'hex');
  if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) return res.status(401).json({ error: 'bad signature' });
  try {
    const environment = hostRegistry.applyBillingEvent(String(req.body?.slug || ''), String(req.body?.plan || ''), String(req.body?.event || ''));
    res.json({ environment });
  } catch (err) {
    sendHostError(err, res);
  }
});

// The host's own managed AI service (documentation/plans/plan-tenants.md, "Managed AI, per company"), above
// every environment, one row per company: an environment chooses one of them (source "managed", a
// managedProvider) or "custom" (its own, see PUT /api/ai). A key never leaves the server, same as an
// environment's own never does.
hostRouter.get('/api/host/ai', requireHostAdmin, (_req, res) => {
  res.json({ services: hostAiServices() });
});
hostRouter.put('/api/host/ai', requireHostAdmin, (req, res) => {
  try {
    const provider = String(req.body?.provider || '');
    if (!MANAGED_PROVIDERS.includes(provider)) throw new AiError('choose openai, anthropic or compatible');
    hostRegistry.setManagedAi(provider, req.body || {});
    res.json({ services: hostAiServices() });
  } catch (err) {
    sendAiError(err, res);
  }
});
hostRouter.post('/api/host/ai/models', requireHostAdmin, async (req, res) => {
  try {
    const provider = String(req.body?.provider || '');
    const slot = managedSlot(provider);
    const key = (typeof req.body?.key === 'string' && req.body.key.trim()) || slot.envKey || slot.key;
    const workspace = typeof req.body?.workspace === 'string' ? req.body.workspace : slot.workspace;
    res.json({ models: await listModelsFor({ provider, address: req.body?.address ?? slot.address, key, workspace }) });
  } catch (err) {
    sendAiError(err, res);
  }
});

// The host's own shared file folders (documentation/plans/plan-tenants.md, "Shared files: the host's map"):
// every bundled module that declares one (Maps' map-tiles), whether or not it happens to be installed anywhere
// yet -- an admin manages the folder from here regardless. { module, name, folder, key } each.
function bundledSharedFolders() {
  const out = [];
  for (const m of bundledModules(BUNDLED_DIR)) {
    for (const d of m.settings || []) if ((d.type === 'file' || d.type === 'files') && d.shared === 'host') out.push({ module: m.id, name: m.name, folder: d.folder, key: d.key });
  }
  return out;
}
// One of those, from the request's own :module/:folder, or null (sending the 404 itself) when it names
// nothing real.
function sharedFolderSetup(req, res) {
  const found = bundledSharedFolders().find((f) => f.module === req.params.module && f.folder === req.params.folder);
  if (!found) { res.status(404).json({ error: 'no such shared folder' }); return null; }
  return found;
}
hostRouter.get('/api/host/shared', requireHostAdmin, (_req, res) => {
  const folders = bundledSharedFolders().map(({ module, name, folder }) => {
    const dir = path.resolve(DATA_DIR, 'shared', module, folder);
    const inspected = inspectDir(dir);
    return {
      module,
      name,
      folder,
      files: inspected.files.map((f) => ({ name: f, size: inspected.sizes[f], ...(inspected.zooms[f] ? { zoom: inspected.zooms[f] } : {}) })),
      address: hostRegistry.sharedFolderAddress(module, folder),
      exists: inspected.exists,
      cutting: Boolean(sharedRegionCutJobs.runningFor(module, 'environment')),
    };
  });
  res.json({ folders });
});
hostRouter.put('/api/host/shared/:module/:folder', requireHostAdmin, (req, res) => {
  const found = sharedFolderSetup(req, res);
  if (!found) return;
  try {
    res.json({ address: hostRegistry.setSharedFolderAddress(found.module, found.folder, req.body?.address).address });
  } catch (err) {
    sendHostError(err, res);
  }
});
hostRouter.delete('/api/host/shared/:module/:folder/files/:name', requireHostAdmin, (req, res) => {
  const found = sharedFolderSetup(req, res);
  if (!found) return;
  const name = req.params.name;
  if (!FILE_NAME_RE.test(name)) return res.status(404).json({ error: 'no such file' });
  const file = path.join(path.resolve(DATA_DIR, 'shared', found.module, found.folder), name);
  if (!inspectDir(path.dirname(file)).files.includes(name)) return res.status(404).json({ error: 'no such file' });
  try {
    fs.unlinkSync(file);
  } catch (err) {
    return res.status(500).json({ error: `the file could not be removed: ${err.message}` });
  }
  res.json({ ok: true });
});

// The place search a host-level "Add a region" find needs, since the host holds no geocoder of its own: the
// first enabled module across every environment that has one configured (Places, typically), each checked
// inside its own envContext.run so moduleSettings and modules resolve to that one environment, the same as a
// request to it would -- admin.<base> never otherwise resolves one.
async function findRegionBoxAcrossEnvironments(q) {
  // Every real environment, never DEFAULT_SLUG -- this route only ever runs with BASE_DOMAIN set, where the default
  // (root DATA_DIR) environment is not a real one anybody uses, so building it just to find it has no geocoder
  // configured would be pure waste.
  const slugs = hostRegistry.listEnvironments().map((t) => t.slug);
  for (const slug of slugs) {
    let env;
    try {
      env = environmentFor(slug);
    } catch (err) {
      if (!(err instanceof MigrationError)) throw err;
      continue; // refused by the Names migration (logged when it was refused): searched past, like one with no geocoder
    }
    const setup = envContext.run(env, () => {
      for (const { manifest } of env.modules.enabledAll()) {
        if (manifest.geocoder) { const s = geocodeSetup(manifest); if (s) return s; }
      }
      return null;
    });
    if (setup) {
      const found = await askService(setup.address, q, null);
      const best = found.find((p) => p.extent);
      return best ? { name: best.name, box: best.extent } : { name: null, box: null };
    }
  }
  return null;
}
hostRouter.get('/api/host/shared/:module/:folder/region-cut/find', requireHostAdmin, async (req, res) => {
  if (!sharedFolderSetup(req, res)) return;
  const q = String(req.query.q || '').trim().slice(0, 200);
  if (q.length < 2) return res.status(400).json({ error: 'type a place name first' });
  try {
    const found = await findRegionBoxAcrossEnvironments(q);
    if (found === null) return res.status(404).json({ error: 'no place search is set up on any environment (a module with one, such as Places, names where to look)' });
    res.json(found.box ? { found: true, name: found.name, box: found.box } : { found: false });
  } catch (err) {
    res.status(502).json({ error: 'search is not available right now' });
  }
});
hostRouter.post('/api/host/shared/:module/:folder/region-cut/estimate', requireHostAdmin, async (req, res) => {
  const found = sharedFolderSetup(req, res);
  if (!found) return;
  try {
    res.json(await sharedRegionCutJobs.estimate({ source: hostRegistry.sharedFolderAddress(found.module, found.folder), box: boxFromBody(req.body), maxZoom: Number(req.body?.maxZoom), minZoom: req.body?.minZoom !== undefined ? Number(req.body.minZoom) : undefined }));
  } catch (err) {
    sendRegionCutError(err, res);
  }
});
hostRouter.post('/api/host/shared/:module/:folder/region-cut', requireHostAdmin, async (req, res) => {
  const found = sharedFolderSetup(req, res);
  if (!found) return;
  try {
    const out = await sharedRegionCutJobs.start({
      moduleId: found.module,
      scopeKey: 'environment',
      source: hostRegistry.sharedFolderAddress(found.module, found.folder),
      folder: found.folder,
      name: String(req.body?.name || ''),
      box: boxFromBody(req.body),
      minZoom: req.body?.minZoom !== undefined ? Number(req.body.minZoom) : undefined,
      maxZoom: Number(req.body?.maxZoom),
      by: currentHostAdmin(req)?.key,
      replace: Boolean(req.body?.replace),
    });
    res.status(202).json(out);
  } catch (err) {
    sendRegionCutError(err, res);
  }
});
hostRouter.get('/api/host/shared/:module/:folder/region-cut/:jobId/stream', requireHostAdmin, (req, res) => {
  const job = sharedRegionCutJobs.view(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'that cut is not running (it may have finished a while ago)' });
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  if (job.status !== 'running') {
    res.write(`event: ${job.status}\ndata: ${JSON.stringify(job.status === 'done' ? { name: job.name } : { error: job.error })}\n\n`);
    return res.end();
  }
  const { jobId } = req.params;
  const cleanup = () => { sharedRegionCutJobs.off('progress', onProgress); sharedRegionCutJobs.off('done', onDone); sharedRegionCutJobs.off('error', onErr); };
  const onProgress = (id, p) => { if (id === jobId) res.write(`event: progress\ndata: ${JSON.stringify(p)}\n\n`); };
  const onDone = (id, d) => { if (id !== jobId) return; res.write(`event: done\ndata: ${JSON.stringify(d)}\n\n`); cleanup(); res.end(); };
  const onErr = (id, error) => { if (id !== jobId) return; res.write(`event: error\ndata: ${JSON.stringify({ error })}\n\n`); cleanup(); res.end(); };
  sharedRegionCutJobs.on('progress', onProgress);
  sharedRegionCutJobs.on('done', onDone);
  sharedRegionCutJobs.on('error', onErr);
  req.on('close', cleanup); // host-level: no environment to hand back to a later callback, unlike the SSE routes under the seam
});
hostRouter.post('/api/host/admins', requireHostAdmin, (req, res) => {
  try {
    const password = String(req.body?.password || '');
    if (password.length < 8) throw new HostError('a password needs at least 8 characters');
    res.status(201).json({ admin: hostRegistry.addAdmin({ login: req.body?.login, passwordHash: auth.hashPassword(password) }) });
  } catch (err) {
    sendHostError(err, res);
  }
});
hostRouter.delete('/api/host/admins/:key', requireHostAdmin, (req, res) => {
  try {
    hostRegistry.removeAdmin(req.params.key);
    res.json({ ok: true });
  } catch (err) {
    sendHostError(err, res);
  }
});
// The product itself, for the landing page (the bare base domain) and the console (admin.<base>): public, no
// session needed, and harmless anywhere else it happens to be reached. name and contact are configuration, never
// code, since the product's own name is still being chosen. Registered on hostRouter here (admin.<base> only
// ever reaches it through here anyway); the main app's own copy is registered after the resolver below, not
// here, so an old-base-domain request still 301s instead of this one route quietly bypassing that.
function productInfo(_req, res) {
  const plans = hostRegistry ? Object.entries(hostRegistry.plansCatalog()).map(([id, p]) => ({ id, name: p.name, caps: p.caps, checkoutUrl: checkoutUrlFor(id) })) : [];
  res.json({ name: PRODUCT_NAME, contact: CONTACT_EMAIL || null, baseDomain: BASE_DOMAIN || null, version: VERSION, signup: signupEnabled, plans });
}
hostRouter.get('/api/product', productInfo);
// One environment's public name, for the product page's own Sign in (a slug is an address already, so confirming
// one exists reveals nothing): { slug, name } for an active or pastDue environment, 404 for anything else --
// unknown, suspended, or a slug that does not even look like one (checked before it ever reaches the registry).
function productEnvironment(req, res) {
  if (!hostRegistry) return res.status(404).json({ error: 'not found' });
  let slug;
  try {
    slug = cleanSlug(req.query.slug);
  } catch {
    return res.status(404).json({ error: 'not found' });
  }
  const environment = hostRegistry.findEnvironment(slug);
  if (!environment || (environment.status !== 'active' && environment.status !== 'pastDue')) return res.status(404).json({ error: 'not found' });
  res.json({ slug: environment.slug, name: environment.name });
}
hostRouter.get('/api/product/environment', productEnvironment);
// The same, as a list, for the product page's own Sign in dropdown: every active or pastDue environment, sorted
// by name, suspended ones left out entirely (not even a slug -- there is nothing for a visitor to do with one).
function productEnvironments(_req, res) {
  if (!hostRegistry) return res.json({ environments: [] });
  const environments = hostRegistry
    .listEnvironments()
    .filter((t) => (t.status === 'active' || t.status === 'pastDue') && !refusals.has(t.slug)) // a refused one cannot be signed in to
    .map((t) => ({ slug: t.slug, name: t.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json({ environments });
}
hostRouter.get('/api/product/environments', productEnvironments);
hostRouter.use((_req, res) => res.status(404).json({ error: 'not found' }));

// --- the door: resolve an environment for this request, or route to the host console -----------------------
// With no BASE_DOMAIN every request is the one environment (today's behaviour, unchanged). With BASE_DOMAIN set:
// admin.<base> is the console above; <base> alone is a plain "this is the host" page (sign-up is phase 5, not
// this); <slug>.<base> resolves that environment; anything else is a plain 404. A request at an old base domain
// (PREVIOUS_BASE_DOMAINS) is redirected (301) to the same path at the current one, before any of that -- see
// "Previous base domains" in plan-tenants.md. The resolver never reads a path, only the hostname.
if (BASE_DOMAIN) {
  app.use((req, res, next) => {
    const host = (req.hostname || '').toLowerCase();
    const oldBase = hostRegistry.previousBaseDomains().find((d) => host === d || host.endsWith(`.${d}`));
    if (oldBase) {
      const newHost = host === oldBase ? BASE_DOMAIN : `${host.slice(0, host.length - oldBase.length - 1)}.${BASE_DOMAIN}`;
      // req.hostname (host, above) is always port-stripped, for matching against BASE_DOMAIN, which never has one;
      // the redirect target still needs the request's own port carried through, or it silently lands on the
      // scheme's default port instead -- invisible behind a real proxy (the port is implicit there), but wrong for
      // local development, where BASE_DOMAIN is often "localhost" at some other port than 80/443.
      const requestHost = req.get('host') || '';
      const port = requestHost.includes(':') ? requestHost.slice(requestHost.lastIndexOf(':')) : '';
      return res.redirect(301, `${auth.isSecure(req) ? 'https' : 'http'}://${newHost}${newHost.includes(':') ? '' : port}${req.originalUrl}`);
    }
    // Font Awesome is asked for by every page including the console's own, but the icon set itself lives
    // outside hostRouter (mounted on `app`, below, since the bare base domain needs it too) -- let through to
    // there rather than into hostRouter, whose own catch-all would otherwise 404 it before it ever arrived.
    if (host === `admin.${BASE_DOMAIN}`) return req.path.startsWith('/fa/') ? next() : hostRouter(req, res, next);
    // The bare base domain: the product's own landing page (public/landing.html), never any one environment's
    // page -- no store is ever resolved here (see the "no environment" fallback in /theme.css and siteIcon
    // above). Only the handful of paths that page actually needs are let through; anything else is a plain 404,
    // same as an unknown subdomain.
    if (host === BASE_DOMAIN) {
      if (req.path === '/') return res.sendFile(page('landing.html'));
      const BARE_BASE_PATHS = ['/landing.css', '/landing.js', '/style.css', '/theme.css', '/img/site/icon', '/favicon.ico', '/api/product', '/api/product/environment', '/api/product/environments', '/api/product/signup'];
      if (BARE_BASE_PATHS.includes(req.path) || req.path.startsWith('/fa/') || req.path.startsWith('/assets/images/brand/')) return next();
      return res.status(404).type('text').send('not found');
    }
    if (host.endsWith(`.${BASE_DOMAIN}`)) {
      const slug = host.slice(0, host.length - BASE_DOMAIN.length - 1);
      if (!hostRegistry.findEnvironment(slug)) return res.status(404).type('text').send('not found');
      return envContext.run(environmentFor(slug), next);
    }
    return res.status(404).type('text').send('not found');
  });
} else {
  app.use((req, res, next) => envContext.run(environmentFor(DEFAULT_SLUG), next));
}
app.get('/api/product', productInfo);
app.get('/api/product/environment', productEnvironment);
app.get('/api/product/environments', productEnvironments);
// Sign-up at the bare base domain (plan-tenants.md, "Phase 5"): always the free plan -- any other named plan
// needs billing first, so the sign-up form only ever offers it as the plan to move to afterwards, through the
// checkout link, never straight from this route. Rate-limited (five an hour per address) the same way a login
// is, just counting every attempt rather than only failed ones.
const signupLimiter = new auth.LoginLimiter(5, 3600000);
app.post('/api/product/signup', (req, res) => {
  if (!BASE_DOMAIN) return res.status(404).json({ error: 'not found' });
  if (!signupEnabled) return res.status(403).json({ error: CONTACT_EMAIL ? `sign-up is off; write to ${CONTACT_EMAIL} instead` : 'sign-up is off' });
  const ip = req.ip || 'unknown';
  if (signupLimiter.blocked(ip)) return res.status(429).json({ error: 'too many attempts, try again in a bit' });
  signupLimiter.fail(ip);
  try {
    const owner = req.body?.owner;
    if (!owner?.login || !owner?.password) throw new HostError('an owner login and password are required');
    const free = hostRegistry.plansCatalog().free;
    const environment = hostRegistry.addEnvironment({ slug: req.body?.slug, name: req.body?.name, plan: { name: 'free', ...free.caps } });
    environmentFor(environment.slug).store.addUser({ login: owner.login, displayName: owner.displayName || owner.login, role: 'owner', passwordHash: auth.hashPassword(owner.password) });
    // The new environment's own port, carried through the same way the PREVIOUS_BASE_DOMAINS redirect above
    // does: invisible behind a real proxy (the port is implicit there), but wrong in local development, where
    // BASE_DOMAIN is often "localhost" at some other port than 80/443.
    const newHost = `${environment.slug}.${BASE_DOMAIN}`;
    const requestHost = req.get('host') || '';
    const port = requestHost.includes(':') ? requestHost.slice(requestHost.lastIndexOf(':')) : '';
    res.status(201).json({ url: `${auth.isSecure(req) ? 'https' : 'http'}://${newHost}${newHost.includes(':') ? '' : port}/` });
  } catch (err) {
    sendHostError(err, res);
  }
});

// Links saved under the old names (/rooms/<id>, /img/room/<id>, ?room= on a picture, ?moduleRoom= on a pop-out):
// a permanent redirect to the new name, ahead of the routes below (server/old-links.js).
mountOldLinks(app);

// Pages ----------------------------------------------------------------------

app.get('/', (req, res) => {
  if (!currentUser(req)) return res.redirect('/login');
  res.sendFile(page('space.html'));
});

// A guest link: the same page, in guest mode (space.js reads the token from
// the URL itself -- see guestToken there). No account, so no redirect to
// sign in; a dead or turned-off link is handled client-side instead.
app.get('/guest/:token', (_req, res) => {
  res.sendFile(page('space.html'));
});

app.get('/login', (req, res) => {
  if (currentUser(req)) return res.redirect(String(req.query.next || '/').startsWith('/') ? String(req.query.next || '/') : '/');
  res.sendFile(page('login.html'));
});

// The pending step's own page, one file for both (the path says which -- documentation/plans/plan-mfa.md):
// /login/verify for an account with a factor already, /login/enrol for one the policy requires but has none
// yet. Already fully signed in (a real session, not just a pending one) redirects away, same as /login.
app.get('/login/verify', (req, res) => {
  if (currentUser(req)) return res.redirect(String(req.query.next || '/').startsWith('/') ? String(req.query.next || '/') : '/');
  res.sendFile(page('login-step.html'));
});
app.get('/login/enrol', (req, res) => {
  if (currentUser(req)) return res.redirect(String(req.query.next || '/').startsWith('/') ? String(req.query.next || '/') : '/');
  res.sendFile(page('login-step.html'));
});

// The product page's own Sign in ends here: a plain top-level form post (never JSON, so nothing crosses
// origins), on success a session exactly like POST /api/login, then a redirect rather than a JSON body -- a
// path on this environment, never off it (so a scheme, a host or even a second leading slash, which a browser
// reads as scheme-relative, falls back to "/"). A wrong login and password looks the same as a wrong password,
// same as the JSON route.
const loginForm = express.urlencoded({ extended: false, limit: '8kb' });
function safeNextPath(next) {
  const value = String(next || '');
  return value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/';
}
app.post('/login', loginForm, (req, res) => {
  const ip = req.ip || 'unknown';
  const login = String(req.body?.login || '');
  const fail = () => res.redirect(303, `/login?error=1&login=${encodeURIComponent(login)}`);
  if (limiter.blocked(ip)) return fail();
  const user = resolveLoginUser(login, String(req.body?.password || ''));
  if (!user) {
    limiter.fail(ip);
    return fail();
  }
  limiter.clear(ip);
  const gate = mfaGate(req, user);
  if (gate) {
    auth.setPendingCookie(req, res, gate.pending);
    const next = encodeURIComponent(safeNextPath(req.body?.next));
    return res.redirect(303, `/login/${gate.enrol ? 'enrol' : 'verify'}?next=${next}`);
  }
  const token = auth.issueSession(store.sessionSecret, user);
  auth.setSessionCookie(req, res, token);
  setEnvHint(req, res);
  res.redirect(303, safeNextPath(req.body?.next));
});

// Self sign-up (only does anything once an admin turns it on in Settings)
// and accepting an invite (always works, whether or not sign-up is open --
// an admin handed it out on purpose) share the same page; register.js tells
// the two apart from the URL.
app.get('/register', (req, res) => {
  if (currentUser(req)) return res.redirect('/');
  res.sendFile(page('register.html'));
});
app.get('/invite/:token', (req, res) => {
  if (currentUser(req)) return res.redirect('/');
  res.sendFile(page('register.html'));
});

// Personal link: signs the user in and drops them in the call page.
app.get('/j/:token', (req, res) => {
  const user = store.userByLinkToken(req.params.token);
  if (!user) return res.status(404).sendFile(page('bad-link.html'));
  // A personal link is a first factor, not a bypass: someone with a second factor still gets the code step
  // (documentation/plans/plan-mfa.md, "A personal link is a first factor, not a bypass").
  const gate = mfaGate(req, user);
  if (gate) {
    auth.setPendingCookie(req, res, gate.pending);
    return res.redirect(`/login/${gate.enrol ? 'enrol' : 'verify'}`);
  }
  auth.setSessionCookie(req, res, auth.issueSession(store.sessionSecret, user));
  setEnvHint(req, res);
  res.redirect('/');
});

app.get('/logout', (req, res) => {
  auth.clearSessionCookie(req, res);
  res.redirect('/login');
});

app.get('/profile', (req, res) => {
  if (!currentUser(req)) return res.redirect('/login?next=/profile');
  res.sendFile(page('profile.html'));
});
app.get('/me', (_req, res) => res.redirect('/profile')); // the profile page's old address
app.get('/module-settings', (req, res) => {
  if (!currentUser(req)) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  res.sendFile(page('module-settings.html'));
});

// An admin editing someone else's profile: the same page, in edit mode --
// see public/profile.js, which tells the two apart by the URL.
app.get('/profile/:key', (req, res) => {
  if (!currentUser(req)) return res.redirect(`/login?next=/profile/${encodeURIComponent(req.params.key)}`);
  if (!isOwner(req)) return res.status(403).send('Owners only.');
  res.sendFile(page('profile.html'));
});

app.get('/admin', (req, res) => {
  if (!currentUser(req)) return res.redirect('/login?next=/admin');
  if (!isOwner(req)) return res.status(403).send('Owners only.');
  res.sendFile(page('admin.html'));
});

// A space's own settings page, the same idea as a user's profile page: click it in
// Manage > Spaces and land here instead of editing it inline in the list.
app.get('/spaces/:id', (req, res) => {
  if (!currentUser(req)) return res.redirect(`/login?next=/spaces/${encodeURIComponent(req.params.id)}`);
  if (!isOwner(req)) return res.status(403).send('Owners only.');
  res.sendFile(page('space-settings.html'));
});


// Images ---------------------------------------------------------------------

// The server icon: the one set on the Settings tab, else the Coffee Pub
// brandmark. Also mounted at the conventional /favicon.ico path -- pages set
// their own <link rel="icon"> (see brand.js), but plenty of browsers and
// tools still fetch that path directly (bookmarks, tab previews, before any
// page JS has run) and got a bare 404 without this.
function siteIcon(_req, res) {
  // No environment at the bare base domain (the landing page): the bundled default, same as any environment
  // that has not set its own.
  const env = envContext.getStore();
  const file = env && env.store.iconPath();
  if (file) return sendImage(res, file);
  res.set('Cache-Control', 'no-cache').sendFile(path.join(publicDir, 'assets', 'images', 'brand', 'brandmark-color.png'));
}
app.get('/img/site/icon', siteIcon);
app.get('/favicon.ico', siteIcon);
// The sign-in background: nothing until one is set.
app.get('/img/site/background', (_req, res) => {
  const file = store.siteImagePath('background');
  if (file) return sendImage(res, file);
  res.status(404).end();
});

// A space's picture: nothing until one is set.
app.get('/img/space/:id', (req, res) => {
  if (!currentUser(req) && !hasStreamAccess(req)) return res.status(403).end();
  const file = store.spaceImagePath(req.params.id);
  if (file) return sendImage(res, file);
  res.status(404).end();
});

// The shared guest picture set (see the guest-link routes): one Participant
// box, standing in for every guest's own images since they have none. The
// call's tile asks for 'profile' the same way it does for a real member, so
// that falls back to the Online picture (or the generic glyph) same as it.
app.get('/img/guest/:slot', (req, res) => {
  if (!currentUser(req) && !hasStreamAccess(req) && !hasGuestAccess(req)) return res.status(403).end();
  const wanted = LEGACY_SLOTS[req.params.slot] || req.params.slot;
  const slot = PARTICIPANT_SLOTS.includes(wanted) ? wanted : 'player';
  const file = store.guestImagePath(slot);
  if (file) return sendImage(res, file);
  if (slot !== 'player' || req.query.fallback === 'none') return res.status(404).end();
  res.set('Cache-Control', 'no-cache').type('image/svg+xml').send(guestSvg());
});

// The server-wide Default Images set -- what effectiveImage() falls back
// to for any member who (and whose space, if any) hasn't set their own.
// For previewing the set itself on the Settings page; 404s when unset,
// same as any other optional slot.
app.get('/img/default/:slot', (req, res) => {
  if (!currentUser(req) && !hasStreamAccess(req) && !hasGuestAccess(req)) return res.status(403).end();
  const wanted = LEGACY_SLOTS[req.params.slot] || req.params.slot;
  const slot = PARTICIPANT_SLOTS.includes(wanted) ? wanted : null;
  const file = slot && store.defaultImagePath(slot);
  if (file) return sendImage(res, file);
  res.status(404).end();
});

// A user's image for a slot. The profile photo always renders (an initials
// plate when none is set); every other slot is optional and 404s when unset,
// so overlays and the Participant/Character boxes stay transparent. Signed-in
// users, stream key holders and guests with a valid guest link. ?space=<id>
// resolves that space's own picture for this slot if it has one, falling
// back to the default the same as OBS would -- 'profile' never has a space
// override, so the param is ignored for it. (?room= is the old name: server/old-links.js.)
app.get('/img/:key/:slot', (req, res) => {
  if (!currentUser(req) && !hasStreamAccess(req) && !hasGuestAccess(req)) return res.status(403).end();
  const user = store.userByKey(req.params.key);
  if (!user) return res.status(404).end();
  const wanted = LEGACY_SLOTS[req.params.slot] || req.params.slot;
  const slot = SLOTS.includes(wanted) ? wanted : 'profile';
  const spaceId = slot !== 'profile' && typeof req.query.space === 'string' ? req.query.space : null;
  if (req.query.spaceOnly === '1') {
    // Just this space's own picture -- no fallback to the member's global or default one.
    const own = spaceId && store.usesSpaceImages(user.key, spaceId) && store.resolveImage(user.key, slot, spaceId);
    return own ? sendImage(res, own.file) : res.status(404).end();
  }
  const resolved = store.effectiveImage(user.key, slot, spaceId);
  if (resolved) return sendImage(res, resolved.file);
  if (slot !== 'profile' || req.query.fallback === 'none') return res.status(404).end();
  res.set('Cache-Control', 'no-cache').type('image/svg+xml').send(initialsSvg(user.displayName));
});

// Web app manifest, so the call page installs as a chromeless window
// (Chrome/Edge "Install app", Safari "Add to Dock").
app.get('/manifest.webmanifest', (_req, res) => {
  const s = store.settings;
  const custom = store.iconPath();
  const icons = [];
  if (custom && /\.png$/.test(custom)) icons.push({ src: '/img/site/icon', sizes: 'any', type: 'image/png' });
  icons.push({ src: '/assets/images/brand/brandmark-color.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' });
  res.set('Cache-Control', 'no-cache').type('application/manifest+json').json({
    name: s.environmentName,
    short_name: s.environmentName.length > 12 ? s.environmentName.slice(0, 12) : s.environmentName,
    description: `${s.environmentName}: voice and video calls`,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#1a1410',
    theme_color: '#1a1410',
    icons,
  });
});

// Static assets, including the LiveKit browser client and Font Awesome
// (the one icon set every page uses) served from node_modules.
app.use('/lib/livekit-client.esm.mjs', express.static(path.join(clientDist, 'livekit-client.esm.mjs')));
const faDir = path.dirname(require.resolve('@fortawesome/fontawesome-free/package.json'));
// An admin's own Font Awesome Pro package, dropped at DATA_DIR/fontawesome-pro/ (the "Web" download from their own Font
// Awesome account: css/, webfonts/ and svgs/, the same shape as the bundled Free set) -- never fetched, never in the image,
// never a token anywhere in this repo, so the shared image every self-hoster pulls stays Free-only and the licence stays
// the admin's own. Present, it is served (and looked up for an icon's SVG) ahead of Free; a style or icon it does not have
// falls back to Free, so nothing breaks if it is partial or absent.
const faProDir = path.join(DATA_DIR, 'fontawesome-pro');
const hasFaPro = fs.existsSync(path.join(faProDir, 'css'));
app.use('/fa/css', express.static(path.join(faProDir, 'css'), { maxAge: '7d' }), express.static(path.join(faDir, 'css'), { maxAge: '7d' }));
app.use('/fa/webfonts', express.static(path.join(faProDir, 'webfonts'), { maxAge: '30d' }), express.static(path.join(faDir, 'webfonts'), { maxAge: '30d' }));

// Background blur's own dependencies, all self-hosted for the same reason
// livekit-client is: nothing this page needs is fetched from a CDN at
// runtime. track-processors imports "livekit-client" and
// "@mediapipe/tasks-vision" by bare package name -- space.html's import map
// points those at the second and third routes below.
const trackProcessorsDist = path.join(__dirname, '..', 'node_modules', '@livekit', 'track-processors', 'dist');
const visionDir = path.join(__dirname, '..', 'node_modules', '@mediapipe', 'tasks-vision');
app.use('/lib/track-processors.mjs', express.static(path.join(trackProcessorsDist, 'index.mjs')));
app.use('/lib/tasks-vision.mjs', express.static(path.join(visionDir, 'vision_bundle.mjs')));
app.use('/lib/mediapipe-wasm', express.static(path.join(visionDir, 'wasm'), { maxAge: '30d' }));

// A server-rendered stylesheet, not a static one: whatever theme colors an
// admin has set (Manage > Settings > Theme), in the light or dark set the
// server's mode picks, as :root overrides -- linked
// after style.css on every page, so the cascade lets it win without
// touching style.css itself. Nothing set yet means an empty file, so an
// untouched server looks exactly like style.css's own built-in defaults.
// This is also why the popped-out call window (space.js clones every
// <link rel="stylesheet"> into that new window) picks up the theme for
// free -- it's just another stylesheet link, not a runtime JS override
// that would need its own copy into that second document.
app.get('/theme.css', (_req, res) => {
  res.set('Content-Type', 'text/css');
  res.set('Cache-Control', 'no-cache');
  // No environment at the bare base domain (the landing page): no theme there either, same as one that has not set one.
  const env = envContext.getStore();
  const theme = env && env.store.activeThemeColors();
  if (!theme) return res.send('');
  const vars = [
    ['--bg', theme.bg],
    ['--bg-section', theme.bgSection],
    ['--border', theme.border],
    ['--text', theme.text],
    ['--text-dim', theme.textDim],
    ['--accent', theme.accent],
    ['--on-accent', theme.onAccent],
    // Optional ones: only when the theme sets them; otherwise style.css derives them.
    ['--bg-card', theme.card],
    ['--header-bg', theme.headerBg],
    ['--header-text', theme.headerText],
    ['--icon', theme.icon],
    ['--icon-hover', theme.iconHover],
    ['--primary-hover', theme.primaryHover],
    ['--secondary', theme.secondary],
    ['--secondary-text', theme.secondaryText],
    ['--secondary-hover', theme.secondaryHover],
  ].filter(([, value]) => value);
  res.send(`:root {\n${vars.map(([name, value]) => `  ${name}: ${value};`).join('\n')}\n}\n`);
});

app.use(express.static(publicDir, { index: false }));

// Public API ------------------------------------------------------------------

app.get('/api/branding', (_req, res) => res.json(branding()));

app.get('/api/config', (req, res) => res.json({ livekitUrl: livekitWsUrl(req), ...branding() }));

app.post('/api/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (limiter.blocked(ip)) return res.status(429).json({ error: 'too many attempts, try again in a few minutes' });
  const user = resolveLoginUser(req.body?.login, req.body?.password || '');
  if (!user) {
    limiter.fail(ip);
    return res.status(401).json({ error: 'wrong username or password' });
  }
  limiter.clear(ip);
  const gate = mfaGate(req, user);
  if (gate) {
    auth.setPendingCookie(req, res, gate.pending);
    return res.json({ mfaRequired: true, enrol: gate.enrol, pending: gate.pending });
  }
  const token = auth.issueSession(store.sessionSecret, user);
  auth.setSessionCookie(req, res, token);
  setEnvHint(req, res);
  res.json({ user: publicUser(req, user), token });
});

// The second step, for an account with a factor already: a TOTP code or a recovery code, checked against
// whoever the pending token (the cookie, or the body for a caller that cannot rely on one) names. On success
// the real session, plus a trusted-browser cookie when asked -- same shape and cookie handling as a plain
// sign-in from here on. Rate-limited the same way a wrong password is.
app.post('/api/login/verify', (req, res) => {
  const ip = req.ip || 'unknown';
  if (limiter.blocked(ip)) return res.status(429).json({ error: 'too many attempts, try again in a few minutes' });
  const pendingToken = req.body?.pending || auth.parseCookies(req.get('cookie'))[auth.PENDING_COOKIE] || null;
  const pend = pendingToken && auth.readPending(store.sessionSecret, pendingToken, { env: currentEnvironment().slug || '', purpose: 'verify' });
  const user = pend && store.userByKey(pend.u);
  if (!user || !user.mfa) {
    limiter.fail(ip);
    return res.status(401).json({ error: 'sign in again' });
  }
  const ok = verifyMfaCode(user.mfa, req.body?.code, {
    onStep: (step) => store.mfaRecordStep(user.key, step),
    onRecovery: (hash) => store.mfaSpendRecovery(user.key, hash),
  });
  if (!ok) {
    limiter.fail(ip);
    return res.status(401).json({ error: 'wrong code' });
  }
  limiter.clear(ip);
  const fresh = store.userByKey(user.key);
  const token = auth.issueSession(store.sessionSecret, fresh);
  auth.setSessionCookie(req, res, token);
  auth.clearSessionCookie(req, res, auth.PENDING_COOKIE);
  if (req.body?.remember) auth.setSessionCookie(req, res, auth.issueSession(store.sessionSecret, fresh), auth.TRUST_COOKIE);
  setEnvHint(req, res);
  res.json({ user: publicUser(req, fresh), token });
});

// Self sign-up: only works while an admin has it turned on. A self-signed
// account is a normal user, in the Lobby like everyone (that's automatic,
// not something to grant).
app.post('/api/register', (req, res) => {
  if (!store.settings.allowRegistration) return res.status(403).json({ error: 'sign-up is turned off' });
  if (refuseOverMembers(res)) return;
  const { login, displayName, password } = req.body || {};
  if (!password) throw new StoreError('a password is required');
  const user = store.addUser({ login, displayName, role: 'member', passwordHash: auth.hashPassword(password) });
  const token = auth.issueSession(store.sessionSecret, user);
  auth.setSessionCookie(req, res, token);
  setEnvHint(req, res);
  res.status(201).json({ user: publicUser(req, user) });
});

// An owner-made invite: signs someone up straight into the spaces it was
// made with. Works even while general sign-up is off -- an admin handed
// this out on purpose.
app.post('/api/invites', requireOwner, (req, res) => {
  const invite = store.createInvite((req.body || {}).spaces);
  res.status(201).json({ invite: { ...invite, url: `${baseUrl(req)}/invite/${invite.token}` } });
});
app.get('/api/invites/:token', (req, res) => {
  const invite = store.inviteByToken(req.params.token);
  if (!invite) return res.status(404).json({ error: 'this invite is gone or has expired' });
  res.json({ invite: { spaces: invite.spaces.map((id) => store.spaceById(id)).filter(Boolean).map((r) => r.name), expiresAt: invite.expiresAt } });
});
app.post('/api/invites/:token/accept', (req, res) => {
  const invite = store.inviteByToken(req.params.token);
  if (!invite) return res.status(404).json({ error: 'this invite is gone or has expired' });
  if (refuseOverMembers(res)) return;
  const { login, displayName, password } = req.body || {};
  if (!password) throw new StoreError('a password is required');
  const user = store.addUser({ login, displayName, role: 'member', passwordHash: auth.hashPassword(password) });
  for (const spaceId of invite.spaces) {
    const space = store.spaceById(spaceId);
    if (space) store.updateSpace(spaceId, { members: [...space.members, user.key] });
  }
  store.removeInvite(invite.token);
  const token = auth.issueSession(store.sessionSecret, user);
  auth.setSessionCookie(req, res, token);
  setEnvHint(req, res);
  res.status(201).json({ user: publicUser(req, user) });
});

app.post('/api/logout', (req, res) => {
  auth.clearSessionCookie(req, res);
  res.json({ ok: true });
});

app.get('/api/me', requireUser, (req, res) => {
  const user = currentUser(req);
  res.json(studioAlias.me(req, {
    user: publicUser(req, user),
    ...branding(),
    // `owner`: this account is one of the environment's owners -- never the host admin's own cross sign-in stand-in
    // (role admin), which has an owner's rights but is not one.
    environment: { hosted: Boolean(BASE_DOMAIN), slug: currentEnvironment().slug || null, name: store.settings.environmentName, owner: user.role === 'owner', hostAdmin: Boolean(user.hostAdmin) },
    livekitUrl: livekitWsUrl(req),
    streamKey: hasOwnerRights(user) ? store.streamKey : undefined,
    // documentation/plans/plan-mfa.md: mfaEnrolled also rides along inside `user` (publicUser, for everyone
    // else's own account too); mfaRequired is this session's own -- the policy asks something of this person
    // that they have not met yet, so the profile page can show the inline enrolment banner -- and overrides
    // branding()'s own environment-wide mfaRequired above. mfaBypass is only ever true for this exact caller.
    mfaEnrolled: Boolean(user.mfa),
    mfaRequired: !user.mfa && mfaPolicyRequires(user),
    mfaBypass: mfaBypassApplies(user),
  }, { signedIn: user, role: user.role, hostAdmin: Boolean(user.hostAdmin), environmentName: store.settings.environmentName }));
});

// Enrolment (documentation/plans/plan-mfa.md): for the signed-in person, or -- with no session yet -- whoever
// holds a valid 'enrol' pending token (mfaSubject covers both). start makes a new secret, kept unconfirmed
// until enable; another start simply replaces it. enable confirms it, makes the recovery codes (shown once,
// never again), and -- when there was no session to begin with -- signs the person in with the same answer.
app.post('/api/me/mfa/start', requireMfaOffered, async (req, res) => {
  const user = mfaSubject(req);
  if (!user) return res.status(401).json({ error: 'sign in first' });
  const secret = auth.totpSecret();
  store.mfaStart(user.key, auth.encryptSecret(secret, secretsKeyBuf()));
  const otpauth = auth.otpauthUrl(store.settings.environmentName, user.login, secret);
  const qr = await QRCode.toString(otpauth, { type: 'svg' });
  res.json({ otpauth, qr, secret });
});
app.post('/api/me/mfa/enable', requireMfaOffered, (req, res) => {
  const user = mfaSubject(req);
  if (!user) return res.status(401).json({ error: 'sign in first' });
  const pending = user.mfa?.pending;
  if (!pending || Date.now() - new Date(pending.startedAt).getTime() > 3600000) {
    return res.status(400).json({ error: 'start enrolment again' });
  }
  const plain = auth.decryptSecret(pending.secret, secretsKeyBuf());
  const step = plain ? auth.totpVerify(plain, req.body?.code) : null;
  if (step === null || step === undefined) return res.status(401).json({ error: 'wrong code' });
  const recoveryCodes = auth.recoveryCodes();
  store.mfaEnable(user.key, recoveryCodes.map((c) => auth.hashPassword(c)));
  store.mfaRecordStep(user.key, step);
  const fresh = store.userByKey(user.key);
  // Enabling bumps mfa.version, which changes this very account's own userStamp -- an already-signed-in
  // caller's session cookie was issued under the old stamp and would otherwise silently stop working the
  // moment this answers, logging them out of the enrolment they just finished. Always reissued, whether or
  // not there was a session to begin with (the pending-enrol-token caller had none at all).
  const token = auth.issueSession(store.sessionSecret, fresh);
  auth.setSessionCookie(req, res, token);
  auth.clearSessionCookie(req, res, auth.PENDING_COOKIE);
  const out = { recoveryCodes, user: publicUser(req, fresh), token };
  if (!currentUser(req)) {
    setEnvHint(req, res);
  }
  res.json(out);
});
// Refused when the policy requires a factor for this person -- they may only replace it (start, then
// enable), never go without one while it is required.
app.post('/api/me/mfa/disable', requireMfaOffered, requireUser, (req, res) => {
  const user = currentUser(req);
  if (!user.mfa) return res.status(400).json({ error: 'no second factor to disable' });
  if (mfaPolicyRequires(user)) return res.status(403).json({ error: 'this environment requires a second factor for your account' });
  const ok = verifyMfaCode(user.mfa, req.body?.code, {
    onStep: () => {}, // about to be disabled outright -- recording the step used is pointless
    onRecovery: () => {},
  });
  if (!ok) return res.status(401).json({ error: 'wrong code' });
  store.mfaDisable(user.key);
  // Disabling changes this account's own userStamp too (mfa.version was folded in, now gone entirely), which
  // would otherwise silently sign this very request's own session out along with the factor -- reissued so
  // disabling stays a smooth, in-session action rather than an accidental sign-out.
  const token = auth.issueSession(store.sessionSecret, store.userByKey(user.key));
  auth.setSessionCookie(req, res, token);
  res.json({ ok: true, token });
});
// The lockout bypass's own way back in: no code needed, just the account's own password -- for an
// owner who has a second factor but lost the means to produce a code at all. Only while ADMIN_MFA_LOCKOUT_BYPASS is on,
// and only for an owner (documentation/plans/plan-mfa.md, "Regaining access"); the host admin's own cross
// sign-in has no real factor of its own, so it is excluded the same way mfaBypassApplies excludes it.
app.post('/api/me/mfa/reset', requireMfaOffered, requireUser, (req, res) => {
  const user = currentUser(req);
  if (!adminMfaLockoutBypass) return res.status(403).json({ error: 'the lockout bypass (ADMIN_MFA_LOCKOUT_BYPASS) is not turned on' });
  if (!mfaBypassApplies(user)) return res.status(403).json({ error: 'only an owner or the admin can use the lockout bypass' });
  if (!user.passwordHash || !auth.verifyPassword(req.body?.password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'wrong password' });
  }
  store.mfaDisable(user.key);
  const token = auth.issueSession(store.sessionSecret, store.userByKey(user.key));
  auth.setSessionCookie(req, res, token);
  res.json({ ok: true, token });
});
// An environment admin resets a member's factor -- never their own (use disable instead) -- signing them out
// everywhere and asking nothing until they enrol again.
app.delete('/api/users/:key/mfa', requireOwner, (req, res) => {
  if (currentUser(req).key === req.params.key) return res.status(400).json({ error: 'reset your own from your profile instead' });
  const target = store.userByKey(req.params.key);
  if (!target) return res.status(404).json({ error: 'no such user' });
  // The server's admin recovers through ADMIN_PASSWORD and the lockout bypass, never an owner's reset.
  if (target.role === 'admin' && !target.hostAdmin) return res.status(400).json({ error: "this account is the server's admin: it recovers its two-step sign-in with ADMIN_PASSWORD and the lockout bypass, so it can't be reset here" });
  store.mfaDisable(req.params.key);
  res.json({ ok: true });
});

// A token for the call service, for a space (the Lobby unless asked, as `space`): players need a session and must
// belong to the space; OBS viewers need the stream key. `call` in the answer is the call's own name there.
app.post('/api/token', async (req, res) => {
  const spaceId = typeof req.body?.space === 'string' && req.body.space ? req.body.space : LOBBY;
  const theSpace = store.spaceById(spaceId);
  if (!theSpace) return res.status(404).json({ error: 'no such space' });
  const call = callName(spaceId);
  if (req.body?.role === 'viewer') {
    if (!hasStreamAccess(req)) return res.status(403).json({ error: 'stream key required' });
    const identity = `obs-${Date.now().toString(36)}-${randomToken(4)}`;
    return res.json({ token: await mintToken({ identity, name: 'OBS', call, publisher: false }), livekitUrl: livekitWsUrl(req), identity, call, spaceId });
  }
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'sign in first' });
  if (!theSpace.members.includes(user.key) && !isOwner(req)) return res.status(403).json({ error: 'you are not in that space' });
  if (req.body?.call !== false && (await refuseOverCalls(res, spaceId))) return;
  const media = Boolean(store.spacePermissions(user.key, spaceId).conference);
  const token = await mintToken({ identity: user.key, name: user.displayName, call, publisher: true, media, inCall: req.body?.call !== false });
  res.json({ token, livekitUrl: livekitWsUrl(req), identity: user.key, call, spaceId, conference: media });
});

// Guests: no account, just a name and a space's guest link (see the
// guest-link routes above). Public -- there's nothing to sign in with.
app.get('/api/guest-link/:token', (req, res) => {
  const theSpace = store.spaceByGuestToken(req.params.token);
  if (!theSpace) return res.status(404).json({ error: 'that guest link is off or wrong' });
  res.json({ spaceId: theSpace.id, spaceName: theSpace.name });
});
app.post('/api/guest-join', async (req, res) => {
  const theSpace = store.spaceByGuestToken(req.body?.token);
  if (!theSpace) return res.status(404).json({ error: 'that guest link is off or wrong' });
  const name = cleanText(req.body?.name, 40);
  if (!name) return res.status(400).json({ error: 'a name is required' });
  const call = callName(theSpace.id);
  if (req.body?.call !== false && (await refuseOverCalls(res, theSpace.id))) return;
  const identity = `guest-${randomToken(8)}`;
  const permissions = store.roleSet('guest');
  const token = await mintToken({ identity, name, call, publisher: true, media: Boolean(permissions.conference), inCall: req.body?.call !== false });
  res.json({ token, livekitUrl: livekitWsUrl(req), identity, call, spaceId: theSpace.id, spaceName: theSpace.name, guestToken: req.body.token, permissions });
});

// A user may replace or clear their own profile photo. This is separate from
// the Player box's Online picture, which only an admin sets (it may be part
// of a matched set of OBS images).
// Any image slot is self-service once the user's role has its "Images"
// permission (Manage > Roles): by default the profile photo and the call
// background (a still behind their own camera, an alternative to blur).
function requireImageRight(req, res, next) {
  const slot = LEGACY_SLOTS[req.params.slot] || req.params.slot;
  if (!SLOTS.includes(slot)) return res.status(400).json({ error: 'unknown image slot' });
  const user = currentUser(req);
  if (!store.roleSet(user.role)[`image_${slot}`]) return res.status(403).json({ error: 'your role can\'t change that image' });
  req.imageSlot = slot;
  next();
}
app.put('/api/me/images/:slot', requireUser, requireImageRight, rawImage, checkStorageCap, (req, res) => {
  store.setImage(currentUser(req).key, req.imageSlot, req.body, req.get('content-type'));
  res.json({ ok: true });
});
app.delete('/api/me/images/:slot', requireUser, requireImageRight, (req, res) => {
  store.removeImage(currentUser(req).key, req.imageSlot);
  res.json({ ok: true });
});
// The same for a space's own pictures, and the switch that turns them on.
function requireOwnSpace(req, res, next) {
  const space = store.spaceById(req.params.spaceId);
  if (!space || !space.members.includes(currentUser(req).key)) return res.status(403).json({ error: 'not a member of that space' });
  next();
}
app.put('/api/me/spaces/:spaceId/images/:slot', requireUser, requireOwnSpace, requireImageRight, rawImage, checkStorageCap, (req, res) => {
  const user = currentUser(req);
  store.setImage(user.key, req.imageSlot, req.body, req.get('content-type'), req.params.spaceId);
  res.json({ user: publicUser(req, store.userByKey(user.key)) });
});
app.delete('/api/me/spaces/:spaceId/images/:slot', requireUser, requireOwnSpace, requireImageRight, (req, res) => {
  const user = currentUser(req);
  store.removeImage(user.key, req.imageSlot, req.params.spaceId);
  res.json({ user: publicUser(req, store.userByKey(user.key)) });
});
app.patch('/api/me/spaces/:spaceId', requireUser, requireOwnSpace, (req, res) => {
  const user = currentUser(req);
  const set = store.roleSet(user.role);
  if (!Object.entries(set).some(([k, v]) => v && k.startsWith('image_') && k !== 'image_profile' && k !== 'image_background')) {
    return res.status(403).json({ error: 'your role can\'t change a space\'s images' });
  }
  store.setSpacePrefs(user.key, req.params.spaceId, { useDefaultImages: req.body?.useDefaultImages });
  res.json({ user: publicUser(req, store.userByKey(user.key)) });
});

// A user's own mic/camera processing settings (gain, noise suppression,
// echo cancellation, auto gain, push to talk, quality, mirror, background
// mode, master volume) -- not which physical device to use, that stays
// local to the browser. Self-service, and admin can set it for someone
// else from their profile page the same way images work.
app.patch('/api/me/call-prefs', requireUser, (req, res) => {
  res.json({ callPrefs: store.setCallPrefs(currentUser(req).key, req.body || {}) });
});
app.patch('/api/users/:key/call-prefs', requireOwner, (req, res) => {
  res.json({ callPrefs: store.setCallPrefs(req.params.key, req.body || {}) });
});

// Presence: everyone in the environment, with names, talking colours and Player options for the tiles and view
// pages, who is in a call right now and in which space, and the spaces themselves (the ones the caller may join
// marked). GET /api/presence answers it; POST /api/presence is a page's heartbeat.
// Who is on the site right now, in a call or not: a page tells the server it is open every half minute
// (POST /api/presence), and a person counts as present for a little longer than that. Held in memory, so it
// starts empty when the server does and fills within half a minute.
const PRESENT_MS = 75 * 1000;
const isPresent = (key) => Date.now() - (presence.get(key) || 0) < PRESENT_MS;
app.post('/api/presence', requireUser, (req, res) => {
  presence.set(currentUser(req).key, Date.now());
  res.json({ ok: true });
});

// Asides (plan-names step 3 moved these from /api/table/*; their own record comes in step 8). Each nudge to a page
// in a call goes over the call's data channel, on a topic that names it: aside-pull, aside-started, aside-recall and
// aside-return. The data's `type` is the topic.
const ASIDE_TOPICS = { pull: 'aside-pull', started: 'aside-started', recall: 'aside-recall', return: 'aside-return' };
const asidePayload = (type, fields) => new TextEncoder().encode(JSON.stringify({ type, ...fields }));

// An invitation to a conversation of two: a private aside (off the record) for the inviter and the person invited,
// who is told wherever they have the app open (the notification stream) and can join or decline. It lives a couple
// of minutes; the aside is swept away when nobody is in it, as any aside is.
const INVITE_MS = 2 * 60 * 1000;
app.post('/api/asides/invite', requireUser, (req, res) => {
  const me = currentUser(req);
  const to = store.userByKey(String(req.body?.to || ''));
  if (!to || to.key === me.key) return res.status(400).json({ error: 'pick someone else to invite' });
  if (store.settings.allowPrivate === false) return res.status(403).json({ error: 'private conversations are turned off' });
  if (!store.spacePermissions(me.key, null).privateCall) return res.status(403).json({ error: "you can't start a private conversation" });
  if (!isPresent(to.key)) return res.status(409).json({ error: `${to.displayName} is not online right now` });
  const aside = store.addAside([me.key, to.key], null, true);
  const invite = { id: randomToken(), from: me.key, to: to.key, spaceId: aside.id, at: Date.now() };
  invites.set(invite.id, invite);
  for (const [id, i] of invites) if (Date.now() - i.at > INVITE_MS) invites.delete(id);
  inviteEvents.emit('invite', { ...invite, fromName: me.displayName });
  res.json({ aside, invite: { id: invite.id } });
});
// Declining just ends the invitation; the inviter is not told anything unfriendly, the aside simply stays empty.
app.post('/api/asides/invite/:id/decline', requireUser, (req, res) => {
  const invite = invites.get(req.params.id);
  if (invite && invite.to === currentUser(req).key) invites.delete(invite.id);
  res.json({ ok: true });
});

app.get('/api/presence', async (req, res) => {
  const user = currentUser(req);
  if (!user && !hasStreamAccess(req) && !hasGuestAccess(req)) return res.status(401).json({ error: 'sign in first' });
  const online = await participants();
  const byKey = new Map(online.map((p) => [p.key, p]));
  store.pruneAsides(byKey);
  res.json({
    ...branding(),
    users: store.users.map((u) => ({ ...presenceUser(u), online: byKey.has(u.key), present: byKey.has(u.key) || isPresent(u.key), space: byKey.get(u.key)?.space || null, inCall: byKey.get(u.key)?.inCall ?? false })),
    spaces: store.spaces.map((r) => ({ ...r, mine: !user || r.members.includes(user.key) || hasOwnerRights(user) })),
    activeSpace: activeSpaceId(byKey),
    ownerOnline: hasOnlineOwner(byKey),
  });
});

// An admin pulls one or more people who are in their call into a new aside with them, for a word away from
// everyone else. LiveKit here is a single, un-clustered node, so there is no server-side "move a live participant"
// primitive to lean on: the admin's own browser gets the aside directly in this response and reconnects itself;
// everyone else pulled gets a data-channel nudge (aside-pull) telling their page which aside to reconnect to.
// An ordinary aside is a GM move -- pulling someone into an in-fiction private moment, admin only. A Private
// Conversation is a real off-the-record word, which any two (or more) people in a call should be able to step
// into together without needing the admin to broker it -- so this route allows any signed-in user, but still
// requires admin for anything that isn't private.
app.post('/api/asides', requireUser, async (req, res) => {
  try {
    const initiator = currentUser(req);
    const priv = Boolean(req.body?.private);
    if (priv && store.settings.allowPrivate === false) return res.status(403).json({ error: 'private conversations are turned off' });
    if (!priv && store.settings.allowAsides === false) return res.status(403).json({ error: 'asides are turned off' });
    const raw = req.body?.with;
    const keys = [...new Set(Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [])];
    const targets = keys.filter((k) => k !== initiator.key).map((k) => store.userByKey(k)).filter(Boolean);
    if (!targets.length) return res.status(400).json({ error: 'pick someone to pull aside' });
    const here = new Map((await participants()).map((p) => [p.key, p]));
    const initiatorCall = here.get(initiator.key)?.call;
    if (!initiatorCall) return res.status(400).json({ error: 'you need to be in a call yourself to pull someone aside' });
    const originId = spaceIdOfCall(initiatorCall);
    const perms = store.spacePermissions(initiator.key, originId);
    if (priv ? !perms.privateCall : !perms.startAside) return res.status(403).json({ error: priv ? 'you can\'t start a private conversation' : 'you can\'t pull someone into an aside' });
    for (const target of targets) {
      const there = here.get(target.key);
      if (!there || there.call !== initiatorCall) return res.status(404).json({ error: `${target.displayName} is not with you right now` });
      if (!there.inCall) return res.status(409).json({ error: `${target.displayName} is not in the conference right now` });
    }
    const aside = store.addAside([initiator.key, ...targets.map((t) => t.key)], originId, priv);
    // byOwner tells the target's page whether to just go (an owner's call) or ask first.
    const payload = asidePayload(ASIDE_TOPICS.pull, { spaceId: aside.id, byOwner: hasOwnerRights(initiator), private: priv, from: initiator.displayName });
    await callService.sendData(initiatorCall, payload, DataPacket_Kind.RELIABLE, { destinationIdentities: targets.map((t) => t.key), topic: ASIDE_TOPICS.pull });
    // Everyone left behind: a private word is private from the others, not invisible to them -- this is what lets
    // their tiles turn into "in an aside" placeholders right away instead of just looking like they hung up until
    // the next poll catches up.
    const bystanderPayload = asidePayload(ASIDE_TOPICS.started, { spaceId: aside.id, members: aside.members });
    await callService.sendData(initiatorCall, bystanderPayload, DataPacket_Kind.RELIABLE, { topic: ASIDE_TOPICS.started }).catch(() => {});
    res.json({ aside });
  } catch (err) {
    res.status(502).json({ error: `LiveKit: ${err.message}` });
  }
});

// Admin-only recall: every Private Conversation pulled out of the admin's own current space gets a data-channel
// warning (aside-recall) -- their own page runs a 10-second countdown, then reconnects them back here itself,
// rather than being yanked back instantly. Doesn't touch ordinary asides: the admin is always already in those, so
// there's nothing to recall them from that returning (POST /api/asides/return) doesn't already cover.
app.post('/api/asides/recall', requireOwner, async (req, res) => {
  try {
    const admin = currentUser(req);
    const online = await participants();
    const adminCall = online.find((p) => p.key === admin.key)?.call;
    if (!adminCall) return res.status(400).json({ error: 'you need to be in a call yourself to recall anyone' });
    const originId = spaceIdOfCall(adminCall);
    const destSpace = store.spaceById(originId);
    const privateAsides = store.spaces.filter((r) => r.ephemeral && r.private && r.origin === originId);
    if (!privateAsides.length) return res.status(400).json({ error: 'nobody is off in a private conversation from here right now' });
    const payload = asidePayload(ASIDE_TOPICS.recall, { spaceId: originId, spaceName: destSpace?.name || 'the call' });
    // Each private aside's call by its name, and by whatever name the people in it are really in (a call from
    // before the upgrade, for that one release).
    const ids = new Set(privateAsides.map((r) => r.id));
    const calls = new Set([...privateAsides.map((r) => callName(r.id)), ...online.filter((p) => ids.has(p.space)).map((p) => p.call)]);
    await Promise.all([...calls].map((call) => callService.sendData(call, payload, DataPacket_Kind.RELIABLE, { topic: ASIDE_TOPICS.recall }).catch(() => {})));
    res.json({ recalled: privateAsides.length });
  } catch (err) {
    res.status(502).json({ error: `LiveKit: ${err.message}` });
  }
});

// Whoever leaves an aside returns to the space it was pulled from (the Lobby if that space is gone by now), and
// takes the aside's other member(s) with them the same way a pull does: a data-channel nudge (aside-return), since
// leaving would otherwise be as one-sided as arriving used to be.
app.post('/api/asides/return', requireUser, async (req, res) => {
  try {
    const me = currentUser(req);
    const mine = (await participants()).find((p) => p.key === me.key);
    if (!mine) return res.status(400).json({ error: 'you need to be in a call' });
    const current = store.spaceById(mine.space);
    if (!current || !current.ephemeral) return res.status(400).json({ error: 'you are not in an aside' });
    const dest = (current.origin && store.spaceById(current.origin)) || store.spaceById(LOBBY);
    const others = current.members.filter((k) => k !== me.key);
    if (others.length) {
      const payload = asidePayload(ASIDE_TOPICS.return, { spaceId: dest.id });
      // Best-effort: I still get to leave even if the others cannot be nudged.
      await callService
        .sendData(mine.call, payload, DataPacket_Kind.RELIABLE, { destinationIdentities: others, topic: ASIDE_TOPICS.return })
        .catch(() => {});
    }
    res.json({ space: dest });
  } catch (err) {
    res.status(502).json({ error: `LiveKit: ${err.message}` });
  }
});

// Stream API (OBS pages and the Studio app) ---------------------------------

app.get('/api/status', requireStream, async (req, res) => {
  const online = await participants();
  const byKey = new Map(online.map((p) => [p.key, p]));
  store.pruneAsides(byKey);
  res.json(studioAlias.status(req, {
    ...branding(),
    users: store.users.map((u) => ({ ...publicUser(req, u), online: withoutCall(byKey.get(u.key)) })),
    spaces: store.spaces,
    activeSpace: activeSpaceId(byKey),
    ownerOnline: hasOnlineOwner(byKey),
    pages: modules.keyedPaths(), // every keyed path an enabled module claims, e.g. ["view"] (Coffee Pub Studio asks for this)
  }, { signedIn: currentUser(req), environmentName: store.settings.environmentName }));
});

// What a keyed page (public/keyed.html) needs to mount the module that claims its path: the surface's own entry
// file and enough of the module to draw its chrome. Stream access, same as the page itself.
app.get('/api/pages/:path', requireStream, (req, res) => {
  const claimed = modules.keyedFor(req.params.path);
  if (!claimed) return res.status(404).json({ error: 'no such page' });
  const { manifest, entry, runMode } = claimed;
  res.json({ page: { path: req.params.path, entry: manifest.surfaces.keyed.entry, module: { id: manifest.id, name: manifest.name, version: manifest.version, icon: manifest.icon, runMode } } });
});

// Spaces: the Lobby (everyone) plus the spaces an owner curates. Signed-in
// users and stream key holders can read them; owners change them.
app.get('/api/spaces', (req, res) => {
  if (!currentUser(req) && !hasStreamAccess(req)) return res.status(401).json({ error: 'sign in first' });
  res.json({ spaces: store.spaces });
});
app.post('/api/spaces', requireOwner, (req, res) => {
  const { name, description, members, profile, link, linkIcon } = req.body || {};
  res.json({ space: store.addSpace({ name, description, members, profile, link, linkIcon }) });
});
app.post('/api/spaces/order', requireOwner, (req, res) => {
  res.json({ spaces: store.reorderSpaces((req.body || {}).order) });
});
app.get('/api/spaces/:id', requireOwner, (req, res) => {
  const space = store.spaceById(req.params.id);
  if (!space) return res.status(404).json({ error: 'no such space' });
  res.json({ space });
});
app.patch('/api/spaces/:id', requireOwner, (req, res) => {
  res.json({ space: store.updateSpace(req.params.id, req.body || {}) });
});
app.delete('/api/spaces/:id', requireOwner, (req, res) => {
  store.removeSpace(req.params.id);
  moduleSettings.forgetSpace(req.params.id);
  chatHistory.forgetSpace(req.params.id);
  res.json({ ok: true });
});
app.put('/api/spaces/:id/image', requireOwner, rawImage, checkStorageCap, (req, res) => {
  store.setSpaceImage(req.params.id, req.body, req.get('content-type'));
  res.json({ space: store.spaceById(req.params.id) });
});
app.delete('/api/spaces/:id/image', requireOwner, (req, res) => {
  store.removeSpaceImage(req.params.id);
  res.json({ space: store.spaceById(req.params.id) });
});

// A space's guest link: anyone actually in the space can turn it on, copy it,
// regenerate it or turn it off -- there's no account behind a guest to gate
// this on, unlike everything else admin-only above. create/regenerate
// (POST) mirror the personal-link routes above; DELETE turns it off.
function requireSpaceMember(req, res, next) {
  const space = store.spaceById(req.params.id);
  if (!space) return res.status(404).json({ error: 'no such space' });
  if (!space.members.includes(currentUser(req).key) && !isOwner(req)) return res.status(403).json({ error: 'you are not in that space' });
  next();
}
// Managing the link needs Can Invite for that space (owners always can) --
// being in the space alone no longer is enough.
function requireCanInvite(req, res, next) {
  if (!store.spacePermissions(currentUser(req).key, req.params.id).canInvite) return res.status(403).json({ error: 'you can\'t invite people to this space' });
  next();
}
app.post('/api/spaces/:id/guest-link', requireUser, requireSpaceMember, requireCanInvite, (req, res) => {
  const guestToken = req.body?.regenerate ? store.regenerateGuestLink(req.params.id) : store.enableGuestLink(req.params.id);
  res.json({ space: store.spaceById(req.params.id), guestUrl: `${baseUrl(req)}/guest/${guestToken}` });
});
app.delete('/api/spaces/:id/guest-link', requireUser, requireSpaceMember, requireCanInvite, (req, res) => {
  store.disableGuestLink(req.params.id);
  res.json({ space: store.spaceById(req.params.id) });
});

// Admin API -------------------------------------------------------------------

app.get('/api/users', requireOwner, (req, res) => {
  res.json({ users: store.users.map((u) => publicUser(req, u)) });
});

app.get('/api/users/:key', requireOwner, (req, res) => {
  const user = store.userByKey(req.params.key);
  if (!user) return res.status(404).json({ error: 'no such user' });
  res.json({ user: publicUser(req, user) });
});

app.post('/api/users', requireOwner, (req, res) => {
  if (refuseOverMembers(res)) return;
  const { login, displayName, role, password, passwordless } = req.body || {};
  const user = store.addUser({ login, displayName, role, passwordHash: password ? auth.hashPassword(password) : null });
  if (passwordless) store.updateUser(user.key, { linkToken: randomToken() });
  res.status(201).json({ user: publicUser(req, store.userByKey(user.key)) });
});

app.patch('/api/users/:key', requireOwner, (req, res) => {
  const { login, displayName, role, password, player } = req.body || {};
  if (password !== undefined && store.userByKey(req.params.key)?.hostAdmin) {
    throw new StoreError('this account signs in through the host console; its password cannot be changed here');
  }
  const patch = {};
  if (login !== undefined) patch.login = login;
  if (displayName !== undefined) patch.displayName = displayName;
  if (role !== undefined) patch.role = role;
  if (password !== undefined) patch.passwordHash = password ? auth.hashPassword(password) : null;
  if (player !== undefined) patch.player = player;
  const self = currentUser(req);
  if (self.key === req.params.key && role !== undefined && role !== self.role) {
    return res.status(400).json({ error: 'you cannot demote yourself' });
  }
  const user = store.updateUser(req.params.key, patch);
  res.json({ user: publicUser(req, user) });
});

app.delete('/api/users/:key', requireOwner, (req, res) => {
  if (currentUser(req).key === req.params.key) return res.status(400).json({ error: 'you cannot delete yourself' });
  store.removeUser(req.params.key);
  res.json({ ok: true });
});

// Personal link: create or regenerate (POST), turn off (DELETE).
app.post('/api/users/:key/link', requireOwner, (req, res) => {
  const user = store.updateUser(req.params.key, { linkToken: randomToken() });
  res.json({ user: publicUser(req, user) });
});
app.delete('/api/users/:key/link', requireOwner, (req, res) => {
  const user = store.updateUser(req.params.key, { linkToken: null });
  res.json({ user: publicUser(req, user) });
});

app.put('/api/users/:key/images/:slot', requireOwner, rawImage, checkStorageCap, (req, res) => {
  store.setImage(req.params.key, LEGACY_SLOTS[req.params.slot] || req.params.slot, req.body, req.get('content-type'));
  res.json({ user: publicUser(req, store.userByKey(req.params.key)) });
});
app.delete('/api/users/:key/images/:slot', requireOwner, (req, res) => {
  const slot = LEGACY_SLOTS[req.params.slot] || req.params.slot;
  if (!SLOTS.includes(slot)) return res.status(400).json({ error: 'unknown image slot' });
  store.removeImage(req.params.key, slot);
  res.json({ user: publicUser(req, store.userByKey(req.params.key)) });
});

// A space's own override for one of that same person's image slots --
// stands in for their default only inside that one space (someone in two
// campaigns with two different characters). Admin-only, same as the
// defaults themselves.
// Per-space settings for one member: which pictures apply there, and what
// they're allowed to do (Permissions on their profile's Spaces tab).
app.patch('/api/users/:key/spaces/:spaceId', requireOwner, (req, res) => {
  store.setSpacePrefs(req.params.key, req.params.spaceId, req.body || {});
  res.json({ user: publicUser(req, store.userByKey(req.params.key)) });
});
app.delete('/api/spaces/:id/members/:key', requireOwner, (req, res) => {
  store.removeMember(req.params.id, req.params.key);
  res.json({ user: publicUser(req, store.userByKey(req.params.key)) });
});
app.put('/api/users/:key/spaces/:spaceId/images/:slot', requireOwner, rawImage, checkStorageCap, (req, res) => {
  store.setImage(req.params.key, LEGACY_SLOTS[req.params.slot] || req.params.slot, req.body, req.get('content-type'), req.params.spaceId);
  res.json({ user: publicUser(req, store.userByKey(req.params.key)) });
});
app.delete('/api/users/:key/spaces/:spaceId/images/:slot', requireOwner, (req, res) => {
  const slot = LEGACY_SLOTS[req.params.slot] || req.params.slot;
  if (!SLOTS.includes(slot)) return res.status(400).json({ error: 'unknown image slot' });
  store.removeImage(req.params.key, slot, req.params.spaceId);
  res.json({ user: publicUser(req, store.userByKey(req.params.key)) });
});

// Admin, or a member the admin gave Can Kick / Can Mute for the space both of
// them are in right now (never against an admin) -- see Permissions on a
// user's profile, Spaces tab.
async function canModerate(req, targetKey, permission) {
  const actor = currentUser(req);
  const call = await callOf(targetKey);
  if (!call) return { error: [404, 'not in a call'] };
  if (hasOwnerRights(actor)) return { call };
  const target = store.userByKey(targetKey);
  if (!target || hasOwnerRights(target) || target.key === actor.key) return { error: [403, 'not allowed'] };
  if ((await callOf(actor.key)) !== call) return { error: [403, 'not allowed'] };
  if (!store.spacePermissions(actor.key, spaceIdOfCall(call))[permission]) return { error: [403, 'not allowed'] };
  return { call };
}

app.post('/api/users/:key/kick', requireUser, async (req, res) => {
  try {
    const { call, error } = await canModerate(req, req.params.key, 'canKick');
    if (error) return res.status(error[0]).json({ error: error[1] });
    await callService.removeParticipant(call, req.params.key);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: `LiveKit: ${err.message}` });
  }
});

app.post('/api/users/:key/mute', requireUser, async (req, res) => {
  try {
    const { call, error } = await canModerate(req, req.params.key, 'canMute');
    if (error) return res.status(error[0]).json({ error: error[1] });
    const info = await callService.getParticipant(call, req.params.key);
    const mic = (info.tracks || []).find((t) => t.source === 2);
    if (!mic) return res.status(404).json({ error: 'no microphone track' });
    await callService.mutePublishedTrack(call, req.params.key, mic.sid, req.body?.muted !== false);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: `LiveKit: ${err.message}` });
  }
});

// Settings > Roles: the permission list and every role's grid of on/off.
// Modules (Manage > Modules): upload a zip, approve what it asks for, turn it
// on, roll back, uninstall. See docs/MODULES.md.
// The two panes that ship with the app, listed beside the installed modules. They are always on and
// cannot be removed (for now); their permissions are the built-in ones on the Roles tab.
const BUILTIN_MODULES = [
  { id: 'conference', name: 'Conference', icon: 'video', description: 'Voice and video for the space: the tiles, the toolbar, reactions, asides and the OBS views.', permissions: 'Share their screen, Use reactions, and the Asides group', switchable: true, setting: 'conferenceEnabled', needs: 'Needs a LiveKit server.', turnOff: 'Video and audio stop for everyone in every space. Chat, presence and modules keep working.', turnOn: 'Voice and video for the space. It needs a LiveKit server.' },
  { id: 'chat', name: 'Chat', icon: 'message', description: 'Text chat for the space, with pictures and formatting.', permissions: 'Send chat messages and Send pictures in chat' },
];
// Modules that ship with this deployment (the modules/ folder), and where each stands:
// not installed, installed and current, or installed with a newer version available. Installing or
// updating one builds its zip on the server, so nothing has to be uploaded; it then goes through the
// same approval as any zip (an update that asks for something new waits for the admin).
function bundledList() {
  const installed = new Map(modules.list().map((m) => [m.id, m.version]));
  return bundledModules(BUNDLED_DIR).map((m) => {
    const have = installed.get(m.id) || null;
    return {
      id: m.id, name: m.name, icon: m.icon, description: m.description, version: m.version, installed: have,
      requires: m.requires || [], // what it needs installed and on (Maps needs Places), so the list can say so before Install
      update: Boolean(have) && compareVersions(m.version, have) > 0 && !modules.view(m.id)?.versions.includes(m.version),
      notInPlan: !moduleAllowedByPlan(m.id), // plan-tenants.md, "Phase 3": the Available list marks these "Not in your plan"
    };
  });
}
app.get('/api/modules', requireOwner, (_req, res) => res.json({ modules: modules.list(), builtin: BUILTIN_MODULES.map((b) => (b.setting ? { ...b, enabled: store.settings[b.setting] !== false } : b)), bundled: bundledList(), limits: { zipBytes: MODULE_LIMITS.zipBytes } }));
app.post('/api/modules/bundled/:id/install', requireOwner, async (req, res) => {
  const id = req.params.id;
  const bundled = bundledModules(BUNDLED_DIR).find((m) => m.id === id);
  if (!bundled) return res.status(404).json({ error: 'that module does not ship with this deployment' });
  if (refuseModuleNotInPlan(res, id, bundled.name)) return;
  const { zip } = buildModule(path.join(BUNDLED_DIR, id));
  const installed = await modules.install(zip, { source: 'bundled' });
  carryReplacedGrants(currentEnvironment());
  res.status(201).json({ module: installed });
});
// Uploading a module's own zip, and choosing to run one in the page rather than sandboxed, are the host's own
// trust decision (plan-tenants.md, "Phase 2": what Manage hides from an owner) -- a hosted environment's owner
// may still install and enable any module its plan allows, but never bring in code the host itself hasn't
// vetted. The host admin's own cross sign-in is exempt, same as a self-hosted install (no BASE_DOMAIN at all).
function requireHostTrust(req, res, next) {
  if (BASE_DOMAIN && !currentUser(req)?.hostAdmin) return res.status(403).json({ error: 'only the host may add or run unvetted modules here' });
  next();
}
app.post('/api/modules', requireOwner, requireHostTrust, rawZip, async (req, res) => {
  const installed = await modules.install(req.body);
  // The zip's own id is only known once it is unpacked -- refused after the fact, undoing the install, rather
  // than duplicating modules.js's own manifest parsing here just to check the plan first (plan-tenants.md,
  // "Phase 3"). keepData: false since this was never really installed from the plan's point of view.
  if (!moduleAllowedByPlan(installed.id)) {
    modules.uninstall(installed.id, { keepData: false });
    return res.status(403).json({ error: `This environment's plan does not include ${installed.name}.` });
  }
  carryReplacedGrants(currentEnvironment());
  res.status(201).json({ module: installed });
});
app.patch('/api/modules/:id', requireOwner, (req, res) => {
  if (req.body?.runMode === 'page' && BASE_DOMAIN && !currentUser(req)?.hostAdmin) return res.status(403).json({ error: 'only the host may choose to run a module in the page' });
  if (req.body?.enabled === true) {
    const current = modules.list().find((m) => m.id === req.params.id);
    if (current && refuseModuleNotInPlan(res, current.id, current.name)) return;
  }
  res.json({ module: modules.update(req.params.id, req.body || {}, { spaceExists: (id) => !!store.spaceById(id) }) });
});
app.post('/api/modules/:id/rollback', requireOwner, (req, res) => {
  res.json({ module: modules.rollback(req.params.id, String(req.body?.version || '')) });
});
app.delete('/api/modules/:id', requireOwner, (req, res) => {
  modules.uninstall(req.params.id, { keepData: req.query.keepData !== '0' });
  moduleData.forget(req.params.id);
  if (req.query.keepData === '0') {
    moduleHooks.forget(req.params.id);
    moduleHooks.dropModule(req.params.id);
    moduleLinks.dropModule(req.params.id);
    moduleBus.dropModule(req.params.id);
    moduleSettings.forgetModule(req.params.id);
  }
  res.json({ ok: true });
});

// --- module runtime -------------------------------------------------------
// What an installed, enabled module can do once it is running: be served, list
// where it shows up, and read and write its own data. The page hosting a
// module's frame makes these calls on the frame's behalf (see
// public/module-host.js); the frame itself never talks to the server.

// Who is asking: a signed-in user, a guest carrying a space's guest token, or -- carrying the access key and no
// session -- a keyed viewer: a module's own keyed page (see moduleAccess below), never a person, so it reads
// only, and only a module with a keyed surface.
function moduleViewer(req) {
  const user = currentUser(req);
  if (user) return { user, guestSpace: null };
  const token = req.query.guest;
  const guestSpace = typeof token === 'string' ? store.spaceByGuestToken(token) : null;
  if (guestSpace) return { user: null, guestSpace };
  return hasStreamKey(req) ? { user: null, guestSpace: null, keyed: true } : null;
}

// Whether someone may see a module in a space at all: on for that space, and in it.
function moduleSpaceAccess(entry, who, space) {
  if (!(entry.allSpaces || entry.spaces.includes(space.id))) return false;
  if (who.user) return hasOwnerRights(who.user) || space.members.includes(who.user.key);
  return who.guestSpace.id === space.id;
}

// A module's scope as a request names it (?scope=): 'environment' (also when none is named), 'space', 'spaces' (a
// module's page reading across the viewer's spaces) or 'person'. Anything else -- the old 'room' and 'server' from a
// page open across the upgrade, say -- is refused rather than read as the environment, so nothing a page meant for a
// space lands in the environment's data. Answers the scope, or null after sending the 400.
const SCOPE_NAMES = ['environment', 'space', 'spaces', 'person'];
const BAD_SCOPE = 'scope must be environment, space, spaces or person';
function askedScope(value, res, allowed = SCOPE_NAMES) {
  const scope = value === undefined || value === '' ? 'environment' : value;
  if (!SCOPE_NAMES.includes(scope)) return void res.status(400).json({ error: BAD_SCOPE });
  if (!allowed.includes(scope)) return void res.status(400).json({ error: `scope must be ${allowed.join(', ').replace(/, ([^,]*)$/, ' or $1')} here` });
  return scope;
}
// Who a notification goes to: everyone in the space, everyone in the environment, or one person by key. Anything
// else (the old 'room' and 'server') would be kept and reach nobody, so it is refused.
function refuseNotifyTo(to, res) {
  if (to === undefined || to === null || to === '' || to === 'space' || to === 'environment') return false;
  if (typeof to === 'string' && store.userByKey(to)) return false;
  res.status(400).json({ error: 'to must be space, environment or a person\'s key' });
  return true;
}
// Where a scope's data, uploads and events are kept for a module: 'environment', 'space:<id>' or 'person:<key>'.
const scopeKeyOf = (scope, { spaceId = null, userKey = null } = {}) => (scope === 'space' ? `space:${spaceId}` : scope === 'person' ? `person:${userKey}` : 'environment');

function modulePerms(who, spaceId) {
  if (who.keyed) return {};
  return who.user ? store.spacePermissions(who.user.key, spaceId) : store.roleSet('guest');
}

function moduleCan(manifest, perms, need) {
  const guard = need && manifest.access?.[need];
  return !guard || Boolean(perms[`module.${manifest.id}.${guard}`]);
}

// Resolve the module, scope and permission for a data call. Sends the error
// itself and returns null when the caller may not.
function moduleAccess(req, res, need) {
  const found = modules.enabled(req.params.id);
  if (!found) return void res.status(404).json({ error: 'no such module' });
  const { manifest, entry } = found;
  const who = moduleViewer(req);
  if (!who) return void res.status(401).json({ error: 'sign in first' });
  // The access key stands in for a session only on a module's own keyed page, and only to read it: the key is
  // the permission, so there is no space, person or fine-grained access.read to check beyond that.
  if (who.keyed) {
    if (need !== 'read' || !manifest.surfaces.keyed) return void res.status(403).json({ error: 'the access key only reads a module with a keyed page' });
    return { manifest, entry, scope: 'environment', spaceId: null, scopeKey: 'environment', who, perms: {}, by: 'keyed' };
  }
  const scope = askedScope(req.query.scope, res, ['environment', 'space', 'person']);
  if (!scope) return;
  if (!manifest.scope.includes(scope)) return void res.status(400).json({ error: `this module has no ${scope} scope` });
  let spaceId = null;
  if (scope === 'person') {
    // A person's own data (their profile's): only they can reach it, not even an administrator, because the place it is kept
    // is named by who is asking.
    if (!who.user) return void res.status(403).json({ error: 'guests have no personal data' });
  } else if (scope === 'space') {
    const space = store.spaceById(String(req.query.space || ''));
    if (!space) return void res.status(404).json({ error: 'no such space' });
    if (!moduleSpaceAccess(entry, who, space)) return void res.status(403).json({ error: 'this module is not available in that space for you' });
    spaceId = space.id;
  } else if (!who.user) {
    return void res.status(403).json({ error: 'guests can only use a module in a space' });
  }
  const perms = modulePerms(who, spaceId);
  if (!moduleCan(manifest, perms, need)) return void res.status(403).json({ error: 'your role can\'t do that in this module' });
  return { manifest, entry, scope, spaceId, scopeKey: scopeKeyOf(scope, { spaceId, userKey: who.user?.key }), who, perms, by: who.user?.key || 'guest' };
}

// --- chat history --------------------------------------------------------------------------------
// Chat travels live over LiveKit; the sender also posts the text here so someone who joins later reads what
// was said (see server/chat-history.js for what is kept and for how long). Only a real space keeps history, never
// an aside. Reading needs the "open and read the chat" permission, posting "send chat messages", and the person
// must be in the space (or an owner, or a guest of that space).
function chatSpaceFor(req, res, permission) {
  const who = moduleViewer(req);
  if (!who) return void res.status(401).json({ error: 'sign in first' });
  const space = store.spaceById(req.params.id);
  if (!space) return void res.status(404).json({ error: 'no such space' });
  const allowed = who.user ? hasOwnerRights(who.user) || space.members.includes(who.user.key) : who.guestSpace.id === space.id;
  if (!allowed) return void res.status(403).json({ error: 'you are not in that space' });
  const perms = who.user ? store.spacePermissions(who.user.key, space.id) : store.roleSet('guest');
  if (!perms[permission]) return void res.status(403).json({ error: 'your role cannot do that' });
  return { who, space };
}

app.get('/api/spaces/:id/chat', (req, res) => {
  const found = chatSpaceFor(req, res, 'chatRead');
  if (!found) return;
  res.json({ messages: found.space.ephemeral ? [] : chatHistory.list(found.space.id) });
});

app.post('/api/spaces/:id/chat', (req, res) => {
  const found = chatSpaceFor(req, res, 'chat');
  if (!found) return;
  const { who, space } = found;
  if (space.ephemeral) return res.json({ message: null });
  const key = who.user ? who.user.key : `guest:${space.id}`;
  const now = Date.now();
  const recent = (chatPosts.get(key) || []).filter((t) => now - t < 10000);
  if (recent.length >= 30) return res.status(429).json({ error: 'too many messages, slow down' });
  chatPosts.set(key, [...recent, now]);
  const message = chatHistory.add(space.id, {
    by: who.user ? who.user.key : 'guest',
    who: who.user ? who.user.displayName : req.body?.name,
    text: req.body?.text,
  });
  res.json({ message });
});

// --- a module's page reading every space the viewer belongs to ---------------
// A module with a server page and a space panel (the Calendar) can show, on its page, what is
// stored in each of the viewer's spaces. Only spaces the viewer is a member of count (not every
// space an owner could open), the module must be on for the space, and the viewer's role must
// be allowed to read it there. Read-only: writes always go to one scope.

// A Font Awesome icon as inline SVG, for a module's sandboxed frame, which cannot load the icon font.
function iconSvg(id) {
  if (iconSvgs.has(id)) return iconSvgs.get(id);
  const icon = (store.settings.icons || []).find((i) => i.id === id);
  const classes = icon?.classes || `fa-solid fa-${id}`;
  const style = /fa-brands/.test(classes) ? 'brands' : /fa-regular/.test(classes) ? 'regular' : 'solid';
  const name = classes.split(/\s+/).filter((c) => c.startsWith('fa-')).map((c) => c.slice(3)).find((n) => !['solid', 'regular', 'brands', 'fw'].includes(n));
  const svg = name && /^[a-z0-9-]+$/.test(name) ? faSvg(style, name) : null;
  iconSvgs.set(id, svg);
  return svg;
}

// An icon's SVG, from the admin's Pro package first (if it has this style and icon), then the bundled Free set; null if
// neither does. `style`/`name` are checked by the caller (a route param or a value already drawn from known-good data).
function faSvg(style, name) {
  for (const dir of hasFaPro ? [faProDir, faDir] : [faDir]) {
    try {
      return fs.readFileSync(path.join(dir, 'svgs', style, `${name}.svg`), 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim();
    } catch {
      // try the next place, or give up
    }
  }
  return null;
}

// A Font Awesome icon as inline SVG, by style and name, for a module's widget in a sandboxed frame (which cannot
// load the icon font). Anyone signed in may ask; only the free set's own files are ever read.
app.get('/api/icons/:style/:name', requireUser, (req, res) => {
  const { style, name } = req.params;
  if (!['solid', 'regular', 'brands'].includes(style) || !/^[a-z0-9-]{1,40}$/.test(name)) return res.status(400).json({ error: 'no such icon' });
  const svg = faSvg(style, name);
  if (!svg) return res.status(404).json({ error: 'no such icon' });
  res.type('image/svg+xml').set('Cache-Control', 'private, max-age=86400').send(svg);
});

// The viewer's spaces for this module, or null after sending the error.
function moduleSpacesFor(req, res) {
  const found = modules.enabled(req.params.id);
  if (!found) return void res.status(404).json({ error: 'no such module' });
  const who = moduleViewer(req);
  if (!who?.user) return void res.status(403).json({ error: 'guests can only use a module in a space' });
  const { manifest, entry } = found;
  if (!manifest.scope.includes('space')) return void res.status(400).json({ error: 'this module has no space scope' });
  if (!moduleCan(manifest, modulePerms(who, null), 'read')) return void res.status(403).json({ error: 'your role can\'t do that in this module' });
  const spaces = store.spaces.filter((r) => !r.ephemeral && r.members.includes(who.user.key)
    && (entry.allSpaces || entry.spaces.includes(r.id)) && moduleCan(manifest, modulePerms(who, r.id), 'read'));
  return { manifest, spaces };
}
const spaceSummary = (r) => {
  const icon = r.linkIcon && r.linkIcon !== 'link' ? r.linkIcon : 'message';
  return { id: r.id, name: r.name, icon, svg: iconSvg(icon) };
};

app.get('/api/modules/:id/spaces-data', (req, res) => {
  const found = moduleSpacesFor(req, res);
  if (!found) return;
  const spaces = found.spaces.map(spaceSummary);
  if (req.query.info) return res.json({ spaces });
  const prefix = typeof req.query.prefix === 'string' ? req.query.prefix : '';
  const items = found.spaces.flatMap((r) => moduleData.list(found.manifest.id, scopeKeyOf('space', { spaceId: r.id }), prefix).map((item) => ({ ...item, spaceId: r.id })));
  res.json({ spaces, items });
});

// --- refs: one module pointing at another's items ---------------------------
// Modules cannot reach each other's storage, and that stays. The host knows nothing about any module's
// items; it offers conduits. A module declares in its manifest the kinds of item it lets others point
// at (`refs.produces`: a kind, the stored key its items live under, which stored fields make up a
// small card, and whether it can open one or show what links to it) and which kinds it wants to point
// at (`refs.consumes`: named kinds, or "*" for whatever other modules share; approved by an admin).
// The consumer stores only a pointer ({ module, kind, id, scope, space? }) and asks the host for the card
// whenever it draws it. The host answers only what the viewer could already see in the producing
// module: it must be enabled, the viewer must hold its read permission in that scope (and be in the
// space), and the consumer must have been approved for that kind. What comes back is the card, never
// the stored record. Nothing here names a module: a module installed tomorrow takes part by declaring.

const refError = (status, message) => Object.assign(new Error(message), { status });
const REF_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// A pointer's scope is 'environment', 'person', or 'space' with the space's id in `space`.
const refScopeKey = (ref) => (ref.scope === 'space' ? scopeKeyOf('space', { spaceId: ref.space }) : 'environment');
const refShape = (r) => r && typeof r === 'object' && typeof r.module === 'string' && typeof r.kind === 'string' && REF_ID_RE.test(String(r.id ?? ''))
  && (r.scope === 'environment' || r.scope === 'person' || (r.scope === 'space' && typeof r.space === 'string' && r.space.length <= 64));
// A pointer as the host keeps and answers it: only its own fields.
const plainRef = (r) => ({ module: r.module, kind: r.kind, id: String(r.id), scope: r.scope, ...(r.scope === 'space' ? { space: r.space } : {}) });

// Whether the consumer's manifest declares, and the admin approved, linking to provider:kind.
function consumerMayLink(consumer, provider, kind) {
  const want = `${provider}:${kind}`;
  const declared = consumer.manifest.refs.consumes;
  const approved = consumer.entry.approved?.refs || [];
  return (declared.includes('*') || declared.includes(want)) && (approved.includes('*') || approved.includes(want));
}

// Check that this viewer may look at one scope of `provider`'s items of `kind`. Through a consumer
// (`from`, which must have been approved for the kind), or, for backlinks, with no consumer at all
// (`skipConsumer`): a module may always see what points at its own items, as far as the viewer may.
function refScope(who, { provider, kind, scope, space, from, skipConsumer = false }) {
  const found = modules.enabled(provider);
  if (!found) throw refError(404, 'no such module');
  const produce = found.manifest.refs.produces.find((p) => p.kind === kind);
  if (!produce) throw refError(404, 'that module does not share that kind of item');
  let consumer = null;
  if (!skipConsumer) {
    if (!from) throw refError(400, 'say which module is asking');
    consumer = modules.enabled(from);
    if (!consumer) throw refError(404, 'no such module');
    if (!consumerMayLink(consumer, provider, kind)) throw refError(403, 'that module has not been approved to link to those items');
  }
  const { manifest, entry } = found;
  let scopeKey;
  let perms;
  if (scope === 'space') {
    const r = store.spaceById(String(space || ''));
    if (!r) throw refError(404, 'no such space');
    if (!manifest.scope.includes('space')) throw refError(400, 'that module has no space scope');
    if (!moduleSpaceAccess(entry, who, r)) throw refError(403, 'that module is not available in that space for you');
    // The asking module must itself be on in that space, and readable by the viewer.
    if (consumer && (!moduleSpaceAccess(consumer.entry, who, r) || !moduleCan(consumer.manifest, modulePerms(who, r.id), 'read'))) throw refError(403, 'the linking module is not available in that space for you');
    perms = modulePerms(who, r.id);
    scopeKey = scopeKeyOf('space', { spaceId: r.id });
  } else if (scope === 'person') {
    // The viewer's own items, kept for them alone; a pointer to someone else's simply finds nothing here.
    if (!who.user) throw refError(403, 'guests have no personal data');
    if (!manifest.scope.includes('person')) throw refError(400, 'that module has no personal scope');
    if (consumer && !moduleCan(consumer.manifest, modulePerms(who, null), 'read')) throw refError(403, 'the linking module is not available to you');
    perms = modulePerms(who, null);
    scopeKey = `person:${who.user.key}`;
  } else {
    if (!who.user) throw refError(403, 'guests can only use a module in a space');
    if (!manifest.scope.includes('environment')) throw refError(400, 'that module has no environment scope');
    if (consumer && !moduleCan(consumer.manifest, modulePerms(who, null), 'read')) throw refError(403, 'the linking module is not available to you');
    perms = modulePerms(who, null);
    scopeKey = 'environment';
  }
  if (!moduleCan(manifest, perms, 'read')) throw refError(403, 'your role can\'t see that module');
  return { manifest, produce, scopeKey, ref: { module: provider, kind, scope: scope === 'space' ? 'space' : scope === 'person' ? 'person' : 'environment', ...(scope === 'space' ? { space: String(space) } : {}) } };
}

// The card for one stored item: only the fields the producer named, trimmed and typed.
function refCard({ manifest, produce, ref }, id, value, withText = false) {
  const text = (v) => (typeof v === 'string' ? v.slice(0, 200) : typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const field = (name) => (produce.card[name] ? value?.[produce.card[name]] : undefined);
  const card = {
    ref: { ...ref, id },
    kind: produce.kind,
    kindName: produce.name,
    open: produce.open,
    module: { id: manifest.id, name: manifest.name, icon: manifest.icon },
    title: String(text(field('title')) ?? '').trim() || 'Untitled',
  };
  const subtitle = text(field('subtitle'));
  if (subtitle !== undefined && subtitle !== '') card.subtitle = subtitle;
  for (const name of ['when', 'end']) {
    const v = text(field(name));
    if (v !== undefined && v !== '') card[name] = v;
  }
  for (const name of ['allDay', 'done']) if (typeof field(name) === 'boolean') card[name] = field(name);
  // A short label a module may give its items to group or colour them ("eat", "stay"): lower case letters, digits and dashes.
  const category = text(field('category'));
  if (typeof category === 'string' && /^[A-Za-z0-9-]{1,20}$/.test(category)) card.category = category.toLowerCase();
  // The item's own words (a note's body), plain and up to 8 KB. Left out of the cards people browse; the server reads it only
  // for the AI hook, as the person asking.
  if (withText) { const t = field('text'); if (typeof t === 'string' && t.trim()) card.text = t.replace(/\p{Cc}(?<!\n)/gu, ' ').slice(0, 8000); }
  // A place on the map, if the item has one: { lat, lng, name? }, checked; anything else is left out.
  const place = field('place');
  if (place && typeof place === 'object' && Number.isFinite(place.lat) && Number.isFinite(place.lng) && Math.abs(place.lat) <= 90 && Math.abs(place.lng) <= 180) {
    card.place = { lat: place.lat, lng: place.lng, ...(typeof place.name === 'string' && place.name.trim() ? { name: place.name.replace(/\p{Cc}/gu, ' ').trim().slice(0, 120) } : {}) };
  }
  return card;
}

function resolveRef(who, ref, from, opts = {}) {
  if (!refShape(ref)) throw refError(400, 'that is not a valid reference');
  const at = refScope(who, { provider: ref.module, kind: ref.kind, scope: ref.scope, space: ref.space, from, ...opts });
  const item = moduleData.get(at.manifest.id, at.scopeKey, at.produce.key.replace('{id}', String(ref.id)));
  if (!item || !item.value) throw refError(404, 'that item is no longer there');
  return refCard(at, String(ref.id), item.value, opts.withText === true);
}

// The kinds the consumer may point at: every kind of every other enabled module it was approved for.
function consumableKinds(consumerId) {
  const consumer = modules.enabled(consumerId);
  if (!consumer) return [];
  const out = [];
  for (const { manifest } of modules.enabledAll()) {
    if (manifest.id === consumerId) continue;
    for (const p of manifest.refs.produces) {
      if (consumerMayLink(consumer, manifest.id, p.kind)) out.push({ module: manifest.id, moduleName: manifest.name, icon: manifest.icon, kind: p.kind, name: p.name, open: p.open, events: (manifest.events?.publishes || []).filter((e) => e.kind === p.kind).map((e) => ({ name: e.name, label: e.label, data: e.data || {} })) });
    }
  }
  return out;
}

const refAnswer = (fn) => {
  try {
    return fn();
  } catch (err) {
    if (!err.status) throw err;
    // `state` says what to draw: the item is gone, or it exists but this viewer may not see it (never more than they may know).
    return { error: err.message, status: err.status, ...(err.status === 404 ? { state: 'gone' } : err.status === 403 ? { state: 'hidden' } : {}) };
  }
};

// Cards for a list of pointers, one answer each (a card, or why not).
app.post('/api/refs/resolve', (req, res) => {
  const who = moduleViewer(req);
  if (!who) return res.status(401).json({ error: 'sign in first' });
  const from = String(req.body?.from || '');
  const refs = Array.isArray(req.body?.refs) ? req.body.refs.slice(0, 50) : [];
  res.json({ cards: refs.map((ref) => refAnswer(() => resolveRef(who, ref, from)) ) .map((c, i) => (c.error ? { ref: refs[i], ...c } : c)) });
});

// The kinds the asking module may link to, so it does not have to know other modules by name.
app.get('/api/refs/kinds', (req, res) => {
  if (!moduleViewer(req)) return res.status(401).json({ error: 'sign in first' });
  res.json({ kinds: consumableKinds(String(req.query.from || '')) });
});

// Items the asking module could link to, in one scope: every kind it was approved to consume.
app.get('/api/refs/search', (req, res) => {
  const who = moduleViewer(req);
  if (!who) return res.status(401).json({ error: 'sign in first' });
  const from = String(req.query.from || '');
  if (!modules.enabled(from)) return res.status(404).json({ error: 'no such module' });
  const scope = askedScope(req.query.scope, res, ['environment', 'space', 'person']);
  if (!scope) return;
  const q = String(req.query.q || '').trim().toLowerCase();
  const cards = [];
  for (const k of consumableKinds(from)) {
    let at;
    try {
      at = refScope(who, { provider: k.module, kind: k.kind, scope, space: req.query.space, from });
    } catch {
      continue; // not on for this scope, or not for this viewer
    }
    const prefix = at.produce.key.replace('{id}', '');
    for (const item of moduleData.list(k.module, at.scopeKey, prefix)) {
      if (!item.value || !REF_ID_RE.test(item.key.slice(prefix.length))) continue;
      const card = refCard(at, item.key.slice(prefix.length), item.value);
      if (q && !`${card.title} ${card.subtitle || ''}`.toLowerCase().includes(q)) continue;
      cards.push(card);
    }
  }
  // Newest dates first, undated last.
  cards.sort((a, b) => String(b.when ?? '').localeCompare(String(a.when ?? '')) || a.title.localeCompare(b.title));
  res.json({ cards: cards.slice(0, 50) });
});

// One item, by address (the same answer the batch gives).
app.get('/api/modules/:id/refs/:kind/:refId', (req, res) => {
  const who = moduleViewer(req);
  if (!who) return res.status(401).json({ error: 'sign in first' });
  const out = refAnswer(() => ({ card: resolveRef(who, { module: req.params.id, kind: req.params.kind, id: req.params.refId, scope: req.query.scope, space: req.query.space }, String(req.query.from || '')) }));
  res.status(out.status || 200).json(out);
});

// Links: a module tells the host which items one of its items points at, so the items pointed at can
// ask what points at them. `module` is the asking module, `from` one of its own items, `to` the items
// it now points at (the whole list: it replaces the last). Each target must be something the viewer
// can see and the module is approved to link to, and the viewer must be able to write to the module.
app.post('/api/refs/links', (req, res) => {
  const who = moduleViewer(req);
  if (!who) return res.status(401).json({ error: 'sign in first' });
  const asker = String(req.body?.module || '');
  const from = req.body?.from;
  const found = modules.enabled(asker);
  if (!found) return res.status(404).json({ error: 'no such module' });
  if (!refShape(from) || from.module !== asker) return res.status(400).json({ error: 'a module can only say what its own items point at' });
  if (from.scope === 'person') return res.status(400).json({ error: 'personal items are private, so they are not linked' });
  if (!found.manifest.refs.produces.some((p) => p.kind === from.kind)) return res.status(400).json({ error: 'that module does not share that kind of item' });
  // The viewer must be allowed to change the asking module's data in that scope.
  let perms;
  if (from.scope === 'space') {
    const r = store.spaceById(String(from.space || ''));
    if (!r || !moduleSpaceAccess(found.entry, who, r)) return res.status(403).json({ error: 'that module is not available in that space for you' });
    perms = modulePerms(who, r.id);
  } else {
    if (!who.user) return res.status(403).json({ error: 'guests can only use a module in a space' });
    perms = modulePerms(who, null);
  }
  if (!moduleCan(found.manifest, perms, 'write')) return res.status(403).json({ error: 'your role can\'t do that in this module' });
  const tos = [];
  for (const to of (Array.isArray(req.body?.to) ? req.body.to : []).slice(0, 20)) {
    if (to && to.scope === 'person') continue; // a shared link never points into someone's private data
    try {
      resolveRef(who, to, asker);
      tos.push(to);
    } catch (err) {
      if (!err.status) throw err; // one that cannot be seen or is gone is left out
    }
  }
  moduleLinks.set(from, tos, who.user?.key || 'guest');
  res.json({ links: tos.length });
});

// What points at an item (`dir=to`, for the module that owns it, if it shows backlinks) or what it
// points at (`dir=from`): cards, each only for what the viewer may see.
app.get('/api/refs/links', (req, res) => {
  const who = moduleViewer(req);
  if (!who) return res.status(401).json({ error: 'sign in first' });
  let ref;
  try {
    ref = JSON.parse(String(req.query.ref || ''));
  } catch {
    return res.status(400).json({ error: 'that is not a valid reference' });
  }
  const asker = String(req.query.from || '');
  const found = modules.enabled(asker);
  if (!found) return res.status(404).json({ error: 'no such module' });
  if (!refShape(ref) || ref.module !== asker) return res.status(400).json({ error: 'a module can only ask about its own items' });
  const produce = found.manifest.refs.produces.find((p) => p.kind === ref.kind);
  if (!produce) return res.status(400).json({ error: 'that module does not share that kind of item' });
  const dir = req.query.dir === 'from' ? 'from' : 'to';
  if (dir === 'to' && !produce.backlinks) return res.status(403).json({ error: 'that kind of item does not show what links to it' });
  // The asking module's own item must itself be visible to the viewer.
  try {
    resolveRef(who, ref, null, { skipConsumer: true });
  } catch (err) {
    if (!err.status) throw err;
    return res.status(err.status).json({ error: err.message });
  }
  const cards = [];
  for (const other of dir === 'to' ? moduleLinks.to(ref) : moduleLinks.from(ref)) {
    try {
      cards.push(dir === 'to' ? resolveRef(who, other, null, { skipConsumer: true }) : resolveRef(who, other, asker));
    } catch (err) {
      if (!err.status) throw err; // gone, or not for this viewer
    }
  }
  res.json({ cards });
});

// --- events and actions: modules reacting to and asking things of each other -------------------
// Like refs, the host is only the conduit. A module declares in module.json the events it publishes and
// the ones it wants to hear (`events`), and the actions it provides and the ones it wants to ask
// for (`actions`); an admin approves what a module hears and asks for; this code checks who may do
// what and carries the messages, and knows nothing of what any of them mean. An event is delivered
// live to the modules that may hear it and kept a while for those not open at the time. An action
// request waits in the providing module's queue until a person has that module open: its page claims
// the request (one page only), does it under its own rules, and reports back.

const busMay = (rules, approved, want) => (rules.includes('*') || rules.includes(want)) && (approved.includes('*') || approved.includes(want));
const mayHear = ({ manifest, entry }, publisher, name) => busMay(manifest.events.subscribes, entry.approved?.events || [], `${publisher}:${name}`);
const mayUse = ({ manifest, entry }, provider, action) => busMay(manifest.actions.uses, entry.approved?.actions || [], `${provider}:${action}`);

// Resolve one module's place (the environment, or a space) for this viewer with the permission needed.
function busPlace(who, moduleId, scope, space, need) {
  const found = modules.enabled(moduleId);
  if (!found) throw refError(404, 'no such module');
  const { manifest, entry } = found;
  let scopeKey;
  let perms;
  let spaceId = null;
  if (scope === 'space') {
    const r = store.spaceById(String(space || ''));
    if (!r) throw refError(404, 'no such space');
    if (!manifest.scope.includes('space')) throw refError(400, 'that module has no space scope');
    if (!moduleSpaceAccess(entry, who, r)) throw refError(403, 'that module is not available in that space for you');
    perms = modulePerms(who, r.id);
    scopeKey = scopeKeyOf('space', { spaceId: r.id });
    spaceId = r.id;
  } else {
    if (!who.user) throw refError(403, 'guests can only use a module in a space');
    if (!manifest.scope.includes('environment')) throw refError(400, 'that module has no environment scope');
    perms = modulePerms(who, null);
    scopeKey = 'environment';
  }
  if (!moduleCan(manifest, perms, need)) throw refError(403, 'your role can\'t do that in this module');
  return { found, scopeKey, spaceId, perms };
}

// The bus works in one place: the environment (also when none is named) or a space; any other scope is refused.
function busScope(v) {
  const scope = v === undefined || v === '' ? 'environment' : v;
  if (!SCOPE_NAMES.includes(scope)) throw refError(400, BAD_SCOPE);
  if (scope !== 'environment' && scope !== 'space') throw refError(400, 'scope must be environment or space here');
  return scope;
}
const busRoute = (fn) => (req, res) => {
  const who = moduleViewer(req);
  if (!who) return res.status(401).json({ error: 'sign in first' });
  try {
    res.json(fn(who, req));
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message });
  }
};
const publicEvent = (e) => ({ id: e.id, at: e.at, module: e.module, name: e.name, ref: e.ref, data: e.data });
const publicAction = (a) => ({ id: a.id, at: a.at, from: a.from, name: a.action, input: a.input, by: store.userByKey(a.by)?.displayName || 'someone' });

// A module says something happened. It must have declared the event, and the person must be able to
// change that module here (they are the reason it happened).
app.post('/api/bus/publish', busRoute((who, req) => {
  const { module: id, name, ref, data, scope, space } = req.body || {};
  const at = busPlace(who, String(id || ''), busScope(scope), space, 'write');
  if (overLimit(at.found.manifest.id, who.user?.key, 'event')) throw refError(429, limitMessage);
  if (!at.found.manifest.events.publishes.some((p) => p.name === name)) throw refError(400, 'that module does not publish that event');
  let pointer = null;
  if (ref !== undefined && ref !== null) {
    if (!refShape(ref) || ref.module !== id || !at.found.manifest.refs.produces.some((p) => p.kind === ref.kind) || refScopeKey(ref) !== at.scopeKey) {
      throw refError(400, 'an event can only point at one of its module\'s own items, in the same place');
    }
    pointer = plainRef(ref);
  }
  const event = moduleBus.publish({ module: id, name, ref: pointer, data, scopeKey: at.scopeKey, by: who.user?.key || 'guest' });
  if (!event) throw refError(400, 'the event\'s data is too large');
  return { id: event.id };
}));

// What a module missed, in its own place: the events it may hear (declared and approved) about
// modules the person can see. `after=now` says where things stand, to start listening from.
app.get('/api/bus/events', busRoute((who, req) => {
  const at = busPlace(who, String(req.query.module || ''), busScope(req.query.scope), req.query.space, 'read');
  if (req.query.after === 'now') return { events: [], latest: moduleBus.latestEvent(at.scopeKey) };
  const after = Number(req.query.after) || 0;
  const events = [];
  for (const e of moduleBus.eventsAfter(at.scopeKey, after)) {
    if (!mayHear(at.found, e.module, e.name)) continue;
    try {
      busPlace(who, e.module, busScope(req.query.scope), req.query.space, 'read');
    } catch {
      continue; // a module the person cannot see here
    }
    events.push(publicEvent(e));
    if (events.length >= 100) break;
  }
  return { events, latest: events.length ? events[events.length - 1].id : moduleBus.latestEvent(at.scopeKey) };
}));

// The actions the asking module may request here: every one, of every other module, it was approved for.
app.get('/api/bus/actions', busRoute((who, req) => {
  const from = String(req.query.from || '');
  const scope = busScope(req.query.scope);
  const asker = busPlace(who, from, scope, req.query.space, 'read');
  // `accepts=module:kind` keeps the actions that take a pointer to that kind of item; `self=1` also lists the
  // asking module's own, which it may always use.
  const accepts = String(req.query.accepts || '');
  const takes = (input) => !accepts || Object.values(input).some((t) => { const b = t.replace(/\?$/, ''); return b === 'ref' || b === `ref:${accepts}`; });
  const actions = [];
  for (const { manifest } of modules.enabledAll()) {
    const own = manifest.id === from;
    if (own && req.query.self !== '1') continue;
    for (const a of manifest.actions.provides) {
      if (!takes(a.input)) continue;
      if (!own) {
        if (!mayUse(asker.found, manifest.id, a.name)) continue;
        try {
          busPlace(who, manifest.id, scope, req.query.space, a.local ? 'read' : 'write'); // you can ask only for what you could do yourself
        } catch {
          continue;
        }
      }
      actions.push({ action: `${manifest.id}:${a.name}`, module: manifest.id, moduleName: manifest.name, icon: manifest.icon, name: a.name, label: a.label, input: a.input, ...(a.needs ? { needs: a.needs } : {}), ...(own ? { own: true } : {}) });
    }
  }
  return { actions };
}));

// Check an action's input against what the module said it takes; only those fields come out.
function busInput(who, shape, input) {
  const out = {};
  const given = input && typeof input === 'object' ? input : {};
  for (const [field, type] of Object.entries(shape)) {
    const optional = type.endsWith('?');
    const base = optional ? type.slice(0, -1) : type;
    const v = given[field];
    if (v === undefined || v === null || v === '') {
      if (!optional) throw refError(400, `${field} is needed`);
      continue;
    }
    if (base === 'string' || base === 'text') {
      if (typeof v !== 'string') throw refError(400, `${field} must be text`);
      out[field] = v.replace(/\p{Cc}/gu, ' ').trim().slice(0, base === 'string' ? 200 : 1000);
      if (!out[field] && !optional) throw refError(400, `${field} is needed`);
    } else if (base === 'date') {
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())) throw refError(400, `${field} must be a date`);
      out[field] = v;
    } else if (base === 'datetime') {
      const d = new Date(v);
      if (typeof v !== 'string' || Number.isNaN(d.getTime())) throw refError(400, `${field} must be a date and time`);
      out[field] = d.toISOString();
    } else if (base === 'boolean') {
      if (typeof v !== 'boolean') throw refError(400, `${field} must be true or false`);
      out[field] = v;
    } else if (base === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw refError(400, `${field} must be a number`);
      out[field] = v;
    } else if (base === 'ref' || base.startsWith('ref:')) {
      if (!refShape(v)) throw refError(400, `${field} must be a reference`);
      if (base !== 'ref' && base !== `ref:${v.module}:${v.kind}`) throw refError(400, `${field} must be a ${base.slice(4).replace(':', ' ')}`);
      resolveRef(who, v, null, { skipConsumer: true }); // the asker must be able to see what it points at
      out[field] = plainRef(v);
    }
  }
  return out;
}

// One module asks another to do something. Queued for the module that owns the action.
app.post('/api/bus/actions/request', busRoute((who, req) => {
  const { from, action, input, scope, space } = req.body || {};
  const [providerId, name] = String(action || '').split(':');
  const sc = busScope(scope);
  const asker = busPlace(who, String(from || ''), sc, space, 'read');
  if (overLimit(asker.found.manifest.id, who.user?.key, 'action')) throw refError(429, limitMessage);
  const provider = busPlace(who, String(providerId || ''), sc, space, 'read');
  const def = provider.found.manifest.actions.provides.find((a) => a.name === name);
  if (!def) throw refError(404, 'that module does not offer that action');
  if (!mayUse(asker.found, providerId, name)) throw refError(403, 'that module has not been approved to ask for that');
  if (!def.local) busPlace(who, String(providerId), sc, space, 'write'); // asking for a change takes the right to make it
  const request = moduleBus.request({ from, provider: providerId, action: name, input: busInput(who, def.input, input), scopeKey: provider.scopeKey, by: who.user?.key || 'guest', local: def.local });
  return { id: request.id, status: request.status };
}));

// The providing module's page: what is waiting, take one, say how it went.
app.get('/api/bus/actions/pending', busRoute((who, req) => {
  const at = busPlace(who, String(req.query.module || ''), busScope(req.query.scope), req.query.space, 'read');
  let canWrite = true;
  try { busPlace(who, String(req.query.module || ''), busScope(req.query.scope), req.query.space, 'write'); } catch { canWrite = false; }
  // A view (`local`) is for the person who asked, from their own page; anything else waits for a page that may make the change.
  return { actions: moduleBus.pending(String(req.query.module), at.scopeKey).filter((a) => (a.local ? a.by === (who.user?.key || 'guest') : canWrite)).map(publicAction) };
}));
app.post('/api/bus/actions/claim', busRoute((who, req) => {
  const { module: id, id: requestId, scope, space } = req.body || {};
  const at = busPlace(who, String(id || ''), busScope(scope), space, 'read');
  const waiting = moduleBus.actionById(Number(requestId));
  if (waiting && waiting.local) { if (waiting.by !== (who.user?.key || 'guest')) return { ok: false }; } else busPlace(who, String(id || ''), busScope(scope), space, 'write');
  const request = moduleBus.claim(Number(requestId), id, at.scopeKey);
  return request ? { ok: true, action: publicAction(request) } : { ok: false };
}));
app.post('/api/bus/actions/complete', busRoute((who, req) => {
  const { module: id, id: requestId, scope, space, result } = req.body || {};
  const at = busPlace(who, String(id || ''), busScope(scope), space, 'read');
  const done = moduleBus.actionById(Number(requestId));
  if (done && done.local) { if (done.by !== (who.user?.key || 'guest')) return { ok: false }; } else busPlace(who, String(id || ''), busScope(scope), space, 'write');
  const clean = { ok: Boolean(result?.ok) };
  if (typeof result?.error === 'string') clean.error = result.error.slice(0, 200);
  // A small piece of plain data may come back with the result (up to about 8 KB of JSON), for a view that asks a question.
  if (result?.data !== undefined) {
    try {
      const text = JSON.stringify(result.data);
      if (text && text.length <= 8000) clean.data = JSON.parse(text);
    } catch (err) { /* not plain data: left out */ }
  }
  if (refShape(result?.ref) && result.ref.module === id) clean.ref = plainRef(result.ref);
  return { ok: Boolean(moduleBus.complete(Number(requestId), id, at.scopeKey, clean)) };
}));
// The asking module: how did it go?
app.get('/api/bus/actions/status', busRoute((who, req) => {
  const from = String(req.query.from || '');
  const at = busPlace(who, from, busScope(req.query.scope), req.query.space, 'read');
  const request = moduleBus.actionById(Number(req.query.id));
  if (!request || request.from !== from || request.scopeKey !== at.scopeKey) throw refError(404, 'no such request');
  return { status: request.status, result: request.result };
}));

// --- what modules have been doing ------------------------------------------------------------
// The last things modules did through the host (data they saved, events they published, actions they asked
// for), so an admin can see, above all for a module running in the page, what it has been up to. Only
// what passes through the host is seen: a module in the page can also do things the host never hears of.
// Kept across a restart (DATA_DIR/modules/activity.json, written a few seconds after a change and on exit).
// Built per environment in server/environment.js (moduleActivity, noteActivity); the event wiring below it
// (a change, a published event, an action asked for -> a line in the activity list) is wired there too.

// How often a module may do things through the host (see server/module-limits.js). Over the limit is a 429 and, the
// first time in a while, a line in the activity list so an admin can see which module is being slowed.
function overLimit(moduleId, by, kind) {
  const r = moduleLimits.take(moduleId, by || 'guest', kind);
  if (r.ok) return null;
  if (r.first) noteActivity(moduleId, `was slowed: too many ${kind === 'write' ? 'saves' : kind + 's'} in a minute`, by, null);
  return r;
}
const limitMessage = 'this module is doing that too often; try again in a moment';
app.get('/api/modules/activity', requireOwner, (_req, res) => {
  res.json({
    activity: moduleActivity.slice(-100).reverse().map((a) => ({ ...a, moduleName: modules.enabled(a.module)?.manifest.name || a.module, byName: store.userByKey(a.by)?.displayName || (a.by === 'guest' ? 'a guest' : a.by) })),
  });
});

// Modules with a page of their own that this viewer can open: the header nav.
// The pre-made backgrounds that ship with the app (see server/backgrounds.js), for the picker beside an image slot.
const backgrounds = new Backgrounds(path.join(publicDir, 'assets', 'images', 'backgrounds'));
app.get('/api/backgrounds', (req, res) => {
  if (!currentUser(req)) return res.status(401).json({ error: 'sign in first' });
  res.json({ backgrounds: backgrounds.all() });
});

// Every enabled module with a server page this viewer may read -- not only the ones shown as a main-nav
// icon (public/module.js also asks this to find a module's own page at all, by direct link or a room's
// own "open this"; `nav` just says whether brand.js's topbar should offer an icon for it too).
app.get('/api/modules/nav', (req, res) => {
  const who = moduleViewer(req);
  if (!who?.user) return res.json({ modules: [] });
  const perms = modulePerms(who, null);
  res.json({
    modules: modules.enabledAll()
      .filter(({ manifest }) => manifest.scope.includes('environment') && manifest.surfaces.page && moduleCan(manifest, perms, 'read'))
      .map(({ manifest, entry }) => ({ id: manifest.id, name: manifest.name, icon: manifest.icon, version: manifest.version, scope: manifest.scope, runMode: modules.runModeOf(entry), page: manifest.surfaces.page.entry, widget: Boolean(manifest.surfaces.widget), nav: Boolean(manifest.surfaces.page.nav) })),
  });
});

// The widgets for the dashboard on the rooms page: enabled modules with a surfaces.widget that this person may
// read, in the order the modules ask for. A guest has no dashboard.
app.get('/api/modules/widgets', (req, res) => {
  const who = moduleViewer(req);
  if (!who?.user) return res.json({ widgets: [] });
  const perms = modulePerms(who, null);
  const widgets = modules.enabledAll()
    .filter(({ manifest }) => manifest.scope.includes('environment') && manifest.surfaces.widget && moduleCan(manifest, perms, 'read'))
    .map(({ manifest, entry }) => ({
      id: manifest.id, name: manifest.name, icon: manifest.icon, version: manifest.version, scope: manifest.scope, runMode: modules.runModeOf(entry),
      title: manifest.surfaces.widget.title || manifest.name, size: manifest.surfaces.widget.size, order: manifest.surfaces.widget.order, entry: manifest.surfaces.widget.entry,
    }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  res.json({ widgets });
});

// --- module settings -------------------------------------------------------------------------------------
// What a module declares (module.json `settings`) and what people choose (server/module-settings.js). A module reads
// the values that apply to the viewer; the forms that change them are drawn by the host on the Modules tab (the server's),
// a room's own page (the room's) and the profile page (a person's own). Who may change what: the server's, an admin; a
// room's, an admin or one of that room's moderators; a person's own, that person.

// --- AI, for the modules that ask ---------------------------------------------------------------------------------------------
// One server-wide setting (see ai.js); the key never leaves the server and is never sent back. A module asks through the `ai` hook:
// the server checks the person's role and the room, reads the chosen items as that person, asks the service the admin set up, and
// returns text with any cards the model wrote (each checked). Nothing is kept: no question, no answer, no item text. The activity
// list gets who, which module and task, and how many tokens.
function sendAiError(err, res) {
  if (err instanceof AiError) return res.status(err.status).json({ error: err.message });
  throw err;
}
app.get('/api/ai', requireOwner, (_req, res) => res.json({ ai: ai.view(), usage: ai.usageView(), dependents: modules.aiDependents() }));
app.post('/api/ai/models', requireOwner, async (req, res) => {
  try {
    res.json({ models: await ai.listModels({ provider: String(req.body?.provider || ''), address: req.body?.address, key: req.body?.key, workspace: req.body?.workspace }) });
  } catch (err) {
    sendAiError(err, res);
  }
});
app.put('/api/ai', requireOwner, (req, res) => {
  try {
    const before = ai.view();
    // Turning AI off (however the patch does it) while a module depends on it: the admin's page should have asked first (as it
    // does for a module others `requires`); a caller that skipped that, or forces past it, is handled the same way.
    if (before.enabled && !ai.previewEnabled(req.body || {}) && req.body?.force !== true) {
      const dependents = modules.aiDependents();
      if (dependents.length) throw new AiError(`${dependents.map((m) => m.name).join(' and ')} needs the AI service; turn ${dependents.length === 1 ? 'it' : 'them'} off too?`);
    }
    const after = ai.set(req.body || {});
    if (before.enabled && !after.enabled) for (const m of modules.aiDependents()) modules.update(m.id, { enabled: false, force: true });
    noteActivity('host', `changed the AI setting (${after.provider}${after.keySet && !before.keySet ? ', key set' : ''})`, currentUser(req)?.key, null);
    res.json({ ai: after, usage: ai.usageView(), dependents: modules.aiDependents() });
  } catch (err) {
    sendAiError(err, res);
  }
});
// Whether AI is available to this person here (for a page to show or hide its buttons): { available, why? }.
function aiAllowed(ctx) {
  const user = ctx.who.user;
  if (!user) return { ok: false, why: 'guests cannot use AI' };
  if (!ai.ready()) return { ok: false, why: 'AI is not set up on this server' };
  const space = ctx.spaceId ? store.spaceById(ctx.spaceId) : null;
  if (space && space.aiOff) return { ok: false, why: 'AI is turned off in this space' };
  const perms = ctx.spaceId ? store.spacePermissions(user.key, ctx.spaceId) : store.roleSet(user.role);
  if (!perms.useAi) return { ok: false, why: 'your role may not use AI' };
  return { ok: true };
}
app.get('/api/modules/:id/ai', (req, res) => {
  const ctx = moduleAccess(req, res, 'read');
  if (!ctx || !requireHook(ctx, res, 'ai')) return;
  const a = aiAllowed(ctx);
  res.json({ available: a.ok, why: a.why || '' });
});
app.post('/api/modules/:id/ai', async (req, res) => {
  const ctx = moduleAccess(req, res, 'write');
  if (!ctx || !requireHook(ctx, res, 'ai')) return;
  const allowed = aiAllowed(ctx);
  if (!allowed.ok) return res.status(403).json({ error: allowed.why });
  if (refuseOverAiCalls(res)) return;
  if (overLimit(ctx.manifest.id, ctx.by, 'ai')) return res.status(429).json({ error: limitMessage });
  const refs = Array.isArray(req.body?.items) ? req.body.items.slice(0, 12) : [];
  // The items are read as this person: only what they may see, and only kinds this module produces or was approved to link to.
  const items = [];
  const given = [];
  for (const ref of refs) {
    try {
      const own = ref && ref.module === ctx.manifest.id;
      const card = resolveRef(ctx.who, ref, ctx.manifest.id, { withText: true, skipConsumer: own });
      const bits = [card.subtitle, card.when ? `date: ${card.when}` : '', card.place && card.place.name ? `place: ${card.place.name}` : ''].filter(Boolean);
      items.push({ title: card.title, text: [card.text, ...bits].filter(Boolean).join('\n') || card.title });
      given.push(card.ref);
    } catch {
      // an item that is gone, or that this person may not see, is simply left out
    }
  }
  try {
    const task = String(req.body?.task || '');
    const out = await ai.run(task, items, req.body?.question);
    // Counted on the registry entry regardless of provider (managed or the environment's own key) -- the plan's
    // aiCallsPerMonth cap is about how much of the environment's own allowance is used, not who is paying for
    // the tokens (plan-tenants.md, "Phase 3"). ai.js keeps its own separate per-provider token accounting.
    if (BASE_DOMAIN && hostRegistry) {
      const slug = currentEnvironment().slug;
      if (slug) hostRegistry.recordAiCall(slug);
    }
    noteActivity(ctx.manifest.id, `used AI to ${task} (${out.tokens} tokens)`, ctx.by, ctx.scopeKey);
    res.json({ text: out.text, cards: (out.cards || []).map((c) => ({ ...c, sources: (c.sources || []).map((n) => given[n - 1]).filter(Boolean) })), tags: out.tags, used: out.used.map((n) => given[n - 1]).filter(Boolean), tokens: out.tokens });
  } catch (err) {
    sendAiError(err, res);
  }
});

// --- files a module's people upload ---------------------------------------------------------------------------------------
// A module that declares `uploads` keeps pictures per scope (server, room, person), with the same read and write permissions as
// its data. The server checks what arrives from the bytes themselves and takes out what rides along (see image-clean.js).
const rawUpload = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: 10 * 1024 * 1024 + 1024 });
function uploadAccess(req, res, need) {
  const ctx = moduleAccess(req, res, need);
  if (!ctx) return null;
  if (!ctx.manifest.uploads) { res.status(404).json({ error: 'this module keeps no uploaded files' }); return null; }
  return ctx;
}
const uploadView = (f) => ({ id: f.id, name: f.name, type: f.type, size: f.size, by: f.by, at: f.at, taken: f.taken, camera: f.camera, hasPosition: f.hasPosition, position: f.position, hasThumb: !!f.thumb });
app.get('/api/modules/:id/uploads', (req, res) => {
  const ctx = uploadAccess(req, res, 'read');
  if (!ctx) return;
  res.json({ files: moduleUploads.list(ctx.manifest.id, ctx.scopeKey).map(uploadView) });
});
app.post('/api/modules/:id/uploads', rawUpload, checkStorageCap, (req, res) => {
  const ctx = uploadAccess(req, res, 'write');
  if (!ctx) return;
  if (overLimit(ctx.manifest.id, ctx.by, 'upload')) return res.status(429).json({ error: limitMessage });
  if (!Buffer.isBuffer(req.body)) return res.status(415).json({ error: 'send the picture itself, as a JPEG, PNG or WebP' });
  const file = moduleUploads.put(ctx.manifest.id, ctx.scopeKey, ctx.manifest.uploads, { bytes: req.body, name: req.query.name, by: ctx.by, keepPosition: req.query.keepPosition === '1' });
  res.status(201).json({ file: uploadView(file) });
});
// What the start of a picture says about itself, for a page that will resize it (a resize loses the picture's own facts): send its
// first ~256 KB. The answer goes only to the person who sent it.
app.post('/api/modules/:id/uploads/inspect', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: 300 * 1024 }), (req, res) => {
  const ctx = uploadAccess(req, res, 'write');
  if (!ctx) return;
  if (overLimit(ctx.manifest.id, ctx.by, 'upload')) return res.status(429).json({ error: limitMessage });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(415).json({ error: 'send the start of the picture' });
  res.json(inspectHead(req.body));
});
app.put('/api/modules/:id/uploads/:fid/thumb', rawUpload, checkStorageCap, (req, res) => {
  const ctx = uploadAccess(req, res, 'write');
  if (!ctx) return;
  const meta = moduleUploads.meta(ctx.manifest.id, ctx.scopeKey, req.params.fid);
  if (!meta) return res.status(404).json({ error: 'no such file' });
  if (meta.by !== ctx.by && !hasOwnerRights(ctx.who.user)) return res.status(403).json({ error: 'only the person who added it can do that' });
  if (!Buffer.isBuffer(req.body)) return res.status(415).json({ error: 'send the thumbnail itself, as a JPEG, PNG or WebP' });
  res.json({ file: uploadView(moduleUploads.putThumb(ctx.manifest.id, ctx.scopeKey, ctx.manifest.uploads, req.params.fid, req.body)) });
});
function sendUpload(req, res, thumb) {
  const ctx = uploadAccess(req, res, 'read');
  if (!ctx) return;
  const f = moduleUploads.read(ctx.manifest.id, ctx.scopeKey, req.params.fid, thumb);
  if (!f) return res.status(404).json({ error: 'no such file' });
  // A picture and nothing else, whatever it claims to be, and never run as a page; kept private to the person and their browser.
  res.set({ 'Content-Type': f.type, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Cache-Control': 'private, max-age=3600' }).send(f.bytes);
}
app.get('/api/modules/:id/uploads/:fid', (req, res) => sendUpload(req, res, false));
app.get('/api/modules/:id/uploads/:fid/thumb', (req, res) => sendUpload(req, res, true));
app.delete('/api/modules/:id/uploads/:fid', (req, res) => {
  const ctx = uploadAccess(req, res, 'write');
  if (!ctx) return;
  const meta = moduleUploads.meta(ctx.manifest.id, ctx.scopeKey, req.params.fid);
  if (!meta) return res.status(404).json({ error: 'no such file' });
  // The person who added a file, or an administrator, removes it. (A module decides who may remove its items; this is the guard on the bytes.)
  if (meta.by !== ctx.by && !hasOwnerRights(ctx.who.user)) return res.status(403).json({ error: 'only the person who added it can remove it' });
  moduleUploads.remove(ctx.manifest.id, ctx.scopeKey, req.params.fid);
  res.json({ ok: true });
});

// --- place search, from the server -----------------------------------------------------------------------------------------
// A module that declares `geocoder` in its manifest has its searches for places answered here: from the saved places first, then
// (when there are too few) from the service its settings name, keeping what comes back if the admin allows it. See geocode.js.
function geocodeAccess(req, res, need) {
  const ctx = moduleAccess(req, res, need);
  if (!ctx) return null;
  if (!ctx.manifest.geocoder) { res.status(404).json({ error: 'this module has no place search' }); return null; }
  return ctx;
}
// Where this module's search goes now: { name, address, credit } or null when none is chosen.
function geocodeSetup(manifest) {
  const g = manifest.geocoder;
  const values = moduleSettings.values(manifest, 'environment', {});
  const chosen = values[g.provider];
  const known = g.providers[chosen];
  if (known) return { name: known.name, address: known.address, credit: known.credit, save: g.save ? values[g.save] === true : false };
  if (chosen === g.custom && typeof values[g.address] === 'string' && /^https?:\/\//i.test(values[g.address])) return { name: 'the search service', address: values[g.address], credit: '', save: g.save ? values[g.save] === true : false };
  return null;
}
app.get('/api/modules/:id/geocode', async (req, res) => {
  const ctx = geocodeAccess(req, res, 'read');
  if (!ctx) return;
  const q = String(req.query.q || '').trim().slice(0, 200);
  if (q.length < 2) return res.json({ results: [], configured: true });
  const setup = geocodeSetup(ctx.manifest);
  if (!setup) return res.json({ results: [], configured: false });
  if (overLimit(ctx.manifest.id, ctx.who.user?.key, 'search')) return res.status(429).json({ error: limitMessage });
  const near = req.query.lat !== undefined ? { lat: Number(req.query.lat), lon: Number(req.query.lon) } : null;
  const id = ctx.manifest.id;
  const pick = (r, source, from) => ({ key: r.key, title: r.name, sub: r.address, lat: r.lat, lng: r.lng, source, from });
  // Saved places first: enough of them and the outside service is not asked.
  const saved = setup.save ? geocodeCache.search(id, q, near, 10).map((r) => pick(r, 'server', 'Saved on this server')) : [];
  if (saved.length >= ENOUGH) return res.json({ results: saved.slice(0, 8), configured: true, credit: setup.credit });
  try {
    const found = await askService(setup.address, q, near);
    const kept = setup.save ? geocodeCache.remember(id, found) : found.map((p) => ({ ...p, key: keyOfPlace(p) }));
    const fromService = kept.map((r) => pick(r, 'service', `From ${setup.name}`));
    const seen = new Set(saved.map((r) => r.key));
    res.json({ results: [...saved, ...fromService.filter((r) => !seen.has(r.key))].slice(0, 8), configured: true, credit: setup.credit });
  } catch (err) {
    if (saved.length) return res.json({ results: saved, configured: true, credit: setup.credit });
    res.status(502).json({ error: 'search is not available right now' });
  }
});
// Someone picked a result (or saved it as a place): mark it used, which protects it from being purged.
app.post('/api/modules/:id/geocode/use', (req, res) => {
  const ctx = geocodeAccess(req, res, 'write');
  if (!ctx) return;
  res.json({ ok: geocodeCache.markUsed(ctx.manifest.id, String(req.body?.key || '')) });
});
// For the admin: how many places are saved, and removing them by their mark.
app.get('/api/modules/:id/geocode/stats', requireOwner, (req, res) => {
  const found = modules.enabled(req.params.id);
  if (!found || !found.manifest.geocoder) return res.status(404).json({ error: 'no such place search' });
  res.json(geocodeCache.stats(found.manifest.id));
});
app.post('/api/modules/:id/geocode/purge', requireOwner, (req, res) => {
  const found = modules.enabled(req.params.id);
  if (!found || !found.manifest.geocoder) return res.status(404).json({ error: 'no such place search' });
  const what = req.body?.what === 'all' ? 'all' : req.body?.what === 'unused' ? 'unused' : null;
  if (!what) return res.status(400).json({ error: 'say what to remove: unused or all' });
  const days = Number(req.body?.olderThanDays);
  res.json({ removed: geocodeCache.purge(found.manifest.id, what, Number.isFinite(days) && days > 0 ? days : 0), ...geocodeCache.stats(found.manifest.id) });
});
// --- cutting a region out of a larger PMTiles file, from the server -----------------------------------------------------------
// A module that declares `regionSource` (see server/region-cut.js and documentation/plans/plan-map-region-download.md) offers
// "Add a region" in its Module Configuration: cut a piece of a world file into one of its own file folders. Admin only, since
// it can take a while and reads a server setting (the world file's address).
function sendRegionCutError(err, res) {
  if (err instanceof RegionCutError) return res.status(err.status).json({ error: err.message });
  throw err;
}
// Where this module's world file is, from its own settings: { address, folder }, or null when nothing is set up.
function regionSourceOf(manifest) {
  const r = manifest.regionSource;
  if (!r) return null;
  const address = moduleSettings.values(manifest, 'environment', {})[r.address];
  return typeof address === 'string' && address ? { address, folder: r.folder } : null;
}
function regionCutSetup(req, res) {
  const found = modules.enabled(req.params.id);
  if (!found) { res.status(404).json({ error: 'no such module' }); return null; }
  if (found.manifest.regionSource && folderIsShared(found.manifest, found.manifest.regionSource.folder)) {
    res.status(403).json({ error: 'managed by the host' });
    return null;
  }
  const setup = regionSourceOf(found.manifest);
  if (!setup) { res.status(404).json({ error: 'this module has no world file set up to cut from' }); return null; }
  return { manifest: found.manifest, setup };
}
const boxFromBody = (b) => ({ minLon: Number(b?.minLon), minLat: Number(b?.minLat), maxLon: Number(b?.maxLon), maxLat: Number(b?.maxLat) });
// A place's rough rectangle, from whichever enabled module has a place search configured (never named here: found the same
// way any other generic conduit is, by what a module declares, not by which one it happens to be). Places is the one that
// offers this today; anything with a `geocoder` in its manifest would be found the same way.
// Returns null when no enabled module has a configured search, otherwise `{ name, box }` (box null when nothing matched).
async function findRegionBox(q) {
  for (const { manifest } of modules.enabledAll()) {
    if (!manifest.geocoder) continue;
    const setup = geocodeSetup(manifest);
    if (!setup) continue;
    const found = await askService(setup.address, q, null);
    const best = found.find((p) => p.extent);
    return best ? { name: best.name, box: best.extent } : { name: null, box: null };
  }
  return null;
}
// "Add a region": type a place's name, get back its rough rectangle to cut, before anything is fetched for real.
app.get('/api/modules/:id/region-cut/find', requireOwner, async (req, res) => {
  const ctx = regionCutSetup(req, res);
  if (!ctx) return;
  const q = String(req.query.q || '').trim().slice(0, 200);
  if (q.length < 2) return res.status(400).json({ error: 'type a place name first' });
  try {
    const found = await findRegionBox(q);
    if (found === null) return res.status(404).json({ error: 'no place search is set up on this server (a module with one, such as Places, names where to look)' });
    res.json(found.box ? { found: true, name: found.name, box: found.box } : { found: false });
  } catch (err) {
    res.status(502).json({ error: 'search is not available right now' });
  }
});
// How big a cut would be, without downloading it: the admin confirms before "Add a region" commits to anything.
app.post('/api/modules/:id/region-cut/estimate', requireOwner, async (req, res) => {
  const ctx = regionCutSetup(req, res);
  if (!ctx) return;
  try {
    res.json(await regionCutJobs.estimate({ source: ctx.setup.address, box: boxFromBody(req.body), maxZoom: Number(req.body?.maxZoom), minZoom: req.body?.minZoom !== undefined ? Number(req.body.minZoom) : undefined }));
  } catch (err) {
    sendRegionCutError(err, res);
  }
});
// Start the real cut; the job runs in the background, followed over the stream route below.
app.post('/api/modules/:id/region-cut', requireOwner, async (req, res) => {
  const ctx = regionCutSetup(req, res);
  if (!ctx) return;
  try {
    const out = await regionCutJobs.start({
      moduleId: ctx.manifest.id,
      scopeKey: 'environment',
      source: ctx.setup.address,
      folder: ctx.setup.folder,
      name: String(req.body?.name || ''),
      box: boxFromBody(req.body),
      minZoom: req.body?.minZoom !== undefined ? Number(req.body.minZoom) : undefined,
      maxZoom: Number(req.body?.maxZoom),
      by: currentUser(req)?.key,
      replace: Boolean(req.body?.replace),
    });
    res.status(202).json(out);
  } catch (err) {
    sendRegionCutError(err, res);
  }
});
// Progress, in words and a percentage, over server-sent events; a late subscriber gets the job's current state first, and
// one already finished (or one the host has never heard of) is told so at once rather than hanging.
app.get('/api/modules/:id/region-cut/:jobId/stream', requireOwner, (req, res) => {
  const env = currentEnvironment(); // captured once: the close handler below fires later, outside this request
  const found = modules.enabled(req.params.id);
  if (!found || !found.manifest.regionSource) return res.status(404).json({ error: 'no such module' });
  const job = regionCutJobs.view(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'that cut is not running (it may have finished a while ago)' });
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  res.write(`event: progress\ndata: ${JSON.stringify({ percent: job.percent, message: job.message })}\n\n`);
  if (job.status !== 'running') {
    res.write(`event: ${job.status}\ndata: ${JSON.stringify(job.status === 'done' ? { name: job.name } : { error: job.error })}\n\n`);
    return res.end();
  }
  const { jobId } = req.params;
  const cleanup = () => { regionCutJobs.off('progress', onProgress); regionCutJobs.off('done', onDone); regionCutJobs.off('error', onErr); };
  const onProgress = (id, p) => { if (id === jobId) res.write(`event: progress\ndata: ${JSON.stringify(p)}\n\n`); };
  const onDone = (id, d) => { if (id !== jobId) return; res.write(`event: done\ndata: ${JSON.stringify(d)}\n\n`); cleanup(); res.end(); };
  const onErr = (id, error) => { if (id !== jobId) return; res.write(`event: error\ndata: ${JSON.stringify({ error })}\n\n`); cleanup(); res.end(); };
  regionCutJobs.on('progress', onProgress);
  regionCutJobs.on('done', onDone);
  regionCutJobs.on('error', onErr);
  req.on('close', () => envContext.run(env, cleanup));
});
// A settings change -> a line in the activity list: wired per environment in server/environment.js, on that
// environment's own real moduleSettings (this used to be one top-level listener; now it's one per environment).
function sendSettingError(err, res) {
  if (err instanceof SettingError) return res.status(err.status).json({ error: err.message });
  throw err;
}

// --- files an admin placed for a module ---------------------------------------------------------------------
// Some modules need a large file that cannot be uploaded through a page (a map's tile archive, gigabytes): the operator
// copies it into the folder the module's `file` setting names inside its own folder, the admin picks it in the
// module's settings, and the module reads it here, by range, like any static file. Nothing else in that folder
// is reachable, and only by name. Uninstalling and updating never touch it.
//
// A folder declared `shared: "host"` (documentation/plans/plan-tenants.md, "Shared files: the host's map") is
// the host's, one for every environment, rather than each environment's own -- but only with a base domain;
// without one there is no separate host, so the declaration has no effect and an environment keeps its files
// and region cutting exactly as it always has.
function folderIsShared(manifest, folder) {
  return Boolean(BASE_DOMAIN) && (manifest.settings || []).some((d) => (d.type === 'file' || d.type === 'files') && d.folder === folder && d.shared === 'host');
}
// Whether one specific setting is shared right now: a shared files/file setting itself, or the url setting
// that is its regionSource's own address (a shared folder's world file is the host's to set, not the
// environment's).
function settingIsShared(manifest, def) {
  if (def.type === 'file' || def.type === 'files') return folderIsShared(manifest, def.folder);
  return Boolean(manifest.regionSource && def.key === manifest.regionSource.address && folderIsShared(manifest, manifest.regionSource.folder));
}
// Where a module's file-setting folder actually lives: the host's own (DATA_DIR/shared/<id>/<folder>/) for one
// shared right now; this environment's own otherwise (its own dataDir/modules/<id>/<folder>/ -- with no
// BASE_DOMAIN that is DATA_DIR itself, exactly where files have always lived).
function filesDirFor(manifest, folder) {
  if (folderIsShared(manifest, folder)) return path.resolve(DATA_DIR, 'shared', manifest.id, folder);
  return path.resolve(currentEnvironment().dataDir, 'modules', manifest.id, folder);
}
const FILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
// What is in a folder: the usable files, and each thing skipped with the reason, so an admin whose file does not
// show up is told why. A link to a file (a NAS shortcut) counts as the file. The lower-level scan, so the
// host's own listing of a shared folder (GET /api/host/shared, no manifest or environment in view) can use it
// the same way inspectModuleFiles does.
function inspectDir(folder) {
  const out = { folder, exists: false, files: [], sizes: {}, zooms: {}, skipped: [] };
  let names;
  try {
    names = fs.readdirSync(folder);
    out.exists = true;
  } catch {
    return out;
  }
  for (const name of names.sort()) {
    if (!FILE_NAME_RE.test(name)) {
      out.skipped.push({ name: name.slice(0, 100), reason: 'a name may use letters, digits, dot, dash and underscore, and must start with a letter or digit, up to 100 characters' });
      continue;
    }
    let st = null;
    try { st = fs.statSync(path.join(folder, name)); } catch { /* a broken link */ }
    if (st && st.isFile()) {
      out.files.push(name);
      out.sizes[name] = st.size;
      // How detailed a map file is (street-level or not), read from its own header -- the file's own truth, so this
      // works whether it was cut with "Add a region" or dropped in by hand.
      if (/\.pmtiles$/i.test(name)) {
        const z = pmtilesZoomRange(path.join(folder, name));
        if (z) out.zooms[name] = z;
      }
    } else out.skipped.push({ name, reason: st ? 'not a regular file (a folder or something else)' : 'a link that leads nowhere' });
  }
  return out;
}
const inspectModuleFiles = (manifest, sub) => inspectDir(filesDirFor(manifest, sub));
const listModuleFiles = (manifest, sub) => inspectModuleFiles(manifest, sub).files;
// The path of a file a module's file settings can name, or null.
const moduleFilePath = (manifest, name) => {
  if (!FILE_NAME_RE.test(name)) return null;
  for (const d of manifest.settings || []) if ((d.type === 'file' || d.type === 'files') && listModuleFiles(manifest, d.folder).includes(name)) return path.join(filesDirFor(manifest, d.folder), name);
  return null;
};
// The same, in words, for the log and for the picker.
function describeModuleFiles(manifest, sub) {
  const f = inspectModuleFiles(manifest, sub);
  if (!f.exists) return `${f.folder} does not exist yet`;
  const skipped = f.skipped.map((s) => `${s.name} (${s.reason})`).join('; ');
  return `${f.folder} has ${f.files.length} usable file${f.files.length === 1 ? '' : 's'}${f.files.length ? ': ' + f.files.join(', ') : ''}${f.skipped.length ? `; ignored ${f.skipped.length}: ${skipped}` : ''}`;
}
// A file for a module page, with range requests (what a map archive is read with). Needs the same access as reading
// the module's data in that place.
app.get('/api/modules/:id/files/:name', (req, res) => {
  const ctx = moduleAccess(req, res, 'read');
  if (!ctx) return;
  const name = req.params.name;
  const file = moduleFilePath(ctx.manifest, name);
  if (!file) return res.status(404).json({ error: 'no such file' });
  res.sendFile(file, { acceptRanges: true, headers: { 'Cache-Control': 'private, max-age=3600', 'Content-Type': 'application/octet-stream' } });
});
// Remove a file an admin placed for the module (a `file`/`files` setting) -- gone for good, so admin only. Also
// un-ticks it from any `files` setting that had it, and clears a `file` setting that pointed to it, so nothing on
// the module's own settings keeps naming a file that is no longer there.
app.delete('/api/modules/:id/files/:name', requireOwner, (req, res) => {
  const found = modules.enabled(req.params.id);
  if (!found) return res.status(404).json({ error: 'no such module' });
  const name = req.params.name;
  const def = (found.manifest.settings || []).find((d) => (d.type === 'file' || d.type === 'files') && listModuleFiles(found.manifest, d.folder).includes(name));
  if (!def) return res.status(404).json({ error: 'no such file' });
  if (settingIsShared(found.manifest, def)) return res.status(403).json({ error: 'managed by the host' });
  const file = moduleFilePath(found.manifest, name);
  if (!file) return res.status(404).json({ error: 'no such file' });
  try {
    fs.unlinkSync(file);
  } catch (err) {
    return res.status(500).json({ error: `the file could not be removed: ${err.message}` });
  }
  const by = currentUser(req)?.key || null;
  const values = moduleSettings.values(found.manifest, 'environment', {});
  for (const d of found.manifest.settings || []) {
    if (d.type === 'files' && Array.isArray(values[d.key]) && values[d.key].includes(name)) {
      moduleSettings.set(found.manifest, 'environment', {}, { [d.key]: values[d.key].filter((n) => n !== name) }, by);
    } else if (d.type === 'file' && values[d.key] === name) {
      moduleSettings.set(found.manifest, 'environment', {}, { [d.key]: '' }, by);
    }
  }
  res.json({ ok: true });
});

// The values that apply to the viewer, for the module itself.
// A shared setting's real value is the host's, not whatever this environment's own (unused) copy holds --
// every file in the shared folder (nothing to tick), or the host's own saved region source address. Shared by
// GET /api/modules/:id/settings/values (a module reading its own settings) and withValues (the admin's own
// settings form) below, so both ever answer the same thing for it.
function sharedValue(manifest, def) {
  if (def.type === 'files') return listModuleFiles(manifest, def.folder);
  if (def.type === 'file') return listModuleFiles(manifest, def.folder)[0] || '';
  return hostRegistry.sharedFolderAddress(manifest.id, manifest.regionSource.folder);
}
app.get('/api/modules/:id/settings/values', (req, res) => {
  const ctx = moduleAccess(req, res, 'read');
  if (!ctx) return;
  const values = moduleSettings.effective(ctx.manifest, { spaceId: ctx.spaceId, userKey: ctx.who.user?.key || null });
  for (const d of ctx.manifest.settings || []) if (settingIsShared(ctx.manifest, d)) values[d.key] = sharedValue(ctx.manifest, d);
  res.json({ values });
});

// Who may change the settings of a scope, and where they are kept; sends the error itself and returns null when not.
function settingsPlace(req, res, scope) {
  const user = currentUser(req);
  if (!user) return void res.status(401).json({ error: 'sign in first' });
  if (scope === 'environment') {
    if (!hasOwnerRights(user)) return void res.status(403).json({ error: 'only an owner changes the environment\'s settings' });
    return { user, ctx: {} };
  }
  if (scope === 'person') return { user, ctx: { userKey: user.key } };
  if (scope === 'space') {
    const space = store.spaceById(String(req.query.space || req.body?.space || ''));
    if (!space) return void res.status(404).json({ error: 'no such space' });
    // A moderator is a member ticked as one in that space (an owner ticks it on the member's profile).
    if (!(hasOwnerRights(user) || (space.members.includes(user.key) && store.spaceFlags(user.key, space.id).moderator))) return void res.status(403).json({ error: 'only an owner or the space\'s moderators change its settings' });
    return { user, ctx: { spaceId: space.id }, space };
  }
  return void res.status(404).json({ error: 'no such kind of setting' });
}
const withValues = (manifest, scope, ctx) => {
  const values = moduleSettings.values(manifest, scope, ctx);
  return manifest.settings.filter((d) => d.scope === scope).map((d) => {
    const shared = settingIsShared(manifest, d);
    return {
      ...d,
      value: shared ? sharedValue(manifest, d) : values[d.key],
      ...(shared ? { shared: true } : {}),
      ...(d.type === 'file' || d.type === 'files' ? (({ files, ...rest }) => ({ available: files, ...rest }))(inspectModuleFiles(manifest, d.folder)) : {}),
    };
  });
};

// The modules that have settings of a scope here, each with its settings and their values.
app.get('/api/module-settings/:scope', (req, res) => {
  const place = settingsPlace(req, res, req.params.scope);
  if (!place) return;
  const scope = req.params.scope;
  const out = modules.enabledAll()
    .filter(({ manifest, entry }) => manifest.settings.some((d) => d.scope === scope) && (scope !== 'space' || entry.allSpaces || entry.spaces.includes(place.space.id)))
    .map(({ manifest }) => ({ id: manifest.id, name: manifest.name, icon: manifest.icon, settings: withValues(manifest, scope, place.ctx) }));
  res.json({ modules: out });
});
app.put('/api/modules/:id/settings/:scope', (req, res) => {
  const place = settingsPlace(req, res, req.params.scope);
  if (!place) return;
  const found = modules.enabled(req.params.id);
  if (!found) return res.status(404).json({ error: 'no such module' });
  try {
    // A shared setting (its files, or the world address that cuts into them) is the host's while there is
    // one; ignored here rather than refusing the whole save, so a page saving several settings together still
    // saves the ones that are its own.
    const values = { ...(req.body?.values || {}) };
    for (const d of found.manifest.settings) if (settingIsShared(found.manifest, d)) delete values[d.key];
    for (const [key, v] of Object.entries(values)) {
      const def = found.manifest.settings.find((d) => d.key === key);
      if (def && def.type === 'files' && Array.isArray(v)) { const have = listModuleFiles(found.manifest, def.folder); const gone = v.find((n) => !have.includes(n)); if (gone) throw new SettingError(`${def.label}: there is no file called ${gone} for this module`); }
      if (def && def.type === 'file' && v && !listModuleFiles(found.manifest, def.folder).includes(v)) throw new SettingError(`${def.label}: there is no file called ${v} for this module`);
    }
    moduleSettings.set(found.manifest, req.params.scope, place.ctx, values, place.user.key);
    res.json({ settings: withValues(found.manifest, req.params.scope, place.ctx) });
  } catch (err) {
    sendSettingError(err, res);
  }
});

// Who is looking and what they may do in this module, for the frame's hello.
app.get('/api/modules/:id/context', (req, res) => {
  const ctx = moduleAccess(req, res, 'read');
  if (!ctx) return;
  const { manifest, perms, who } = ctx;
  res.json({
    user: who.keyed ? { key: 'viewer', name: 'Viewer', role: 'viewer' } : who.user ? { key: who.user.key, name: who.user.displayName, role: who.user.role } : { key: 'guest', name: 'Guest', role: 'guest' },
    permissions: Object.fromEntries(manifest.permissions.map((p) => [p.key, Boolean(perms[`module.${manifest.id}.${p.key}`])])),
    // `nav`: the admin allowed this module into the primary nav (surfaces.page.nav), which is what lets a system-wide
    // tool of its own into that bar (host.nav.set; see api-module-sdk.md, "Registering into the nav bars").
    module: { id: manifest.id, name: manifest.name, version: manifest.version, icon: manifest.icon, nav: Boolean(manifest.surfaces.page && manifest.surfaces.page.nav) },
    // How the server shows language, time and money (Manage > Settings), for every module to follow.
    // `currencies`: the codes the server takes (as GET /api/currencies), for a module's currency picker.
    locale: { language: store.settings.language || 'en', clock: store.settings.clock === '24' ? '24' : '12', currency: store.settings.currency || 'USD', currencies: currencyCodes(store.settings.currency) },
  });
});

// Modules with a panel in one space, for the call's Modules button.
app.get('/api/modules/for-space', (req, res) => {
  const who = moduleViewer(req);
  if (!who) return res.status(401).json({ error: 'sign in first' });
  const space = store.spaceById(String(req.query.space || ''));
  if (!space) return res.status(404).json({ error: 'no such space' });
  const perms = modulePerms(who, space.id);
  res.json({
    modules: modules.enabledAll()
      .filter(({ manifest, entry }) => manifest.scope.includes('space') && manifest.surfaces.panel && moduleSpaceAccess(entry, who, space) && moduleCan(manifest, perms, 'read'))
      .map(({ manifest, entry }) => ({ id: manifest.id, name: manifest.name, icon: manifest.icon, version: manifest.version, scope: manifest.scope, runMode: modules.runModeOf(entry), panel: manifest.surfaces.panel, permissions: manifest.permissions.map((p) => `module.${manifest.id}.${p.key}`).filter((k) => perms[k]) })),
  });
});

// One module's own page, for its full-width server page: the shell page
// (public/module.html) reads the module id from the address.
// A space's panel popped out into its own window opens the same page with the
// space in the query, ?space=<id> (and a guest's link token, if that is who is looking).
app.get('/modules/:id', (req, res) => {
  if (!currentUser(req) && !hasGuestAccess(req)) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  res.sendFile(page('module.html'));
});

// The module's own files. Sandboxed by header, so even opened directly they
// run with no access to the app's pages or cookies, and can only load their own files.
app.get('/m/:id/:version/*path', (req, res) => {
  const rel = [].concat(req.params.path).join('/');
  const file = modules.resolveFile(req.params.id, req.params.version, rel);
  if (!file) return res.status(404).end();
  // A module that runs in the page (not in a frame) is loaded in parts: its styles, its markup and its
  // script, taken from its single HTML file, each for the page to place in the module's own container.
  const part = req.query.part;
  if (part === 'css' || part === 'body' || part === 'js') {
    const found = modules.enabled(req.params.id);
    if (!found || modules.runModeOf(found.entry) !== 'page' || !/\.html?$/i.test(file)) return res.status(403).json({ error: 'that module does not run in the page' });
    const html = fs.readFileSync(file, 'utf8');
    const grab = (re) => [...html.matchAll(re)].map((m) => m[1]).join('\n');
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
    if (part === 'css') return res.type('text/css').send(grab(/<style\b[^>]*>([\s\S]*?)<\/style>/gi));
    if (part === 'js') return res.type('application/javascript').send(grab(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi));
    const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html);
    return res.type('text/html').send((body ? body[1] : html).replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, ''));
  }
  res.set({
    'Content-Security-Policy': "sandbox allow-scripts allow-forms; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
    'X-Content-Type-Options': 'nosniff',
    // A sandboxed frame has an opaque origin, so its own scripts and fonts load as cross-origin.
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Cache-Control': 'no-cache',
  });
  if (!/\.html?$/i.test(file)) return res.sendFile(file, { dotfiles: 'deny' });
  // A module's HTML pages get the SDK and the base styles inline, so a module
  // needs no <script> or <link> for them (and works even where a sandboxed
  // frame is not allowed to load its own subresources). A page that already
  // includes /sdk/host.js keeps what it has; <meta name="sdk-base"
  // content="none"> leaves the base styles out.
  let html = fs.readFileSync(file, 'utf8');
  if (!html.includes('/sdk/host.js')) {
    const sdk = fs.readFileSync(path.join(publicDir, 'sdk', 'host.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
    const css = /<meta[^>]+name=["']sdk-base["'][^>]+content=["']none["']/i.test(html) ? '' : fs.readFileSync(path.join(publicDir, 'sdk', 'host.css'), 'utf8');
    const inject = `${css ? `<style id="sdk-base">${css}</style>` : ''}<script id="sdk-script">${sdk}</script>`;
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + inject) : inject + html;
  }
  res.type('html').send(html);
});

app.get('/api/modules/:id/data', (req, res) => {
  const ctx = moduleAccess(req, res, 'read');
  if (!ctx) return;
  res.json({ items: moduleData.list(ctx.manifest.id, ctx.scopeKey, typeof req.query.prefix === 'string' ? req.query.prefix : '') });
});
app.get('/api/modules/:id/data/:key', (req, res) => {
  const ctx = moduleAccess(req, res, 'read');
  if (!ctx) return;
  const item = moduleData.get(ctx.manifest.id, ctx.scopeKey, req.params.key);
  if (!item) return res.status(404).json({ error: 'not found' });
  res.json({ item });
});
function sendModuleConflict(err, res) {
  if (err.status === 409) return res.status(409).json({ error: err.message, current: err.current || null });
  throw err;
}
app.put('/api/modules/:id/data/:key', (req, res) => {
  const ctx = moduleAccess(req, res, 'write');
  if (!ctx) return;
  const slow = overLimit(ctx.manifest.id, ctx.by, 'write');
  if (slow) return void res.set('Retry-After', String(slow.retrySeconds)).status(429).json({ error: limitMessage });
  try {
    res.json({ item: moduleData.put(ctx.manifest.id, ctx.scopeKey, req.params.key, req.body?.value, { expected: Number.isInteger(req.body?.version) ? req.body.version : null, by: ctx.by }) });
  } catch (err) {
    sendModuleConflict(err, res);
  }
});
app.delete('/api/modules/:id/data/:key', (req, res) => {
  const ctx = moduleAccess(req, res, 'write');
  if (!ctx) return;
  const slow = overLimit(ctx.manifest.id, ctx.by, 'write');
  if (slow) return void res.set('Retry-After', String(slow.retrySeconds)).status(429).json({ error: limitMessage });
  try {
    const expected = req.query.version !== undefined ? Number(req.query.version) : null;
    res.json(moduleData.remove(ctx.manifest.id, ctx.scopeKey, req.params.key, { expected: Number.isInteger(expected) ? expected : null, by: ctx.by }));
  } catch (err) {
    sendModuleConflict(err, res);
  }
});

// Live changes to one module's data in one scope, pushed as server-sent events.
// The page hosting the module's frame listens and forwards them into the frame.
// Hooks: schedule something for later, or tell people now. The module must
// have declared the hook in its manifest (enabling it approved that).
function requireHook(ctx, res, hook) {
  if (ctx.manifest.hooks[hook]) return true;
  res.status(403).json({ error: `this module did not ask for the ${hook} hook` });
  return false;
}
function sendHookError(err, res) {
  if (err instanceof StoreError) return res.status(err.status).json({ error: err.message });
  throw err;
}
app.post('/api/modules/:id/schedule', (req, res) => {
  const ctx = moduleAccess(req, res, 'write');
  if (!ctx || !requireHook(ctx, res, 'schedule')) return;
  if (req.body?.notify && typeof req.body.notify === 'object' && refuseNotifyTo(req.body.notify.to, res)) return;
  const slow = overLimit(ctx.manifest.id, ctx.by, 'schedule');
  if (slow) return void res.set('Retry-After', String(slow.retrySeconds)).status(429).json({ error: limitMessage });
  try {
    res.json(moduleHooks.schedule(ctx, req.body || {}));
  } catch (err) {
    sendHookError(err, res);
  }
});
app.delete('/api/modules/:id/schedule/:key', (req, res) => {
  const ctx = moduleAccess(req, res, 'write');
  if (!ctx || !requireHook(ctx, res, 'schedule')) return;
  res.json(moduleHooks.cancel(ctx, req.params.key));
});
app.post('/api/modules/:id/notify', (req, res) => {
  const ctx = moduleAccess(req, res, 'write');
  if (!ctx || !requireHook(ctx, res, 'notify')) return;
  if (refuseNotifyTo(req.body?.to, res)) return;
  const slow = overLimit(ctx.manifest.id, ctx.by, 'notify');
  if (slow) return void res.set('Retry-After', String(slow.retrySeconds)).status(429).json({ error: limitMessage });
  try {
    const to = typeof req.body?.to === 'string' ? req.body.to : ctx.scope === 'space' ? 'space' : 'environment';
    res.json({ delivered: moduleHooks.deliver({ module: ctx.manifest.id, scopeKey: ctx.scopeKey, spaceId: ctx.spaceId }, { ...req.body, to }, { by: ctx.by }) });
  } catch (err) {
    sendHookError(err, res);
  }
});

// A signed-in person's own notifications: the list, marking them read, and a
// live stream so a toast can appear the moment one arrives.
app.get('/api/notifications', requireUser, (req, res) => {
  const list = moduleHooks.list(currentUser(req).key).filter((n) => modules.enabled(n.module));
  const byModule = {};
  for (const n of list) if (!n.read) byModule[n.module] = (byModule[n.module] || 0) + 1;
  res.json({ notifications: list, byModule, unread: Object.values(byModule).reduce((a, b) => a + b, 0) });
});
app.post('/api/notifications/read', requireUser, (req, res) => {
  moduleHooks.markRead(currentUser(req).key, { module: typeof req.body?.module === 'string' ? req.body.module : null, id: typeof req.body?.id === 'string' ? req.body.id : null });
  res.json({ ok: true });
});
app.get('/api/notifications/stream', requireUser, (req, res) => {
  const env = currentEnvironment(); // captured once: the close handler below fires later, outside this request
  const key = currentUser(req).key;
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  const onNote = ({ userKey, notification }) => {
    if (userKey !== key || !modules.enabled(notification.module)) return;
    const { manifest } = modules.enabled(notification.module);
    res.write(`event: notification\ndata: ${JSON.stringify({ ...notification, moduleName: manifest.name, icon: manifest.icon })}\n\n`);
  };
  moduleHooks.on('notification', onNote);
  const onInvite = (invite) => {
    if (invite.to !== key || Date.now() - invite.at > INVITE_MS) return;
    res.write(`event: invite\ndata: ${JSON.stringify({ id: invite.id, spaceId: invite.spaceId, fromName: invite.fromName })}\n\n`);
  };
  inviteEvents.on('invite', onInvite);
  const beat = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => envContext.run(env, () => {
    clearInterval(beat);
    moduleHooks.off('notification', onNote);
    inviteEvents.off('invite', onInvite);
  }));
});

// One live stream for every module on a page. A browser allows only a handful of long-lived
// connections to one site (six over HTTP/1.1), and a stream per module (two for a space's panel) used
// up all of them with three modules open, so nothing else could load. This carries every module's
// changes and fired schedules, each labelled with its module and where it happened, and filtered
// to what the viewer may read:
//   with ?space=<id>   scope 'space' (that space) and 'environment'   -- a space's panes
//   without a space    scope 'environment' and 'spaces' (the viewer's own spaces) -- a module's environment page
app.get('/api/modules/stream', (req, res) => {
  const env = currentEnvironment(); // captured once: the close handler below fires later, outside this request
  const who = moduleViewer(req);
  if (!who) return res.status(401).json({ error: 'sign in first' });
  const space = req.query.space ? store.spaceById(String(req.query.space)) : null;
  if (req.query.space && !space) return res.status(404).json({ error: 'no such space' });
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  // Where a change belongs for this viewer, or null if they may not see it.
  const place = (moduleId, scopeKey) => {
    const found = modules.enabled(moduleId);
    if (!found) return null;
    const { manifest, entry } = found;
    if (scopeKey === 'environment') {
      return who.user && moduleCan(manifest, modulePerms(who, null), 'read') ? { scope: 'environment', spaceId: null } : null;
    }
    if (scopeKey.startsWith('person:')) {
      // Someone's own data: told only to that person, on whatever page of theirs shows the module.
      return who.user && scopeKey === `person:${who.user.key}` && moduleCan(manifest, modulePerms(who, null), 'read') ? { scope: 'person', spaceId: null } : null;
    }
    if (!scopeKey.startsWith('space:')) return null;
    const r = store.spaceById(scopeKey.slice(6));
    if (!r) return null;
    if (space) {
      return r.id === space.id && moduleSpaceAccess(entry, who, r) && moduleCan(manifest, modulePerms(who, r.id), 'read') ? { scope: 'space', spaceId: r.id } : null;
    }
    const mine = who.user && !r.ephemeral && r.members.includes(who.user.key) && (entry.allSpaces || entry.spaces.includes(r.id));
    return mine && moduleCan(manifest, modulePerms(who, r.id), 'read') ? { scope: 'spaces', spaceId: r.id } : null;
  };
  const onChange = (change) => {
    const at = place(change.module, change.scopeKey);
    if (at) res.write(`event: change\ndata: ${JSON.stringify({ ...change, ...at })}\n\n`);
  };
  const onFire = (fire) => {
    const at = place(fire.module, fire.scopeKey);
    if (at && at.scope !== 'spaces') res.write(`event: schedule\ndata: ${JSON.stringify({ module: fire.module, key: fire.key, payload: fire.payload, ...at })}\n\n`);
  };
  // What points at (or from) an item changed: only the pointers go, and the module asks again for what it may see.
  const onLinks = ({ refs }) => {
    for (const ref of refs) {
      const at = place(ref.module, refScopeKey(ref));
      if (at) res.write(`event: links\ndata: ${JSON.stringify({ module: ref.module, ref, ...at })}\n\n`);
    }
  };
  // A module said something happened: sent to every module here that may hear it (the host delivers it to those frames).
  const onBus = (ev) => {
    const at = place(ev.module, ev.scopeKey);
    if (!at) return;
    const subscribers = modules.enabledAll().filter((m) => m.manifest.id !== ev.module && mayHear(m, ev.module, ev.name) && place(m.manifest.id, ev.scopeKey)).map((m) => m.manifest.id);
    if (subscribers.length) res.write(`event: bus\ndata: ${JSON.stringify({ ...publicEvent(ev), scope: at.scope, subscribers })}\n\n`);
  };
  // A request for a module to do something: the providing module's frames are told; one claims it.
  const onAction = (r) => {
    if (r.local && r.by !== (who.user?.key || 'guest')) return; // a view is for the person who asked
    const at = place(r.provider, r.scopeKey);
    if (at) res.write(`event: action\ndata: ${JSON.stringify({ ...publicAction(r), provider: r.provider, scope: at.scope })}\n\n`);
  };
  // A setting of a module changed: its pages here read their values again.
  const onSettings = (c) => {
    if (c.scope === 'person' && c.userKey !== who.user?.key) return;
    if (c.scope === 'space' && !(space && space.id === c.spaceId) && !(who.user && store.spaceById(c.spaceId)?.members.includes(who.user.key))) return;
    res.write(`event: settings\ndata: ${JSON.stringify({ module: c.module, scope: c.scope, spaceId: c.spaceId })}\n\n`);
  };
  moduleSettings.on('change', onSettings);
  moduleData.on('change', onChange);
  moduleHooks.on('fire', onFire);
  moduleLinks.on('change', onLinks);
  moduleBus.on('event', onBus);
  moduleBus.on('action', onAction);
  const beat = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => envContext.run(env, () => {
    clearInterval(beat);
    moduleSettings.off('change', onSettings);
    moduleData.off('change', onChange);
    moduleHooks.off('fire', onFire);
    moduleLinks.off('change', onLinks);
    moduleBus.off('event', onBus);
    moduleBus.off('action', onAction);
  }));
});

app.get('/api/modules/:id/events', (req, res) => {
  const env = currentEnvironment(); // captured once: the close handler below fires later, outside this request
  // scope=spaces: changes in any of the viewer's spaces (a module's page showing them all).
  const all = req.query.scope === 'spaces' ? moduleSpacesFor(req, res) : null;
  if (req.query.scope === 'spaces' && !all) return;
  const ctx = all ? { manifest: all.manifest, scopeKey: null } : moduleAccess(req, res, 'read');
  if (!ctx) return;
  const spaceIds = all ? new Set(all.spaces.map((r) => r.id)) : null;
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  const onChange = (change) => {
    if (change.module !== ctx.manifest.id) return;
    if (spaceIds) {
      const spaceId = change.scopeKey.startsWith('space:') ? change.scopeKey.slice(6) : null;
      if (!spaceIds.has(spaceId)) return;
      return void res.write(`event: change\ndata: ${JSON.stringify({ ...change, spaceId })}\n\n`);
    }
    if (change.scopeKey !== ctx.scopeKey) return;
    res.write(`event: change\ndata: ${JSON.stringify(change)}\n\n`);
  };
  const onFire = (fire) => {
    if (spaceIds || fire.module !== ctx.manifest.id || fire.scopeKey !== ctx.scopeKey) return;
    res.write(`event: schedule\ndata: ${JSON.stringify({ key: fire.key, payload: fire.payload })}\n\n`);
  };
  moduleData.on('change', onChange);
  moduleHooks.on('fire', onFire);
  const beat = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => envContext.run(env, () => {
    clearInterval(beat);
    moduleData.off('change', onChange);
    moduleHooks.off('fire', onFire);
  }));
});

app.get('/api/roles', requireOwner, (_req, res) => res.json({ permissions: store.allPermissions(), roles: store.roles() }));
app.patch('/api/roles/:role', requireOwner, (req, res) => res.json({ roles: store.setRolePermissions(req.params.role, req.body || {}) }));

// The currencies the server takes (see server/currencies.js): what a currency picker offers, in Manage or a module.
// Codes only; the page names them in the viewer's language. Anyone signed in; nothing in it is private.
app.get('/api/currencies', requireUser, (_req, res) => res.json({ currencies: currencyCodes(store.settings.currency) }));
app.get('/api/settings', requireOwner, (_req, res) => res.json({ settings: branding(), streamKey: store.streamKey }));
app.patch('/api/settings', requireOwner, (req, res) => {
  store.updateSettings(req.body || {});
  res.json({ settings: branding() });
});

// This environment's own view of itself: its plan and how it stands against each cap (plan-tenants.md, "Phase
// 2: the owner role and the split"). Only with a base domain -- a self-hosted install is on no host's plan,
// so it has no plan or usage of its own to show.
app.get('/api/environment', requireOwner, async (req, res) => {
  if (!BASE_DOMAIN) return res.status(404).json({ error: 'not hosted' });
  const env = currentEnvironment();
  const environment = hostRegistry.findEnvironment(env.slug);
  if (!environment) return res.status(404).json({ error: 'not hosted' }); // defensive: every resolved environment has a registry entry
  res.json({
    slug: environment.slug,
    name: environment.name,
    baseDomain: BASE_DOMAIN,
    status: environment.status,
    pastDueSince: environment.pastDueSince,
    graceEndsAt: environment.pastDueSince ? new Date(new Date(environment.pastDueSince).getTime() + 14 * 86400000).toISOString() : null,
    deleteRequestedAt: environment.deleteRequestedAt,
    deleteRequestReason: environment.deleteRequestReason,
    plan: { name: environment.plan.name || null, modules: environment.plan.modules, members: environment.plan.members, storageBytes: environment.plan.storageBytes, aiCallsPerMonth: environment.plan.aiCallsPerMonth, calls: environment.plan.calls },
    usage: {
      members: store.users.length,
      storageBytes: environmentStorageBytes(env.slug, env.dataDir),
      aiCallsThisMonth: hostRegistry.aiCallsThisMonth(env.slug),
      callsNow: await liveCallCount(),
    },
  });
});
// The environment's own copy of its data, the same zip the host console's own backup makes -- any environment admin
// may ask for it, not only a host admin (plan-tenants.md, "Phase 2": Download a copy).
app.get('/api/environment/export', requireOwner, (req, res) => {
  if (!BASE_DOMAIN) return res.status(404).json({ error: 'not hosted' });
  const env = currentEnvironment();
  flushEnvironment(env); // every debounced write on disk before it is zipped
  const zip = zipFiles(fs.existsSync(env.dataDir) ? walkFiles(env.dataDir) : []);
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${env.slug}-export.zip"` });
  res.send(zip);
});
// Asked for by the environment's own admin, carried out by a host admin on the console (the existing Delete) --
// never by itself. DELETE withdraws the request.
app.post('/api/environment/delete-request', requireOwner, (req, res) => {
  if (!BASE_DOMAIN) return res.status(404).json({ error: 'not hosted' });
  try {
    res.json(hostRegistry.requestEnvironmentDeletion(currentEnvironment().slug, req.body?.reason));
  } catch (err) {
    sendHostError(err, res);
  }
});
app.delete('/api/environment/delete-request', requireOwner, (req, res) => {
  if (!BASE_DOMAIN) return res.status(404).json({ error: 'not hosted' });
  try {
    hostRegistry.withdrawEnvironmentDeletion(currentEnvironment().slug);
    res.json({ ok: true });
  } catch (err) {
    sendHostError(err, res);
  }
});
// Saved themes: named sets of the same seven colors /theme.css can render --
// switching just repoints activeThemeId (see PATCH /api/settings above),
// no re-picking needed. See store.js's "themes" section for the shape.
app.get('/api/themes', requireOwner, (_req, res) => res.json({ themes: store.themes, defaultTheme: store.defaultTheme, activeThemeId: store.settings.activeThemeId || null, themeMode: store.settings.themeMode }));
app.post('/api/themes', requireOwner, (req, res) => res.json({ theme: store.addTheme(req.body || {}) }));
app.patch('/api/themes/:id', requireOwner, (req, res) => res.json({ theme: store.updateTheme(req.params.id, req.body || {}) }));
app.delete('/api/themes/:id', requireOwner, (req, res) => {
  store.removeTheme(req.params.id);
  res.json({ ok: true });
});
// Site images: icon, background.
const siteImage = (req, res, next) => (req.params.image === 'icon' || req.params.image === 'background' ? next() : res.status(404).json({ error: 'unknown image' }));
app.put('/api/settings/:image', requireOwner, siteImage, rawImage, checkStorageCap, (req, res) => {
  store.setSiteImage(req.params.image, req.body, req.get('content-type'));
  res.json({ settings: branding() });
});
app.delete('/api/settings/:image', requireOwner, siteImage, (req, res) => {
  store.removeSiteImage(req.params.image);
  res.json({ settings: branding() });
});
// Shared by both the guest and the default Participant picture sets below.
const participantImageSlot = (req, res, next) => (PARTICIPANT_SLOTS.includes(req.params.slot) ? next() : res.status(404).json({ error: 'unknown image slot' }));
app.put('/api/settings/guest-images/:slot', requireOwner, participantImageSlot, rawImage, checkStorageCap, (req, res) => {
  store.setGuestImage(req.params.slot, req.body, req.get('content-type'));
  res.json({ ok: true });
});
app.delete('/api/settings/guest-images/:slot', requireOwner, participantImageSlot, (req, res) => {
  store.removeGuestImage(req.params.slot);
  res.json({ ok: true });
});
// The server-wide Default Images set (see /img/default/:slot above).
app.put('/api/settings/default-images/:slot', requireOwner, participantImageSlot, rawImage, checkStorageCap, (req, res) => {
  store.setDefaultImage(req.params.slot, req.body, req.get('content-type'));
  res.json({ ok: true });
});
app.delete('/api/settings/default-images/:slot', requireOwner, participantImageSlot, (req, res) => {
  store.removeDefaultImage(req.params.slot);
  res.json({ ok: true });
});
app.post('/api/stream-key/regenerate', requireOwner, (_req, res) => {
  res.json({ streamKey: store.regenerateStreamKey() });
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// A module's keyed page: what /view/<key> used to be, generalized so any bundled module can claim a path
// (surfaces.keyed.path) instead of the host hard-coding one -- the Stream module claims "view" (see
// plan-stream-module.md), so /view/<key> answers exactly as it always did, now served by that module. Registered
// last, right before the error handler, so nothing earlier and more specific is ever shadowed. A path nothing
// has ever claimed, installed or bundled, falls through to the ordinary 404 rather than this route claiming it.
app.get('/:path/:key', (req, res, next) => {
  if (!/^[a-z0-9-]{2,20}$/.test(req.params.path)) return next();
  const bundled = () => bundledModules(BUNDLED_DIR).find((m) => m.surfaces?.keyed?.path === req.params.path);
  const claimant = modules.keyedClaimant(req.params.path) || bundled();
  if (!claimant) return next();
  if (!hasStreamAccess(req)) return res.status(403).send('This page needs the access key (?s=...).');
  const claimed = modules.keyedFor(req.params.path);
  if (!claimed) return res.status(404).send(`The ${claimant.name} module serves this page and is not enabled.`);
  if (!store.userByKey(req.params.key)) return res.status(404).send('No such user.');
  res.sendFile(page('keyed.html'));
});

// Errors ---------------------------------------------------------------------

app.use((err, _req, res, _next) => {
  if (err instanceof StoreError) return res.status(err.status).json({ error: err.message });
  // An environment built after startup whose Names migration could not finish, or whose data is from a newer
  // Magpie (see server/migrate-names.js): that environment is refused until its data is seen to; the file and
  // the reason go to the log, never to the person asking.
  if (err instanceof MigrationError) {
    if (err.slug !== undefined) logRefusalOnce(err.slug); else console.error(err.message);
    const sentence = refusalSentence(err);
    // A browser asking for a page gets a plain page with the sentence; everything else the JSON answer.
    if (!_req.path.startsWith('/api/') && _req.accepts(['json', 'html']) === 'html') {
      return res.status(503).type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Magpie</title></head><body style="font-family: system-ui, sans-serif; margin: 3rem auto; max-width: 32rem; padding: 0 1rem;"><p>${sentence}</p></body></html>`);
    }
    return res.status(503).json({ error: sentence });
  }
  if (err.type === 'entity.too.large') {
    if (/^\/api\/modules\/[^/]+\/uploads/.test(_req.path)) return res.status(413).json({ error: 'that file is over the size limit' });
    const limit = _req.path.startsWith('/api/modules') ? MODULE_LIMITS.zipBytes : MAX_IMAGE_BYTES;
    return res.status(413).json({ error: `${_req.path.startsWith('/api/modules') ? 'the zip' : 'image'} is larger than ${limit / (1024 * 1024)} MB` });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad JSON' });
  console.error(err);
  res.status(500).json({ error: 'server error' });
});

// The grace: an environment pastDue for 14 days is degraded to the free plan once an hour, never deleted
// (plan-tenants.md, "Phase 5"). Only with a base domain -- a self-hosted install has no environments to sweep.
if (BASE_DOMAIN) setInterval(() => hostRegistry.degradeStalePastDue(), 3600000);

// Regaining access (documentation/plans/plan-mfa.md, "Regaining access"): the lockout bypass excuses every
// admin from the code step and the enrol requirement for as long as it is set -- worth a loud warning on
// every start, the same way a server running with no LiveKit secret or an open registration would be.
if (adminMfaLockoutBypass) console.warn(`The lockout bypass (ADMIN_MFA_LOCKOUT_BYPASS) is on: ${BASE_DOMAIN ? 'every owner and host admin' : "every owner and the server's admin"} skips two-step sign-in entirely. Turn it off once you are back in.`);

// The port it really listens on is logged, so PORT=0 (any free port, for a check) says which one it got.
const listener = app.listen(Number(PORT), () => {
  const port = listener.address().port;
  if (!BASE_DOMAIN) {
    envContext.run(environmentFor(DEFAULT_SLUG), () => {
      console.log(`${store.settings.environmentName} ${VERSION} listening on :${port}, LiveKit at ${LIVEKIT_HOST}, data in ${DATA_DIR}`);
      // A module that takes a file the operator supplies: say where it looks and what it found, once.
      for (const m of modules.list()) for (const d of m.settings || []) if (d.type === 'file' || d.type === 'files') console.log(`${m.name}: looks for "${d.label}" in ${describeModuleFiles(m, d.folder)}`);
      if (fs.existsSync(path.join(DATA_DIR, 'module-files'))) console.warn(`Note: ${path.join(DATA_DIR, 'module-files')} is no longer used. A module's files belong in its own folder, DATA_DIR/modules/<module id>/<folder>/ (see the module's settings).`);
    });
    return;
  }
  console.log(`${PRODUCT_NAME} ${VERSION} listening on :${port}, LiveKit at ${LIVEKIT_HOST}, base domain ${BASE_DOMAIN}, ${environments.size} environment${environments.size === 1 ? '' : 's'}, host console at admin.${BASE_DOMAIN}`);
});
