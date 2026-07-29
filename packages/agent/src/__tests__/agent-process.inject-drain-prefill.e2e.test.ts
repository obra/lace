// ABOUTME: E2E reproduction of the inject-drain prefill wedge. An immediate
// ABOUTME: context_injected that lands mid-turn is drained by a follow-up turn
// ABOUTME: prompted with EMPTY content. That only surfaces the inject when it is
// ABOUTME: still the last thing in the transcript; once the turn has emitted an
// ABOUTME: assistant message, the drain dispatches a request whose conversation
// ABOUTME: ends with an assistant message — an assistant prefill, which
// ABOUTME: extended-thinking models reject with a hard 400.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  createE2EContext,
  spawnAgentProcess,
  withTimeout,
  defaultInitializeParams,
} from './helpers';

/**
 * Observed in production (ada-sen, 2026-07-29 18:03Z, and 8 further times since
 * 2026-07-11). The transcript signature is always the same three events:
 *
 *   context_injected (folds to user) -> message (folds to assistant) -> turn_end
 *
 * followed by a `prompt` event carrying `content: []`, and a turn_end with
 * `stopReason: 'provider_error_invalid'`. The provider error is:
 *
 *   400 invalid_request_error: This model does not support assistant message
 *   prefill. The conversation must end with a user message.
 *
 * It is not retryable, so the turn dies and whatever prompted it is dropped
 * silently — the agent simply goes deaf while every container stays healthy.
 */
describe('inject-drain prefill wedge (E2E)', () => {
  const ctx = createE2EContext({ prefix: 'lace-inject-drain-prefill' });

  beforeEach(() => ctx.setup());
  afterEach(() => ctx.teardown());

  function readRequestRoles(recordPath: string): string[][] {
    if (!existsSync(recordPath)) return [];
    return readFileSync(recordPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => (JSON.parse(l) as { roles: string[] }).roles);
  }

  /** Every durable event in the lace dir, from the JSONL shards on disk. */
  function readSessionEvents(laceDir: string): Array<{ type?: string; data?: unknown }> {
    const events: Array<{ type?: string; data?: unknown }> = [];
    for (const file of findJsonlFiles(laceDir)) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          events.push(JSON.parse(line) as { type?: string });
        } catch {
          // ignore partial/malformed line
        }
      }
    }
    return events;
  }

  function findJsonlFiles(dir: string): string[] {
    const found: string[] = [];
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return found;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) found.push(...findJsonlFiles(full));
      else if (entry.name.endsWith('.jsonl')) found.push(full);
    }
    return found;
  }

  async function sleep(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  it(
    'drains a mid-turn inject with a request that ends on an assistant message',
    { timeout: 30_000 },
    async () => {
      const recordPath = join(ctx.laceDir, 'provider-requests.jsonl');

      ctx.agent = spawnAgentProcess({
        laceDir: ctx.laceDir,
        env: {
          LACE_AGENT_TEST_PROVIDER: '1',
          // Hold the provider call open long enough to land an inject while the
          // turn is genuinely in flight — the production race, not a simulation
          // of it: the inject must arrive AFTER the request was dispatched.
          LACE_TEST_PROVIDER_STREAM_DELAY_MS: '2500',
          LACE_TEST_PROVIDER_RECORD_REQUESTS: recordPath,
        },
      });

      ctx.agent.peer.onRequest('session/update', async () => undefined);

      await withTimeout(
        ctx.agent.peer.request('initialize', defaultInitializeParams()),
        5_000,
        'initialize'
      );
      await withTimeout(
        ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
        5_000,
        'session/new'
      );

      // Start a turn but do NOT await it: the provider call is now in flight.
      const promptPromise = ctx.agent.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'Say hello and stop.' }],
      });

      // Land an immediate inject while that call is still open. This is exactly
      // the production shape: the runner's inject tailer has already read for
      // this round-trip, so the inject is genuinely undelivered at turn_end.
      await sleep(800);
      ctx.agent.peer.notify('ent/session/inject', {
        content: [{ type: 'text', text: 'news?' }],
        priority: 'immediate',
      });

      await withTimeout(promptPromise, 20_000, 'session/prompt');

      // Let the scheduled drain turn run to completion.
      await sleep(3_000);

      const events = readSessionEvents(ctx.laceDir);
      const injected = events.filter((e) => e.type === 'context_injected');
      const emptyPrompts = events.filter(
        (e) =>
          e.type === 'prompt' &&
          Array.isArray((e.data as { content?: unknown[] })?.content) &&
          (e.data as { content: unknown[] }).content.length === 0
      );

      // Preconditions: the inject landed, and the drain fired an EMPTY prompt.
      expect(injected.length).toBeGreaterThanOrEqual(1);
      expect(emptyPrompts.length).toBeGreaterThanOrEqual(1);

      // The hypothesis. The drain dispatched a real provider request, and that
      // request's conversation ends on an assistant message — the prefill a
      // thinking-enabled model rejects. Asserted against the request the
      // provider was actually handed, not a re-derivation of it.
      const requests = readRequestRoles(recordPath);
      expect(requests.length).toBeGreaterThanOrEqual(2);

      // Control: the ORIGINAL turn's request is well-formed and ends on the
      // user. Without this the assertion below would pass even if every request
      // ended on an assistant message, making the test meaningless.
      const firstRequest = requests[0];
      expect(firstRequest[firstRequest.length - 1]).toBe('user');

      const drainRequest = requests[requests.length - 1];
      expect(drainRequest.length).toBeGreaterThan(0);
      expect(drainRequest[drainRequest.length - 1]).toBe('assistant');
    }
  );

  it(
    'control: with no mid-turn inject there is no empty-prompt drain',
    { timeout: 30_000 },
    async () => {
      const recordPath = join(ctx.laceDir, 'provider-requests.jsonl');

      ctx.agent = spawnAgentProcess({
        laceDir: ctx.laceDir,
        env: {
          LACE_AGENT_TEST_PROVIDER: '1',
          LACE_TEST_PROVIDER_STREAM_DELAY_MS: '2500',
          LACE_TEST_PROVIDER_RECORD_REQUESTS: recordPath,
        },
      });

      ctx.agent.peer.onRequest('session/update', async () => undefined);

      await withTimeout(
        ctx.agent.peer.request('initialize', defaultInitializeParams()),
        5_000,
        'initialize'
      );
      await withTimeout(
        ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
        5_000,
        'session/new'
      );

      // Identical turn, identical timing — the ONLY difference is that no
      // inject lands. This isolates the inject as the cause.
      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'Say hello and stop.' }],
        }),
        20_000,
        'session/prompt'
      );
      await sleep(3_000);

      const events = readSessionEvents(ctx.laceDir);
      const emptyPrompts = events.filter(
        (e) =>
          e.type === 'prompt' &&
          Array.isArray((e.data as { content?: unknown[] })?.content) &&
          (e.data as { content: unknown[] }).content.length === 0
      );
      expect(emptyPrompts).toHaveLength(0);

      // And every request the provider saw is well-formed.
      for (const roles of readRequestRoles(recordPath)) {
        expect(roles[roles.length - 1]).toBe('user');
      }
    }
  );
});
