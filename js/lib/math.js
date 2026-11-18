/** Small numeric helpers shared by the analysis and scoring code. */

export const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const toDeg = (rad) => (rad * 180) / Math.PI;
export const lerp = (a, b, t) => a + (b - a) * t;

export function round(v, digits = 0) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/**
 * Piecewise-linear curve through [x, y] knots (x ascending), flat outside the
 * first/last knot. Every scoring rule in the app is written this way so it can
 * be read and tuned at a glance. Returns NaN for non-finite input so bugs
 * surface instead of silently scoring as "fine".
 */
export function curve(x, knots) {
  if (!Number.isFinite(x)) return NaN;
  if (x <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) {
    const [x1, y1] = knots[i];
    if (x <= x1) {
      const [x0, y0] = knots[i - 1];
      return x1 === x0 ? y1 : lerp(y0, y1, (x - x0) / (x1 - x0));
    }
  }
  return knots[knots.length - 1][1];
}

export function median(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function normalize3(v) {
  const n = Math.hypot(v[0], v[1], v[2]);
  return n > 0 ? [v[0] / n, v[1] / n, v[2] / n] : [0, 0, 0];
}

/** Distance in pixels between two normalized landmarks on a w×h image. */
export const pxDist = (a, b, w, h) => Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);
