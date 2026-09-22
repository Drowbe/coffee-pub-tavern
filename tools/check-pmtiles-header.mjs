#!/usr/bin/env node
/*
 * check-pmtiles-header.mjs -- run server/pmtiles-header.js on its own: a hand-built 127-byte PMTiles v3 header (the
 * same shape modules/maps/src/maps-lib-b-pmtiles.js reads in the browser), and the ways a file can fail to be one.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { pmtilesZoomRange, HEADER_BYTES } = createRequire(import.meta.url)('../server/pmtiles-header.js');
let n = 0;
const test = (name, fn) => { fn(); n += 1; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmtiles-header-'));

// A minimal, otherwise-empty header with a real magic number, spec version and zoom range -- everything after
// byte 101 (bounds, center) is left zero, since the reader never looks past it.
function header({ version = 3, minZoom = 0, maxZoom = 14, extra = HEADER_BYTES } = {}) {
  const buf = Buffer.alloc(Math.max(extra, HEADER_BYTES));
  buf.write('PMTiles', 0, 'ascii');
  buf.writeUInt8(version, 7);
  buf.writeUInt8(minZoom, 100);
  buf.writeUInt8(maxZoom, 101);
  return buf;
}
const write = (name, buf) => { const p = path.join(dir, name); fs.writeFileSync(p, buf); return p; };

test('a real header\'s zoom range, read back', () => {
  assert.deepEqual(pmtilesZoomRange(write('a.pmtiles', header({ minZoom: 3, maxZoom: 10 }))), { minZoom: 3, maxZoom: 10 });
  assert.deepEqual(pmtilesZoomRange(write('b.pmtiles', header({ minZoom: 0, maxZoom: 0 }))), { minZoom: 0, maxZoom: 0 });
  assert.deepEqual(pmtilesZoomRange(write('c.pmtiles', header({ minZoom: 0, maxZoom: 15 }))), { minZoom: 0, maxZoom: 15 });
  // Bytes past the header (real tile data) do not confuse it.
  assert.deepEqual(pmtilesZoomRange(write('d.pmtiles', Buffer.concat([header({ minZoom: 5, maxZoom: 12 }), Buffer.from('not really tile data')]))), { minZoom: 5, maxZoom: 12 });
});

test('not a PMTiles file, in every way that matters', () => {
  assert.equal(pmtilesZoomRange(write('wrong-magic.pmtiles', (() => { const b = header(); b.write('XXTiles', 0, 'ascii'); return b; })())), null);
  assert.equal(pmtilesZoomRange(write('too-new.pmtiles', header({ version: 99 }))), null);
  assert.equal(pmtilesZoomRange(write('too-short.pmtiles', header({ extra: 40 }).subarray(0, 40))), null);
  assert.equal(pmtilesZoomRange(write('backwards.pmtiles', header({ minZoom: 12, maxZoom: 5 }))), null); // max below min: not a sane header
  assert.equal(pmtilesZoomRange(write('empty.pmtiles', Buffer.alloc(0))), null);
  assert.equal(pmtilesZoomRange(path.join(dir, 'missing.pmtiles')), null);
  assert.equal(pmtilesZoomRange(dir), null); // a directory, not a file
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(`check-pmtiles-header: ${n} groups OK`);
