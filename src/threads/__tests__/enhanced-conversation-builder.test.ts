// ABOUTME: Tests for enhanced conversation builder with tool call support
// ABOUTME: Tests the new ProviderMessage format that preserves tool call semantics

import { describe, it, expect } from 'vitest';
import { ThreadEvent } from '../types.js';
import { buildConversationFromEvents } from '../conversation-builder.js';

describe('Enhanced Conversation Builder (Option 2 Architecture)', () => {
  describe('Enhanced ProviderMessage format with tool calls', () => {
    it('should preserve tool calls in assistant messages instead of converting to text', () => {
      const events: ThreadEvent[] = [
        {
          id: 'evt1',
          threadId: 'thread1',
          type: 'USER_MESSAGE',
          timestamp: new Date(),
          data: 'Read a file',
        },
        {
          id: 'evt2',
          threadId: 'thread1',
          type: 'AGENT_MESSAGE',
          timestamp: new Date(),
          data: 'I will read the file for you.',
        },
        {
          id: 'evt3',
          threadId: 'thread1',
          type: 'TOOL_CALL',
          timestamp: new Date(),
          data: {
            toolName: 'file_read',
            input: { path: 'src/tools/types.ts' },
            callId: 'toolu_123',
          },
        },
        {
          id: 'evt4',
          threadId: 'thread1',
          type: 'TOOL_RESULT',
          timestamp: new Date(),
          data: {
            callId: 'toolu_123',
            output: 'export interface Tool { ... }',
            success: true,
          },
        },
      ];

      const messages = buildConversationFromEvents(events);

      expect(messages).toEqual([
        { 
          role: 'user', 
          content: 'Read a file' 
        },
        { 
          role: 'assistant', 
          content: 'I will read the file for you.',
          toolCalls: [{
            id: 'toolu_123',
            name: 'file_read',
            input: { path: 'src/tools/types.ts' }
          }]
        },
        { 
          role: 'user', 
          content: '',  // No text content for pure tool result
          toolResults: [{
            id: 'toolu_123',
            output: 'export interface Tool { ... }',
            success: true
          }]
        },
      ]);

      // Verify no fake text tool calls
      const hasToolCallText = messages.some(msg => 
        msg.content.includes('[Called tool:')
      );
      expect(hasToolCallText).toBe(false);
    });

    it('should handle assistant message with both text content AND tool calls', () => {
      const events: ThreadEvent[] = [
        {
          id: 'evt1',
          threadId: 'thread1',
          type: 'USER_MESSAGE',
          timestamp: new Date(),
          data: 'List files and read config',
        },
        {
          id: 'evt2',
          threadId: 'thread1',
          type: 'AGENT_MESSAGE',
          timestamp: new Date(),
          data: 'I will list the files first, then read the config.',
        },
        {
          id: 'evt3',
          threadId: 'thread1',
          type: 'TOOL_CALL',
          timestamp: new Date(),
          data: {
            toolName: 'file_list',
            input: { path: '.' },
            callId: 'toolu_list',
          },
        },
        {
          id: 'evt4',
          threadId: 'thread1',
          type: 'TOOL_RESULT',
          timestamp: new Date(),
          data: {
            callId: 'toolu_list',
            output: 'file1.txt\nfile2.txt',
            success: true,
          },
        },
        {
          id: 'evt5',
          threadId: 'thread1',
          type: 'AGENT_MESSAGE',
          timestamp: new Date(),
          data: 'Now I will read the config file.',
        },
        {
          id: 'evt6',
          threadId: 'thread1',
          type: 'TOOL_CALL',
          timestamp: new Date(),
          data: {
            toolName: 'file_read',
            input: { path: 'config.json' },
            callId: 'toolu_read',
          },
        },
      ];

      const messages = buildConversationFromEvents(events);

      expect(messages).toEqual([
        { 
          role: 'user', 
          content: 'List files and read config' 
        },
        { 
          role: 'assistant', 
          content: 'I will list the files first, then read the config.',
          toolCalls: [{
            id: 'toolu_list',
            name: 'file_list',
            input: { path: '.' }
          }]
        },
        { 
          role: 'user', 
          content: '',
          toolResults: [{
            id: 'toolu_list',
            output: 'file1.txt\nfile2.txt',
            success: true
          }]
        },
        { 
          role: 'assistant', 
          content: 'Now I will read the config file.',
          toolCalls: [{
            id: 'toolu_read',
            name: 'file_read',
            input: { path: 'config.json' }
          }]
        },
      ]);
    });

    it('should handle orphaned tool calls by preserving them without tool results', () => {
      const events: ThreadEvent[] = [
        {
          id: 'evt1',
          threadId: 'thread1',
          type: 'USER_MESSAGE',
          timestamp: new Date(),
          data: 'Read a file',
        },
        {
          id: 'evt2',
          threadId: 'thread1',
          type: 'AGENT_MESSAGE',
          timestamp: new Date(),
          data: 'I will read the file.',
        },
        {
          id: 'evt3',
          threadId: 'thread1',
          type: 'TOOL_CALL',
          timestamp: new Date(),
          data: {
            toolName: 'file_read',
            input: { path: 'src/tools/types.ts' },
            callId: 'toolu_orphaned',
          },
        },
        // NO TOOL_RESULT - orphaned tool call
      ];

      const messages = buildConversationFromEvents(events);

      expect(messages).toEqual([
        { 
          role: 'user', 
          content: 'Read a file' 
        },
        { 
          role: 'assistant', 
          content: 'I will read the file.',
          toolCalls: [{
            id: 'toolu_orphaned',
            name: 'file_read',
            input: { path: 'src/tools/types.ts' }
          }]
        },
        // No tool result message since the tool call was orphaned
      ]);

      // Should be exactly 2 messages
      expect(messages).toHaveLength(2);

      // Should not create fake text
      const hasToolCallText = messages.some(msg => 
        msg.content.includes('[Called tool:')
      );
      expect(hasToolCallText).toBe(false);
    });

    it('should handle orphaned tool results by preserving them', () => {
      const events: ThreadEvent[] = [
        {
          id: 'evt1',
          threadId: 'thread1',
          type: 'USER_MESSAGE',
          timestamp: new Date(),
          data: 'Check the result',
        },
        {
          id: 'evt2',
          threadId: 'thread1',
          type: 'TOOL_RESULT',
          timestamp: new Date(),
          data: {
            callId: 'toolu_orphaned_result',
            output: 'Some result data',
            success: true,
          },
        },
      ];

      const messages = buildConversationFromEvents(events);

      expect(messages).toEqual([
        { 
          role: 'user', 
          content: 'Check the result' 
        },
        { 
          role: 'user', 
          content: '',
          toolResults: [{
            id: 'toolu_orphaned_result',
            output: 'Some result data',
            success: true
          }]
        },
      ]);
    });

    it('should handle tool results with errors', () => {
      const events: ThreadEvent[] = [
        {
          id: 'evt1',
          threadId: 'thread1',
          type: 'TOOL_CALL',
          timestamp: new Date(),
          data: {
            toolName: 'bash',
            input: { command: 'invalid-command' },
            callId: 'toolu_error',
          },
        },
        {
          id: 'evt2',
          threadId: 'thread1',
          type: 'TOOL_RESULT',
          timestamp: new Date(),
          data: {
            callId: 'toolu_error',
            output: '',
            success: false,
            error: 'Command not found',
          },
        },
      ];

      const messages = buildConversationFromEvents(events);

      expect(messages).toEqual([
        { 
          role: 'assistant', 
          content: '',
          toolCalls: [{
            id: 'toolu_error',
            name: 'bash',
            input: { command: 'invalid-command' }
          }]
        },
        { 
          role: 'user', 
          content: '',
          toolResults: [{
            id: 'toolu_error',
            output: '',
            success: false,
            error: 'Command not found'
          }]
        },
      ]);
    });

    it('should group multiple tool calls in the same assistant message', () => {
      // Test scenario: Agent makes multiple tool calls in one response
      // This tests how we handle the grouping logic
      
      const events: ThreadEvent[] = [
        {
          id: 'evt1',
          threadId: 'thread1',
          type: 'USER_MESSAGE',
          timestamp: new Date(),
          data: 'Read two files',
        },
        {
          id: 'evt2',
          threadId: 'thread1',
          type: 'AGENT_MESSAGE',
          timestamp: new Date(),
          data: 'I will read both files for you.',
        },
        {
          id: 'evt3',
          threadId: 'thread1',
          type: 'TOOL_CALL',
          timestamp: new Date(),
          data: {
            toolName: 'file_read',
            input: { path: 'file1.txt' },
            callId: 'toolu_file1',
          },
        },
        {
          id: 'evt4',
          threadId: 'thread1',
          type: 'TOOL_CALL',
          timestamp: new Date(),
          data: {
            toolName: 'file_read',
            input: { path: 'file2.txt' },
            callId: 'toolu_file2',
          },
        },
        {
          id: 'evt5',
          threadId: 'thread1',
          type: 'TOOL_RESULT',
          timestamp: new Date(),
          data: {
            callId: 'toolu_file1',
            output: 'Content of file1',
            success: true,
          },
        },
        {
          id: 'evt6',
          threadId: 'thread1',
          type: 'TOOL_RESULT',
          timestamp: new Date(),
          data: {
            callId: 'toolu_file2',
            output: 'Content of file2',
            success: true,
          },
        },
      ];

      const messages = buildConversationFromEvents(events);

      expect(messages).toEqual([
        { 
          role: 'user', 
          content: 'Read two files' 
        },
        { 
          role: 'assistant', 
          content: 'I will read both files for you.',
          toolCalls: [
            {
              id: 'toolu_file1',
              name: 'file_read',
              input: { path: 'file1.txt' }
            },
            {
              id: 'toolu_file2',
              name: 'file_read',
              input: { path: 'file2.txt' }
            }
          ]
        },
        { 
          role: 'user', 
          content: '',
          toolResults: [
            {
              id: 'toolu_file1',
              output: 'Content of file1',
              success: true
            },
            {
              id: 'toolu_file2',
              output: 'Content of file2',
              success: true
            }
          ]
        },
      ]);
    });
  });
});