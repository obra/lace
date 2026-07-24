// ABOUTME: Tests for the integration-test availability gate
// ABOUTME: Ensures a suite skips when the model it actually exercises is absent

import { describe, it, expect } from 'vitest';
import { checkProviderAvailability } from './provider-test-helpers';

function fakeProvider(connected: boolean, models: string[]) {
  return {
    diagnose: () => Promise.resolve({ connected, models }),
  };
}

describe('checkProviderAvailability', () => {
  it('reports unavailable when the server is unreachable', async () => {
    await expect(checkProviderAvailability('Fake', fakeProvider(false, []))).resolves.toBe(false);
  });

  it('reports unavailable when the server has no models at all', async () => {
    await expect(checkProviderAvailability('Fake', fakeProvider(true, []))).resolves.toBe(false);
  });

  it('reports available when connected and no specific model is required', async () => {
    await expect(
      checkProviderAvailability('Fake', fakeProvider(true, ['some-model']))
    ).resolves.toBe(true);
  });

  it('reports unavailable when the REQUIRED model is not pulled', async () => {
    // The gate previously only asked "is the server up with any model at all?".
    // A suite could therefore pass the gate on a machine holding a completely
    // different model and then fail every test on `Model "x" is not available`.
    // An integration test whose dependency is missing must SKIP, not fail — a
    // red suite that means "you didn't pull a 32b model" trains people to
    // ignore red.
    await expect(
      checkProviderAvailability('Fake', fakeProvider(true, ['gemma4:latest']), 'qwen3:32b')
    ).resolves.toBe(false);
  });

  it('reports available when the required model is present', async () => {
    await expect(
      checkProviderAvailability(
        'Fake',
        fakeProvider(true, ['gemma4:latest', 'qwen3:32b']),
        'qwen3:32b'
      )
    ).resolves.toBe(true);
  });
});
