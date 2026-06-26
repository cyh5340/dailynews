// ⬜ Shared — Vercel KV helpers (read/write/index). See DESIGN.md §6.
//
// One record per story at key `prompt:{story_id}`; a pending set lives at `index:pending`.
// 🟦 A writes prompt fields + status:pending via enqueue(). 🟥 B advances status / asset urls
// via update(). Re-running is idempotent: B resumes from the current status.

import { kv } from '@vercel/kv';
import type { PromptPackage } from './types';

const key = (storyId: string) => `prompt:${storyId}`;
const PENDING_INDEX = 'index:pending';

// 🟦 A — write a new prompt package and register it in the pending index.
export async function enqueue(pkg: PromptPackage): Promise<void> {
  await kv.set(key(pkg.story_id), pkg);
  await kv.sadd(PENDING_INDEX, pkg.story_id);
}

// 🟥 B — list story ids still awaiting generation (no full keyspace scan).
export async function listPending(): Promise<string[]> {
  return (await kv.smembers(PENDING_INDEX)) ?? [];
}

export async function get(storyId: string): Promise<PromptPackage | null> {
  return await kv.get<PromptPackage>(key(storyId));
}

// 🟥 B — advance status + patch asset urls; clears the index when published.
export async function update(
  storyId: string,
  patch: Partial<Pick<PromptPackage, 'status' | 'image_url' | 'video_url' | 'output_url'>>,
): Promise<void> {
  const current = await get(storyId);
  if (!current) throw new Error(`unknown story ${storyId}`);
  await kv.set(key(storyId), { ...current, ...patch });
  if (patch.status === 'published') await kv.srem(PENDING_INDEX, storyId);
}
