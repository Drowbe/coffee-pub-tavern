#!/usr/bin/env node
/*
 * check-region-cut.mjs -- run server/region-cut.js on its own: the pure helpers (a box, a source address, the size and
 * reason read from the CLI's own output) directly, and the background job against a small stand-in "pmtiles" script (so
 * this runs without the real binary or any network access) -- progress parsed as it streams in, a successful cut renamed
 * into place, a failed one leaving nothing behind, and only one cut running per module scope at a time.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { RegionCutJobs, RegionCutError, validBox, validSource, bboxArg, humanSize, parseSize, reason, MAX_BYTES } = createRequire(import.meta.url)('../server/region-cut.js');
let n = 0;
const test = async (name, fn) => { await fn(); n += 1; };
const box = { minLon: -9.25, minLat: 38.6, maxLon: -9.05, maxLat: 38.8 };

test('a box and a source address, checked', () => {
  assert.equal(validBox(box), true);
  assert.equal(validBox({ ...box, minLon: 200 }), false);
  assert.equal(validBox({ ...box, minLon: box.maxLon, maxLon: box.minLon }), false); // min past max
  assert.equal(validBox(null), false);
  assert.equal(bboxArg(box), '--bbox=-9.25,38.6,-9.05,38.8');
  assert.equal(validSource('https://build.protomaps.com/x.pmtiles'), true);
  assert.equal(validSource('http://example.org/x.pmtiles'), true);
  assert.equal(validSource('ftp://example.org/x.pmtiles'), false);
  assert.equal(validSource('https://u:p@example.org/x.pmtiles'), false);
  assert.equal(validSource('not a url'), false);
});

test('reading the CLI\'s own output: size, and a plain reason for a failure', () => {
  const out = 'extract.go:441: Region tiles 13, result tile entries 13\nextract.go:612: Extract transferred 844 kB (overfetch 0.05) for an archive size of 844 kB';
  assert.deepEqual(parseSize(out), { tiles: 13, bytes: 844000 });
  assert.deepEqual(parseSize('nothing usable here'), { tiles: 0, bytes: 0 });
  assert.equal(humanSize(844000), '844 kB');
  assert.equal(humanSize(2_500_000_000), '2.5 GB');
  assert.equal(humanSize(500), '500 B');
  assert.match(reason('dial tcp: lookup build.example.org: no such host'), /could not be reached/);
  assert.match(reason('GET https://x/y.pmtiles: 404 Not Found'), /not found/);
  assert.match(reason('extract.go:441: Region tiles 0, result tile entries 0'), /no tiles at this zoom/);
  assert.match(reason('2026/09/22 01:18:08 extract.go:399: some other problem'), /some other problem/);
  assert.match(reason(''), /unknown reason/);
});

// A stand-in "pmtiles" binary: reads its own argv, prints the same shape of output the real CLI does, and behaves
// according to the input address, so the tests below drive real success, failure and dry-run paths without a network.
const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'region-cut-stub-'));
const stubBin = path.join(stubDir, 'pmtiles');
fs.writeFileSync(stubBin, `#!/usr/bin/env node
const args = process.argv.slice(2);
require('fs').appendFileSync(require('path').join(__dirname, 'calls.log'), JSON.stringify(args) + '\\n'); // so a test can see exactly what it was asked to run
const [cmd, input, output] = args;
const dry = args.includes('--dry-run');
if (input.includes('unreachable')) { process.stdout.write('dial tcp: lookup unreachable.example: no such host\\n'); process.exit(1); }
if (input.includes('empty')) { process.stdout.write('extract.go:441: Region tiles 0, result tile entries 0\\n'); process.exit(dry ? 0 : 1); }
if (input.includes('huge')) { process.stdout.write('extract.go:441: Region tiles 999999999, result tile entries 999999999\\nextract.go:612: Extract transferred 9.5 GB (overfetch 0.05) for an archive size of 9.5 GB\\n'); process.exit(0); }
process.stdout.write('extract.go:441: Region tiles 13, result tile entries 13\\n');
if (dry) { process.stdout.write('extract.go:612: Extract transferred 844 kB (overfetch 0.05) for an archive size of 844 kB\\n'); process.exit(0); }
process.stdout.write('fetching chunks  50% |          | (400/824 kB, 2.0 MB/s) [0s:0s]\\r');
process.stdout.write('fetching chunks 100% |##########| (824/824 kB, 2.2 MB/s)\\n');
require('fs').writeFileSync(output, 'not a real pmtiles file, just a marker');
process.stdout.write('extract.go:606: Completed in 1s\\n');
process.exit(0);
`);
fs.chmodSync(stubBin, 0o755);

function fakeJobs() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'region-cut-data-'));
  return { dataDir, jobs: new RegionCutJobs(dataDir, stubBin) };
}
const lastCall = () => JSON.parse(fs.readFileSync(path.join(stubDir, 'calls.log'), 'utf8').trim().split('\n').pop());

await test('estimate: the real shape from a dry run, refusing what will not fit', async () => {
  const { jobs } = fakeJobs();
  const est = await jobs.estimate({ source: 'https://build.protomaps.com/x.pmtiles', box, maxZoom: 10 });
  assert.deepEqual(est, { tiles: 13, bytes: 844000 });
  await assert.rejects(jobs.estimate({ source: 'not a url', box, maxZoom: 10 }), (e) => e instanceof RegionCutError);
  await assert.rejects(jobs.estimate({ source: 'https://x/unreachable.pmtiles', box, maxZoom: 10 }), /could not be reached/);
  await assert.rejects(jobs.estimate({ source: 'https://x/huge.pmtiles', box, maxZoom: 10 }), (e) => e instanceof RegionCutError && e.message.includes('too large') && MAX_BYTES > 0);
  await assert.rejects(jobs.estimate({ source: 'https://x/y.pmtiles', box, maxZoom: 99 }), /zoom must be/);
  // A minimum zoom, when given, is passed to the dry run too, so the estimate reflects the range actually cut --
  // trimming the shallow end (a wide, low-zoom base layer already covers) makes for a smaller, more accurate number.
  await jobs.estimate({ source: 'https://build.protomaps.com/x.pmtiles', box, maxZoom: 10, minZoom: 3 });
  assert.ok(lastCall().includes('--minzoom=3'));
  await jobs.estimate({ source: 'https://build.protomaps.com/x.pmtiles', box, maxZoom: 10 });
  assert.ok(!lastCall().some((a) => a.startsWith('--minzoom')), 'no --minzoom at all when none was given');
  await assert.rejects(jobs.estimate({ source: 'https://build.protomaps.com/x.pmtiles', box, maxZoom: 10, minZoom: 11 }), /minimum zoom/);
  await assert.rejects(jobs.estimate({ source: 'https://build.protomaps.com/x.pmtiles', box, maxZoom: 10, minZoom: -1 }), /minimum zoom/);
});

await test('a real cut: progress as it streams in, the file lands where it should', async () => {
  const { dataDir, jobs } = fakeJobs();
  const progress = [];
  jobs.on('progress', (id, p) => progress.push(p));
  let done = null;
  jobs.on('done', (id, d) => { done = d; });
  const { id } = await jobs.start({ moduleId: 'maps', scopeKey: 'server', source: 'https://build.protomaps.com/x.pmtiles', folder: 'map-tiles', name: 'lisbon.pmtiles', box, maxZoom: 10, by: 'admin' });
  assert.ok(id);
  assert.equal(jobs.view(id).status, 'running');
  // The temp file must live on the same volume as the final destination (inside DATA_DIR), never the system's own /tmp,
  // or the rename into place fails with EXDEV once the two are different filesystems (as they are in the real container).
  assert.ok(jobs.jobs.get(id).tmp.startsWith(dataDir + path.sep), 'the temp file is written under DATA_DIR, not the system tmpdir');
  await new Promise((r) => jobs.once('done', r));
  assert.deepEqual(done, { name: 'lisbon.pmtiles' });
  assert.equal(jobs.view(id).status, 'done');
  assert.ok(progress.length >= 1);
  assert.ok(progress.some((p) => p.percent === 100));
  const dest = path.join(dataDir, 'modules', 'maps', 'map-tiles', 'lisbon.pmtiles');
  assert.equal(fs.readFileSync(dest, 'utf8'), 'not a real pmtiles file, just a marker');
  fs.rmSync(dataDir, { recursive: true, force: true });
});

await test('a failed cut leaves nothing behind, and a bad name or an existing file is refused up front', async () => {
  const { dataDir, jobs } = fakeJobs();
  const { id } = await jobs.start({ moduleId: 'maps', scopeKey: 'server', source: 'https://x/empty.pmtiles', folder: 'map-tiles', name: 'nothing.pmtiles', box, maxZoom: 10, by: 'admin' });
  await new Promise((r) => jobs.once('error', r));
  assert.equal(jobs.view(id).status, 'error');
  assert.match(jobs.view(id).error, /no tiles at this zoom/);
  assert.equal(fs.existsSync(path.join(dataDir, 'modules', 'maps', 'map-tiles', 'nothing.pmtiles')), false);
  const tmpDir = path.join(dataDir, 'tmp', 'region-cut');
  assert.deepEqual(fs.existsSync(tmpDir) ? fs.readdirSync(tmpDir) : [], []); // the temp file was cleaned up

  await assert.rejects(jobs.start({ moduleId: 'maps', scopeKey: 'server', source: 'https://x/y.pmtiles', folder: 'map-tiles', name: '../../etc/passwd', box, maxZoom: 10 }), /letters, digits/);
  fs.mkdirSync(path.join(dataDir, 'modules', 'maps', 'map-tiles'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'modules', 'maps', 'map-tiles', 'already.pmtiles'), 'x');
  await assert.rejects(jobs.start({ moduleId: 'maps', scopeKey: 'server', source: 'https://x/y.pmtiles', folder: 'map-tiles', name: 'already.pmtiles', box, maxZoom: 10 }), /already exists/);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

await test('only one cut at a time, per module and scope', async () => {
  const { dataDir, jobs } = fakeJobs();
  const first = await jobs.start({ moduleId: 'maps', scopeKey: 'server', source: 'https://build.protomaps.com/x.pmtiles', folder: 'map-tiles', name: 'a.pmtiles', box, maxZoom: 10 });
  assert.ok(jobs.runningFor('maps', 'server'));
  await assert.rejects(jobs.start({ moduleId: 'maps', scopeKey: 'server', source: 'https://build.protomaps.com/x.pmtiles', folder: 'map-tiles', name: 'b.pmtiles', box, maxZoom: 10 }), /already running/);
  // a different scope is unaffected
  const other = await jobs.start({ moduleId: 'maps', scopeKey: 'room:abcd', source: 'https://build.protomaps.com/x.pmtiles', folder: 'map-tiles', name: 'c.pmtiles', box, maxZoom: 10 });
  assert.ok(other.id);
  await Promise.all([new Promise((r) => jobs.once('done', r)), new Promise((r) => { const h = (id) => { if (id !== other.id) return; jobs.off('done', h); r(); }; jobs.on('done', h); })]);
  await new Promise((r) => setTimeout(r, 20)); // let both settle
  assert.equal(jobs.runningFor('maps', 'server'), null);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

fs.rmSync(stubDir, { recursive: true, force: true });
console.log(`check-region-cut: ${n} groups OK`);
