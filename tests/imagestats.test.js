import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dHash, hammingHex, laplacianVariance, lumaFromRGBA, lumaSummary } from '../js/lib/imagestats.js';
import { curve, median } from '../js/lib/math.js';

function image(w, h, fn) {
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = fn(x, y);
  return g;
}

test('flat image has zero focus energy; sharp edges beat a soft gradient', () => {
  assert.equal(laplacianVariance(image(32, 32, () => 128), 32, 32), 0);
  const sharp = laplacianVariance(image(32, 32, (x, y) => (((x >> 2) + (y >> 2)) % 2 ? 255 : 0)), 32, 32);
  const soft = laplacianVariance(image(32, 32, (x) => x * 8), 32, 32);
  assert.ok(sharp > 1000 && soft < 1, `sharp ${sharp}, soft ${soft}`);
});

test('luma conversion and clipping counts', () => {
  const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 255, 255, 0, 0, 255]);
  const gray = lumaFromRGBA(rgba);
  assert.equal(gray.length, 4);
  const s = lumaSummary(gray);
  assert.equal(s.clipHigh, 0.25);
  assert.equal(s.clipLow, 0.25);
  assert.ok(Math.abs(gray[3] - 76.245) < 0.01);
});

test('difference hash: identical images match, inverted ones are far apart', () => {
  const ramp = image(9, 8, (x) => x * 20);
  const inverted = image(9, 8, (x) => 200 - x * 20);
  assert.equal(dHash(ramp), dHash(image(9, 8, (x) => x * 20)));
  assert.equal(dHash(ramp).length, 16);
  assert.equal(hammingHex(dHash(ramp), dHash(inverted)), 64);
});

test('hamming distance', () => {
  assert.equal(hammingHex('0000000000000000', '0000000000000000'), 0);
  assert.equal(hammingHex('0000000000000000', 'ffffffffffffffff'), 64);
  assert.equal(hammingHex('8000000000000001', '0000000000000000'), 2);
  assert.equal(hammingHex('00', '000'), Infinity);
});

test('curve interpolates and clamps', () => {
  const k = [[0, 0], [10, 1], [20, 0.5]];
  assert.equal(curve(-5, k), 0);
  assert.equal(curve(5, k), 0.5);
  assert.equal(curve(15, k), 0.75);
  assert.equal(curve(99, k), 0.5);
  assert.ok(Number.isNaN(curve(Number.NaN, k)));
});

test('median ignores non-numbers', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([Number.NaN, 5]), 5);
  assert.ok(Number.isNaN(median([])));
});
