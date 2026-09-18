// Installed modules: validating an uploaded zip, unpacking it, and keeping the
// registry of what is installed, enabled, and approved. See docs/MODULES.md.
//
// On disk, under DATA_DIR/modules:
//   registry.json                     what is installed and its state
//   <id>/versions/<version>/...       the module's files, one folder per version
//   <id>/data/                        the module's own data (kept across upgrades)
//
// Modules are front-end only: nothing in a zip is ever run by the server, so
// the file types are allowlisted and the zip is read entirely in memory
// against hard caps before a single byte is written.

const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');
const { StoreError } = require('./store');

const MB = 1024 * 1024;
const LIMITS = {
  zipBytes: 10 * MB, // the upload itself
  files: 500,
  fileBytes: 10 * MB, // any one file, unpacked
  totalBytes: 40 * MB, // everything, unpacked
  keepVersions: 3, // newest versions kept for rollback, plus the active one
};
const ALLOWED_EXT = new Set([
  '.html', '.htm', '.js', '.mjs', '.css', '.json', '.txt', '.md', '.map',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
  '.woff', '.woff2', '.ttf', '.otf',
]);
const HOOKS = ['schedule', 'notify'];
const SCOPES = ['server', 'room'];
const ID_RE = /^[a-z][a-z0-9-]{1,31}$/;
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

class ModuleError extends StoreError {}

