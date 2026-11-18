/**
 * Central configuration. Third-party code is pinned to exact versions so the
 * app behaves the same on every run and a new "latest" release can't change
 * (or compromise) it without a deliberate edit here. These hosts are also the
 * only ones allowed by the Content-Security-Policy in index.html.
 */
// 0.10.35 on purpose: the 1.x releases added usage telemetry (POSTs to odml.pa.googleapis.com).
// The CSP would block it anyway, but a privacy-first app shouldn't ship code that tries.
export const MEDIAPIPE_VERSION = '0.10.35';
export const MEDIAPIPE_BUNDLE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`;
export const MEDIAPIPE_WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;

export const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
export const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

export const EXIFR_URL = 'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/lite.esm.mjs';
/** iPhone HEIC decoder (libheif). The "csp" build needs no eval(), so the strict CSP can stay. */
export const HEIC_DECODER_URL = 'https://cdn.jsdelivr.net/npm/heic-to@1.6.7/dist/csp/heic-to.js';

/** A photo that takes longer than this is skipped, so one bad file can't stall the queue. */
export const ANALYSIS_TIMEOUT_MS = 90_000;

/** Long side (px) of the copy the AI models look at. */
export const ANALYSIS_MAX_SIDE = 1280;
/** Long side (px) of the grid thumbnails kept in memory. */
export const THUMB_MAX_SIDE = 720;
/** Size (px) of the zoomed-in head crop used when a face is too small to find at first. */
export const HEAD_CROP_SIZE = 512;
/** Width (px) the eye region is sampled at for the focus check (never upscaled). */
export const SHARPNESS_SAMPLE_WIDTH = 320;

export const MAX_FACES = 6;
export const MAX_POSES = 3;

export const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|avif|gif|bmp|heic|heif)$/i;
export const HEIC_PATTERN = /\.(heic|heif)$/i;
