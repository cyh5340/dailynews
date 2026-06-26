// 🟦 Person A — fetch stories (Google News RSS, Reuters RSS, NewsAPI, GDELT). See DESIGN.md §5.
//
// Per-source try/catch: one dead feed must not abort the run. Each source is time-boxed (~10s).

import Parser from 'rss-parser';
import type { RawStory } from '../shared/types';

const FETCH_TIMEOUT_MS = 10_000;
const PER_SOURCE_LIMIT = 25;

const rss = new Parser({ timeout: FETCH_TIMEOUT_MS });

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// --- Google News RSS ---
async function fromGoogleNews(): Promise<RawStory[]> {
  const feed = await rss.parseURL('https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en');
  return (feed.items ?? []).slice(0, PER_SOURCE_LIMIT).map((i) => ({
    title: i.title ?? '',
    url: i.link ?? '',
    source: 'google-news',
    published_at: i.isoDate ?? i.pubDate ?? new Date().toISOString(),
    summary: i.contentSnippet ?? i.content ?? '',
  }));
}

// --- Reuters (via Google News site-scoped search; Reuters' own RSS feeds are defunct) ---
async function fromReuters(): Promise<RawStory[]> {
  const feed = await rss.parseURL(
    'https://news.google.com/rss/search?q=when:1d%20site:reuters.com&hl=en-US&gl=US&ceid=US:en',
  );
  return (feed.items ?? []).slice(0, PER_SOURCE_LIMIT).map((i) => ({
    title: i.title ?? '',
    url: i.link ?? '',
    source: 'reuters',
    published_at: i.isoDate ?? i.pubDate ?? new Date().toISOString(),
    summary: i.contentSnippet ?? i.content ?? '',
  }));
}

// --- NewsAPI top-headlines ---
async function fromNewsApi(): Promise<RawStory[]> {
  const key = process.env.NEWS_API_KEY;
  if (!key) throw new Error('NEWS_API_KEY not set');
  const url = `https://newsapi.org/v2/top-headlines?country=us&pageSize=${PER_SOURCE_LIMIT}&apiKey=${key}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`NewsAPI ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    articles?: { title: string; url: string; publishedAt: string; description?: string }[];
  };
  return (json.articles ?? []).map((a) => ({
    title: a.title ?? '',
    url: a.url ?? '',
    source: 'newsapi',
    published_at: a.publishedAt ?? new Date().toISOString(),
    summary: a.description ?? '',
  }));
}

// --- GDELT Doc API ---
async function fromGdelt(): Promise<RawStory[]> {
  const query = encodeURIComponent('(breaking OR announces OR launches) sourcelang:english');
  const url =
    `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}` +
    `&mode=ArtList&format=json&maxrecords=${PER_SOURCE_LIMIT}&sort=DateDesc`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`GDELT ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    articles?: { title: string; url: string; seendate: string }[];
  };
  return (json.articles ?? []).map((a) => ({
    title: a.title ?? '',
    url: a.url ?? '',
    source: 'gdelt',
    // seendate is e.g. 20260625T060000Z — normalize to ISO
    published_at: parseGdeltDate(a.seendate),
    summary: '',
  }));
}

function parseGdeltDate(s: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s ?? '');
  if (!m) return new Date().toISOString();
  const [, y, mo, d, h, mi, se] = m;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${se}Z`).toISOString();
}

const SOURCES: { name: string; fn: () => Promise<RawStory[]> }[] = [
  { name: 'newsapi', fn: fromNewsApi },
  { name: 'google-news', fn: fromGoogleNews },
  { name: 'reuters', fn: fromReuters },
  { name: 'gdelt', fn: fromGdelt },
];

// Fetch all sources concurrently; failures are logged and skipped, never fatal.
export async function crawl(): Promise<RawStory[]> {
  const results = await Promise.allSettled(SOURCES.map((s) => s.fn()));
  const stories: RawStory[] = [];
  results.forEach((r, i) => {
    const name = SOURCES[i].name;
    if (r.status === 'fulfilled') {
      const valid = r.value.filter((s) => s.title && s.url);
      console.log(`   crawler: ${name} -> ${valid.length} stories`);
      stories.push(...valid);
    } else {
      console.warn(`   crawler: ${name} FAILED -> ${r.reason?.message ?? r.reason}`);
    }
  });
  return stories;
}
