/**
 * Pixel statistics on small grayscale crops: focus (sharpness), exposure,
 * and a perceptual hash for spotting near-duplicate shots. Pure functions over
 * typed arrays so they run identically in the browser and in Node tests.
 */

/** Rec. 601 luma (0–255) from RGBA bytes. */
export function lumaFromRGBA(rgba) {
  const n = rgba.length >> 2;
  const out = new Float32Array(n);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    out[j] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  }
  return out;
}

/**
 * Variance of the Laplacian: the standard "is it in focus?" measure. Sharp
 * edges give large second derivatives; blur flattens them toward zero.
 */
export function laplacianVariance(gray, w, h) {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Mean brightness plus the share of blown-out (≥250) and crushed (≤6) pixels. */
export function lumaSummary(gray) {
  let sum = 0;
  let high = 0;
  let low = 0;
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i];
    sum += v;
    if (v >= 250) high++;
    else if (v <= 6) low++;
  }
  const n = gray.length || 1;
  return { mean: sum / n, clipHigh: high / n, clipLow: low / n };
}

/** 64-bit difference hash of a 9×8 grayscale thumbnail, as 16 hex characters. */
export function dHash(gray9x8) {
  let hex = '';
  for (let y = 0; y < 8; y++) {
    let nibble = 0;
    for (let x = 0; x < 8; x++) {
      const bit = gray9x8[y * 9 + x] > gray9x8[y * 9 + x + 1] ? 1 : 0;
      nibble = (nibble << 1) | bit;
      if (x % 4 === 3) {
        hex += nibble.toString(16);
        nibble = 0;
      }
    }
  }
  return hex;
}

function popcount32(x) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Splits a hex hash into 32-bit words once, so many comparisons stay cheap. */
export function hashWords(hex) {
  const words = [];
  for (let i = 0; i < hex.length; i += 8) words.push(Number.parseInt(hex.slice(i, i + 8), 16) >>> 0);
  return words;
}

/** Number of differing bits between two hashes already split with hashWords(). */
export function hammingWords(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += popcount32((a[i] ^ b[i]) >>> 0);
  return d;
}

/** Number of differing bits between two equal-length hex hashes. */
export function hammingHex(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  return hammingWords(hashWords(a), hashWords(b));
}
