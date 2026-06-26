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
  created_at: string; // 🟦 A — ISO8601
}

export interface RawStory {
  title: string;
  url: string;
  source: string; // crawler source key: newsapi | google-news | reuters | gdelt
  published_at: string; // ISO8601
  summary: string;
}

// 🟦 A — dedup output: a representative story with a computed relevance score.
export type ScoredStory = RawStory & { relevance: number };

// 🟦 A — strict JSON shape returned by the summarizer LLM call. See DESIGN.md §5.
export interface SummaryResult {
  punchline: string;
  tone: Tone;
  entities: string[];
  meme_score: number; // 1..10
}
