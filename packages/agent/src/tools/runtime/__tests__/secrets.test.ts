import { describe, expect, it } from 'vitest';
import {
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

  it('throws redacted errors for missing references', async () => {
    const resolver = new InMemoryRuntimeSecretResolver({});
    await expect(
      resolver.resolve({
        reference: { namespace: 'project', name: 'missing' },
        runtimeId: 'rt_1',
        sessionId: 'sess_1',
      })
    ).rejects.toThrow(RuntimeSecretResolutionError);
  });

  it('redacts reference identity for model-visible output', () => {
    expect(redactSecretReference({ namespace: 'project', name: 'api-key' })).toBe(
      '[secret:project:REDACTED]'
    );
  });
});
