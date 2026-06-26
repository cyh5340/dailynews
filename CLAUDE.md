# Meme Video Agent — Claude Code Context

**Read [`DESIGN.md`](./DESIGN.md) first** — it is the single source of truth for architecture, module specs, the queue schema, Vercel config, and open decisions. Update `DESIGN.md` whenever the interface contract or architecture changes.

A daily, serverless (Vercel) pipeline that turns top news into short captioned meme videos: crawl → LLM meme scoring → MiniMax image → MiniMax Hailuo video → Vapi voiceover → publish to Vercel Blob. TypeScript throughout. Two engineers work in parallel — 🟦 **Person A** owns `data/`, 🟥 **Person B** owns `generation/`, both share `shared/`.

## Queue contract (the only thing the two halves share)

- The queue is **Vercel KV**, one record per story at key **`prompt:{story_id}`**; a pending set lives at `index:pending`.
- **🟦 Person A writes** the prompt fields: `story_id, headline, tone, meme_score, image_prompt, motion_prompt, caption_top, caption_bottom, voiceover_script, created_at` — then sets `status: pending`.
- **🟥 Person B writes** only the output fields: `status`, `image_url`, `video_url`, `output_url` — never the prompt fields.
- **`status` advances strictly**: `pending → image_done → video_done → published`; B resumes from the current status, so re-running is idempotent.
- **Field limits are enforced by A before enqueue**: `caption_top`/`caption_bottom` ≤ 60 chars, `voiceover_script` ≤ 200 chars, `meme_score` ∈ 1..10, `tone` ∈ {absurd, political, wholesome}.

## Conventions

- Stubs only so far — every `.ts` file is a `// TODO`. Do not add implementation unless asked.
- Cron is fire-and-forget: routes (`/api/run-a`, `/api/run-b`) return fast (~`202`) to dodge the ~30s gateway timeout; `maxDuration` is 300s. Cron needs the Vercel **Pro** plan.
- Every paid API call checks the budget guard in `shared/cost_tracker.ts` against `DAILY_VIDEO_BUDGET_USD` first.
