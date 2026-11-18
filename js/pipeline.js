/**
 * Per-photo analysis pipeline (browser side): decode → detect face & body →
 * measure focus/light → read lens EXIF → hand measurements to the pure
 * scoring code in ./lib. Full-resolution pixels are released as soon as the
 * photo is done; only a small thumbnail and the numbers are kept.
 */
import {
  ANALYSIS_MAX_SIDE,
  EXIFR_URL,
  HEAD_CROP_SIZE,
  HEIC_DECODER_URL,
  HEIC_PATTERN,
  SHARPNESS_SAMPLE_WIDTH,
  THUMB_MAX_SIDE,
} from './config.js';
import { detectFaces, detectPoses } from './vision.js';
import { EYE_REGION, FACE_LM, analyzeFace, boundingBox, pickMainFace } from './lib/face.js';
import { POSE_LM, analyzeBody, pickPoseForFace, resolveFraming } from './lib/pose.js';
import { analyzeLens } from './lib/lens.js';
import { dHash, laplacianVariance, lumaFromRGBA, lumaSummary } from './lib/imagestats.js';

// ---- Canvas helpers -------------------------------------------------------------------

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function drawScaled(source, w, h) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

/** RGBA pixels of `rect` (source pixel coordinates) resampled to outW×outH. */
function sample(source, rect, outW, outH) {
  const c = makeCanvas(outW, outH);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height);
  return ctx.getImageData(0, 0, c.width, c.height);
}

/**
 * Frees a canvas's pixel memory now instead of whenever GC runs. iPhone Safari
 * caps total canvas memory, and a batch of photos would otherwise hit the cap.
 */
function release(canvas) {
  canvas.width = 0;
  canvas.height = 0;
}

function clampRect(r, W, H) {
  const x = Math.max(0, r.x);
  const y = Math.max(0, r.y);
  return { x, y, w: Math.max(0, Math.min(W, r.x + r.w) - x), h: Math.max(0, Math.min(H, r.y + r.h) - y) };
}

function padRect(r, pad, W, H) {
  return clampRect({ x: r.x - r.w * pad, y: r.y - r.h * pad, w: r.w * (1 + 2 * pad), h: r.h * (1 + 2 * pad) }, W, H);
}

const lumaOf = (source, rect, w, h) => lumaFromRGBA(sample(source, rect, w, h).data);

// ---- Decoding ---------------------------------------------------------------------------

let heicModule = null;
async function heicToJpeg(file) {
  heicModule ??= import(HEIC_DECODER_URL).catch(() => {
    heicModule = null;
    throw new Error('Could not download the HEIC decoder (are you offline?)');
  });
  const { heicTo } = await heicModule;
  return heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 });
}

/** EXIF-oriented bitmap. Older Safari rejects the options bag (and orients by default anyway). */
async function bitmapFrom(blob) {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch (err) {
    if (err?.name !== 'TypeError') throw err;
    return createImageBitmap(blob);
  }
}

/** Returns an EXIF-oriented ImageBitmap plus a blob the <img> tag can display. */
async function decode(file) {
  const isHeic = HEIC_PATTERN.test(file.name) || /image\/hei[cf]/i.test(file.type);
  if (isHeic) {
    try {
      return { bitmap: await bitmapFrom(file), displayBlob: file };
    } catch {
      // Most browsers can't decode HEIC natively (Safari can); convert to JPEG on-device.
    }
    const jpeg = await heicToJpeg(file);
    return { bitmap: await bitmapFrom(jpeg), displayBlob: jpeg };
  }
  return { bitmap: await bitmapFrom(file), displayBlob: file };
}

// Only the camera blocks we need. (exifr's "pick these tag names" shortcut throws in
// the lite build, so segments are selected explicitly instead.)
const EXIF_OPTIONS = {
  tiff: true,
  exif: true,
  gps: false,
  ifd1: false,
  interop: false,
  xmp: false,
  icc: false,
  iptc: false,
  jfif: false,
  ihdr: false,
};

let exifrModule = null;
async function readExif(file) {
  try {
    exifrModule ??= import(EXIFR_URL);
    const mod = await exifrModule;
    const exifr = mod.default ?? mod;
    return (await exifr.parse(file, EXIF_OPTIONS)) ?? {};
  } catch (err) {
    // Formats without EXIF support (e.g. BMP) are expected; anything else is worth a console note.
    if (!/Unknown file format/i.test(String(err?.message))) console.warn(`EXIF not read for ${file.name}`, err);
    return {}; // lens checks are simply skipped (screenshots and chat apps strip EXIF too)
  }
}

