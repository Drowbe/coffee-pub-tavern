'use strict';

// Environment templates (documentation/plans/plan-environment-templates.md): a bundled templates/<id>.json sets an
// environment up for one use. Picked at creation (the host console, the product sign-up, or TEMPLATE= on a fresh
// single install), or switched to later by an owner or the host (the switching addendum). Its words, home icon and
// module display names and icons follow the template live (the store reads them from here on every build); its
// settings, Lobby, space defaults and modules are applied once when the environment is made, or offered on a switch
// and applied as confirmed, and recorded in app.json's own `template` (decision 14).
//
// A template is data: nothing in the code knows which template names which module.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const words = require('./words');
const { Store, SPACE_PROFILES, QUALITY_OPTIONS, LANGUAGES, CURRENCIES, BUILTIN_THEME_IDS, LOBBY, displayNameProblem, cleanReactions } = require('./store');
const themeFile = require('./theme-file');
const { bundledModules, buildModule } = require('./module-build');

const ROOT = path.join(__dirname, '..');
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const MODULES_DIR = path.join(ROOT, 'modules');
// Font Awesome Free's own solid icons: what a template's icons must be, so every page can draw them (fa-solid fa-<id>).
const FA_FREE_SOLID = path.join(ROOT, 'node_modules', '@fortawesome', 'fontawesome-free', 'svgs', 'solid');
// The modules built into every environment: named like a bundled one, never installed.
const BUILTIN_MODULE_IDS = ['conference', 'chat'];
const ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const FIELDS = ['id', 'name', 'description', 'version', 'words', 'icons', 'moduleNames', 'moduleIcons', 'modules', 'settings', 'lobby', 'spaceDefaults', 'reactions', 'theme', 'iconSet'];
const MAX_REACTIONS = 30;
const MAX_ICON_SET = 60;
// The applied-once parts an update can offer, each with a fingerprint of the template's value kept in the record once
// applied or passed over (addendum 2; PM's decision 3), so a part is offered again only when the template changed it.
const PARTS = ['modules', 'reactions', 'theme', 'iconSet', 'lobby', 'spaceDefaults'];
const fingerprint = (value) => crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex').slice(0, 16);
function partFingerprints(template) {
  return Object.fromEntries(PARTS.map((part) => [part, fingerprint(template[part])]));
}
// Whether a part the template applies once changed since a record's fingerprints (`applied`) were taken; a record
// without them (from before fingerprints) counts as changed.
function appliedPartsChanged(record, template) {
  const applied = record && record.applied;
  if (!applied || typeof applied !== 'object') return true;
  const prints = partFingerprints(template);
  return PARTS.some((part) => applied[part] !== prints[part]);
}
// The applied-once part of a template as a whole (modules, settings, the Lobby, space defaults, reactions, icon set,
// theme): a bundled template's version must go up when this changes (tools/template-versions.json).
const appliedOnceFingerprint = (template) => fingerprint(['modules', 'settings', 'lobby', 'spaceDefaults', 'reactions', 'iconSet', 'theme'].map((k) => template[k] ?? null));
// A theme's own check, without a Store: Store#sanitizeTheme reads nothing of the instance.
const sanitizeTheme = (t) => Store.prototype.sanitizeTheme.call(null, t);
// An embedded theme (addendum 2): the theme file's fields, checked as a theme import is. Answers { theme, dropped } or
// throws the theme file's own refusal.
function readEmbeddedTheme(raw) {
  const { magpieTheme, ...fields } = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const read = themeFile.readThemeFile({ ...fields, magpieTheme: 1 }, sanitizeTheme);
  const { dropped, ...theme } = read;
  return { theme, dropped };
}
const bool = (v) => typeof v === 'boolean';
// The settings a template may give (each also the owner's to change afterwards), with what each takes.
const SETTINGS = {
  language: (v) => LANGUAGES.includes(v),
  clock: (v) => v === '12' || v === '24',
  currency: (v) => typeof v === 'string' && CURRENCIES.has(v),
  loginText: (v) => typeof v === 'string' && v.length <= 1000,
  allowRegistration: bool,
  mfaRequired: bool,
  maxQuality: (v) => QUALITY_OPTIONS.includes(v),
  allowScreenShare: bool,
  allowAsides: bool,
  allowPrivate: bool,
  allowReactions: bool,
  activeThemeId: (v) => v === null || BUILTIN_THEME_IDS.includes(v),
  themeMode: (v) => v === 'light' || v === 'dark',
};
const LOBBY_NAME_MAX = 40;
const LOBBY_DESCRIPTION_MAX = 300;

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const drawable = (icon, faDir) => typeof icon === 'string' && /^[a-z0-9-]{1,40}$/.test(icon) && fs.existsSync(path.join(faDir, `${icon}.svg`));

