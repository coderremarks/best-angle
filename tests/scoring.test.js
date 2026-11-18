import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISPLAY_CURVE, PRESETS, buildContext, computeFactors, scorePhoto } from '../js/lib/scoring.js';
import { deriveTags } from '../js/lib/tags.js';
import { curve } from '../js/lib/math.js';
import { metrics } from './helpers.js';

const { flattering, professional, quality } = PRESETS;
const score = (m, preset = flattering, ctx = {}) => scorePhoto(m, preset, ctx).score;

test('a well-taken photo scores high and says why', () => {
  const r = scorePhoto(metrics(), flattering, {});
  assert.ok(r.score >= 85, `score ${r.score}`);
  assert.deepEqual(r.flags, []);
  assert.ok(r.highlights.some((t) => /above eye level/.test(t)));
  assert.ok(r.highlights.length <= 4);
});

test('camera above eye level beats camera below', () => {
  const above = score(metrics({ face: { pose: { elevation: 12, azimuth: 20 } } }));
  const below = score(metrics({ face: { pose: { elevation: -15, azimuth: 20 } } }));
  assert.ok(above > below + 8, `above ${above}, below ${below}`);
  const tips = scorePhoto(metrics({ face: { pose: { elevation: -15, azimuth: 20 } } }), flattering).tips;
  assert.ok(tips.some((t) => /above eye level/.test(t)));
});

test('three-quarter face wins for "flattering", straight-on wins for "professional"', () => {
  const threeQuarter = metrics({ face: { pose: { elevation: 8, azimuth: 25 } } });
  const straight = metrics({ face: { pose: { elevation: 8, azimuth: 2 } } });
  assert.ok(score(threeQuarter, flattering) > score(straight, flattering));
  const turnedAway = metrics({ face: { pose: { elevation: 8, azimuth: 42 } } });
  assert.ok(score(straight, professional) > score(turnedAway, professional));
});

test('closed eyes are a deal-breaker that a great angle cannot outvote', () => {
  const r = scorePhoto(metrics({ face: { eyes: { state: 'closed' }, gaze: null } }), flattering);
  assert.ok(r.flags.includes('Eyes closed'));
  assert.ok(r.score < 50, `score ${r.score}`);
});

test('a turned body with arms off the sides beats square-on with arms pressed', () => {
  const turned = score(metrics({ framing: 'half', body: { framing: 'half', turn: 40, arms: { checked: 2, pressed: 0, gaps: [] } } }));
  const square = score(metrics({ framing: 'half', body: { framing: 'half', turn: 3, arms: { checked: 2, pressed: 2, gaps: [] } } }));
  assert.ok(turned > square + 5, `turned ${turned}, square ${square}`);
});

test('arm\'s-length wide-angle selfie loses to a photo from further away', () => {
  const selfie = metrics({ lens: { focal35: 26, distanceM: 0.35 } });
  const zoomed = metrics({ lens: { focal35: 52, distanceM: 1.6 } });
  assert.ok(score(zoomed) > score(selfie) + 5);
  assert.ok(scorePhoto(selfie, flattering).tips.some((t) => /Step back/.test(t)));
});

test('factors that cannot be measured are left out instead of guessed', () => {
  const f = computeFactors(metrics(), flattering, {});
  assert.equal(f.body, null); // no body visible
  assert.equal(f.lens, null); // no EXIF, centred face
  const noFace = scorePhoto(metrics({ face: null, faceCount: 0 }), flattering);
  assert.ok(noFace.flags.includes('No face found'));
  assert.ok(noFace.score < 45);
});

test('exposure is judged against your own photos, not a fixed brightness', () => {
  const ctx = buildContext([metrics(), metrics(), metrics({ light: { faceMean: 35 } })]);
  assert.equal(ctx.medianFaceLuma, 140);
  const dark = computeFactors(metrics({ light: { faceMean: 35, sceneMean: 200 } }), flattering, ctx).lighting;
  const normal = computeFactors(metrics(), flattering, ctx).lighting;
  assert.ok(normal.score > dark.score + 0.2);
  assert.ok(dark.bad.some((t) => /Backlit/.test(t)));
});

