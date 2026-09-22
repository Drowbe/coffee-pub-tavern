#!/usr/bin/env node
/*
 * check-modules.mjs -- run server/modules.js's manifest cleaning on its own (server/modules.js:cleanManifest), no server,
 * no filesystem beyond what it needs. Focused on the parts easy to get wrong by hand in a module.json.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { cleanManifest, ModuleError } = createRequire(import.meta.url)('../server/modules.js');
let n = 0;
const test = (name, fn) => { fn(); n += 1; };

// The smallest manifest cleanManifest will accept: a server-scope module with one page.
const base = () => ({ id: 'thing', name: 'Thing', version: '1.0.0', scope: ['server'], surfaces: { page: { entry: 'page.html' } } });
const files = new Set(['page.html']);

test('a setting keeps a help paragraph longer than a one-line hint', () => {
  const long = 'A world PMTiles file to cut a region from with "Add a region", below. Tavern reads only the part it cuts, over https range requests, never the whole file. Protomaps publishes a daily build at https://maps.protomaps.com/builds; its address is dated and changes most days (for example https://build.protomaps.com/20260921.pmtiles), so check that page for todays, or point this at your own stable copy. Left empty, cutting a region is off.';
  assert.ok(long.length > 200 && long.length <= 600, 'the fixture itself must sit between the old and new ceilings');
  const m = cleanManifest({ ...base(), settings: [{ key: 'worldSource', label: 'World file', type: 'url', scope: 'server', default: '', help: long }] }, files);
  assert.equal(m.settings[0].help, long); // not cut off mid-sentence
});

test('an absurdly long help is still capped, not unbounded', () => {
  const m = cleanManifest({ ...base(), settings: [{ key: 'x', label: 'X', type: 'boolean', scope: 'server', default: false, help: 'y'.repeat(1000) }] }, files);
  assert.equal(m.settings[0].help.length, 600);
});

test('line breaks in a setting\'s help are kept, not collapsed', () => {
  const m = cleanManifest({ ...base(), settings: [{ key: 'x', label: 'X', type: 'boolean', scope: 'server', default: false, help: 'First line.\n\nSecond line.' }] }, files);
  assert.equal(m.settings[0].help, 'First line.\n\nSecond line.');
});

test('a choice option\'s own help is unaffected (already had the wider ceiling)', () => {
  const m = cleanManifest({ ...base(), settings: [{ key: 'x', label: 'X', type: 'choice', scope: 'server', default: 'a', options: [{ value: 'a', label: 'A', help: 'z'.repeat(700) }, { value: 'b', label: 'B' }] }] }, files);
  assert.equal(m.settings[0].options[0].help.length, 600);
});

test('bad input still throws a ModuleError, same as before', () => {
  assert.throws(() => cleanManifest({ ...base(), id: '' }, files), ModuleError);
});

console.log(`check-modules: ${n} groups OK`);
