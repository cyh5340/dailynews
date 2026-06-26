import { head, list, put } from '@vercel/blob';
import { guardPaidCall, getDailySpend, recordCost } from '../shared/cost_tracker';
import { logStage } from '../shared/log';
import type { PromptPackage } from '../shared/types';

export interface PublishSummaryItem {
  story_id: string;
  headline: string;
  output_url: string;
  status: 'published' | 'failed';
  error?: string;
}

export interface DailySummary {
  processed: number;
  published: number;
  failed: number;
  total_cost_usd: number;
  budget_usd: number;
  items: PublishSummaryItem[];
}

function blobPathname(
  storyId: string,
  kind: 'image' | 'video' | 'final',
  contentType: string,
): string {
  const ext = contentType.includes('png')
    ? 'png'
    : contentType.includes('jpeg')
      ? 'jpg'
      : 'mp4';
  return `dailynews/${storyId}/${kind}.${ext}`;
}

async function findExistingBlobUrl(pathname: string): Promise<string | null> {
  const prefix = pathname.slice(0, pathname.lastIndexOf('/') + 1);
  const { blobs } = await list({ prefix, limit: 20 });
  const match = blobs.find((blob) => blob.pathname === pathname);
  return match?.url ?? null;
}

export async function uploadToBlob(
  storyId: string,
  kind: 'image' | 'video' | 'final',
  buffer: Buffer,
  contentType: string,
  existingUrl?: string,
): Promise<string> {
  const guard = await guardPaidCall('blob_upload');
  if (!guard.allowed) throw new Error('Daily budget exceeded before blob upload');

  const pathname = blobPathname(storyId, kind, contentType);

  if (existingUrl) {
    try {
      const meta = await head(existingUrl);
      if (meta.pathname === pathname) return existingUrl;
    } catch {
      // fall through and re-upload or resolve by pathname
    }
  }

  const cached = await findExistingBlobUrl(pathname);
  if (cached) return cached;

  try {
    const blob = await put(pathname, buffer, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
    });
    await recordCost('blob_upload', guard.estimate);
    return blob.url;
  } catch (error) {
    const recovered = await findExistingBlobUrl(pathname);
    if (recovered) return recovered;
    throw error;
  }
}

export async function publishFinal(
  pkg: PromptPackage,
  finalBuffer: Buffer,
  existingUrl?: string,
): Promise<string> {
  const started = Date.now();
  try {
    const outputUrl = await uploadToBlob(
      pkg.story_id,
      'final',
      finalBuffer,
      'video/mp4',
      existingUrl,
    );

    logStage({
      stage: 'publisher',
      story_id: pkg.story_id,
      ms: Date.now() - started,
      cost_usd: 0,
      status: 'ok',
    });
    return outputUrl;
  } catch (error) {
    logStage({
      stage: 'publisher',
      story_id: pkg.story_id,
      ms: Date.now() - started,
      cost_usd: 0,
      status: 'error',
      detail: error instanceof Error ? error.message : 'unknown_error',
    });
    throw error;
  }
}

export async function postSlackSummary(summary: DailySummary): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return;

  const lines = summary.items.map((item) => {
    if (item.status === 'published') return `• ${item.headline}\n  ${item.output_url}`;
    return `• FAILED: ${item.headline} — ${item.error ?? 'unknown'}`;
  });

  const text = [
    '*Daily Meme Video Summary*',
    `Processed: ${summary.processed} | Published: ${summary.published} | Failed: ${summary.failed}`,
    `Cost: $${summary.total_cost_usd.toFixed(4)} / $${summary.budget_usd.toFixed(2)} budget`,
    '',
    ...lines,
  ].join('\n');

  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        stage: 'slack_summary',
        status: 'error',
        detail: error instanceof Error ? error.message : 'unknown_error',
      }),
    );
  }
}

export async function buildSummary(items: PublishSummaryItem[]): Promise<DailySummary> {
  const budget = Number(process.env.DAILY_VIDEO_BUDGET_USD ?? '5');
  return {
    processed: items.length,
    published: items.filter((i) => i.status === 'published').length,
    failed: items.filter((i) => i.status === 'failed').length,
    total_cost_usd: await getDailySpend(),
    budget_usd: Number.isFinite(budget) ? budget : 5,
    items,
  };
}