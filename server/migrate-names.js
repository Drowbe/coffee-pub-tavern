// The Names migration's frame (documentation/plans/plan-names.md, "The migration"): renames stored keys, files and
// folders from the old words (room, tenant, table, ...) to the environment's, space's and the rest's own names, one
// recorded part per step of that plan. This file is the frame only: the version, the record of parts, the copy
// into pre-names/ and the refusal of a newer backup. The parts themselves land with the steps that need them
// (names-environment for the host; names-table, names-roles, names-spaces, names-objects, names-asides for an
// environment) and are added to HOST_PARTS and ENVIRONMENT_PARTS below, in the order they run.
//
// An environment's record lives in its own app.json: `version` goes from 1 to NAMES_VERSION with the first part
// that runs, and `migrations: [{ id, at, moved }]` gains one entry per part. The host's lives in host.json the
// same way (`migrations` only: host.json has never had a version). A recorded part never runs again.
//
// Before a part writes anything, every JSON file it will rewrite (and the record file itself) is copied into
// <environment>/pre-names/<part>/ (the host's into DATA_DIR/pre-names-host/<part>/, so that a single-environment
// install's own pre-names/ and the host's never share a folder when the pre-environment move carries DATA_DIR's
// contents into an environment's folder), keeping their paths. Folders a part only moves are listed in `moved`.
// A part stages its writes and moves; nothing is committed until the whole part has run without an error and every
// write and move has been checked, and any error stops the start with the file named.
//
// A record naming a part this server does not know is from a newer Magpie: the start (or, for an environment built
// later, that environment) is refused with the file and the part named, the same way a restore refuses such a
// backup (backupRefusal below).
//
// A part is { id, files(dir) -> [relative paths of the JSON files it will rewrite], run(ctx) -> nothing }.
// ctx: { dir, read(rel) (parsed JSON, or undefined when the file is not there), write(rel, value), move(fromRel,
// toRel) }. write only takes a path files() listed (or the record file), since only those were copied first. write
// and move are staged and applied after run returns. A part must be idempotent by shape: run over data it has
// already changed, it changes nothing.
'use strict';

const fs = require('fs');
const path = require('path');

const NAMES_VERSION = 2; // app.json's version once the first names part has run
const ENVIRONMENT_RECORD = 'app.json';
const LEGACY_ENVIRONMENT_RECORD = 'tavern.json'; // Store renames this to app.json; a part runs against the new name
const HOST_RECORD = 'host.json';
const ENVIRONMENT_COPY_DIR = 'pre-names';
const HOST_COPY_DIR = 'pre-names-host';

// Every part this server knows, in the order they run. Empty until step 2 of the plan adds the first.
const HOST_PARTS = [];
const ENVIRONMENT_PARTS = [];

// `reason` is 'newer' (the data records a part this server does not know) or 'failed' (a part could not finish).
class MigrationError extends Error {
  constructor(message, file, reason = 'failed') {
    super(message);
    this.name = 'MigrationError';
    this.file = file || null;
    this.reason = reason;
  }
}

// What a person asking for a refused environment is told (plan-names.md, "The migration"); the file and the detail
// go to the log and the host console only.
const REFUSED_NEWER = "This environment's data is from a newer version of Magpie.";
const REFUSED_FAILED = "This environment's data could not be updated. The host admin has been told.";
const refusalSentence = (err) => (err && err.reason === 'newer' ? REFUSED_NEWER : REFUSED_FAILED);

// Any error on the way through a migration, as a MigrationError naming a file: an environment with a permissions
// problem is refused like any other, never an uncaught crash.
function asMigrationError(err, file, what) {
  if (err instanceof MigrationError) return err;
  return new MigrationError(`${what || 'The names migration stopped'} at ${file}: ${err && err.message ? err.message : err}`, file);
}

function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return undefined;
    throw new MigrationError(`Could not read ${file}: ${err.message}`, file);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new MigrationError(`Could not read ${file}: it is not valid JSON (${err.message}).`, file);
  }
}

