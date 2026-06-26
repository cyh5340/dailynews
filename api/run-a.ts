// 🟦 Cron entry (0 6 * * *): crawl → dedup → summarize → enqueue. See DESIGN.md §2, §8.
//
// Vercel function: GET handler. Locally runnable too:
//   npx tsx api/run-a.ts          (writes to Vercel KV — needs KV_REST_API_* env)
//   npx tsx api/run-a.ts --dry    (skips KV; prints the packages it would enqueue)

import 'dotenv/config';
import { crawl } from '../data/crawler';
import { dedupAndScore } from '../data/dedup';
import { summarize } from '../data/summarizer';
import { generateAndEnqueue } from '../data/prompt_gen';
import type { ScoredStory, SummaryResult } from '../shared/types';

const TOP_N = Number(process.env.TOP_N_STORIES ?? 5);

export interface RunAResult {
  crawled: number;
  deduped: number;
  considered: number;
  enqueued: number;
  story_ids: string[];
}

export async function runPersonA(dryRun = false): Promise<RunAResult> {
  console.log('▶ [run-a] crawl');
  const raw = await crawl();

  console.log('▶ [run-a] dedup + score');
  const deduped = dedupAndScore(raw);
  const top = deduped.slice(0, TOP_N);
  console.log(`   considering top ${top.length} of ${deduped.length}`);

  console.log('▶ [run-a] summarize');
  const summarized = await Promise.allSettled(top.map((s) => summarize(s)));
  const items: { story: ScoredStory; summary: SummaryResult }[] = [];
  summarized.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      items.push({ story: top[i], summary: r.value });
    } else {
      console.warn(`   summarize FAILED "${top[i].title}" -> ${r.reason?.message ?? r.reason}`);
    }
  });

  console.log('▶ [run-a] prompt_gen + enqueue');
  const enqueued = await generateAndEnqueue(items, dryRun);

  const result: RunAResult = {
    crawled: raw.length,
    deduped: deduped.length,
    considered: top.length,
    enqueued: enqueued.length,
    story_ids: enqueued.map((p) => p.story_id),
  };
  console.log(`▶ [run-a] done: ${JSON.stringify(result)}`);
  return result;
}

// Vercel function entry. Fire-and-forget is recommended for long runs (see DESIGN.md §8);
// run-a is short (crawl + a few LLM calls), so we run inline and return the summary.
export async function GET(): Promise<Response> {
  const result = await runPersonA();
  return Response.json(result, { status: 200 });
}

// Local CLI
const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isDirectRun) {
  runPersonA(process.argv.includes('--dry')).catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
