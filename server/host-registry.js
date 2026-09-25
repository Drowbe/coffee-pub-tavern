// The host's own registry: which environments exist, their slugs and plans, and the host admins who run
// the deployment itself (a different kind of account from any environment's users -- a member of no environment).
// Persists to DATA_DIR/host.json. Only built and read when BASE_DOMAIN is set; a self-hosted install with no base
// domain never has this file at all (see documentation/plans/plan-tenants.md).
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { cleanText, cleanLogin, randomToken, sanitizeMfa } = require('./store');
const { applyManagedFields, MANAGED_PROVIDERS } = require('./ai');

class HostError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const KEY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
function randomKey(length = 8) {
  let key = '';
  for (let i = 0; i < length; i += 1) key += KEY_ALPHABET[crypto.randomInt(KEY_ALPHABET.length)];
  return key;
}

// A slug is a subdomain label: letters, digits and hyphens, 3 to 30 characters, never starting or ending in a
// hyphen, and never one of the names a subdomain already means something else by.
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])?$/;
const RESERVED_SLUGS = new Set(['www', 'api', 'host', 'admin', 'mail', 'smtp', 'imap', 'pop', 'pop3', 'ftp', 'ns1', 'ns2', 'static', 'cdn', 'assets', 'app', 'status', 'support', 'help', 'blog', 'docs']);

function cleanSlug(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (s.length < 3 || s.length > 30 || !SLUG_RE.test(s)) throw new HostError('a slug is 3 to 30 letters, digits and hyphens, not starting or ending with one');
  if (RESERVED_SLUGS.has(s)) throw new HostError(`"${s}" is reserved and cannot be used as a slug`);
  return s;
}

// modules: the ids an environment may enable, or 'all' (today's single-environment install, and any environment an admin has not
// capped yet). The rest are caps a later phase enforces; null means uncapped. Nothing here is billing -- just what
// is stored and shown in phase 1.
const STATUSES = ['active', 'pastDue', 'suspended'];
const defaultCaps = () => ({ modules: 'all', members: null, storageBytes: null, aiCallsPerMonth: null, calls: null });
const defaultPlan = () => ({ name: null, ...defaultCaps() });

// The five caps alone -- shared between an environment's own plan (cleanPlan, below) and a plans-catalog entry
// (cleanPlansCatalog, "Phase 5: self-serve, plans and billing"), which carries the same caps under its own name.
function cleanCaps(raw, fallback) {
  const base = fallback || defaultCaps();
  if (!raw || typeof raw !== 'object') return base;
  const modules = raw.modules === 'all' ? 'all' : Array.isArray(raw.modules) ? [...new Set(raw.modules.filter((m) => typeof m === 'string' && /^[a-z][a-z0-9-]{1,31}$/.test(m)))].slice(0, 200) : base.modules;
  const cap = (n, was) => (n === null ? null : Number.isFinite(n) && n >= 0 ? Math.round(n) : was);
  return { modules, members: cap(raw.members, base.members), storageBytes: cap(raw.storageBytes, base.storageBytes), aiCallsPerMonth: cap(raw.aiCallsPerMonth, base.aiCallsPerMonth), calls: cap(raw.calls, base.calls) };
}

// An environment's own plan: the catalog key it was copied from (`name`, null for one hand-set rather than assigned
// from the catalog) beside its own caps, which may since have been adjusted per environment (plan-tenants.md,
// "Phase 5": "copied from the catalog at assignment and may be adjusted per environment").
function cleanPlan(raw, fallback) {
  if (!raw || typeof raw !== 'object') return fallback || defaultPlan();
  const base = fallback || defaultPlan();
  const name = raw.name === undefined ? base.name : typeof raw.name === 'string' ? cleanText(raw.name, 40) || null : null;
  return { name, ...cleanCaps(raw, base) };
}

// The host's own plan catalog (plan-tenants.md, "Phase 5"): { <id>: { name, caps } }, free always present so a
// self-serve sign-up and the degrade sweep always have somewhere to land. Lenient, like cleanHostAi: a bad
// entry just drops that one plan rather than crashing the registry.
const PLAN_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
function cleanPlansCatalog(raw) {
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const [id, entry] of Object.entries(raw)) {
      if (!PLAN_ID_RE.test(id) || !entry || typeof entry !== 'object') continue;
      out[id] = { name: cleanText(entry.name, 40) || id, caps: cleanCaps(entry.caps) };
    }
  }
  if (!out.free) out.free = { name: 'Free', caps: defaultCaps() };
  return out;
}

