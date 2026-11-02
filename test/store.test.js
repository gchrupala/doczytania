import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/store.js';

const T0 = new Date(2026, 10, 2, 12, 0, 0).getTime();
const min = (n) => T0 + n * 60000;
let seq = 0;
const rnd = () => ((seq = (seq + 0.137) % 1), seq);

test('tracking parameters go, real ones stay', () => {
  assert.equal(
    S.cleanUrl('https://example.com/a?utm_source=x&id=5&fbclid=abc#:~:text=foo'),
    'https://example.com/a?id=5',
  );
  assert.equal(S.cleanUrl('https://youtu.be/abc?si=XYZ'), 'https://youtu.be/abc');
  assert.equal(S.cleanUrl('https://example.com/search?s=word'), 'https://example.com/search?s=word');
  assert.equal(S.cleanUrl('https://example.com/a?utm_medium=x'), 'https://example.com/a');
  assert.equal(S.cleanUrl('ftp://example.com/a'), null);
  assert.equal(S.cleanUrl('nie link'), null);
  assert.equal(S.cleanUrl('https://intranet/a'), null);
});

test('the same link under different spellings has one key', () => {
  const k = S.urlKey('https://www.example.com/post/?b=2&a=1#comments');
  assert.equal(k, 'example.com/post?a=1&b=2');
  assert.equal(S.urlKey('http://example.com/post?a=1&b=2&utm_source=t'), k);
  assert.equal(S.urlKey('https://m.example.com/post?a=1&b=2'), k);
  assert.notEqual(S.urlKey('https://example.com/post2'), k);
});

test('shared text from Android apps gives an address and a title', () => {
  assert.deepEqual(S.extractShared({ text: 'Ciekawy tekst https://example.com/a?utm_source=share' }), {
    url: 'https://example.com/a',
    title: 'Ciekawy tekst',
  });
  assert.deepEqual(S.extractShared({ title: 'Tytuł', text: 'https://example.com/b.' }), {
    url: 'https://example.com/b',
    title: 'Tytuł',
  });
  assert.deepEqual(S.extractShared({ url: 'https://example.com/c', text: 'https://example.com/c' }), {
    url: 'https://example.com/c',
    title: '',
  });
  assert.equal(S.extractShared({ text: 'sam tekst bez linku' }), null);
  assert.equal(S.extractShared({}), null);
});

test('kinds are guessed from the address', () => {
  assert.equal(S.guessKind('https://www.youtube.com/watch?v=1'), 'video');
  assert.equal(S.guessKind('https://arxiv.org/abs/2401.00001'), 'paper');
  assert.equal(S.guessKind('https://aclanthology.org/2024.acl-long.1.pdf'), 'paper');
  assert.equal(S.guessKind('https://example.org/files/report.pdf'), 'pdf');
  assert.equal(S.guessKind('https://someone.substack.com/p/x'), 'blog');
  assert.equal(S.guessKind('https://example.com/blog/hello'), 'blog');
  assert.equal(S.guessKind('https://open.spotify.com/episode/abc'), 'podcast');
  assert.equal(S.guessKind('https://bsky.app/profile/a/post/b'), 'thread');
  assert.equal(S.guessKind('https://www.theguardian.com/world/x'), 'article');
  assert.equal(S.guessKind('https://example.com/x', { kind: 'video' }), 'video');
  assert.equal(S.kindOf({ url: 'https://arxiv.org/abs/1', kind: 'blog' }), 'blog');
});

test('tags: commas or spaces, no hash, no duplicates, lower case', () => {
  assert.deepEqual(S.parseTags('Uczenie maszynowe, #NLP, nlp'), ['uczenie maszynowe', 'nlp']);
  assert.deepEqual(S.parseTags('#AI  mowa'), ['ai', 'mowa']);
  assert.deepEqual(S.parseTags(['A', ' a ', '']), ['a']);
  assert.deepEqual(S.parseTags(''), []);
});

