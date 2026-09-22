// Cutting a region out of a large PMTiles file: a background job around the `pmtiles` CLI (vendored into the Docker image
// at build time; see documentation/plans/plan-map-region-download.md). A module opts in by declaring `regionSource` in its
// manifest: which of its file folders a cut lands in, and which url setting names where to cut from. `pmtiles` reads its
// source over HTTP range requests, so cutting a country from a 100+ GB world file only ever transfers that country's own
// tiles, never the whole file. Only ever writes into a module's own file folder; nothing else on the server is touched.
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const MAX_BYTES = 3 * 1024 * 1024 * 1024; // a sane top end: refuse a cut estimated bigger than this
const MAX_ZOOM = 15; // the public world builds stop at 15; nothing to gain asking for more
const JOB_TIMEOUT_MS = 20 * 60 * 1000;
const ESTIMATE_TIMEOUT_MS = 60 * 1000;
const KEEP_DONE_MS = 10 * 60 * 1000; // how long a finished job's state stays around for a late-arriving stream to read
const FILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.pmtiles$/;

const oneLine = (s, n) => String(s == null ? '' : s).replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

class RegionCutError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// A geographic box, checked; the CLI's own --bbox order (min lon, min lat, max lon, max lat).
function validBox(b) {
  if (!b || typeof b !== 'object') return false;
  const { minLon, minLat, maxLon, maxLat } = b;
  return [minLon, minLat, maxLon, maxLat].every((n) => typeof n === 'number' && Number.isFinite(n))
    && minLon >= -180 && maxLon <= 180 && minLat >= -90 && maxLat <= 90 && minLon < maxLon && minLat < maxLat;
}
const bboxArg = (b) => `--bbox=${[b.minLon, b.minLat, b.maxLon, b.maxLat].map((n) => Math.round(n * 1e6) / 1e6).join(',')}`;

// The source address: https only, no embedded credentials (the same rule every other url setting in Tavern holds to).
function validSource(url) {
  try {
    const u = new URL(String(url || ''));
    return /^https?:$/.test(u.protocol) && !u.username && !u.password;
  } catch {
    return false;
  }
}

