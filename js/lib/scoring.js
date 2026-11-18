/**
 * Scores a photo from its measurements. Each factor is a 0–1 score plus
 * plain-English notes ("why") and tips ("next time"); the overall score is a
 * weighted average whose weights come from the chosen goal preset.
 *
 * The "slimming" rules are standard portrait-photography technique — camera a
 * little above eye level, face and body turned from the lens, arms off the
 * body, no close-up wide-angle distortion — not a judgement of anyone's body.
 */
import { clamp, curve, median, round } from './math.js';

// ---- Scoring curves: [measurement, score] knots, linear in between. ---------------

/** Camera height relative to the eye line, degrees (+ = camera above, looking down). */
export const ELEVATION_CURVE = [[-25, 0.05], [-15, 0.2], [-6, 0.5], [0, 0.72], [4, 0.9], [8, 1], [20, 1], [32, 0.7], [45, 0.45]];
/** Face turn away from the lens, degrees. A three-quarter view slims the face. */
export const TURN_SLIMMING_CURVE = [[0, 0.6], [8, 0.72], [15, 0.95], [20, 1], [35, 1], [50, 0.8], [65, 0.6], [90, 0.5]];
/** Face turn for professional headshots, where facing the camera reads as confident. */
export const TURN_FRONTAL_CURVE = [[0, 1], [15, 1], [28, 0.85], [45, 0.6], [90, 0.4]];
export const ROLL_CURVE = [[0, 1], [8, 1], [15, 0.82], [25, 0.6], [45, 0.4]];
/** Torso turn from the camera, degrees. Square-on is the widest view of a body. */
export const BODY_TURN_CURVE = [[0, 0.5], [12, 0.65], [22, 0.92], [30, 1], [55, 1], [70, 0.88], [90, 0.8]];
/** Expression tension (frown, scowl, sneer) → how relaxed the face looks. */
export const TENSION_CURVE = [[0.2, 1], [0.32, 0.7], [0.5, 0.3]];
/**
 * Raw weighted average → the 0–100 score shown. Real photos mostly land
 * between 0.6 and 1.0, so this stretches that band out (it is monotonic, so
 * it never changes which photo ranks higher).
 */
export const DISPLAY_CURVE = [[0, 0], [0.4, 8], [0.6, 30], [0.75, 55], [0.85, 72], [0.92, 85], [0.97, 95], [1, 100]];
/** Camera-to-face distance, metres. Closer than ~1 m enlarges the nose and mid-face. */
export const DISTANCE_CURVE = [[0.25, 0.15], [0.4, 0.35], [0.6, 0.6], [0.9, 0.82], [1.3, 0.95], [1.8, 1]];
/** log10(variance of Laplacian) of the eye region. */
export const SHARPNESS_CURVE = [[1, 0.05], [1.6, 0.35], [2, 0.65], [2.4, 0.9], [2.7, 1]];
/** Gaze error from the lens, degrees. */
export const GAZE_CURVE = [[0, 1], [10, 1], [18, 0.7], [30, 0.35], [45, 0.2]];

// ---- Goals --------------------------------------------------------------------------

export const FACTORS = Object.freeze({
  angle: { label: 'Flattering angle', hint: 'Camera slightly above eye level, face turned a little, head level.' },
  body: { label: 'Slimming pose', hint: 'Body turned from the camera, arms not pressed against your sides.' },
  lens: { label: 'Natural proportions', hint: "Shot from far enough away that the lens doesn't distort your face." },
  expression: { label: 'Expression', hint: 'Eyes open, relaxed mouth, a smile that suits the goal.' },
  eyeContact: { label: 'Eye contact', hint: 'Looking into the lens.' },
  sharpness: { label: 'Sharp focus', hint: 'Eyes in crisp focus, no motion blur.' },
  lighting: { label: 'Lighting', hint: 'Face well exposed with soft, even light.' },
  framing: { label: 'Framing', hint: 'Whole face in frame, enough detail, good headroom.' },
});

