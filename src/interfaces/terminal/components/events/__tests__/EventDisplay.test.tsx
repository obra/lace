// ABOUTME: Tests for EventDisplay component to ensure proper rendering of different event types
// ABOUTME: Validates that each event type maps to correct display component

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { EventDisplay } from '../EventDisplay.js';
import { ThreadEvent, ToolCallData, ToolResultData } from '../../../../../threads/types.js';

describe('EventDisplay', () => {
  it('should render USER_MESSAGE events', () => {
    const event: ThreadEvent = {
      id: 'evt-1',
      threadId: 'thread-1',
      type: 'USER_MESSAGE',
      timestamp: new Date(),
      data: 'Hello, world!'
    };

    const { lastFrame } = render(<EventDisplay event={event} />);
    expect(lastFrame()).toContain('> ');
    expect(lastFrame()).toContain('Hello, world!');
  });

  it('should render AGENT_MESSAGE events', () => {
    const event: ThreadEvent = {
      id: 'evt-2',
      threadId: 'thread-1',
      type: 'AGENT_MESSAGE',
      timestamp: new Date(),
      data: 'Hello there!'
    };

    const { lastFrame } = render(<EventDisplay event={event} />);
    expect(lastFrame()).toContain('❦ ');
    expect(lastFrame()).toContain('Hello there!');
  });

  it('should render TOOL_CALL events', () => {
    const toolCallData: ToolCallData = {
      toolName: 'bash',
      input: { command: 'ls -la' },
      callId: 'call-123'
    };

    const event: ThreadEvent = {
      id: 'evt-3',
      threadId: 'thread-1',
      type: 'TOOL_CALL',
      timestamp: new Date(),
      data: toolCallData
    };

    const { lastFrame } = render(<EventDisplay event={event} />);
    expect(lastFrame()).toContain('🔧');
    expect(lastFrame()).toContain('bash');
    expect(lastFrame()).toContain('#ll-123'); // Last 6 chars of call-123
  });

  it('should render TOOL_RESULT events', () => {
    const toolResultData: ToolResultData = {
      callId: 'call-123',
      output: 'File listing complete',
      success: true
    };

    const event: ThreadEvent = {
      id: 'evt-4',
      threadId: 'thread-1',
      type: 'TOOL_RESULT',
      timestamp: new Date(),
      data: toolResultData
    };

    const { lastFrame } = render(<EventDisplay event={event} />);
    expect(lastFrame()).toContain('✅ Tool Result');
    expect(lastFrame()).toContain('File listing complete');
  });

  it('should render LOCAL_SYSTEM_MESSAGE events', () => {
    const event: ThreadEvent = {
      id: 'evt-5',
      threadId: 'thread-1',
      type: 'LOCAL_SYSTEM_MESSAGE',
      timestamp: new Date(),
      data: 'System notification'
    };

    const { lastFrame } = render(<EventDisplay event={event} />);
    expect(lastFrame()).toContain('ℹ️  System');
    expect(lastFrame()).toContain('System notification');
  });

  it('should handle streaming events', () => {
    const event: ThreadEvent = {
      id: 'evt-6',
      threadId: 'thread-1',
      type: 'AGENT_MESSAGE',
      timestamp: new Date(),
      data: 'Streaming response...'
    };

    const { lastFrame } = render(<EventDisplay event={event} isStreaming={true} />);
    expect(lastFrame()).toContain('thinking...');
  });

  it('should render SYSTEM_PROMPT events', () => {
    const event: ThreadEvent = {
      id: 'evt-7',
      threadId: 'thread-1',
      type: 'SYSTEM_PROMPT',
      timestamp: new Date(),
      data: 'You are a helpful AI assistant.'
    };

    const { lastFrame } = render(<EventDisplay event={event} />);
    expect(lastFrame()).toContain('🔧 System Prompt');
    expect(lastFrame()).toContain('(press Enter to toggle)');
  });

  it('should render USER_SYSTEM_PROMPT events', () => {
    const event: ThreadEvent = {
      id: 'evt-8',
      threadId: 'thread-1',
      type: 'USER_SYSTEM_PROMPT',
      timestamp: new Date(),
      data: 'Always be concise and helpful.'
    };

    const { lastFrame } = render(<EventDisplay event={event} />);
    expect(lastFrame()).toContain('📋 User Instructions');
    expect(lastFrame()).toContain('(press Enter to toggle)');
  });
});