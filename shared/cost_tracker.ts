// ⬜ Shared — per-call cost logging + budget guard (cost:{date}). See DESIGN.md §9.

import { kv } from '@vercel/kv';

const DEFAULT_BUDGET = Number(process.env.DAILY_VIDEO_BUDGET_USD ?? 5.0);

export interface DailyCost {
  total: number;
  byStage: Record<string, number>;
  calls: number;
}

const todayKey = () => {
  const d = new Date();
  return `cost:${d.toISOString().slice(0, 10)}`;
};

async function readDaily(): Promise<DailyCost> {
  const raw = await kv.get<DailyCost>(todayKey());
  if (raw && typeof raw.total === 'number') return raw;
  return { total: 0, byStage: {}, calls: 0 };
}

async function writeDaily(c: DailyCost): Promise<void> {
  await kv.set(todayKey(), c, { ex: 60 * 60 * 24 * 2 }); // keep 2 days
}

/**
 * Returns true if adding `estimateUsd` would exceed the daily budget.
 * Checked BEFORE every paid API call.
 */
export async function wouldExceedBudget(estimateUsd: number): Promise<boolean> {
  const budget = Number.isFinite(DEFAULT_BUDGET) ? DEFAULT_BUDGET : 5.0;
  const current = await readDaily();
  return current.total + estimateUsd > budget;
}

/**
 * Record a paid call cost after success. Appends to daily ledger.
 */
export async function recordCost(
  stage: string,
  costUsd: number,
  meta?: { story_id?: string },
): Promise<void> {
  const current = await readDaily();
  const next: DailyCost = {
    total: Number((current.total + (costUsd || 0)).toFixed(4)),
    byStage: {
      ...current.byStage,
      [stage]: Number(((current.byStage[stage] ?? 0) + (costUsd || 0)).toFixed(4)),
    },
    calls: current.calls + 1,
  };
  await writeDaily(next);

  // structured log for vercel logs
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      stage: `cost:${stage}`,
      cost_usd: costUsd,
      total_today: next.total,
      story_id: meta?.story_id,
    }),
  );
}

/**
 * Get current day's spend (for Slack summaries etc).
 */
export async function getTodaySpend(): Promise<DailyCost> {
  return readDaily();
}

/**
 * Rough per-stage cost estimates (used by generation side).
 * Tune these based on actual provider pricing.
 */
export const COST_ESTIMATES = {
  // Person B stages (MiniMax + Vapi)
  image: 0.012,
  video_6s: 0.08,
  voiceover: 0.003,
  // Person A example (LLM summarizer)
  llm_summary: 0.0015,
} as const;

