// 🟦 Person A — render prompt packages → write to Vercel KV. See DESIGN.md §5.
//
// Turns a (story, summary) pair into a full PromptPackage, enforcing the contract's length
// limits (captions <= 60, voiceover <= 200). Stories below MIN_MEME_SCORE are dropped.

import { randomUUID } from 'node:crypto';
import type { PromptPackage, ScoredStory, SummaryResult, Tone } from '../shared/types';
import { enqueue } from '../shared/queue';

const MIN_MEME_SCORE = Number(process.env.MIN_MEME_SCORE ?? 6);

// Per-tone visual + motion styling.
const TONE_STYLE: Record<Tone, { image: string; motion: string }> = {
  absurd: {
    image: 'surreal absurdist meme art, exaggerated, vivid saturated colors, chaotic energy',
    motion: 'quick punch-in with a slight shake, chaotic comedic energy',
  },
  political: {
    image: 'satirical editorial cartoon style, dramatic lighting, exaggerated caricature',
    motion: 'slow dramatic push-in, cinematic and tense',
  },
  wholesome: {
    image: 'warm heartwarming illustration, soft golden lighting, cute and cozy',
    motion: 'gentle slow zoom with a soft drift, calm and uplifting',
  },
};

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + '…';
}

export function buildPackage(story: ScoredStory, summary: SummaryResult): PromptPackage {
  const style = TONE_STYLE[summary.tone];
  const subject = summary.entities.length ? summary.entities.join(', ') : story.title;

  return {
    story_id: randomUUID(),
    headline: story.title,
    tone: summary.tone,
    meme_score: summary.meme_score,
    image_prompt: `${subject}: ${summary.punchline}. ${style.image}. 1:1 square composition, high detail.`,
    motion_prompt: style.motion,
    caption_top: truncate(story.title.toUpperCase(), 60),
    caption_bottom: truncate(summary.punchline.toUpperCase(), 60),
    voiceover_script: truncate(summary.punchline, 200),
    status: 'pending',
    image_url: '',
    video_url: '',
    output_url: '',
    created_at: new Date().toISOString(),
  };
}

// Build + enqueue packages for the scored/summarized stories. Returns the enqueued packages.
// Pass dryRun=true to skip KV writes (local iteration without Vercel KV).
export async function generateAndEnqueue(
  items: { story: ScoredStory; summary: SummaryResult }[],
  dryRun = false,
): Promise<PromptPackage[]> {
  const enqueued: PromptPackage[] = [];
  for (const { story, summary } of items) {
    if (summary.meme_score < MIN_MEME_SCORE) {
      console.log(`   prompt_gen: skip (meme_score ${summary.meme_score} < ${MIN_MEME_SCORE}) "${story.title}"`);
      continue;
    }
    const pkg = buildPackage(story, summary);
    if (!dryRun) await enqueue(pkg);
    enqueued.push(pkg);
    console.log(`   prompt_gen: ${dryRun ? 'built' : 'enqueued'} ${pkg.story_id} [${pkg.tone}/${pkg.meme_score}]`);
  }
  return enqueued;
}
