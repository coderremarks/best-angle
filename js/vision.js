/**
 * Loads Google MediaPipe's Face Landmarker and Pose Landmarker. Both run
 * entirely in the browser (WebAssembly + WebGL): images are never sent
 * anywhere. Only the library and model files are downloaded, once, then cached.
 */
import {
  FACE_MODEL_URL,
  MAX_FACES,
  MAX_POSES,
  MEDIAPIPE_BUNDLE_URL,
  MEDIAPIPE_WASM_URL,
  POSE_MODEL_URL,
} from './config.js';

let modelsPromise = null;

async function createTask(Task, fileset, options) {
  try {
    return await Task.createFromOptions(fileset, {
      ...options,
      baseOptions: { ...options.baseOptions, delegate: 'GPU' },
    });
  } catch (gpuError) {
    console.warn('GPU delegate unavailable, falling back to CPU.', gpuError);
    return Task.createFromOptions(fileset, {
      ...options,
      baseOptions: { ...options.baseOptions, delegate: 'CPU' },
    });
  }
}

/** Resolves to { face, pose } landmarkers. Safe to call repeatedly; retries after a failure. */
export function loadModels() {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      const vision = await import(MEDIAPIPE_BUNDLE_URL);
      const fileset = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
      // Created one after the other: both share the same WebAssembly loader.
      const face = await createTask(vision.FaceLandmarker, fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL_URL },
        runningMode: 'IMAGE',
        numFaces: MAX_FACES,
        minFaceDetectionConfidence: 0.5,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
      const pose = await createTask(vision.PoseLandmarker, fileset, {
        baseOptions: { modelAssetPath: POSE_MODEL_URL },
        runningMode: 'IMAGE',
        numPoses: MAX_POSES,
        minPoseDetectionConfidence: 0.5,
      });
      return { face, pose };
    })();
    modelsPromise.catch(() => {
      modelsPromise = null; // let the user retry (e.g. after reconnecting)
    });
  }
  return modelsPromise;
}

/** Faces as plain objects: { landmarks, blendshapes, matrix }. */
export function detectFaces(models, image) {
  const r = models.face.detect(image);
  return (r.faceLandmarks ?? []).map((landmarks, i) => ({
    landmarks,
    blendshapes: r.faceBlendshapes?.[i]?.categories ?? [],
    matrix: r.facialTransformationMatrixes?.[i] ?? null,
  }));
}

/** People as plain objects: { landmarks, worldLandmarks }. */
export function detectPoses(models, image) {
  const r = models.pose.detect(image);
  const poses = (r.landmarks ?? []).map((landmarks, i) => ({
    landmarks,
    worldLandmarks: r.worldLandmarks?.[i] ?? null,
  }));
  r.close?.();
  return poses;
}
