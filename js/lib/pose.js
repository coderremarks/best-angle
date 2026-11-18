/**
 * Body measurements from MediaPipe Pose Landmarker output: framing (close-up /
 * half / full body), how far the body is turned from the camera, and whether
 * the arms are pressed against the sides. It never estimates body size; it
 * only looks at pose, which is what actually changes how slim you look.
 */
import { pxDist, toDeg } from './math.js';

/** BlazePose landmark indices. "Left"/"right" = the subject's. */
export const POSE_LM = Object.freeze({
  nose: 0,
  leftEye: 2,
  rightEye: 5,
  leftEar: 7,
  rightEar: 8,
  mouthLeft: 9,
  mouthRight: 10,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
});

/** Bone pairs drawn in the detail view overlay. */
export const SKELETON = Object.freeze([
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
]);

/** Landmark is confidently visible and inside the frame. */
export function isSeen(p, minVisibility = 0.5) {
  return (
    !!p &&
    (p.visibility ?? 1) >= minVisibility &&
    p.x >= -0.01 && p.x <= 1.01 &&
    p.y >= -0.01 && p.y <= 1.01
  );
}

export function framingFromPose(lm) {
  if (!lm) return null;
  const P = POSE_LM;
  const any = (...ids) => ids.some((i) => isSeen(lm[i]));
  if (any(P.leftAnkle, P.rightAnkle, P.leftHeel, P.rightHeel)) return 'full';
  if (any(P.leftHip, P.rightHip)) return 'half';
  return 'closeup';
}

export function framingFromFace(faceBox) {
  if (!faceBox) return null;
  if (faceBox.h >= 0.2) return 'closeup';
  if (faceBox.h >= 0.08) return 'half';
  return 'full';
}

/** Pose wins when it clearly sees hips/feet; a small face overrides a pose that missed them. */
export function resolveFraming(poseFraming, faceBox) {
  const fromFace = framingFromFace(faceBox);
  if (poseFraming === 'full' || poseFraming === 'half') return poseFraming;
  if (poseFraming === 'closeup' && fromFace && fromFace !== 'closeup' && faceBox.h < 0.12) return fromFace;
  return poseFraming ?? fromFace;
}

/**
 * How far the torso is turned away from the camera, in degrees
 * (0 = square-on, 90 = side-on), from the depth difference between the
 * shoulders (and hips) in MediaPipe's metric world landmarks.
 */
export function bodyTurn(lm, world) {
  if (!lm || !world) return null;
  const P = POSE_LM;
  const pairs = [];
  if (isSeen(lm[P.leftShoulder], 0.3) && isSeen(lm[P.rightShoulder], 0.3)) {
    pairs.push([world[P.leftShoulder], world[P.rightShoulder], 2]);
  }
  if (isSeen(lm[P.leftHip], 0.3) && isSeen(lm[P.rightHip], 0.3)) {
    pairs.push([world[P.leftHip], world[P.rightHip], 1]);
  }
  let sum = 0;
  let weights = 0;
  for (const [a, b, weight] of pairs) {
    if (!a || !b) continue;
    sum += weight * toDeg(Math.atan2(Math.abs(a.z - b.z), Math.abs(a.x - b.x)));
    weights += weight;
  }
  return weights ? sum / weights : null;
}

/**
 * Checks each arm: is the elbow tucked against the side of the torso?
 * Arms pressed flat against the body widen the silhouette; a small gap keeps
 * the waist defined. Distances are relative to shoulder width, so the result
 * does not depend on image size or body size.
 */
export function armsAgainstBody(lm, w, h) {
  const P = POSE_LM;
  const ls = lm?.[P.leftShoulder];
  const rs = lm?.[P.rightShoulder];
  if (!isSeen(ls) || !isSeen(rs)) return null;
  const shoulderWidth = pxDist(ls, rs, w, h);
  if (shoulderWidth < 4) return null;
  const midX = ((ls.x + rs.x) / 2) * w;
  const sides = [
    [P.leftShoulder, P.leftElbow, P.leftHip],
    [P.rightShoulder, P.rightElbow, P.rightHip],
  ];
  const gaps = [];
  for (const [si, ei, hi] of sides) {
    const s = lm[si];
    const e = lm[ei];
    const hip = lm[hi];
    if (!isSeen(e) || !isSeen(hip, 0.3)) continue;
    const sx = s.x * w, sy = s.y * h;
    const dx = hip.x * w - sx, dy = hip.y * h - sy;
    const len = Math.hypot(dx, dy) || 1;
    const ex = e.x * w - sx, ey = e.y * h - sy;
    const along = (ex * dx + ey * dy) / (len * len);
    if (along < 0.15) {
      gaps.push(1); // elbow up near shoulder height: the arm is clearly away from the body
      continue;
    }
    // Unit normal to the shoulder→hip line, flipped to point away from the body's midline.
    let nx = dy / len;
    let ny = -dx / len;
    if ((sx - midX) * nx < 0) {
      nx = -nx;
      ny = -ny;
    }
    gaps.push((ex * nx + ey * ny) / shoulderWidth);
  }
  if (!gaps.length) return null;
  return { checked: gaps.length, pressed: gaps.filter((g) => g < 0.1).length, gaps };
}

/** Picks the detected person whose head is nearest the main face. */
export function pickPoseForFace(poses, faceBox) {
  if (!poses.length) return null;
  if (!faceBox) return poses[0];
  let best = poses[0];
  let bestD = Infinity;
  for (const p of poses) {
    const nose = p.landmarks[POSE_LM.nose];
    const d = Math.hypot(nose.x - faceBox.cx, nose.y - faceBox.cy);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

export function analyzeBody(pose, { width: w, height: h }) {
  if (!pose) return null;
  return {
    framing: framingFromPose(pose.landmarks),
    turn: bodyTurn(pose.landmarks, pose.worldLandmarks),
    arms: armsAgainstBody(pose.landmarks, w, h),
  };
}