test('adding a link twice keeps one and brings it back to unread', () => {
  const doc = S.emptyDoc();
  const first = S.addItem(doc, { url: 'https://example.com/a?utm_source=x', tags: 'nlp' }, min(0), rnd);
  assert.equal(first.existed, false);
  assert.equal(first.item.url, 'https://example.com/a');
  S.toggleRead(doc, first.item.id, min(1));
  assert.equal(doc.items[0].status, 'read');
  assert.equal(doc.items[0].readAt, min(1));
  const again = S.addItem(doc, { url: 'https://www.example.com/a/', title: 'A', tags: 'ai' }, min(2), rnd);
  assert.equal(again.existed, true);
  assert.equal(doc.items.length, 1);
  assert.equal(doc.items[0].status, 'unread');
  assert.equal(doc.items[0].readAt, null);
  assert.equal(doc.items[0].title, 'A');
  assert.deepEqual(doc.items[0].tags, ['nlp', 'ai']);
  assert.equal(S.addItem(doc, { url: 'nie link' }, min(3), rnd), null);
});

test('updates stamp updatedAt only when something changed', () => {
  const doc = S.emptyDoc();
  const { item } = S.addItem(doc, { url: 'https://example.com/a' }, min(0), rnd);
  S.updateItem(doc, item.id, { title: '' }, min(5));
  assert.equal(item.updatedAt, min(0));
  S.updateItem(doc, item.id, { title: 'Nowy', tags: 'x, y' }, min(5));
  assert.equal(item.updatedAt, min(5));
  assert.deepEqual(item.tags, ['x', 'y']);
  item.meta = { fetchedAt: min(6), title: 'Strona' };
  S.updateItem(doc, item.id, { url: 'https://example.com/b' }, min(7));
  assert.equal(item.meta, undefined);
});

test('search ignores case and Polish accents, and understands #tags', () => {
  const doc = S.emptyDoc();
  S.addItem(doc, { url: 'https://example.com/lodz', title: 'Spacer po Łodzi', tags: 'miasta' }, min(0), rnd);
  S.addItem(doc, { url: 'https://arxiv.org/abs/1', title: 'Attention is all you need', tags: 'nlp' }, min(1), rnd);
  const third = S.addItem(doc, { url: 'https://example.com/z' }, min(2), rnd).item;
  third.meta = { fetchedAt: min(3), title: 'Żółta łódź', description: 'O transformerach', excerpt: 'Długi tekst' };
  const titles = (opts) => S.filterItems(doc.items, opts).map(S.titleOf);
  assert.deepEqual(titles({ query: 'lodz' }), ['Żółta łódź', 'Spacer po Łodzi']);
  assert.deepEqual(titles({ query: 'ŁÓDŹ żółta' }), ['Żółta łódź']);
  assert.deepEqual(titles({ query: 'transformer' }), ['Żółta łódź']);
  assert.deepEqual(titles({ query: '#nlp' }), ['Attention is all you need']);
  assert.deepEqual(titles({ tag: 'miasta' }), ['Spacer po Łodzi']);
  assert.deepEqual(titles({ kind: 'paper' }), ['Attention is all you need']);
  S.toggleRead(doc, doc.items[0].id, min(10));
  assert.deepEqual(titles({ status: 'read' }), ['Spacer po Łodzi']);
  assert.equal(S.filterItems(doc.items, { status: 'unread' }).length, 2);
  assert.deepEqual(S.tagCounts(doc.items), [['miasta', 1], ['nlp', 1]]);
  assert.deepEqual(S.kindCounts(doc.items), [['article', 2], ['paper', 1]]);
});

test('parseDoc drops broken items and tombstoned ones', () => {
  const doc = S.parseDoc({
    items: [
      { id: 'a', url: 'https://example.com/a', status: 'read', readAt: 5, addedAt: 1, updatedAt: 5, tags: ['X'] },
      { id: 'b', url: 'javascript:alert(1)' },
      { id: 'c', url: 'https://example.com/c' },
      { id: 'a', url: 'https://example.com/dup' },
      { url: 'https://example.com/noid' },
    ],
    tombstones: { c: 10, bad: 'x' },
  });
  assert.deepEqual(
    doc.items.map((i) => [i.id, i.status, i.tags]),
    [['a', 'read', ['x']]],
  );
  assert.deepEqual(doc.tombstones, { c: 10 });
  assert.equal(S.parseDoc({ machines: [] }), null);
  assert.equal(S.parseDoc(null), null);
});

