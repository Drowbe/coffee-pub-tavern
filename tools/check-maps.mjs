#!/usr/bin/env node
/*
 * check-maps.mjs -- run the Maps module's own code (places, coordinates, the style) without a browser.
 * The libraries are written to be inlined into a module page, so they are loaded here as a function body.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (name) => fs.readFileSync(new URL(`../modules/maps/src/${name}`, import.meta.url), 'utf8');
// The SDK's geo helpers, which the page hands to the library.
const sdk = fs.readFileSync(new URL('../public/sdk/tavern.js', import.meta.url), 'utf8');
const win = { addEventListener() {}, location: { search: '' } };
win.parent = win;
new Function('window', 'document', sdk)(win, {});
const geo = win.createTavern({ call: async () => ({}), root: {}, rootElement: {} }).tavern.util.geo;
const names = ['searchResults', 'clusterPoints', 'boundsOf', 'rgbOf', 'mixRgb', 'buildStyle'];
const lib = new Function('geo', `${read('maps-lib-c-geo.js')}\n${read('maps-lib-d-style.js')}\nreturn { ${names.join(', ')} };`)(geo);

let n = 0;
const test = (name, fn) => { fn(); n += 1; };

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
