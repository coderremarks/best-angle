/**
 * DOM rendering for the sidebar controls and the results area. All text is
 * inserted with textContent / text nodes (never innerHTML), so a file named
 * like "<img onerror=…>.jpg" is shown as text and can't run code.
 */
import { FACTORS, PRESETS } from './lib/scoring.js';
import { TAG_GROUPS, tagKey, tagLabel } from './lib/tags.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Tiny element builder: h('button', { class: 'btn', onclick }, 'Label', childNode). */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  for (const c of children.flat(Infinity)) if (c != null) el.append(c instanceof Node ? c : String(c));
  return el;
}

const ICONS = {
  upload: ['M12 15V3', 'M7 8l5-5 5 5', 'M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4'],
  folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  lock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  cross: ['M7 7l10 10', 'M17 7L7 17'],
  bulb: ['M9 18h6', 'M10 21h4', 'M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z'],
  download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  left: ['M15 5l-7 7 7 7'],
  right: ['M9 5l7 7-7 7'],
  alert: ['M12 9v4', 'M12 17h.01', 'M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'],
  sparkle: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', 'M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z'],
  eye: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
  refresh: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 4v7h-7'],
};

export function icon(name, cls = 'icon') {
  return s('svg', { viewBox: '0 0 24 24', class: cls, 'aria-hidden': 'true', focusable: 'false' },
    ICONS[name].map((d) => s('path', { d })));
}

export const scoreTone = (score) => (score >= 80 ? 'great' : score >= 65 ? 'good' : score >= 50 ? 'ok' : 'weak');

// ---- Sidebar ----------------------------------------------------------------------------

/** Goal buttons. Returns update(activeId). */
export function createPresetPicker(root, onPick) {
  const buttons = Object.entries(PRESETS).map(([id, preset]) => {
    const b = h('button', { type: 'button', class: 'preset', 'aria-pressed': 'false', onclick: () => onPick(id) }, preset.label);
    b.dataset.id = id;
    return b;
  });
  root.replaceChildren(...buttons);
  return (activeId) => {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.id === activeId));
  };
}

/** Tag filter chips, grouped. Built once and updated in place so keyboard focus is kept. */
export function createTagFilters(root, onToggle) {
  const chips = new Map();
  root.replaceChildren(
    ...TAG_GROUPS.map((g) =>
      h('fieldset', { class: 'tag-group' },
        h('legend', {}, g.label, g.mode === 'all' ? h('span', { class: 'legend-hint' }, 'all of these') : null),
        h('div', { class: 'chips' },
          g.tags.map((t) => {
            const key = tagKey(g.id, t.id);
            const count = h('span', { class: 'chip-count' }, '0');
            const chip = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', onclick: () => onToggle(key) }, t.label, count);
            chips.set(key, { chip, count });
            return chip;
          }),
        ),
      ),
    ),
  );
  return ({ counts, selected }) => {
    for (const [key, { chip, count }] of chips) {
      const n = counts.get(key) ?? 0;
      count.textContent = String(n);
      chip.setAttribute('aria-pressed', String(selected.has(key)));
      chip.classList.toggle('chip--empty', n === 0);
    }
  };
}

const weightWord = (w) => (w <= 0 ? 'Off' : w < 1 ? 'Low' : w < 2 ? 'Medium' : w < 2.75 ? 'High' : 'Top');

/** Priority sliders, one per factor. Returns update(weights). */
export function createWeightSliders(root, onChange) {
  const rows = new Map();
  root.replaceChildren(
    ...Object.entries(FACTORS).map(([key, f]) => {
      const id = `weight-${key}`;
      const input = h('input', { type: 'range', id, min: '0', max: '3', step: '0.25', 'aria-describedby': `${id}-hint` });
      const out = h('output', { for: id, class: 'slider-value' });
      input.addEventListener('input', () => onChange(key, Number(input.value)));
      rows.set(key, { input, out });
      return h('div', { class: 'slider' },
        h('div', { class: 'slider-head' }, h('label', { for: id }, f.label), out),
        input,
        h('p', { class: 'slider-hint', id: `${id}-hint` }, f.hint));
    }),
  );
  return (weights) => {
    for (const [key, { input, out }] of rows) {
      const w = weights[key] ?? 0;
      input.value = String(w);
      out.textContent = weightWord(w);
    }
  };
}

