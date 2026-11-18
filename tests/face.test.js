import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeFace,
  classifyEyes,
  classifySmile,
  expressionTension,
  gazeOffset,
  headPoseFromMatrix,
  pickMainFace,
} from '../js/lib/face.js';
import { I3, Rx, Ry, faceLandmarks, matrix, rad } from './helpers.js';

const close = (actual, expected, tol = 0.5) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected} ± ${tol}, got ${actual}`);

test('frontal face straight in front of the camera: no elevation, no turn', () => {
  const pose = headPoseFromMatrix(matrix(I3, [0, 0, -50]));
  close(pose.elevation, 0);
  close(pose.azimuth, 0);
});

test('chin tucked down 15° reads as the camera being 15° above (flattering side)', () => {
  close(headPoseFromMatrix(matrix(Rx(rad(15)), [0, 0, -50])).elevation, 15);
});

test('chin raised 15° reads as the camera being below', () => {
  close(headPoseFromMatrix(matrix(Rx(rad(-15)), [0, 0, -50])).elevation, -15);
});

test('head turned 30° gives a 30° azimuth', () => {
  close(Math.abs(headPoseFromMatrix(matrix(Ry(rad(30)), [0, 0, -50])).azimuth), 30);
});

test('a level face high in a wide frame is seen from below (uses face→camera direction)', () => {
  const pose = headPoseFromMatrix(matrix(I3, [0, 20, -50]));
  close(pose.elevation, -21.8, 0.2);
});

test('row-major matrices are detected and give the same answer', () => {
  const col = headPoseFromMatrix(matrix(Rx(rad(12)), [3, -4, -60]));
  const row = headPoseFromMatrix(matrix(Rx(rad(12)), [3, -4, -60], { rowMajor: true }));
  close(row.elevation, col.elevation, 1e-9);
  close(row.azimuth, col.azimuth, 1e-9);
});

test('missing or malformed matrix returns null', () => {
  assert.equal(headPoseFromMatrix(null), null);
  assert.equal(headPoseFromMatrix({ data: [1, 2, 3] }), null);
});

test('eyes: open, half, closed; a big smile is not mistaken for a blink', () => {
  assert.equal(classifyEyes({ earLeft: 0.3, earRight: 0.28 }), 'open');
  assert.equal(classifyEyes({ earLeft: 0.3, earRight: 0.15 }), 'half');
  assert.equal(classifyEyes({ earLeft: 0.05, earRight: 0.06, blinkLeft: 0.9, blinkRight: 0.9 }), 'closed');
  // Duchenne smile: narrowed eyes, raised blink scores
  assert.equal(classifyEyes({ earLeft: 0.15, earRight: 0.16, blinkLeft: 0.6, blinkRight: 0.55, smile: 0.8 }), 'open');
});

test('expression tension: scowls score high, neutral faces and real smiles stay low', () => {
  // Values measured from real sample photos in the browser.
  assert.ok(expressionTension({ browDownLeft: 0.46, browDownRight: 0.48 }, 0) > 0.4); // angry
  assert.ok(expressionTension({ browInnerUp: 0.16, eyeSquintLeft: 0.18, eyeSquintRight: 0.17 }, 0) < 0.2); // neutral
  // A big smile squints the eyes; that must not count as tension.
  assert.ok(expressionTension({ eyeSquintLeft: 0.7, eyeSquintRight: 0.7 }, 0.8) < 0.1);
  assert.equal(expressionTension({}, 0), 0);
});

test('smile classes', () => {
  assert.equal(classifySmile(0.05), 'serious');
  assert.equal(classifySmile(0.35), 'soft');
  assert.equal(classifySmile(0.85), 'big');
});

test('gaze: eyes rotated toward the camera count as eye contact', () => {
  // Camera 20° toward the subject's left; eyes rotated that way.
  const looking = gazeOffset({ eyeLookOutLeft: 0.57, eyeLookInRight: 0.57 }, { elevation: 0, azimuth: 20 });
  assert.ok(looking.contact, `error ${looking.error}`);
  // Same head pose, eyes straight ahead (along the face): not at the camera.
  const away = gazeOffset({}, { elevation: 0, azimuth: 20 });
  assert.equal(away.contact, false);
  assert.equal(gazeOffset({}, null), null);
});

test('analyzeFace measures a level, frontal, open-eyed face', () => {
  const face = analyzeFace(
    {
      landmarks: faceLandmarks(),
      blendshapes: [
        { categoryName: 'mouthSmileLeft', score: 0.5 },
        { categoryName: 'mouthSmileRight', score: 0.5 },
      ],
      matrix: matrix(Rx(rad(10)), [0, 0, -50]),
    },
    { width: 1000, height: 1000 },
  );
  close(face.roll, 0);
  close(face.pose.elevation, 10);
  assert.equal(face.eyes.state, 'open');
  assert.equal(face.smileClass, 'soft');
  close(face.faceLengthPx, 470, 1);
  assert.equal(face.cutOff, false);
});

test('a face running off the frame edge is flagged as cut off', () => {
  const face = analyzeFace(
    { landmarks: faceLandmarks({ 10: [0.5, -0.02] }), blendshapes: [], matrix: null },
    { width: 1000, height: 1000 },
  );
  assert.equal(face.cutOff, true);
  assert.equal(face.pose, null);
});

test('the largest face is treated as the subject', () => {
  const small = { landmarks: [{ x: 0.1, y: 0.1 }, { x: 0.15, y: 0.16 }] };
  const big = { landmarks: [{ x: 0.4, y: 0.3 }, { x: 0.7, y: 0.7 }] };
  assert.equal(pickMainFace([small, big]), big);
  assert.equal(pickMainFace([]), null);
});
