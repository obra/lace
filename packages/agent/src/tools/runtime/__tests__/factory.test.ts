import { describe, expect, it } from 'vitest';
import { createToolRuntimeFromBinding } from '../factory';

describe('createToolRuntimeFromBinding', () => {
  it('creates raw host runtime only for explicit host descriptors', () => {
    const runtime = createToolRuntimeFromBinding({
      binding: {
        schemaVersion: 1,
        identity: { runtimeId: 'rt_host' },
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
        toolRuntime: { type: 'boundedHost', root: '/repo', cwd: '/repo' },
      },
    });
    expect(runtime.kind).toBe('boundedHost');
  });
});
