import { describe, expect, it } from 'vitest';
import { createToolRuntimeFromBinding } from '../factory';
import type { RuntimeExecutionBinding } from '../types';

describe('createToolRuntimeFromBinding', () => {
  it('rejects container agent placement in the host-side runtime factory', () => {
    const binding: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'rt_container_agent' },
      agentPlacement: 'container',
      toolRuntime: {
        type: 'boundedHost',
        root: '/repo',
        cwd: '/repo',
      },
    };

    expect(() => createToolRuntimeFromBinding({ binding })).toThrow(/container agent placement/i);
  });

  it('creates raw host runtime only for explicit host descriptors', () => {
    const runtime = createToolRuntimeFromBinding({
      binding: {
        schemaVersion: 1,
        identity: { runtimeId: 'rt_host' },
        agentPlacement: 'host',
        toolRuntime: { type: 'host', cwd: '/repo' },
      },
    });
    expect(runtime.kind).toBe('host');
  });

  it('creates bounded host runtime for boundedHost descriptors', () => {
    const runtime = createToolRuntimeFromBinding({
      binding: {
        schemaVersion: 1,
        identity: { runtimeId: 'rt_bounded' },
        agentPlacement: 'host',
        toolRuntime: { type: 'boundedHost', root: '/repo', cwd: '/repo' },
      },
    });
    expect(runtime.kind).toBe('boundedHost');
  });
});