const parseVersion = (v) => v.split('.').map(Number);
function compareVersions(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

// --- reading the zip ------------------------------------------------------

// Every regular file in the zip as name -> Buffer, or a ModuleError. Nothing
// touches the disk here.
function readZip(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(new ModuleError("that isn't a readable zip file"));
      const files = new Map();
      let total = 0;
      const fail = (message) => { zip.close(); reject(new ModuleError(message)); };
      zip.on('error', (e) => fail(/relative path|absolute path|invalid characters/.test(e?.message || '') ? 'the zip contains an unsafe file path' : "that isn't a readable zip file"));
      zip.on('end', () => resolve(files));
      zip.on('entry', (entry) => {
        const name = entry.fileName;
        if (name.endsWith('/')) return zip.readEntry(); // a folder
        if (name.startsWith('__MACOSX/') || path.posix.basename(name) === '.DS_Store') return zip.readEntry();
        if (files.size >= LIMITS.files) return fail(`too many files (more than ${LIMITS.files})`);
        // yauzl has already refused absolute paths, "..", and backslashes.
        if (/[\u0000-\u001f]/.test(name)) return fail(`bad file name: ${name}`);
        const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (mode === 0o120000) return fail(`symbolic links aren't allowed: ${name}`);
        if (!ALLOWED_EXT.has(path.posix.extname(name).toLowerCase())) return fail(`file type not allowed: ${name}`);
        if (entry.uncompressedSize > LIMITS.fileBytes) return fail(`${name} is larger than ${LIMITS.fileBytes / MB} MB`);
        total += entry.uncompressedSize;
        if (total > LIMITS.totalBytes) return fail(`the module is larger than ${LIMITS.totalBytes / MB} MB unpacked`);
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr) return fail("that isn't a readable zip file");
          const chunks = [];
          let size = 0;
          stream.on('data', (chunk) => {
            size += chunk.length; // trust the bytes, not the header's claim
            if (size > LIMITS.fileBytes) { stream.destroy(); return fail(`${name} is larger than ${LIMITS.fileBytes / MB} MB`); }
            chunks.push(chunk);
          });
          stream.on('error', () => fail("that isn't a readable zip file"));
          stream.on('end', () => {
            files.set(name, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

// A zip made by right-clicking a folder has everything inside that one
// folder; accept that as well as module.json at the root.
function stripWrapperFolder(files) {
  if (files.has('module.json')) return files;
  const roots = new Set([...files.keys()].map((n) => n.split('/')[0]));
  if (roots.size !== 1) return files;
  const [root] = roots;
  if (!files.has(`${root}/module.json`)) return files;
  return new Map([...files].map(([n, data]) => [n.slice(root.length + 1), data]));
}

// --- the manifest ---------------------------------------------------------

const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

function cleanEntry(value, files, what) {
  const entry = typeof value === 'string' ? value.trim() : '';
  if (!entry || !/^[A-Za-z0-9_.\-/]+$/.test(entry) || entry.startsWith('/') || entry.split('/').includes('..')) {
    throw new ModuleError(`${what} needs a valid "entry" file`);
  }
  if (!/\.html?$/i.test(entry)) throw new ModuleError(`${what} entry must be an .html file`);
  if (!files.has(entry)) throw new ModuleError(`${what} entry ${entry} isn't in the zip`);
  return entry;
}

const clamp = (value, min, max, fallback) => (Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Math.round(Number(value)))) : fallback);

// The validated manifest we keep, or a ModuleError saying what's wrong.
// Anything the manifest says beyond these fields is ignored.
function cleanManifest(raw, files) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ModuleError('module.json must be an object');
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!ID_RE.test(id)) throw new ModuleError('module.json: "id" must be 2-32 lowercase letters, digits or dashes, starting with a letter');
  const name = text(raw.name, 40);
  if (!name) throw new ModuleError('module.json: "name" is required');
  const version = typeof raw.version === 'string' ? raw.version.trim() : '';
  if (!VERSION_RE.test(version)) throw new ModuleError('module.json: "version" must look like 1.2.3');
  const scope = [...new Set(Array.isArray(raw.scope) ? raw.scope : [])].filter((s) => SCOPES.includes(s));
  if (!scope.length) throw new ModuleError('module.json: "scope" must include "server", "room", or both');
  const icon = typeof raw.icon === 'string' && /^[a-z0-9-]{1,40}$/.test(raw.icon) ? raw.icon : 'puzzle-piece';

  const surfaces = {};
  if (raw.surfaces?.page) surfaces.page = { entry: cleanEntry(raw.surfaces.page.entry, files, 'surfaces.page') };
  if (raw.surfaces?.panel) {
    surfaces.panel = {
      entry: cleanEntry(raw.surfaces.panel.entry, files, 'surfaces.panel'),
      width: clamp(raw.surfaces.panel.width, 240, 1200, 420),
      height: clamp(raw.surfaces.panel.height, 200, 1000, 520),
    };
  }
  if (scope.includes('server') && !surfaces.page) throw new ModuleError('a "server" module needs a surfaces.page');
  if (scope.includes('room') && !surfaces.panel) throw new ModuleError('a "room" module needs a surfaces.panel');

  const permissions = [];
  for (const p of Array.isArray(raw.permissions) ? raw.permissions.slice(0, 20) : []) {
    const key = typeof p?.key === 'string' ? p.key.trim() : '';
    if (!/^[a-z][a-z0-9_]{0,23}$/.test(key)) throw new ModuleError(`module.json: permission key "${key}" must be lowercase letters, digits or underscores`);
    if (permissions.some((x) => x.key === key)) throw new ModuleError(`module.json: permission "${key}" is listed twice`);
    const d = p.default && typeof p.default === 'object' ? p.default : {};
    permissions.push({
      key,
      label: text(p.label, 60) || key,
      default: { user: Boolean(d.user), guest: Boolean(d.guest), moderator: Boolean(d.moderator ?? d.user) },
    });
  }
  const hooks = Object.fromEntries(HOOKS.map((h) => [h, Boolean(raw.hooks?.[h])]));

  return { id, name, version, description: text(raw.description, 200), author: text(raw.author, 60), icon, scope, surfaces, permissions, hooks };
}

// --- the registry ---------------------------------------------------------

class ModuleManager {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'modules');
    this.file = path.join(this.dir, 'registry.json');
    this.registry = { modules: {} };
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && typeof raw.modules === 'object') this.registry = raw;
    } catch {
      // first run, or unreadable: start empty (module files are untouched)
    }
  }

  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.registry, null, 2));
    fs.renameSync(tmp, this.file);
  }

  versionDir(id, version) {
    return path.join(this.dir, id, 'versions', version);
  }

  dataDirFor(id) {
    return path.join(this.dir, id, 'data');
  }

  manifestOf(id, version) {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.versionDir(id, version), 'module.json'), 'utf8'));
    } catch {
      return null;
    }
  }

  // What the active version asks for that an admin hasn't approved yet.
  pendingFor(entry, manifest) {
    const approved = entry.approved || { permissions: [], hooks: [] };
    return {
      permissions: manifest.permissions.filter((p) => !approved.permissions.includes(p.key)).map((p) => p.key),
      hooks: HOOKS.filter((h) => manifest.hooks[h] && !approved.hooks.includes(h)),
    };
  }

  view(id) {
    const entry = this.registry.modules[id];
    if (!entry) return null;
    const manifest = this.manifestOf(id, entry.version);
    if (!manifest) return null;
    const pending = this.pendingFor(entry, manifest);
    return {
      ...manifest,
      enabled: Boolean(entry.enabled),
      allRooms: Boolean(entry.allRooms),
      rooms: entry.rooms || [],
      versions: [...entry.versions].sort(compareVersions).reverse(),
      needsApproval: pending.permissions.length > 0 || pending.hooks.length > 0,
      pending,
      installedAt: entry.installedAt,
      updatedAt: entry.updatedAt,
    };
  }

  list() {
    return Object.keys(this.registry.modules).map((id) => this.view(id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  }

  async install(buffer) {
    if (!buffer || !buffer.length) throw new ModuleError('choose a zip file to install');
    if (buffer.length > LIMITS.zipBytes) throw new ModuleError(`the zip is larger than ${LIMITS.zipBytes / MB} MB`);
    const files = stripWrapperFolder(await readZip(buffer));
    const manifestFile = files.get('module.json');
    if (!manifestFile) throw new ModuleError('module.json is missing from the zip');
    let raw;
    try {
      raw = JSON.parse(manifestFile.toString('utf8'));
    } catch {
      throw new ModuleError("module.json isn't valid JSON");
    }
    const manifest = cleanManifest(raw, files);
    const existing = this.registry.modules[manifest.id];
    if (existing) {
      const newest = [...existing.versions].sort(compareVersions).pop();
      if (compareVersions(manifest.version, newest) <= 0) {
        throw new ModuleError(`${manifest.name} ${newest} is already installed; upload a newer version, or use Roll back for an older one`);
      }
    }

    // Unpack next to the final spot, then move into place in one step.
    const finalDir = this.versionDir(manifest.id, manifest.version);
    const staging = path.join(this.dir, `.staging-${process.pid}-${Date.now()}`);
    try {
      for (const [name, data] of files) {
        const target = path.join(staging, name);
        if (!target.startsWith(staging + path.sep)) throw new ModuleError(`bad file name: ${name}`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, data);
      }
      fs.mkdirSync(path.dirname(finalDir), { recursive: true });
      fs.rmSync(finalDir, { recursive: true, force: true });
      fs.renameSync(staging, finalDir);
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }

    const now = new Date().toISOString();
    const entry = existing || {
      id: manifest.id, versions: [], enabled: false, allRooms: false, rooms: [], approved: { permissions: [], hooks: [] }, installedAt: now,
    };
    entry.versions.push(manifest.version);
    entry.version = manifest.version;
    entry.updatedAt = now;
    // An upgrade that asks for anything new goes back to waiting for approval.
    if (this.pendingFor(entry, manifest).permissions.length || this.pendingFor(entry, manifest).hooks.length) entry.enabled = false;
    this.registry.modules[manifest.id] = entry;
    this.prune(entry);
    this.save();
    return this.view(manifest.id);
  }

  // Keep only the newest few versions for rollback (never the active one).
  prune(entry) {
    const sorted = [...entry.versions].sort(compareVersions).reverse();
    for (const v of sorted.slice(LIMITS.keepVersions)) {
      if (v === entry.version) continue;
      fs.rmSync(this.versionDir(entry.id, v), { recursive: true, force: true });
      entry.versions = entry.versions.filter((x) => x !== v);
    }
  }

  get(id) {
    const entry = this.registry.modules[id];
    if (!entry) throw new ModuleError('no such module', 404);
    return entry;
  }

  // enabled: turning a module on records that the admin approved what its
  // active version asks for. allRooms / rooms: where a room module is on.
  update(id, patch, { roomExists = () => true } = {}) {
    const entry = this.get(id);
    const manifest = this.manifestOf(id, entry.version);
    if (patch.enabled !== undefined) {
      entry.enabled = Boolean(patch.enabled);
      if (entry.enabled) {
        entry.approved = { permissions: manifest.permissions.map((p) => p.key), hooks: HOOKS.filter((h) => manifest.hooks[h]) };
      }
    }
    if (patch.allRooms !== undefined) {
      if (!manifest.scope.includes('room')) throw new ModuleError('this module has no room panel');
      entry.allRooms = Boolean(patch.allRooms);
    }
    if (patch.rooms !== undefined) {
      if (!manifest.scope.includes('room')) throw new ModuleError('this module has no room panel');
      if (!Array.isArray(patch.rooms)) throw new ModuleError('rooms must be a list');
      entry.rooms = [...new Set(patch.rooms.filter((r) => typeof r === 'string' && roomExists(r)))];
    }
    this.save();
    return this.view(id);
  }

  rollback(id, version) {
    const entry = this.get(id);
    if (!entry.versions.includes(version) || version === entry.version) throw new ModuleError('that version is not available');
    entry.version = version;
    entry.updatedAt = new Date().toISOString();
    const manifest = this.manifestOf(id, version);
    const pending = this.pendingFor(entry, manifest);
    if (pending.permissions.length || pending.hooks.length) entry.enabled = false;
    this.save();
    return this.view(id);
  }

  uninstall(id, { keepData = true } = {}) {
    this.get(id);
    fs.rmSync(path.join(this.dir, id, 'versions'), { recursive: true, force: true });
    if (!keepData) fs.rmSync(path.join(this.dir, id), { recursive: true, force: true });
    delete this.registry.modules[id];
    this.save();
  }
}

module.exports = { ModuleManager, ModuleError, cleanManifest, readZip, compareVersions, LIMITS };
