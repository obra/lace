/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupWebTest } from '@lace/web/test-utils/web-test-setup';
import { EventStreamManager } from '@lace/web/lib/event-stream-manager';
import { parseTyped } from '@lace/web/lib/serialization';
import type { AppEvent } from '@lace/web/types/app-events';
import { getSupervisor, shutdownSupervisorForTests } from '@lace/web/lib/server/supervisor-service';
import { isProtocolEvent, isWebEvent } from '@lace/web/types/app-events';
import type { AgentStateChangeEvent } from '@lace/web/types/web-events';

function isAgentStateChangeEvent(event: AppEvent): event is AgentStateChangeEvent {
  return isWebEvent(event) && event.type === 'AGENT_STATE_CHANGE';
}

function createSseCollector(subscription: {
  projects?: string[];
  sessions?: string[];
  threads?: string[];
  global?: boolean;
}): {
  events: AppEvent[];
  stop: () => void;
} {
  const manager = EventStreamManager.getInstance();
  const events: AppEvent[] = [];

  let connectionId: string | null = null;
  let stopped = false;

  const decoder = new TextDecoder();
  let buffer = '';

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      connectionId = manager.addConnection(controller, subscription);
    },
  });

  const reader = stream.getReader();

  void (async () => {
    while (!stopped) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      buffer += decoder.decode(value, { stream: true });

      let sepIndex = buffer.indexOf('\n\n');
      while (sepIndex !== -1) {
        const chunk = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        sepIndex = buffer.indexOf('\n\n');

        if (chunk.startsWith(':')) {
          continue; // keepalive comment
        }

        const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '));
        if (!dataLine) continue;

        const data = dataLine.slice('data: '.length);
        try {
          events.push(parseTyped<AppEvent>(data));
        } catch {
          // Ignore malformed event (should not happen, but don't flake)
        }
      }
    }
  })();

  return {
    events,
    stop: () => {
      stopped = true;
      reader.cancel().catch(() => undefined);
      if (connectionId) manager.removeConnection(connectionId);
    },
  };
}

async function waitFor(
  predicate: () => boolean,
  params: { timeoutMs: number; intervalMs: number; label: string }
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < params.timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, params.intervalMs));
  }
  throw new Error(`Timed out waiting for ${params.label}`);
}

describe('event stream agent state', () => {
  const context = setupWebTest();
  let originalTestProviderEnv: string | undefined;

  beforeEach(() => {
    originalTestProviderEnv = process.env.LACE_AGENT_TEST_PROVIDER;
    process.env.LACE_AGENT_TEST_PROVIDER = '1';
  });

  afterEach(async () => {
    if (originalTestProviderEnv === undefined) delete process.env.LACE_AGENT_TEST_PROVIDER;
    else process.env.LACE_AGENT_TEST_PROVIDER = originalTestProviderEnv;

    await shutdownSupervisorForTests();
  });

  it(
    'streams AGENT_STATE_CHANGE transitions (thinking → streaming → idle) for a turn',
    { timeout: 20_000 },
    async () => {
      const supervisor = await getSupervisor();
      const created = await supervisor.createWorkspaceSession(context.tempProjectDir);

      const collector = createSseCollector({
        sessions: [created.workspaceSessionId],
        threads: [created.sessionId],
      });

      try {
        await supervisor.promptSession(created.workspaceSessionId, created.sessionId, [
          { type: 'text', text: 'hi' },
        ]);

        await waitFor(
          () =>
            collector.events.some(
              (e) =>
                isAgentStateChangeEvent(e) &&
                (e.agentSessionId === created.sessionId ||
                  e.data.agentSessionId === created.sessionId) &&
                e.data.newState === 'idle'
            ),
          { timeoutMs: 5_000, intervalMs: 25, label: 'agent idle state' }
        );

        const stateEvents = collector.events.filter(
          (e): e is AgentStateChangeEvent =>
            isAgentStateChangeEvent(e) &&
            (e.agentSessionId === created.sessionId || e.data.agentSessionId === created.sessionId)
        );

        const seen = stateEvents.map((e) => e.data.newState);
        expect(seen).toContain('thinking');
        expect(seen).toContain('streaming');
        expect(seen).toContain('idle');

        const thinkingIdx = seen.indexOf('thinking');
        const streamingIdx = seen.indexOf('streaming');
        const idleIdx = seen.lastIndexOf('idle');
        expect(thinkingIdx).toBeGreaterThanOrEqual(0);
        expect(streamingIdx).toBeGreaterThan(thinkingIdx);
        expect(idleIdx).toBeGreaterThan(streamingIdx);

        const idleStateEventSeq = (() => {
          for (let i = stateEvents.length - 1; i >= 0; i--) {
            if (stateEvents[i]?.data.newState === 'idle') return i;
          }
          return -1;
        })();
        expect(idleStateEventSeq).toBeGreaterThanOrEqual(0);

        const lateStreaming = stateEvents
          .slice(idleStateEventSeq + 1)
          .some((e) => e.data.newState === 'streaming');
        expect(lateStreaming).toBe(false);

        const protocolTurnEnd = collector.events.some(
          (e) => isProtocolEvent(e) && e.update.type === 'turn_end'
        );
        expect(protocolTurnEnd).toBe(true);
      } finally {
        collector.stop();
      }
    }
  );
});
