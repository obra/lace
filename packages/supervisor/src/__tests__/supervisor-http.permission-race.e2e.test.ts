import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSupervisorServer } from '../http/server';

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const guard = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`Timed out after ${ms}ms: ${label}`)), ms);
  });

  try {
    return await Promise.race([promise, guard]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(
  get: () => Promise<T | null>,
  options: { timeoutMs: number; intervalMs: number; label: string }
): Promise<T> {
  const deadline = Date.now() + options.timeoutMs;
  while (true) {
    const value = await get();
    if (value !== null) return value;
    if (Date.now() > deadline)
      throw new Error(`Timed out after ${options.timeoutMs}ms: ${options.label}`);
    await sleep(options.intervalMs);
  }
}

async function httpJson(
  method: string,
  url: string,
  body?: unknown
): Promise<{ status: number; json: any }> {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  return { status: res.status, json };
}

describe('Supervisor HTTP permissions race conditions (E2E)', () => {
  let laceDir: string;
  let workDir: string;
  let server: ReturnType<typeof createSupervisorServer> | undefined;
  let baseUrl: string | undefined;
  let originalAgentLaceDir: string | undefined;

  beforeEach(() => {
    laceDir = mkdtempSync(join(tmpdir(), 'lace-supervisor-http-e2e-store-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-supervisor-http-e2e-wd-'));
    originalAgentLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = laceDir;
  });

  afterEach(async () => {
    if (server) {
      await server.close();
      server = undefined;
    }

    rmSync(laceDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });

    if (originalAgentLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalAgentLaceDir;
  });

  it('executes a tool exactly once despite repeated resolves for the same toolCallId', async () => {
    server = createSupervisorServer({ storeDir: laceDir, host: '127.0.0.1', port: 0 });
    const listening = await withTimeout(server.listen(), 5_000, 'server.listen');
    baseUrl = listening.baseUrl;

    const createWs = await withTimeout(
      httpJson('POST', `${baseUrl}/workspace-sessions`, { workDir }),
      5_000,
      'POST /workspace-sessions'
    );
    expect(createWs.status).toBe(201);
    const workspaceSessionId = createWs.json.workspaceSessionId as string;
    expect(typeof workspaceSessionId).toBe('string');

    const promptPromise = httpJson(
      'POST',
      `${baseUrl}/workspace-sessions/${encodeURIComponent(workspaceSessionId)}/prompt`,
      { content: [{ type: 'text', text: 'run: printf x >> counter.txt' }] }
    );

    const pending = await waitFor(
      async () => {
        const res = await httpJson(
          'GET',
          `${baseUrl}/workspace-sessions/${encodeURIComponent(workspaceSessionId)}/pending-permissions`
        );
        if (res.status !== 200) return null;
        const list = Array.isArray(res.json) ? res.json : [];
        return list.length > 0 ? list[0] : null;
      },
      { timeoutMs: 5_000, intervalMs: 20, label: 'pending permission appears' }
    );

    const toolCallId = pending.toolCallId as string;
    expect(typeof toolCallId).toBe('string');

    const resolveUrl = `${baseUrl}/workspace-sessions/${encodeURIComponent(
      workspaceSessionId
    )}/pending-permissions/${encodeURIComponent(toolCallId)}`;

    const resolves = await Promise.all(
      Array.from({ length: 50 }, () => httpJson('POST', resolveUrl, { decision: 'allow' }))
    );

    const ok = resolves.filter((r) => r.status === 200 && r.json?.ok === true);
    const notFound = resolves.filter((r) => r.status === 404 && r.json?.ok === false);
    const ambiguous = resolves.filter((r) => r.status === 409);
    expect(ok).toHaveLength(1);
    expect(ambiguous).toHaveLength(0);
    expect(ok.length + notFound.length).toBe(resolves.length);

    await waitFor(
      async () => {
        try {
          const contents = readFileSync(join(workDir, 'counter.txt'), 'utf8');
          return contents.length > 0 ? contents : null;
        } catch {
          return null;
        }
      },
      { timeoutMs: 5_000, intervalMs: 20, label: 'counter.txt written' }
    );

    expect(readFileSync(join(workDir, 'counter.txt'), 'utf8')).toBe('x');

    const events = await waitFor(
      async () => {
        const res = await httpJson(
          'POST',
          `${baseUrl}/workspace-sessions/${encodeURIComponent(workspaceSessionId)}/agent/request`,
          { method: 'ent/session/events', params: { limit: 200 } }
        );
        if (res.status !== 200) return null;
        const list = res.json?.result?.events;
        return Array.isArray(list) ? list : null;
      },
      { timeoutMs: 5_000, intervalMs: 50, label: 'ent/session/events readable' }
    );

    const toolUses = events.filter(
      (e: any) => e?.type === 'tool_use' && e?.data?.toolCallId === toolCallId
    );
    expect(toolUses).toHaveLength(1);

    const decisions = events.filter(
      (e: any) => e?.type === 'permission_decided' && e?.data?.toolCallId === toolCallId
    );
    expect(decisions).toHaveLength(1);

    const promptResult = await withTimeout(
      promptPromise,
      10_000,
      'POST /workspace-sessions/:id/prompt completes'
    );
    expect(promptResult.status).toBe(200);
  });
});
