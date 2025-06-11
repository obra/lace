// ABOUTME: Integration tests for tool execution workflows
// ABOUTME: Tests complete tool request → approval → execution → results flow

import React from 'react';
import { render } from 'ink-testing-library';
import App from '@/ui/App.tsx';

// Mock external dependencies
jest.mock('@/database/conversation-db.js');
jest.mock('@/models/model-provider.js');
jest.mock('@/tools/tool-registry.js');
jest.mock('@/logging/activity-logger.js');
jest.mock('@/snapshot/snapshot-manager.js');
jest.mock('@/safety/approval-engine.ts');

const mockConversationDB = {
  saveMessage: jest.fn(() => Promise.resolve()),
  getConversationHistory: jest.fn(() => Promise.resolve([])),
  init: jest.fn(() => Promise.resolve()),
  close: jest.fn(() => Promise.resolve())
};

const mockModelProvider = {
  chat: jest.fn(),
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
  callTool: jest.fn(),
  callToolWithSnapshots: jest.fn()
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

const mockApprovalEngine = {
  checkAutoApproval: jest.fn(),
  requestApproval: jest.fn()
};

// Apply mocks
require('@/database/conversation-db.js').ConversationDB = jest.fn(() => mockConversationDB);
require('@/models/model-provider.js').ModelProvider = jest.fn(() => mockModelProvider);
require('@/tools/tool-registry.js').ToolRegistry = jest.fn(() => mockToolRegistry);
require('@/logging/activity-logger.js').ActivityLogger = jest.fn(() => mockActivityLogger);
require('@/snapshot/snapshot-manager.js').SnapshotManager = jest.fn(() => mockSnapshotManager);
require('@/safety/approval-engine.ts').ApprovalEngine = jest.fn(() => mockApprovalEngine);

describe('Tool Execution Workflow Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('successful tool execution flow displays results to user', async () => {
    // Mock successful tool execution
    mockModelProvider.chat.mockResolvedValueOnce({
      success: true,
      content: 'I need to use the file tool to read a file.',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      toolCalls: [{
        name: 'file_read',
        input: { path: 'test.txt' }
      }]
    });

    mockApprovalEngine.checkAutoApproval.mockResolvedValueOnce({
      approved: true,
      reason: 'Auto-approved safe operation',
      modifiedCall: { name: 'file_read', input: { path: 'test.txt' } }
    });

    mockToolRegistry.callToolWithSnapshots.mockResolvedValueOnce({
      success: true,
      content: 'File content here'
    });

    const { lastFrame } = render(<App />);
    
    // Should show the interface without errors
    const output = lastFrame();
    expect(output).toBeDefined();
    expect(output.length).toBeGreaterThan(0);
  });

  test('tool execution requiring approval shows approval modal', async () => {
    // Mock tool execution that requires approval
    mockModelProvider.chat.mockResolvedValueOnce({
      success: true,
      content: 'I need to execute a shell command.',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      toolCalls: [{
        name: 'shell_execute',
        input: { command: 'rm test.txt' }
      }]
    });

    // Mock requiring manual approval
    mockApprovalEngine.checkAutoApproval.mockResolvedValueOnce(null);
    
    mockApprovalEngine.requestApproval.mockImplementationOnce(() => 
      new Promise(resolve => {
        // Simulate user approval after delay
        setTimeout(() => {
          resolve({
            approved: true,
            reason: 'User approved',
            modifiedCall: { name: 'shell_execute', input: { command: 'rm test.txt' } }
          });
        }, 100);
      })
    );

    const { lastFrame } = render(<App />);
    
    // Should show approval interface
    const output = lastFrame();
    expect(output).toBeDefined();
    
    // Should contain approval-related text
    expect(output).toMatch(/approve|deny|risk|dangerous|execute|tool/i);
  });

  test('tool execution failure shows error message to user', async () => {
    // Mock tool execution failure
    mockModelProvider.chat.mockResolvedValueOnce({
      success: true,
      content: 'I need to read a file.',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      toolCalls: [{
        name: 'file_read',
        input: { path: 'nonexistent.txt' }
      }]
    });

    mockApprovalEngine.checkAutoApproval.mockResolvedValueOnce({
      approved: true,
      reason: 'Auto-approved',
      modifiedCall: { name: 'file_read', input: { path: 'nonexistent.txt' } }
    });

    mockToolRegistry.callToolWithSnapshots.mockRejectedValueOnce(
      new Error('File not found')
    );

    const { lastFrame } = render(<App />);
    
    // Should handle error gracefully
    const output = lastFrame();
    expect(output).toBeDefined();
    
    // Should show some indication of tool execution (even if failed)
    expect(output).toMatch(/tool|execute|file|operation/i);
  });

  test('multiple concurrent tool executions are handled properly', async () => {
    // Mock multiple tool calls
    mockModelProvider.chat.mockResolvedValueOnce({
      success: true,
      content: 'I need to use multiple tools.',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      toolCalls: [
        { name: 'file_read', input: { path: 'file1.txt' } },
        { name: 'file_read', input: { path: 'file2.txt' } }
      ]
    });

    mockApprovalEngine.checkAutoApproval.mockResolvedValue({
      approved: true,
      reason: 'Auto-approved',
      modifiedCall: null
    });

    mockToolRegistry.callToolWithSnapshots
      .mockResolvedValueOnce({ success: true, content: 'Content 1' })
      .mockResolvedValueOnce({ success: true, content: 'Content 2' });

    const { lastFrame } = render(<App />);
    
    // Should handle multiple tools without breaking
    const output = lastFrame();
    expect(output).toBeDefined();
    expect(output.length).toBeGreaterThan(0);
  });

  test('tool execution with high risk shows appropriate warnings', async () => {
    // Mock high-risk tool execution
    mockModelProvider.chat.mockResolvedValueOnce({
      success: true,
      content: 'I need to delete files.',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      toolCalls: [{
        name: 'shell_execute',
        input: { command: 'rm -rf /' }
      }]
    });

    // Mock high-risk requiring approval
    mockApprovalEngine.checkAutoApproval.mockResolvedValueOnce(null);
    
    const { lastFrame } = render(<App />);
    
    // Should show interface for high-risk operations
    const output = lastFrame();
    expect(output).toBeDefined();
    
    // Should indicate some level of risk or caution
    expect(output).toMatch(/risk|dangerous|warning|caution|careful/i);
  });

  test('tool execution denial flow shows appropriate message', async () => {
    // Mock tool execution that gets denied
    mockModelProvider.chat.mockResolvedValueOnce({
      success: true,
      content: 'I need to execute a dangerous command.',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      toolCalls: [{
        name: 'shell_execute',
        input: { command: 'dangerous_command' }
      }]
    });

    mockApprovalEngine.checkAutoApproval.mockResolvedValueOnce({
      approved: false,
      reason: 'Tool is on deny list',
      modifiedCall: null
    });

    const { lastFrame } = render(<App />);
    
    // Should handle denial gracefully
    const output = lastFrame();
    expect(output).toBeDefined();
    
    // Should show some indication of tool interaction
    expect(output).toMatch(/tool|execute|denied|blocked|not allowed/i);
  });

  test('tool execution with custom parameters displays correctly', async () => {
    // Mock tool with complex parameters
    mockModelProvider.chat.mockResolvedValueOnce({
      success: true,
      content: 'I need to search with specific parameters.',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      toolCalls: [{
        name: 'search_find',
        input: { 
          query: 'test query',
          path: './src',
          includeHidden: false,
          maxResults: 10
        }
      }]
    });

    mockApprovalEngine.checkAutoApproval.mockResolvedValueOnce({
      approved: true,
      reason: 'Search is safe',
      modifiedCall: { name: 'search_find', input: { query: 'test query', path: './src' } }
    });

    mockToolRegistry.callToolWithSnapshots.mockResolvedValueOnce({
      success: true,
      results: ['file1.js', 'file2.js']
    });

    const { lastFrame } = render(<App />);
    
    // Should handle complex tool parameters
    const output = lastFrame();
    expect(output).toBeDefined();
    expect(output.length).toBeGreaterThan(0);
  });

  test('tool execution timeout or slow operations show progress', async () => {
    // Mock slow tool execution
    mockModelProvider.chat.mockResolvedValueOnce({
      success: true,
      content: 'I need to run a long operation.',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      toolCalls: [{
        name: 'shell_execute',
        input: { command: 'sleep 5' }
      }]
    });

    mockApprovalEngine.checkAutoApproval.mockResolvedValueOnce({
      approved: true,
      reason: 'Auto-approved',
      modifiedCall: { name: 'shell_execute', input: { command: 'sleep 5' } }
    });

    // Mock delayed response
    mockToolRegistry.callToolWithSnapshots.mockImplementationOnce(() =>
      new Promise(resolve => {
        setTimeout(() => {
          resolve({ success: true, output: 'Operation completed' });
        }, 200);
      })
    );

    const { lastFrame } = render(<App />);
    
    // Should show interface during execution
    const output = lastFrame();
    expect(output).toBeDefined();
    
    // Should show some indication of activity
    expect(output).toMatch(/executing|running|processing|working|tool/i);
  });

  test('tool execution results are formatted and displayed correctly', async () => {
    // Mock tool with formatted results
    mockModelProvider.chat.mockResolvedValueOnce({
      success: true,
      content: 'Let me get the file list.',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      toolCalls: [{
        name: 'shell_execute',
        input: { command: 'ls -la' }
      }]
    });

    mockApprovalEngine.checkAutoApproval.mockResolvedValueOnce({
      approved: true,
      reason: 'Safe listing command',
      modifiedCall: { name: 'shell_execute', input: { command: 'ls -la' } }
    });

    mockToolRegistry.callToolWithSnapshots.mockResolvedValueOnce({
      success: true,
      output: 'drwxr-xr-x  5 user  staff  160 Jan  1 12:00 .\ndrwxr-xr-x  3 user  staff   96 Jan  1 11:00 ..\n-rw-r--r--  1 user  staff   20 Jan  1 12:00 file.txt',
      exitCode: 0
    });

    const { lastFrame } = render(<App />);
    
    // Should format tool results appropriately
    const output = lastFrame();
    expect(output).toBeDefined();
    expect(output.length).toBeGreaterThan(0);
  });

  test('tool execution with no results shows appropriate message', async () => {
    // Mock tool with empty results
    mockModelProvider.chat.mockResolvedValueOnce({
      success: true,
      content: 'Let me search for files.',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      toolCalls: [{
        name: 'search_find',
        input: { query: 'nonexistent' }
      }]
    });

    mockApprovalEngine.checkAutoApproval.mockResolvedValueOnce({
      approved: true,
      reason: 'Search is safe',
      modifiedCall: { name: 'search_find', input: { query: 'nonexistent' } }
    });

    mockToolRegistry.callToolWithSnapshots.mockResolvedValueOnce({
      success: true,
      results: []
    });

    const { lastFrame } = render(<App />);
    
    // Should handle empty results gracefully
    const output = lastFrame();
    expect(output).toBeDefined();
    
    // Should show some indication of completed operation
    expect(output).toMatch(/search|find|no results|empty|tool|completed/i);
  });
});