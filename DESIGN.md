# Meme Video Agent — Technical Design

> **Legend:** 🟦 Person A (Data & Intelligence) · 🟥 Person B (Generation & Output) · ⬜ Shared

## 1. Purpose & Scope

Meme Video Agent is a daily, fully automated pipeline that turns the day's top news into short, captioned meme videos. It crawls news from RSS feeds and news APIs, uses an LLM to score "meme potential" and emit a structured prompt package, generates a base image with the MiniMax Image API, animates it into a short clip with MiniMax Hailuo (image-to-video), adds an AI voiceover via Vapi TTS merged with ffmpeg, and publishes the finished video to Vercel Blob. The system runs serverless on Vercel: two Cron-triggered API routes, Vercel KV as the work queue, and Vercel Blob for assets. Work is split cleanly between two engineers communicating only through a KV-stored queue schema, so the two halves can be built and deployed in parallel.

## 2. System Architecture

```
                         ┌──────────────────────── Vercel Cron ─────────────────────────┐
                         │                                                               │
                  0 6 * * *  (run-a)                                          30 6 * * *  (run-b)
                         │                                                               │
                         ▼                                                               ▼
              ┌───────────────────────┐                                   ┌───────────────────────┐
              │  /api/run-a  (route)  │                                   │  /api/run-b  (route)  │
              └───────────┬───────────┘                                   └───────────┬───────────┘
                          │                                                           │
        🟦 DATA & INTELLIGENCE (Person A)                          🟥 GENERATION & OUTPUT (Person B)
                          │                                                           │
   ┌──────────────────────┴────────────────────┐           ┌───────────────────────────┴──────────────────────────┐
   │ crawler → dedup → summarizer → prompt_gen  │           │ image_gen → caption → video_gen → voiceover → publisher│
   │ (RSS/API)  (0.85)  (LLM JSON)   (render)   │           │ (MiniMax)  (sharp)   (Hailuo)    (Vapi+ffmpeg)  (Blob) │
   └──────────────────────┬────────────────────┘           └───────────────────────────┬──────────────────────────┘
                          │                                                             │
                          │   write prompt:{story_id}                  read pending →   │   update status / *_url
                          ▼                                                             ▼
                   ┌───────────────────────────────── ⬜ Vercel KV (queue) ─────────────────────────────────┐
                   │   prompt:{story_id}  ·  cost:{date}  ·  index:pending (set of story_ids)                │
                   └─────────────────────────────────────────────────────────────────────────────────────────┘
                                                            │
                                                            ▼
                                            ⬜ Vercel Blob (image / video / final)
                                                            │
                                                            ▼
                                                  🟥 Slack webhook summary
```

Person A writes prompt packages to KV (`status: pending`). Person B, triggered 30 minutes later, drains the queue, advances `status` through `image_done → video_done → published`, and writes asset URLs back into the same KV record. The two halves never call each other directly — the KV record is the only contract.

## 3. Repository Structure

```
meme-video-agent/
├── api/
│   ├── run-a.ts            🟦 Cron entry: crawl → dedup → summarize → enqueue
│   └── run-b.ts            🟥 Cron entry: drain queue → image → video → voice → publish
├── data/                   🟦 Person A
│   ├── crawler.ts          🟦 Fetch stories (Google News RSS, Reuters RSS, NewsAPI, GDELT)
│   ├── dedup.ts            🟦 Cosine-similarity dedup (0.85) + relevance scoring
│   ├── summarizer.ts       🟦 LLM call → strict JSON (punchline, tone, entities, meme_score)
│   └── prompt_gen.ts       🟦 Render prompt packages → write to Vercel KV
├── generation/             🟥 Person B
│   ├── image_gen.ts        🟥 MiniMax Image API (1024x1024)
│   ├── caption.ts          🟥 sharp caption overlay (Impact, white + black stroke)
│   ├── video_gen.ts        🟥 MiniMax Hailuo image-to-video (6s, 9:16)
│   ├── voiceover.ts        🟥 Vapi TTS + @ffmpeg/ffmpeg WASM merge
│   └── publisher.ts        🟥 Vercel Blob upload + Slack webhook summary
├── shared/
│   ├── queue.ts            ⬜ Vercel KV helpers (read/write/index)
│   ├── cost_tracker.ts     ⬜ Per-call cost logging + budget guard
│   └── types.ts            ⬜ Shared PromptPackage / Status types
├── vercel.json             ⬜ Cron config + function maxDuration (300s)
├── CLAUDE.md               ⬜ Session context for Claude Code
├── DESIGN.md               ⬜ This document
├── package.json
├── tsconfig.json
└── .env.example            ⬜ Documented env vars
```

