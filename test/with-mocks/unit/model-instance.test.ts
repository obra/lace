// ABOUTME: Unit tests for ModelInstance interface and session behavior
// ABOUTME: Tests chat functionality, options handling, and stateful session management

import { describe, it, expect, jest } from '@jest/globals';
import { ModelInstance, ChatOptions, SessionOptions } from '../../../src/models/model-instance.js';
import { ModelDefinition } from '../../../src/models/model-definition.js';

describe('ModelInstance', () => {
  const mockDefinition: ModelDefinition = {
    name: 'claude-3-5-sonnet-20241022',
    provider: 'anthropic',
    contextWindow: 200000,
    inputPrice: 3.0,
    outputPrice: 15.0,
    capabilities: ['chat', 'tools', 'vision']
  };

  it('should have definition and chat method', () => {
    const mockChat = jest.fn().mockImplementation(() => Promise.resolve({ role: 'assistant', content: 'Hello' }));
    
    const instance: ModelInstance = {
      definition: mockDefinition,
      chat: mockChat
    } as ModelInstance;

    expect(instance.definition).toBe(mockDefinition);
    expect(typeof instance.chat).toBe('function');
  });

  it('should support chat with basic messages', async () => {
    const mockChat = jest.fn().mockImplementation(() => Promise.resolve({ role: 'assistant', content: 'Hello' }));
    
    const instance: ModelInstance = {
      definition: mockDefinition,
      chat: mockChat
    } as ModelInstance;

    const messages = [{ role: 'user', content: 'Hi' }];
    const result = await instance.chat(messages);

    expect(mockChat).toHaveBeenCalledWith(messages);
    expect(result).toEqual({ role: 'assistant', content: 'Hello' });
  });

  it('should support chat with options', async () => {
    const mockChat = jest.fn().mockImplementation(() => Promise.resolve({ role: 'assistant', content: 'Response' }));
    
    const instance: ModelInstance = {
      definition: mockDefinition,
      chat: mockChat
    } as ModelInstance;

    const messages = [{ role: 'user', content: 'Hi' }];
    const options: ChatOptions = {
      tools: [{ name: 'search' }],
      maxTokens: 1000,
      temperature: 0.7,
      onTokenUpdate: jest.fn()
    };

    await instance.chat(messages, options);

    expect(mockChat).toHaveBeenCalledWith(messages, options);
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