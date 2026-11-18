/**
 * App entry point: holds state, runs the analysis queue, and wires the UI.
 * Data flow: files → analyzePhoto() → metrics → (preset, filters) → scores,
 * tags and ranking (pure functions in ./lib) → render.
 */
import { ANALYSIS_TIMEOUT_MS, IMAGE_EXTENSIONS } from './config.js';
import { loadModels } from './vision.js';
import { analyzePhoto } from './pipeline.js';
import { PRESETS, buildContext, scorePhoto } from './lib/scoring.js';
import { deriveTags } from './lib/tags.js';
import { buildView, similarSets, tagCounts } from './lib/ranking.js';
import { createPresetPicker, createResults, createTagFilters, createWeightSliders, renderStatus } from './ui.js';
import { createDetail } from './detail.js';

const $ = (id) => document.getElementById(id);

const dom = {
  fileInput: $('fileInput'),
  folderInput: $('folderInput'),
  addBtn: $('addBtn'),
  clearBtn: $('clearBtn'),
  pickFilesBtn: $('pickFilesBtn'),
  pickFolderBtn: $('pickFolderBtn'),
  dropzone: $('dropzone'),
  dragOverlay: $('dragOverlay'),
  results: $('results'),
  presets: $('presets'),
  presetDesc: $('presetDesc'),
  tagPanel: $('tagPanel'),
  tagSummaryCount: $('tagSummaryCount'),
  tagFilters: $('tagFilters'),
  clearFiltersBtn: $('clearFiltersBtn'),
  weights: $('weights'),
  resetWeightsBtn: $('resetWeightsBtn'),
  bestOfSets: $('bestOfSets'),
  photoCount: $('photoCount'),
  status: $('status'),
  statusBar: $('statusBar'),
  statusText: $('statusText'),
  topPick: $('topPick'),
  matchTitle: $('matchTitle'),
  matchCount: $('matchCount'),
  emptyMatches: $('emptyMatches'),
  grid: $('grid'),
  othersWrap: $('othersWrap'),
  othersCount: $('othersCount'),
  othersGrid: $('othersGrid'),
  dupesWrap: $('dupesWrap'),
  dupesCount: $('dupesCount'),
  dupesGrid: $('dupesGrid'),
  nofaceWrap: $('nofaceWrap'),
  nofaceCount: $('nofaceCount'),
  nofaceGrid: $('nofaceGrid'),
  detail: $('detail'),
};

const state = {
  photos: new Map(), // id → photo
  nextOrder: 0,
  queue: [],
  phase: 'idle', // idle | models | analyzing | error
  current: null,
  batchDone: 0,
  batchTotal: 0,
  presetId: 'flattering',
  weights: { ...PRESETS.flattering.weights },
  selected: new Set(),
  bestOfSets: false,
  ctx: { medianFaceLuma: null },
  setOf: new Map(),
  view: null,
};

// ---- Scoring ------------------------------------------------------------------------------

const analysed = () => [...state.photos.values()].filter((p) => p.status === 'done');

/** Re-derives tags, scores and similar-shot sets. Cheap: it's arithmetic on stored measurements. */
function rescore({ sets = state.queue.length === 0 } = {}) {
  const done = analysed();
  state.ctx = buildContext(done.map((p) => p.metrics));
  const preset = PRESETS[state.presetId];
  for (const p of done) {
    p.tags = deriveTags(p.metrics, state.ctx);
    p.result = scorePhoto(p.metrics, preset, state.ctx, state.weights);
  }
  if (sets) {
    state.setOf = similarSets(done.map((p) => ({ id: p.id, hash: p.metrics.hash, takenAt: p.metrics.lens?.takenAt })));
  }
}

const summaries = () =>
  analysed().map((p) => ({
    id: p.id,
    order: p.order,
    score: p.result.score,
    sharpness: p.result.factors.sharpness?.score ?? 0,
    tags: p.tags,
    hasFace: !!p.metrics.face,
  }));

// ---- Rendering ----------------------------------------------------------------------------

const updatePresets = createPresetPicker(dom.presets, (id) => {
  state.presetId = id;
  state.weights = { ...PRESETS[id].weights };
  rescore({ sets: false });
  scheduleRender();
});

const updateFilters = createTagFilters(dom.tagFilters, (key) => {
  if (state.selected.has(key)) state.selected.delete(key);
  else state.selected.add(key);
  scheduleRender();
});

const updateWeights = createWeightSliders(dom.weights, (key, value) => {
  state.weights = { ...state.weights, [key]: value };
  rescore({ sets: false });
  scheduleRender();
});

