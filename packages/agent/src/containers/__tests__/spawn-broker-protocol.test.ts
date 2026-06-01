// ABOUTME: Tests for the spawn-broker wire protocol + persona-registry stub
// ABOUTME: The load-bearing assertions are that a caller cannot smuggle ANY container-spec field

import { describe, it, expect } from 'vitest';
import { parseSpawnBrokerRequest, SpawnBrokerProtocolError } from '../spawn-broker-protocol';
import { PERSONA_NAMES, StubPersonaCatalog } from '../spawn-broker-personas';

const VALID_SPAWN = {
  op: 'spawn' as const,
  persona: 'ephemeral-shell',
  parentSessionId: 'sess_abc',
  childSessionId: 'sess_child123',
  jobId: 'job_123',
};

describe('parseSpawnBrokerRequest — spawn', () => {
  it('accepts a spawn request with exactly {op,persona,parentSessionId,childSessionId,jobId}', () => {
    const req = parseSpawnBrokerRequest(VALID_SPAWN);
    expect(req).toEqual(VALID_SPAWN);
  });

  it.each(PERSONA_NAMES)('accepts the valid persona %s', (persona) => {
    const req = parseSpawnBrokerRequest({ ...VALID_SPAWN, persona });
    expect(req.op).toBe('spawn');
    if (req.op === 'spawn') {
      expect(req.persona).toBe(persona);
    }
  });

  it('rejects an unknown persona', () => {
    expect(() => parseSpawnBrokerRequest({ ...VALID_SPAWN, persona: 'root-shell' })).toThrow(
      SpawnBrokerProtocolError
    );
  });

  it('rejects a spawn request missing parentSessionId', () => {
    const { parentSessionId: _omit, ...rest } = VALID_SPAWN;
    expect(() => parseSpawnBrokerRequest(rest)).toThrow(SpawnBrokerProtocolError);
  });

  it('rejects a spawn request missing childSessionId', () => {
    const { childSessionId: _omit, ...rest } = VALID_SPAWN;
    expect(() => parseSpawnBrokerRequest(rest)).toThrow(SpawnBrokerProtocolError);
  });

  it('rejects a spawn request missing jobId', () => {
    const { jobId: _omit, ...rest } = VALID_SPAWN;
    expect(() => parseSpawnBrokerRequest(rest)).toThrow(SpawnBrokerProtocolError);
  });

  // SECURITY-CRITICAL: childSessionId feeds the per-spawn scratch dir name + the
  // container name. A path separator or dot would let a caller traverse out of
  // the broker's scratch base or shadow another container's name.
  it.each(['../etc', 'a/b', 'a.b', 'has space', 'tab\there', ''])(
    'rejects a path-unsafe / empty childSessionId %j',
    (childSessionId) => {
      expect(() => parseSpawnBrokerRequest({ ...VALID_SPAWN, childSessionId })).toThrow(
        SpawnBrokerProtocolError
      );
    }
  );

  it('rejects an over-long childSessionId (DoS cap = 64)', () => {
    expect(() =>
      parseSpawnBrokerRequest({ ...VALID_SPAWN, childSessionId: 'a'.repeat(65) })
    ).toThrow(SpawnBrokerProtocolError);
  });

  it('rejects an over-long jobId (DoS cap = 64)', () => {
    expect(() => parseSpawnBrokerRequest({ ...VALID_SPAWN, jobId: 'a'.repeat(65) })).toThrow(
      SpawnBrokerProtocolError
    );
  });

  it('accepts the real sess_<uuid> / job_<uuid> id formats', () => {
    const req = parseSpawnBrokerRequest({
      ...VALID_SPAWN,
      parentSessionId: 'sess_f6e64e86-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
      childSessionId: 'sess_aa11bb22-3c4d-5e6f-7a8b-9c0d1e2f3a4b',
      jobId: 'job_f6e64e86-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
    });
    expect(req.op).toBe('spawn');
  });

  // SECURITY-CRITICAL: every spec-bearing key must be rejected. If any of these
  // start passing, the broker's "caller has zero spec control" guarantee is gone.
  const dangerousFields: Array<[string, unknown]> = [
    ['mounts', [{ source: '/etc', target: '/host-etc' }]],
    ['volumes', ['/etc:/host-etc']],
    ['image', 'evil:latest'],
    ['command', ['/bin/sh', '-c', 'curl evil']],
    ['env', { SECRET: 'x' }],
    ['environment', { SECRET: 'x' }],
    ['network', 'host'],
    ['privileged', true],
    ['capAdd', ['SYS_ADMIN']],
    ['sysctls', { 'net.ipv4.ip_forward': '1' }],
    ['gatewayRoute', '10.0.0.1'],
    ['ports', [{ host: 22, container: 22 }]],
    ['workingDirectory', '/'],
    ['id', 'deadbeef'],
    ['name', 'attacker-chosen'],
    ['unknownField', 'whatever'],
  ];

  it.each(dangerousFields)('rejects a spawn request carrying %s', (key, value) => {
    expect(() => parseSpawnBrokerRequest({ ...VALID_SPAWN, [key]: value })).toThrow(
      SpawnBrokerProtocolError
    );
  });
});

