import { kv } from '@vercel/kv';
import type { PromptPackage, Status } from './types';

const key = (storyId: string) => `prompt:${storyId}`;
const PENDING_INDEX = 'index:pending';

export async function enqueue(pkg: PromptPackage): Promise<void> {
  await kv.set(key(pkg.story_id), pkg);
  await kv.sadd(PENDING_INDEX, pkg.story_id);
}

export async function listPending(): Promise<string[]> {
  return (await kv.smembers<string[]>(PENDING_INDEX)) ?? [];
}

export async function get(storyId: string): Promise<PromptPackage | null> {
  return await kv.get<PromptPackage>(key(storyId));
}

export async function update(
  storyId: string,
  patch: Partial<
    Pick<
      PromptPackage,
      'status' | 'image_url' | 'video_url' | 'output_url' | 'video_task_id'
    >
  >,
): Promise<PromptPackage> {
  const current = await get(storyId);
  if (!current) throw new Error(`unknown story ${storyId}`);

  const next: PromptPackage = { ...current, ...patch };
  await kv.set(key(storyId), next);
  if (patch.status === 'published') await kv.srem(PENDING_INDEX, storyId);
  return next;
}

export async function listByStatus(status: Status): Promise<PromptPackage[]> {
  const ids = await listPending();
  const packages = await Promise.all(ids.map((id) => get(id)));
  return packages.filter((pkg): pkg is PromptPackage => pkg !== null && pkg.status === status);
}