// The same, but an unreadable file is simply not a record (answers null), for the newer-data check that runs even
// when no part is due: Store has always read a broken app.json as empty, and that stays its business.
function readRecordLeniently(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;

// A path a part named, as one spelling ("./a//b.json" and "a/b.json" are the same file), kept inside `dir`.
function normalRel(rel) {
  return path.posix.normalize(String(rel).replace(/\\/g, '/')).replace(/^(\.\/)+/, '');
}
function inside(dir, rel) {
  const full = path.resolve(dir, normalRel(rel));
  if (full === dir || !full.startsWith(dir + path.sep)) throw new MigrationError(`A names migration part named a path outside ${dir}: ${rel}`, full);
  return full;
}

// The ids a record (a parsed app.json or host.json) says have run.
function recordedParts(record) {
  if (!record || !Array.isArray(record.migrations)) return [];
  return record.migrations.map((m) => (m && typeof m.id === 'string' ? m.id : null)).filter(Boolean);
}

// The parts a record says have run that this server does not know: a record from a newer Magpie.
function unknownParts(record, parts = ENVIRONMENT_PARTS) {
  const known = new Set(parts.map((p) => p.id));
  return recordedParts(record).filter((id) => !known.has(id));
}

const NEWER_BACKUP = 'This backup is from a newer version of Magpie.';

// A restore's check, over a backup's entries ([[name, Buffer]], in zip order): the files that would actually land
// (a later entry of the same name overwrites an earlier one, and "./app.json" is app.json), app.json and the older
// tavern.json both, since Store reads the latter when the former is missing. Answers the refusal sentence, or null.
function backupRefusal(entries, parts = ENVIRONMENT_PARTS) {
  const landing = new Map();
  for (const [name, data] of entries) landing.set(normalRel(String(name).replace(/^\/+/, '')), data);
  for (const name of [ENVIRONMENT_RECORD, LEGACY_ENVIRONMENT_RECORD]) {
    if (!landing.has(name)) continue;
    let record = null;
    try { record = JSON.parse(Buffer.from(landing.get(name)).toString('utf8')); } catch { record = null; }
    if (unknownParts(record, parts).length) return NEWER_BACKUP;
  }
  return null;
}

function refuseNewer(file, record, parts) {
  const unknown = unknownParts(record, parts);
  if (!unknown.length) return;
  throw new MigrationError(`${file} records the migration part "${unknown[0]}", which this version of Magpie does not know: this data is from a newer version of Magpie, so it will not be opened here.`, file, 'newer');
}

// Runs every part `parts` lists that `dir`'s record does not, in order, and records each. Answers the ids it ran.
// `copyDir` is where the originals go (under `dir`), `versioned` whether the record carries app.json's version.
function runParts(dir, { parts, recordName, copyDir, versioned, log }) {
  dir = path.resolve(dir);
  const recordFile = path.join(dir, recordName);
  // Data from a newer Magpie is refused whether or not any part is due here.
  refuseNewer(recordFile, readRecordLeniently(recordFile), parts);
  // No parts due: nothing further is read or written.
  if (!parts.length) return [];
  const record = readJson(recordFile);
  const done = new Set(recordedParts(record));
  const pending = parts.filter((p) => !done.has(p.id));
  if (!pending.length) return [];

  // A directory with no record yet is new: there is no old-format data in it to move, and whatever builds it
  // next (Store, HostRegistry) writes the current shape. The parts are recorded as run, moving nothing, so they
  // never run over data that was never old.
  if (record === undefined) {
    const fresh = { ...(versioned ? { version: NAMES_VERSION } : {}), migrations: pending.map((p) => ({ id: p.id, at: new Date().toISOString(), moved: [] })) };
    commit(dir, new Map([[recordName, fresh]]), []);
    return pending.map((p) => p.id);
  }

  const ran = [];
  for (const part of pending) {
    // What the part will rewrite, plus the record itself (the record entry below rewrites it).
    let files;
    try {
      files = [...new Set([recordName, ...(part.files(dir) || [])].map(normalRel))];
    } catch (err) {
      throw new MigrationError(`The names migration part "${part.id}" could not list its files in ${dir}: ${err.message}`, err.file || dir);
    }
    const listed = new Set(files);

    // The copy, before anything is written. A copy already there is the original from an earlier attempt that
    // stopped part-way, and is kept rather than overwritten with what that attempt left behind.
    const copyRoot = path.join(dir, copyDir, part.id);
    for (const rel of files) {
      const from = inside(dir, rel);
      const to = inside(copyRoot, rel);
      if (!fs.existsSync(from) || fs.existsSync(to)) continue;
      try {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
      } catch (err) {
        throw new MigrationError(`Could not copy ${from} to ${to} before migrating it: ${err.message}`, from);
      }
    }

    // The part runs against staged writes and moves; nothing on disk changes until it has finished.
    const writes = new Map();
    const moves = [];
    const ctx = {
      dir,
      read: (rel) => {
        const key = normalRel(rel);
        return writes.has(key) ? structuredClone(writes.get(key)) : readJson(inside(dir, key));
      },
      write: (rel, value) => {
        const key = normalRel(rel);
        const file = inside(dir, key);
        if (!listed.has(key)) throw new MigrationError(`it wrote ${key}, which its files() did not list, so no copy of it was kept first`, file);
        writes.set(key, value);
      },
      move: (fromRel, toRel) => { inside(dir, fromRel); inside(dir, toRel); moves.push([normalRel(fromRel), normalRel(toRel)]); },
    };
    try {
      part.run(ctx);
    } catch (err) {
      const file = err.file || recordFile;
      throw new MigrationError(`The names migration part "${part.id}" stopped at ${file}: ${err.message}`, file);
    }

    // The record entry rides with the part's own writes, written last.
    const moved = moves.filter(([fromRel]) => fs.existsSync(inside(dir, fromRel))).map(([from, to]) => ({ from, to }));
    const current = writes.has(recordName) ? writes.get(recordName) : (readJson(recordFile) || {});
    const next = { ...current };
    if (versioned) next.version = NAMES_VERSION;
    next.migrations = [...(Array.isArray(current.migrations) ? current.migrations : []), { id: part.id, at: new Date().toISOString(), moved }];
    writes.delete(recordName);
    writes.set(recordName, next);
    try {
      commit(dir, writes, moves);
    } catch (err) {
      if (err instanceof MigrationError) throw new MigrationError(`The names migration part "${part.id}" was not applied: ${err.message}`, err.file);
      throw err;
    }
    log(`Names migration: ran "${part.id}" in ${dir}${moved.length ? ` (moved ${moved.length})` : ''}; originals in ${copyRoot}.`);
    ran.push(part.id);
  }
  return ran;
}

// Applies one part's staged writes and moves. Everything is checked first (each value serialises, no write lands
// on a folder, each move's target is free and no two moves share one), then every write goes to a temporary file
// beside its target; only when all of that has succeeded does anything live change: the writes are renamed into
// place, then the folders move. A move whose source is already gone is skipped (it ran before). The last write
// in `writes` is renamed last (the record, when a part commits).
function commit(dir, writes, moves) {
  const texts = [];
  for (const [rel, value] of writes) {
    const file = inside(dir, rel);
    let text;
    try { text = serialize(value); } catch (err) { throw new MigrationError(`Could not write ${file}: ${err.message}`, file); }
    if (typeof value === 'undefined') throw new MigrationError(`Could not write ${file}: there is nothing to write.`, file);
    if (fs.existsSync(file) && !fs.statSync(file).isFile()) throw new MigrationError(`Could not write ${file}: a folder is there.`, file);
    texts.push([file, text]);
  }
  const targets = new Set();
  const due = [];
  for (const [fromRel, toRel] of moves) {
    const from = inside(dir, fromRel);
    const to = inside(dir, toRel);
    if (!fs.existsSync(from)) continue;
    if (fs.existsSync(to) || targets.has(to)) throw new MigrationError(`Could not move ${from} to ${to}: ${to} is already there.`, to);
    targets.add(to);
    due.push([from, to]);
  }
  // Staged: every write to a temporary file beside its target. A failure here removes them and changes nothing.
  const temps = [];
  const dropTemps = () => { for (const file of temps) { try { fs.rmSync(`${file}.names-tmp`, { force: true }); } catch { /* best effort */ } } };
  try {
    for (const [file, text] of texts) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      temps.push(file);
      fs.writeFileSync(`${file}.names-tmp`, text);
    }
  } catch (err) {
    const file = temps[temps.length - 1] || dir;
    dropTemps();
    throw new MigrationError(`Could not write ${file}: ${err.message}`, file);
  }
  // The folders move first, so a move that fails (a read-only parent, say) has changed no live JSON: the moves
  // already made are put back, the staged files removed, and the error names the folder.
  const done = [];
  for (const [from, to] of due) {
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from, to);
      done.push([from, to]);
    } catch (err) {
      for (const [a, b] of done.reverse()) { try { fs.renameSync(b, a); } catch { /* listed in the error below */ } }
      dropTemps();
      throw new MigrationError(`Could not move ${from} to ${to}: ${err.message}. Nothing was changed.`, from);
    }
  }
  // Then the writes are renamed into place, the record last. A failure this late leaves the originals in
  // pre-names/ and no record, so the part runs again on the next start.
  const order = temps; // in staging order; runParts stages the record as the last write
  for (let k = 0; k < order.length; k += 1) {
    const file = order[k];
    try {
      fs.renameSync(`${file}.names-tmp`, file);
    } catch (err) {
      for (const rest of order.slice(k)) { try { fs.rmSync(`${rest}.names-tmp`, { force: true }); } catch { /* best effort */ } }
      throw new MigrationError(`Could not write ${file}: ${err.message}. The originals are in the pre-names folder.`, file);
    }
  }
}