// ---- Results ----------------------------------------------------------------------------

const DISPLAY_TAG_ORDER = ['quality:slimming', 'expression:', 'face-angle:', 'framing:', 'eyes:eye-contact'];

function displayTags(tags, limit = 3) {
  const out = [];
  for (const prefix of DISPLAY_TAG_ORDER) {
    for (const t of tags) if (t.startsWith(prefix) && !out.includes(t)) out.push(t);
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

/**
 * Results area. Cards are cached per photo and moved (not rebuilt) between
 * renders, so thumbnails never reload or flicker when filters change.
 */
export function createResults(dom, handlers) {
  const cards = new Map();
  let hero = { id: null, img: null };

  function buildCard(photo) {
    const img = h('img', { src: photo.thumbUrl, alt: '', decoding: 'async', loading: 'lazy' });
    const box = photo.metrics?.face?.box;
    if (box) img.style.objectPosition = `${(box.cx * 100).toFixed(1)}% ${(box.cy * 100).toFixed(1)}%`;
    const rank = h('span', { class: 'card-rank' });
    const score = h('span', { class: 'score-pill' });
    const meta = h('div', { class: 'card-meta' });
    const root = h('button', { type: 'button', class: 'card', onclick: () => handlers.open(photo.id) },
      h('div', { class: 'card-thumb' }, img, rank, score), meta);
    const card = { root, rank, score, meta };
    cards.set(photo.id, card);
    return card;
  }

  function cardFor(photo, { rank = null, missing = null, setSize = 0 } = {}) {
    const c = cards.get(photo.id) ?? buildCard(photo);
    const { score, flags } = photo.result;
    c.rank.textContent = rank ? `#${rank}` : '';
    c.rank.hidden = !rank;
    c.root.classList.toggle('card--top', rank === 1);
    c.score.textContent = String(score);
    c.score.dataset.tone = scoreTone(score);
    c.root.setAttribute('aria-label', `${photo.name}: score ${score} out of 100${rank ? `, ranked #${rank}` : ''}. Open details.`);
    const chips = [
      ...flags.map((f) => h('span', { class: 'mini-chip mini-chip--warn' }, f)),
      ...displayTags(photo.tags).map((t) => h('span', { class: 'mini-chip' }, tagLabel(t))),
    ];
    if (setSize > 1) chips.push(h('span', { class: 'mini-chip mini-chip--set' }, `${setSize} similar`));
    const missingNote = missing?.length
      ? h('p', { class: 'card-missing' }, `Not: ${missing.map((g) => g.label.toLowerCase()).join(', ')}`)
      : null;
    // replaceChildren() would print a literal "null", so drop empty slots first.
    c.meta.replaceChildren(...[missingNote, h('div', { class: 'mini-chips' }, chips)].filter(Boolean));
    return c.root;
  }

  function renderHero(photo, { kind, presetLabel, missing }) {
    if (!photo) {
      dom.topPick.replaceChildren();
      hero = { id: null, img: null };
      return;
    }
    if (hero.id !== photo.id) {
      hero = { id: photo.id, img: h('img', { src: photo.displayUrl, alt: `Top pick: ${photo.name}` }) };
    }
    const r = photo.result;
    dom.topPick.replaceChildren(
      h('article', { class: 'hero', 'aria-labelledby': 'heroTitle' },
        h('button', { type: 'button', class: 'hero-media', onclick: () => handlers.open(photo.id), 'aria-label': `Open ${photo.name}` }, hero.img),
        h('div', { class: 'hero-body' },
          h('p', { class: 'eyebrow', id: 'heroTitle' }, icon('sparkle'), kind === 'match' ? `Top pick · ${presetLabel}` : `Closest match · ${presetLabel}`),
          h('div', { class: 'hero-score', 'data-tone': scoreTone(r.score) },
            h('span', { class: 'hero-score-num' }, String(r.score)),
            h('span', { class: 'hero-score-of' }, '/ 100')),
          kind === 'closest'
            ? h('p', { class: 'hero-note' }, `No photo ticks every filter. This one misses: ${missing.map((g) => g.label.toLowerCase()).join(', ')}.`)
            : null,
          r.highlights.length ? h('h3', { class: 'hero-h' }, 'Why this one') : null,
          h('ul', { class: 'reasons' }, r.highlights.map((t) => h('li', {}, icon('check'), h('span', {}, t)))),
          r.flags.length ? h('p', { class: 'flags' }, icon('alert'), r.flags.join(' · ')) : null,
          h('div', { class: 'hero-actions' },
            h('button', { type: 'button', class: 'btn btn--primary', onclick: () => handlers.open(photo.id) }, icon('eye'), 'Full breakdown'),
            h('button', { type: 'button', class: 'btn', onclick: () => handlers.download(photo.id) }, icon('download'), 'Download')),
          h('p', { class: 'hero-file', title: photo.name }, photo.name),
        ),
      ),
    );
  }

  function render({ view, photos, presetLabel, filtering }) {
    const get = (it) => photos.get(it.id);
    const setSize = (it) => view.setSizes.get(handlers.setOf(it.id)) ?? 0;

    const top = view.matches[0] ?? view.others[0] ?? null;
    renderHero(top && get(top), {
      kind: view.matches.length ? 'match' : 'closest',
      presetLabel,
      missing: top ? view.unmet.get(top.id) ?? [] : [],
    });

    dom.matchTitle.textContent = filtering ? 'Matches your filters' : 'All photos, best first';
    dom.matchCount.textContent = String(view.matches.length);
    dom.grid.replaceChildren(...view.matches.map((it, i) => cardFor(get(it), { rank: i + 1, setSize: setSize(it) })));
    dom.emptyMatches.hidden = view.matches.length > 0 || !filtering;

    dom.othersWrap.hidden = !view.others.length;
    dom.othersCount.textContent = String(view.others.length);
    dom.othersGrid.replaceChildren(...view.others.map((it) => cardFor(get(it), { missing: view.unmet.get(it.id), setSize: setSize(it) })));

    dom.dupesWrap.hidden = !view.duplicates.length;
    dom.dupesCount.textContent = String(view.duplicates.length);
    dom.dupesGrid.replaceChildren(...view.duplicates.map((it) => cardFor(get(it), { setSize: setSize(it) })));

    dom.nofaceWrap.hidden = !view.noFace.length;
    dom.nofaceCount.textContent = String(view.noFace.length);
    dom.nofaceGrid.replaceChildren(...view.noFace.map((it) => cardFor(get(it))));
  }

  return {
    render,
    clear() {
      cards.clear();
      hero = { id: null, img: null };
      for (const el of [dom.topPick, dom.grid, dom.othersGrid, dom.dupesGrid, dom.nofaceGrid]) el.replaceChildren();
    },
  };
}

// ---- Progress / status ----------------------------------------------------------------

export function renderStatus(dom, { phase, done, total, current, errors, onRetry }) {
  const show = phase !== 'idle' || errors.length > 0;
  dom.status.hidden = !show;
  if (!show) return;
  const pct = total ? Math.round((done / total) * 100) : 0;
  dom.statusBar.classList.toggle('bar--indeterminate', phase === 'models');
  dom.statusBar.style.setProperty('--pct', `${pct}%`);
  dom.statusBar.hidden = phase === 'idle' || phase === 'error';
  const parts = [];
  if (phase === 'models') parts.push(h('strong', {}, 'Loading the AI models…'), ' First run downloads about 25 MB; after that it is cached.');
  else if (phase === 'analyzing') parts.push(h('strong', {}, `Analysing photo ${Math.min(done + 1, total)} of ${total}`), current ? h('span', { class: 'status-file' }, current) : null);
  else if (phase === 'error') {
    parts.push(icon('alert'), h('strong', {}, "Couldn't load the AI models."), ' Check your internet connection (only needed the first time).',
      h('button', { type: 'button', class: 'btn btn--small', onclick: onRetry }, icon('refresh'), 'Try again'));
  }
  if (errors.length) {
    parts.push(h('details', { class: 'status-errors' },
      h('summary', {}, `${errors.length} file${errors.length > 1 ? 's' : ''} couldn't be read`),
      h('ul', {}, errors.map((e) => h('li', {}, h('span', { class: 'status-file' }, e.name), ` (${e.error})`)))));
  }
  dom.statusText.replaceChildren(...parts.filter(Boolean));
}
