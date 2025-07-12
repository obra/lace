// ABOUTME: Test file for FileSearchToolRenderer component
// ABOUTME: Verifies TimelineEntry rendering with proper headers and match counts

import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { FileSearchToolRenderer } from '~/interfaces/terminal/components/events/tool-renderers/FileSearchToolRenderer';
import { TimelineExpansionProvider } from '~/interfaces/terminal/components/events/hooks/useTimelineExpansionToggle';
import { TimelineItemProvider } from '~/interfaces/terminal/components/events/contexts/TimelineItemContext';

const mockToolCall = {
  id: 'call-123',
  name: 'ripgrep-search',
  arguments: {
    pattern: 'function',
    path: '/home/user/project',
  },
};

const mockSuccessResult = {
  content: [
    {
      type: 'text' as const,
      text: `Found 3 matches in 2 files:
src/utils.ts:
10:  function helper() {
15:  function another() {

src/main.ts:
5:   function main() {`,
    },
  ],
  isError: false,
};

const mockEmptyResult = {
  content: [
    {
      type: 'text' as const,
      text: 'No matches found',
    },
  ],
  isError: false,
};

function renderWithProviders(component: React.ReactElement) {
  return render(
    <TimelineExpansionProvider>
      <TimelineItemProvider
        isSelected={false}
        onToggle={() => {
          // Mock onToggle for test - no action needed
        }}
      >
        {component}
      </TimelineItemProvider>
    </TimelineExpansionProvider>
  );
}

describe('FileSearchToolRenderer', () => {
  it('should return TimelineEntry with search pattern and match counts in header', () => {
    const item = {
      type: 'tool_execution' as const,
      call: mockToolCall,
      result: mockSuccessResult,
      timestamp: new Date(),
      callId: 'call-123',
    };

    const { lastFrame } = renderWithProviders(<FileSearchToolRenderer item={item} />);

    // Should show tool name, pattern, path, and match count in header
    expect(lastFrame()).toContain('ripgrep-search: "function"');
    expect(lastFrame()).toContain('in /home/user/project');
    expect(lastFrame()).toContain('3 matches in 2 files');
  });

  it('should handle empty results', () => {
    const item = {
      type: 'tool_execution' as const,
      call: mockToolCall,
      result: mockEmptyResult,
      timestamp: new Date(),
      callId: 'call-123',
    };

    const { lastFrame } = renderWithProviders(<FileSearchToolRenderer item={item} />);

    expect(lastFrame()).toContain('ripgrep-search: "function"');
    expect(lastFrame()).toContain('No matches found');
  });

  it('should show pending status for running tools', () => {
    const item = {
      type: 'tool_execution' as const,
      call: mockToolCall,
      result: undefined,
      timestamp: new Date(),
      callId: 'call-123',
    };

    const { lastFrame } = renderWithProviders(<FileSearchToolRenderer item={item} />);

    expect(lastFrame()).toContain('ripgrep-search: "function"');
    // Should not show match counts when still running
    expect(lastFrame()).not.toContain('matches');
  });

  it('should handle different search patterns', () => {
    const call = {
      id: 'call-123',
      name: 'ripgrep-search',
      arguments: {
        pattern: 'class\\s+\\w+',
        path: '/home/user',
      },
    };

    const result = {
      content: [
        {
          type: 'text' as const,
          text: `Found 1 match in 1 file:
src/app.ts:
5:  class MyApp {`,
        },
      ],
      isError: false,
    };

    const item = {
      type: 'tool_execution' as const,
      call,
      result,
      timestamp: new Date(),
      callId: 'call-123',
    };

    const { lastFrame } = renderWithProviders(<FileSearchToolRenderer item={item} />);

    expect(lastFrame()).toContain('ripgrep-search: "class\\s+\\w+"');
    expect(lastFrame()).toContain('1 match in 1 file');
  });
});
