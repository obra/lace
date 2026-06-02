// ABOUTME: Guards the runtime-binding Zod validator — esp. that the PRI-2012 selector fields pass .strict() (bug-#7 reproduction guard).
// ABOUTME: If a transitive container-spec validator omits the selector fields, a real shim binding fails validation; this test catches that at CI.

import { describe, it, expect } from 'vitest';
import { parseRuntimeExecutionBinding } from './validation';

function containerBinding(specExtra: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: 1,
    identity: { runtimeId: 'r1' },
    toolRuntime: {
      type: 'container',
      cwd: '/work',
      spec: {
        name: 'lace-x',
        image: 'img:dev',
        workingDirectory: '/work',
        mounts: [],
        ...specExtra,
      },
    },
    containerSharing: 'per_invocation',
  };
}

describe('parseRuntimeExecutionBinding — PRI-2012 selector-field completeness (bug-#7 guard)', () => {
  it('accepts a container binding carrying all four selector fields', () => {
    const b = parseRuntimeExecutionBinding(
      containerBinding({
        persona: 'ephemeral-shell',
        parentSession: 'sess_p',
        childSession: 'sess_c',
        jobId: 'job_x',
      })
    );
    const spec = (b.toolRuntime as { type: 'container'; spec: Record<string, unknown> }).spec;
    expect(spec.persona).toBe('ephemeral-shell');
    expect(spec.parentSession).toBe('sess_p');
    expect(spec.childSession).toBe('sess_c');
    expect(spec.jobId).toBe('job_x');
  });

  it('accepts a binding with no selector fields (all optional)', () => {
    expect(() => parseRuntimeExecutionBinding(containerBinding())).not.toThrow();
  });

  it('still rejects an unknown spec field — .strict() intact', () => {
    expect(() => parseRuntimeExecutionBinding(containerBinding({ bogusField: 'x' }))).toThrow();
  });
});