// ---- Detection --------------------------------------------------------------------------

/** Square crop around the head, from body landmarks, generous enough to include the whole face. */
function headRect(lm, W, H) {
  const P = POSE_LM;
  const pts = [P.nose, P.leftEye, P.rightEye, P.leftEar, P.rightEar, P.mouthLeft, P.mouthRight]
    .map((i) => lm[i])
    .filter((p) => p && (p.visibility ?? 1) > 0.3);
  if (pts.length < 3) return null;
  const xs = pts.map((p) => p.x * W);
  const ys = pts.map((p) => p.y * H);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const ls = lm[P.leftShoulder];
  const rs = lm[P.rightShoulder];
  const shoulders = ls && rs ? Math.hypot((ls.x - rs.x) * W, (ls.y - rs.y) * H) : 0;
  const side = Math.max((maxX - minX) * 2.6, (maxY - minY) * 3.2, shoulders * 1.1, 48);
  return { x: (minX + maxX) / 2 - side / 2, y: (minY + maxY) / 2 - side / 2, w: side, h: side };
}

/**
 * The face model is tuned for faces that fill a good part of the frame, so in
 * full-body shots it can miss a small face. The body model still finds the
 * person, so zoom into their head and look again.
 */
function facesFromHeadCrop(models, bitmap, pose, W, H) {
  const rect = headRect(pose.landmarks, W, H);
  if (!rect) return [];
  const crop = makeCanvas(HEAD_CROP_SIZE, HEAD_CROP_SIZE);
  const ctx = crop.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, rect.x, rect.y, rect.w, rect.h, 0, 0, HEAD_CROP_SIZE, HEAD_CROP_SIZE);
  const faces = detectFaces(models, crop);
  release(crop);
  return faces.map((f) => ({
    ...f,
    landmarks: f.landmarks.map((p) => ({
      x: (rect.x + p.x * rect.w) / W,
      y: (rect.y + p.y * rect.h) / H,
      z: (p.z * rect.w) / W,
    })),
  }));
}

/** Neighbouring head crops can find the same face twice; keep one per location. */
function dedupeFaces(faces) {
  const kept = [];
  for (const f of faces) {
    const b = boundingBox(f.landmarks);
    const dup = kept.some((k) => Math.hypot(k.box.cx - b.cx, k.box.cy - b.cy) < 0.5 * Math.max(k.box.w, b.w));
    if (!dup) kept.push({ face: f, box: b });
  }
  return kept.map((k) => k.face);
}

// ---- Measurements -----------------------------------------------------------------------

/** Focus is judged on the eyes (what viewers look at first), never upscaled. */
function measureSharpness(bitmap, mainFace, W, H) {
  let rect;
  let region;
  if (mainFace) {
    const b = boundingBox(mainFace.landmarks, EYE_REGION);
    rect = padRect({ x: b.x0 * W, y: b.y0 * H, w: b.w * W, h: b.h * H }, 0.15, W, H);
    region = 'eyes';
  } else {
    rect = { x: W * 0.2, y: H * 0.2, w: W * 0.6, h: H * 0.6 };
    region = 'image';
  }
  if (rect.w < 8 || rect.h < 4) return null;
  const outW = Math.round(Math.min(SHARPNESS_SAMPLE_WIDTH, rect.w));
  const outH = Math.max(4, Math.round((outW * rect.h) / rect.w));
  const gray = lumaOf(bitmap, rect, outW, outH);
  // Edge energy scales with brightness², so a dark photo would look "blurry".
  // Normalise to mid-grey (gain capped so noise in near-black shots isn't amplified).
  const gain = Math.min(4, 128 / Math.max(1, lumaSummary(gray).mean));
  return { value: laplacianVariance(gray, outW, outH) * gain * gain, region, sourceWidth: Math.round(rect.w) };
}

