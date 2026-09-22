#!/usr/bin/env node
/*
 * check-geocode.mjs -- run the place-search collection (server/geocode.js) on its own: reading what an outside service answers,
 * keeping it, finding it again, marking it used and purging by that mark. No network: the answer is a fixture.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { GeocodeCache, parsePhoton, keyOf, ENOUGH } = createRequire(import.meta.url)('../server/geocode.js');
let n = 0;
const test = (name, fn) => { fn(); n += 1; };
const feat = (name, lat, lng, extra = {}) => ({ geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { name, osm_type: 'N', osm_id: Math.round(lat * 1000), ...extra } });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geocode-'));

test('reading an answer', () => {
  const r = parsePhoton({ features: [
    feat('Praca do Comercio', 38.7, -9.13, { city: 'Lisboa', country: 'Portugal', osm_key: 'tourism', osm_value: 'attraction' }),
    { geometry: { type: 'Point', coordinates: [500, 38.7] }, properties: { name: 'Off the map' } },
    { geometry: { type: 'Polygon', coordinates: [] }, properties: { name: 'Area' } },
    { geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} },
  ] });
  assert.equal(r.length, 1);
  assert.deepEqual({ ...r[0] }, { osmType: 'N', osmId: 38700, name: 'Praca do Comercio', address: 'Lisboa, Portugal', lat: 38.7, lng: -9.13, category: 'tourism:attraction' });
  assert.deepEqual(parsePhoton(null), []);
  assert.equal(keyOf(r[0]), 'N38700');
  assert.match(keyOf({ osmType: '', osmId: 0, name: 'Cafe', lat: 1, lng: 2 }), /^p:1\.00000,2\.00000:cafe$/);
});

test('a rough rectangle, when the service gives one', () => {
  const withExtent = feat('Mexico', 23.6, -102.5, { country: 'Mexico', extent: [-118.4, 32.7, -86.7, 14.5] });
  const r = parsePhoton({ features: [withExtent, feat('Eiffel Tower', 48.85, 2.29, { osm_key: 'tourism' })] });
  assert.deepEqual(r[0].extent, { minLon: -118.4, minLat: 14.5, maxLon: -86.7, maxLat: 32.7 });
  assert.equal(r[1].extent, undefined); // a point result carries no rectangle
  // Never kept: the geocode cache only ever stores a point.
  const c = new GeocodeCache(dir);
  const kept = c.remember('places', r);
  assert.equal(kept[0].extent, undefined);
  c.purge('places', 'all', 0);
});

test('keeping, finding, marking and purging', () => {
  const c = new GeocodeCache(dir);
  const found = parsePhoton({ features: ['Cafe Alpha', 'Cafe Beta', 'Bar Gamma'].map((t, i) => feat(t, 10 + i, 20, { city: 'Lisboa' })) });
  const kept = c.remember('places', found);
  assert.equal(kept.length, 3);
  assert.equal(c.stats('places').saved, 3);
  assert.equal(c.stats('places').used, 0);
  c.remember('places', found.slice(0, 1));
  assert.equal(c.places('places').get(kept[0].key).seen, 2);
  assert.deepEqual(c.search('places', 'cafe', null).map((r) => r.name), ['Cafe Alpha', 'Cafe Beta']);
  assert.deepEqual(c.search('places', 'lisboa bar', null).map((r) => r.name), ['Bar Gamma']);
  assert.deepEqual(c.search('places', 'nothing', null), []);
  assert.deepEqual(c.search('places', 'cafe', { lat: 11, lon: 20 }).map((r) => r.name), ['Cafe Beta', 'Cafe Alpha']);
  assert.equal(c.markUsed('places', kept[2].key), true);
  assert.equal(c.markUsed('places', 'nope'), false);
  // Never stored: what was asked, or by whom.
  assert.deepEqual(Object.keys(kept[0]).sort(), ['address', 'category', 'firstSeen', 'key', 'lastSeen', 'lat', 'lng', 'name', 'osmId', 'osmType', 'seen', 'used']);
  assert.equal(c.purge('places', 'unused', 1), 0); // nothing is a day old
  assert.equal(c.purge('places', 'unused', 0), 2);
  assert.equal(c.stats('places').saved, 1); // the used one is kept
  assert.equal(c.purge('places', 'all', 0), 1);
  assert.equal(c.stats('places').saved, 0);
  assert.ok(ENOUGH >= 1);
});

test('the collection survives a restart', () => {
  const c = new GeocodeCache(dir);
  c.remember('keep', parsePhoton({ features: [feat('Museu', 5, 6)] }));
  c.flush();
  const again = new GeocodeCache(dir);
  assert.equal(again.stats('keep').saved, 1);
  assert.equal(again.search('keep', 'museu', null)[0].name, 'Museu');
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(`check-geocode: ${n} groups OK`);
