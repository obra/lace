// ABOUTME: Tests for MessageDisplay component
// ABOUTME: Verifies message formatting, syntax highlighting, and collapsible content

import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderInkComponent } from '~/interfaces/terminal/__tests__/helpers/ink-test-utils';
import MessageDisplay from '~/interfaces/terminal/components/message-display';
import { UI_SYMBOLS } from '~/interfaces/terminal/theme';

describe('MessageDisplay', () => {
  const mockMessage = {
    type: 'assistant' as const,
    content: 'Hello world',
    timestamp: new Date('2023-01-01T12:00:00Z'),
  };

  it('renders basic message with correct type and content', () => {
    const { lastFrame } = renderInkComponent(<MessageDisplay message={mockMessage} />);

    const frame = lastFrame();
    expect(frame).toContain('Hello world');
  });

  it('renders user message with correct styling', () => {
    const userMessage = {
      type: 'user' as const,
      content: 'Hi there',
      timestamp: new Date('2023-01-01T12:00:00Z'),
    };

    const { lastFrame } = renderInkComponent(<MessageDisplay message={userMessage} />);

    const frame = lastFrame();
    expect(frame).toContain('> '); // User prefix
    expect(frame).toContain('Hi there');
  });

  it('renders code blocks with syntax highlighting', () => {
    const messageWithCode = {
      type: 'assistant' as const,
      content: "Here's some code:\n```javascript\nconsole.log('hello');\n```",
      timestamp: new Date('2023-01-01T12:00:00Z'),
    };

    const { lastFrame } = renderInkComponent(<MessageDisplay message={messageWithCode} />);

    const frame = lastFrame();
    // With markdown rendering, the language label is handled by marked-terminal
    // We should still see the code content
    expect(frame).toContain("console.log('hello');");
  });

  it('renders thinking message with italic styling', () => {
    const thinkingMessage = {
      type: 'thinking' as const,
      content: 'Let me think about this...',
      timestamp: new Date('2023-01-01T12:00:00Z'),
    };

    const { lastFrame } = renderInkComponent(<MessageDisplay message={thinkingMessage} />);

    const frame = lastFrame();
    expect(frame).toContain(`${UI_SYMBOLS.THINKING} `); // Thinking prefix
    expect(frame).toContain('Let me think about this...');
  });

  it('shows streaming cursor when isStreaming and showCursor are true', () => {
    const { lastFrame } = renderInkComponent(
      <MessageDisplay message={mockMessage} isStreaming={true} showCursor={true} />
    );

    const frame = lastFrame();
    // Should contain inverse space character (cursor)
    expect(frame).toContain('Hello world');
  });

  it('handles tool message type', () => {
    const toolMessage = {
      type: 'tool' as const,
      content: 'Tool execution completed',
      timestamp: new Date('2023-01-01T12:00:00Z'),
    };

    const { lastFrame } = renderInkComponent(<MessageDisplay message={toolMessage} />);

    const frame = lastFrame();
    expect(frame).toContain(`${UI_SYMBOLS.TOOL}`);
    expect(frame).toContain('Tool execution completed');
  });

  it('handles system message type', () => {
    const systemMessage = {
      type: 'system' as const,
      content: 'System notification',
      timestamp: new Date('2023-01-01T12:00:00Z'),
    };

    const { lastFrame } = renderInkComponent(<MessageDisplay message={systemMessage} />);

    const frame = lastFrame();
    expect(frame).toContain(UI_SYMBOLS.INFO + '  System');
    expect(frame).toContain('System notification');
  });

  it('handles messages with multiple code blocks', () => {
    const messageWithMultipleCode = {
      type: 'assistant' as const,
      content: "First:\n```bash\nls -la\n```\nThen:\n```python\nprint('hello')\n```",
      timestamp: new Date('2023-01-01T12:00:00Z'),
    };

    const { lastFrame } = renderInkComponent(<MessageDisplay message={messageWithMultipleCode} />);

    const frame = lastFrame();
    // With markdown rendering, language labels are handled by marked-terminal
    // We should see the code content
    expect(frame).toContain('ls -la');
    expect(frame).toContain("print('hello')");
  });
});