// What is wrong with one template, as sentences ([] when nothing is). `bundled`: the bundled modules' ids.
function problemsOf(raw, { file = null, bundled = [], faDir = FA_FREE_SOLID } = {}) {
  const out = [];
  const say = (text) => out.push(text);
  if (!isObject(raw)) return ['A template must be a JSON object.'];
  for (const key of Object.keys(raw)) if (!FIELDS.includes(key)) say(`"${key}" is not a template field; the fields are ${FIELDS.join(', ')}.`);
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) say('"id" must be lowercase letters, digits and dashes, starting with a letter.');
  else if (file && path.basename(file, '.json') !== raw.id) say(`"id" must match the file's name (${path.basename(file)}).`);
  if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 40) say('"name" must be text of 1 to 40 characters.');
  if (typeof raw.description !== 'string' || !raw.description.trim() || raw.description.length > 200) say('"description" must be text of 1 to 200 characters.');
  const knownModule = (id) => bundled.includes(id) || BUILTIN_MODULE_IDS.includes(id);
  if (raw.version !== undefined && (!Number.isInteger(raw.version) || raw.version < 1)) say('"version" must be a whole number, 1 or more.');
  if (raw.reactions !== undefined) {
    if (!Array.isArray(raw.reactions) || raw.reactions.length > MAX_REACTIONS) say(`"reactions" must be a list of at most ${MAX_REACTIONS} reactions.`);
    else {
      raw.reactions.forEach((r, i) => {
        if (!isObject(r) || typeof r.glyph !== 'string' || !r.glyph.trim() || r.glyph.length > 8) say(`reactions[${i}]: each reaction needs a glyph of 1 to 8 characters.`);
        else if (r.label !== undefined && (typeof r.label !== 'string' || r.label.length > 40)) say(`reactions[${i}]: a label is text of at most 40 characters.`);
        else if (Object.keys(r).some((k) => !['id', 'glyph', 'label'].includes(k))) say(`reactions[${i}]: a reaction takes only id, glyph and label.`);
      });
    }
  }
  if (raw.iconSet !== undefined) {
    if (!Array.isArray(raw.iconSet) || raw.iconSet.length > MAX_ICON_SET) say(`"iconSet" must be a list of at most ${MAX_ICON_SET} icon names.`);
    else {
      const seen = new Set();
      for (const icon of raw.iconSet) {
        if (!drawable(icon, faDir)) say(`iconSet: "${icon}" is not a Font Awesome Free solid icon.`);
        else if (seen.has(icon)) say(`iconSet: "${icon}" is listed twice.`);
        seen.add(icon);
      }
    }
  }
  if (raw.theme !== undefined) {
    try {
      const { dropped } = readEmbeddedTheme(raw.theme);
      if (!isObject(raw.theme)) say('"theme" must be a theme: { name, author?, light, dark }.');
      else if (dropped.length) say(`theme: ${dropped.map((d) => `"${d}"`).join(', ')} ${dropped.length === 1 ? 'is' : 'are'} not part of a theme.`);
    } catch (err) {
      say(`theme: ${err.message}`);
    }
  }

  if (raw.words !== undefined) {
    if (!isObject(raw.words)) say('"words" must be an object of words by name.');
    else {
      for (const [key, value] of Object.entries(raw.words)) {
        if (words.FIXED.includes(key)) say(`words: "${key}" is the host's own word and a template can't change it.`);
        else if (!words.CHANGEABLE.includes(key)) say(`words: there is no word called "${key}"; the words are ${words.CHANGEABLE.join(', ')}.`);
        else {
          const { error } = words.cleanWord(key, value);
          if (error) say(`words: ${error}`);
        }
      }
    }
  }
  if (raw.icons !== undefined) {
    if (!isObject(raw.icons) || Object.keys(raw.icons).some((k) => k !== 'home')) say('"icons" takes only "home".');
    else if (raw.icons.home !== undefined && !drawable(raw.icons.home, faDir)) say(`icons.home: "${raw.icons.home}" is not a Font Awesome Free solid icon.`);
  }
  for (const field of ['moduleNames', 'moduleIcons']) {
    if (raw[field] === undefined) continue;
    if (!isObject(raw[field])) { say(`"${field}" must be an object by module id.`); continue; }
    for (const [id, value] of Object.entries(raw[field])) {
      if (!knownModule(id)) say(`${field}: "${id}" is not a bundled or built-in module.`);
      else if (field === 'moduleNames') {
        const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
        const problem = typeof value !== 'string' || !name ? 'A display name must be text.' : displayNameProblem(name);
        if (problem) say(`moduleNames.${id}: ${problem}`);
      } else if (!drawable(value, faDir)) say(`moduleIcons.${id}: "${value}" is not a Font Awesome Free solid icon.`);
    }
  }
  if (!Array.isArray(raw.modules)) say('"modules" must be a list of module ids.');
  else {
    const seen = new Set();
    for (const id of raw.modules) {
      if (typeof id !== 'string' || !knownModule(id)) say(`modules: "${id}" is not a bundled or built-in module.`);
      else if (seen.has(id)) say(`modules: "${id}" is listed twice.`);
      seen.add(id);
    }
    // Chat has no switch of its own yet (plan-optional-conference), so a template can't leave it out.
    if (!raw.modules.includes('chat')) say('modules: "chat" must be listed; Chat can\'t be switched off yet.');
  }
  if (raw.settings !== undefined) {
    if (!isObject(raw.settings)) say('"settings" must be an object.');
    else {
      for (const [key, value] of Object.entries(raw.settings)) {
        if (!SETTINGS[key]) say(`settings: "${key}" is not a setting a template can give; those are ${Object.keys(SETTINGS).join(', ')}.`);
        else if (!SETTINGS[key](value)) say(`settings: ${JSON.stringify(value)} is not a value "${key}" takes.`);
      }
    }
  }
  if (raw.lobby !== undefined) {
    if (!isObject(raw.lobby) || Object.keys(raw.lobby).some((k) => !['name', 'description'].includes(k))) say('"lobby" takes only "name" and "description".');
    else {
      if (raw.lobby.name !== undefined && (typeof raw.lobby.name !== 'string' || !raw.lobby.name.trim() || raw.lobby.name.length > LOBBY_NAME_MAX)) say(`lobby.name must be text of 1 to ${LOBBY_NAME_MAX} characters.`);
      if (raw.lobby.description !== undefined && (typeof raw.lobby.description !== 'string' || raw.lobby.description.length > LOBBY_DESCRIPTION_MAX)) say(`lobby.description must be text of at most ${LOBBY_DESCRIPTION_MAX} characters.`);
    }
  }
  if (raw.spaceDefaults !== undefined) {
    if (!isObject(raw.spaceDefaults) || Object.keys(raw.spaceDefaults).some((k) => k !== 'profile')) say('"spaceDefaults" takes only "profile".');
    else if (raw.spaceDefaults.profile !== undefined && !SPACE_PROFILES.includes(raw.spaceDefaults.profile)) say(`spaceDefaults.profile must be one of ${SPACE_PROFILES.join(', ')}.`);
  }
  return out;
}

