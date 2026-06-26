import { kv } from '@vercel/kv';

export const COST_ESTIMATES = {
  minimax_image: 0.012,
  minimax_video_6s: 0.08,
  minimax_tts: 0.003,
  blob_upload: 0.001,
} as const;

export type CostStage = keyof typeof COST_ESTIMATES;

interface DailyCost {
  total_usd: number;
  stages: Partial<Record<CostStage, number>>;
}

function todayKey(): string {
  return `cost:${new Date().toISOString().slice(0, 10)}`;
}

function budgetUsd(): number {
  const raw = process.env.DAILY_VIDEO_BUDGET_USD ?? '5';
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

async function readLedger(): Promise<DailyCost> {
  return (await kv.get<DailyCost>(todayKey())) ?? { total_usd: 0, stages: {} };
}

export async function getDailySpend(): Promise<number> {
  return (await readLedger()).total_usd;
}

export async function wouldExceedBudget(estimateUsd: number): Promise<boolean> {
  const ledger = await readLedger();
  return ledger.total_usd + estimateUsd > budgetUsd();
}

export async function recordCost(stage: CostStage, costUsd: number): Promise<void> {
  const ledger = await readLedger();
  ledger.total_usd = Number((ledger.total_usd + costUsd).toFixed(6));
  ledger.stages[stage] = Number(((ledger.stages[stage] ?? 0) + costUsd).toFixed(6));
  await kv.set(todayKey(), ledger);
}

export async function guardPaidCall(
  stage: CostStage,
): Promise<{ allowed: boolean; estimate: number }> {
  const estimate = COST_ESTIMATES[stage];
  const allowed = !(await wouldExceedBudget(estimate));
  return { allowed, estimate };
}