import type { VercelRequest, VercelResponse } from '@vercel/node';
import { waitUntil } from '@vercel/functions';
import { drainQueue } from '../generation/pipeline';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  res.status(202).json({
    ok: true,
    route: '/api/run-b',
    message: 'generation pipeline accepted',
  });

  waitUntil(
    drainQueue()
      .then(({ summary }) => {
        console.log(
          JSON.stringify({
            ts: new Date().toISOString(),
            stage: 'run-b',
            status: 'ok',
            summary,
          }),
        );
      })
      .catch((error) => {
        console.error(
          JSON.stringify({
            ts: new Date().toISOString(),
            stage: 'run-b',
            status: 'error',
            detail: error instanceof Error ? error.message : 'unknown_error',
          }),
        );
      }),
  );
}