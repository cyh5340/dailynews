import { addCaptions } from './caption';
import { generateImage } from './image_gen';
import { buildSummary, postSlackSummary, publishFinal, uploadToBlob } from './publisher';
import type { PublishSummaryItem } from './publisher';
import { generateVideo } from './video_gen';
import { mergeVoiceover } from './voiceover';
import * as queue from '../shared/queue';
import type { PromptPackage } from '../shared/types';

function toDataUrl(buffer: Buffer, mime = 'image/png'): string {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

async function processPending(pkg: PromptPackage): Promise<PromptPackage> {
  const image = await generateImage(pkg);
  const captioned = await addCaptions(image.buffer, pkg);
  const imageUrl = await uploadToBlob(
    pkg.story_id,
    'image',
    captioned,
    'image/png',
    pkg.image_url || undefined,
  );
  return queue.update(pkg.story_id, { status: 'image_done', image_url: imageUrl });
}

async function processImageDone(pkg: PromptPackage): Promise<PromptPackage> {
  const sourceUrl = pkg.image_url || toDataUrl(await fetchImageBuffer(pkg));
  const video = await generateVideo(pkg, sourceUrl);
  const videoUrl = await uploadToBlob(
    pkg.story_id,
    'video',
    video.buffer,
    'video/mp4',
    pkg.video_url || undefined,
  );
  return queue.update(pkg.story_id, { status: 'video_done', video_url: videoUrl });
}

async function fetchImageBuffer(pkg: PromptPackage): Promise<Buffer> {
  if (!pkg.image_url) throw new Error(`story ${pkg.story_id} missing image_url`);
  const res = await fetch(pkg.image_url);
  if (!res.ok) throw new Error(`failed to fetch image_url (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function processVideoDone(pkg: PromptPackage): Promise<PromptPackage> {
  if (!pkg.video_url) throw new Error(`story ${pkg.story_id} missing video_url`);

  const res = await fetch(pkg.video_url);
  if (!res.ok) throw new Error(`failed to fetch video_url (${res.status})`);
  const silentVideo = Buffer.from(await res.arrayBuffer());

  const finalBuffer = await mergeVoiceover(silentVideo, pkg);
  const outputUrl = await publishFinal(pkg, finalBuffer, pkg.output_url || undefined);
  return queue.update(pkg.story_id, {
    status: 'published',
    output_url: outputUrl,
  });
}

export async function processStory(storyId: string): Promise<PublishSummaryItem> {
  let pkg = await queue.get(storyId);
  if (!pkg) {
    return {
      story_id: storyId,
      headline: storyId,
      output_url: '',
      status: 'failed',
      error: 'story_not_found',
    };
  }

  try {
    if (pkg.status === 'pending') {
      pkg = await processPending(pkg);
    } else if (pkg.status === 'image_done') {
      pkg = await processImageDone(pkg);
    } else if (pkg.status === 'video_done') {
      pkg = await processVideoDone(pkg);
    }

    return {
      story_id: pkg.story_id,
      headline: pkg.headline,
      output_url: pkg.output_url,
      status: pkg.status === 'published' ? 'published' : 'failed',
      error: pkg.status === 'published' ? undefined : `stuck_at_${pkg.status}`,
    };
  } catch (error) {
    return {
      story_id: pkg.story_id,
      headline: pkg.headline,
      output_url: pkg.output_url ?? '',
      status: 'failed',
      error: error instanceof Error ? error.message : 'unknown_error',
    };
  }
}

export async function drainQueue(): Promise<{
  items: PublishSummaryItem[];
  summary: Awaited<ReturnType<typeof buildSummary>>;
}> {
  const ids = await queue.listPending();
  const items: PublishSummaryItem[] = [];

  for (const storyId of ids) {
    items.push(await processStory(storyId));
  }

  const summary = await buildSummary(items);
  await postSlackSummary(summary);
  return { items, summary };
}