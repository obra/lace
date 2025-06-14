// ABOUTME: Unit tests for ModelInstance interface and session behavior
// ABOUTME: Tests chat functionality, options handling, and stateful session management

import { describe, it, expect, jest } from '@jest/globals';
import { ModelInstance, ChatOptions, SessionOptions } from '../../../src/models/model-instance.js';
import { ModelDefinition } from '../../../src/models/model-definition.js';

// Import new mock factories
import { createMockModelDefinition, createMockModelInstance } from '../__mocks__/model-definitions.js';

describe('ModelInstance', () => {
  const mockDefinition = createMockModelDefinition('claude-3-5-sonnet-20241022');

  it('should have definition and chat method', () => {
    const instance = createMockModelInstance('claude-3-5-sonnet-20241022', {
      defaultResponse: 'Hello',
      shouldSucceed: true,
      definitionOverrides: {}
    });

    expect(instance.definition.name).toBe('claude-3-5-sonnet-20241022');
    expect(typeof instance.chat).toBe('function');
  });

  it('should support chat with basic messages', async () => {
    const instance = createMockModelInstance('claude-3-5-sonnet-20241022', {
      defaultResponse: 'Hello',
      shouldSucceed: true,
      definitionOverrides: {}
    });

    const messages = [{ role: 'user', content: 'Hi' }];
    const result = await instance.chat(messages);

    expect(instance.chat).toHaveBeenCalledWith(messages);
    expect(result).toEqual({ success: true, content: 'Hello', usage: expect.any(Object) });
  });

  it('should support chat with options', async () => {
    const instance = createMockModelInstance('claude-3-5-sonnet-20241022', {
      defaultResponse: 'Response',
      shouldSucceed: true,
      definitionOverrides: {}
    });

    const messages = [{ role: 'user', content: 'Hi' }];
    const options: ChatOptions = {
      tools: [{ name: 'search' }],
      maxTokens: 1000,
      temperature: 0.7,
      onTokenUpdate: jest.fn()
    };

    await instance.chat(messages, options);

    expect(instance.chat).toHaveBeenCalledWith(messages, options);
  });

  describe('ChatOptions', () => {
    it('should support all optional properties', () => {
      const options: ChatOptions = {
        tools: [{ name: 'tool1' }, { name: 'tool2' }],
        maxTokens: 2000,
        temperature: 0.8,
        onTokenUpdate: jest.fn()
      };

      expect(options.tools).toHaveLength(2);
      expect(options.maxTokens).toBe(2000);
      expect(options.temperature).toBe(0.8);
      expect(typeof options.onTokenUpdate).toBe('function');
    });

    it('should work with empty options', () => {
      const options: ChatOptions = {};
      
      expect(options.tools).toBeUndefined();
      expect(options.maxTokens).toBeUndefined();
      expect(options.temperature).toBeUndefined();
      expect(options.onTokenUpdate).toBeUndefined();
    });
  });

  describe('SessionOptions', () => {
    it('should support session configuration', () => {
      const options: SessionOptions = {
        sessionId: 'test-session-123',
        enableCaching: true
      };

      expect(options.sessionId).toBe('test-session-123');
      expect(options.enableCaching).toBe(true);
    });

    it('should work with minimal options', () => {
      const options: SessionOptions = {};
      
      expect(options.sessionId).toBeUndefined();
      expect(options.enableCaching).toBeUndefined();
    });
  });
});