#!/usr/bin/env node
/*
 * check-maps.mjs -- run the Maps module's own code (places, coordinates, the style) without a browser.
 * The libraries are written to be inlined into a module page, so they are loaded here as a function body.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (name) => fs.readFileSync(new URL(`../modules/maps/src/${name}`, import.meta.url), 'utf8');
const names = ['cleanPlace', 'placeValue', 'coord', 'parsePoint', 'coordsText', 'mapsLink', 'searchResults', 'clusterPoints', 'boundsOf', 'rgbOf', 'mixRgb', 'buildStyle', 'PLACE_PREFIX'];
const lib = new Function(`${read('maps-lib-c-geo.js')}\n${read('maps-lib-d-style.js')}\nreturn { ${names.join(', ')} };`)();

let n = 0;
const test = (name, fn) => { fn(); n += 1; };

test('a place needs a name and a point in range', () => {
  assert.equal(lib.cleanPlace('a', { title: '', point: { lat: 1, lng: 2 } }), null);
  assert.equal(lib.cleanPlace('a', { title: 'x', point: { lat: 91, lng: 2 } }), null);
  assert.equal(lib.cleanPlace('a', { title: 'x', point: { lat: 'no', lng: 2 } }), null);
  assert.equal(lib.cleanPlace('a', { title: 'x' }), null);
  const p = lib.cleanPlace('a', { title: ' Pier \n 9 ', notes: 'n', point: { lat: 38.7075123456, lng: -9.1364 }, owners: ['u1', 'u1', 5], by: 'u1', ref: { module: 'm', kind: 'k', id: '7', scope: 'room', room: 'r' } });
  assert.equal(p.title, 'Pier 9');
  assert.deepEqual(p.point, { lat: 38.707512, lng: -9.1364, name: 'Pier 9' });
  assert.deepEqual(p.owners, ['u1']);
  assert.deepEqual(p.ref, { module: 'm', kind: 'k', id: '7', scope: 'room', room: 'r' });
  assert.equal(lib.cleanPlace('a', { title: 'x', point: { lat: 1, lng: 2 }, ref: { module: 'm' } }).ref, null);
});

test('what is stored keeps the point in a field a card can name', () => {
  const v = lib.placeValue(lib.cleanPlace('a', { title: 'x', point: { lat: 1, lng: 2 } }));
  assert.deepEqual(Object.keys(v).sort(), ['by', 'notes', 'owners', 'point', 'title']);
  assert.equal(v.point.lat, 1);
});

test('coordinates typed in a field', () => {
  assert.equal(lib.coord('38.7', 90), 38.7);
  assert.equal(lib.coord(' -9,13 ', 180), -9.13);
  assert.equal(lib.coord('91', 90), null);
  assert.equal(lib.coord('abc', 90), null);
  assert.equal(lib.coord('', 90), null);
});

test('pasted text: a pair, or a map link', () => {
  const want = { lat: 38.7075, lng: -9.1364 };
  assert.deepEqual(lib.parsePoint('38.7075, -9.1364'), want);
  assert.deepEqual(lib.parsePoint('38.7075 -9.1364'), want);
  assert.deepEqual(lib.parsePoint('geo:38.7075,-9.1364?q=38.7075,-9.1364(Pier)'), want);
  assert.deepEqual(lib.parsePoint('https://maps.example.org/?ll=38.7075,-9.1364&z=12'), want);
  assert.deepEqual(lib.parsePoint('https://maps.example.org/place/x/@38.7075,-9.1364,15z/data'), want);
  assert.deepEqual(lib.parsePoint('https://maps.example.org/?mlat=38.7075&mlon=-9.1364#map=15/38.7/-9.1'), want);
  assert.deepEqual(lib.parsePoint('https://maps.example.org/#map=15/38.7075/-9.1364'), want);
  assert.deepEqual(lib.parsePoint('https://maps.example.org/data=!3d38.7075!4d-9.1364'), want);
  assert.equal(lib.parsePoint('lunch at the pier'), null);
  assert.equal(lib.parsePoint('95, 10'), null);
  assert.equal(lib.parsePoint('12'), null);
  assert.equal(lib.parsePoint(''), null);
});

test('the link to the person\'s own maps app', () => {
  const p = lib.cleanPlace('a', { title: 'Old (pier)', point: { lat: 1.5, lng: 2.5 } });
  assert.equal(lib.mapsLink(p, false), 'geo:1.5,2.5?q=1.5,2.5(Old%20%20pier%20)');
  assert.match(lib.mapsLink(p, true), /^https:\/\/maps\.apple\.com\/\?ll=1\.5,2\.5&q=/);
});

test('search results from a Photon-compatible endpoint', () => {
  const r = lib.searchResults({ features: [
    { geometry: { type: 'Point', coordinates: [-9.13, 38.7] }, properties: { name: 'Praca', city: 'Lisboa', country: 'Portugal' } },
    { geometry: { type: 'Point', coordinates: [500, 38.7] }, properties: { name: 'Off the map' } },
    { geometry: { type: 'Polygon', coordinates: [] }, properties: { name: 'Area' } },
    { geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} },
  ] });
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], { title: 'Praca', sub: 'Lisboa, Portugal', lat: 38.7, lng: -9.13 });
  assert.deepEqual(lib.searchResults(null), []);
  assert.deepEqual(lib.searchResults({ features: 'no' }), []);
});

test('points that would overlap are grouped', () => {
  const project = (lat, lng) => ({ x: lng * 10, y: lat * 10 });
  const g = lib.clusterPoints([{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 0, lng: 20 }], project, 36);
  assert.equal(g.length, 2);
  assert.equal(g[0].points.length, 2);
  assert.equal(g[0].lng, 0.5);
  assert.deepEqual(lib.boundsOf([{ lat: 1, lng: 2 }, { lat: 3, lng: -4 }]), [[-4, 1], [2, 3]]);
  assert.equal(lib.boundsOf([]), null);
});

test('colours from the theme, and the style built from them', () => {
  assert.deepEqual(lib.rgbOf('rgb(10, 20, 30)'), [10, 20, 30]);
  assert.deepEqual(lib.rgbOf('rgba(10, 20, 30, 0.5)'), [10, 20, 30]);
  assert.deepEqual(lib.rgbOf('#ff8000'), [255, 128, 0]);
  assert.deepEqual(lib.rgbOf('#fff'), [255, 255, 255]);
  assert.deepEqual(lib.rgbOf('color(srgb 1 0.5 0)'), [255, 127.5, 0]);
  assert.equal(lib.rgbOf('nonsense'), null);
  assert.equal(lib.mixRgb([100, 100, 100], [0, 0, 0], 10), 'rgb(10,10,10)');
  const dark = lib.buildStyle({}, { tiles: 'pmtiles://https://x/y.pmtiles', glyphs: 'https://x/{fontstack}/{range}.pbf' });
  const light = lib.buildStyle({ section: [250, 248, 244], text: [30, 30, 30] }, { tiles: 't', glyphs: 'g' });
  assert.equal(dark.version, 8);
  assert.equal(dark.sources.map.url, 'pmtiles://https://x/y.pmtiles');
  const bg = (s) => s.layers.find((l) => l.id === 'background').paint['background-color'];
  assert.notEqual(bg(dark), bg(light));
  assert.equal(bg(light), 'rgb(250,248,244)');
  assert.ok(!dark.layers.some((l) => l['source-layer'] === 'pois'), 'no points of interest');
  assert.ok(dark.layers.every((l) => l.type === 'background' || l.source === 'map'));
  assert.ok(!JSON.stringify(dark).includes('NaN'));
});

console.log(`check-maps: OK (${n} checks)`);