function measureLight(work, mainFace, face) {
  const w = work.width;
  const h = work.height;
  const scene = lumaSummary(lumaOf(work, { x: 0, y: 0, w, h }, 64, 64));
  if (!mainFace) {
    return { faceMean: scene.mean, clipHigh: scene.clipHigh, clipLow: scene.clipLow, cheekRatio: null, sceneMean: scene.mean };
  }
  const lm = mainFace.landmarks;
  const L = FACE_LM;
  // Mostly-skin band: below the eyes to the upper lip, cheek to cheek.
  const left = Math.min(lm[L.rightCheek].x, lm[L.leftCheek].x);
  const right = Math.max(lm[L.rightCheek].x, lm[L.leftCheek].x);
  const top = Math.max(lm[L.rightEyeLower].y, lm[L.leftEyeLower].y);
  const bottom = lm[L.upperLip].y;
  const skinRect = clampRect({ x: left * w, y: top * h, w: (right - left) * w, h: (bottom - top) * h }, w, h);
  const skin = skinRect.w >= 4 && skinRect.h >= 4 ? lumaSummary(lumaOf(work, skinRect, 48, 32)) : null;

  // Compare the two sides of that band (split at the nose): very different brightness
  // means harsh light from one side. Skipped for strongly turned faces, whose far
  // side is mostly out of view.
  let cheekRatio = null;
  const noseX = lm[L.noseTip].x * w;
  const turned = Math.abs(face.pose?.azimuth ?? 0) > 30;
  if (skin && !turned && noseX > skinRect.x + 4 && noseX < skinRect.x + skinRect.w - 4) {
    const half = (x0, x1) => lumaSummary(lumaOf(work, { x: x0, y: skinRect.y, w: x1 - x0, h: skinRect.h }, 24, 24)).mean;
    const a = half(skinRect.x, noseX);
    const b = half(noseX, skinRect.x + skinRect.w);
    if (a > 2 && b > 2) cheekRatio = Math.max(a, b) / Math.min(a, b);
  }

  return {
    faceMean: skin?.mean ?? scene.mean,
    clipHigh: skin?.clipHigh ?? 0,
    clipLow: skin?.clipLow ?? 0,
    cheekRatio,
    sceneMean: scene.mean,
  };
}

const imageHash = (work) => dHash(lumaOf(work, { x: 0, y: 0, w: work.width, h: work.height }, 9, 8));

/**
 * JPEG thumbnail. Uses the synchronous encoder on purpose: toBlob()/convertToBlob()
 * wait for an idle moment before encoding, which added a fixed ~1 s per photo while
 * the page was busy analysing. Encoding a small thumbnail directly takes milliseconds.
 */
function toThumbBlob(bitmap) {
  const s = Math.min(1, THUMB_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = drawScaled(bitmap, bitmap.width * s, bitmap.height * s);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  release(canvas);
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'image/jpeg' });
}

// ---- Entry point ------------------------------------------------------------------------

/**
 * @returns {Promise<{ metrics, overlay, thumbBlob: Blob, displayBlob: Blob }>}
 */
export async function analyzePhoto(file, models) {
  const { bitmap, displayBlob } = await decode(file);
  let work = null;
  try {
    const W = bitmap.width;
    const H = bitmap.height;
    const size = { width: W, height: H };
    const exifPromise = readExif(file);
    const scale = Math.min(1, ANALYSIS_MAX_SIDE / Math.max(W, H));
    work = drawScaled(bitmap, W * scale, H * scale);

    let faces = detectFaces(models, work);
    const poses = detectPoses(models, work);
    if (!faces.length && poses.length) {
      faces = dedupeFaces(poses.flatMap((pose) => facesFromHeadCrop(models, bitmap, pose, W, H)));
    }

    const main = pickMainFace(faces);
    const face = main ? analyzeFace(main, size) : null;
    const pose = pickPoseForFace(poses, face?.box ?? null);
    const body = analyzeBody(pose, size);
    const lens = analyzeLens(await exifPromise, W, H, face);

    const metrics = {
      width: W,
      height: H,
      faceCount: faces.length,
      personCount: Math.max(faces.length, poses.length),
      face,
      body,
      framing: resolveFraming(body?.framing ?? null, face?.box ?? null),
      lens,
      sharpness: measureSharpness(bitmap, main, W, H),
      light: measureLight(work, main, face),
      hash: imageHash(work),
    };

    const overlay = {
      face: main
        ? {
            box: face.box,
            points: [FACE_LM.rightEyeOuter, FACE_LM.leftEyeOuter, FACE_LM.noseTip, FACE_LM.chin].map((i) => ({
              x: main.landmarks[i].x,
              y: main.landmarks[i].y,
            })),
          }
        : null,
      otherFaces: faces.filter((f) => f !== main).map((f) => boundingBox(f.landmarks)),
      pose: pose ? pose.landmarks.map((p) => ({ x: p.x, y: p.y, v: p.visibility ?? 1 })) : null,
    };

    return { metrics, overlay, thumbBlob: toThumbBlob(bitmap), displayBlob };
  } finally {
    bitmap.close();
    if (work) release(work);
  }
}