> **Language:** TypeScript throughout. Functions run on Node.js (Fluid Compute). Use `tsx` / `vercel dev` for local development.

## 4. Vercel Configuration

### `vercel.json`

```json
{
  "crons": [
    { "path": "/api/run-a", "schedule": "0 6 * * *" },
    { "path": "/api/run-b", "schedule": "30 6 * * *" }
  ],
  "functions": {
    "api/run-a.ts": { "maxDuration": 300 },
    "api/run-b.ts": { "maxDuration": 300 }
  }
}
```

### Required services

| Service | Purpose | Owner |
|---|---|---|
| ⬜ Vercel KV | Prompt queue (`prompt:{story_id}`), pending index, cost ledger (`cost:{date}`) | Shared |
| ⬜ Vercel Blob | Image / video / final-video asset storage | Shared (writes by 🟥 B) |
| ⬜ Vercel Cron | Daily triggers for `/api/run-a` and `/api/run-b` | Shared |

### Environment variables

```bash
# --- Generation (🟥 Person B) ---
MINIMAX_API_KEY=          # MiniMax Image + Hailuo video
VAPI_API_KEY=             # Vapi TTS voiceover
BLOB_READ_WRITE_TOKEN=    # Vercel Blob upload token
SLACK_WEBHOOK_URL=        # Slack daily summary webhook

# --- Data & Intelligence (🟦 Person A) ---
NEWS_API_KEY=             # NewsAPI.org key
LLM_API_KEY=              # Summarizer LLM (claude-sonnet-4-6 preferred)

# --- Shared (⬜) ---
KV_URL=                   # Vercel KV connection URL
KV_REST_API_URL=          # Vercel KV REST endpoint
KV_REST_API_TOKEN=        # Vercel KV REST token
DAILY_VIDEO_BUDGET_USD=   # Hard cap; pipeline halts paid calls when exceeded
```

## 5. Module Specifications

### 🟦 `data/crawler.ts`
- **Input:** none (reads source list from config / env).
- **Output:** `RawStory[]` — `{ title, url, source, published_at, summary }`.
- **Libraries:** `rss-parser`, `fetch` (NewsAPI, GDELT REST).
- **Config:** `NEWS_API_KEY`. Sources: Google News RSS, Reuters RSS, NewsAPI top-headlines, GDELT Doc API.
- **Errors:** per-source try/catch — one dead feed must not abort the run; log and continue. Time-box each fetch (≤10s).

### 🟦 `data/dedup.ts`
- **Input:** `RawStory[]`.
- **Output:** deduplicated, relevance-scored `RawStory[]` (highest first).
- **Libraries:** embeddings (LLM provider) + in-memory cosine similarity.
- **Config:** similarity threshold `0.85`; stories above threshold merge to the highest-relevance representative.
- **Errors:** if embeddings fail, fall back to normalized-title fuzzy match; never drop the whole batch.

### 🟦 `data/summarizer.ts`
- **Input:** single `RawStory`.
- **Output:** strict JSON `{ punchline, tone, entities[], meme_score }`.
- **Libraries:** LLM SDK — **claude-sonnet-4-6 preferred** (`LLM_API_KEY`).
- **Config:** low temperature; response constrained to JSON. `tone ∈ {absurd, political, wholesome}`, `meme_score ∈ 1..10`.
- **Errors:** validate JSON; on parse failure retry once with a "return valid JSON only" reminder, then skip the story.