// A valid template as the server keeps it: every field there, words tidied.
function cleanTemplate(raw) {
  const own = {};
  for (const [key, value] of Object.entries(raw.words || {})) own[key] = words.cleanWord(key, value).word;
  return {
    id: raw.id,
    name: raw.name.trim(),
    description: raw.description.trim(),
    words: own,
    icons: { ...(raw.icons?.home ? { home: raw.icons.home } : {}) },
    moduleNames: Object.fromEntries(Object.entries(raw.moduleNames || {}).map(([id, n]) => [id, n.replace(/\s+/g, ' ').trim()])),
    moduleIcons: { ...(raw.moduleIcons || {}) },
    modules: [...raw.modules],
    settings: { ...(raw.settings || {}) },
    lobby: { ...(raw.lobby || {}) },
    spaceDefaults: { ...(raw.spaceDefaults || {}) },
    // Addendum 2: a template's version (a bundled file without one is 1), its reactions and its theme, each applied
    // once (null for none).
    version: Number.isInteger(raw.version) ? raw.version : 1,
    reactions: raw.reactions !== undefined ? cleanReactions(raw.reactions) : null,
    theme: raw.theme !== undefined ? readEmbeddedTheme(raw.theme).theme : null,
    iconSet: Array.isArray(raw.iconSet) ? [...raw.iconSet] : null,
  };
}

