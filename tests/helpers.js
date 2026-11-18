/** Shared builders for the unit tests. */

export const rad = (deg) => (deg * Math.PI) / 180;

export const Rx = (a) => [
  [1, 0, 0],
  [0, Math.cos(a), -Math.sin(a)],
  [0, Math.sin(a), Math.cos(a)],
];
export const Ry = (a) => [
  [Math.cos(a), 0, Math.sin(a)],
  [0, 1, 0],
  [-Math.sin(a), 0, Math.cos(a)],
];
export const I3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/** 4×4 transform in MediaPipe's column-major layout (or row-major when asked). */
export function matrix(R, t, { rowMajor = false } = {}) {
  const d = new Array(16).fill(0);
  const set = (r, c, v) => {
    d[rowMajor ? r * 4 + c : c * 4 + r] = v;
  };
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) set(r, c, R[r][c]);
  set(0, 3, t[0]);
  set(1, 3, t[1]);
  set(2, 3, t[2]);
  set(3, 3, 1);
  return { rows: 4, columns: 4, data: d };
}

/** A complete, "good" measurement set; tests override just what they're about. */
export function metrics(overrides = {}) {
  const base = {
    width: 3000,
    height: 4000,
    faceCount: 1,
    framing: 'closeup',
    face: {
      box: { x0: 0.3, y0: 0.2, x1: 0.7, y1: 0.6, w: 0.4, h: 0.4, cx: 0.5, cy: 0.4 },
      pose: { elevation: 10, azimuth: 20 },
      roll: 2,
      smile: 0.4,
      smileClass: 'soft',
      jawOpen: 0.05,
      eyes: { state: 'open', earLeft: 0.3, earRight: 0.3 },
      gaze: { horizontal: 2, vertical: 3, error: 3, contact: true },
      faceLengthPx: 1500,
      eyeLineY: 0.35,
      cutOff: false,
    },
    body: null,
    lens: { focal35: null, lensClass: null, frontCamera: false, distanceM: null, edge: 0.1, takenAt: null, camera: null },
    sharpness: { value: 400, region: 'eyes' },
    light: { faceMean: 140, clipHigh: 0, clipLow: 0, cheekRatio: 1.1, sceneMean: 130 },
    hash: '0000000000000000',
  };
  return merge(base, overrides);
}

function merge(a, b) {
  if (b === null || typeof b !== 'object' || Array.isArray(b)) return b;
  if (a === null || typeof a !== 'object') return b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = merge(a[k], v);
  return out;
}

/** 478 face landmarks: a level, frontal face with open eyes on a 1000×1000 image. */
export function faceLandmarks(overrides = {}) {
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const set = {
    1: [0.5, 0.5],
    10: [0.5, 0.25],
    152: [0.5, 0.72],
    0: [0.5, 0.6],
    33: [0.4, 0.4],
    133: [0.46, 0.4],
    159: [0.43, 0.39],
    145: [0.43, 0.41],
    263: [0.6, 0.4],
    362: [0.54, 0.4],
    386: [0.57, 0.39],
    374: [0.57, 0.41],
    50: [0.42, 0.5],
    280: [0.58, 0.5],
    ...overrides,
  };
  for (const [i, [x, y]] of Object.entries(set)) lm[i] = { x, y, z: 0 };
  return lm;
}

/** 33 pose landmarks, all hidden unless set: { index: [x, y, visibility] }. */
export function poseLandmarks(points) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  for (const [i, [x, y, v = 0.99]] of Object.entries(points)) lm[i] = { x, y, z: 0, visibility: v };
  return lm;
}
