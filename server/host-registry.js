// The host's own registry: which environments (tenants) exist, their slugs and plans, and the host admins who run
// the deployment itself (a different kind of account from any environment's users -- a member of no tenant).
// Persists to DATA_DIR/host.json. Only built and read when BASE_DOMAIN is set; a self-hosted install with no base
// domain never has this file at all (see documentation/plans/plan-tenants.md).
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { cleanText, cleanLogin, randomToken } = require('./store');
const { applyAiFields, PROVIDERS: AI_PROVIDERS } = require('./ai');

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

// modules: the ids a tenant may enable, or 'all' (today's single-tenant install, and any tenant an admin has not
// capped yet). The rest are caps a later phase enforces; null means uncapped. Nothing here is billing -- just what
// is stored and shown in phase 1.
const STATUSES = ['active', 'pastDue', 'suspended'];
const defaultPlan = () => ({ modules: 'all', members: null, storageBytes: null, aiCallsPerMonth: null, calls: null });

function cleanPlan(raw, fallback) {
  if (!raw || typeof raw !== 'object') return fallback || defaultPlan();
  const modules = raw.modules === 'all' ? 'all' : Array.isArray(raw.modules) ? [...new Set(raw.modules.filter((m) => typeof m === 'string' && /^[a-z][a-z0-9-]{1,31}$/.test(m)))].slice(0, 200) : (fallback || defaultPlan()).modules;
  const cap = (n, was) => (n === null ? null : Number.isFinite(n) && n >= 0 ? Math.round(n) : was);
  const base = fallback || defaultPlan();
  return { modules, members: cap(raw.members, base.members), storageBytes: cap(raw.storageBytes, base.storageBytes), aiCallsPerMonth: cap(raw.aiCallsPerMonth, base.aiCallsPerMonth), calls: cap(raw.calls, base.calls) };
}

// The host's managed AI service (documentation/plans/plan-tenants.md, "Managed AI"): a plain shape, not
// validated the way a PUT is (applyAiFields, used by setManagedAi) -- corrupt or old data just falls back to
// "none" here, the same lenient way cleanTenantRecord reads a tenant.
function cleanHostAi(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    provider: AI_PROVIDERS.includes(r.provider) ? r.provider : 'none',
    address: typeof r.address === 'string' ? r.address : '',
    model: typeof r.model === 'string' ? r.model : '',
    key: typeof r.key === 'string' ? r.key : '',
  };
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

function cleanTenantRecord(raw) {
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
      // Signs a host admin's own session cookie (never a tenant's own secret, kept in that tenant's own store).
      secrets: { session: raw.secrets?.session || randomToken(32) },
      hostAdmins: Array.isArray(raw.hostAdmins) ? raw.hostAdmins.filter((a) => a && typeof a.key === 'string' && typeof a.login === 'string' && typeof a.passwordHash === 'string') : [],
      tenants: Array.isArray(raw.tenants) ? raw.tenants.map(cleanTenantRecord).filter(Boolean) : [],
      ai: cleanHostAi(raw.ai),
      shared: cleanSharedFolders(raw.shared),
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

  // ai ----------------------------------------------------------------------------------------------------
  // The host's own managed AI service, above every environment: real values (including the key), for building
  // an Ai instance's `managed()` callback (server/index.js) and for an environment's own listing/answering
  // calls. Never returned from a route as-is -- GET /api/host/ai answers keySet/keyFromEnvironment instead.
  get managedAi() {
    return { ...this.data.ai };
  }

  setManagedAi(patch) {
    this.data.ai = applyAiFields(this.data.ai, patch);
    this.save();
    return this.managedAi;
  }

  // Used only by index.js's migration seeding: an environment's old provider/address/model, worked only
  // through the old per-environment AI_KEY, becomes the host's starting point -- with no key of its own, since
  // that env var is this host's own live override now (managedAi in index.js), not something to demand here.
  // Never overwrites something already saved (the caller checks too, but a second migrating environment in the
  // same start should not win a race against the first).
  seedManagedAi({ provider, address, model }) {
    if (this.data.ai.provider !== 'none') return;
    this.data.ai = cleanHostAi({ provider, address, model, key: '' });
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

  // tenants -------------------------------------------------------------------------------------------------
  listTenants() {
    return this.data.tenants.map((t) => ({ ...t, plan: { ...t.plan } }));
  }

  findTenant(slug) {
    const t = this.data.tenants.find((x) => x.slug === slug);
    return t ? { ...t, plan: { ...t.plan } } : null;
  }

  // { slug, name, plan? }. plan defaults to uncapped, every module -- the shape a migrated install gets, and a
  // reasonable starting point for one the host console creates (an admin narrows it after).
  addTenant({ slug, name, plan }) {
    const clean = cleanSlug(slug);
    if (this.data.tenants.some((t) => t.slug === clean)) throw new HostError(`"${clean}" is already in use`, 409);
    const tenant = { slug: clean, name: cleanText(name, 80) || clean, createdAt: new Date().toISOString(), plan: cleanPlan(plan), status: 'active', pastDueSince: null };
    this.data.tenants.push(tenant);
    this.save();
    return { ...tenant, plan: { ...tenant.plan } };
  }

  updateTenant(slug, patch) {
    const tenant = this.data.tenants.find((t) => t.slug === slug);
    if (!tenant) throw new HostError('no such environment', 404);
    if (patch && typeof patch === 'object') {
      if (patch.name !== undefined) tenant.name = cleanText(patch.name, 80) || tenant.name;
      if (patch.plan !== undefined) tenant.plan = cleanPlan(patch.plan, tenant.plan);
      if (patch.status !== undefined) {
        if (!STATUSES.includes(patch.status)) throw new HostError(`status must be one of ${STATUSES.join(', ')}`);
        if (patch.status === 'pastDue' && tenant.status !== 'pastDue') tenant.pastDueSince = new Date().toISOString();
        else if (patch.status !== 'pastDue') tenant.pastDueSince = null;
        tenant.status = patch.status;
      }
    }
    this.save();
    return { ...tenant, plan: { ...tenant.plan } };
  }

  // Only the registry entry -- the directory move (to tenants-deleted/) is the caller's job, since this class
  // knows nothing about environments' built services or their data directories beyond the slug.
  removeTenant(slug) {
    const before = this.data.tenants.length;
    this.data.tenants = this.data.tenants.filter((t) => t.slug !== slug);
    if (this.data.tenants.length === before) throw new HostError('no such environment', 404);
    this.save();
  }

  // host admins -----------------------------------------------------------------------------------------------
  listAdmins() {
    return this.data.hostAdmins.map((a) => ({ key: a.key, login: a.login }));
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
    const admin = { key: randomKey(), login: clean, passwordHash };
    this.data.hostAdmins.push(admin);
    this.save();
    return { key: admin.key, login: admin.login };
  }

  removeAdmin(key) {
    if (!this.data.hostAdmins.some((a) => a.key === key)) throw new HostError('no such host admin', 404);
    if (this.data.hostAdmins.length <= 1) throw new HostError('the last host admin cannot be removed');
    this.data.hostAdmins = this.data.hostAdmins.filter((a) => a.key !== key);
    this.save();
  }
}

module.exports = { HostRegistry, HostError, cleanSlug, cleanPlan, defaultPlan, RESERVED_SLUGS, randomKey };
