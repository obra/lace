// ABOUTME: End-to-end test: ConversationRunner.run() → AnthropicProvider →
// outbound HTTP request must carry cache_control markers. Proves the
// Phase 2 invariant chain (system_prompt_set event → message-builder →
// runner.setSystemPrompt → provider._systemPrompt → wire body).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { AnthropicProvider } from '@lace/agent/providers/anthropic-provider';
import { ConversationRunner } from '../runner';
import type { RunnerDependencies } from '../types';
import type { Tool } from '@lace/agent/tools/tool';

// Minimal SSE sequence that the Anthropic SDK's messages.stream() can fully consume.
// Sequence: message_start → content_block_start → content_block_delta →
//           content_block_stop → message_delta → message_stop.
function writeSseStream(res: import('node:http').ServerResponse): void {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = (event: string, data: object) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  send('message_start', {
    type: 'message_start',
    message: {
      id: 'msg_e2e_cache',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-20250514',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 0 },
    },
  });
  send('content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  });
  send('content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'ok' },
  });
  send('content_block_stop', { type: 'content_block_stop', index: 0 });
  send('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 1 },
  });
  send('message_stop', { type: 'message_stop' });
  res.end();
}

function createMockDeps(overrides: Partial<RunnerDependencies> = {}): RunnerDependencies {
  const mockTool = { name: 'mock', description: 'mock', schema: {} } as unknown as Tool;
  const mockToolExecutor = {
    getTool: vi.fn().mockReturnValue(mockTool),
    execute: vi.fn().mockResolvedValue({
      status: 'completed',
      content: [{ type: 'text', text: 'mock result' }],
    }),
  };

  const mockJobManager = {
    getJob: vi.fn().mockReturnValue(undefined),
    listJobs: vi.fn().mockReturnValue([]),
    getJobOutput: vi.fn().mockReturnValue(''),
    createJob: vi
      .fn()
      .mockResolvedValue({ jobId: 'job_test', job: { completion: Promise.resolve() } }),
    cancelJob: vi.fn().mockResolvedValue(undefined),
    finalizeJob: vi.fn().mockResolvedValue(undefined),
    getStreamingMode: vi.fn().mockReturnValue('full'),
    setStreamingMode: vi.fn(),
    getRunningJobs: vi.fn().mockReturnValue([]),
  };

  return {
    onUpdate: vi.fn().mockResolvedValue(undefined),
    runExclusive: vi
      .fn()
      .mockImplementation(<T>(fn: () => T | Promise<T>) => Promise.resolve(fn())),
    requestPermission: vi.fn().mockResolvedValue({ decision: 'allow' }),
    createToolExecutor: vi.fn().mockReturnValue({
      executor: mockToolExecutor,
      toolsForProvider: [],
    }),
    createProvider: vi.fn(),
    getModelPricing: vi.fn().mockResolvedValue(null),
    startShellJob: vi.fn().mockResolvedValue({ jobId: 'job_test' }),
    startSubagentJob: vi.fn().mockResolvedValue({ jobId: 'job_test' }),
    deriveJobs: vi.fn().mockReturnValue([]),
    finalizeJob: vi.fn().mockResolvedValue(undefined),
    getJob: vi.fn().mockReturnValue(undefined),
    jobManager: mockJobManager as unknown as RunnerDependencies['jobManager'],
    mcpServerManager: undefined,
    setActiveTurnStatus: vi.fn(),
    getSessionCostUsd: vi.fn().mockReturnValue(0),
    updateSessionUsage: vi.fn(),
    ...overrides,
  };
}

describe('runner → provider → wire cache_control (Phase 2 E2E)', () => {
  let server: Server;
  let baseURL: string;
  let tempDir: string;
  const captured: string[] = [];

  beforeEach(async () => {
    captured.length = 0;
    tempDir = mkdtempSync(join(tmpdir(), 'lace-runner-cache-e2e-'));

    // Initialize session files required by ConversationRunner.
    // nextEventSeq: 3 because we seed events.jsonl with events at eventSeq 1 and 2.
    writeFileSync(
      join(tempDir, 'state.json'),
      JSON.stringify({ nextEventSeq: 3, nextStreamSeq: 1 })
    );

    // Seed events.jsonl with:
    //   1. system_prompt_set — the runner reads this via buildProviderMessagesFromDurableEvents
    //      and calls provider.setSystemPrompt(), which is the invariant we are testing.
    //   2. prompt — the RPC layer normally writes this before calling runner.run().
    //      Without it, messages[] would be empty and the user-message sanity check fails.
    const systemPromptEvent = JSON.stringify({
      eventSeq: 1,
      timestamp: new Date().toISOString(),
      type: 'system_prompt_set',
      data: { text: 'You are Lace. Cached system block.' },
    });
    const promptEvent = JSON.stringify({
      eventSeq: 2,
      timestamp: new Date().toISOString(),
      type: 'prompt',
      data: { content: [{ type: 'text', text: 'Hello' }] },
    });
    writeFileSync(join(tempDir, 'events.jsonl'), systemPromptEvent + '\n' + promptEvent + '\n');

    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        captured.push(body);
        writeSseStream(res);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');
    baseURL = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    rmSync(tempDir, { recursive: true, force: true });
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  });

  it('runner pushes frozen systemPrompt to provider; wire body has cache_control on system block', async () => {
    // Construct a real AnthropicProvider pointing at the local test server.
    // No setSystemPrompt() call here — that is the runner's job, driven by the
    // system_prompt_set event read from events.jsonl.
    const provider = new AnthropicProvider({ apiKey: 'sk-test', baseURL });

    const deps = createMockDeps({
      createProvider: vi.fn().mockResolvedValue(provider),
    });

    const runner = new ConversationRunner(
      {
        sessionDir: tempDir,
        sessionId: `sess_${randomUUID()}`,
        cwd: tempDir,
        executionMode: 'execute',
        approvalMode: 'approve',
        modelId: 'claude-sonnet-4-20250514',
      },
      deps
    );

    await runner.run({
      content: [{ type: 'text', text: 'Hello' }],
      abortController: new AbortController(),
      turnId: `turn_${randomUUID()}`,
      startedAt: new Date().toISOString(),
    });

    // The runner must have made exactly one outbound HTTP request.
    expect(captured).toHaveLength(1);

    const body = JSON.parse(captured[0]) as {
      system: Array<{ type: string; text: string; cache_control?: unknown }>;
      messages: Array<{ role: string; content: unknown }>;
    };

    // 1. system must be an array (not a bare string) — the caching path stamps it.
    expect(Array.isArray(body.system)).toBe(true);

    // 2. The first (and only) system block carries the text from events.jsonl.
    expect(body.system[0].text).toBe('You are Lace. Cached system block.');

    // 3. cache_control with 1h TTL must be present — this is the invariant.
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });

    // 4. Sanity: the user prompt appears in messages.
    const userMessage = body.messages.find((m) => m.role === 'user');
    expect(userMessage).toBeDefined();
    // Content may be a string or array; either way it should contain 'Hello'.
    expect(JSON.stringify(userMessage!.content)).toContain('Hello');
  });
});
