// ABOUTME: Tests for the spawn-broker wire protocol + persona-registry stub
// ABOUTME: The load-bearing assertions are that a caller cannot smuggle ANY container-spec field

import { describe, it, expect } from 'vitest';
import { parseSpawnBrokerRequest, SpawnBrokerProtocolError } from '../spawn-broker-protocol';
import { PERSONA_NAMES, StubPersonaRegistry } from '../persona-registry';

const VALID_SPAWN = {
  op: 'spawn' as const,
  persona: 'ephemeral-shell',
  sessionId: 'sess_abc',
  jobId: 'job_123',
};

describe('parseSpawnBrokerRequest — spawn', () => {
  it('accepts a spawn request with exactly {op,persona,sessionId,jobId}', () => {
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

  it('rejects a spawn request missing sessionId', () => {
    const { sessionId: _omit, ...rest } = VALID_SPAWN;
    expect(() => parseSpawnBrokerRequest(rest)).toThrow(SpawnBrokerProtocolError);
  });

  it('rejects a spawn request missing jobId', () => {
    const { jobId: _omit, ...rest } = VALID_SPAWN;
    expect(() => parseSpawnBrokerRequest(rest)).toThrow(SpawnBrokerProtocolError);
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

describe('parseSpawnBrokerRequest — other verbs', () => {
  it('accepts a valid exec request', () => {
    const req = parseSpawnBrokerRequest({ op: 'exec', containerName: 'lace-box-1' });
    expect(req).toEqual({ op: 'exec', containerName: 'lace-box-1' });
  });

  it('rejects an exec request carrying a command field (no caller-chosen command)', () => {
    expect(() =>
      parseSpawnBrokerRequest({
        op: 'exec',
        containerName: 'lace-box-1',
        command: ['/bin/sh'],
      })
    ).toThrow(SpawnBrokerProtocolError);
  });

  it('rejects an exec request with no containerName', () => {
    expect(() => parseSpawnBrokerRequest({ op: 'exec' })).toThrow(SpawnBrokerProtocolError);
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

describe('StubPersonaRegistry', () => {
  it('throws the not-yet-populated error (documents pending PRI-2012 work)', () => {
    const registry = new StubPersonaRegistry();
    expect(() =>
      registry.buildContainerConfig('persistent-box', {
        sessionId: 'sess_abc',
        jobId: 'job_123',
        containerName: 'lace-box-1',
        agentToken: 'tok',
      })
    ).toThrow('persona registry not yet populated — pending PRI-2012 persona enumeration');
  });
});