const results = createResults(dom, {
  open: (id) => openDetail(id),
  download: (id) => download(id),
  setOf: (id) => state.setOf.get(id),
});

const detail = createDetail(dom.detail, {
  download: (id) => download(id),
  navigate: (id, delta) => {
    const order = navigationOrder();
    const i = order.indexOf(id);
    if (i < 0 || !order.length) return;
    openDetail(order[(i + delta + order.length) % order.length]);
  },
});

function navigationOrder() {
  const v = state.view;
  if (!v) return [];
  return [...v.matches, ...v.others, ...v.duplicates, ...v.noFace].map((it) => it.id);
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function render() {
  const total = state.photos.size;
  const done = analysed();
  dom.dropzone.hidden = total > 0;
  dom.results.hidden = total === 0;
  dom.clearBtn.hidden = total === 0;
  dom.photoCount.textContent = total ? `${done.length} of ${total} analysed` : '';

  const preset = PRESETS[state.presetId];
  updatePresets(state.presetId);
  dom.presetDesc.textContent = preset.description;
  const customised = Object.keys(preset.weights).some((k) => preset.weights[k] !== state.weights[k]);
  dom.resetWeightsBtn.hidden = !customised;
  updateWeights(state.weights);

  const items = summaries();
  updateFilters({ counts: tagCounts(items.filter((it) => it.hasFace)), selected: state.selected });
  dom.clearFiltersBtn.hidden = state.selected.size === 0;
  dom.tagSummaryCount.textContent = state.selected.size ? `${state.selected.size} selected` : '';

  state.view = buildView(items, { selected: state.selected, setOf: state.setOf, bestOfSets: state.bestOfSets });
  results.render({ view: state.view, photos: state.photos, presetLabel: preset.label, filtering: state.selected.size > 0 });

  renderStatus(dom, {
    phase: state.phase,
    done: state.batchDone,
    total: state.batchTotal,
    current: state.current,
    errors: [...state.photos.values()].filter((p) => p.status === 'error'),
    onRetry: () => pump(),
  });

  // Keep an open detail view in sync with re-scoring (e.g. after changing the goal).
  if (dom.detail.open && detail.currentId && state.photos.get(detail.currentId)?.result) openDetail(detail.currentId);
}

function openDetail(id) {
  const photo = state.photos.get(id);
  if (!photo?.result) return;
  const order = navigationOrder();
  const i = order.indexOf(id);
  detail.show(photo, {
    ctx: state.ctx,
    weights: state.weights,
    presetLabel: PRESETS[state.presetId].label,
    position: i >= 0 ? `${i + 1} / ${order.length}` : '',
  });
}

function download(id) {
  const photo = state.photos.get(id);
  if (!photo) return;
  photo.originalUrl ??= URL.createObjectURL(photo.file);
  const a = document.createElement('a');
  a.href = photo.originalUrl;
  a.download = photo.name;
  document.body.append(a);
  a.click();
  a.remove();
}

// ---- Analysis queue -------------------------------------------------------------------------

/** Yields to the browser between photos so the page stays responsive (not throttled like timers). */
const yieldToBrowser = () =>
  globalThis.scheduler?.yield
    ? globalThis.scheduler.yield()
    : new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => resolve();
        channel.port2.postMessage(null);
      });

