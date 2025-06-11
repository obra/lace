// ABOUTME: Integration tests for complete conversation workflows
// ABOUTME: Tests end-to-end user experience from message input to response display

import React from 'react';
import { render } from 'ink-testing-library';
import App from '@/ui/App.tsx';

// Mock external dependencies
jest.mock('@/database/conversation-db.js');
jest.mock('@/models/model-provider.js');
jest.mock('@/tools/tool-registry.js');
jest.mock('@/logging/activity-logger.js');
jest.mock('@/snapshot/snapshot-manager.js');

const mockConversationDB = {
  saveMessage: jest.fn(() => Promise.resolve()),
  getConversationHistory: jest.fn(() => Promise.resolve([
    { role: 'user', content: 'Hello', timestamp: '2023-01-01T00:00:00Z' },
    { role: 'assistant', content: 'Hi there! How can I help you?', timestamp: '2023-01-01T00:01:00Z' }
  ])),
  init: jest.fn(() => Promise.resolve()),
  close: jest.fn(() => Promise.resolve())
};

const mockModelProvider = {
  chat: jest.fn(() => Promise.resolve({
    success: true,
    content: 'Test response from model',
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  })),
  countTokens: jest.fn(() => Promise.resolve({ success: true, inputTokens: 10 })),
  getContextWindow: jest.fn(() => 200000),
  stream: jest.fn()
};

const mockToolRegistry = {
  listTools: jest.fn(() => ['file', 'shell', 'search']),
  getToolSchema: jest.fn(() => ({
    description: 'Mock tool',
    methods: { execute: { description: 'Execute', parameters: {} } }
  })),
  getAllSchemas: jest.fn(() => ({})),
  initialize: jest.fn(() => Promise.resolve()),
  callTool: jest.fn(() => Promise.resolve({ success: true, result: 'Mock result' }))
};

const mockActivityLogger = {
  logEvent: jest.fn(() => Promise.resolve()),
  init: jest.fn(() => Promise.resolve()),
  close: jest.fn(() => Promise.resolve())
};

const mockSnapshotManager = {
  initialize: jest.fn(() => Promise.resolve()),
  createSnapshot: jest.fn(() => Promise.resolve({ id: 'test-snapshot' }))
};

// Apply mocks
require('@/database/conversation-db.js').ConversationDB = jest.fn(() => mockConversationDB);
require('@/models/model-provider.js').ModelProvider = jest.fn(() => mockModelProvider);
require('@/tools/tool-registry.js').ToolRegistry = jest.fn(() => mockToolRegistry);
require('@/logging/activity-logger.js').ActivityLogger = jest.fn(() => mockActivityLogger);
require('@/snapshot/snapshot-manager.js').SnapshotManager = jest.fn(() => mockSnapshotManager);

describe('Full Conversation Flow Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('user can see complete conversation flow with messages in correct order', () => {
    const { lastFrame } = render(<App />);
    const output = lastFrame();

    // User should see conversation history
    expect(output).toContain('Hello');
    expect(output).toContain('Hi there! How can I help you?');
    
    // Messages should appear in chronological order
    const helloIndex = output.indexOf('Hello');
    const responseIndex = output.indexOf('Hi there! How can I help you?');
    expect(helloIndex).toBeLessThan(responseIndex);
  });

  test('user can distinguish between user and assistant messages', () => {
    const { lastFrame } = render(<App />);
    const output = lastFrame();

    // Should have visual distinction between message types
    // This could be through prefixes, colors, or formatting
    expect(output).toMatch(/(?:user|you|>).*Hello/i);
    expect(output).toMatch(/(?:assistant|ai|bot).*Hi there/i);
  });

  test('conversation displays with proper formatting and readability', () => {
    const { lastFrame } = render(<App />);
    const output = lastFrame();

    // Should have readable structure
    expect(output.length).toBeGreaterThan(0);
    
    // Should not have excessive whitespace or formatting issues
    expect(output).not.toMatch(/\n{5,}/); // No more than 4 consecutive newlines
    
    // Should have some structure (not just raw text)
    expect(output.split('\n').length).toBeGreaterThan(1);
  });

  test('user sees input area ready for new messages', () => {
    const { lastFrame } = render(<App />);
    const output = lastFrame();

    // Should show input prompt or cursor
    expect(output).toMatch(/[>›❯]|input|type|enter/i);
  });

  test('conversation handles empty history gracefully', () => {
    // Mock empty conversation
    mockConversationDB.getConversationHistory.mockResolvedValueOnce([]);
    
    const { lastFrame } = render(<App />);
    const output = lastFrame();

    // Should show interface even with no messages
    expect(output.length).toBeGreaterThan(0);
    
    // Should not crash or show errors
    expect(output).not.toMatch(/error|undefined|null/i);
  });

  test('conversation displays timestamps or relative time information', () => {
    const { lastFrame } = render(<App />);
    const output = lastFrame();

    // Should show some time-related information
    // Could be timestamps, relative time, or just ordering
    expect(output).toMatch(/\d{2}:\d{2}|ago|yesterday|today|\d{4}-\d{2}-\d{2}/);
  });

  test('user can see status information about the system', () => {
    const { lastFrame } = render(<App />);
    const output = lastFrame();

    // Should show some status (ready, thinking, processing, etc.)
    expect(output).toMatch(/ready|status|model|connected|online/i);
  });

  test('conversation handles long messages without breaking layout', () => {
    // Mock a very long message
    const longMessage = 'This is a very long message that should test how the UI handles text wrapping and display of lengthy content. '.repeat(10);
    
    mockConversationDB.getConversationHistory.mockResolvedValueOnce([
      { role: 'user', content: 'Short message', timestamp: '2023-01-01T00:00:00Z' },
      { role: 'assistant', content: longMessage, timestamp: '2023-01-01T00:01:00Z' }
    ]);
    
    const { lastFrame } = render(<App />);
    const output = lastFrame();

    // Should handle long content gracefully
    expect(output).toContain('Short message');
    expect(output).toContain('This is a very long message');
    
    // Should not have broken formatting
    expect(output.split('\n').every(line => line.length < 1000)).toBe(true);
  });

  test('conversation shows multiple message types correctly', () => {
    // Mock conversation with different content types
    mockConversationDB.getConversationHistory.mockResolvedValueOnce([
      { role: 'user', content: 'Hello', timestamp: '2023-01-01T00:00:00Z' },
      { role: 'assistant', content: 'Hi there!', timestamp: '2023-01-01T00:01:00Z' },
      { role: 'user', content: 'What is 2+2?', timestamp: '2023-01-01T00:02:00Z' },
      { role: 'assistant', content: '2+2 equals 4.', timestamp: '2023-01-01T00:03:00Z' }
    ]);
    
    const { lastFrame } = render(<App />);
    const output = lastFrame();

    // Should show all messages
    expect(output).toContain('Hello');
    expect(output).toContain('Hi there!');
    expect(output).toContain('What is 2+2?');
    expect(output).toContain('2+2 equals 4.');
  });

  test('user can see conversation loads without errors', () => {
    const { lastFrame } = render(<App />);
    const output = lastFrame();

    // Should not show error messages
    expect(output).not.toMatch(/error|failed|crash|exception/i);
    
    // Should show content
    expect(output.trim().length).toBeGreaterThan(10);
  });
});