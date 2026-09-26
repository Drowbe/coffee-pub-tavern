#!/usr/bin/env node
/*
 * check-object-format.mjs -- the Magpie objects format on its own: the Assistant's rule and the
 * published instructions ask for one fenced JSON array, the schema matches the checker, and readObjects keeps what it should.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  ICONS, KINDS, MAX_IMPORT_OBJECTS, MAX_IMPORT_CANDIDATES,
  cleanObject, objectRule, instructions, schema, readObjects, decodeBytes, FormatError,
} = require('../server/object-format.js');
const { MAX_SUMMARIES, parseSummaries } = require('../server/ai.js');

const fixtures = (name) => fs.readFileSync(new URL(`./fixtures/object-format/${name}`, import.meta.url), 'utf8');

let n = 0;
const test = (name, fn) => { fn(); n += 1; };

test('SUMMARY_RULE asks for one array in one card fence', () => {
  const rule = 'Always include at least one card: the part of your answer worth keeping, written as a ' + objectRule({ fence: 'card', noun: 'card', max: MAX_SUMMARIES, withProvenance: true });
  assert.match(rule, /```card\n\[/);
  assert.match(rule, /exactly one, never one per card/);
  assert.match(rule, /at most 20/);
  assert.ok(!rule.includes('one block per card'));
  assert.equal(MAX_SUMMARIES, 20);
});

test('published instructions: one magpie array, icons, kinds, 50, file paragraph, no provenance', () => {
  const text = instructions('object');
  assert.match(text, /```magpie\n\[/);
  assert.match(text, /exactly one, never one per object/);
  assert.match(text, /at most 50/);
  assert.match(text, /<something>\.magpie-objects\.json/);
  assert.match(text, /magpieObjects/);
  assert.match(text, /Do not write a separate file or a separate fenced block/);
  assert.ok(!text.includes('one block per'));
  assert.ok(!text.includes('basis'));
  assert.ok(!text.includes('sources'));
  for (const name of ICONS) assert.ok(text.includes(name), name);
  for (const name of KINDS) assert.ok(text.includes(name), name);
});

test('schema() matches the checker', () => {
  const s = schema();
  assert.equal(s.$id, 'urn:coffee-pub-magpie:objects:1');
  assert.deepEqual(s.$defs.object.properties.icon.enum, ICONS);
  assert.deepEqual(s.$defs.object.properties.kind.enum, KINDS);
  JSON.parse(JSON.stringify(s));
  const kept = cleanObject({
    icon: 'hotel', kind: 'hotel', title: 'Casa', content: 'Stay.', tags: ['faro'],
    place: { name: 'Faro', lat: 37.019, lng: -7.93 }, date: '2026-10-03',
    links: [{ title: 'Casa', url: 'https://example.com/casa' }],
  }, { imported: true });
  const obj = s.$defs.object;
  assert.ok(kept.title.length <= obj.properties.title.maxLength);
  assert.ok(kept.content.length <= obj.properties.content.maxLength);
  assert.ok(obj.properties.icon.enum.includes(kept.icon));
  assert.ok(obj.properties.kind.enum.includes(kept.kind));
  assert.match(kept.tags[0], new RegExp(obj.properties.tags.items.pattern));
  assert.match(kept.date, new RegExp(obj.properties.date.pattern));
  assert.match(kept.links[0].url, new RegExp(obj.properties.links.items.properties.url.pattern));
});

test('pasted answer: magpie blocks and a card block', () => {
  const three = readObjects(fixtures('three-magpie.txt'));
  assert.equal(three.objects.length, 3);
  assert.equal(three.objects[0].title, 'Casa do Largo');
  assert.equal(three.objects[1].title, 'Bar do Peixe');
  assert.equal(three.objects[2].title, 'Visa reminder');
  const one = readObjects(fixtures('one-card.txt'));
  assert.equal(one.objects.length, 1);
  assert.equal(one.objects[0].title, 'Old fence');
});

test('a magpie block holding an array of two', () => {
  const out = readObjects(fixtures('magpie-array.txt'));
  assert.equal(out.objects.length, 2);
  assert.equal(out.objects[0].title, 'First');
  assert.equal(out.objects[1].title, 'Second');
});

test('raw JSON: one object or an array', () => {
  const one = readObjects('{"title":"Solo","content":"One object."}');
  assert.equal(one.objects.length, 1);
  assert.equal(one.objects[0].title, 'Solo');
  const many = readObjects('[{"title":"A","content":"a"},{"title":"B","content":"b"},{"title":"C","content":"c"}]');
  assert.equal(many.objects.length, 3);
});

test('a file: format 1, refused when the version or list is wrong', () => {
  const ok = readObjects(fixtures('file-ok.json'));
  assert.equal(ok.objects.length, 2);
  assert.throws(() => readObjects('{"magpieObjects":2,"objects":[]}'), (e) => e instanceof FormatError && e.status === 400 && /format 2/.test(e.message));
  assert.throws(() => readObjects('{"magpieObjects":"1","objects":[]}'), (e) => /not a \.magpie-objects\.json file/.test(e.message));
  assert.throws(() => readObjects('{"magpieObjects":1}'), (e) => /no list of objects/.test(e.message));
});

test('UTF-16 with a byte order mark reads the same as UTF-8', () => {
  const text = fs.readFileSync(new URL('./fixtures/object-format/utf8-sample.json', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const utf8 = Buffer.from(text, 'utf8');
  const le = Buffer.alloc(2 + text.length * 2);
  le[0] = 0xff; le[1] = 0xfe;
  for (let i = 0; i < text.length; i += 1) le.writeUInt16LE(text.charCodeAt(i), 2 + i * 2);
  assert.equal(decodeBytes(utf8).replace(/\r\n/g, '\n'), decodeBytes(le).replace(/\r\n/g, '\n'));
  assert.deepEqual(readObjects(decodeBytes(le)).objects, readObjects(decodeBytes(utf8)).objects);
});

test('rendered view without fences, and braces with no title', () => {
  const out = readObjects(fixtures('rendered-view.txt'));
  assert.equal(out.objects.length, 2);
  assert.equal(out.objects[0].title, 'Hotel Nova');
  assert.equal(out.objects[1].title, 'Museum card');
  assert.throws(() => readObjects(fixtures('braces-no-title.txt')), (e) => /nothing in that could be read as objects/.test(e.message));
});

test('imported objects drop sources and set basis imported', () => {
  const out = readObjects('{"title":"T","content":"c","basis":"both","sources":[1]}');
  assert.equal(out.objects[0].basis, 'imported');
  assert.equal(out.objects[0].sources, undefined);
});

test('cleanObject without imported refuses a model basis of imported', () => {
  const a = cleanObject({ title: 'T', content: 'c', basis: 'imported' }, { count: 0 });
  assert.equal(a.basis, 'general');
  const b = cleanObject({ title: 'T', content: 'c', basis: 'imported' }, { count: 2 });
  assert.equal(b.basis, 'items');
});

test('links: http and https kept; the rest dropped', () => {
  const kept = cleanObject({
    title: 'T', content: 'c',
    links: [
      { title: 'ok', url: 'https://a.example/x' },
      { url: 'http://plain.example' },
      { url: 'javascript:1' },
      { url: 'data:text/plain,hi' },
      { url: 'ftp://files.example' },
      { url: 'https://u:p@a.example' },
      { url: 'https://example.com/' + 'x'.repeat(500) },
      { title: 'sixth', url: 'https://sixth.example' },
    ],
  }, { imported: true });
  assert.deepEqual(kept.links, [
    { title: 'ok', url: 'https://a.example/x' },
    { title: 'plain.example', url: 'http://plain.example/' },
  ]);
});

test('title and content cuts, tags stripped, dropped reasons', () => {
  const long = cleanObject({ title: 't'.repeat(200), content: 'x'.repeat(5999) }, { imported: true });
  assert.equal(long.title.length, 80);
  assert.equal(long.content.length, 5999);
  const cut = cleanObject({ title: 'T', content: 'y'.repeat(6001) }, { imported: true });
  assert.equal(cut.content.length, 6000);
  const html = cleanObject({ title: 'T', content: 'a <script>bad</script> claim' }, { imported: true });
  assert.equal(html.content, 'a bad claim');
  const miss = readObjects('[{"content":"no title"},{"title":"No content"},{"title":"Ok","content":"yes"}]');
  assert.equal(miss.objects.length, 1);
  assert.deepEqual(miss.dropped, [
    { at: 1, why: 'it has no title' },
    { at: 2, why: 'it has no content' },
  ]);
});

test('caps: 50 kept, 200 candidates read', () => {
  const sixty = Array.from({ length: 60 }, (_, i) => ({ title: `T${i}`, content: 'c' }));
  const over = readObjects(JSON.stringify(sixty));
  assert.equal(over.objects.length, 50);
  assert.equal(over.over, 10);
  assert.equal(over.found, 60);
  const many = Array.from({ length: 250 }, (_, i) => ({ title: `T${i}`, content: 'c' }));
  const capped = readObjects(JSON.stringify(many));
  assert.equal(capped.found, MAX_IMPORT_CANDIDATES);
  assert.equal(capped.objects.length, MAX_IMPORT_OBJECTS);
  assert.equal(capped.over, MAX_IMPORT_CANDIDATES - MAX_IMPORT_OBJECTS);
});

test('empty and white space is refused', () => {
  assert.throws(() => readObjects(''), (e) => e.status === 400 && e.message === 'paste an answer or choose a file first');
  assert.throws(() => readObjects('   \n\t  '), (e) => e.message === 'paste an answer or choose a file first');
});

test('a block that is not JSON is dropped; others still come through', () => {
  const text = '```magpie\nnot json\n```\n```magpie\n{"title":"Ok","content":"yes"}\n```';
  const out = readObjects(text);
  assert.equal(out.objects.length, 1);
  assert.equal(out.objects[0].title, 'Ok');
  assert.deepEqual(out.dropped, [{ at: 1, why: 'not valid JSON' }]);
});

test('parseSummaries still reads a magpie block', () => {
  const out = parseSummaries('```magpie\n{"title":"T","content":"c"}\n```', 0);
  assert.equal(out.summaries.length, 1);
  assert.equal(out.summaries[0].title, 'T');
});

test('parseSummaries reads one fence holding an array', () => {
  const out = parseSummaries('```card\n[{"title":"A","content":"one"},{"title":"B","content":"two"}]\n```', 0);
  assert.equal(out.summaries.length, 2);
  assert.equal(out.summaries[0].title, 'A');
  assert.equal(out.summaries[1].title, 'B');
  assert.equal(out.text, '{{summary:0}}\n{{summary:1}}');
});

console.log(`check-object-format: OK (${n} checks)`);
