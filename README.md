<div align="center">

![DailyNews banner](docs/assets/banner.png)

# DailyNews

### Turn today's top headlines into captioned meme videos — automatically, every morning.

![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6?logo=typescript)
![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js)
![Vercel](https://img.shields.io/badge/deploy-Vercel-000000?logo=vercel)
![MiniMax](https://img.shields.io/badge/MiniMax-image%20%2B%20video%20%2B%20TTS-22D3EE)
![Status](https://img.shields.io/badge/Person%20B-implemented-22c55e)
![Status](https://img.shields.io/badge/Person%20A-stubbed-f59e0b)

**News crawl · LLM meme scoring · MiniMax image & Hailuo video · TTS voiceover · Vercel Blob publish**

</div>

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Status at a Glance](#status-at-a-glance)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Repository Map](#repository-map)
- [How It Works](#how-it-works)
- [Verification](#verification)
- [Roadmap](#roadmap)
- [Documentation](#documentation)
- [License](#license)

---

## Overview

DailyNews (Meme Video Agent) is a daily pipeline that converts news into short meme videos. The system is designed for two parallel workstreams:

- **Person A** owns data ingestion and prompt creation (`data/`, `/api/run-a`).
- **Person B** owns media generation and publishing (`generation/`, `/api/run-b`).

The only contract between them is a Vercel KV record at `prompt:{story_id}`. Person A writes prompt fields and sets `status: pending`. Person B advances status through `image_done → video_done → published` and writes asset URLs.

There are two ways to run the project today:

1. **Serverless (target)** — Vercel Cron triggers `/api/run-a` and `/api/run-b`.
2. **Local v0 (working now)** — `npm start` runs `pipeline.ts` end-to-end into `./output/`.

Product requirements live in [`spec.md`](./spec.md). Full technical design lives in [`DESIGN.md`](./DESIGN.md).

## Architecture

![DailyNews architecture](docs/assets/architecture.svg)

```
Vercel Cron
  ├─ 06:00  POST /api/run-a   Person A: crawl → dedup → summarize → enqueue (KV)
  └─ 06:30  POST /api/run-b   Person B: one stage per story → Blob + Slack

KV queue: prompt:{story_id} · index:pending · cost:{date}
Blob assets: image · video · final.mp4
```

Person B processes **one stage per invocation** so long-running Hailuo polling and ffmpeg merges stay inside Vercel's function window. Re-running `/api/run-b` resumes from the current `status` and stored `video_task_id`.

## Status at a Glance

| Area | State |
|------|-------|
| Person B: image, caption, video, voiceover, publisher | ✅ Implemented |
| Person B: `/api/run-b` fire-and-forget cron route | ✅ Implemented |
| Shared: KV queue helpers + daily budget guard | ✅ Implemented |
| Person A: crawler, dedup, summarizer, prompt_gen | 🟡 Stubbed |
| Person A: `/api/run-a` cron route | 🟡 Stubbed |
| Local `pipeline.ts` v0 (NewsAPI + LLM + MiniMax) | ✅ Implemented |
| Production E2E on Vercel KV + Blob | ⏳ Not yet validated |

## Quick Start

### Prerequisites

- Node.js 20+
- API keys in `.env` (see [Configuration](#configuration))

### Local v0 pipeline (fastest path)

```powershell
cd dailynews
npm install
Copy-Item .env.example .env
# fill NEWS_API_KEY, LLM_API_KEY, LLM_BASE_URL, LLM_MODEL, MINIMAX_API_KEY
npm start
```

Outputs land in `./output/<story_id>/final.mp4`.

### Serverless development

```powershell
npm install
vercel login
vercel link
vercel env pull .env.local
npm run dev
```

Trigger routes manually:

```powershell
# Person A (once implemented)
curl -Method POST http://localhost:3000/api/run-a

# Person B
curl -Method POST http://localhost:3000/api/run-b
```

### Deploy to Vercel

```powershell
vercel --prod
```

Cron jobs require the **Vercel Pro** plan. Enable KV and Blob in the project dashboard, then add secrets from `.env.example`.

## Configuration

Copy [`.env.example`](./.env.example) to `.env` or `.env.local`.

| Variable | Required for | Description |
|----------|--------------|-------------|
| `NEWS_API_KEY` | Local v0 / Person A | NewsAPI top headlines |
| `LLM_API_KEY` | Local v0 / Person A | Summarizer / prompt packages |
| `LLM_BASE_URL` | Local v0 | OpenAI-compatible API base |
| `LLM_MODEL` | Local v0 | Model slug for prompt JSON |
| `MINIMAX_API_KEY` | Person B / v0 | Image, Hailuo video, TTS |
| `MINIMAX_GROUP_ID` | Person B | Optional account scoping |
| `BLOB_READ_WRITE_TOKEN` | Person B serverless | Vercel Blob uploads |
| `KV_REST_API_URL` | Shared serverless | Vercel KV / Upstash Redis |
| `KV_REST_API_TOKEN` | Shared serverless | KV auth token |
| `SLACK_WEBHOOK_URL` | Person B | Optional daily summary |
| `DAILY_VIDEO_BUDGET_USD` | Shared | Hard spend cap (default `5`) |
| `MINIMAX_VOICE_ID` | Person B | Optional TTS voice override |

## Repository Map

```
dailynews/
├── api/
│   ├── run-a.ts          # Person A cron entry (stub)
│   └── run-b.ts          # Person B cron entry (implemented)
├── data/                 # Person A modules (stub)
├── generation/           # Person B modules (implemented)
│   ├── image_gen.ts      # MiniMax image-01
│   ├── caption.ts        # sharp meme captions
│   ├── video_gen.ts      # MiniMax Hailuo i2v
│   ├── voiceover.ts      # MiniMax TTS + ffmpeg merge
│   ├── publisher.ts      # Vercel Blob + Slack
│   └── pipeline.ts       # queue orchestration
├── shared/
│   ├── types.ts          # PromptPackage contract
│   ├── queue.ts          # KV helpers
│   ├── cost_tracker.ts   # budget guard
│   └── minimax.ts        # MiniMax API client
├── pipeline.ts           # local v0 single-file runner
├── docs/assets/
│   ├── banner.png        # README hero
│   └── architecture.svg
├── spec.md               # product spec
├── DESIGN.md             # technical design
├── vercel.json           # cron + function limits
└── .env.example
```

## How It Works

### Person A (planned)

1. Crawl Google News RSS, Reuters RSS, NewsAPI, and GDELT.
2. Deduplicate with cosine similarity (threshold `0.85`).
3. Summarize each story into strict JSON: tone, meme_score, prompts, captions, voiceover.
4. Write `prompt:{story_id}` to KV with `status: pending`.

### Person B (implemented)

1. `pending` → MiniMax image + caption overlay → upload image → `image_done`
2. `image_done` → Hailuo video (poll + resume via `video_task_id`) → upload video → `video_done`
3. `video_done` → MiniMax TTS + ffmpeg merge (video loops to match audio) → publish final → `published`

Each paid call checks `DAILY_VIDEO_BUDGET_USD` before running. Structured JSON logs go to stdout for `vercel logs`.

## Verification

```powershell
npm run typecheck
```

Typecheck is the current CI gate. End-to-end serverless validation requires provisioned KV, Blob, and MiniMax credentials.

## Roadmap

- [ ] Implement Person A modules and `/api/run-a`
- [ ] First production cron run with real KV queue
- [ ] Meme-score threshold tuning
- [ ] Optional auto-post to TikTok / YouTube Shorts / X

## Documentation

| Doc | Purpose |
|-----|---------|
| [`spec.md`](./spec.md) | Product spec and status |
| [`DESIGN.md`](./DESIGN.md) | Architecture, module specs, queue schema |
| [`CLAUDE.md`](./CLAUDE.md) | Agent session context |

## License

No license file is currently checked in to this repository.