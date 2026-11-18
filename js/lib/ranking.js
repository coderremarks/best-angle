/**
 * Filtering, ranking and near-duplicate grouping. Works on plain summary
 * objects so it can be tested without images:
 *   { id, order, score, sharpness, tags: Set<string>, hasFace, hash, takenAt }
 */
import { hammingWords, hashWords } from './imagestats.js';
import { TAG_GROUPS, tagKey } from './tags.js';

/** Groups whose selected tags the photo doesn't satisfy (empty = it matches). */
export function unmetGroups(tags, selected, groups = TAG_GROUPS) {
  const unmet = [];
  for (const g of groups) {
    const chosen = g.tags.map((t) => tagKey(g.id, t.id)).filter((k) => selected.has(k));
    if (!chosen.length) continue;
    const ok = g.mode === 'all' ? chosen.every((k) => tags.has(k)) : chosen.some((k) => tags.has(k));
    if (!ok) unmet.push(g);
  }
  return unmet;
}

export const matchesFilters = (tags, selected, groups = TAG_GROUPS) => unmetGroups(tags, selected, groups).length === 0;

/** Highest score first; sharper wins ties; then upload order for stability. */
export function byScore(a, b) {
  return b.score - a.score || (b.sharpness ?? 0) - (a.sharpness ?? 0) || a.order - b.order;
}

/**
 * Finds sets of near-identical shots (bursts, retakes) using a perceptual
 * hash, plus capture time when both photos have it.
 * @returns {Map<string, string>} photo id → set id, only for sets of 2+
 */
export function similarSets(items, { maxBits = 10, maxSeconds = 120 } = {}) {
  const parent = new Map(items.map((it) => [it.id, it.id]));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const words = items.map((it) => (it.hash ? hashWords(it.hash) : null));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (!words[i] || !words[j]) continue;
      if (a.takenAt && b.takenAt && Math.abs(a.takenAt - b.takenAt) > maxSeconds * 1000) continue;
      if (hammingWords(words[i], words[j]) <= maxBits) parent.set(find(a.id), find(b.id));
    }
  }
  const members = new Map();
  for (const it of items) {
    const root = find(it.id);
    members.set(root, (members.get(root) ?? 0) + 1);
  }
  const setOf = new Map();
  for (const it of items) {
    const root = find(it.id);
    if (members.get(root) > 1) setOf.set(it.id, root);
  }
  return setOf;
}

/**
 * Everything the results screen needs.
 * @param items     photo summaries (see top of file)
 * @param selected  Set of selected tag keys
 * @param setOf     Map id → similar-set id (from similarSets)
 * @param bestOfSets keep only the top-scoring shot of each similar set
 */
export function buildView(items, { selected = new Set(), setOf = new Map(), bestOfSets = false, groups = TAG_GROUPS } = {}) {
  const withFace = items.filter((it) => it.hasFace);
  const noFace = items.filter((it) => !it.hasFace).sort(byScore);

  const bestOfSet = new Map();
  for (const it of withFace) {
    const set = setOf.get(it.id);
    if (!set) continue;
    const current = bestOfSet.get(set);
    if (!current || byScore(it, current) < 0) bestOfSet.set(set, it);
  }
  const isHiddenDuplicate = (it) => bestOfSets && setOf.has(it.id) && bestOfSet.get(setOf.get(it.id)) !== it;

  const matches = [];
  const others = [];
  const unmet = new Map();
  const duplicates = [];
  for (const it of withFace) {
    if (isHiddenDuplicate(it)) {
      duplicates.push(it);
      continue;
    }
    const missing = unmetGroups(it.tags, selected, groups);
    if (missing.length) {
      unmet.set(it.id, missing);
      others.push(it);
    } else matches.push(it);
  }
  matches.sort(byScore);
  others.sort((a, b) => unmet.get(a.id).length - unmet.get(b.id).length || byScore(a, b));
  duplicates.sort(byScore);

  const setSizes = new Map();
  for (const set of setOf.values()) setSizes.set(set, (setSizes.get(set) ?? 0) + 1);

  return { matches, others, unmet, noFace, duplicates, setSizes };
}

/** How many analysed photos carry each tag (shown on the filter chips). */
export function tagCounts(items) {
  const counts = new Map();
  for (const it of items) for (const t of it.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}