function friendlyError(err) {
  const msg = String(err?.message ?? err);
  if (/HEIC|timed out/i.test(msg)) return msg;
  if (err?.name === 'InvalidStateError' || /decode|source image/i.test(msg)) return 'not a readable image';
  return 'could not be analysed';
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

let pumping = false;
async function pump() {
  if (pumping || !state.queue.length) return;
  pumping = true;
  try {
    let models;
    try {
      state.phase = 'models';
      scheduleRender();
      models = await loadModels();
    } catch (err) {
      console.error('Model loading failed', err);
      state.phase = 'error';
      return;
    }
    state.phase = 'analyzing';
    while (state.queue.length) {
      const photo = state.photos.get(state.queue.shift());
      if (!photo) continue; // removed meanwhile
      state.current = photo.name;
      photo.status = 'analyzing';
      scheduleRender();
      try {
        const out = await withTimeout(analyzePhoto(photo.file, models), ANALYSIS_TIMEOUT_MS, 'timed out (file may be damaged)');
        if (state.photos.get(photo.id) !== photo) continue; // cleared while analysing
        photo.metrics = out.metrics;
        photo.overlay = out.overlay;
        photo.thumbUrl = URL.createObjectURL(out.thumbBlob);
        photo.displayUrl = out.displayBlob === photo.file && photo.originalUrl ? photo.originalUrl : URL.createObjectURL(out.displayBlob);
        photo.status = 'done';
      } catch (err) {
        console.warn(`Could not analyse ${photo.name}`, err);
        photo.status = 'error';
        photo.error = friendlyError(err);
      }
      state.batchDone++;
      rescore();
      scheduleRender();
      await yieldToBrowser();
    }
    state.phase = 'idle';
    state.current = null;
    state.batchDone = 0;
    state.batchTotal = 0;
  } finally {
    pumping = false;
    scheduleRender();
  }
}

function isImage(file) {
  return file.type.startsWith('image/') || IMAGE_EXTENSIONS.test(file.name);
}

function addFiles(files) {
  const known = new Set([...state.photos.values()].map((p) => `${p.name}|${p.file.size}|${p.file.lastModified}`));
  let added = 0;
  for (const file of files) {
    if (!isImage(file)) continue;
    const key = `${file.name}|${file.size}|${file.lastModified}`;
    if (known.has(key)) continue; // same file dropped twice
    known.add(key);
    const id = crypto.randomUUID?.() ?? `p${Date.now()}-${Math.random().toString(36).slice(2)}`;
    state.photos.set(id, { id, order: state.nextOrder++, file, name: file.name, status: 'queued', tags: new Set() });
    state.queue.push(id);
    added++;
  }
  if (!added) return;
  state.batchTotal += added;
  scheduleRender();
  pump();
}

function clearAll() {
  if (state.photos.size > 5 && !window.confirm(`Remove all ${state.photos.size} photos from Best Angle? (Your files are not touched.)`)) return;
  detail.close();
  for (const p of state.photos.values()) {
    for (const url of [p.thumbUrl, p.displayUrl, p.originalUrl]) if (url) URL.revokeObjectURL(url);
  }
  state.photos.clear();
  state.queue.length = 0;
  state.setOf = new Map();
  state.batchDone = 0;
  state.batchTotal = 0;
  if (state.phase !== 'error') state.phase = pumping ? 'analyzing' : 'idle';
  results.clear();
  scheduleRender();
}

// ---- Input wiring ---------------------------------------------------------------------------

/** Collects files from a drop, walking into dropped folders. */
async function filesFromDrop(dataTransfer) {
  // Entries must be read synchronously, before the drop event finishes.
  const entries = [...(dataTransfer.items ?? [])].map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dataTransfer.files];
  const files = [];
  const walk = async (entry) => {
    if (entry.isFile) {
      files.push(await new Promise((resolve, reject) => entry.file(resolve, reject)));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await walk(child);
      }
    }
  };
  for (const entry of entries) {
    try {
      await walk(entry);
    } catch (err) {
      console.warn('Skipped an unreadable dropped item', err);
    }
  }
  return files;
}

function wireInputs() {
  const pickFiles = () => dom.fileInput.click();
  dom.addBtn.addEventListener('click', pickFiles);
  dom.pickFilesBtn.addEventListener('click', pickFiles);
  dom.pickFolderBtn.addEventListener('click', () => dom.folderInput.click());
  for (const input of [dom.fileInput, dom.folderInput]) {
    input.addEventListener('change', () => {
      addFiles([...input.files]);
      input.value = '';
    });
  }
  dom.clearBtn.addEventListener('click', clearAll);
  dom.clearFiltersBtn.addEventListener('click', () => {
    state.selected.clear();
    scheduleRender();
  });
  dom.resetWeightsBtn.addEventListener('click', () => {
    state.weights = { ...PRESETS[state.presetId].weights };
    rescore({ sets: false });
    scheduleRender();
  });
  dom.bestOfSets.addEventListener('change', () => {
    state.bestOfSets = dom.bestOfSets.checked;
    scheduleRender();
  });

  // Drag and drop anywhere on the page.
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    dom.dragOverlay.hidden = false;
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dom.dragOverlay.hidden = true;
  });
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    dom.dragOverlay.hidden = true;
    addFiles(await filesFromDrop(e.dataTransfer));
  });

  // Paste images straight from the clipboard.
  window.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length) addFiles(files);
  });
}

wireInputs();
// On phones the filter list would push the results far down, so start it collapsed.
if (window.matchMedia('(max-width: 900px)').matches) dom.tagPanel.open = false;
// Touch devices can't drag-and-drop or pick folders: offer the photo picker only.
if (window.matchMedia('(pointer: coarse)').matches) {
  dom.pickFolderBtn.hidden = true;
  $('dropTitle').textContent = 'Add your photos';
}
render();

// Handy for debugging from the console; exposes nothing beyond what's on screen.
window.bestAngle = { state, addFiles };