### 🟦 `data/prompt_gen.ts`
- **Input:** scored stories + summarizer output.
- **Output:** `PromptPackage` records written to KV as `prompt:{story_id}` with `status: pending`.
- **Libraries:** `shared/queue.ts`.
- **Config:** drops stories below the meme-score threshold (see Open Decisions). Enforces caption (≤60 chars) and voiceover (≤200 chars) limits before writing.
- **Errors:** validate field lengths; truncate or regenerate over-limit captions before enqueue.

### 🟥 `generation/image_gen.ts`
- **Input:** `image_prompt` from a KV record.
- **Output:** `image_url` (base image), 1024x1024 → `status: image_done`.
- **Libraries:** MiniMax Image API (`MINIMAX_API_KEY`).
- **Errors:** retry on 5xx with backoff; on hard failure mark record and continue to next story.

### 🟥 `generation/caption.ts`
- **Input:** base image + `caption_top` / `caption_bottom`.
- **Output:** captioned image buffer.
- **Libraries:** `sharp`. Impact font, white fill, black stroke; top/bottom anchored.
- **Errors:** auto-shrink font if text overflows; bundle the Impact font (do not rely on a system font).

### 🟥 `generation/video_gen.ts`
- **Input:** captioned image + `motion_prompt`.
- **Output:** `video_url` (6s clip, 9:16) → `status: video_done`.
- **Libraries:** MiniMax Hailuo image-to-video (`MINIMAX_API_KEY`).
- **Config:** duration 6s, ratio 9:16. Hailuo is async — poll job status.
- **Errors:** poll within a timeout budget; if generation exceeds the function window, persist the job id to KV and resume (see Open Decisions: function chaining).

### 🟥 `generation/voiceover.ts`
- **Input:** silent video + `voiceover_script`.
- **Output:** merged video buffer with narration.
- **Libraries:** Vapi TTS (`VAPI_API_KEY`) + `@ffmpeg/ffmpeg` (WASM).
- **Errors:** if WASM ffmpeg hits memory limits in the serverless runtime, fall back to a hosted ffmpeg step (see Open Decisions).

### 🟥 `generation/publisher.ts`
- **Input:** final merged video.
- **Output:** `output_url` (public Blob URL); `status: published`; Slack summary.
- **Libraries:** `@vercel/blob` (`BLOB_READ_WRITE_TOKEN`), Slack webhook (`SLACK_WEBHOOK_URL`).
- **Errors:** Blob upload is the source of truth; only set `published` after a verified upload. Slack failure is non-fatal (log only).

### ⬜ `shared/queue.ts`
- KV read/write helpers and a pending index (`index:pending`). See snippets in §6.

### ⬜ `shared/cost_tracker.ts`
- Append per-call cost to `cost:{date}`; expose `wouldExceedBudget(estimate)` guard checked before every paid call against `DAILY_VIDEO_BUDGET_USD`.

## 6. Interface Contract — Prompt Queue

> **Freeze this schema before parallel development begins.** Both engineers update their code if it changes.

The queue lives in Vercel KV under key `prompt:{story_id}`.

| Field | Type | Owner | Description |
|---|---|---|---|
| story_id | string | 🟦 A | UUID |
| headline | string | 🟦 A | Original news headline |
| tone | string | 🟦 A | `absurd` / `political` / `wholesome` |
| meme_score | number | 🟦 A | 1–10 |
| image_prompt | string | 🟦 A | MiniMax Image prompt |
| motion_prompt | string | 🟦 A | Hailuo motion description |
| caption_top | string | 🟦 A | Upper caption, max 60 chars |
| caption_bottom | string | 🟦 A | Lower caption, max 60 chars |
| voiceover_script | string | 🟦 A | TTS narration, max 200 chars |
| status | string | 🟥 B | `pending` → `image_done` → `video_done` → `published` |
| image_url | string | 🟥 B | Vercel Blob URL |
| video_url | string | 🟥 B | Vercel Blob URL |
| output_url | string | 🟥 B | Final published URL |
| created_at | ISO8601 | 🟦 A | Write timestamp |

### Example record

