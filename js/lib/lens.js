/**
 * Lens and camera-distance analysis from EXIF data.
 *
 * Why it matters: a phone held at arm's length (wide lens, ~40 cm away)
 * enlarges whatever is closest to it (nose, centre of the face), and wide
 * lenses stretch people near the edges of the frame. Stepping back and
 * zooming in gives natural proportions, which is why portrait photographers
 * use longer lenses.
 */

/** Typical adult distance from MediaPipe's top-of-forehead landmark to the chin. */
const FACE_LENGTH_M = 0.18;
/** Diagonal of a 35 mm film frame; "35 mm-equivalent" focal lengths are relative to it. */
const FULL_FRAME_DIAGONAL_MM = 43.27;

const toNumber = (v) => {
  const n = typeof v === 'number' ? v : Number.parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function lensClass(focal35) {
  if (!focal35) return null;
  if (focal35 < 20) return 'ultrawide';
  if (focal35 < 35) return 'wide';
  if (focal35 < 60) return 'normal';
  return 'tele';
}

/**
 * @param exif   parsed EXIF tags (may be empty)
 * @param width  image width in pixels (as displayed, after rotation)
 * @param height image height in pixels
 * @param face   analyzeFace() output or null
 */
export function analyzeLens(exif, width, height, face) {
  const focal35 = toNumber(exif?.FocalLengthIn35mmFormat);
  const lensModel = typeof exif?.LensModel === 'string' ? exif.LensModel : '';
  let distanceM = null;
  if (focal35 && face?.faceLengthPx > 0) {
    const focalPx = (focal35 * Math.hypot(width, height)) / FULL_FRAME_DIAGONAL_MM;
    // A face tilted toward/away from the camera looks shorter; undo that (bounded).
    const tilt = Math.max(0.7, Math.cos(((face.pose?.elevation ?? 0) * Math.PI) / 180));
    distanceM = (FACE_LENGTH_M * focalPx * tilt) / face.faceLengthPx;
  }
  // 0 = subject centred, 1 = in a corner of the frame.
  const edge = face
    ? Math.hypot((face.box.cx - 0.5) * width, (face.box.cy - 0.5) * height) / (0.5 * Math.hypot(width, height))
    : null;
  const takenAt = exif?.DateTimeOriginal instanceof Date ? exif.DateTimeOriginal.getTime() : null;
  return {
    focal35,
    lensClass: lensClass(focal35),
    frontCamera: /front/i.test(lensModel),
    distanceM,
    edge,
    takenAt: Number.isFinite(takenAt) ? takenAt : null,
    camera: [exif?.Make, exif?.Model].filter((s) => typeof s === 'string' && s.trim()).join(' ') || null,
  };
}
