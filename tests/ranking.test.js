import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildView, matchesFilters, similarSets, tagCounts, unmetGroups } from '../js/lib/ranking.js';

const item = (id, score, tags, extra = {}) => ({ id, order: Number(id.slice(1)), score, sharpness: 0.5, tags: new Set(tags), hasFace: true, ...extra });

test('tags in the same group are OR, different groups are AND', () => {
  const tags = new Set(['expression:big-smile', 'framing:full']);
  assert.ok(matchesFilters(tags, new Set(['expression:big-smile', 'expression:soft-smile'])));
  assert.ok(matchesFilters(tags, new Set(['expression:big-smile', 'framing:full'])));
  assert.ok(!matchesFilters(tags, new Set(['expression:big-smile', 'framing:closeup'])));
  assert.ok(matchesFilters(tags, new Set()));
});

test('"Must be" tags are all required', () => {
  const tags = new Set(['quality:sharp']);
  assert.ok(matchesFilters(tags, new Set(['quality:sharp'])));
  assert.ok(!matchesFilters(tags, new Set(['quality:sharp', 'quality:eyes-open'])));
  assert.deepEqual(unmetGroups(tags, new Set(['quality:sharp', 'quality:eyes-open'])).map((g) => g.id), ['quality']);
});

test('view: matches ranked by score, near-misses next, faceless photos apart', () => {
  const items = [
    item('p1', 70, ['expression:big-smile']),
    item('p2', 90, ['expression:big-smile']),
    item('p3', 95, ['expression:serious']),
    item('p4', 40, [], { hasFace: false }),
  ];
  const view = buildView(items, { selected: new Set(['expression:big-smile']) });
  assert.deepEqual(view.matches.map((i) => i.id), ['p2', 'p1']);
  assert.deepEqual(view.others.map((i) => i.id), ['p3']);
  assert.equal(view.unmet.get('p3')[0].id, 'expression');
  assert.deepEqual(view.noFace.map((i) => i.id), ['p4']);
});

test('ties go to the sharper photo, then upload order', () => {
  const view = buildView([item('p1', 80, []), item('p2', 80, [], { sharpness: 0.9 }), item('p3', 80, [])]);
  assert.deepEqual(view.matches.map((i) => i.id), ['p2', 'p1', 'p3']);
});

test('similar shots are grouped by hash and capture time', () => {
  const t = 1_700_000_000_000;
  const items = [
    { id: 'a', hash: 'ffff0000ffff0000', takenAt: t },
    { id: 'b', hash: 'ffff0000ffff0003', takenAt: t + 2000 }, // burst: 2 bits apart
    { id: 'c', hash: 'ffff0000ffff0001', takenAt: t + 3_600_000 }, // same look, an hour later
    { id: 'd', hash: '0000ffff0000ffff', takenAt: t + 1000 }, // different shot
  ];
  const setOf = similarSets(items);
  assert.equal(setOf.get('a'), setOf.get('b'));
  assert.ok(!setOf.has('c') && !setOf.has('d'));
});

test('"best of each set" keeps only the top shot of a burst', () => {
  const items = [item('p1', 60, []), item('p2', 85, []), item('p3', 70, [])];
  const setOf = new Map([['p1', 's'], ['p2', 's']]);
  const view = buildView(items, { setOf, bestOfSets: true });
  assert.deepEqual(view.matches.map((i) => i.id), ['p2', 'p3']);
  assert.deepEqual(view.duplicates.map((i) => i.id), ['p1']);
  assert.equal(view.setSizes.get('s'), 2);
  assert.equal(buildView(items, { setOf, bestOfSets: false }).matches.length, 3);
});

test('tag counts', () => {
  const counts = tagCounts([item('p1', 1, ['a', 'b']), item('p2', 1, ['a'])]);
  assert.equal(counts.get('a'), 2);
  assert.equal(counts.get('b'), 1);
});