function twoDevices() {
  const phone = S.emptyDoc();
  S.addItem(phone, { url: 'https://example.com/a', tags: 'nlp' }, min(0), rnd);
  const laptop = S.mergeDocs(S.emptyDoc(), phone);
  return { phone, laptop };
}

test('merging keeps links from both devices and the newer edit', () => {
  const { phone, laptop } = twoDevices();
  const id = phone.items[0].id;
  S.updateItem(phone, id, { title: 'Z telefonu' }, min(5));
  S.updateItem(laptop, id, { title: 'Z laptopa' }, min(6));
  S.addItem(laptop, { url: 'https://example.com/b' }, min(7), rnd);
  const m1 = S.mergeDocs(phone, laptop);
  const m2 = S.mergeDocs(laptop, phone);
  assert.equal(S.stableJson(m1), S.stableJson(m2));
  assert.equal(m1.items.length, 2);
  assert.equal(m1.items.find((i) => i.id === id).title, 'Z laptopa');
});

test('deleted links stay deleted after merging', () => {
  const { phone, laptop } = twoDevices();
  const id = phone.items[0].id;
  S.deleteItem(phone, id, min(5));
  S.updateItem(laptop, id, { title: 'Edycja' }, min(6));
  const m = S.mergeDocs(laptop, phone);
  assert.equal(m.items.length, 0);
  assert.equal(m.tombstones[id], min(5));
});

test('page data from the Action survive a later edit on a device', () => {
  const { phone, laptop } = twoDevices();
  const id = phone.items[0].id;
  // The Action filled in the page data in the repository copy.
  const repo = structuredClone(phone);
  repo.items[0].meta = { fetchedAt: min(2), title: 'Strona', words: 1100 };
  // Meanwhile the laptop marked it read.
  S.toggleRead(laptop, id, min(3));
  const m = S.mergeDocs(laptop, repo);
  assert.equal(m.items[0].status, 'read');
  assert.equal(m.items[0].meta.title, 'Strona');
  assert.equal(S.readingMinutes(m.items[0]), 5);
});

test('the same address saved on two devices becomes one link', () => {
  const phone = S.emptyDoc();
  const laptop = S.emptyDoc();
  const a = S.addItem(phone, { url: 'https://example.com/x', tags: 'a', note: 'z telefonu' }, min(0), rnd).item;
  const b = S.addItem(laptop, { url: 'https://www.example.com/x/', tags: 'b' }, min(1), rnd).item;
  const m1 = S.mergeDocs(phone, laptop);
  const m2 = S.mergeDocs(laptop, phone);
  assert.equal(S.stableJson(m1), S.stableJson(m2));
  assert.equal(m1.items.length, 1);
  assert.equal(m1.items[0].id, a.id);
  assert.deepEqual(m1.items[0].tags, ['a', 'b']);
  assert.equal(m1.items[0].note, 'z telefonu');
  assert.ok(b.id in m1.tombstones);
  // Merging again changes nothing.
  assert.equal(S.stableJson(S.mergeDocs(m1, phone)), S.stableJson(m1));
});

test('renaming and removing tags', () => {
  const doc = S.emptyDoc();
  S.addItem(doc, { url: 'https://example.com/1', tags: 'ml, nlp' }, min(0), rnd);
  S.addItem(doc, { url: 'https://example.com/2', tags: 'ml' }, min(0), rnd);
  assert.equal(S.renameTag(doc, 'ml', 'Uczenie maszynowe', min(1)), 2);
  assert.deepEqual(doc.items.map((i) => i.tags), [['uczenie maszynowe', 'nlp'], ['uczenie maszynowe']]);
  S.renameTag(doc, 'nlp', '', min(2));
  assert.deepEqual(doc.items[0].tags, ['uczenie maszynowe']);
});