// Every template in `dir`, checked. Throws one Error naming each problem (file: sentence) when any is invalid, so a
// server never starts with a template it can't apply.
function loadTemplates({ dir = TEMPLATES_DIR, modulesDir = MODULES_DIR, faDir = FA_FREE_SOLID } = {}) {
  const bundled = bundledModules(modulesDir).map((m) => m.id);
  const found = new Map();
  const problems = [];
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  for (const f of files) {
    const file = path.join(dir, f);
    let raw;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { problems.push(`templates/${f}: not valid JSON (${err.message}).`); continue; }
    const wrong = problemsOf(raw, { file, bundled, faDir });
    if (wrong.length) { for (const p of wrong) problems.push(`templates/${f}: ${p}`); continue; }
    found.set(raw.id, cleanTemplate(raw));
  }
  if (problems.length) throw new Error(`A template is not valid, so the server will not start:\n  ${problems.join('\n  ')}`);
  return found;
}

// The bundled templates, loaded once.
let loaded = null;
const all = () => (loaded ||= loadTemplates());
const get = (id) => all().get(id) || null;
const list = () => [...all().values()].map((t) => ({ id: t.id, name: t.name, description: t.description }));

// The live part of a recorded template (its words, home icon and module names and icons) onto an environment's store.
// Answers the template, or null when the store has none recorded or this build does not have it.
function useLive(store, template) {
  store.templateWords = template ? template.words : null;
  store.templateModuleNames = template ? template.moduleNames : null;
  store.templateModuleIcons = template ? template.moduleIcons : null;
  store.templateHomeIcon = template ? template.icons.home || null : null;
  return template;
}

// The bundled module ids a template's list needs, each after what it requires (Maps after Places), with the modules
// it requires added though the template left them out.
function withRequirements(ids, manifests) {
  const out = [];
  const visit = (id, seen = new Set()) => {
    if (out.includes(id) || seen.has(id) || !manifests.has(id)) return;
    seen.add(id);
    for (const r of manifests.get(id).requires || []) visit(r, seen);
    out.push(id);
  };
  for (const id of ids) visit(id);
  return out;
}

// Adds a template's icons (its home icon and its module icons) to the environment's icon list, so the owner's pickers
// offer them. Never removes one.
function addIcons(store, template, { iconSet = false } = {}) {
  const want = [template.icons.home, ...Object.values(template.moduleIcons), ...(iconSet ? template.iconSet || [] : [])].filter(Boolean);
  const have = store.iconIds();
  const add = [...new Set(want)].filter((id) => !have.includes(id)).map((id) => ({ id, classes: `fa-solid fa-${id}`, label: id.replace(/-/g, ' ') }));
  if (add.length) store.updateSettings({ icons: [...store.settings.icons, ...add] });
}

