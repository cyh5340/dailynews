// 🟦 Person A — cosine-similarity dedup (0.85) + relevance scoring. See DESIGN.md §5.
//
// Primary path is local TF-IDF cosine over headline+summary tokens: deterministic, zero-cost,
// no external embeddings call. (Swap in an embeddings provider later behind `vectorize()`.)
// Near-duplicates (cosine >= 0.85) collapse to the highest-relevance representative.

import type { RawStory, ScoredStory } from '../shared/types';

const SIMILARITY_THRESHOLD = 0.85;

// Coarse relevance prior per source.
const SOURCE_WEIGHT: Record<string, number> = {
  newsapi: 1.0,
  reuters: 1.0,
  'google-news': 0.9,
  gdelt: 0.7,
};

const STOPWORDS = new Set(
  ('a an the of to in on for and or but with as at by from is are was were be been ' +
    'this that these those it its his her their our your my we you they he she them us ' +
    'has have had will would can could says said new after over into out up down').split(' '),
);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

// Build TF-IDF vectors for the corpus, then return them aligned to the input order.
function buildTfIdf(docs: string[][]): Map<string, number>[] {
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const term of new Set(doc)) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const n = docs.length;
  return docs.map((doc) => {
    const tf = new Map<string, number>();
    for (const term of doc) tf.set(term, (tf.get(term) ?? 0) + 1);
    const vec = new Map<string, number>();
    for (const [term, count] of tf) {
      const idf = Math.log((n + 1) / ((df.get(term) ?? 0) + 1)) + 1;
      vec.set(term, count * idf);
    }
    return vec;
  });
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const [term, w] of small) {
    const other = large.get(term);
    if (other) dot += w * other;
  }
  const mag = (v: Map<string, number>) =>
    Math.sqrt([...v.values()].reduce((s, w) => s + w * w, 0));
  const denom = mag(a) * mag(b);
  return denom === 0 ? 0 : dot / denom;
}

function relevance(story: RawStory): number {
  const sourceWeight = SOURCE_WEIGHT[story.source] ?? 0.6;
  const hoursAgo = Math.max(0, (Date.now() - Date.parse(story.published_at)) / 3_600_000);
  const recency = Number.isFinite(hoursAgo) ? Math.exp(-hoursAgo / 24) : 0.5; // ~1d half-life
  // light shareability signal: numbers / quotes / proper-noun density in the headline
  const punch = /[0-9]|["']|\b[A-Z][a-z]+\b/.test(story.title) ? 1 : 0.85;
  return sourceWeight * (0.7 * recency + 0.3) * punch;
}

// Dedup + score. Returns representatives sorted by relevance (highest first).
export function dedupAndScore(stories: RawStory[]): ScoredStory[] {
  if (stories.length === 0) return [];

  const scored: ScoredStory[] = stories
    .map((s) => ({ ...s, relevance: relevance(s) }))
    .sort((a, b) => b.relevance - a.relevance);

  const docs = scored.map((s) => tokenize(`${s.title} ${s.summary}`));
  const vectors = buildTfIdf(docs);

  const kept: ScoredStory[] = [];
  const keptVectors: Map<string, number>[] = [];
  let dropped = 0;

  for (let i = 0; i < scored.length; i++) {
    const isDup = keptVectors.some((kv) => cosine(kv, vectors[i]) >= SIMILARITY_THRESHOLD);
    if (isDup) {
      dropped++;
      continue;
    }
    kept.push(scored[i]);
    keptVectors.push(vectors[i]);
  }

  console.log(`   dedup: ${scored.length} -> ${kept.length} (dropped ${dropped} near-dupes)`);
  return kept;
}
