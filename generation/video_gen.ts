import { guardPaidCall, recordCost } from '../shared/cost_tracker';
import { logStage } from '../shared/log';
import { downloadFile, minimaxFetch } from '../shared/minimax';
import type { PromptPackage } from '../shared/types';

interface VideoTaskResponse {
  task_id?: string;
}

interface VideoQueryResponse {
  status?: 'Preparing' | 'Queueing' | 'Processing' | 'Success' | 'Fail';
  file_id?: string;
}

const POLL_INTERVAL_MS = 4_000;
const POLL_TIMEOUT_MS = 240_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface VideoGenResult {
  buffer: Buffer;
  costUsd: number;
}

export async function generateVideo(
  pkg: PromptPackage,
  imageUrl: string,
): Promise<VideoGenResult> {
  const started = Date.now();
  const guard = await guardPaidCall('minimax_video_6s');
  if (!guard.allowed) {
    logStage({
      stage: 'video_gen',
      story_id: pkg.story_id,
      ms: Date.now() - started,
      cost_usd: 0,
      status: 'skipped',
      detail: 'budget_exceeded',
    });
    throw new Error('Daily budget exceeded before video generation');
  }

  try {
    const task = await minimaxFetch<VideoTaskResponse>('/v1/video_generation', {
      method: 'POST',
      body: JSON.stringify({
        model: 'MiniMax-Hailuo-2.3-Fast',
        first_frame_image: imageUrl,
        prompt: pkg.motion_prompt,
        duration: 6,
        resolution: '768P',
        prompt_optimizer: true,
      }),
    });

    if (!task.task_id) throw new Error('MiniMax video task_id missing');

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let fileId: string | undefined;

    while (Date.now() < deadline) {
      try {
        const query = await minimaxFetch<VideoQueryResponse>(
          `/v1/query/video_generation?task_id=${encodeURIComponent(task.task_id)}`,
        );

        if (query.status === 'Success') {
          fileId = query.file_id;
          break;
        }
        if (query.status === 'Fail') {
          throw new Error('MiniMax video generation failed');
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'MiniMax video generation failed') {
          throw error;
        }
        console.warn(
          JSON.stringify({
            ts: new Date().toISOString(),
            stage: 'video_gen_poll',
            story_id: pkg.story_id,
            detail: error instanceof Error ? error.message : 'unknown_error',
          }),
        );
      }
      await sleep(POLL_INTERVAL_MS);
    }

    if (!fileId) throw new Error('MiniMax video generation timed out');

    const buffer = await downloadFile(fileId);
    await recordCost('minimax_video_6s', guard.estimate);

    logStage({
      stage: 'video_gen',
      story_id: pkg.story_id,
      ms: Date.now() - started,
      cost_usd: guard.estimate,
      status: 'ok',
    });

    return { buffer, costUsd: guard.estimate };
  } catch (error) {
    logStage({
      stage: 'video_gen',
      story_id: pkg.story_id,
      ms: Date.now() - started,
      cost_usd: 0,
      status: 'error',
      detail: error instanceof Error ? error.message : 'unknown_error',
    });
    throw error;
  }
}