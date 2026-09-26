#!/usr/bin/env node
/*
 * check-assistant.mjs -- run Assistant's model (modules/assistant/src/assistant-lib.js) on its own: turning an AI reply into the
 * pieces to draw (as check-ai.mjs does the server side of the same {{summary:N}} markers), and what a kept answer asks a
 * note-shaped save action to keep.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const sdk = fs.readFileSync(new URL('../public/sdk/host.js', import.meta.url), 'utf8');
const win = { addEventListener() {}, location: { search: '' } };
win.parent = win;
new Function('window', 'document', sdk)(win, { createElement: (tag) => ({ tag }) }); // ready() adds the SDK's shared styles: a <style> stand-in
const geo = win.createHost({ call: async () => ({}), root: { appendChild() {} }, rootElement: {} }).host.util.geo;

const names = ['answerParts', 'keepInput', 'keptText', 'suggestionInput'];
const lib = new Function('geo', `${fs.readFileSync(new URL('../modules/assistant/src/assistant-lib.js', import.meta.url), 'utf8')}\nreturn { ${names.join(', ')} };`)(geo);

let n = 0;
const test = (name, fn) => { fn(); n += 1; };

test('an AI reply: summaries drawn in place, a stray marker never trusted', () => {
  assert.deepEqual(lib.answerParts('Before\n\n{{summary:0}}\n\nAfter', 1), [{ text: 'Before' }, { summary: 0 }, { text: 'After' }]);
  assert.deepEqual(lib.answerParts('Only text {{summary:5}} here', 1), [{ text: 'Only text {{summary:5}} here' }, { summary: 0 }]);
  assert.deepEqual(lib.answerParts('{{summary:0}} {{summary:0}}', 1), [{ summary: 0 }, { text: '{{summary:0}}' }]);
  assert.deepEqual(lib.answerParts('', 0), []);
});

test('keeping a card: a title, a body that reads the provenance, tags as one string, at most one ref', () => {
  const ref1 = { module: 'places', kind: 'place', id: 'p1' };
  const ref2 = { module: 'research', kind: 'note', id: 'n1' };
  const names_ = new Map([[ref1, 'The Pier'], [ref2, 'Hotel ideas']]);
  const label = (r) => names_.get(r) || '';

  // No question, no sources: just the content.
  assert.deepEqual(lib.keepInput({ title: 'Rome', content: 'A city in Italy.' }, '', label), { title: 'Rome', body: 'A city in Italy.', tags: '' });

  // A question and one source: the ref travels on (a live pointer), and its name reads in the body alongside what was asked.
  const oneCard = { title: 'Hotel', content: 'Near the station.', tags: ['hotel', 'lisbon'], sources: [ref1] };
  const kept1 = lib.keepInput(oneCard, 'Where is the hotel?', label);
  assert.equal(kept1.title, 'Hotel');
  assert.equal(kept1.tags, 'hotel, lisbon');
  assert.deepEqual(kept1.ref, ref1);
  assert.match(kept1.body, /Near the station\./);
  assert.match(kept1.body, /Asked: Where is the hotel\?/);
  assert.match(kept1.body, /From: The Pier/);

  // Two sources: no ref travels (the bus carries only one), but both names are folded into the body.
  const twoCard = { title: 'Compare', content: 'Both are close by.', sources: [ref1, ref2] };
  const kept2 = lib.keepInput(twoCard, '', label);
  assert.equal(kept2.ref, undefined);
  assert.match(kept2.body, /From: The Pier, Hotel ideas/);

  // A gone source names as nothing, so it is simply left out of "From:".
  const goneCard = { title: 'X', content: 'y', sources: [ref1, { module: 'places', kind: 'place', id: 'gone' }] };
  const keptGone = lib.keepInput(goneCard, '', () => '');
  assert.ok(!keptGone.body.includes('From:'));

  // A long or missing title falls back sensibly.
  assert.equal(lib.keepInput({ content: 'x' }, '', label).title, 'Untitled');
  assert.equal(lib.keepInput({ title: 'z'.repeat(200), content: 'x' }, '', label).title.length, 120);
});

test('kept text: an answer with no links keeps Asked and From, and never External source', () => {
  const ref1 = { module: 'places', kind: 'place', id: 'p1' };
  const summary = { title: 'Hotel', content: 'Near the station.', sources: [ref1] };
  const text = lib.keptText(summary, { question: 'Where is the hotel?', sourceNames: ['The Pier'] });
  assert.match(text, /Near the station\./);
  assert.match(text, /Asked: Where is the hotel\?/);
  assert.match(text, /From: The Pier/);
  assert.ok(!text.includes('External source'));
  assert.ok(!text.includes('Links:'));
  assert.equal(lib.keepInput(summary, 'Where is the hotel?', () => 'The Pier').body, text);
  assert.equal(lib.suggestionInput(summary, 'Where is the hotel?', () => 'The Pier').content, text);
});

test('kept text: an answer with two links lists them, and never External source', () => {
  const summary = {
    title: 'Walk',
    content: 'Along the river.',
    links: [{ title: 'Map', url: 'https://example.com/map' }, { title: 'Guide', url: 'http://example.com/guide' }],
  };
  const text = lib.keptText(summary, { question: 'What to see?', sourceNames: [] });
  assert.match(text, /Along the river\./);
  assert.match(text, /Asked: What to see\?/);
  assert.match(text, /^Links:$/m);
  assert.match(text, /^- Map: https:\/\/example.com\/map$/m);
  assert.match(text, /^- Guide: http:\/\/example.com\/guide$/m);
  assert.ok(!text.includes('External source'));
  assert.equal(lib.keepInput(summary, 'What to see?', () => '').body, text);
  assert.equal(lib.suggestionInput(summary, 'What to see?', () => '').content, text);
});

test('kept text: an imported object ends with External source and never Asked or From', () => {
  const summary = {
    title: 'Cafe',
    content: 'Open late.',
    basis: 'imported',
    links: [{ title: 'Menu', url: 'https://example.com/menu' }],
    sources: [{ module: 'places', kind: 'place', id: 'p1' }],
  };
  const text = lib.keptText(summary, { question: 'Where to eat?', sourceNames: ['The Pier'] });
  assert.match(text, /Open late\./);
  assert.ok(!text.includes('Asked:'));
  assert.ok(!text.includes('From:'));
  assert.match(text, /^- Menu: https:\/\/example.com\/menu$/m);
  assert.ok(text.endsWith('External source'));
  assert.equal(lib.keepInput(summary, 'Where to eat?', () => 'The Pier').body, text);
  assert.equal(lib.suggestionInput(summary, 'Where to eat?', () => 'The Pier').content, text);
});

test('kept text: 6000 characters and five long links stay at most 8000, with every link and External source whole', () => {
  const links = ['A', 'B', 'C', 'D', 'E'].map((title) => ({ title, url: `https://example.com/${'u'.repeat(481)}` }));
  const summary = { title: 'Long', content: 'x'.repeat(6000), basis: 'imported', links };
  const text = lib.keptText(summary, {});
  assert.ok(text.length <= 8000);
  assert.match(text, /…/);
  for (const l of links) {
    assert.ok(text.includes(`- ${l.title}: ${l.url}`), `missing whole link ${l.title}`);
  }
  assert.ok(text.endsWith('External source'));
  assert.equal(lib.keepInput(summary, '', () => '').body, text);
  assert.equal(lib.suggestionInput(summary, '', () => '').content, text);
});

console.log(`check-assistant: OK (${n} checks)`);