describe('parseSpawnBrokerRequest — execStream', () => {
  const VALID_EXEC = {
    op: 'execStream' as const,
    containerName: 'lace-box-1',
    command: ['/bin/sh', '-c', 'echo hi'],
    jobId: 'job_123',
  };

  it('accepts an execStream request with command + jobId (the closed surface is SPAWN, not exec)', () => {
    const req = parseSpawnBrokerRequest(VALID_EXEC);
    expect(req).toEqual(VALID_EXEC);
  });

  it('accepts optional environment / workingDirectory / environmentMode', () => {
    const req = parseSpawnBrokerRequest({
      ...VALID_EXEC,
      environment: { FOO: 'bar' },
      workingDirectory: '/work',
      environmentMode: 'inherit',
    });
    expect(req.op).toBe('execStream');
  });

  it('rejects an execStream request with an empty command array', () => {
    expect(() => parseSpawnBrokerRequest({ ...VALID_EXEC, command: [] })).toThrow(
      SpawnBrokerProtocolError
    );
  });

  it('rejects an execStream request with no command', () => {
    const { command: _omit, ...rest } = VALID_EXEC;
    expect(() => parseSpawnBrokerRequest(rest)).toThrow(SpawnBrokerProtocolError);
  });

  it('accepts an execStream request with no jobId (broker falls back to the spawn jobId)', () => {
    // jobId is optional on the wire: the broker attributes to options.jobId when
    // the caller threads the current job, else the ownership-record spawn jobId.
    // per_invocation personas always have spawn == job; only the shared
    // persistent-box degrades to spawn-jobId attribution until ToolContext
    // jobId threading lands (deferred follow-up).
    const { jobId: _omit, ...rest } = VALID_EXEC;
    const req = parseSpawnBrokerRequest(rest);
    expect(req.op).toBe('execStream');
  });

  it('still rejects an over-long jobId when present (DoS cap holds for the optional field)', () => {
    expect(() => parseSpawnBrokerRequest({ ...VALID_EXEC, jobId: 'a'.repeat(65) })).toThrow(
      SpawnBrokerProtocolError
    );
  });

  it('rejects an execStream request with no containerName', () => {
    const { containerName: _omit, ...rest } = VALID_EXEC;
    expect(() => parseSpawnBrokerRequest(rest)).toThrow(SpawnBrokerProtocolError);
  });

  it('rejects an unknown environmentMode', () => {
    expect(() => parseSpawnBrokerRequest({ ...VALID_EXEC, environmentMode: 'merge' })).toThrow(
      SpawnBrokerProtocolError
    );
  });

  // execStream legitimately carries command+env (that's how the agent runs), but
  // .strict() must still reject SPEC-bearing keys — those belong only to the
  // registry-locked spawn, never to a per-call exec.
  const execSpecFields: Array<[string, unknown]> = [
    ['mounts', [{ source: '/etc', target: '/host-etc' }]],
    ['image', 'evil:latest'],
    ['network', 'host'],
    ['privileged', true],
    ['capAdd', ['SYS_ADMIN']],
    ['persona', 'persistent-box'],
    ['unknownField', 'whatever'],
  ];

  it.each(execSpecFields)('rejects an execStream request carrying %s', (key, value) => {
    expect(() => parseSpawnBrokerRequest({ ...VALID_EXEC, [key]: value })).toThrow(
      SpawnBrokerProtocolError
    );
  });
});

