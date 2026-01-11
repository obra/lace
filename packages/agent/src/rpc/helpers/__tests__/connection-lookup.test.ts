// ABOUTME: Tests for connection lookup helper

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getConnectionInstance, assertConnectionExists } from '../connection-lookup';
import { EntErrorCodes } from '@lace/ent-protocol';
import type { AgentServerState } from '@lace/agent/server-types';

describe('connection-lookup', () => {
  const mockInstance = {
    connectionId: 'test-connection',
    catalogProviderId: 'anthropic',
    name: 'Test Connection',
  };

  const createMockState = (instances: Record<string, unknown> = {}) =>
    ({
      providerInstances: {
        loadInstances: vi.fn().mockResolvedValue({ instances }),
      },
    }) as unknown as AgentServerState;

  describe('getConnectionInstance', () => {
    it('should return connectionId and instance when found', async () => {
      const state = createMockState({ 'test-connection': mockInstance });

      const result = await getConnectionInstance(state, 'test-connection');

      expect(result.connectionId).toBe('test-connection');
      expect(result.instance).toBe(mockInstance);
    });

    it('should throw InvalidParams when connectionId is empty', async () => {
      const state = createMockState();

      await expect(getConnectionInstance(state, '')).rejects.toMatchObject({
        code: -32602, // InvalidParams
      });
    });

    it('should throw InvalidParams when connectionId is null', async () => {
      const state = createMockState();

      await expect(getConnectionInstance(state, null)).rejects.toMatchObject({
        code: -32602,
      });
    });

    it('should throw ConnectionNotFound when instance does not exist', async () => {
      const state = createMockState({});

      await expect(getConnectionInstance(state, 'nonexistent')).rejects.toMatchObject({
        code: EntErrorCodes.ConnectionNotFound,
        message: 'ConnectionNotFound',
        data: { category: 'provider' },
      });
    });
  });

  describe('assertConnectionExists', () => {
    it('should return connectionId when connection exists', async () => {
      const state = createMockState({ 'test-connection': mockInstance });

      const result = await assertConnectionExists(state, 'test-connection');

      expect(result).toBe('test-connection');
    });

    it('should throw ConnectionNotFound when connection does not exist', async () => {
      const state = createMockState({});

      await expect(assertConnectionExists(state, 'nonexistent')).rejects.toMatchObject({
        code: EntErrorCodes.ConnectionNotFound,
      });
    });

    it('should throw InvalidParams when connectionId is empty', async () => {
      const state = createMockState();

      await expect(assertConnectionExists(state, '')).rejects.toMatchObject({
        code: -32602,
      });
    });
  });
});
