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
// What a card (the small summary another module may show of an item) can carry, and which of the
// producing module's own stored fields fill it. See documentation/api/api-module-sdk.md ("Refs").
const CARD_FIELDS = ['title', 'subtitle', 'when', 'end', 'allDay', 'done', 'place', 'category'];
const REF_KIND_RE = /^[a-z][a-z0-9-]{0,23}$/;
const REF_CONSUME_RE = /^[a-z][a-z0-9-]{1,31}:[a-z][a-z0-9-]{0,23}$/;
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
// Refs: items a module lets other modules point at (`produces`), and other modules' items it wants
// to point at (`consumes`, approved by an admin like permissions and hooks are). Always returns both
// lists; throws on a bad declaration. The stored module.json is the author's original, so this runs
// again whenever a manifest is read (see manifestOf).
function cleanRefs(rawRefs, id) {
  const refs = { produces: [], consumes: [] };
  for (const p of Array.isArray(rawRefs?.produces) ? rawRefs.produces.slice(0, 10) : []) {
    const kind = typeof p?.kind === 'string' ? p.kind.trim() : '';
    if (!REF_KIND_RE.test(kind)) throw new ModuleError(`module.json: refs kind "${kind}" must be lowercase letters, digits or dashes`);
    if (refs.produces.some((x) => x.kind === kind)) throw new ModuleError(`module.json: refs kind "${kind}" is listed twice`);
    // The stored key an item lives under: a fixed prefix then {id}, such as "event:{id}".
    const key = typeof p.key === 'string' ? p.key : '';
    if (!/^[a-z][a-z0-9_-]{0,23}:\{id\}$/.test(key)) throw new ModuleError(`module.json: refs "${kind}" needs a "key" like "event:{id}"`);
    const card = {};
    for (const field of CARD_FIELDS) {
      const from = p.card?.[field];
      if (from === undefined || from === null) continue;
      if (typeof from !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(from)) throw new ModuleError(`module.json: refs "${kind}" card.${field} must name a stored field`);
      card[field] = from;
    }
    if (!card.title) throw new ModuleError(`module.json: refs "${kind}" needs a card.title`);
    // What a person sees it called; whether the module can open one of its items when asked (it
    // handles tavern.refs.onOpen); whether it shows what links to its items (tavern.refs.linksTo).
    const name = String(p.name ?? '').replace(/\p{Cc}/gu, ' ').trim().slice(0, 40) || kind.charAt(0).toUpperCase() + kind.slice(1);
    refs.produces.push({ kind, name, key, card, open: Boolean(p.open), backlinks: Boolean(p.backlinks) });
  }
  // "*" means whatever other modules share, so a module can link to the items of a module written
  // after it without either being changed; otherwise named kinds, "module:kind".
  for (const c of Array.isArray(rawRefs?.consumes) ? rawRefs.consumes.slice(0, 20) : []) {
    if (typeof c !== 'string' || (c !== '*' && !REF_CONSUME_RE.test(c))) throw new ModuleError(`module.json: refs.consumes "${c}" must be "*" or look like "module:kind"`);
    if (c !== '*' && c.split(':')[0] === id) throw new ModuleError('module.json: a module does not need to consume its own kinds');
    if (!refs.consumes.includes(c)) refs.consumes.push(c);
  }

  return refs;
}

// Events and actions: how modules react to and ask things of each other, carried by Tavern without
// naming any module. A module lists the events it `publishes` and the ones it wants to hear
// (`subscribes`), and the actions it `provides` (a name, a label, the input it takes) and the ones it
// wants to ask for (`uses`). What a module subscribes to or uses is approved by an admin, like refs.
const EVENT_NAME_RE = /^[a-z][a-zA-Z0-9]{0,31}$/;
const FIELD_RE = /^[a-z][a-zA-Z0-9]{0,23}$/;
const FIELD_TYPES = ['string', 'text', 'date', 'datetime', 'boolean', 'number', 'ref'];
const BUS_USE_RE = /^[a-z][a-z0-9-]{1,31}:[a-z][a-zA-Z0-9]{0,31}$/;