```json
{
  "story_id": "9f1c2a44-7b3e-4e21-9c0a-1d2e3f4a5b6c",
  "headline": "Local cat elected to city council in landslide write-in vote",
  "tone": "absurd",
  "meme_score": 9,
  "image_prompt": "A smug tabby cat in a tiny suit behind a city council desk, photoreal, dramatic lighting, 1:1",
  "motion_prompt": "slow zoom in on the cat, it slowly blinks and a gavel falls beside it",
  "caption_top": "WHEN YOU RUN AS A JOKE",
  "caption_bottom": "BUT THE PEOPLE HAVE SPOKEN",
  "voiceover_script": "In a stunning upset, the people chose chaos. And the chaos has whiskers.",
  "status": "pending",
  "image_url": "",
  "video_url": "",
  "output_url": "",
  "created_at": "2026-06-25T06:00:12.481Z"
}
```

### TypeScript KV helpers (`shared/queue.ts`)

```ts
import { kv } from '@vercel/kv';
import type { PromptPackage } from './types';

const key = (storyId: string) => `prompt:${storyId}`;
const PENDING_INDEX = 'index:pending';

// 🟦 A — write a new prompt package and register it in the pending index
export async function enqueue(pkg: PromptPackage): Promise<void> {
  await kv.set(key(pkg.story_id), pkg);
  await kv.sadd(PENDING_INDEX, pkg.story_id);
}

// 🟥 B — list story ids still awaiting generation (no full keyspace scan)
export async function listPending(): Promise<string[]> {
  return (await kv.smembers(PENDING_INDEX)) ?? [];
}

export async function get(storyId: string): Promise<PromptPackage | null> {
  return await kv.get<PromptPackage>(key(storyId));
}

// 🟥 B — advance status + patch asset urls; clears the index when published
export async function update(
  storyId: string,
  patch: Partial<Pick<PromptPackage, 'status' | 'image_url' | 'video_url' | 'output_url'>>,
): Promise<void> {
  const current = await get(storyId);
  if (!current) throw new Error(`unknown story ${storyId}`);
  await kv.set(key(storyId), { ...current, ...patch });
  if (patch.status === 'published') await kv.srem(PENDING_INDEX, storyId);
}
```

## 7. External API Reference

| API | Owner | Endpoint / SDK | Cost driver | Notes |
|---|---|---|---|---|
| Google News RSS | 🟦 A | `news.google.com/rss` | Free | No key; rate-limit politely |
| Reuters RSS | 🟦 A | Reuters feed URL | Free | Parse with `rss-parser` |
| NewsAPI | 🟦 A | `newsapi.org/v2/top-headlines` | Per request (quota) | `NEWS_API_KEY` |
| GDELT | 🟦 A | `api.gdeltproject.org/api/v2/doc/doc` | Free | Generous but throttled |
| Summarizer LLM | 🟦 A | claude-sonnet-4-6 (`LLM_API_KEY`) | Per token | Strict-JSON output |
| MiniMax Image | 🟥 B | MiniMax Image API | Per image | 1024x1024 |
| MiniMax Hailuo | 🟥 B | Hailuo image-to-video | Per second of video | Async — poll job; 6s, 9:16 |
| Vapi TTS | 🟥 B | Vapi (`VAPI_API_KEY`) | Per character | Voice TBD (Open Decisions) |
| Vercel Blob | ⬜ | `@vercel/blob` | Storage + egress | `BLOB_READ_WRITE_TOKEN` |
| Vercel KV | ⬜ | `@vercel/kv` | Requests / storage | Queue + cost ledger |
| Slack webhook | 🟥 B | `SLACK_WEBHOOK_URL` | Free | Non-fatal on error |

## 8. Vercel Deployment

### First deploy

```bash
npm i -g vercel          # if not installed
vercel login
vercel link              # link repo to a Vercel project
# Enable Storage (KV + Blob) in the dashboard, then link:
vercel storage link      # attach KV and Blob to the project
# Add the remaining secrets:
vercel env add MINIMAX_API_KEY production
vercel env add VAPI_API_KEY production
# ...repeat for every var in .env.example...
vercel --prod            # first production deploy (activates crons)
```

### Local development

```bash
vercel env pull .env.local   # pull provisioned KV/Blob + secrets locally
vercel dev                   # run API routes + cron paths locally on :3000
```

