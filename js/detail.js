/**
 * Photo detail dialog: the photo with an overlay of what the AI measured,
 * every factor with its score and reasons, tips for next time, and the raw
 * measurements for anyone who wants to check the maths.
 */
import { FACTORS } from './lib/scoring.js';
import { SKELETON } from './lib/pose.js';
import { tagLabel } from './lib/tags.js';
import { h, icon, s, scoreTone } from './ui.js';

const fmt = {
  deg: (v) => (v == null ? '–' : `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))}°`),
  absDeg: (v) => (v == null ? '–' : `${Math.abs(Math.round(v))}°`),
  num: (v, d = 2) => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(d)),
  int: (v) => (v == null || !Number.isFinite(v) ? '–' : String(Math.round(v))),
  dist: (m) => (m == null ? '–' : m < 1 ? `~${Math.round(m * 100)} cm` : `~${m.toFixed(1)} m`),
};

const UNMEASURED_REASON = {
  angle: 'no face found',
  body: 'body not visible enough',
  lens: 'no lens info in the file',
  expression: 'no face found',
  eyeContact: 'eyes not visible',
  sharpness: 'image too small',
  lighting: 'no face found',
  framing: 'no face found',
};

function overlaySvg(photo) {
  const { width: W, height: H } = photo.metrics;
  const o = photo.overlay;
  const unit = Math.max(W, H) / 100;
  const layer = s('svg', { class: 'overlay', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });

  if (o?.pose) {
    const p = o.pose;
    for (const [a, b] of SKELETON) {
      if (p[a]?.v > 0.5 && p[b]?.v > 0.5) {
        layer.append(s('line', { class: 'ov-bone', x1: p[a].x * W, y1: p[a].y * H, x2: p[b].x * W, y2: p[b].y * H }));
      }
    }
    for (const i of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
      if (p[i]?.v > 0.5) layer.append(s('circle', { class: 'ov-joint', cx: p[i].x * W, cy: p[i].y * H, r: unit * 0.6 }));
    }
  }
  for (const b of o?.otherFaces ?? []) {
    layer.append(s('rect', { class: 'ov-other', x: b.x0 * W, y: b.y0 * H, width: b.w * W, height: b.h * H, rx: unit }));
  }
  if (o?.face) {
    const b = o.face.box;
    const [re, le, nose] = o.face.points;
    layer.append(
      s('rect', { class: 'ov-face', x: b.x0 * W, y: b.y0 * H, width: b.w * W, height: b.h * H, rx: unit * 1.2 }),
      s('line', { class: 'ov-eyeline', x1: re.x * W, y1: re.y * H, x2: le.x * W, y2: le.y * H }),
      s('circle', { class: 'ov-joint', cx: nose.x * W, cy: nose.y * H, r: unit * 0.5 }),
    );
    const pose = photo.metrics.face.pose;
    if (pose) {
      const label = `turn ${fmt.absDeg(pose.azimuth)} · camera ${fmt.deg(pose.elevation)}`;
      const fontSize = unit * 2.4;
      const y = b.y0 * H > fontSize * 1.6 ? b.y0 * H - fontSize * 0.5 : b.y1 * H + fontSize * 1.2;
      layer.append(s('text', { class: 'ov-label', x: b.x0 * W, y, 'font-size': fontSize }, label));
    }
  }
  return layer;
}

function factorRow(key, f, weight) {
  const pct = Math.round(f.score * 100);
  const fill = h('span', { class: 'meter-fill', 'data-tone': scoreTone(pct) });
  fill.style.width = `${pct}%`;
  return h('li', { class: 'factor' },
    h('div', { class: 'factor-head' },
      h('span', { class: 'factor-name' }, FACTORS[key].label),
      h('span', { class: 'factor-weight' }, weight >= 2.75 ? 'top priority' : weight >= 2 ? 'high priority' : weight >= 1 ? 'medium' : weight > 0 ? 'low' : 'ignored'),
      h('span', { class: 'factor-score', 'data-tone': scoreTone(pct) }, String(pct))),
    h('div', { class: 'meter', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': FACTORS[key].label }, fill),
    f.good.length || f.bad.length
      ? h('ul', { class: 'notes' },
          f.good.map((t) => h('li', { class: 'note note--good' }, icon('check'), h('span', {}, t))),
          f.bad.map((t) => h('li', { class: 'note note--bad' }, icon('cross'), h('span', {}, t))))
      : null,
  );
}

function measurements(photo, ctx) {
  const m = photo.metrics;
  const f = m.face;
  const rows = [
    ['Image', `${m.width} × ${m.height}`],
    ['People / faces found', `${m.personCount ?? m.faceCount} / ${m.faceCount}`],
    ['Framing', m.framing ?? '–'],
    ['Camera vs eye line', fmt.deg(f?.pose?.elevation)],
    ['Face turn', fmt.absDeg(f?.pose?.azimuth)],
    ['Head tilt', fmt.absDeg(f?.roll)],
    ['Body turn', fmt.absDeg(m.body?.turn)],
    ['Arms against body', m.body?.arms ? `${m.body.arms.pressed} of ${m.body.arms.checked}` : '–'],
    ['Smile', fmt.num(f?.smile)],
    ['Eye openness (L / R)', f ? `${fmt.num(f.eyes.earLeft)} / ${fmt.num(f.eyes.earRight)}` : '–'],
    ['Gaze off-lens', f?.gaze ? fmt.absDeg(f.gaze.error) : '–'],
    ['Focus (Laplacian var.)', fmt.int(m.sharpness?.value)],
    ['Face brightness', m.light ? `${fmt.int(m.light.faceMean)} (your median ${fmt.int(ctx.medianFaceLuma)})` : '–'],
    ['Cheek light ratio', fmt.num(m.light?.cheekRatio)],
    ['Lens (35 mm equiv.)', m.lens?.focal35 ? `${Math.round(m.lens.focal35)} mm` : '–'],
    ['Camera distance', fmt.dist(m.lens?.distanceM)],
    ['Camera', m.lens?.camera ?? '–'],
  ];
  return h('details', { class: 'measurements' },
    h('summary', {}, 'Raw measurements'),
    h('dl', {}, rows.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])));
}

