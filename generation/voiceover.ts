import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { guardPaidCall, recordCost } from '../shared/cost_tracker';
import { logStage } from '../shared/log';
import { minimaxFetch } from '../shared/minimax';
import type { PromptPackage } from '../shared/types';

interface TtsResponse {
  data?: { audio?: string; status?: number };
}

const VOICE_BY_TONE: Record<PromptPackage['tone'], string> = {
  absurd: 'English_Lucky_Robot',
  political: 'English_Persuasive_Man',
  wholesome: 'English_Graceful_Lady',
};

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error('ffmpeg-static binary not found'));
      return;
    }

    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr}`));
    });
    proc.on('error', reject);
  });
}

async function synthesizeSpeech(pkg: PromptPackage): Promise<Buffer> {
  const guard = await guardPaidCall('minimax_tts');
  if (!guard.allowed) throw new Error('Daily budget exceeded before TTS');

  const voiceId =
    process.env.MINIMAX_VOICE_ID ?? VOICE_BY_TONE[pkg.tone] ?? 'English_expressive_narrator';

  const body = await minimaxFetch<TtsResponse>('/v1/t2a_v2', {
    method: 'POST',
    body: JSON.stringify({
      model: 'speech-2.8-turbo',
      text: pkg.voiceover_script,
      stream: false,
      language_boost: 'English',
      output_format: 'hex',
      voice_setting: {
        voice_id: voiceId,
        speed: 1,
        vol: 1,
        pitch: 0,
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: 'mp3',
        channel: 1,
      },
    }),
  });

  const hex = body.data?.audio;
  if (!hex) throw new Error('MiniMax TTS response missing audio');

  await recordCost('minimax_tts', guard.estimate);
  return Buffer.from(hex, 'hex');
}

export async function mergeVoiceover(
  videoBuffer: Buffer,
  pkg: PromptPackage,
): Promise<Buffer> {
  const started = Date.now();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dailynews-'));

  try {
    const videoPath = path.join(tmpDir, 'video.mp4');
    const audioPath = path.join(tmpDir, 'audio.mp3');
    const outputPath = path.join(tmpDir, 'final.mp4');

    const audioBuffer = await synthesizeSpeech(pkg);
    await fs.writeFile(videoPath, videoBuffer);
    await fs.writeFile(audioPath, audioBuffer);

    await runFfmpeg([
      '-y',
      '-stream_loop',
      '-1',
      '-i',
      videoPath,
      '-i',
      audioPath,
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-shortest',
      '-movflags',
      '+faststart',
      outputPath,
    ]);

    const merged = await fs.readFile(outputPath);
    logStage({
      stage: 'voiceover',
      story_id: pkg.story_id,
      ms: Date.now() - started,
      cost_usd: 0,
      status: 'ok',
    });
    return merged;
  } catch (error) {
    logStage({
      stage: 'voiceover',
      story_id: pkg.story_id,
      ms: Date.now() - started,
      cost_usd: 0,
      status: 'error',
      detail: error instanceof Error ? error.message : 'unknown_error',
    });
    throw error;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}