function cleanBus(rawEvents, rawActions, id) {
  const events = { publishes: [], subscribes: [] };
  for (const p of Array.isArray(rawEvents?.publishes) ? rawEvents.publishes.slice(0, 10) : []) {
    const name = typeof p?.name === 'string' ? p.name.trim() : '';
    if (!EVENT_NAME_RE.test(name)) throw new ModuleError(`module.json: event name "${name}" must be letters and digits, starting with a lowercase letter`);
    if (events.publishes.some((x) => x.name === name)) throw new ModuleError(`module.json: event "${name}" is listed twice`);
    const kind = typeof p.kind === 'string' && REF_KIND_RE.test(p.kind) ? p.kind : '';
    // What the event carries in its data (up to 6 named fields, typed as an action's input is), so a module
    // that follows an item can offer what to do with each.
    const data = {};
    for (const [field, type] of Object.entries(p.data && typeof p.data === 'object' ? p.data : {}).slice(0, 6)) {
      const base = typeof type === 'string' ? type.replace(/\?$/, '') : '';
      if (!FIELD_RE.test(field) || !FIELD_TYPES.includes(base)) throw new ModuleError(`module.json: event "${name}" data "${field}" must be one of ${FIELD_TYPES.join(', ')} (add ? for optional)`);
      data[field] = type;
    }
    events.publishes.push({ name, kind, label: String(p.label ?? '').replace(/\p{Cc}/gu, ' ').trim().slice(0, 60) || name, data });
  }
  for (const c of Array.isArray(rawEvents?.subscribes) ? rawEvents.subscribes.slice(0, 20) : []) {
    if (typeof c !== 'string' || (c !== '*' && !BUS_USE_RE.test(c))) throw new ModuleError(`module.json: events.subscribes "${c}" must be "*" or look like "module:event"`);
    if (c !== '*' && c.split(':')[0] === id) throw new ModuleError('module.json: a module does not need to subscribe to its own events');
    if (!events.subscribes.includes(c)) events.subscribes.push(c);
  }
  const actions = { provides: [], uses: [] };
  for (const p of Array.isArray(rawActions?.provides) ? rawActions.provides.slice(0, 10) : []) {
    const name = typeof p?.name === 'string' ? p.name.trim() : '';
    if (!EVENT_NAME_RE.test(name)) throw new ModuleError(`module.json: action name "${name}" must be letters and digits, starting with a lowercase letter`);
    if (actions.provides.some((x) => x.name === name)) throw new ModuleError(`module.json: action "${name}" is listed twice`);
    const input = {};
    for (const [field, type] of Object.entries(p.input && typeof p.input === 'object' ? p.input : {}).slice(0, 10)) {
      const base = typeof type === 'string' ? type.replace(/\?$/, '') : '';
      // A pointer field may say which kind of item it takes: "ref" (any) or "ref:module:kind".
      const plain = /^ref:[a-z][a-z0-9-]{1,31}:[a-z][a-z0-9-]{0,31}$/.test(base) ? 'ref' : base;
      if (!FIELD_RE.test(field) || !FIELD_TYPES.includes(plain)) throw new ModuleError(`module.json: action "${name}" input "${field}" must be one of ${FIELD_TYPES.join(', ')} (add ? for optional)`);
      input[field] = type;
    }
    actions.provides.push({ name, label: String(p.label ?? '').replace(/\p{Cc}/gu, ' ').trim().slice(0, 60) || name, input });
  }
  for (const c of Array.isArray(rawActions?.uses) ? rawActions.uses.slice(0, 20) : []) {
    if (typeof c !== 'string' || (c !== '*' && !BUS_USE_RE.test(c))) throw new ModuleError(`module.json: actions.uses "${c}" must be "*" or look like "module:action"`);
    if (c !== '*' && c.split(':')[0] === id) throw new ModuleError('module.json: a module does not need to use its own actions');
    if (!actions.uses.includes(c)) actions.uses.push(c);
  }
  return { events, actions };
}

