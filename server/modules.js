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
const HOOKS = ['schedule', 'notify', 'ai'];
// What a card (the small summary another module may show of an item) can carry, and which of the
// producing module's own stored fields fill it. See documentation/api/api-module-sdk.md ("Refs").
const CARD_FIELDS = ['title', 'subtitle', 'when', 'end', 'allDay', 'done', 'place', 'category', 'text'];
const REF_KIND_RE = /^[a-z][a-z0-9-]{0,23}$/;
const REF_CONSUME_RE = /^[a-z][a-z0-9-]{1,31}:[a-z][a-z0-9-]{0,23}$/;
const SCOPES = ['server', 'room', 'person'];
const ID_RE = /^[a-z][a-z0-9-]{1,31}$/;
// Ids no module may take: 'ai' names the server-wide AI service (not a module) in `missing`/`aiDependents`, the same way a
// module id would, so it must never also be a real one.
const RESERVED_IDS = ['ai'];
const { cleanRows } = require('./setting-list');
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
    // handles host.refs.onOpen); whether it shows what links to its items (host.refs.linksTo).
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

// Events and actions: how modules react to and ask things of each other, carried by the host without
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
    // `local`: a view, carried out only by the requesting person's own open page of the module and needing only read access
    // (showing something on a map), not something done for the room.
    // `needs`: what the item a `ref` input points at must have on its card for this action to make sense of it (a
    // position, a date, text), so a drop menu leaves it out for an item without -- "Show on the map" for a task, say.
    const needs = [...new Set((Array.isArray(p.needs) ? p.needs : []).filter((f) => ['place', 'date', 'text', 'subtitle'].includes(f)))];
    actions.provides.push({ name, label: String(p.label ?? '').replace(/\p{Cc}/gu, ' ').trim().slice(0, 60) || name, input, ...(p.local === true ? { local: true } : {}), ...(needs.length ? { needs } : {}) });
  }
  for (const c of Array.isArray(rawActions?.uses) ? rawActions.uses.slice(0, 20) : []) {
    if (typeof c !== 'string' || (c !== '*' && !BUS_USE_RE.test(c))) throw new ModuleError(`module.json: actions.uses "${c}" must be "*" or look like "module:action"`);
    if (c !== '*' && c.split(':')[0] === id) throw new ModuleError('module.json: a module does not need to use its own actions');
    if (!actions.uses.includes(c)) actions.uses.push(c);
  }
  return { events, actions };
}

// The settings a module declares: up to 40, each with a scope (who chooses it), a type and a default.
const SETTING_TYPES = ['boolean', 'choice', 'number', 'text', 'url', 'file', 'files', 'list', 'color', 'note'];
const SETTING_SCOPES = ['server', 'room', 'person'];
const COLOR_RE = /^#[0-9a-f]{6}$/i;
// A path a keyed surface (surfaces.keyed.path) may not claim: the host's own top-level routes, kept here so a
// module manifest is refused up front rather than claiming a path nothing would ever route to it. "view" is
// deliberately not here -- the Stream module's own claim, left reachable once GET /view/:key's page-serving
// goes in phase 3 (see plan-stream-module.md); until then the old route simply answers first (it is registered
// earlier), so the claim exists but nothing reaches it yet.
const RESERVED_KEYED_PATHS = ['api', 'm', 'modules', 'img', 'login', 'logout', 'register', 'guest', 'rooms', 'spaces', 'admin', 'profile', 'fa', 'lib', 'assets', 'sdk', 'invite', 'me', 'module-settings'];
const KEYED_PATH_RE = /^[a-z0-9-]{2,20}$/;
// A module's place search, asked from the server (see geocode.js): which settings say where to search, and the providers it knows.
// { provider: <a choice setting>, address: <a url setting for a custom address>, save: <a boolean setting: keep what comes back>,
//   custom: <the provider value that means the address>, providers: { <provider value>: { address, credit } } }, or null.
// A module's `uploads`: the files its people may add ({ types, maxBytes, maxFiles }), or null for none. Only pictures for now.
function cleanUploads(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ModuleError('module.json: uploads must be an object');
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  const types = Array.isArray(raw.types) ? [...new Set(raw.types.filter((t) => allowed.includes(t)))] : allowed;
  if (!types.length) throw new ModuleError('module.json: uploads.types can be image/jpeg, image/png and image/webp');
  const num = (v, max, def) => (Number.isInteger(v) && v >= 1 ? Math.min(v, max) : def);
  return { types, maxBytes: num(raw.maxBytes, 10 * 1024 * 1024, 10 * 1024 * 1024), maxFiles: num(raw.maxFiles, 5000, 500) };
}

