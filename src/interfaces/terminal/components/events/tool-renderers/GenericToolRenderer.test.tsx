// ABOUTME: Test file for GenericToolRenderer component
// ABOUTME: Verifies TimelineEntry rendering with generic tool fallback display

import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { GenericToolRenderer } from '~/interfaces/terminal/components/events/tool-renderers/GenericToolRenderer.js';
import { TimelineExpansionProvider } from '~/interfaces/terminal/components/events/hooks/useTimelineExpansionToggle.js';
import { TimelineItemProvider } from '~/interfaces/terminal/components/events/contexts/TimelineItemContext.js';

const mockUnknownToolCall = {
  id: 'call-123',
  name: 'unknown-tool',
  arguments: {
    parameter: 'test-value',
    config: { setting: true },
  },
};

const mockSuccessResult = {
  content: [
    {
      type: 'text' as const,
      text: 'Tool executed successfully\nOutput data\nMore results',
    },
  ],
  isError: false,
};

const mockErrorResult = {
  content: [
    {
      type: 'text' as const,
      text: 'Tool execution failed',
    },
  ],
  isError: true,
};

function renderWithProviders(component: React.ReactElement) {
  return render(
    <TimelineExpansionProvider>
      <TimelineItemProvider isSelected={false} onToggle={() => {}}>
        {component}
      </TimelineItemProvider>
    </TimelineExpansionProvider>
  );
}

describe('GenericToolRenderer', () => {
  it('should return TimelineEntry with generic tool format in header', () => {
    const item = {
      type: 'tool_execution' as const,
      call: mockUnknownToolCall,
      result: mockSuccessResult,
      timestamp: new Date(),
      callId: 'call-123',
    };

    const { lastFrame } = renderWithProviders(<GenericToolRenderer item={item} />);

    // Should show tool name in new TimelineEntry format
    expect(lastFrame()).toContain('unknown-tool: test-value [GENERIC]');
  });

  it('should handle error results', () => {
    const item = {
      type: 'tool_execution' as const,
      call: mockUnknownToolCall,
      result: mockErrorResult,
      timestamp: new Date(),
      callId: 'call-123',
    };

    const { lastFrame } = renderWithProviders(<GenericToolRenderer item={item} />);

    expect(lastFrame()).toContain('unknown-tool: test-value');
    expect(lastFrame()).toContain('[GENERIC]');
  });

  it('should show pending status for running tools', () => {
    const item = {
      type: 'tool_execution' as const,
      call: mockUnknownToolCall,
      result: undefined,
      timestamp: new Date(),
      callId: 'call-123',
    };

    const { lastFrame } = renderWithProviders(<GenericToolRenderer item={item} />);

    expect(lastFrame()).toContain('unknown-tool: test-value');
    expect(lastFrame()).toContain('[GENERIC]');
  });

  it('should handle known tool patterns for bash', () => {
    const bashCall = {
      id: 'call-123',
      name: 'bash',
      arguments: {
        command: 'ls -la',
        description: 'List files',
      },
    };

    const item = {
      type: 'tool_execution' as const,
      call: bashCall,
      result: mockSuccessResult,
      timestamp: new Date(),
      callId: 'call-123',
    };

    const { lastFrame } = renderWithProviders(<GenericToolRenderer item={item} />);

    expect(lastFrame()).toContain('bash: $ ls -la');
    expect(lastFrame()).toContain('[GENERIC]');
  });

  it('should handle known tool patterns for file operations', () => {
    const fileCall = {
      id: 'call-123',
      name: 'file-write',
      arguments: {
        file_path: '/home/user/test.txt',
        content: 'Hello world',
      },
    };

    const item = {
      type: 'tool_execution' as const,
      call: fileCall,
      result: mockSuccessResult,
      timestamp: new Date(),
      callId: 'call-123',
    };

    const { lastFrame } = renderWithProviders(<GenericToolRenderer item={item} />);

    expect(lastFrame()).toContain('file-write: /home/user/test.txt');
    expect(lastFrame()).toContain('[GENERIC]');
  });
});
