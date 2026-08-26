// ABOUTME: A tool call that never returns takes the whole agent loop offline
// ABOUTME: (PRI-2975: file_find ran 96 minutes and ada-sen went mute). The
// ABOUTME: executor cannot safely kill such a call, but it must say which tool
// ABOUTME: is responsible, because the symptom is silence.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ToolExecutor } from './executor';
import { Tool } from './tool';
import { logger } from '@lace/agent/utils/logger';
import { z } from 'zod';
import type { ToolResult } from './types';

class SleepyTool extends Tool {
  name = 'sleepy';
  description = 'sleeps';
  schema = z.object({ ms: z.number() });
  protected async executeValidated(args: { ms: number }): Promise<ToolResult> {
    await new Promise((r) => setTimeout(r, args.ms));
    return this.createResult('done');
  }
}

describe('ToolExecutor slow-tool warning (PRI-2975)', () => {
  let executor: ToolExecutor;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  const originalThreshold = ToolExecutor.SLOW_TOOL_WARN_MS;

  beforeEach(() => {
    executor = new ToolExecutor();
    executor.registerTool('sleepy', new SleepyTool());
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    ToolExecutor.SLOW_TOOL_WARN_MS = originalThreshold;
    warnSpy.mockRestore();
  });

  it('names the tool still running past the threshold', async () => {
    ToolExecutor.SLOW_TOOL_WARN_MS = 10;

    await executor.execute({ id: 'c1', name: 'sleepy', arguments: { ms: 80 } }, {});

    const named = warnSpy.mock.calls.some(
      (call) =>
        JSON.stringify(call).includes('sleepy') && /still running/i.test(JSON.stringify(call))
    );
    expect(named).toBe(true);
  });

  it('stays quiet for a tool that returns promptly', async () => {
    ToolExecutor.SLOW_TOOL_WARN_MS = 10_000;

    await executor.execute({ id: 'c2', name: 'sleepy', arguments: { ms: 1 } }, {});

    const named = warnSpy.mock.calls.some((call) => /still running/i.test(JSON.stringify(call)));
    expect(named).toBe(false);
  });

  it('does not leave a timer behind that fires after the tool finished', async () => {
    ToolExecutor.SLOW_TOOL_WARN_MS = 40;

    await executor.execute({ id: 'c3', name: 'sleepy', arguments: { ms: 1 } }, {});
    warnSpy.mockClear();
    await new Promise((r) => setTimeout(r, 90));

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
