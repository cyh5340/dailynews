# DailyNews — Product Spec

## 1. One sentence pitch

DailyNews is a daily, fully automated pipeline that turns top news headlines into short, captioned meme videos with AI image, video, voiceover, and publish-ready assets.

## 2. Problem

News moves fast, but turning a headline into a shareable short-form meme video is still manual: pick a story, write captions, generate visuals, animate, narrate, and upload. That workflow does not scale to a daily cadence without heavy ops overhead.

## 3. Solution

DailyNews splits the work into two independent halves connected only by a KV queue contract:

- **Person A (Data & Intelligence)** crawls headlines, deduplicates stories, scores meme potential with an LLM, and enqueues structured prompt packages.
- **Person B (Generation & Output)** drains the queue, generates image → captioned frame → Hailuo video → voiceover merge, and publishes final assets to Vercel Blob.

The serverless deployment uses Vercel Cron, KV, Blob, and fire-and-forget API routes. A local `pipeline.ts` v0 script provides a single-file end-to-end dev path without KV.

## 4. Target output

For each accepted story:

- 1024×1024 captioned meme image
- 6-second vertical video clip
- Final narrated MP4 published to Blob
- Optional Slack digest with links and daily spend

## 5. Queue contract (frozen interface)

KV key: `prompt:{story_id}`

| Field | Owner | Notes |
|---|---|---|
| headline, tone, meme_score | A | tone ∈ absurd / political / wholesome |
| image_prompt, motion_prompt | A | fed to MiniMax |
| caption_top, caption_bottom | A | max 60 chars each |
| voiceover_script | A | max 200 chars |
| status | B | pending → image_done → video_done → published |
| image_url, video_url, output_url | B | Vercel Blob URLs |
| video_task_id | B | resume in-flight Hailuo jobs |

## 6. Runtime modes

### Serverless (production target)

- `POST /api/run-a` at 06:00 — crawl + enqueue
- `POST /api/run-b` at 06:30 — one generation stage per story per invocation
- Budget guard via `DAILY_VIDEO_BUDGET_USD`

### Local v0 (implemented today)

```bash
npm start   # tsx pipeline.ts
```

Fetches NewsAPI headlines, asks an OpenAI-compatible LLM for prompt packages, runs MiniMax + sharp + ffmpeg, writes `./output/<story_id>/final.mp4`.

## 7. External services

| Service | Role |
|---|---|
| NewsAPI / RSS / GDELT | Headline ingestion (A) |
| OpenAI-compatible LLM | Prompt package JSON (A / local v0) |
| MiniMax Image | Base still (B) |
| MiniMax Hailuo | Image-to-video (B) |
| MiniMax TTS | Voiceover on serverless path (B) |
| Vercel KV | Queue + cost ledger |
| Vercel Blob | Asset storage |
| Slack webhook | Daily summary (optional) |

## 8. Status (2026-06-26)

| Area | State |
|---|---|
| Person B generation modules | Implemented |
| `/api/run-b` cron handler | Implemented |
| Shared queue + cost tracker | Implemented |
| Person A data modules | Stubbed |
| `/api/run-a` | Stubbed |
| Local `pipeline.ts` v0 | Implemented |
| Production E2E on Vercel | Not yet validated |

## 9. Open decisions

- Meme-score threshold and max videos per day
- Auto-post destinations beyond Blob (TikTok / YouTube Shorts / X)
- Durable workflow if a single stage exceeds function window
- Dashboard vs Slack-only observability

## 10. References

- Technical design: [`DESIGN.md`](./DESIGN.md)
- Agent context: [`CLAUDE.md`](./CLAUDE.md)