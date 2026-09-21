#!/usr/bin/env node
/*
 * check-places.mjs -- run the Places module's model (modules/places/src/places-lib.js) and the SDK's geo helpers on their own.
 * The library is written to be inlined into a module page, so it is loaded here as a function body with the SDK's `geo`
 * and a small in-memory stand-in for the SDK's store.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

// The real SDK, run against a bare window, for its geo helpers.
const sdk = fs.readFileSync(new URL('../public/sdk/tavern.js', import.meta.url), 'utf8');
const win = { addEventListener() {}, location: { search: '' } };
win.parent = win;
new Function('window', 'document', sdk)(win, {});
const geo = win.createTavern({ call: async () => ({}), root: {}, rootElement: {} }).tavern.util.geo;

const lib = new Function('geo', `${fs.readFileSync(new URL('../modules/places/src/places-lib.js', import.meta.url), 'utf8')}\nreturn { cleanPlace, placeValue, placeFromRequest, createPlaces, searchResults, searchUrl, readEntry, PLACE_PREFIX, CATEGORIES };`)(geo);

// An in-memory SDK: the store (with versions and 409s), events, ids, pointers and the actions a page provides.
function fakeTavern() {
  const data = new Map();
  const handlers = {};
  let n = 0;
  const links = [];
  const tavern = {
    storage: {
      list: async (prefix) => [...data].filter(([k]) => k.startsWith(prefix)).map(([key, x]) => ({ key, value: x.value, version: x.version })),
      set: async (key, value, o) => {
        const cur = data.get(key);
        if (o && o.version !== undefined && (!cur || cur.version !== o.version)) throw Object.assign(new Error('changed'), { status: 409 });
        const version = (cur ? cur.version : 0) + 1;
        data.set(key, { value: JSON.parse(JSON.stringify(value)), version });
        return { version };
      },
      delete: async (key) => { data.delete(key); },
    },
    on: () => () => {},
    util: { id: () => `id${(n += 1)}` },
    refs: { make: (kind, id) => ({ module: 'places', kind, id, scope: 'room', room: 'r' }), setLinks: async (from, to) => { links.push([from.id, to.length]); } },
    actions: { provide: (h) => Object.assign(handlers, h) },
  };
  return { tavern, data, handlers, links };
}

let n = 0;
const test = async (name, fn) => { await fn(); n += 1; };

await test('geo: typed coordinates and pasted links', () => {
  assert.equal(geo.coord('38.7', 90), 38.7);
  assert.equal(geo.coord(' -9,13 ', 180), -9.13);
  assert.equal(geo.coord('91', 90), null);
  assert.equal(geo.coord('abc', 90), null);
  const want = { lat: 38.7075, lng: -9.1364 };
  assert.deepEqual(geo.parsePoint('38.7075, -9.1364'), want);
  assert.deepEqual(geo.parsePoint('38.7075 -9.1364'), want);
  assert.deepEqual(geo.parsePoint('geo:38.7075,-9.1364?q=38.7075,-9.1364(Pier)'), want);
  assert.deepEqual(geo.parsePoint('https://maps.example.org/?ll=38.7075,-9.1364&z=12'), want);
  assert.deepEqual(geo.parsePoint('https://maps.example.org/place/x/@38.7075,-9.1364,15z/data'), want);
  assert.deepEqual(geo.parsePoint('https://maps.example.org/?mlat=38.7075&mlon=-9.1364#map=15/38.7/-9.1'), want);
  assert.deepEqual(geo.parsePoint('https://maps.example.org/#map=15/38.7075/-9.1364'), want);
  assert.deepEqual(geo.parsePoint('https://maps.example.org/data=!3d38.7075!4d-9.1364'), want);
  assert.equal(geo.parsePoint('lunch at the pier'), null);
  assert.equal(geo.parsePoint('95, 10'), null);
  assert.equal(geo.parsePoint('12'), null);
  assert.equal(geo.parsePoint(''), null);
  assert.equal(geo.coordsText(38.7075, -9.1364), '38.70750, -9.13640');
});

await test('geo: the link to the person\'s own maps app', () => {
  // A desktop browser has nothing registered for geo: (Windows opens a blank page), so only Android gets one.
  const setAgent = (userAgent) => Object.defineProperty(globalThis, 'navigator', { value: { userAgent }, configurable: true });
  setAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120');
  assert.equal(geo.mapsLink(1.5, 2.5, 'Old (pier)', false), 'https://www.openstreetmap.org/?mlat=1.5&mlon=2.5#map=17/1.5/2.5');
  assert.equal(geo.mapsSearch('Fontane', false), 'https://www.openstreetmap.org/search?query=Fontane');
  setAgent('Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile');
  assert.equal(geo.mapsLink(1.5, 2.5, 'Old (pier)', false), 'geo:1.5,2.5?q=1.5,2.5(Old%20%20pier%20)');
  assert.equal(geo.mapsSearch('Fontane', false), 'geo:0,0?q=Fontane');
  assert.equal(geo.mapsSearch('Fontane', true), 'https://maps.apple.com/?q=Fontane');
  assert.match(geo.mapsLink(1.5, 2.5, 'Pier', true), /^https:\/\/maps\.apple\.com\/\?ll=1\.5,2\.5&q=Pier$/);
  assert.equal(geo.oneLine(' a \n\t b ', 10), 'a b');
});

await test('a place needs a name; the point is optional and checked', () => {
  assert.equal(lib.cleanPlace('a', { title: '' }), null);
  assert.equal(lib.cleanPlace('a', null), null);
  const bare = lib.cleanPlace('a', { title: ' Museum ', address: 'Rua 1,\n Lisboa', category: 'nope' });
  assert.equal(bare.title, 'Museum');
  assert.equal(bare.address, 'Rua 1, Lisboa');
  assert.equal(bare.category, 'other');
  assert.equal(bare.point, null);
  assert.equal(lib.cleanPlace('a', { title: 'x', point: { lat: 91, lng: 2 } }).point, null);
  assert.equal(lib.cleanPlace('a', { title: 'x', point: { lat: 'no', lng: 2 } }).point, null);
  const p = lib.cleanPlace('a', { title: 'Pier', category: 'eat', point: { lat: 38.7075123456, lng: -9.1364 }, owners: ['u1', 'u1', 5], by: 'u1', ref: { module: 'm', kind: 'k', id: '7', scope: 'room', room: 'r' } });
  assert.deepEqual(p.point, { lat: 38.707512, lng: -9.1364 });
  assert.equal(p.category, 'eat');
  assert.deepEqual(p.owners, ['u1']);
  assert.deepEqual(p.ref, { module: 'm', kind: 'k', id: '7', scope: 'room', room: 'r' });
  assert.equal(lib.cleanPlace('a', { title: 'x', ref: { module: 'm' } }).ref, null);
});

await test('what is stored leaves out the point when there is none (so its card has no place)', () => {
  const withNone = lib.placeValue(lib.cleanPlace('a', { title: 'x', address: 'y' }));
  assert.ok(!('point' in withNone));
  assert.ok(!('ref' in withNone));
  const withPoint = lib.placeValue(lib.cleanPlace('a', { title: 'x', point: { lat: 1, lng: 2 } }));
  assert.deepEqual(withPoint.point, { lat: 1, lng: 2 });
});

await test('a request to add a place is checked', () => {
  assert.throws(() => lib.placeFromRequest({ title: '  ' }, 'u'), /name/);
  assert.throws(() => lib.placeFromRequest({ title: 'x', lat: 10 }, 'u'), /range/);
  assert.throws(() => lib.placeFromRequest({ title: 'x', lat: 95, lng: 1 }, 'u'), /range/);
  const a = lib.placeFromRequest({ title: 'Cafe', address: 'Rua', category: 'eat' }, 'u1');
  assert.equal(a.point, null);
  assert.equal(a.by, 'u1');
  const b = lib.placeFromRequest({ title: 'Cafe', lat: 38.7, lng: -9.1, notes: 'n', ref: { module: 'm', kind: 'k', id: '1' } }, 'u1');
  assert.deepEqual(b.point, { lat: 38.7, lng: -9.1 });
  assert.equal(b.ref.id, '1');
});

await test('the actions a page provides: addPlace and setPlacePoint', async () => {
  const { tavern, data, handlers } = fakeTavern();
  const places = lib.createPlaces(tavern);
  places.provide('me');
  await places.load();
  const out = await handlers.addPlace({ title: 'Cafe', address: 'Rua 1' }, { by: 'u9' });
  assert.equal(out.ref.kind, 'place');
  const key = `place:${out.ref.id}`;
  assert.ok(data.has(key));
  assert.ok(!('point' in data.get(key).value));
  assert.equal(data.get(key).value.by, 'me');
  await assert.rejects(handlers.addPlace({ title: '' }, {}), /name/);
  const moved = await handlers.setPlacePoint({ place: out.ref, lat: 38.7, lng: -9.1 });
  assert.equal(moved.ref.id, out.ref.id);
  assert.deepEqual(data.get(key).value.point, { lat: 38.7, lng: -9.1 });
  await assert.rejects(handlers.setPlacePoint({ place: out.ref, lat: 200, lng: 0 }), /range/);
  await assert.rejects(handlers.setPlacePoint({ place: { ...out.ref, kind: 'other' }, lat: 1, lng: 1 }), /not a place/);
  await assert.rejects(handlers.setPlacePoint({ place: { ...out.ref, id: 'nope' }, lat: 1, lng: 1 }), /no such place/);
  assert.equal(places.list().length, 1);
  assert.deepEqual(places.get(out.ref.id).point, { lat: 38.7, lng: -9.1 });
});

await test('editing keeps versions: a stale save is refused, remove forgets the links', async () => {
  const { tavern, links } = fakeTavern();
  const places = lib.createPlaces(tavern);
  await places.load();
  const p = await places.save({ id: '', title: 'A', category: 'do', address: '', point: null, notes: '', owners: [], by: 'u', ref: { module: 'm', kind: 'k', id: '1' } });
  const v = places.versionOf(p.id);
  await places.save({ ...p, title: 'B' }, v);
  await assert.rejects(places.save({ ...p, title: 'C' }, v), (e) => e.status === 409);
  assert.equal(places.get(p.id).title, 'B');
  assert.ok(links.some(([id, count]) => id === p.id && count === 1));
  await places.remove(p.id);
  assert.equal(places.list().length, 0);
  assert.ok(links.some(([id, count]) => id === p.id && count === 0));
});

await test('finding a place: results, the address to ask, and what a bar entry means', () => {
  const r = lib.searchResults({ features: [
    { geometry: { type: 'Point', coordinates: [-9.13, 38.7] }, properties: { name: 'Praca', city: 'Lisboa', country: 'Portugal' } },
    { geometry: { type: 'Point', coordinates: [500, 38.7] }, properties: { name: 'Off the map' } },
    { geometry: { type: 'Polygon', coordinates: [] }, properties: { name: 'Area' } },
    { geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} },
  ] });
  assert.deepEqual(r, [{ title: 'Praca', sub: 'Lisboa, Portugal', lat: 38.7, lng: -9.13 }]);
  assert.deepEqual(lib.searchResults(null), []);
  assert.equal(lib.searchUrl('https://s.example/api', 'colosseo', { lat: 41.9, lon: 12.5 }), 'https://s.example/api?q=colosseo&limit=6&lat=41.9&lon=12.5');
  assert.equal(lib.searchUrl('https://s.example/api?x=1', 'a b', null), 'https://s.example/api?x=1&q=a+b&limit=6');
  assert.deepEqual(lib.readEntry('38.7075, -9.1364'), { title: '', point: { lat: 38.7075, lng: -9.1364 }, find: false });
  assert.deepEqual(lib.readEntry('Bar do Peixe 38.71, -9.14'), { title: 'Bar do Peixe', point: { lat: 38.71, lng: -9.14 }, find: false });
  assert.deepEqual(lib.readEntry('Pier https://maps.example.org/@38.7,-9.1,15z'), { title: 'Pier', point: { lat: 38.7, lng: -9.1 }, find: false });
  assert.deepEqual(lib.readEntry('colosseo'), { title: 'colosseo', point: null, find: true });
  assert.equal(lib.readEntry('x').find, false);
});

console.log(`check-places: OK (${n} checks)`);
