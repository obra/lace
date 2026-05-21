export type HelperRequest =
  | { op: 'stat'; path: string }
  | { op: 'readTextFile'; path: string }
  | { op: 'writeTextFile'; path: string; content: string }
  | { op: 'mkdir'; path: string; recursive?: boolean }
  | { op: 'readdir'; path: string }
  | {
      op: 'fetch';
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    };

export type HelperResponse =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string } };

export function encodeHelperRequest(request: HelperRequest): string {
  return `${JSON.stringify(request)}\n`;
}

export function decodeHelperResponse(line: string): HelperResponse {
  const parsed = JSON.parse(line) as HelperResponse;
  if (!parsed.ok && !parsed.error?.message) {
    throw new Error('Invalid helper error response');
  }
  return parsed;
}