// The host's managed AI service, per company (documentation/plans/plan-tenants.md, "Managed AI, per company"):
// { openai: { model, key }, anthropic: { model, key }, compatible: { address, model, key } }, any subset --
// lenient like cleanEnvironmentRecord, not the way a PUT is (applyManagedFields, used by setManagedAi): corrupt data
// for one company just drops that company's slot rather than crashing the registry.
function cleanHostAi(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const provider of MANAGED_PROVIDERS) {
    const s = r[provider];
    if (!s || typeof s !== 'object') continue;
    out[provider] = {
      model: typeof s.model === 'string' ? s.model : '',
      key: typeof s.key === 'string' ? s.key : '',
      ...(provider === 'compatible' ? { address: typeof s.address === 'string' ? s.address : '' } : {}),
      // An organisation-level Anthropic key needs its workspace id sent with every call -- an id, not a
      // secret (server/ai.js's cleanWorkspace validates the shape; this is just the load-time sanitizer).
      ...(provider === 'anthropic' ? { workspace: typeof s.workspace === 'string' ? s.workspace : '' } : {}),
    };
  }
  // A host.json saved under the single-service shape from before per-company ({ provider, address, model, key }
  // at the top level, not keyed by company -- live only briefly): carried into that company's own slot here,
  // every load, so a server that never restarted between the two shapes does not silently lose what it saved.
  // Never overwrites a slot the new shape already filled.
  if (!out[r.provider] && MANAGED_PROVIDERS.includes(r.provider)) {
    out[r.provider] = {
      model: typeof r.model === 'string' ? r.model : '',
      key: typeof r.key === 'string' ? r.key : '',
      ...(r.provider === 'compatible' ? { address: typeof r.address === 'string' ? r.address : '' } : {}),
    };
  }
  return out;
}

// A shared file folder's own settings (documentation/plans/plan-tenants.md, "Shared files: the host's map"):
// today just the region source's address (a module's `worldSource`, e.g.) -- the files themselves live on
// disk (DATA_DIR/shared/<module>/<folder>/), never in host.json. Lenient, like cleanHostAi: bad data just
// drops that one folder rather than crashing the registry.
function cleanSharedFolders(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [moduleId, folders] of Object.entries(raw)) {
    if (!/^[a-z][a-z0-9-]{1,31}$/.test(moduleId) || !folders || typeof folders !== 'object') continue;
    for (const [folder, f] of Object.entries(folders)) {
      if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(folder)) continue;
      (out[moduleId] ||= {})[folder] = { address: typeof f?.address === 'string' ? f.address : '' };
    }
  }
  return out;
}

function cleanEnvironmentRecord(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.slug !== 'string') return null;
  let slug;
  try {
    slug = cleanSlug(raw.slug);
  } catch {
    return null; // a slug already in the file that no longer validates is dropped rather than crashing the registry
  }
  return {
    slug,
    name: cleanText(raw.name, 80) || slug,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    plan: cleanPlan(raw.plan),
    status: STATUSES.includes(raw.status) ? raw.status : 'active',
    pastDueSince: typeof raw.pastDueSince === 'string' ? raw.pastDueSince : null,
    // Set once, by the hourly sweep, the moment a pastDue environment is degraded to the free plan's caps
    // (plan-tenants.md, "Phase 5: the grace") -- never cleared except by a fresh "paid" billing event.
    degradedAt: typeof raw.degradedAt === 'string' ? raw.degradedAt : null,
    // Asked for by the environment's own admin (POST /api/environment/delete-request), carried out by a host
    // admin on the console -- never by itself (plan-tenants.md, "Phase 2").
    deleteRequestedAt: typeof raw.deleteRequestedAt === 'string' ? raw.deleteRequestedAt : null,
    deleteRequestReason: cleanText(raw.deleteRequestReason, 500) || '',
    // Cap usage the registry itself tracks or caches, cheaper to keep here than to recompute on every read
    // (plan-tenants.md, "Phase 3"): storageBytes/measuredAt (server/index.js remeasures at most once a minute),
    // aiMonth/aiCalls (a plain "YYYY-MM" counter, rolled over on a new month the same way Ai's own per-
    // environment usage is).
    usage: {
      storageBytes: Number.isFinite(raw.usage?.storageBytes) ? raw.usage.storageBytes : 0,
      measuredAt: typeof raw.usage?.measuredAt === 'string' ? raw.usage.measuredAt : null,
      aiMonth: typeof raw.usage?.aiMonth === 'string' ? raw.usage.aiMonth : '',
      aiCalls: Number.isFinite(raw.usage?.aiCalls) ? raw.usage.aiCalls : 0,
    },
  };
}

