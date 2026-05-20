import { describe, expect, it } from 'vitest';
import { buildLegacyRuntimeId, canonicalRuntimeIdentityJson } from '../identity';
import type { RuntimeExecutionBinding } from '../types';

describe('runtime identity', () => {
  it('matches the legacy local fixture from the spec', () => {
    const binding: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'legacy:session:sess_123:d33ee12dd7d5f31b' },
      agentPlacement: 'host',
      toolRuntime: { type: 'local', cwd: '/repo' },
    };

    expect(
      canonicalRuntimeIdentityJson({
        schemaVersion: binding.schemaVersion,
        agentPlacement: binding.agentPlacement,
        scope: 'session',
        sessionId: 'sess_123',
        toolRuntime: binding.toolRuntime,
      })
    ).toBe(
      '{"agentPlacement":"host","schemaVersion":1,"scope":"session","sessionId":"sess_123","toolRuntime":{"cwd":"/repo","type":"local"}}'
    );

    expect(buildLegacyRuntimeId({ scope: 'session', sessionId: 'sess_123', binding })).toBe(
      'legacy:session:sess_123:d33ee12dd7d5f31b'
    );
  });

  it('matches the legacy workspace fixture from the spec', () => {
    const binding: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'legacy:session:sess_123:540af98facc5cf4c' },
      agentPlacement: 'host',
      toolRuntime: {
        type: 'workspace',
        projectRoot: '/repo',
        workspaceRoot: '/tmp/ws',
        cwd: '/work',
      },
    };

    expect(buildLegacyRuntimeId({ scope: 'session', sessionId: 'sess_123', binding })).toBe(
      'legacy:session:sess_123:540af98facc5cf4c'
    );
  });

  it('matches the legacy job fixture from the spec', () => {
    const binding: RuntimeExecutionBinding = {
      schemaVersion: 1,
      identity: { runtimeId: 'legacy:job:sess_123:job_456:4412929fcf49cd3e' },
      agentPlacement: 'host',
      toolRuntime: { type: 'local', cwd: '/repo' },
    };

    expect(
      buildLegacyRuntimeId({
        scope: 'job',
        sessionId: 'sess_123',
        jobId: 'job_456',
        binding,
      })
    ).toBe('legacy:job:sess_123:job_456:4412929fcf49cd3e');
  });
});
