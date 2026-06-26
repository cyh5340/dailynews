const BASE_URL = 'https://api.minimax.io';

export class MiniMaxError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'MiniMaxError';
  }
}

function apiKey(): string {
  const key = process.env.MINIMAX_API_KEY;
  if (!key) throw new MiniMaxError('MINIMAX_API_KEY is not set');
  return key;
}

function groupId(): string | undefined {
  return process.env.MINIMAX_GROUP_ID || undefined;
}

export async function minimaxFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${apiKey()}`);
  if (groupId()) headers.set('Group-Id', groupId()!);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new MiniMaxError(`MiniMax HTTP ${res.status}: ${text}`, res.status);
  }

  const json = (await res.json()) as T & { base_resp?: { status_code: number; status_msg: string } };
  if (json.base_resp && json.base_resp.status_code !== 0) {
    throw new MiniMaxError(
      `MiniMax API ${json.base_resp.status_code}: ${json.base_resp.status_msg}`,
      json.base_resp.status_code,
    );
  }
  return json;
}

export async function downloadFile(fileId: string): Promise<Buffer> {
  const url = new URL(`${BASE_URL}/v1/files/retrieve_content`);
  url.searchParams.set('file_id', fileId);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey()}`,
  };
  if (groupId()) headers['Group-Id'] = groupId()!;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new MiniMaxError(`MiniMax file download ${res.status}: ${text}`, res.status);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}