export const PRESETS = Object.freeze({
  flattering: {
    label: 'Most flattering',
    description: 'Slimming angles first: camera a little above you, face and body turned, no wide-angle distortion.',
    weights: { angle: 3, body: 2.5, lens: 2, expression: 1.5, eyeContact: 0.5, sharpness: 1.5, lighting: 1.5, framing: 0.75 },
    faceTurn: 'slimming',
    smile: { serious: 0.85, soft: 1, big: 1 },
    framing: null,
  },
  professional: {
    label: 'Professional',
    description: 'LinkedIn, CV or work ID: eye contact, a soft smile, sharp and evenly lit head-and-shoulders.',
    weights: { angle: 1.5, body: 1, lens: 1.5, expression: 2, eyeContact: 3, sharpness: 2.5, lighting: 2.5, framing: 2 },
    faceTurn: 'frontal',
    smile: { serious: 0.75, soft: 1, big: 0.85 },
    framing: { closeup: 1, half: 0.8, full: 0.45 },
  },
  dating: {
    label: 'Dating profile',
    description: 'Warm and approachable: a real smile, eye contact and a flattering angle.',
    weights: { angle: 2.5, body: 2, lens: 1.5, expression: 2.5, eyeContact: 2, sharpness: 1.5, lighting: 2, framing: 1 },
    faceTurn: 'slimming',
    smile: { serious: 0.6, soft: 0.95, big: 1 },
    framing: null,
  },
  social: {
    label: 'Social media',
    description: 'Feed-ready: flattering angle and pose, great light, sharp.',
    weights: { angle: 2.5, body: 2.5, lens: 1.5, expression: 1.5, eyeContact: 0.75, sharpness: 1.5, lighting: 2.5, framing: 1 },
    faceTurn: 'slimming',
    smile: { serious: 0.9, soft: 1, big: 1 },
    framing: null,
  },
  quality: {
    label: 'Sharpest shot',
    description: 'Pure culling: the sharpest, best-exposed shot with your eyes open.',
    weights: { angle: 0.75, body: 0.5, lens: 0.5, expression: 2, eyeContact: 0.5, sharpness: 3, lighting: 2, framing: 1.5 },
    faceTurn: 'slimming',
    smile: { serious: 1, soft: 1, big: 1 },
    framing: null,
  },
});

// ---- Formatting -----------------------------------------------------------------------

