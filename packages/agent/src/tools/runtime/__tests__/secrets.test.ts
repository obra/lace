import { describe, expect, it } from 'vitest';
import {
  EnvironmentRuntimeSecretResolver,
  InMemoryRuntimeSecretResolver,
  RuntimeSecretResolutionError,
  redactSecretReference,
} from '../secrets';

describe('runtime secret resolver', () => {
  it('resolves authorized references', async () => {
    const resolver = new InMemoryRuntimeSecretResolver({
      'project:api-key': 'secret-value',
    });

    await expect(
      resolver.resolve({
        reference: { namespace: 'project', name: 'api-key' },
        runtimeId: 'rt_1',
        sessionId: 'sess_1',
      })
    ).resolves.toBe('secret-value');
  });

  it('throws redacted errors with host diagnostic context for missing references', async () => {
    const resolver = new InMemoryRuntimeSecretResolver({});
    const secretValue = 'secret-value';

    try {
      await resolver.resolve({
        reference: { namespace: 'project', name: 'missing' },
        runtimeId: 'rt_1',
        sessionId: 'sess_1',
        jobId: 'job_1',
        serverId: 'server_1',
      });
      throw new Error('Expected secret resolution to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeSecretResolutionError);
      const resolutionError = error as RuntimeSecretResolutionError;
      const serializedError = JSON.stringify(resolutionError);

      expect(resolutionError.message).not.toContain('missing');
      expect(String(resolutionError)).not.toContain('missing');
      expect(serializedError).not.toContain('missing');
      expect(resolutionError.message).not.toContain(secretValue);
      expect(String(resolutionError)).not.toContain(secretValue);
      expect(serializedError).not.toContain(secretValue);
      expect(Object.keys(resolutionError)).not.toContain('reference');
      expect(resolutionError.redactedReference).toBe('[secret:project:REDACTED]');
      expect(resolutionError.runtimeId).toBe('rt_1');
      expect(resolutionError.sessionId).toBe('sess_1');
      expect(resolutionError.jobId).toBe('job_1');
      expect(resolutionError.serverId).toBe('server_1');
    }
  });

  it('resolves environment-backed references from explicit Lace secret variables', async () => {
    const resolver = new EnvironmentRuntimeSecretResolver({
      LACE_SECRET_PROJECT_API_KEY: 'secret-value',
      API_KEY: 'not-authorized',
    });

    await expect(
      resolver.resolve({
        reference: { namespace: 'project', name: 'api-key' },
        runtimeId: 'rt_1',
        sessionId: 'sess_1',
      })
    ).resolves.toBe('secret-value');
  });

  it('does not resolve bare parent environment variables as runtime secrets', async () => {
    const resolver = new EnvironmentRuntimeSecretResolver({
      API_KEY: 'not-authorized',
    });

    await expect(
      resolver.resolve({
        reference: { namespace: 'project', name: 'api-key' },
        runtimeId: 'rt_1',
        sessionId: 'sess_1',
      })
    ).rejects.toBeInstanceOf(RuntimeSecretResolutionError);
  });

  it('does not expose missing environment secret names in errors', async () => {
    const resolver = new EnvironmentRuntimeSecretResolver({});

    await expect(
      resolver.resolve({
        reference: { namespace: 'host-service', name: 'service-token' },
        runtimeId: 'rt_1',
        sessionId: 'sess_1',
        serverId: 'server_1',
      })
    ).rejects.toMatchObject({
      redactedReference: '[secret:host-service:REDACTED]',
      runtimeId: 'rt_1',
      sessionId: 'sess_1',
      serverId: 'server_1',
    });
  });

  it('redacts reference identity for model-visible output', () => {
    expect(redactSecretReference({ namespace: 'project', name: 'api-key' })).toBe(
      '[secret:project:REDACTED]'
    );
  });
});