// Installs (when needed), puts in every space and turns on the bundled modules `ids`, each after what it requires,
// with those added. Answers what was skipped: [{ id, why }]. `allSpaces` means every space the module may be in, so
// a module not made for the Lobby never lands there (plan-modules, "the Lobby is for being together").
async function turnOnModules(env, ids, { allowed = () => true, modulesDir = MODULES_DIR, name = (id) => id } = {}) {
  const { modules } = env;
  const manifests = new Map(bundledModules(modulesDir).map((m) => [m.id, m]));
  const skipped = [];
  const failed = new Set();
  for (const id of withRequirements(ids.filter((m) => !BUILTIN_MODULE_IDS.includes(m)), manifests)) {
    const manifest = manifests.get(id);
    const missing = (manifest.requires || []).find((r) => failed.has(r));
    let why = null;
    // Plan-one-input step 8: the Assistant has no window; new installs leave it out. Chat /ai does not need it.
    if (id === 'assistant') why = 'retired: ask in Chat with /ai';
    else if (!allowed(id)) why = 'not in the plan';
    else if (missing) why = `needs ${name(missing)}, which was skipped`;
    else {
      // In every space first, then on: one that installs but can't be turned on yet (Research, until the AI service is
      // set up) stays in every space, off, and is recorded with why, so turning it on later is all the owner does.
      try {
        if (!modules.isInstalled(id)) {
          const { zip } = buildModule(path.join(modulesDir, id));
          await modules.install(zip, { source: 'bundled' });
        }
        modules.update(id, { allSpaces: true });
        modules.update(id, { enabled: true });
      } catch (err) {
        why = err.message;
      }
    }
    if (why) { failed.add(id); skipped.push({ id, why }); }
  }
  return skipped;
}

// Applies a template's once-only part to an environment made from it (settings, the Lobby, the space defaults, its
// icons into the icon list, then its modules), and answers what was skipped: [{ id, why }]. Safe to run again (the
// same result), but the server runs it only while the record has no appliedAt. `allowed(id)`: whether the billing plan
// includes a bundled module (a template never widens a plan); `modulesDir` where the bundled modules are.
async function applyTemplate(env, template, { allowed = () => true, modulesDir = MODULES_DIR, name = (id) => id } = {}) {
  const { store } = env;
  if (Object.keys(template.settings).length) store.updateSettings(template.settings);
  if (template.lobby.name !== undefined || template.lobby.description !== undefined) store.updateSpace(LOBBY, template.lobby);
  if (template.spaceDefaults.profile) store.updateSettings({ spaceDefaults: { profile: template.spaceDefaults.profile } });
  // The home icon itself stays the template's (settings.homeIcon unset) until the owner picks one.
  addIcons(store, template, { iconSet: true });
  if (template.icons.home) store.updateSettings({ homeIcon: null });
  store.updateSettings({ conferenceEnabled: template.modules.includes('conference') });
  if (template.reactions) store.updateSettings({ reactions: template.reactions });
  if (template.theme) useTheme(store, template);
  return turnOnModules(env, template.modules, { allowed, modulesDir, name });
}

// A template's theme, added as a new theme ("Name (2)" on a clash, never overwriting) and made active; one with the
// very same colors already there is made active instead of added again.
function useTheme(store, template) {
  const same = sameTheme(store, template.theme);
  const theme = same || store.importTheme(template.theme);
  store.updateSettings({ activeThemeId: theme.id });
}
const setsOf = (t) => JSON.stringify([t.light || null, t.dark || null]);
const sameTheme = (store, theme) => store.themes.find((t) => setsOf(store.sanitizeTheme(t) || {}) === setsOf(theme)) || null;

// --- switching (the switching addendum, GitHub #59) ------------------------------------------------------------------
// A switch changes only the live part at once (the store's useLive, and the template's icons into the icon list); its
// once-only part is offered, and applied only as confirmed. A switch never turns anything off, never clears the owner's
// home icon, never touches the environment's settings (decision 1 at approval) or any module's data.

