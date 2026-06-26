// 🟦 Person A — LLM call (claude-sonnet-4-6 preferred) → strict JSON. See DESIGN.md §5.
//
// Returns { punchline, tone, entities, meme_score }. OpenAI-compatible chat endpoint
// (LLM_BASE_URL / LLM_MODEL / LLM_API_KEY) so any free-tier gateway works. On a JSON parse
// failure we retry ONCE with a "valid JSON only" reminder, then throw (caller skips the story).

import type { RawStory, SummaryResult, Tone } from '../shared/types';

const TONES: Tone[] = ['absurd', 'political', 'wholesome'];

const SYSTEM = `You turn a news story into a meme concept. Return ONLY valid JSON (no prose, no
markdown fences) with exactly these keys:
{
  "punchline": string,        // the joke/observation, < 120 chars
  "tone": "absurd" | "political" | "wholesome",
  "entities": string[],       // 1-4 key people/orgs/things
  "meme_score": number        // 1-10, how meme-able this story is
}`;

function buildUserPrompt(story: RawStory): string {
  return `Headline: ${story.title}\nSummary: ${story.summary || '(none)'}\nSource: ${story.source}`;
}

async function callLlm(messages: { role: string; content: string }[]): Promise<string> {
  const key = process.env.LLM_API_KEY;
  const base = process.env.LLM_BASE_URL;
  const model = process.env.LLM_MODEL;
  if (!key || !base || !model) throw new Error('LLM_API_KEY / LLM_BASE_URL / LLM_MODEL not set');

  const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, temperature: 0.7 }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  return json.choices[0].message.content;
}

function parseSummary(raw: string): SummaryResult {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const obj = JSON.parse(cleaned) as Partial<SummaryResult>;

  const tone: Tone = TONES.includes(obj.tone as Tone) ? (obj.tone as Tone) : 'absurd';
  const meme = Math.max(1, Math.min(10, Math.round(Number(obj.meme_score) || 1)));
  if (!obj.punchline || typeof obj.punchline !== 'string') throw new Error('missing punchline');

  return {
    punchline: obj.punchline,
    tone,
    entities: Array.isArray(obj.entities) ? obj.entities.slice(0, 4).map(String) : [],
    meme_score: meme,
  };
}

export async function summarize(story: RawStory): Promise<SummaryResult> {
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: buildUserPrompt(story) },
  ];

  let raw = await callLlm(messages);
  try {
    return parseSummary(raw);
  } catch {
    // one retry with an explicit reminder
    raw = await callLlm([
      ...messages,
      { role: 'assistant', content: raw },
      { role: 'user', content: 'That was not valid JSON. Return ONLY the JSON object, nothing else.' },
    ]);
    return parseSummary(raw);
  }
}