function humanSize(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} kB`;
  return `${Math.round(bytes)} B`;
}

// What `pmtiles extract` printed, read for the tile count and the estimated archive size ("Region tiles 13, result tile
// entries 13" and "... for an archive size of 844 kB"); { tiles: 0, bytes: 0 } if the run finished but said nothing usable.
const SIZE_UNIT = { B: 1, kB: 1000, KB: 1000, MB: 1e6, GB: 1e9 };
function parseSize(text) {
  const tilesM = /Region tiles (\d+)/.exec(text);
  const sizeM = /archive size of ([\d.]+)\s*([kKMG]?B)/.exec(text);
  return {
    tiles: tilesM ? Number(tilesM[1]) : 0,
    bytes: sizeM ? Math.round(Number(sizeM[1]) * (SIZE_UNIT[sizeM[2]] || 1)) : 0,
  };
}

// A plain reason for an admin from the CLI's own output, without dumping a stack of Go log lines at them.
function reason(output) {
  const text = String(output || '');
  if (/no such host|dial tcp|connection refused|context deadline exceeded|i\/o timeout/i.test(text)) return 'the world file address could not be reached';
  if (/\b404\b|NoSuchKey|not found/i.test(text)) return 'the world file address answered "not found"; check it in Module Configuration';
  if (/Region tiles 0\b/.test(text)) return 'that area has no tiles at this zoom (it may be over open water, or the area may be wrong)';
  const lines = text.trim().split('\n').filter(Boolean);
  return lines.length ? oneLine(lines[lines.length - 1].replace(/^\S+ \S+ \S+:\d+:\s*/, ''), 200) : 'the cut failed for an unknown reason';
}

class RegionCutJobs extends EventEmitter {
  // `dataDir`: DATA_DIR, so a cut lands in DATA_DIR/modules/<module id>/<folder>/, the same place the admin's own file
  // uploads live. `bin`: the pmtiles executable to run (its own PATH entry by default; a check overrides this to run the
  // parsing against fixed sample output instead of a real binary).
  constructor(dataDir, bin = 'pmtiles') {
    super();
    this.setMaxListeners(0);
    this.dir = dataDir;
    this.bin = bin;
    this.jobs = new Map(); // id -> job
  }

  // The job already running for this module and scope, if any: only one at a time, so a second request never races the
  // first over the same destination, or doubles up on the source's bandwidth.
  runningFor(moduleId, scopeKey) {
    for (const j of this.jobs.values()) if (j.moduleId === moduleId && j.scopeKey === scopeKey && j.status === 'running') return j;
    return null;
  }

  view(id) {
    const j = this.jobs.get(id);
    if (!j) return null;
    return { id: j.id, status: j.status, percent: j.percent, message: j.message, error: j.error, name: j.name };
  }

  sweep() {
    const now = Date.now();
    for (const [id, j] of this.jobs) if (j.status !== 'running' && now - j.endedAt > KEEP_DONE_MS) this.jobs.delete(id);
  }

  // Run the CLI and collect its output (its log lines and progress bar are both on stdout, not stderr, once it is not
  // talking to a real terminal; stderr is combined in too, in case a future version or a real failure uses it).
  // `onProgress` gets each "fetching chunks NN%" update as it streams in.
  run(args, { timeoutMs, onProgress } = {}) {
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(this.bin, args);
      } catch (err) {
        return resolve({ code: -1, output: err.message });
      }
      let output = '';
      const timer = timeoutMs ? setTimeout(() => child.kill('SIGKILL'), timeoutMs) : null;
      const onData = (d) => {
        output += d;
        if (output.length > 20000) output = output.slice(-20000);
        if (!onProgress) return;
        // Several updates (it overwrites its own line with \r) can arrive in one chunk; only the newest matters.
        const all = [...String(d).matchAll(/fetching chunks\s+(\d+)%\s*\|[^|]*\|\s*\(([^)]+)\)/g)];
        const m = all[all.length - 1];
        if (m) onProgress({ percent: Number(m[1]), detail: m[2] });
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', (err) => { if (timer) clearTimeout(timer); resolve({ code: -1, output: `${output}\n${err.message}` }); });
      child.on('close', (code) => { if (timer) clearTimeout(timer); resolve({ code, output }); });
    });
  }

  // How big a cut would be, without downloading it: a dry run against the real source. Throws for a bad box, an
  // unreachable source, or one that plainly would not fit under the size ceiling.
  async estimate({ source, box, maxZoom }) {
    if (!validSource(source)) throw new RegionCutError("the world file address is not set up right; an admin needs to fix it in Module Configuration");
    if (!validBox(box)) throw new RegionCutError('that is not a sensible area');
    if (!Number.isInteger(maxZoom) || maxZoom < 0 || maxZoom > MAX_ZOOM) throw new RegionCutError(`the zoom must be 0 to ${MAX_ZOOM}`);
    const tmp = path.join(os.tmpdir(), `tavern-region-estimate-${crypto.randomBytes(6).toString('hex')}.pmtiles`);
    const { code, output } = await this.run(['extract', source, tmp, bboxArg(box), `--maxzoom=${maxZoom}`, '--dry-run'], { timeoutMs: ESTIMATE_TIMEOUT_MS });
    fs.rmSync(tmp, { force: true });
    if (code !== 0) throw new RegionCutError(reason(output));
    const est = parseSize(output);
    if (est.bytes > MAX_BYTES) throw new RegionCutError(`that area is too large to cut here (about ${humanSize(est.bytes)}; the limit is ${humanSize(MAX_BYTES)}). Choose a smaller area or a lower zoom.`);
    return est;
  }

  // Start the real cut. Returns the job id at once; the job itself runs in the background (see runJob) and is followed
  // over `progress`/`done`/`error` events, or a fresh view(id) for whoever asks late.
  async start({ moduleId, scopeKey, source, folder, name, box, minZoom, maxZoom, by }) {
    this.sweep();
    if (this.runningFor(moduleId, scopeKey)) throw new RegionCutError('a cut is already running here; wait for it to finish first');
    if (!FILE_NAME_RE.test(name)) throw new RegionCutError('the file name must end in .pmtiles and use only letters, digits, dot, dash and underscore');
    if (!validSource(source)) throw new RegionCutError("the world file address is not set up right; an admin needs to fix it in Module Configuration");
    if (!validBox(box)) throw new RegionCutError('that is not a sensible area');
    if (!Number.isInteger(maxZoom) || maxZoom < 0 || maxZoom > MAX_ZOOM) throw new RegionCutError(`the zoom must be 0 to ${MAX_ZOOM}`);
    if (minZoom !== undefined && (!Number.isInteger(minZoom) || minZoom < 0 || minZoom > maxZoom)) throw new RegionCutError('the minimum zoom must be 0 or more, and no higher than the maximum');
    const destDir = path.resolve(this.dir, 'modules', moduleId, folder);
    const dest = path.join(destDir, name);
    if (fs.existsSync(dest)) throw new RegionCutError(`${name} already exists here; choose a different name, or remove it first`);
    const id = crypto.randomBytes(8).toString('hex');
    const tmp = path.join(os.tmpdir(), `tavern-region-${id}.pmtiles`);
    const job = { id, moduleId, scopeKey, name, by, percent: 0, message: 'Reading the world file…', status: 'running', error: null, endedAt: 0, tmp };
    this.jobs.set(id, job);
    this.runJob(job, { source, destDir, dest, box, minZoom, maxZoom }).catch(() => {}); // errors are recorded on the job itself
    return { id };
  }

  async runJob(job, { source, destDir, dest, box, minZoom, maxZoom }) {
    const setProgress = (percent, message) => {
      job.percent = percent;
      job.message = message;
      this.emit('progress', job.id, { percent, message });
    };
    const args = ['extract', source, job.tmp, bboxArg(box), `--maxzoom=${maxZoom}`];
    if (Number.isInteger(minZoom)) args.push(`--minzoom=${minZoom}`);
    const { code, output } = await this.run(args, {
      timeoutMs: JOB_TIMEOUT_MS,
      onProgress: ({ percent, detail }) => setProgress(percent, `Downloading… ${percent}% (${detail})`),
    });
    if (code === 0) {
      try {
        fs.mkdirSync(destDir, { recursive: true });
        fs.renameSync(job.tmp, dest);
        job.status = 'done';
        job.percent = 100;
        job.message = 'Done.';
        job.endedAt = Date.now();
        this.emit('done', job.id, { name: job.name });
        return;
      } catch (err) {
        job.error = `the file could not be written: ${err.message}`;
      }
    } else {
      job.error = reason(output);
    }
    fs.rmSync(job.tmp, { force: true }); // nothing half-written is left behind, whichever way it failed
    job.status = 'error';
    job.endedAt = Date.now();
    this.emit('error', job.id, job.error);
  }
}

module.exports = { RegionCutJobs, RegionCutError, validBox, validSource, bboxArg, humanSize, parseSize, reason, MAX_BYTES, MAX_ZOOM, FILE_NAME_RE };