const signedDeg = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))}°`;
const fmtDist = (m) => (m < 1 ? `${Math.round(m * 100)} cm` : `${round(m, 1)} m`);
const result = (score) => ({ score: clamp(score), good: [], bad: [], tips: [] });

// ---- Factors --------------------------------------------------------------------------

export function angleFactor(face, preset) {
  if (!face?.pose) return null;
  const e = face.pose.elevation;
  const turn = Math.abs(face.pose.azimuth);
  const roll = Math.abs(face.roll);
  const turnCurve = preset.faceTurn === 'frontal' ? TURN_FRONTAL_CURVE : TURN_SLIMMING_CURVE;
  const out = result(
    0.5 * curve(e, ELEVATION_CURVE) + 0.33 * curve(turn, turnCurve) + 0.17 * curve(roll, ROLL_CURVE),
  );

  if (e >= 4 && e <= 25) out.good.push(`Camera slightly above eye level (${signedDeg(e)}), the classic flattering angle`);
  else if (e > 25) {
    out.bad.push(`Camera high above you (${signedDeg(e)}), which can look forced`);
    out.tips.push('Bring the camera down a little: just above eye level is the sweet spot.');
  } else if (e < -5) {
    out.bad.push(`Camera below eye level (${signedDeg(e)}), which makes the jaw look wider and can add a double chin`);
    out.tips.push('Hold the camera slightly above eye level. Never shoot from below.');
  } else out.good.push('Camera at eye level');

  if (preset.faceTurn === 'frontal') {
    if (turn <= 20) out.good.push('Facing the camera: open and confident');
    else {
      out.bad.push(`Face turned ${Math.round(turn)}° away`);
      out.tips.push('For a work photo, face the camera and angle only your shoulders.');
    }
  } else if (turn >= 12 && turn <= 40) {
    out.good.push(`Face turned ${Math.round(turn)}°: a slimming three-quarter view`);
  } else if (turn < 12) {
    out.bad.push('Face straight-on to the camera (a slight turn is more slimming)');
    out.tips.push('Turn your face 15–30° away from the camera, then look back at the lens.');
  } else {
    out.bad.push(`Face turned ${Math.round(turn)}°, close to a side profile`);
  }

  if (roll > 15) {
    out.bad.push(`Head tilted ${Math.round(roll)}°`);
    out.tips.push('Keep your head closer to level: a slight tilt is fine, a big one looks off-balance.');
  }
  return out;
}

export function bodyFactor(body, framing = null) {
  if (!body) return null;
  let score = 0;
  let weight = 0;
  const out = result(0);
  const closeup = framing === 'closeup';
  if (body.turn != null) {
    score += 0.6 * curve(body.turn, BODY_TURN_CURVE);
    weight += 0.6;
    const turn = Math.round(body.turn);
    if (body.turn >= 20) {
      out.good.push(closeup ? `Shoulders angled about ${turn}°, a slimmer frame` : `Body angled about ${turn}° to the camera, slimmer than square-on`);
    } else {
      out.bad.push(closeup ? 'Shoulders square to the camera' : 'Body square-on to the camera (turning slims the silhouette)');
      out.tips.push(
        closeup
          ? 'Angle your shoulders 30–45° away from the camera and turn just your face back to it.'
          : 'Turn your body 30–45° away from the camera and face back toward it.',
      );
    }
  }
  // When the body is turned, the near arm overlaps the torso naturally; only judge arms when fairly square-on.
  if (body.arms && (body.turn == null || body.turn < 35)) {
    const { pressed } = body.arms;
    score += 0.4 * (pressed === 0 ? 1 : pressed === 1 ? 0.8 : 0.6);
    weight += 0.4;
    if (pressed === 0) out.good.push('Arms off your body, which keeps your waist defined');
    else {
      out.bad.push(pressed >= 2 ? 'Both arms pressed against your sides' : 'One arm pressed against your side');
      out.tips.push('Leave a small gap between your arms and waist. A hand on the hip works well.');
    }
  }
  if (!weight) return null;
  out.score = clamp(score / weight);
  return out;
}

export function lensFactor(lens, framing) {
  if (!lens) return null;
  let score = null;
  const out = result(0);
  if (lens.distanceM != null) {
    score = curve(lens.distanceM, DISTANCE_CURVE);
    if (lens.focal35 >= 50) score = Math.max(score, 0.95);
    if (lens.distanceM < 0.6) {
      out.bad.push(`Shot up close (~${fmtDist(lens.distanceM)}), which makes the nose and centre of the face look bigger`);
      out.tips.push("Step back and zoom in (2×) instead of shooting at arm's length.");
    } else if (score >= 0.8) out.good.push(`Shot from about ${fmtDist(lens.distanceM)}: natural face proportions`);
  } else if (lens.focal35 >= 50) {
    score = 0.95;
    out.good.push(`Zoom/portrait lens (${Math.round(lens.focal35)} mm), the most flattering for faces`);
  }
  // Wide lenses stretch whatever sits near the edges of the frame.
  const wide = lens.focal35 ? lens.focal35 < 30 : framing !== 'closeup';
  if (wide && lens.edge != null && lens.edge > 0.6) {
    const floor = lens.focal35 && lens.focal35 < 20 ? 0.55 : 0.8;
    score = (score ?? 0.9) * curve(lens.edge, [[0.6, 1], [1, floor]]);
    out.bad.push('Near the edge of a wide shot, where the lens stretches people');
    out.tips.push('In wide or group shots, stand near the middle of the frame.');
  }
  if (score == null) return null;
  out.score = clamp(score);
  return out;
}

export function expressionFactor(face, preset) {
  if (!face) return null;
  const eyes = face.eyes.state === 'open' ? 1 : face.eyes.state === 'half' ? 0.5 : 0.1;
  const midTalk = face.jawOpen > 0.3 && face.smile < 0.25;
  const smilePref = preset.smile[face.smileClass] ?? 1;
  const tension = face.tension ?? 0;
  // A scowl spoils any smile preference, so tension scales the "mood" part.
  const mood = smilePref * curve(tension, TENSION_CURVE);
  const out = result(0.45 * eyes + 0.15 * (midTalk ? 0.5 : 1) + 0.4 * mood);
  if (face.eyes.state === 'open') out.good.push('Eyes open');
  else {
    out.bad.push(face.eyes.state === 'closed' ? 'Eyes closed (blink)' : 'Eyes half closed');
    out.tips.push('Shoot a burst of photos: at least one will catch your eyes open.');
  }
  if (midTalk) out.bad.push('Mouth open mid-word');
  if (tension >= 0.3) {
    out.bad.push('Tense expression: brows pulled down or frowning');
    out.tips.push('Relax your forehead and breathe out just before the shot. Think of something funny.');
  }
  const smileText = { big: 'Big, genuine smile', soft: 'Relaxed soft smile', serious: 'Serious expression' }[face.smileClass];
  if (smilePref >= 0.95 && tension < 0.3) out.good.push(smileText);
  else if (smilePref < 0.8) {
    out.bad.push(`${smileText}: ${face.smileClass === 'serious' ? 'a smile works better here' : 'a softer smile fits better here'}`);
  }
  return out;
}

export function eyeContactFactor(face) {
  if (!face?.gaze) return null;
  const out = result(curve(face.gaze.error, GAZE_CURVE));
  if (face.gaze.contact) out.good.push('Looking right into the lens');
  else {
    out.bad.push('Looking away from the camera');
    out.tips.push('Look into the lens itself, not at the screen.');
  }
  return out;
}

export function sharpnessFactor(sharpness) {
  if (!sharpness) return null;
  const out = result(curve(Math.log10(Math.max(1, sharpness.value)), SHARPNESS_CURVE));
  const what = sharpness.region === 'eyes' ? 'Eyes' : 'Photo';
  if (out.score >= 0.7) out.good.push(`${what} in sharp focus`);
  else if (out.score < 0.45) {
    out.bad.push(`${what} soft or blurry`);
    out.tips.push('Tap your face on screen to focus, and hold still (or use the volume button / timer).');
  }
  return out;
}

/**
 * Exposure is judged relative to the *other photos in the batch*: everyone's
 * skin tone is different, so "right" brightness is learned from your own
 * photos instead of a fixed number. Clipping and harsh side light are absolute.
 */
export function lightingFactor(light, ctx = {}) {
  if (!light) return null;
  let rel = 1;
  let stops = 0;
  if (ctx.medianFaceLuma > 0 && light.faceMean > 0) {
    stops = Math.log2(light.faceMean / ctx.medianFaceLuma);
    rel = curve(Math.abs(stops), [[0, 1], [0.35, 1], [0.8, 0.7], [1.5, 0.4]]);
  }
  const clip =
    curve(light.clipHigh, [[0, 1], [0.02, 1], [0.08, 0.6], [0.2, 0.3]]) *
    curve(light.clipLow, [[0, 1], [0.05, 1], [0.2, 0.6], [0.4, 0.35]]);
  const even = light.cheekRatio ? curve(light.cheekRatio, [[1, 1], [1.35, 1], [1.9, 0.7], [2.8, 0.45]]) : 1;
  const backlit = stops < -0.8 && light.sceneMean > light.faceMean * 1.6;
  const out = result((0.5 * rel + 0.25 * clip + 0.25 * even) * (backlit ? 0.7 : 1));

  if (backlit) {
    out.bad.push('Backlit: your face is in shadow');
    out.tips.push('Face the light source (a window is perfect) instead of having it behind you.');
  } else if (stops < -0.8) out.bad.push('Face darker than in your other photos');
  else if (stops > 0.8) out.bad.push('Face brighter than in your other photos');
  if (light.clipHigh > 0.06) out.bad.push('Blown-out highlights on your face');
  if (light.cheekRatio > 1.9) {
    out.bad.push('Harsh light from one side');
    out.tips.push('Soft, even light (shade, or facing a window) is the most flattering.');
  }
  if (out.score >= 0.8 && !out.bad.length) out.good.push(light.cheekRatio ? 'Even, well-exposed light on your face' : 'Well exposed');
  return out;
}

export function framingFactor(m, preset) {
  const face = m.face;
  if (!face) return null;
  let score = 1;
  const out = result(1);
  if (face.cutOff) {
    score *= 0.45;
    out.bad.push('Part of your face is cut off');
  }
  const minPx = m.framing === 'full' ? 70 : m.framing === 'half' ? 130 : 220;
  const detail = curve(face.faceLengthPx / minPx, [[0.35, 0.4], [0.7, 0.75], [1, 1]]);
  score *= 0.55 + 0.45 * detail;
  if (detail < 0.7) {
    out.bad.push('Face is small/low resolution');
    out.tips.push('Get closer or zoom in so your face fills more of the frame.');
  }
  if (m.framing !== 'full') {
    const eyeScore = curve(face.eyeLineY, [[0.08, 0.6], [0.22, 0.92], [0.28, 1], [0.48, 1], [0.62, 0.8], [0.85, 0.6]]);
    score *= 0.75 + 0.25 * eyeScore;
    if (eyeScore >= 0.95 && !face.cutOff) out.good.push('Well framed, eyes in the upper part of the shot');
  }
  if (preset.framing && m.framing) {
    const fit = preset.framing[m.framing] ?? 1;
    score *= fit;
    if (fit < 0.6) out.bad.push('Too far away for this kind of photo');
  }
  out.score = clamp(score);
  return out;
}

// ---- Overall ----------------------------------------------------------------------------

/** Batch-level context shared by all photos (e.g. typical face brightness). */
export function buildContext(metricsList) {
  const lumas = metricsList.map((m) => m?.face && m.light?.faceMean).filter((v) => v > 0);
  return { medianFaceLuma: lumas.length ? median(lumas) : null };
}

export function computeFactors(m, preset, ctx = {}) {
  return {
    angle: angleFactor(m.face, preset),
    body: bodyFactor(m.body, m.framing),
    lens: lensFactor(m.lens, m.framing),
    expression: expressionFactor(m.face, preset),
    eyeContact: eyeContactFactor(m.face),
    sharpness: sharpnessFactor(m.sharpness),
    lighting: lightingFactor(m.light, ctx),
    framing: framingFactor(m, preset),
  };
}

/**
 * @returns {{ score: number, factors: object, flags: string[], highlights: string[], tips: string[] }}
 *   score is 0–100. Factors that can't be measured (e.g. body in a close-up)
 *   are left out rather than guessed.
 */
export function scorePhoto(m, preset, ctx = {}, userWeights = preset.weights) {
  const factors = computeFactors(m, preset, ctx);
  // In a head-and-shoulders shot the body counts, but much less than in a full-length photo.
  const weights = m.framing === 'closeup' ? { ...userWeights, body: (userWeights.body ?? 0) * 0.4 } : userWeights;
  let sum = 0;
  let total = 0;
  for (const [key, f] of Object.entries(factors)) {
    const w = weights[key] ?? 0;
    if (!f || w <= 0 || !Number.isFinite(f.score)) continue;
    sum += f.score * w;
    total += w;
  }
  let overall = total ? sum / total : 0;

  // Deal-breakers multiply rather than average, so they can't be outvoted.
  const flags = [];
  if (!m.face) {
    overall *= 0.4;
    flags.push('No face found');
  } else {
    if (m.face.eyes.state === 'closed') {
      overall *= 0.45;
      flags.push('Eyes closed');
    } else if (m.face.eyes.state === 'half') {
      overall *= 0.85;
      flags.push('Eyes half closed');
    }
    if (m.face.cutOff) flags.push('Face cut off');
  }
  if (factors.sharpness && factors.sharpness.score < 0.3) {
    overall *= 0.75;
    flags.push('Blurry');
  }

  return {
    score: Math.round(curve(clamp(overall), DISPLAY_CURVE)),
    factors,
    flags,
    highlights: collectNotes(factors, weights, 'good', 4),
    tips: collectNotes(factors, weights, 'tips', 3),
  };
}

/** Notes from the factors that matter most: best-scoring first for praise, worst first for tips. */
function collectNotes(factors, weights, kind, limit) {
  const ranked = Object.entries(factors)
    .filter(([key, f]) => f && (weights[key] ?? 0) > 0 && f[kind].length)
    .map(([key, f]) => ({ f, rank: (weights[key] ?? 0) * (kind === 'good' ? f.score : 1 - f.score) }))
    .sort((a, b) => b.rank - a.rank);
  const notes = [];
  for (const { f } of ranked) {
    for (const note of f[kind]) if (!notes.includes(note)) notes.push(note);
  }
  return notes.slice(0, limit);
}