// One environment's directory, before Store reads app.json (buildEnvironment calls this first). Throws a
// MigrationError naming the file when a part cannot finish, or when the data is from a newer Magpie.
function migrateEnvironment(dir, options = {}) {
  try {
    return migrateEnvironmentUnwrapped(dir, options);
  } catch (err) {
    throw asMigrationError(err, dir);
  }
}
function migrateEnvironmentUnwrapped(dir, { parts = ENVIRONMENT_PARTS, log = console.log } = {}) {
  const recordFile = path.join(dir, ENVIRONMENT_RECORD);
  const legacyFile = path.join(dir, LEGACY_ENVIRONMENT_RECORD);
  // An install not started since app.json was called tavern.json keeps its record there until Store renames it.
  if (!fs.existsSync(recordFile)) refuseNewer(legacyFile, readRecordLeniently(legacyFile), parts);
  // Store's own older rename (tavern.json -> app.json) is done here first when a part is about to run, so the
  // part and its record see the file by its current name.
  if (parts.length && !fs.existsSync(recordFile) && fs.existsSync(legacyFile)) {
    try {
      fs.renameSync(legacyFile, recordFile);
    } catch (err) {
      throw new MigrationError(`Could not rename ${legacyFile} to ${recordFile} before migrating it: ${err.message}`, legacyFile);
    }
  }
  return runParts(dir, { parts, recordName: ENVIRONMENT_RECORD, copyDir: ENVIRONMENT_COPY_DIR, versioned: true, log });
}

