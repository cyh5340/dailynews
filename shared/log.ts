export interface StageLog {
  ts: string;
  stage: string;
  story_id: string;
  ms: number;
  cost_usd: number;
  status: 'ok' | 'error' | 'skipped';
  detail?: string;
}

export function logStage(entry: Omit<StageLog, 'ts'>): void {
  const line: StageLog = { ts: new Date().toISOString(), ...entry };
  console.log(JSON.stringify(line));
}