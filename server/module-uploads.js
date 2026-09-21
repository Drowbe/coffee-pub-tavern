// A place for the files a module's people upload (photos to begin with), per scope like the module's data: the whole server, one
// room, or one person. A module opts in by declaring `uploads` in its manifest (which types, how big, how many). What is kept is
// checked and cleaned first (see image-clean.js), and a file goes when its owner removes it.
//
// Files live under DATA_DIR/modules/<id>/uploads/<scope>/: <file id>.bin, an optional <file id>.thumb (made by the page and checked
// the same way), and <file id>.json with the facts about it. Nothing about a file is in the module's data until the module puts it
// there, and the module removes the file when it removes its item.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { cleanImage } = require('./image-clean');
const { StoreError } = require('./store');

const ID_RE = /^[a-f0-9]{24}$/;
const ROOM_RE = /^[a-z0-9]{4,16}$/;
const PERSON_RE = /^[a-z0-9]{4,40}$/;
const MAX_THUMB = 400 * 1024;
const oneLine = (s, n) => String(s == null ? '' : s).replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

class ModuleUploads {
  constructor(modulesDir) {
    this.dir = modulesDir;
  }

  scopeDir(id, scopeKey) {
    const base = path.join(this.dir, id, 'uploads');
    if (scopeKey === 'server') return path.join(base, 'server');
    const r = /^room:(.+)$/.exec(scopeKey);
    if (r && ROOM_RE.test(r[1])) return path.join(base, `room-${r[1]}`);
    const p = /^person:(.+)$/.exec(scopeKey);
    if (p && PERSON_RE.test(p[1])) return path.join(base, `person-${p[1]}`);
    throw new StoreError('bad scope');
  }

  meta(id, scopeKey, fid) {
    if (!ID_RE.test(fid)) return null;
    try {
      return JSON.parse(fs.readFileSync(path.join(this.scopeDir(id, scopeKey), `${fid}.json`), 'utf8'));
    } catch {
      return null;
    }
  }

  list(id, scopeKey) {
    let names;
    try {
      names = fs.readdirSync(this.scopeDir(id, scopeKey));
    } catch {
      return [];
    }
    return names.filter((n) => n.endsWith('.json')).map((n) => this.meta(id, scopeKey, n.slice(0, -5))).filter(Boolean).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }

  // Keep an upload. `rule` is the manifest's `uploads` ({ types, maxBytes, maxFiles }). Returns the file's facts; throws a
  // StoreError with a plain message for anything not accepted.
  put(id, scopeKey, rule, { bytes, name, by, keepPosition }) {
    if (!bytes || !bytes.length) throw new StoreError('there is no file in that');
    if (bytes.length > rule.maxBytes) throw new StoreError(`that file is over the limit of ${Math.round(rule.maxBytes / 1048576)} MB`);
    const dir = this.scopeDir(id, scopeKey);
    if (this.list(id, scopeKey).length >= rule.maxFiles) throw new StoreError(`this place already keeps ${rule.maxFiles} files; remove some first`);
    let clean;
    try {
      clean = cleanImage(bytes, rule.types, !!keepPosition);
    } catch (err) {
      throw new StoreError(err.message);
    }
    const fid = crypto.randomBytes(12).toString('hex');
    const facts = { id: fid, name: oneLine(name, 100), type: clean.type, size: clean.bytes.length, by, at: new Date().toISOString(), taken: clean.taken, camera: clean.camera, hasPosition: clean.hasPosition, position: clean.position, thumb: false };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${fid}.bin`), clean.bytes);
    fs.writeFileSync(path.join(dir, `${fid}.json`), JSON.stringify(facts));
    return facts;
  }

  // The thumbnail the page made for a file it uploaded: cleaned the same way, and small.
  putThumb(id, scopeKey, rule, fid, bytes) {
    const m = this.meta(id, scopeKey, fid);
    if (!m) throw new StoreError('no such file');
    if (!bytes || !bytes.length || bytes.length > MAX_THUMB) throw new StoreError('that thumbnail is too big');
    let clean;
    try {
      clean = cleanImage(bytes, rule.types, false);
    } catch (err) {
      throw new StoreError(err.message);
    }
    const dir = this.scopeDir(id, scopeKey);
    fs.writeFileSync(path.join(dir, `${fid}.thumb`), clean.bytes);
    m.thumb = true;
    m.thumbType = clean.type;
    fs.writeFileSync(path.join(dir, `${fid}.json`), JSON.stringify(m));
    return m;
  }

  // The bytes and type of a file (or its thumbnail), or null.
  read(id, scopeKey, fid, thumb) {
    const m = this.meta(id, scopeKey, fid);
    if (!m || (thumb && !m.thumb)) return null;
    try {
      return { bytes: fs.readFileSync(path.join(this.scopeDir(id, scopeKey), `${fid}.${thumb ? 'thumb' : 'bin'}`)), type: thumb ? m.thumbType || m.type : m.type, meta: m };
    } catch {
      return null;
    }
  }

  remove(id, scopeKey, fid) {
    const m = this.meta(id, scopeKey, fid);
    if (!m) return false;
    const dir = this.scopeDir(id, scopeKey);
    for (const ext of ['bin', 'thumb', 'json']) fs.rmSync(path.join(dir, `${fid}.${ext}`), { force: true });
    return true;
  }

  // What a module's uploads take, for the admin: { files, bytes }.
  usage(id) {
    let files = 0;
    let bytes = 0;
    const base = path.join(this.dir, id, 'uploads');
    let scopes = [];
    try { scopes = fs.readdirSync(base); } catch { /* none */ }
    for (const s of scopes) {
      for (const n of fs.readdirSync(path.join(base, s))) {
        if (n.endsWith('.json')) files += 1;
        if (n.endsWith('.bin') || n.endsWith('.thumb')) bytes += fs.statSync(path.join(base, s, n)).size;
      }
    }
    return { files, bytes };
  }
}

module.exports = { ModuleUploads, UPLOAD_LIMITS: { maxBytes: 10 * 1024 * 1024, maxFiles: 5000 } };