// The settings a module declares: up to 20, each with a scope (who chooses it), a type and a default.
const SETTING_TYPES = ['boolean', 'choice', 'number', 'text', 'url', 'file'];
const SETTING_SCOPES = ['server', 'room', 'person'];
function cleanSettings(raw) {
  const out = [];
  for (const r of Array.isArray(raw) ? raw.slice(0, 20) : []) {
    const key = typeof r?.key === 'string' ? r.key.trim() : '';
    if (!/^[a-z][a-zA-Z0-9]{0,23}$/.test(key)) throw new ModuleError(`module.json: setting key "${key}" must be letters and digits, starting with a lowercase letter`);
    if (out.some((d) => d.key === key)) throw new ModuleError(`module.json: setting "${key}" is listed twice`);
    const type = SETTING_TYPES.includes(r.type) ? r.type : null;
    if (!type) throw new ModuleError(`module.json: setting "${key}" needs a type: ${SETTING_TYPES.join(', ')}`);
    const scope = SETTING_SCOPES.includes(r.scope) ? r.scope : 'server';
    const def = { key, label: text(r.label, 60) || key, help: text(r.help, 200), type, scope };
    if (type === 'choice') {
      def.options = (Array.isArray(r.options) ? r.options.slice(0, 12) : []).map((o) => ({ value: typeof o?.value === 'string' ? o.value.trim().slice(0, 40) : '', label: text(o?.label, 40) })).filter((o) => o.value).map((o) => ({ value: o.value, label: o.label || o.value }));
      if (def.options.length < 2) throw new ModuleError(`module.json: setting "${key}" needs at least two options`);
      def.default = def.options.some((o) => o.value === r.default) ? r.default : def.options[0].value;
    } else if (type === 'number') {
      if (Number.isFinite(r.min)) def.min = r.min;
      if (Number.isFinite(r.max)) def.max = r.max;
      let d = Number.isFinite(r.default) ? r.default : def.min ?? 0;
      if (def.min !== undefined) d = Math.max(def.min, d);
      if (def.max !== undefined) d = Math.min(def.max, d);
      def.default = d;
    } else if (type === 'url') {
      def.default = '';
    } else if (type === 'file') {
      // A file the admin placed for the module, in a folder of the module's own (DATA_DIR/modules/<id>/<folder>/): only the
      // server can choose one.
      if (def.scope !== 'server') throw new ModuleError(`module.json: setting "${key}" is a file, so its scope must be "server"`);
      const folder = r.folder === undefined ? 'files' : String(r.folder);
      if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(folder) || folder === 'versions') throw new ModuleError(`module.json: setting "${key}" folder must be lowercase letters, digits and dashes (not "versions")`);
      def.folder = folder;
      def.default = '';
    } else if (type === 'text') {
      def.maxLength = clamp(r.maxLength, 1, 200, 100);
      def.default = typeof r.default === 'string' ? r.default.slice(0, def.maxLength) : '';
    } else {
      def.default = Boolean(r.default);
    }
    out.push(def);
  }
  return out;
}

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
      // How a room panel may be shown: floating over the call, docked as a column, or both.
      mode: (() => {
        const modes = [...new Set(Array.isArray(raw.surfaces.panel.mode) ? raw.surfaces.panel.mode : [])].filter((m) => ['float', 'dock'].includes(m));
        return modes.length ? modes : ['float'];
      })(),
    };
  }
  if (raw.surfaces?.widget) {
    // A small view of the module for the dashboard on the rooms page, across the viewer's rooms.
    if (!scope.includes('server')) throw new ModuleError('module.json: a surfaces.widget needs the "server" scope');
    const w = raw.surfaces.widget;
    surfaces.widget = {
      entry: cleanEntry(w.entry, files, 'surfaces.widget'),
      title: text(w.title, 40),
      size: ['small', 'medium', 'wide', 'tall'].includes(w.size) ? w.size : 'small',
      order: Number.isFinite(w.order) ? clamp(Math.round(w.order), -1000, 1000, 100) : 100,
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

  const refs = cleanRefs(raw.refs, id);
  const { events, actions } = cleanBus(raw.events, raw.actions, id);

  // Which of the module's own permissions guards reading and writing its data.
  const access = {};
  for (const kind of ['read', 'write']) {
    const named = raw.access?.[kind];
    if (named === undefined || named === null) continue;
    if (typeof named !== 'string' || !permissions.some((p) => p.key === named)) {
      throw new ModuleError(`module.json: access.${kind} must name one of the module's own permissions`);
    }
    access[kind] = named;
  }

  const settings = cleanSettings(raw.settings);

  return { id, name, version, description: text(raw.description, 200), author: text(raw.author, 60), icon, scope, surfaces, permissions, hooks, refs, events, actions, access, settings };
}

// --- the registry ---------------------------------------------------------

class ModuleManager {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'modules');
    this.file = path.join(this.dir, 'registry.json');
    this.registry = { modules: {} };
    this.manifests = new Map(); // "id@version" -> manifest, so permission checks do not hit the disk
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
    const cacheKey = `${id}@${version}`;
    if (this.manifests.has(cacheKey)) return this.manifests.get(cacheKey);
    let manifest = null;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(this.versionDir(id, version), 'module.json'), 'utf8'));
    } catch {
      // not installed
    }
    if (manifest) {
      // The stored file is the author's original: fill in what it left out.
      manifest.hooks = Object.fromEntries(HOOKS.map((h) => [h, Boolean(manifest.hooks?.[h])]));
      if (!Array.isArray(manifest.permissions)) manifest.permissions = [];
      if (!manifest.access || typeof manifest.access !== 'object') manifest.access = {};
      try {
        manifest.refs = cleanRefs(manifest.refs, id);
      } catch {
        manifest.refs = { produces: [], consumes: [] };
      }
      try {
        const bus = cleanBus(manifest.events, manifest.actions, id);
        manifest.events = bus.events;
        manifest.actions = bus.actions;
      } catch {
        manifest.events = { publishes: [], subscribes: [] };
        manifest.actions = { provides: [], uses: [] };
      }
      try {
        manifest.settings = cleanSettings(manifest.settings);
      } catch {
        manifest.settings = [];
      }
      this.manifests.set(cacheKey, manifest);
    }
    return manifest;
  }

  // The active manifest of an enabled module, with its registry entry, or null.
  enabled(id) {
    const entry = this.registry.modules[id];
    if (!entry || !entry.enabled) return null;
    const manifest = this.manifestOf(id, entry.version);
    return manifest ? { manifest, entry } : null;
  }

  // Every enabled module, for lists and for the permissions grid.
  enabledAll() {
    return Object.keys(this.registry.modules).map((id) => this.enabled(id)).filter(Boolean);
  }

  // The permissions enabled modules add to the Roles grid: module.<id>.<key>.
  permissionList() {
    return this.enabledAll().flatMap(({ manifest }) => manifest.permissions.map((p) => ({
      key: `module.${manifest.id}.${p.key}`,
      label: p.label,
      group: `Module: ${manifest.name}`,
      defaults: p.default,
    })));
  }

  // A file of the active version of an enabled module, as an absolute path, or null.
  resolveFile(id, version, rel) {
    const found = this.enabled(id);
    if (!found || found.entry.version !== version) return null;
    if (typeof rel !== 'string' || rel.includes('\0') || rel.split('/').includes('..')) return null;
    const root = this.versionDir(id, version);
    const full = path.join(root, rel);
    if (!full.startsWith(root + path.sep)) return null;
    try {
      return fs.statSync(full).isFile() ? full : null;
    } catch {
      return null;
    }
  }

  // What the active version asks for that an admin hasn't approved yet.
  pendingFor(entry, manifest) {
    const approved = entry.approved || { permissions: [], hooks: [], refs: [], events: [], actions: [] };
    return {
      permissions: manifest.permissions.filter((p) => !approved.permissions.includes(p.key)).map((p) => p.key),
      hooks: HOOKS.filter((h) => manifest.hooks[h] && !approved.hooks.includes(h)),
      refs: manifest.refs.consumes.filter((c) => !(approved.refs || []).includes(c)),
      events: manifest.events.subscribes.filter((c) => !(approved.events || []).includes(c)),
      actions: manifest.actions.uses.filter((c) => !(approved.actions || []).includes(c)),
    };
  }

  hasPending(pending) {
    return pending.permissions.length > 0 || pending.hooks.length > 0 || pending.refs.length > 0 || pending.events.length > 0 || pending.actions.length > 0;
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
      needsApproval: this.hasPending(pending),
      source: entry.source || 'upload',
      runMode: this.runModeOf(entry),
      runModeChosen: entry.runMode === 'page' || entry.runMode === 'sandbox',
      riskAcceptedAt: entry.riskAcceptedAt || null,
      pending,
      installedAt: entry.installedAt,
      updatedAt: entry.updatedAt,
    };
  }

  list() {
    return Object.keys(this.registry.modules).map((id) => this.view(id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  }

  // Where a module runs. A module that ships with Tavern is the server's own code and runs in the page;
  // an uploaded one runs in a sandboxed frame, unless an admin chose otherwise for it and accepted what
  // that means (see update). `sandbox`: a frame that can reach only what the SDK lets it. `page`: in
  // the page in a container of its own, with the page's own power.
  runModeOf(entry) {
    if (entry.runMode === 'page' || entry.runMode === 'sandbox') return entry.runMode;
    return entry.source === 'bundled' ? 'page' : 'sandbox';
  }

  async install(buffer, { source = 'upload' } = {}) {
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
      id: manifest.id, versions: [], enabled: false, allRooms: false, rooms: [], approved: { permissions: [], hooks: [], refs: [], events: [], actions: [] }, installedAt: now,
    };
    entry.versions.push(manifest.version);
    entry.version = manifest.version;
    entry.updatedAt = now;
    entry.source = source; // 'bundled' (shipped with this Tavern) or 'upload'
    // An upgrade that asks for anything new goes back to waiting for approval.
    if (this.hasPending(this.pendingFor(entry, manifest))) entry.enabled = false;
    this.registry.modules[manifest.id] = entry;
    this.manifests.delete(`${manifest.id}@${manifest.version}`);
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
        entry.approved = { permissions: manifest.permissions.map((p) => p.key), hooks: HOOKS.filter((h) => manifest.hooks[h]), refs: [...manifest.refs.consumes], events: [...manifest.events.subscribes], actions: [...manifest.actions.uses] };
      }
    }
    // Running in the page gives a module the page's own power, so for an uploaded module the admin has to
    // say they understand (`acceptRisk`); one that ships with Tavern already does. Sandboxed is always allowed.
    if (patch.runMode !== undefined) {
      if (patch.runMode === 'sandbox') {
        entry.runMode = 'sandbox';
      } else if (patch.runMode === 'page') {
        if (entry.source !== 'bundled' && patch.acceptRisk !== true) throw new ModuleError('running a module in the page means accepting the risk');
        entry.runMode = 'page';
        if (entry.source !== 'bundled') entry.riskAcceptedAt = new Date().toISOString();
      } else {
        throw new ModuleError('runMode must be "page" or "sandbox"');
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
    if (this.hasPending(pending)) entry.enabled = false;
    this.save();
    return this.view(id);
  }

  // The folders (inside modules/<id>/) the module's file settings name, across its installed versions.
  fileFolders(id) {
    const out = new Set();
    const entry = this.registry.modules[id];
    for (const v of (entry && entry.versions) || []) {
      const m = this.manifestOf(id, v);
      for (const d of (m && m.settings) || []) if (d.type === 'file' && d.folder) out.add(d.folder);
    }
    return out;
  }

  uninstall(id, { keepData = true } = {}) {
    this.get(id);
    const keep = this.fileFolders(id); // read while the versions are still there
    fs.rmSync(path.join(this.dir, id, 'versions'), { recursive: true, force: true });
    if (!keepData) {
      // Files an admin placed for the module (its `file` settings' folders) are never deleted here: they can be gigabytes and
      // are not the module's data. Everything else in its folder goes.
      const dir = path.join(this.dir, id);
      let names = [];
      try { names = fs.readdirSync(dir); } catch { /* nothing there */ }
      for (const n of names) if (!keep.has(n)) fs.rmSync(path.join(dir, n), { recursive: true, force: true });
      try { fs.rmdirSync(dir); } catch { /* not empty: it holds the admin's files */ }
    }
    delete this.registry.modules[id];
    for (const key of [...this.manifests.keys()]) if (key.startsWith(`${id}@`)) this.manifests.delete(key);
    this.save();
  }
}

module.exports = { ModuleManager, ModuleError, cleanManifest, readZip, compareVersions, LIMITS };