### Manually triggering the pipeline (testing)

Cron paths are plain HTTP routes — hit them directly:

```bash
# Person A: crawl + enqueue
curl -X POST http://localhost:3000/api/run-a

# Person B: drain queue + generate + publish
curl -X POST http://localhost:3000/api/run-b

# Against a deployed environment
curl -X POST https://<project>.vercel.app/api/run-a
```

### Cron notes / gotchas

- **Vercel Cron requires the Pro plan.** Crons do not run on Hobby.
- **HTTP timeout vs. function timeout:** a Cron-triggered request can be cut at the gateway (~30s) even though the function's `maxDuration` is 300s. The full pipeline will not finish inside one synchronous HTTP response.
- **Fire-and-forget pattern:** the Cron route should kick off the work and return `202` immediately, letting the function continue (or self-invoke the next stage) in the background rather than holding the HTTP connection open. If a single stage still exceeds the function window, chain stages by re-invoking the route per item (see Open Decisions: function chaining).
- **Idempotency:** routes read/write KV by `story_id`, so a re-trigger resumes from the current `status` instead of duplicating work.

## 9. Observability & Cost Tracking

**Log format** (one structured JSON line per stage to stdout — visible in `vercel logs`):

```json
{ "ts": "2026-06-25T06:01:03Z", "stage": "image_gen", "story_id": "9f1c…", "ms": 4210, "cost_usd": 0.012, "status": "ok" }
```

**Cost ledger (KV):** key `cost:{YYYY-MM-DD}` — a running total (and per-stage breakdown) of the day's spend, appended by `shared/cost_tracker.ts` after every paid call.

**Budget guard:** before any paid API call, `cost_tracker.wouldExceedBudget(estimate)` compares `cost:{today} + estimate` against `DAILY_VIDEO_BUDGET_USD`. If it would exceed, the call is skipped, the story is left at its current `status`, and a warning is logged — the pipeline degrades gracefully instead of overspending.

**Slack summary:** at the end of `run-b`, `publisher.ts` posts a daily digest to `SLACK_WEBHOOK_URL`: stories processed, videos published, `output_url` links, total `cost_usd` vs. budget, and any failures.

## 10. Delivery Milestones

| Week | 🟦 Person A — Data & Intelligence | 🟥 Person B — Generation & Output | ⬜ Shared |
|---|---|---|---|
| 1 | `crawler.ts` — all four sources fetching | `image_gen.ts` — MiniMax image round-trip | `types.ts` + `queue.ts` contract frozen |
| 2 | `dedup.ts` + relevance scoring | `caption.ts` — sharp overlay, Impact font | KV provisioned; `.env.example` finalized |
| 3 | `summarizer.ts` — strict JSON LLM output | `video_gen.ts` — Hailuo async polling | `cost_tracker.ts` + budget guard |
| 4 | `prompt_gen.ts` — enqueue to KV | `voiceover.ts` + `publisher.ts` — Vapi/ffmpeg/Blob | `vercel.json` crons; fire-and-forget routes |
| 5 | End-to-end tuning of meme-score threshold | Output quality pass + Slack summary | Deploy to prod; observe first live runs |

Both engineers can work from **Week 1** against hardcoded test data before the queue is wired end-to-end.

## 11. Open Decisions

- [ ] **Vapi voice** — which voice/persona for narration (per-tone voices?).
- [ ] **Output destination** — Blob-only, or also auto-post to TikTok / YouTube Shorts / X?
- [ ] **Function chaining** — if a single stage exceeds 5 min (Hailuo polling, ffmpeg), do we per-item self-invoke routes, move to a queue/worker, or use a durable workflow?
- [ ] **LLM provider** — confirm claude-sonnet-4-6 for the summarizer vs. an alternative; shared `LLM_API_KEY` provider.
- [ ] **Meme-score threshold** — minimum `meme_score` to enqueue (and max videos/day).
- [ ] **Dashboard** — do we need a status/cost dashboard, or is Slack + `vercel logs` enough?

---

*Update this document whenever the interface contract or architecture changes.*
