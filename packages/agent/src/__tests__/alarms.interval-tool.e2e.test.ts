// ABOUTME: E2E — schedule_alarm tool accepts `kind: 'interval'` via the test-provider
// ABOUTME: pattern and the alarm is persisted with spec.kind === 'interval'. Verifies
// ABOUTME: tool routing and alarms.json shape without waiting for the alarm to fire
// ABOUTME: (minimum interval is 5 minutes — far too slow for an e2e fire wait).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createE2EContext,
  defaultInitializeParams,
  spawnAgentProcess,
  withTimeout,
} from './helpers';

interface AlarmRow {
  kind: string;
  spec: { kind: string; minutes?: number };
  prompt: string;
}

interface AlarmsSnapshot {
  alarms: AlarmRow[];
}

describe('alarms e2e — interval kind tool routing', () => {
  const ctx = createE2EContext({ prefix: 'lace-alarm-interval-tool' });

  beforeEach(() => ctx.setup());
  afterEach(() => ctx.teardown());

  it(
    'schedules an interval alarm and persists it with the correct spec',
    { timeout: 15_000 },
    async () => {
      ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });
      ctx.agent.peer.onRequest('session/request_permission', async () => ({ decision: 'allow' }));

      await withTimeout(
        ctx.agent.peer.request(
          'initialize',
          defaultInitializeParams({ config: { approvalMode: 'allow' } })
        ),
        2_000,
        'initialize'
      );

      const created = (await withTimeout(
        ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
        2_000,
        'session/new'
      )) as { sessionId: string };

      // Use 73 minutes — well above the MIN_INTERVAL_MINUTES=5 floor, and
      // unambiguous so the test doesn't accidentally fire during the test run.
      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'alarm: interval=73 prompt=ping' }],
        }),
        10_000,
        'session/prompt (schedule interval)'
      );

      // Read alarms.json directly — much faster than waiting for fire.
      const alarmsPath = join(ctx.laceDir, 'agent-sessions', created.sessionId, 'alarms.json');
      expect(existsSync(alarmsPath), 'alarms.json should exist').toBe(true);

      const snap = JSON.parse(readFileSync(alarmsPath, 'utf8')) as AlarmsSnapshot;
      // Filter to pending/firing alarms (ignore any fired/cancelled rows from prior turns)
      const active = snap.alarms.filter((r) => r.kind === 'interval');
      expect(active).toHaveLength(1);

      const row = active[0];
      expect(row.kind).toBe('interval');
      expect(row.spec.kind).toBe('interval');
      expect(row.spec.minutes).toBe(73);
      expect(row.prompt).toBe('ping');
    }
  );
});
