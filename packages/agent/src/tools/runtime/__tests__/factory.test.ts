import { describe, expect, it } from 'vitest';
import { createToolRuntimeFromBinding } from '../factory';
import type { RuntimeExecutionBinding } from '../types';

describe('createToolRuntimeFromBinding', () => {
  it('rejects container agent placement in the host-side runtime factory', () => {
    const binding: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'rt_container_agent' },
      agentPlacement: 'container',
      toolRuntime: { type: 'local', cwd: '/repo' },
    };

    expect(() => createToolRuntimeFromBinding({ binding })).toThrow(/container agent placement/i);
  });
});