// A module's own `regionSource`: cutting a region out of a larger PMTiles file into one of its own file folders (see
// server/region-cut.js). `folder` must be a `files`-type setting's own folder (so the admin already has a way to see and
// tick what lands there), and `address` a `url` setting naming where to cut from.
function cleanRegionSource(raw, settings) {
  if (!raw || typeof raw !== 'object') return null;
  const known = (k, type) => typeof k === 'string' && settings.some((d) => d.key === k && (!type || d.type === type));
  if (typeof raw.folder !== 'string' || !settings.some((d) => d.type === 'files' && d.folder === raw.folder)) throw new ModuleError('module.json: regionSource needs a `folder` matching a "files" setting\'s own folder');
  if (!known(raw.address, 'url')) throw new ModuleError('module.json: regionSource needs an `address` url setting');
  return { folder: raw.folder, address: raw.address };
}

function cleanGeocoder(raw, settings) {
  if (!raw || typeof raw !== 'object') return null;
  const known = (k, type) => typeof k === 'string' && settings.some((d) => d.key === k && (!type || d.type === type));
  if (!known(raw.provider, 'choice') || !known(raw.address, 'url')) throw new ModuleError('module.json: geocoder needs a `provider` choice setting and an `address` url setting');
  const out = { provider: raw.provider, address: raw.address, save: known(raw.save, 'boolean') ? raw.save : '', custom: typeof raw.custom === 'string' ? raw.custom.slice(0, 40) : 'custom', providers: {} };
  for (const [k, v] of Object.entries(raw.providers && typeof raw.providers === 'object' ? raw.providers : {}).slice(0, 5)) {
    if (!/^[a-z][a-z0-9-]{0,23}$/.test(k) || !v || typeof v.address !== 'string' || !/^https:\/\/[^\s]{1,300}$/.test(v.address)) throw new ModuleError(`module.json: geocoder provider "${k}" needs an https address`);
    out.providers[k] = { address: v.address, credit: text(v.credit, 100), name: text(v.name, 30) || k };
  }
  return out;
}

// Longer text that keeps its line breaks, for help that needs more than a line: a setting's own help, and a choice option's.
const longText = (s, n) => String(s ?? '').replace(/(?!\n)\p{Cc}/gu, ' ').replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);

