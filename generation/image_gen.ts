import { guardPaidCall, recordCost } from '../shared/cost_tracker';
import { logStage } from '../shared/log';
import { minimaxFetch } from '../shared/minimax';
import type { PromptPackage } from '../shared/types';

interface ImageGenResponse {
  data?: { image_urls?: string[]; image_base64?: string[] };
}

export interface ImageGenResult {
  buffer: Buffer;
  costUsd: number;
}

export async function generateImage(pkg: PromptPackage): Promise<ImageGenResult> {
  const started = Date.now();
  const guard = await guardPaidCall('minimax_image');
  if (!guard.allowed) {
    logStage({
      stage: 'image_gen',
      story_id: pkg.story_id,
      ms: Date.now() - started,
      cost_usd: 0,
      status: 'skipped',
      detail: 'budget_exceeded',
    });
    throw new Error('Daily budget exceeded before image generation');
  }

  try {
    const body = await minimaxFetch<ImageGenResponse>('/v1/image_generation', {
      method: 'POST',
      body: JSON.stringify({
        model: 'image-01',
        prompt: pkg.image_prompt,
        aspect_ratio: '1:1',
        response_format: 'base64',
        n: 1,
        prompt_optimizer: true,
      }),
    });

    const b64 = body.data?.image_base64?.[0];
    if (!b64) throw new Error('MiniMax image response missing image_base64');

    await recordCost('minimax_image', guard.estimate);
    logStage({
      stage: 'image_gen',
      story_id: pkg.story_id,
      ms: Date.now() - started,
      cost_usd: guard.estimate,
      status: 'ok',
    });

    return { buffer: Buffer.from(b64, 'base64'), costUsd: guard.estimate };
  } catch (error) {
    logStage({
      stage: 'image_gen',
      story_id: pkg.story_id,
      ms: Date.now() - started,
      cost_usd: 0,
      status: 'error',
      detail: error instanceof Error ? error.message : 'unknown_error',
    });
    throw error;
  }
}