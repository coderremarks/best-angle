/**
 * Turns raw MediaPipe Face Landmarker output into human-meaningful face
 * measurements: where the camera is relative to the face, eye state, smile,
 * gaze and framing. Pure functions: no DOM, unit-tested in Node.
 */
import { dot3, normalize3, pxDist, toDeg } from './math.js';

/** MediaPipe Face Mesh landmark indices (478-point model). "Left"/"right" = the subject's. */
export const FACE_LM = Object.freeze({
  noseTip: 1,
  foreheadTop: 10,
  chin: 152,
  upperLip: 0,
  rightEyeOuter: 33,
  rightEyeInner: 133,
  rightEyeUpper: 159,
  rightEyeLower: 145,
  leftEyeOuter: 263,
  leftEyeInner: 362,
  leftEyeUpper: 386,
  leftEyeLower: 374,
  rightCheek: 50,
  leftCheek: 280,
});

/** Eyes + brows: the region checked for focus (sharp eyes matter most in a portrait). */
export const EYE_REGION = Object.freeze([
  33, 133, 159, 145, 263, 362, 386, 374, // eye corners and lids
  70, 63, 105, 66, 107, 300, 293, 334, 296, 336, // brows
]);

/** Degrees of eye rotation per unit of MediaPipe's eyeLook* blendshapes. */
const EYE_YAW_RANGE = 35;
const EYE_PITCH_RANGE = 25;