/**
 * @param dialog   the <dialog> element
 * @param handlers { download(id), navigate(id, delta) }
 */
export function createDetail(dialog, handlers) {
  let currentId = null;
  let showOverlay = true;

  dialog.addEventListener('keydown', (e) => {
    if (!currentId || e.target instanceof HTMLInputElement) return;
    if (e.key === 'ArrowRight') handlers.navigate(currentId, 1);
    else if (e.key === 'ArrowLeft') handlers.navigate(currentId, -1);
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close(); // click on the backdrop
  });
  dialog.addEventListener('close', () => {
    currentId = null;
    dialog.replaceChildren();
  });

  function show(photo, { ctx, weights, presetLabel, position }) {
    currentId = photo.id;
    const r = photo.result;
    const { width: W, height: H } = photo.metrics;
    const stage = h('div', { class: 'stage' }, h('img', { src: photo.displayUrl, alt: photo.name }));
    stage.style.setProperty('--ar', String(W / H));
    const overlay = overlaySvg(photo);
    overlay.classList.toggle('overlay--hidden', !showOverlay);
    stage.append(overlay);
    const toggle = h('input', { type: 'checkbox', class: 'switch-input' });
    toggle.checked = showOverlay;
    toggle.addEventListener('change', () => {
      showOverlay = toggle.checked;
      overlay.classList.toggle('overlay--hidden', !showOverlay);
    });

    const measured = Object.entries(r.factors).filter(([key, f]) => f && (weights[key] ?? 0) > 0);
    const unmeasured = Object.entries(r.factors).filter(([, f]) => !f).map(([key]) => key);

    dialog.replaceChildren(
      h('div', { class: 'detail-shell' },
        h('header', { class: 'detail-head' },
          h('h2', { class: 'detail-title', id: 'detailTitle', title: photo.name }, photo.name),
          h('div', { class: 'detail-nav' },
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Previous photo', onclick: () => handlers.navigate(photo.id, -1) }, icon('left')),
            h('span', { class: 'detail-pos' }, position),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Next photo', onclick: () => handlers.navigate(photo.id, 1) }, icon('right')),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => dialog.close() }, icon('close')))),
        h('div', { class: 'detail-body' },
          h('figure', { class: 'detail-figure' },
            stage,
            h('figcaption', {}, h('label', { class: 'switch' }, toggle, h('span', { class: 'switch-track', 'aria-hidden': 'true' }), 'Show what the AI measured'))),
          h('section', { class: 'detail-info', 'aria-label': 'Score breakdown' },
            h('div', { class: 'detail-score', 'data-tone': scoreTone(r.score) },
              h('span', { class: 'hero-score-num' }, String(r.score)),
              h('span', { class: 'hero-score-of' }, `/ 100 for ${presetLabel.toLowerCase()}`)),
            r.flags.length ? h('p', { class: 'flags' }, icon('alert'), r.flags.join(' · ')) : null,
            h('div', { class: 'mini-chips' }, [...photo.tags].map((t) => h('span', { class: 'mini-chip' }, tagLabel(t)))),
            h('ol', { class: 'factors' }, measured.sort(([a], [b]) => (weights[b] ?? 0) - (weights[a] ?? 0)).map(([key, f]) => factorRow(key, f, weights[key]))),
            unmeasured.length
              ? h('p', { class: 'unmeasured' }, 'Not measured: ', unmeasured.map((k) => `${FACTORS[k].label.toLowerCase()} (${UNMEASURED_REASON[k]})`).join('; '), '.')
              : null,
            r.tips.length
              ? h('div', { class: 'tips' }, h('h3', {}, icon('bulb'), 'Next time'), h('ul', {}, r.tips.map((t) => h('li', {}, t))))
              : null,
            measurements(photo, ctx),
            h('div', { class: 'detail-actions' },
              h('button', { type: 'button', class: 'btn btn--primary', onclick: () => handlers.download(photo.id) }, icon('download'), 'Download original')))),
      ),
    );
    dialog.setAttribute('aria-labelledby', 'detailTitle');
    if (!dialog.open) dialog.showModal();
  }

  return { show, get currentId() { return currentId; }, close: () => dialog.open && dialog.close() };
}