// What a switch to `template` would add, for the person switching to confirm:
//   modules: each module it lists (with what it requires) not already on in every space it may be in, with whether
//            the plan allows it ({ id, name, allowed, why? }); the conference when listed and off
//   lobby: the template's Lobby name and description when they differ from the Lobby's own, else null
//   spaceDefaults: the template's new-space profile when it differs from the environment's, else null
function offerFor(env, template, { allowed = () => true, modulesDir = MODULES_DIR, name = (id) => id, applied = null } = {}) {
  const { store, modules } = env;
  // With fingerprints from the last time this template's once-only part was applied or passed over, a part is offered
  // only when the template changed it since; without them (a switch, or a record from before), by the environment as
  // it is now.
  const prints = partFingerprints(template);
  const changed = (part) => !applied || applied[part] !== prints[part];
  const manifests = new Map(bundledModules(modulesDir).map((m) => [m.id, m]));
  const offered = [];
  if (changed('modules')) for (const id of withRequirements(template.modules.filter((m) => !BUILTIN_MODULE_IDS.includes(m)), manifests)) {
    const view = modules.isInstalled(id) ? modules.view(id) : null;
    if (view && view.enabled && view.allSpaces) continue; // on in every space it may be in already
    const ok = Boolean(allowed(id));
    offered.push({ id, name: name(id), allowed: ok, ...(ok ? {} : { why: 'not in the plan' }) });
  }
  if (changed('modules') && template.modules.includes('conference') && store.settings.conferenceEnabled === false) offered.push({ id: 'conference', name: name('conference'), allowed: true });
  const lobby = store.spaceById(LOBBY);
  const lobbyDiffers = (template.lobby.name !== undefined && template.lobby.name !== lobby?.name) || (template.lobby.description !== undefined && template.lobby.description !== lobby?.description);
  const profile = template.spaceDefaults.profile;
  const missingIcons = changed('iconSet') ? (template.iconSet || []).filter((id) => !store.iconIds().includes(id)) : [];
  const reactionsDiffer = changed('reactions') && template.reactions && JSON.stringify(template.reactions) !== JSON.stringify(store.settings.reactions || []);
  const theme = changed('theme') ? template.theme || null : null;
  return {
    iconSet: missingIcons.length ? missingIcons : null,
    reactions: reactionsDiffer ? template.reactions : null,
    theme: theme && !(sameTheme(store, theme) && store.settings.activeThemeId === sameTheme(store, theme).id) ? { name: theme.name, ...(theme.author ? { author: theme.author } : {}) } : null,
    modules: offered,
    lobby: changed('lobby') && lobbyDiffers ? { name: template.lobby.name ?? lobby?.name ?? '', description: template.lobby.description ?? lobby?.description ?? '' } : null,
    spaceDefaults: changed('spaceDefaults') && profile && profile !== store.settings.spaceDefaults?.profile ? { profile } : null,
  };
}

// Applies what was confirmed of the offer: `modules` (ids from the offer; anything else is ignored), `lobby` and
// `spaceDefaults` (true to take the template's). Answers what was skipped: every offered module the plan leaves out,
// and any confirmed one that could not be turned on, with why. Turns nothing off.
async function applyOffer(env, template, { modules: ids = [], lobby = false, spaceDefaults = false, reactions = false, theme = false, iconSet = false } = {}, opts = {}) {
  const { store } = env;
  const offer = offerFor(env, template, opts);
  const offeredIds = new Set(offer.modules.map((m) => m.id));
  const chosen = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string' && offeredIds.has(id)))];
  if (lobby === true && offer.lobby) store.updateSpace(LOBBY, offer.lobby);
  if (spaceDefaults === true && offer.spaceDefaults) store.updateSettings({ spaceDefaults: offer.spaceDefaults });
  if (reactions === true && offer.reactions) store.updateSettings({ reactions: offer.reactions });
  if (theme === true && offer.theme) useTheme(store, template);
  if (iconSet === true && offer.iconSet) addIcons(store, template, { iconSet: true });
  if (chosen.includes('conference')) store.updateSettings({ conferenceEnabled: true }); // offered only while off; never turned off
  const skipped = offer.modules.filter((m) => !m.allowed).map((m) => ({ id: m.id, why: m.why }));
  const allowedChosen = chosen.filter((id) => !BUILTIN_MODULE_IDS.includes(id) && offer.modules.find((m) => m.id === id).allowed);
  for (const miss of await turnOnModules(env, allowedChosen, opts)) if (!skipped.some((x) => x.id === miss.id)) skipped.push(miss);
  return skipped;
}

module.exports = { PARTS, partFingerprints, appliedPartsChanged, appliedOnceFingerprint, loadTemplates, problemsOf, cleanTemplate, get, list, all, useLive, applyTemplate, withRequirements, addIcons, turnOnModules, offerFor, applyOffer, readEmbeddedTheme, FIELDS, BUILTIN_MODULE_IDS, SETTINGS, TEMPLATES_DIR };