/** Bounding box (normalized coordinates) of all landmarks, or of a subset. */
export function boundingBox(landmarks, indices = null) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const points = indices ? indices.map((i) => landmarks[i]) : landmarks;
  for (const p of points) {
    if (!p) continue;
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

/**
 * Reads MediaPipe's 4×4 facial transformation matrix (canonical face model →
 * camera space: x right, y up, camera at the origin looking down −z) and
 * works out where the camera sits *relative to the face*, in degrees:
 *   elevation > 0  camera above the face's eye line (a "high angle"; also what
 *                  tucking the chin slightly does), < 0 camera below
 *   azimuth        how far the face is turned from the camera (sign = side;
 *                  positive = camera toward the subject's left)
 * Using the face→camera direction (not just the head rotation) means a face
 * near the top of a wide shot is correctly seen as "shot from below".
 */
export function headPoseFromMatrix(matrix) {
  const d = matrix?.data;
  if (!d || d.length !== 16) return null;
  // MediaPipe packs matrices column-major; detect the layout from where the translation lives.
  const colMajor =
    Math.abs(d[12]) + Math.abs(d[13]) + Math.abs(d[14]) >= Math.abs(d[3]) + Math.abs(d[7]) + Math.abs(d[11]);
  const at = (r, c) => (colMajor ? d[c * 4 + r] : d[r * 4 + c]);
  const axis = (c) => normalize3([at(0, c), at(1, c), at(2, c)]);
  const right = axis(0);
  const up = axis(1);
  const forward = axis(2);
  const t = [at(0, 3), at(1, 3), at(2, 3)];
  // Direction from the face to the camera. If the translation looks unusable, assume on-axis.
  const toCamera = t[2] < -1e-6 ? normalize3([-t[0], -t[1], -t[2]]) : [0, 0, 1];
  const vx = dot3(toCamera, right);
  const vy = dot3(toCamera, up);
  const vz = dot3(toCamera, forward);
  if (vz <= 0) return null; // camera behind the face: not a usable estimate
  return {
    elevation: toDeg(Math.atan2(vy, vz)),
    azimuth: toDeg(Math.atan2(vx, vz)),
  };
}

/** In-image head tilt from the line between the outer eye corners (degrees, 0 = level). */
export function headRoll(landmarks, w, h) {
  const r = landmarks[FACE_LM.rightEyeOuter];
  const l = landmarks[FACE_LM.leftEyeOuter];
  return toDeg(Math.atan2((l.y - r.y) * h, (l.x - r.x) * w));
}

/** Eye aspect ratio: lid gap ÷ eye width. Open eyes ≈ 0.25–0.35, closed < 0.1. */
export function eyeOpenness(landmarks, w, h, side) {
  const L = FACE_LM;
  const [outer, inner, upper, lower] =
    side === 'left'
      ? [L.leftEyeOuter, L.leftEyeInner, L.leftEyeUpper, L.leftEyeLower]
      : [L.rightEyeOuter, L.rightEyeInner, L.rightEyeUpper, L.rightEyeLower];
  const width = pxDist(landmarks[outer], landmarks[inner], w, h);
  return width > 0 ? pxDist(landmarks[upper], landmarks[lower], w, h) / width : 0;
}

export function blendshapeMap(categories = []) {
  const map = {};
  for (const c of categories) map[c.categoryName] = c.score;
  return map;
}

/**
 * 'open' | 'half' | 'closed', judged on the *less* open eye (a wink ruins a
 * photo too). A big real smile narrows the eyes, so thresholds relax when
 * smiling — otherwise genuine smiles would be punished as "half closed".
 */
export function classifyEyes({ earLeft, earRight, blinkLeft = 0, blinkRight = 0, smile = 0 }) {
  const ear = Math.min(earLeft, earRight);
  const blink = Math.max(blinkLeft, blinkRight);
  const smiling = smile >= 0.5;
  const closedEar = smiling ? 0.09 : 0.12;
  const halfEar = smiling ? 0.13 : 0.18;
  if (ear < closedEar || (blink > 0.75 && ear < halfEar)) return 'closed';
  if (ear < halfEar || (!smiling && blink > 0.55)) return 'half';
  return 'open';
}

export function classifySmile(smile) {
  if (smile >= 0.6) return 'big';
  if (smile >= 0.2) return 'soft';
  return 'serious';
}

/**
 * 0–1 "tension": frowning, brows pulled down, sneering or a worried brow.
 * Squinting only counts without a smile (a real smile squints the eyes too).
 * Neutral faces sit around 0–0.2; a scowl is 0.4+.
 */
export function expressionTension(bs, smile) {
  const avg = (a, b) => ((bs[a] ?? 0) + (bs[b] ?? 0)) / 2;
  return Math.max(
    avg('browDownLeft', 'browDownRight'),
    avg('mouthFrownLeft', 'mouthFrownRight'),
    avg('noseSneerLeft', 'noseSneerRight'),
    0.6 * (bs.browInnerUp ?? 0),
    smile >= 0.3 ? 0 : avg('eyeSquintLeft', 'eyeSquintRight') - 0.15,
  );
}

/**
 * Gaze relative to the lens, in degrees (0, 0 = looking straight into it).
 * Combines head pose (where the camera is) with eye rotation from the
 * eyeLook* blendshapes (MediaPipe reports these for the subject's own left/right).
 */
export function gazeOffset(bs, pose) {
  if (!pose) return null;
  const g = (k) => bs[k] ?? 0;
  const towardSubjectsLeft = (g('eyeLookOutLeft') + g('eyeLookInRight') - g('eyeLookInLeft') - g('eyeLookOutRight')) / 2;
  const up = (g('eyeLookUpLeft') + g('eyeLookUpRight') - g('eyeLookDownLeft') - g('eyeLookDownRight')) / 2;
  const horizontal = pose.azimuth - towardSubjectsLeft * EYE_YAW_RANGE;
  const vertical = pose.elevation - up * EYE_PITCH_RANGE;
  // Vertical eye estimates are noisier (lids move with expression), so they count for less.
  const error = Math.hypot(horizontal, vertical * 0.6);
  return { horizontal, vertical, error, contact: error < 14 };
}

/** Picks the most prominent face (largest area): in a set of selfies, that's you. */
export function pickMainFace(faces) {
  let best = null;
  let bestArea = -1;
  for (const f of faces) {
    const b = boundingBox(f.landmarks);
    const area = b.w * b.h;
    if (area > bestArea) {
      best = f;
      bestArea = area;
    }
  }
  return best;
}

/**
 * @param face  { landmarks, blendshapes, matrix } for one face (landmarks normalized to the full image)
 * @param size  { width, height } of the full image in pixels
 */
export function analyzeFace(face, { width: w, height: h }) {
  const { landmarks } = face;
  const L = FACE_LM;
  const bs = blendshapeMap(face.blendshapes);
  const box = boundingBox(landmarks);
  const pose = headPoseFromMatrix(face.matrix);
  const smile = ((bs.mouthSmileLeft ?? 0) + (bs.mouthSmileRight ?? 0)) / 2;
  const earLeft = eyeOpenness(landmarks, w, h, 'left');
  const earRight = eyeOpenness(landmarks, w, h, 'right');
  const eyeState = classifyEyes({
    earLeft,
    earRight,
    blinkLeft: bs.eyeBlinkLeft,
    blinkRight: bs.eyeBlinkRight,
    smile,
  });
  const margin = 0.004;
  return {
    box,
    pose,
    roll: headRoll(landmarks, w, h),
    smile,
    smileClass: classifySmile(smile),
    tension: expressionTension(bs, smile),
    jawOpen: bs.jawOpen ?? 0,
    eyes: { state: eyeState, earLeft, earRight },
    gaze: eyeState === 'closed' ? null : gazeOffset(bs, pose),
    faceLengthPx: pxDist(landmarks[L.foreheadTop], landmarks[L.chin], w, h),
    eyeLineY: (landmarks[L.rightEyeOuter].y + landmarks[L.leftEyeOuter].y) / 2,
    cutOff: box.x0 < margin || box.y0 < margin || box.x1 > 1 - margin || box.y1 > 1 - margin,
  };
}