// The host's own part, once at startup before any environment is built, and only on a hosted server (a
// single-environment install has no host.json and never gets one).
function migrateHost(dataDir, { parts = HOST_PARTS, log = console.log } = {}) {
  try {
    return runParts(dataDir, { parts, recordName: HOST_RECORD, copyDir: HOST_COPY_DIR, versioned: false, log });
  } catch (err) {
    throw asMigrationError(err, dataDir);
  }
}

// What a start does with an environment whose data was refused (a MigrationError from buildEnvironment): a
// single-environment install stops (there is nothing else to run); on a hosted server that one environment is
// skipped, logged with its file, and answers 503 when asked for (it is built again on each request, so a restore
// of a good backup brings it back), while every other environment and the console keep running. Answers true when
// the start goes on.
function refusedAtStartup(err, { hosted, log = console.error, stop = (code) => process.exit(code) } = {}) {
  if (!(err instanceof MigrationError)) throw err;
  if (!hosted) {
    log(err.message);
    stop(1);
    return false;
  }
  log(`${err.message} This environment is skipped and answers 503 until its data is restored or fixed; the others run as usual.`);
  return true;
}

module.exports = {
  NAMES_VERSION, HOST_PARTS, ENVIRONMENT_PARTS, ENVIRONMENT_COPY_DIR, HOST_COPY_DIR, NEWER_BACKUP,
  MigrationError, migrateEnvironment, migrateHost, recordedParts, unknownParts, backupRefusal, refusedAtStartup,
  REFUSED_NEWER, REFUSED_FAILED, refusalSentence, asMigrationError,
};
