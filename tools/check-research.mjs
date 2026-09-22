#!/usr/bin/env node
/*
 * check-research.mjs -- run the Research module's model (modules/research/src/research-lib.js) on its own, with the SDK's geo helpers
 * and a small in-memory stand-in for the SDK's store: items and their checking, tags, what quick add makes of what was typed,
 * filtering, the answer pieces of an AI reply, and saving, removing and the actions other modules ask.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const sdk = fs.readFileSync(new URL('../public/sdk/tavern.js', import.meta.url), 'utf8');
const win = { addEventListener() {}, location: { search: '' } };
win.parent = win;
new Function('window', 'document', sdk)(win, {});
const geo = win.createTavern({ call: async () => ({}), root: {}, rootElement: {} }).tavern.util.geo;

const names = ['KINDS', 'cleanItem', 'itemValue', 'textOf', 'parseTags', 'cleanTags', 'cleanUrl', 'readEntry', 'filterItems', 'tagCounts', 'fitSize', 'captionOf', 'createResearch'];
const lib = new Function('geo', `${fs.readFileSync(new URL('../modules/research/src/research-lib.js', import.meta.url), 'utf8')}\nreturn { ${names.join(', ')} };`)(geo);

function fakeTavern() {
  const data = new Map();
  const handlers = {};
  const removedFiles = [];
  const links = [];
  let n = 0;
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
    refs: { make: (kind, id) => ({ module: 'research', kind, id, scope: 'room', room: 'r' }), setLinks: async (from, to) => { links.push([from.id, to.length]); } },
    uploads: { remove: async (id) => { removedFiles.push(id); } },
    actions: { provide: (h) => Object.assign(handlers, h) },
  };
  return { tavern, data, handlers, removedFiles, links };
}
let n = 0;
const test = async (name, fn) => { await fn(); n += 1; };
const FILE = 'a'.repeat(24);

await test('items are checked: what a kind needs, and nothing else', () => {
  assert.equal(lib.cleanItem('note', 'a', null), null);
  assert.equal(lib.cleanItem('thing', 'a', { title: 'x' }), null);
  assert.equal(lib.cleanItem('link', 'a', { title: 'x', url: 'javascript:alert(1)' }), null);
  assert.equal(lib.cleanItem('link', 'a', { url: 'https://u:p@x.example' }), null);
  assert.equal(lib.cleanItem('photo', 'a', { title: 'x' }), null); // a photo needs its file
  const link = lib.cleanItem('link', 'a', { url: 'https://www.example.org/page', excerpt: 'the part that mattered', tags: ['Hotel', 'hotel', 'Two Words'] });
  assert.equal(link.title, 'example.org');
  assert.equal(link.site, 'example.org');
  assert.deepEqual(link.tags, ['hotel', 'twowords']);
  const note = lib.cleanItem('note', 'b', { body: 'First line\nsecond', date: '2026-02-30', point: { lat: 95, lng: 0 } });
  assert.equal(note.title, 'First line');
  assert.equal(note.date, '');
  assert.equal(note.point, null);
  assert.equal(lib.cleanItem('note', 'b', { title: 'x', date: '2026-02-28', point: { lat: 1, lng: 2, name: 'Pier' } }).point.name, 'Pier');
  const photo = lib.cleanItem('photo', 'c', { title: 'Harbour', file: { id: FILE, hasThumb: true } });
  assert.deepEqual(photo.file, { id: FILE, hasThumb: true });
  assert.equal(lib.cleanItem('photo', 'c', { title: 'x', file: { id: '../../etc' } }), null);
  const answer = lib.cleanItem('answer', 'd', { title: 'Hotels', content: 'Near the station.', ai: { question: 'where?', sources: [{ module: 'places', kind: 'place', id: 'p1' }, { bad: 1 }] } });
  assert.equal(answer.ai.sources.length, 1);
  // What is stored: only what the kind uses, plus the words the card carries.
  const v = lib.itemValue(link);
  assert.equal(v.text, 'the part that mattered');
  assert.equal(v.sub, 'example.org');
  assert.ok(!('body' in v) && !('content' in v));
  assert.equal(lib.itemValue(note).text, 'First line\nsecond');
  assert.equal(lib.itemValue(photo).text, 'Harbour');
});

await test('tags and quick add', () => {
  assert.deepEqual(lib.parseTags('#Hotel, lisbon  food;food'), ['hotel', 'lisbon', 'food']);
  assert.equal(lib.parseTags(Array(20).fill('a').map((x, i) => x + i).join(' ')).length, 8);
  assert.deepEqual(lib.readEntry('https://example.org/x'), { kind: 'link', url: 'https://example.org/x', title: '', excerpt: '' });
  assert.equal(lib.readEntry('see https://example.org/x for more').kind, 'note');
  assert.deepEqual({ ...lib.readEntry('Hotel ideas\nnear the station\nquiet') }, { kind: 'note', title: 'Hotel ideas', body: 'near the station\nquiet', point: null });
  assert.equal(lib.readEntry('   '), null);
  assert.equal(lib.readEntry('javascript:alert(1)').kind, 'note');
  assert.equal(lib.captionOf('IMG_2041-b.jpeg'), 'IMG 2041 b');
  assert.deepEqual(lib.fitSize(4000, 3000, 2000), { width: 2000, height: 1500 });
  assert.deepEqual(lib.fitSize(300, 200, 2000), { width: 300, height: 200 });
});

await test('filtering: words, a kind, and all the chosen tags', () => {
  const items = [
    lib.cleanItem('note', '1', { title: 'Hotels near the station', body: 'quiet street', tags: ['hotel', 'lisbon'], at: '2026-09-01T00:00:00Z' }),
    lib.cleanItem('link', '2', { url: 'https://hotels.example.org', title: 'Hotel list', tags: ['hotel'], at: '2026-09-03T00:00:00Z' }),
    lib.cleanItem('photo', '3', { title: 'Harbour', file: { id: FILE }, tags: ['lisbon'], at: '2026-09-02T00:00:00Z' }),
  ];
  assert.deepEqual(lib.filterItems(items, {}).map((i) => i.id), ['2', '3', '1']); // newest first
  assert.deepEqual(lib.filterItems(items, { q: 'hotel' }).map((i) => i.id), ['2', '1']);
  assert.deepEqual(lib.filterItems(items, { q: 'quiet station' }).map((i) => i.id), ['1']);
  assert.deepEqual(lib.filterItems(items, { kind: 'photo' }).map((i) => i.id), ['3']);
  assert.deepEqual(lib.filterItems(items, { tags: ['hotel', 'lisbon'] }).map((i) => i.id), ['1']);
  assert.deepEqual(lib.tagCounts(items), [{ tag: 'hotel', count: 2 }, { tag: 'lisbon', count: 2 }]);
});

await test('the store: save, edit with versions, remove (and the picture), and what others ask', async () => {
  const f = fakeTavern();
  const r = lib.createResearch(f.tavern, { scope: 'room' });
  f.tavern.on = (ev, fn) => fn; // events are not needed here
  const note = await r.save({ kind: 'note', title: 'Ideas', body: 'first', tags: ['a'], by: 'u1' });
  assert.ok(f.data.has(`note:${note.id}`));
  assert.equal(r.list().length, 1);
  await assert.rejects(r.save({ ...note, title: 'Stale' }, 99), (e) => e.status === 409);
  await r.save({ ...note, title: 'Ideas 2' }, r.versionOf(note.id));
  assert.equal(r.get(note.id).title, 'Ideas 2');
  await assert.rejects(r.save({ kind: 'link', url: 'nope', by: 'u1' }), /whole item/);
  const photo = await r.save({ kind: 'photo', title: 'Harbour', file: { id: FILE, hasThumb: true }, by: 'u1' });
  await r.remove(photo.id);
  assert.deepEqual(f.removedFiles, [FILE]);
  assert.equal(r.list().length, 1);
  const again = lib.createResearch(f.tavern, { scope: 'room' });
  await again.load();
  assert.equal(again.list().length, 1);
  r.provide('u1');
  const out = await f.handlers.saveNote({ title: 'From elsewhere', body: 'text', tags: '#Hotel, Lisbon', ref: { module: 'places', kind: 'place', id: 'p' } }, { by: 'u2' });
  assert.equal(out.ref.kind, 'note');
  assert.deepEqual(r.get(out.ref.id).tags, ['hotel', 'lisbon']);
  assert.equal(f.links.at(-1)[1], 1);
  await assert.rejects(f.handlers.saveNote({ title: '' }), /title/);
  const link = await f.handlers.saveLink({ url: 'https://example.org/a', excerpt: 'because' });
  assert.equal(r.get(link.ref.id).excerpt, 'because');
  await assert.rejects(f.handlers.saveLink({ url: 'ftp://x' }), /web address/);
  // A person's own items are private: nothing is linked.
  const mine = lib.createResearch(f.tavern, { scope: 'person' });
  mine.provide('u1');
  const before = f.links.length;
  await f.handlers.saveNote({ title: 'Private', ref: { module: 'places', kind: 'place', id: 'p' } });
  assert.equal(f.links.length, before);
});

console.log(`check-research: OK (${n} checks)`);
