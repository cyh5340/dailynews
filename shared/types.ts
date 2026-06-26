// ⬜ Shared — PromptPackage / Status types (interface contract). See DESIGN.md §6.

export type Tone = 'absurd' | 'political' | 'wholesome';

export type Status = 'pending' | 'image_done' | 'video_done' | 'published';

export interface PromptPackage {
  story_id: string; // 🟦 A — UUID
  headline: string; // 🟦 A
  tone: Tone; // 🟦 A
  meme_score: number; // 🟦 A — 1..10
  image_prompt: string; // 🟦 A — MiniMax Image prompt
  motion_prompt: string; // 🟦 A — Hailuo motion description
  caption_top: string; // 🟦 A — max 60 chars
  caption_bottom: string; // 🟦 A — max 60 chars
  voiceover_script: string; // 🟦 A — max 200 chars
  status: Status; // 🟥 B
  image_url: string; // 🟥 B — Vercel Blob URL
  video_url: string; // 🟥 B — Vercel Blob URL
  output_url: string; // 🟥 B — final published URL
  video_task_id?: string; // 🟥 B — in-flight Hailuo task for resume
  created_at: string; // 🟦 A — ISO8601
}

export interface RawStory {
  title: string;
  url: string;
  source: string;
  published_at: string;
  summary: string;
}
