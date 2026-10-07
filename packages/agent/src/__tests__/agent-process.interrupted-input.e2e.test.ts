// ABOUTME: Exercises recovered immediate input through real process death and prompt execution.
// ABOUTME: Recovery must dispatch the saved input once while retaining its original conversation.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { once } from 'node:events';
import { join } from 'node:path';
import { readAllSessionEventLines, type DurableEvent } from '../storage/event-log';
import { getSessionDir } from '../storage/session-store';
import {
  AGENT_BOOT_TIMEOUT_MS,
  createE2EContext,
  defaultInitializeParams,
  E2E_TEST_TIMEOUT_MS,
  spawnAgentProcess,
  withTimeout,
} from './helpers';

describe('interrupted immediate-input recovery', { timeout: E2E_TEST_TIMEOUT_MS }, () => {
  const ctx = createE2EContext({ prefix: 'lace-interrupted-input' });
  const marker = 'recover-native-input-unique-marker';
  const handoff = {
    content: [{ type: 'text', text: marker }],
    idempotencyKey: 'input-1',
    track: 'track-1',
  };

  beforeEach(() => ctx.setup());
  afterEach(() => ctx.teardown());

  function requests(): Array<{ roles: string[]; messages: unknown[] }> {
    const file = join(ctx.laceDir, 'provider-requests.jsonl');
    return existsSync(file)
      ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse)
      : [];
  }

  function events(sessionId: string): DurableEvent[] {
    return readAllSessionEventLines(getSessionDir(sessionId)).map(JSON.parse);
  }

  async function start(delayMs: number, sessionId?: string) {
    ctx.agent = spawnAgentProcess({
      laceDir: ctx.laceDir,
      env: {
        LACE_AGENT_TEST_PROVIDER: '1',
        LACE_TEST_PROVIDER_STREAM_DELAY_MS: String(delayMs),
        LACE_TEST_PROVIDER_RECORD_REQUESTS: join(ctx.laceDir, 'provider-requests.jsonl'),
      },
    });
    ctx.agent.peer.onRequest('session/update', async () => undefined);
    await withTimeout(
      ctx.agent.peer.request('initialize', defaultInitializeParams()),
      AGENT_BOOT_TIMEOUT_MS,
      'initialize'
    );
    if (sessionId) {
      await ctx.agent.peer.request('session/load', { sessionId, cwd: ctx.workDir, mcpServers: [] });
      return sessionId;
    }
    const session = (await ctx.agent.peer.request('session/new', {
      cwd: ctx.workDir,
      mcpServers: [],
    })) as { sessionId: string };
    return session.sessionId;
  }

  async function kill() {
    const agent = ctx.agent!;
    const exited = once(agent.proc, 'exit');
    agent.proc.kill('SIGKILL');
    await exited;
    agent.peer.close();
    ctx.agent = undefined;
  }

  it.each([false, true])(
    'handles the saved input without replay after secondCrash=%s',
    async (secondCrash) => {
      const sessionId = await start(30_000);
      const interrupted = ctx
        .agent!.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'Begin controlled work.' }],
        })
        .catch(() => undefined);
      await expect.poll(() => requests().length).toBe(1);
      const injected = await ctx.agent!.peer.request('ent/session/inject', {
        ...handoff,
        priority: 'immediate',
      });
      expect(injected).toMatchObject({ durableHandoffStatus: 'persisted-new' });
      await kill();
      await interrupted;

      await start(secondCrash ? 30_000 : 0, sessionId);
      expect(requests()).toHaveLength(1);
      expect(
        events(sessionId).some((e) => e.type === 'turn_end' && e.data.stopReason === 'process_died')
      ).toBe(true);
      await expect(
        ctx.agent!.peer.request('session/prompt', {
          ...handoff,
          content: [{ type: 'text', text: 'Changed input must be refused.' }],
        })
      ).rejects.toMatchObject({ data: { durableHandoffStatus: 'duplicate-unsafe-retry' } });
      expect(requests()).toHaveLength(1);

      let recovered = ctx.agent!.peer.request('session/prompt', handoff);
      if (secondCrash) {
        recovered.catch(() => undefined);
        await expect.poll(() => requests().length).toBe(2);
        await expect(ctx.agent!.peer.request('session/prompt', handoff)).rejects.toMatchObject({
          message: 'SessionBusy',
        });
        await kill();
        await recovered.catch(() => undefined);
        await start(0, sessionId);
        expect(requests()).toHaveLength(2);
        recovered = ctx.agent!.peer.request('session/prompt', handoff);
      }
      expect(await withTimeout(recovered, 10_000, 'recovered prompt')).toEqual({
        durableHandoffStatus: 'duplicate-already-handled',
      });

      const dispatched = requests().slice(1);
      expect(dispatched.length).toBeGreaterThan(0);
      for (const request of dispatched) {
        expect(JSON.stringify(request.messages).split(marker).length - 1).toBe(1);
        expect(request.roles.at(-1)).toBe('user');
      }
      const sourceEvents = events(sessionId).filter(
        (e) => e.data.idempotencyKey === handoff.idempotencyKey
      );
      expect(sourceEvents.map((e) => e.type)).toEqual(['context_injected']);
      const recoveredPrompts = events(sessionId).filter(
        (e) => e.type === 'prompt' && e.data.track === handoff.track
      );
      expect(recoveredPrompts.length).toBeGreaterThan(0);
      expect(
        recoveredPrompts.every(
          (e) => !e.data.idempotencyKey && !JSON.stringify(e.data.content).includes(marker)
        )
      ).toBe(true);
      expect(
        events(sessionId).some((e) => e.type === 'turn_end' && e.data.stopReason === 'end_turn')
      ).toBe(true);

      const completedRequestCount = requests().length;
      expect(await ctx.agent!.peer.request('session/prompt', handoff)).toEqual({
        durableHandoffStatus: 'duplicate-already-handled',
      });
      expect(requests()).toHaveLength(completedRequestCount);
    }
  );
  it('keeps recovery retryable when its continuation is cancelled', async () => {
    const sessionId = await start(30_000);
    const interrupted = ctx
      .agent!.peer.request('session/prompt', {
        content: [{ type: 'text', text: 'Begin controlled work.' }],
      })
      .catch(() => undefined);
    await expect.poll(() => requests().length).toBe(1);
    await ctx.agent!.peer.request('ent/session/inject', { ...handoff, priority: 'immediate' });
    await kill();
    await interrupted;
    await start(30_000, sessionId);
    const recovered = ctx.agent!.peer.request('session/prompt', handoff).catch((error) => error);
    await expect.poll(() => requests().length).toBe(2);
    await ctx.agent!.peer.request('session/cancel', { sessionId });
    expect(await recovered).toMatchObject({
      message: 'Interrupted input continuation did not complete',
    });
    await kill();
    await start(0, sessionId);
    expect(await ctx.agent!.peer.request('session/prompt', handoff)).toEqual({
      durableHandoffStatus: 'duplicate-already-handled',
    });
    expect(
      events(sessionId)
        .filter((e) => e.data.idempotencyKey === handoff.idempotencyKey)
        .map((e) => e.type)
    ).toEqual(['context_injected']);
    expect(
      events(sessionId).some((e) => e.type === 'turn_end' && e.data.stopReason === 'end_turn')
    ).toBe(true);
  });
});