describe('parseSpawnBrokerRequest — other verbs', () => {
  it('accepts a valid list request', () => {
    const req = parseSpawnBrokerRequest({ op: 'list' });
    expect(req).toEqual({ op: 'list' });
  });

  it('rejects a list request carrying a containerName', () => {
    expect(() => parseSpawnBrokerRequest({ op: 'list', containerName: 'x' })).toThrow(
      SpawnBrokerProtocolError
    );
  });

  it('accepts a valid stop request without timeout', () => {
    const req = parseSpawnBrokerRequest({ op: 'stop', containerName: 'lace-box-1' });
    expect(req).toEqual({ op: 'stop', containerName: 'lace-box-1' });
  });

  it('accepts a valid stop request with timeoutSeconds', () => {
    const req = parseSpawnBrokerRequest({
      op: 'stop',
      containerName: 'lace-box-1',
      timeoutSeconds: 10,
    });
    expect(req).toEqual({ op: 'stop', containerName: 'lace-box-1', timeoutSeconds: 10 });
  });

  it('accepts a valid destroy request', () => {
    const req = parseSpawnBrokerRequest({ op: 'destroy', containerName: 'lace-box-1' });
    expect(req).toEqual({ op: 'destroy', containerName: 'lace-box-1' });
  });

  it('accepts a valid status request', () => {
    const req = parseSpawnBrokerRequest({ op: 'status', containerName: 'lace-box-1' });
    expect(req).toEqual({ op: 'status', containerName: 'lace-box-1' });
  });

  it('accepts a valid adopt request', () => {
    const req = parseSpawnBrokerRequest({ op: 'adopt', containerName: 'lace-box-1' });
    expect(req).toEqual({ op: 'adopt', containerName: 'lace-box-1' });
  });

  it('rejects a stop request with an empty containerName', () => {
    expect(() => parseSpawnBrokerRequest({ op: 'stop', containerName: '' })).toThrow(
      SpawnBrokerProtocolError
    );
  });
});

describe('parseSpawnBrokerRequest — malformed top-level', () => {
  it('rejects an unknown op', () => {
    expect(() => parseSpawnBrokerRequest({ op: 'launch', containerName: 'lace-box-1' })).toThrow(
      SpawnBrokerProtocolError
    );
  });

  it('rejects a missing op', () => {
    expect(() => parseSpawnBrokerRequest({ containerName: 'lace-box-1' })).toThrow(
      SpawnBrokerProtocolError
    );
  });

  it('rejects a non-object', () => {
    expect(() => parseSpawnBrokerRequest('spawn')).toThrow(SpawnBrokerProtocolError);
    expect(() => parseSpawnBrokerRequest(null)).toThrow(SpawnBrokerProtocolError);
  });
});

describe('StubPersonaCatalog', () => {
  it('throws the not-yet-populated error (documents pending PRI-2012 work)', () => {
    const catalog = new StubPersonaCatalog();
    expect(() =>
      catalog.buildContainerConfig('persistent-box', {
        parentSessionId: 'sess_abc',
        childSessionId: 'sess_child123',
        jobId: 'job_123',
        agentToken: 'tok',
      })
    ).toThrow('persona catalog not yet populated — pending PRI-2012 Component B Task 2');
  });
});
