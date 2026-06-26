import sharp from 'sharp';
import type { PromptPackage } from '../shared/types';
import { logStage } from '../shared/log';

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function captionSvg(
  width: number,
  height: number,
  topLines: string[],
  bottomLines: string[],
  fontSize: number,
): string {
  const stroke = Math.max(2, Math.round(fontSize * 0.08));
  const topY = fontSize + 16;
  const bottomStart = height - bottomLines.length * (fontSize + 8) - 16;

  const topText = topLines
    .map(
      (line, i) =>
        `<text x="50%" y="${topY + i * (fontSize + 8)}" text-anchor="middle" class="meme">${escapeXml(line)}</text>`,
    )
    .join('');

  const bottomText = bottomLines
    .map(
      (line, i) =>
        `<text x="50%" y="${bottomStart + i * (fontSize + 8)}" text-anchor="middle" class="meme">${escapeXml(line)}</text>`,
    )
    .join('');

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
<style>
  .meme {
    fill: white;
    stroke: black;
    stroke-width: ${stroke}px;
    paint-order: stroke fill;
    font-size: ${fontSize}px;
    font-weight: 900;
    font-family: Impact, "Arial Black", Haettenschweiler, sans-serif;
    text-transform: uppercase;
  }
</style>
${topText}
${bottomText}
</svg>`;
}

async function renderWithFontSize(
  imageBuffer: Buffer,
  pkg: PromptPackage,
  fontSize: number,
): Promise<Buffer> {
  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width ?? 1024;
  const height = meta.height ?? 1024;
  const maxChars = Math.max(12, Math.floor(width / (fontSize * 0.55)));

  const svg = captionSvg(
    width,
    height,
    wrapText(pkg.caption_top, maxChars),
    wrapText(pkg.caption_bottom, maxChars),
    fontSize,
  );

  return sharp(imageBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}

export async function addCaptions(
  imageBuffer: Buffer,
  pkg: PromptPackage,
): Promise<Buffer> {
  const started = Date.now();

  try {
    let fontSize = 56;
    let output = await renderWithFontSize(imageBuffer, pkg, fontSize);

    while (fontSize > 28) {
      const meta = await sharp(imageBuffer).metadata();
      const width = meta.width ?? 1024;
      const height = meta.height ?? 1024;
      const maxChars = Math.max(12, Math.floor(width / (fontSize * 0.55)));
      const topLines = wrapText(pkg.caption_top, maxChars);
      const bottomLines = wrapText(pkg.caption_bottom, maxChars);
      const totalHeight = (topLines.length + bottomLines.length) * (fontSize + 8);

      if (totalHeight <= height * 0.4) break;

      fontSize -= 6;
      output = await renderWithFontSize(imageBuffer, pkg, fontSize);
    }

    logStage({
      stage: 'caption',
      story_id: pkg.story_id,
      ms: Date.now() - started,
      cost_usd: 0,
      status: 'ok',
    });
    return output;
  } catch (error) {
    logStage({
      stage: 'caption',
      story_id: pkg.story_id,
      ms: Date.now() - started,
      cost_usd: 0,
      status: 'error',
      detail: error instanceof Error ? error.message : 'unknown_error',
    });
    throw error;
  }
}