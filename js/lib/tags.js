/**
 * Auto-tags: the "kind of photo" filters you can pick from. Tags are derived
 * from measurements, so every tag on a photo can be explained.
 */
import { PRESETS, angleFactor, bodyFactor, lensFactor, lightingFactor, sharpnessFactor } from './scoring.js';

/**
 * mode 'any': pick several and a photo needs at least one (e.g. Big OR Soft smile).
 * mode 'all': every picked tag is required (e.g. Sharp AND Eyes open).
 */
export const TAG_GROUPS = Object.freeze([
  {
    id: 'quality',
    label: 'Must be',
    mode: 'all',
    tags: [
      { id: 'slimming', label: 'Slimming angle' },
      { id: 'eyes-open', label: 'Eyes open' },
      { id: 'sharp', label: 'Sharp' },
      { id: 'good-light', label: 'Good light' },
    ],
  },
  {
    id: 'framing',
    label: 'Framing',
    mode: 'any',
    tags: [
      { id: 'closeup', label: 'Close-up' },
      { id: 'half', label: 'Half body' },
      { id: 'full', label: 'Full body' },
    ],
  },
  {
    id: 'expression',
    label: 'Expression',
    mode: 'any',
    tags: [
      { id: 'big-smile', label: 'Big smile' },
      { id: 'soft-smile', label: 'Soft smile' },
      { id: 'serious', label: 'Serious' },
    ],
  },
  {
    id: 'eyes',
    label: 'Eyes',
    mode: 'any',
    tags: [
      { id: 'eye-contact', label: 'Looking at camera' },
      { id: 'looking-away', label: 'Looking away' },
    ],
  },
  {
    id: 'face-angle',
    label: 'Face angle',
    mode: 'any',
    tags: [
      { id: 'front', label: 'Straight on' },
      { id: 'three-quarter', label: '3/4 turn' },
      { id: 'profile', label: 'Side profile' },
    ],
  },
  {
    id: 'camera',
    label: 'Camera height',
    mode: 'any',
    tags: [
      { id: 'from-above', label: 'From above' },
      { id: 'eye-level', label: 'Eye level' },
      { id: 'from-below', label: 'From below' },
    ],
  },
  {
    id: 'people',
    label: 'People',
    mode: 'any',
    tags: [
      { id: 'solo', label: 'Just me' },
      { id: 'group', label: 'Group' },
    ],
  },
  {
    id: 'orientation',
    label: 'Shape',
    mode: 'any',
    tags: [
      { id: 'portrait', label: 'Portrait' },
      { id: 'landscape', label: 'Landscape' },
      { id: 'square', label: 'Square' },
    ],
  },
]);

export const tagKey = (groupId, tagId) => `${groupId}:${tagId}`;

const LABELS = new Map(TAG_GROUPS.flatMap((g) => g.tags.map((t) => [tagKey(g.id, t.id), t.label])));
export const tagLabel = (key) => LABELS.get(key) ?? key;

/** @returns {Set<string>} keys like "expression:big-smile" */
export function deriveTags(m, ctx = {}) {
  const tags = new Set();
  const add = (group, tag) => tags.add(tagKey(group, tag));

  if (m.framing) add('framing', m.framing);
  if (m.width > 0 && m.height > 0) {
    const ratio = m.width / m.height;
    add('orientation', ratio > 1.1 ? 'landscape' : ratio < 0.9 ? 'portrait' : 'square');
  }
  const people = Math.max(m.faceCount ?? 0, m.personCount ?? 0);
  if (m.face && people >= 1) add('people', people > 1 ? 'group' : 'solo');

  const face = m.face;
  if (face) {
    add('expression', { big: 'big-smile', soft: 'soft-smile', serious: 'serious' }[face.smileClass]);
    if (face.gaze) add('eyes', face.gaze.contact ? 'eye-contact' : 'looking-away');
    if (face.pose) {
      const turn = Math.abs(face.pose.azimuth);
      add('face-angle', turn < 12 ? 'front' : turn <= 45 ? 'three-quarter' : 'profile');
      const e = face.pose.elevation;
      add('camera', e >= 4 ? 'from-above' : e <= -5 ? 'from-below' : 'eye-level');
    }
    if (face.eyes.state === 'open') add('quality', 'eyes-open');

    const light = lightingFactor(m.light, ctx);
    if (light && light.score >= 0.7) add('quality', 'good-light');
    const angle = angleFactor(face, PRESETS.flattering);
    const body = m.framing === 'closeup' ? null : bodyFactor(m.body, m.framing);
    const lens = lensFactor(m.lens, m.framing);
    if (angle && angle.score >= 0.78 && (!body || body.score >= 0.7) && (!lens || lens.score >= 0.6)) {
      add('quality', 'slimming');
    }
  }
  const sharp = sharpnessFactor(m.sharpness);
  if (sharp && sharp.score >= 0.6) add('quality', 'sharp');
  return tags;
}