class HostRegistry {
  constructor(dataDir) {
    this.dir = dataDir;
    this.file = path.join(dataDir, 'host.json');
    this.data = this.load();
    this.save(); // a freshly generated session secret (or a first-run empty file) is on disk before anything signs with it
  }

  load() {
    let raw = {};
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      raw = {};
    }
    return {
      baseDomain: typeof raw.baseDomain === 'string' ? raw.baseDomain : '',
      // A base domain a request may still arrive at (the product was renamed): <slug>.<one of these> and
      // host.<one of these> redirect to the same path at the current baseDomain. See "Previous base domains" in
      // documentation/plans/plan-tenants.md.
      previousBaseDomains: Array.isArray(raw.previousBaseDomains) ? [...new Set(raw.previousBaseDomains.filter((d) => typeof d === 'string' && d))] : [],
      // Signs a host admin's own session cookie (never an environment's own secret, kept in that environment's own store).
      // `key` encrypts every environment's own TOTP secret at rest (documentation/plans/plan-mfa.md): one key
      // for the whole host, shared across every environment, since the host already has admin access to all of
      // them -- never inside any one environment's own exportable directory, so an owner's export or the console's
      // backup carries only the ciphertext, useless without it.
      secrets: {
        session: raw.secrets?.session || randomToken(32),
        key: typeof raw.secrets?.key === 'string' && /^[0-9a-f]{64}$/.test(raw.secrets.key) ? raw.secrets.key : crypto.randomBytes(32).toString('hex'),
      },
      hostAdmins: Array.isArray(raw.hostAdmins)
        ? raw.hostAdmins.filter((a) => a && typeof a.key === 'string' && typeof a.login === 'string' && typeof a.passwordHash === 'string')
          .map((a) => ({ key: a.key, login: a.login, passwordHash: a.passwordHash, mfa: sanitizeMfa(a.mfa) }))
        : [],
      environments: Array.isArray(raw.environments) ? raw.environments.map(cleanEnvironmentRecord).filter(Boolean) : [],
      ai: cleanHostAi(raw.ai),
      shared: cleanSharedFolders(raw.shared),
      plans: cleanPlansCatalog(raw.plans),
      // The Names migration's record of the host's own parts (server/migrate-names.js), kept exactly as found.
      ...(Array.isArray(raw.migrations) ? { migrations: raw.migrations } : {}),
    };
  }

  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  setBaseDomain(domain) {
    this.data.baseDomain = String(domain || '');
    this.save();
  }

  setPreviousBaseDomains(domains) {
    this.data.previousBaseDomains = [...new Set((Array.isArray(domains) ? domains : String(domains || '').split(',')).map((d) => String(d).trim().toLowerCase()).filter(Boolean))];
    this.save();
  }

  previousBaseDomains() {
    return [...this.data.previousBaseDomains];
  }

  get sessionSecret() {
    return this.data.secrets.session;
  }

  get secretsKey() {
    return this.data.secrets.key;
  }

  // ai ----------------------------------------------------------------------------------------------------
  // The host's own managed AI service, above every environment, per company: real values (including the key),
  // for server/index.js's managedSlot to build both an Ai instance's `managed()` callback and the host
  // console's own view from -- never returned from a route as-is (GET /api/host/ai answers keySet/
  // keyFromEnvironment/offered instead). A shallow copy, always with an entry for openai/anthropic/compatible
  // (empty when nothing is saved for it), so a caller never has to guard against a missing key.
  get managedAi() {
    const out = {};
    for (const provider of MANAGED_PROVIDERS) out[provider] = { model: '', key: '', ...(provider === 'compatible' ? { address: '' } : {}), ...(provider === 'anthropic' ? { workspace: '' } : {}), ...(this.data.ai[provider] || {}) };
    return out;
  }

  setManagedAi(provider, patch) {
    if (!MANAGED_PROVIDERS.includes(provider)) throw new HostError('choose openai, anthropic or compatible');
    this.data.ai[provider] = applyManagedFields(provider, this.managedAi[provider], patch);
    this.save();
    return { ...this.data.ai[provider] };
  }

  // Used only by index.js's migration seeding: an environment's old provider/address/model, worked only
  // through the old per-environment AI_KEY, becomes that company's own starting point -- with no key of its
  // own, since the env var is this host's own live override now (managedSlot in index.js), not something to
  // demand here. Never overwrites a company's slot that already has something saved (the caller checks too,
  // but a second migrating environment landing on the same company in the same start should not win a race
  // against the first).
  seedManagedAi(provider, { address, model }) {
    if (!MANAGED_PROVIDERS.includes(provider) || this.data.ai[provider]) return;
    this.data.ai[provider] = cleanHostAi({ [provider]: { address, model, key: '' } })[provider];
    this.save();
  }

  // shared files -------------------------------------------------------------------------------------------
  sharedFolderAddress(moduleId, folder) {
    return this.data.shared[moduleId]?.[folder]?.address || '';
  }

  setSharedFolderAddress(moduleId, folder, address) {
    const a = String(address || '').trim();
    if (a) {
      let u;
      try { u = new URL(a); } catch { throw new HostError('that address is not valid'); }
      if (u.protocol !== 'https:' || u.username || u.password) throw new HostError('the address must be https, without a user name or password');
      if (!/\.pmtiles$/i.test(u.pathname)) throw new HostError('the address must be the address of a .pmtiles file');
    }
    (this.data.shared[moduleId] ||= {})[folder] = { address: a };
    this.save();
    return this.data.shared[moduleId][folder];
  }

  // environments -------------------------------------------------------------------------------------------------
  listEnvironments() {
    return this.data.environments.map((t) => ({ ...t, plan: { ...t.plan } }));
  }

  findEnvironment(slug) {
    const t = this.data.environments.find((x) => x.slug === slug);
    return t ? { ...t, plan: { ...t.plan } } : null;
  }

  // { slug, name, plan? }. plan defaults to uncapped, every module -- the shape a migrated install gets, and a
  // reasonable starting point for one the host console creates (an admin narrows it after).
  addEnvironment({ slug, name, plan }) {
    const clean = cleanSlug(slug);
    if (this.data.environments.some((t) => t.slug === clean)) throw new HostError(`"${clean}" is already in use`, 409);
    // Built through cleanEnvironmentRecord so a brand new environment carries the same defaults (usage, the delete-request
    // fields) a loaded-from-disk one does -- the registry's other methods all assume environment.usage exists.
    const environment = cleanEnvironmentRecord({ slug: clean, name, createdAt: new Date().toISOString(), plan: cleanPlan(plan) });
    this.data.environments.push(environment);
    this.save();
    return { ...environment, plan: { ...environment.plan }, usage: { ...environment.usage } };
  }

  updateEnvironment(slug, patch) {
    const environment = this.data.environments.find((t) => t.slug === slug);
    if (!environment) throw new HostError('no such environment', 404);
    if (patch && typeof patch === 'object') {
      if (patch.name !== undefined) environment.name = cleanText(patch.name, 80) || environment.name;
      if (patch.plan !== undefined) environment.plan = cleanPlan(patch.plan, environment.plan);
      if (patch.status !== undefined) {
        if (!STATUSES.includes(patch.status)) throw new HostError(`status must be one of ${STATUSES.join(', ')}`);
        if (patch.status === 'pastDue' && environment.status !== 'pastDue') environment.pastDueSince = new Date().toISOString();
        else if (patch.status !== 'pastDue') environment.pastDueSince = null;
        environment.status = patch.status;
      }
    }
    this.save();
    return { ...environment, plan: { ...environment.plan } };
  }

  // Asked for by the environment's own admin (POST /api/environment/delete-request); withdrawn the same way
  // (DELETE), or carried out by a host admin on the console (removeEnvironment, the existing Delete) -- never by
  // itself. Marking it is not a queue or a timer, just a flag a host admin sees and acts on when they choose.
  requestEnvironmentDeletion(slug, reason) {
    const environment = this.data.environments.find((t) => t.slug === slug);
    if (!environment) throw new HostError('no such environment', 404);
    environment.deleteRequestedAt = new Date().toISOString();
    environment.deleteRequestReason = cleanText(reason, 500) || '';
    this.save();
    return { deleteRequestedAt: environment.deleteRequestedAt, deleteRequestReason: environment.deleteRequestReason };
  }

  withdrawEnvironmentDeletion(slug) {
    const environment = this.data.environments.find((t) => t.slug === slug);
    if (!environment) throw new HostError('no such environment', 404);
    environment.deleteRequestedAt = null;
    environment.deleteRequestReason = '';
    this.save();
  }

  // storage and AI usage, cached on the entry (plan-tenants.md, "Phase 3") -------------------------------------
  // storageBytes/measuredAt: server/index.js decides when a minute has passed and remeasures; this just records
  // what it found. aiMonth/aiCalls: one call counted per successful host.ai.ask, rolled over to 0 on a new
  // month the same way Ai's own per-environment usage already is.
  recordStorageUsage(slug, bytes) {
    const environment = this.data.environments.find((t) => t.slug === slug);
    if (!environment) return;
    environment.usage.storageBytes = Math.max(0, Math.round(bytes));
    environment.usage.measuredAt = new Date().toISOString();
    this.save();
  }

  recordAiCall(slug) {
    const environment = this.data.environments.find((t) => t.slug === slug);
    if (!environment) return;
    const thisMonth = new Date().toISOString().slice(0, 7);
    if (environment.usage.aiMonth !== thisMonth) { environment.usage.aiMonth = thisMonth; environment.usage.aiCalls = 0; }
    environment.usage.aiCalls += 1;
    this.save();
  }

  aiCallsThisMonth(slug) {
    const environment = this.data.environments.find((t) => t.slug === slug);
    if (!environment) return 0;
    return environment.usage.aiMonth === new Date().toISOString().slice(0, 7) ? environment.usage.aiCalls : 0;
  }

  // the plan catalog and billing (plan-tenants.md, "Phase 5: self-serve, plans and billing") -------------------
  plansCatalog() {
    return Object.fromEntries(Object.entries(this.data.plans).map(([id, p]) => [id, { name: p.name, caps: { ...p.caps } }]));
  }

  setPlansCatalog(raw) {
    this.data.plans = cleanPlansCatalog(raw);
    this.save();
    return this.plansCatalog();
  }

  // The webhook's three events (POST /api/host/billing, signature checked by the caller): "paid" takes the
  // named plan's caps from the catalog (a snapshot, same as any assignment -- the catalog may move on without
  // touching an already-paid environment until its next event); "lapsed" and "cancelled" both start the same 14-day
  // grace (the sweep below degrades it once that runs out), the grace clock only starting once, not restarted
  // by a second webhook call for an environment already pastDue.
  applyBillingEvent(slug, planId, event) {
    const environment = this.data.environments.find((t) => t.slug === slug);
    if (!environment) throw new HostError('no such environment', 404);
    if (event === 'paid') {
      const entry = this.data.plans[planId];
      if (!entry) throw new HostError(`no such plan: ${planId}`);
      environment.plan = { name: planId, ...entry.caps };
      environment.status = 'active';
      environment.pastDueSince = null;
      environment.degradedAt = null;
    } else if (event === 'lapsed' || event === 'cancelled') {
      if (environment.status !== 'pastDue') environment.pastDueSince = new Date().toISOString();
      environment.status = 'pastDue';
    } else {
      throw new HostError(`event must be paid, lapsed or cancelled`);
    }
    this.save();
    return { ...environment, plan: { ...environment.plan } };
  }

  // The grace: an environment pastDue for 14 days is degraded to the free plan's caps rather than left capped at
  // whatever it lapsed from -- nothing about billing ever deletes anything. Called once an hour by index.js.
  degradeStalePastDue(graceMs = 14 * 86400000) {
    const now = Date.now();
    let changed = false;
    for (const environment of this.data.environments) {
      if (environment.status !== 'pastDue' || !environment.pastDueSince) continue;
      if (now - new Date(environment.pastDueSince).getTime() < graceMs) continue;
      const free = this.data.plans.free;
      environment.plan = { name: 'free', ...free.caps };
      environment.status = 'active';
      environment.pastDueSince = null;
      environment.degradedAt = new Date().toISOString();
      changed = true;
    }
    if (changed) this.save();
  }

  // Only the registry entry -- the directory move (to environments-deleted/) is the caller's job, since this class
  // knows nothing about environments' built services or their data directories beyond the slug.
  removeEnvironment(slug) {
    const before = this.data.environments.length;
    this.data.environments = this.data.environments.filter((t) => t.slug !== slug);
    if (this.data.environments.length === before) throw new HostError('no such environment', 404);
    this.save();
  }

  // host admins -----------------------------------------------------------------------------------------------
  listAdmins() {
    return this.data.hostAdmins.map((a) => ({ key: a.key, login: a.login, mfaEnrolled: Boolean(a.mfa) }));
  }

  findAdminByLogin(login) {
    const clean = cleanLogin(login);
    return this.data.hostAdmins.find((a) => a.login === clean) || null;
  }

  findAdminByKey(key) {
    return this.data.hostAdmins.find((a) => a.key === key) || null;
  }

  addAdmin({ login, passwordHash }) {
    const clean = cleanLogin(login);
    if (!clean) throw new HostError('a login is required');
    if (this.data.hostAdmins.some((a) => a.login === clean)) throw new HostError('that login is already a host admin', 409);
    const admin = { key: randomKey(), login: clean, passwordHash, mfa: null };
    this.data.hostAdmins.push(admin);
    this.save();
    return { key: admin.key, login: admin.login, mfaEnrolled: false };
  }

  // A new password for one host admin (ADMIN_PASSWORD on start, for recovery). Its second factor is kept.
  setAdminPasswordHash(key, passwordHash) {
    const admin = this.data.hostAdmins.find((a) => a.key === key);
    if (!admin) throw new HostError('no such host admin', 404);
    admin.passwordHash = passwordHash;
    this.save();
  }

  removeAdmin(key) {
    if (!this.data.hostAdmins.some((a) => a.key === key)) throw new HostError('no such host admin', 404);
    if (this.data.hostAdmins.length <= 1) throw new HostError('the last host admin cannot be removed');
    this.data.hostAdmins = this.data.hostAdmins.filter((a) => a.key !== key);
    this.save();
  }

  // --- the host admins' own second factor (documentation/plans/plan-mfa.md) -- the same five operations as
  // Store's, mirrored here since a host admin is not an environment's user record at all (see /api/host/me/mfa/*,
  // POST /api/host/login/verify, and the owner reset below).
  hostAdminMfaStart(key, secretCipher) {
    const admin = this.findAdminByKey(key);
    if (!admin) throw new HostError('no such host admin', 404);
    admin.mfa = admin.mfa || { secret: null, enrolledAt: null, recovery: [], version: 0, lastStep: null, pending: null };
    admin.mfa.pending = { secret: secretCipher, startedAt: new Date().toISOString() };
    this.save();
    return admin.mfa;
  }

  hostAdminMfaEnable(key, recoveryHashes) {
    const admin = this.findAdminByKey(key);
    if (!admin) throw new HostError('no such host admin', 404);
    if (!admin.mfa?.pending) throw new HostError('start enrolment first');
    admin.mfa = { secret: admin.mfa.pending.secret, enrolledAt: new Date().toISOString(), recovery: recoveryHashes, version: (admin.mfa.version || 0) + 1, lastStep: null, pending: null };
    this.save();
    return admin.mfa;
  }

  hostAdminMfaDisable(key) {
    const admin = this.findAdminByKey(key);
    if (!admin) throw new HostError('no such host admin', 404);
    admin.mfa = null;
    this.save();
  }

  hostAdminMfaRecordStep(key, step) {
    const admin = this.findAdminByKey(key);
    if (!admin?.mfa) return;
    admin.mfa.lastStep = step;
    this.save();
  }

  hostAdminMfaSpendRecovery(key, hash) {
    const admin = this.findAdminByKey(key);
    if (!admin?.mfa) return;
    admin.mfa.recovery = admin.mfa.recovery.filter((h) => h !== hash);
    admin.mfa.version = (admin.mfa.version || 0) + 1;
    this.save();
  }
}

module.exports = { HostRegistry, HostError, cleanSlug, cleanPlan, defaultPlan, RESERVED_SLUGS, randomKey };
