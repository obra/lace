// ABOUTME: Tests for the createProviderForTurn factory function

import { describe, it, expect, afterEach } from 'vitest';
import { createProviderForTurn } from '../turn-factory';

describe('createProviderForTurn', () => {
  const originalEnv = process.env.LACE_AGENT_TEST_PROVIDER;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.LACE_AGENT_TEST_PROVIDER;
    else process.env.LACE_AGENT_TEST_PROVIDER = originalEnv;
  });

  it('returns TestAgentProvider when test provider enabled', async () => {
    process.env.LACE_AGENT_TEST_PROVIDER = '1';

    const provider = await createProviderForTurn({});

    expect(provider.constructor.name).toBe('TestAgentProvider');
  });

  it('throws InvalidParams when no connectionId/modelId and not test mode', async () => {
    delete process.env.LACE_AGENT_TEST_PROVIDER;

    await expect(createProviderForTurn({})).rejects.toMatchObject({
      code: -32602,
    });
  });

  it('throws InvalidParams when only connectionId provided', async () => {
    delete process.env.LACE_AGENT_TEST_PROVIDER;

    await expect(createProviderForTurn({ connectionId: 'conn-1' })).rejects.toMatchObject({
      code: -32602,
    });
  });

  it('throws InvalidParams when only modelId provided', async () => {
    delete process.env.LACE_AGENT_TEST_PROVIDER;

    await expect(createProviderForTurn({ modelId: 'model-1' })).rejects.toMatchObject({
      code: -32602,
    });
  });

  it('throws InvalidParams when connectionId is empty string', async () => {
    delete process.env.LACE_AGENT_TEST_PROVIDER;

    await expect(
      createProviderForTurn({ connectionId: '  ', modelId: 'model-1' })
    ).rejects.toMatchObject({
      code: -32602,
    });
  });
});