test('blurry eyes are flagged and pull the score down', () => {
  const sharp = scorePhoto(metrics(), quality);
  const blurry = scorePhoto(metrics({ sharpness: { value: 15 } }), quality);
  assert.ok(blurry.flags.includes('Blurry'));
  assert.ok(sharp.score - blurry.score > 25);
});

test('custom weights change the ranking', () => {
  const smiley = metrics({ face: { smile: 0.8, smileClass: 'big', pose: { elevation: -8, azimuth: 2 } } });
  const angled = metrics({ face: { smile: 0.05, smileClass: 'serious', pose: { elevation: 12, azimuth: 25 } } });
  const preset = PRESETS.dating;
  const anglesOnly = { ...preset.weights, expression: 0, angle: 3 };
  const smileOnly = { ...preset.weights, angle: 0, expression: 3 };
  assert.ok(scorePhoto(angled, preset, {}, anglesOnly).score > scorePhoto(smiley, preset, {}, anglesOnly).score);
  assert.ok(scorePhoto(smiley, preset, {}, smileOnly).score > scorePhoto(angled, preset, {}, smileOnly).score);
});

test('a scowl loses to the same photo with a relaxed face', () => {
  const relaxed = score(metrics({ face: { tension: 0.05 } }));
  const scowl = scorePhoto(metrics({ face: { tension: 0.47 } }), flattering);
  assert.ok(relaxed > scowl.score + 4, `relaxed ${relaxed}, scowl ${scowl.score}`);
  assert.ok(scowl.factors.expression.bad.some((t) => /Tense/.test(t)));
});

test('body angle matters less in a head-and-shoulders shot than in a full-length one', () => {
  const squareBody = { body: { turn: 2, arms: null } };
  const closeupDrop = score(metrics({ framing: 'closeup' })) - score(metrics({ framing: 'closeup', ...squareBody }));
  const fullDrop = score(metrics({ framing: 'full' })) - score(metrics({ framing: 'full', ...squareBody }));
  assert.ok(fullDrop > closeupDrop, `full ${fullDrop}, closeup ${closeupDrop}`);
});

test('displayed score is spread out but never reorders photos', () => {
  const raw = [0.55, 0.7, 0.8, 0.9, 0.95, 0.99];
  const shown = raw.map((v) => curve(v, DISPLAY_CURVE));
  for (let i = 1; i < shown.length; i++) assert.ok(shown[i] > shown[i - 1]);
  assert.ok(shown.at(-1) - shown[0] > 60, 'a 0.55–0.99 raw range should span 60+ display points');
});

test('people tag counts bodies too, so a group shot with one readable face is still "group"', () => {
  const tags = deriveTags(metrics({ faceCount: 1, personCount: 3 }), {});
  assert.ok(tags.has('people:group'));
  assert.ok(deriveTags(metrics({ faceCount: 1, personCount: 1 }), {}).has('people:solo'));
});

test('auto-tags describe the photo', () => {
  const tags = deriveTags(metrics(), {});
  for (const t of [
    'camera:from-above',
    'face-angle:three-quarter',
    'expression:soft-smile',
    'eyes:eye-contact',
    'people:solo',
    'orientation:portrait',
    'framing:closeup',
    'quality:eyes-open',
    'quality:sharp',
    'quality:slimming',
  ]) {
    assert.ok(tags.has(t), `missing ${t}`);
  }
  const below = deriveTags(metrics({ faceCount: 3, face: { pose: { elevation: -12, azimuth: 2 } } }), {});
  assert.ok(below.has('camera:from-below') && below.has('face-angle:front') && below.has('people:group'));
  assert.ok(!below.has('quality:slimming'));
});
