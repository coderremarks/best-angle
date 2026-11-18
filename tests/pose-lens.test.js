import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armsAgainstBody, bodyTurn, framingFromPose, resolveFraming } from '../js/lib/pose.js';
import { analyzeLens, lensClass } from '../js/lib/lens.js';
import { poseLandmarks } from './helpers.js';

// Subject facing the camera: their left shoulder (11) appears on the image right.
const torso = {
  0: [0.5, 0.2],
  11: [0.6, 0.35],
  12: [0.4, 0.35],
  23: [0.57, 0.65],
  24: [0.43, 0.65],
};

test('framing from visible landmarks', () => {
  assert.equal(framingFromPose(poseLandmarks({ ...torso, 27: [0.55, 0.95], 28: [0.45, 0.95] })), 'full');
  assert.equal(framingFromPose(poseLandmarks(torso)), 'half');
  assert.equal(framingFromPose(poseLandmarks({ 0: [0.5, 0.4], 11: [0.7, 0.9], 12: [0.3, 0.9] })), 'closeup');
  // Landmarks predicted outside the frame don't count.
  assert.equal(framingFromPose(poseLandmarks({ ...torso, 27: [0.55, 1.3], 28: [0.45, 1.3] })), 'half');
});

test('a tiny face overrides a pose that missed the hips', () => {
  assert.equal(resolveFraming('closeup', { h: 0.06 }), 'full');
  assert.equal(resolveFraming('closeup', { h: 0.35 }), 'closeup');
  assert.equal(resolveFraming(null, { h: 0.12 }), 'half');
  assert.equal(resolveFraming('full', { h: 0.4 }), 'full');
});

test('body turn from shoulder/hip depth difference', () => {
  const lm = poseLandmarks(torso);
  const square = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  square[11] = { x: 0.2, y: 0, z: 0 };
  square[12] = { x: -0.2, y: 0, z: 0 };
  assert.ok(bodyTurn(lm, square) < 1);

  const turned = structuredClone(square);
  turned[11] = { x: 0.14, y: 0, z: 0.14 }; // 45°
  turned[12] = { x: -0.14, y: 0, z: -0.14 };
  turned[23] = { x: 0.1, y: 0.5, z: 0.1 };
  turned[24] = { x: -0.1, y: 0.5, z: -0.1 };
  assert.ok(Math.abs(bodyTurn(lm, turned) - 45) < 1);
  assert.equal(bodyTurn(null, square), null);
});

test('arms: elbows tucked against the torso vs. held away', () => {
  const tucked = poseLandmarks({ ...torso, 13: [0.6, 0.5], 14: [0.4, 0.5] });
  assert.equal(armsAgainstBody(tucked, 1000, 1000).pressed, 2);

  const away = poseLandmarks({ ...torso, 13: [0.72, 0.5], 14: [0.28, 0.5] }); // hands on hips
  assert.equal(armsAgainstBody(away, 1000, 1000).pressed, 0);

  const raised = poseLandmarks({ ...torso, 13: [0.7, 0.33], 14: [0.4, 0.5] }); // one elbow up
  assert.equal(armsAgainstBody(raised, 1000, 1000).pressed, 1);

  assert.equal(armsAgainstBody(poseLandmarks({ 0: [0.5, 0.5] }), 1000, 1000), null);
});

test('lens classes', () => {
  assert.equal(lensClass(13), 'ultrawide');
  assert.equal(lensClass(26), 'wide');
  assert.equal(lensClass(50), 'normal');
  assert.equal(lensClass(77), 'tele');
  assert.equal(lensClass(null), null);
});

test('camera distance from focal length and face size', () => {
  // 26 mm-equivalent on a 4000×3000 image: focal ≈ 3004 px. A face 1500 px long ≈ 36 cm away (arm's length selfie).
  const face = { faceLengthPx: 1500, pose: { elevation: 0 }, box: { cx: 0.5, cy: 0.45 } };
  const near = analyzeLens({ FocalLengthIn35mmFormat: 26 }, 4000, 3000, face);
  assert.ok(near.distanceM > 0.3 && near.distanceM < 0.42, `got ${near.distanceM}`);
  // Same face size through a 77 mm lens means the camera is ~3× farther away.
  const far = analyzeLens({ FocalLengthIn35mmFormat: 77 }, 4000, 3000, face);
  assert.ok(far.distanceM > 1 && far.distanceM < 1.2, `got ${far.distanceM}`);
});

test('lens info degrades gracefully without EXIF', () => {
  const lens = analyzeLens({}, 1000, 1000, { faceLengthPx: 300, box: { cx: 0.9, cy: 0.9 } });
  assert.equal(lens.focal35, null);
  assert.equal(lens.distanceM, null);
  assert.ok(lens.edge > 0.75);
  assert.equal(analyzeLens(undefined, 100, 100, null).edge, null);
});

test('iPhone front camera is recognised from the lens model', () => {
  assert.equal(analyzeLens({ LensModel: 'iPhone 13 front camera 2.71mm f/2.2' }, 100, 100, null).frontCamera, true);
});