function cleanSettings(raw) {
  const out = [];
  for (const r of Array.isArray(raw) ? raw.slice(0, 40) : []) {
    const key = typeof r?.key === 'string' ? r.key.trim() : '';
    if (!/^[a-z][a-zA-Z0-9]{0,23}$/.test(key)) throw new ModuleError(`module.json: setting key "${key}" must be letters and digits, starting with a lowercase letter`);
    if (out.some((d) => d.key === key)) throw new ModuleError(`module.json: setting "${key}" is listed twice`);
    const type = SETTING_TYPES.includes(r.type) ? r.type : null;
    if (!type) throw new ModuleError(`module.json: setting "${key}" needs a type: ${SETTING_TYPES.join(', ')}`);
    const scope = SETTING_SCOPES.includes(r.scope) ? r.scope : 'server';
    const def = { key, label: text(r.label, 60) || key, help: longText(r.help, 600), type, scope };
    // A setting may be shown only while another one has a given value (`showWhen`), and a choice may start as one of its options
    // when another setting already holds a value and it has none of its own (`defaultIfSet`: for a setting that grew into a choice).
    if (r.showWhen && typeof r.showWhen === 'object') {
      const k = typeof r.showWhen.key === 'string' ? r.showWhen.key : '';
      if (/^[a-z][a-zA-Z0-9]{0,23}$/.test(k) && typeof r.showWhen.value === 'string') def.showWhen = { key: k, value: r.showWhen.value.slice(0, 40) };
      else if (/^[a-z][a-zA-Z0-9]{0,23}$/.test(k) && typeof r.showWhen.not === 'string') def.showWhen = { key: k, not: r.showWhen.not.slice(0, 40) }; // shown unless it has this value
    }
    if (type === 'choice') {
      def.options = (Array.isArray(r.options) ? r.options.slice(0, 12) : []).map((o) => ({ value: typeof o?.value === 'string' ? o.value.trim().slice(0, 40) : '', label: text(o?.label, 40), help: longText(o?.help, 600) })).filter((o) => o.value).map((o) => ({ value: o.value, label: o.label || o.value, ...(o.help ? { help: o.help } : {}) }));
      if (def.options.length < 2) throw new ModuleError(`module.json: setting "${key}" needs at least two options`);
      def.default = def.options.some((o) => o.value === r.default) ? r.default : def.options[0].value;
      const dif = r.defaultIfSet;
      if (dif && typeof dif.key === 'string' && /^[a-z][a-zA-Z0-9]{0,23}$/.test(dif.key) && def.options.some((o) => o.value === dif.value)) def.defaultIfSet = { key: dif.key, value: dif.value };
    } else if (type === 'number') {
      if (Number.isFinite(r.min)) def.min = r.min;
      if (Number.isFinite(r.max)) def.max = r.max;
      let d = Number.isFinite(r.default) ? r.default : def.min ?? 0;
      if (def.min !== undefined) d = Math.max(def.min, d);
      if (def.max !== undefined) d = Math.min(def.max, d);
      def.default = d;
    } else if (type === 'list') {
      // Rows with a label, an icon and a colour (see setting-list.js); `fixed` names rows that cannot be removed.
      def.fixed = (Array.isArray(r.fixed) ? r.fixed : []).filter((x) => typeof x === 'string' && /^[a-z][a-z0-9-]{0,29}$/.test(x)).slice(0, 20);
      def.maxLength = clamp(r.maxLength, 1, 30, 30);
      try {
        def.default = cleanRows(Array.isArray(r.default) ? r.default : [], def);
      } catch (err) {
        throw new ModuleError(`module.json: setting "${key}" default ${err.message}`);
      }
    } else if (type === 'url') {
      def.default = '';
      // Optional limits on an address: https only, and the path must end so (".pmtiles"). Credentials in an address are always refused.
      if (r.httpsOnly === true) def.httpsOnly = true;
      if (typeof r.pathEnds === 'string' && /^\.?[A-Za-z0-9]{1,12}$/.test(r.pathEnds)) def.pathEnds = r.pathEnds.startsWith('.') ? r.pathEnds : `.${r.pathEnds}`;
    } else if (type === 'file' || type === 'files') {
      // A file (or, for `files`, several: a table of what is there with a tick for each) the admin placed for the module, in a folder of the module's own (DATA_DIR/modules/<id>/<folder>/): only the
      // server can choose one. `shared: "host"` makes the folder the host's, one for every environment, rather
      // than each environment's own (documentation/plans/plan-tenants.md, "Shared files: the host's map") --
      // only with a base domain; without one the declaration has no effect, since there is no separate host.
      if (def.scope !== 'server') throw new ModuleError(`module.json: setting "${key}" is a file, so its scope must be "server"`);
      const folder = r.folder === undefined ? 'files' : String(r.folder);
      if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(folder) || folder === 'versions') throw new ModuleError(`module.json: setting "${key}" folder must be lowercase letters, digits and dashes (not "versions")`);
      def.folder = folder;
      if (r.shared === 'host') def.shared = 'host';
      def.default = type === 'files' ? [] : '';
    } else if (type === 'color') {
      def.default = typeof r.default === 'string' && COLOR_RE.test(r.default.trim()) ? r.default.trim().toLowerCase() : '#000000';
    } else if (type === 'note') {
      // A label and a hint among the other settings, with no control and no value of its own -- a way for a
      // module to say where something is set up (a search a sibling module owns, e.g.) without a value to read,
      // validate or store. Always server-level display, whatever scope the manifest asks for or none at all.
      if (r.scope !== undefined && r.scope !== 'server') throw new ModuleError(`module.json: setting "${key}" is a note, so its scope must be "server"`);
      def.scope = 'server';
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
  if (RESERVED_IDS.includes(id)) throw new ModuleError(`module.json: "${id}" is a reserved id and cannot be used`);
  const name = text(raw.name, 40);
  if (!name) throw new ModuleError('module.json: "name" is required');
  const version = typeof raw.version === 'string' ? raw.version.trim() : '';
  if (!VERSION_RE.test(version)) throw new ModuleError('module.json: "version" must look like 1.2.3');
  const scope = [...new Set(Array.isArray(raw.scope) ? raw.scope : [])].filter((s) => SCOPES.includes(s));
  if (!scope.length) throw new ModuleError('module.json: "scope" must include "server", "room", or both');
  const icon = typeof raw.icon === 'string' && /^[a-z0-9-]{1,40}$/.test(raw.icon) ? raw.icon : 'puzzle-piece';

  const surfaces = {};
  // `nav: false` (default true) leaves a module's page out of the main nav's icon row -- for one better
  // reached another way (a room's own pane, a link from what it's about), so the row is not clutter.
  if (raw.surfaces?.page) surfaces.page = { entry: cleanEntry(raw.surfaces.page.entry, files, 'surfaces.page'), nav: raw.surfaces.page.nav !== false };
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
  if (raw.surfaces?.keyed) {
    // A page the access key opens instead of a session, at a path this module claims (one enabled module per
    // path -- see ModuleManager.update's enable guard). Always runs in the page, never a frame, since the host
    // draws media into it directly.
    const k = raw.surfaces.keyed;
    const kpath = typeof k.path === 'string' ? k.path.trim() : '';
    if (!KEYED_PATH_RE.test(kpath)) throw new ModuleError('module.json: surfaces.keyed.path must be 2-20 lowercase letters, digits and dashes');
    if (RESERVED_KEYED_PATHS.includes(kpath)) throw new ModuleError(`module.json: "${kpath}" is a path the host already serves and cannot be claimed`);
    surfaces.keyed = { path: kpath, entry: cleanEntry(k.entry, files, 'surfaces.keyed') };
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
  const geocoder = cleanGeocoder(raw.geocoder, settings);
  const regionSource = cleanRegionSource(raw.regionSource, settings);
  const uploads = cleanUploads(raw.uploads);

  // The modules this one cannot work without: the one place a manifest names another module (at run time every module still
  // reaches another only through the generic conduits). It cannot be turned on until they are on.
  const requires = [];
  for (const r of Array.isArray(raw.requires) ? raw.requires.slice(0, 5) : []) {
    if (typeof r !== 'string' || !ID_RE.test(r) || r === id) throw new ModuleError('module.json: requires must list other modules by id');
    if (!requires.includes(r)) requires.push(r);
  }

  // How a bundled module gets onto a fresh or updated environment without an admin visiting Modules first (see
  // ModuleManager.autoInstall in index.js's environmentFor): `auto` installs and enables it once, ever, per
  // environment; `settingsFrom: "server"` copies each declared server-scope setting's value out of the host's
  // own store.settings on that same install, for one whose fields used to live there.
  const install = raw.install && typeof raw.install === 'object'
    ? { auto: raw.install.auto === true, settingsFrom: raw.install.settingsFrom === 'server' ? 'server' : null }
    : null;

  return { id, name, version, description: text(raw.description, 200), author: text(raw.author, 60), icon, scope, surfaces, permissions, hooks, refs, events, actions, access, settings, requires, geocoder, uploads, regionSource, install };
}

// --- the registry ---------------------------------------------------------

class ModuleManager {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'modules');
    this.file = path.join(this.dir, 'registry.json');
    this.registry = { modules: {} };
    this.manifests = new Map(); // "id@version" -> manifest, so permission checks do not hit the disk
    // Whether the server-wide AI service is set up and switched on: a module that declares hooks.ai depends on it the way
    // one module can depend on another (see cleanGeocoder... no, see 'ai' in missing/aiDependents below). Set once, after
    // both this and the Ai instance exist (index.js), since the AI service is not a module Modules otherwise knows about.
    this.aiReady = () => false;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && typeof raw.modules === 'object') this.registry = raw;
    } catch {
      // first run, or unreadable: start empty (module files are untouched)
    }
    if (!Array.isArray(this.registry.autoInstalled)) this.registry.autoInstalled = [];
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

  isInstalled(id) {
    return Boolean(this.registry.modules[id]);
  }

  // Whether a bundled module's install.auto has already run for this environment, ever -- checked before
  // running it again (see autoInstall in index.js's environmentFor), so an admin who later uninstalls the
  // module is respected rather than having it reinstalled out from under them on the next start.
  autoInstalled(id) {
    return this.registry.autoInstalled.includes(id);
  }

  markAutoInstalled(id) {
    if (!this.registry.autoInstalled.includes(id)) {
      this.registry.autoInstalled.push(id);
      this.save();
    }
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
      manifest.requires = Array.isArray(manifest.requires) ? manifest.requires.filter((r) => typeof r === 'string' && ID_RE.test(r) && r !== id).slice(0, 5) : [];
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
      try { manifest.geocoder = cleanGeocoder(manifest.geocoder, manifest.settings); } catch { manifest.geocoder = null; }
      try { manifest.regionSource = cleanRegionSource(manifest.regionSource, manifest.settings); } catch { manifest.regionSource = null; }
      try { manifest.uploads = cleanUploads(manifest.uploads); } catch { manifest.uploads = null; }
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

  // The enabled module claiming a keyed path (surfaces.keyed.path), with its run mode -- at most one, kept true
  // by the enable guard in update(). null when nothing enabled claims it.
  keyedFor(path) {
    const found = this.enabledAll().find(({ manifest }) => manifest.surfaces.keyed?.path === path);
    return found ? { manifest: found.manifest, entry: found.entry, runMode: this.runModeOf(found.entry) } : null;
  }

  // Every path an enabled module currently claims.
  keyedPaths() {
    return this.enabledAll().filter(({ manifest }) => manifest.surfaces.keyed).map(({ manifest }) => manifest.surfaces.keyed.path);
  }

  // The installed module claiming a path even while off -- for the 404 sentence when a keyed path's module is
  // not enabled. Not the bundled-but-never-installed case (index.js checks the bundled list itself for that,
  // since only it knows where bundled modules live on disk).
  keyedClaimant(path) {
    for (const id of Object.keys(this.registry.modules)) {
      const entry = this.registry.modules[id];
      const manifest = this.manifestOf(id, entry.version);
      if (manifest?.surfaces.keyed?.path === path) return manifest;
    }
    return null;
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
      // What this needs that is not on (module ids, and 'ai' for the AI service), and the enabled modules that need this one.
      missing: this.missingFor(manifest),
      dependents: this.dependentsOf(id),
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

  // The enabled modules that list `id` in their `requires`.
  dependentsOf(id) {
    const out = [];
    for (const [other, e] of Object.entries(this.registry.modules)) {
      if (other === id || !e.enabled) continue;
      const m = this.manifestOf(other, e.version);
      if (m && (m.requires || []).includes(id)) out.push(other);
    }
    return out;
  }

  // What a manifest needs that is not there: other modules from `requires`, plus `'ai'` when it declares the `ai` hook and
  // the AI service is not enabled. The AI service is not a module (Modules knows nothing else about it), so it is named by
  // this one reserved id rather than added to the registry.
  missingFor(manifest) {
    const missing = (manifest.requires || []).filter((r) => !(this.registry.modules[r] && this.registry.modules[r].enabled));
    if (manifest.hooks.ai && !this.aiReady()) missing.push('ai');
    return missing;
  }

  // The enabled modules that declare the `ai` hook: what depends on the AI service, the way `dependentsOf` says what depends
  // on a module. For the AI service's own admin page, and to cascade turning it off.
  aiDependents() {
    return this.enabledAll().filter(({ manifest }) => manifest.hooks.ai).map(({ manifest }) => ({ id: manifest.id, name: manifest.name }));
  }

  // A missing id's name for a message: another module's, or "the AI service".
  missingName(r) {
    return r === 'ai' ? 'the AI service' : (this.registry.modules[r] ? this.manifestOf(r, this.registry.modules[r].version).name : r);
  }

  list() {
    return Object.keys(this.registry.modules).map((id) => this.view(id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  }

  // Where a module runs. A module that ships with the app is the server's own code and runs in the page;
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
    entry.source = source; // 'bundled' (shipped with this deployment) or 'upload'
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
      if (patch.enabled) {
        const missing = this.missingFor(manifest);
        if (missing.length) throw new ModuleError(`${manifest.name} needs ${missing.map((r) => this.missingName(r)).join(' and ')} installed and turned on first`);
        // One enabled module per keyed path: another one already there means naming it, not silently taking over.
        if (manifest.surfaces.keyed) {
          const holder = this.keyedFor(manifest.surfaces.keyed.path);
          if (holder && holder.manifest.id !== id) throw new ModuleError(`"${manifest.surfaces.keyed.path}" is already claimed by ${holder.manifest.name}`);
        }
      } else {
        // Turning off a module others need: those go off with it, but only when the caller said so (`force`).
        const needing = this.dependentsOf(id);
        if (needing.length && patch.force !== true) throw new ModuleError(`${needing.map((r) => this.manifestOf(r, this.registry.modules[r].version).name).join(' and ')} needs ${manifest.name}; turn ${needing.length === 1 ? 'it' : 'them'} off too?`);
        for (const r of needing) this.registry.modules[r].enabled = false;
      }
      entry.enabled = Boolean(patch.enabled);
      if (entry.enabled) {
        entry.approved = { permissions: manifest.permissions.map((p) => p.key), hooks: HOOKS.filter((h) => manifest.hooks[h]), refs: [...manifest.refs.consumes], events: [...manifest.events.subscribes], actions: [...manifest.actions.uses] };
      }
    }
    // Running in the page gives a module the page's own power, so for an uploaded module the admin has to
    // say they understand (`acceptRisk`); one that ships with the app already does. Sandboxed is always allowed.
    if (patch.runMode !== undefined) {
      if (patch.runMode === 'sandbox') {
        if (manifest.surfaces.keyed) throw new ModuleError('this module has a keyed page, so it must run in the page, not a frame');
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
      for (const d of (m && m.settings) || []) if ((d.type === 'file' || d.type === 'files') && d.folder) out.add(d.folder);
    }
    return out;
  }

  uninstall(id, { keepData = true } = {}) {
    this.get(id);
    for (const r of this.dependentsOf(id)) this.registry.modules[r].enabled = false; // what needed it goes off with it
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
