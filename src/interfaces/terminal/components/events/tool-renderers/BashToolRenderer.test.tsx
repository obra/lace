// ABOUTME: Test file for BashToolRenderer component
// ABOUTME: Verifies TimelineEntry rendering with bash command execution display

import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { BashToolRenderer } from '~/interfaces/terminal/components/events/tool-renderers/BashToolRenderer';
import { TimelineExpansionProvider } from '~/interfaces/terminal/components/events/hooks/useTimelineExpansionToggle';
import { TimelineItemProvider } from '~/interfaces/terminal/components/events/contexts/TimelineItemContext';

// No mocks needed - test real component behavior with proper providers

const mockBashCall = {
  id: 'call-123',
  name: 'bash',
  arguments: {
    command: 'ls -la',
    description: 'List files',
  },
};

const mockSuccessResult = {
  content: [
    {
      type: 'text' as const,
      text: JSON.stringify({
        stdout: 'file1.txt\nfile2.txt\n',
        stderr: '',
        exitCode: 0,
      }),
    },
  ],
  isError: false,
};

const mockErrorResult = {
  content: [
    {
      type: 'text' as const,
      text: JSON.stringify({
        stdout: '',
        stderr: 'bash: command not found',
        exitCode: 127,
      }),
    },
  ],
  isError: false,
};

function renderWithProviders(component: React.ReactElement, isSelected = false) {
  return render(
    <TimelineExpansionProvider>
      <TimelineItemProvider
        isSelected={isSelected}
        onToggle={() => {
          // onToggle callback for tests - no action needed
        }}
      >
        {component}
      </TimelineItemProvider>
    </TimelineExpansionProvider>
  );
}

describe('BashToolRenderer', () => {
  it('should show success status for successful commands', () => {
    const item = {
      type: 'tool_execution' as const,
      call: mockBashCall,
      result: mockSuccessResult,
      timestamp: new Date(),
      callId: 'call-123',
    };

    const { lastFrame } = renderWithProviders(<BashToolRenderer item={item} />);

    const frame = lastFrame();
    expect(frame).toContain('✔'); // Success symbol
    expect(frame).toContain('bash: ls -la');
    expect(frame).toContain('List files');
    expect(frame).toContain('3 lines'); // includes empty line
  });

  it('should show error status for failed commands', () => {
    const item = {
      type: 'tool_execution' as const,
      call: mockBashCall,
      result: mockErrorResult,
      timestamp: new Date(),
      callId: 'call-123',
    };

    const { lastFrame } = renderWithProviders(<BashToolRenderer item={item} />);

    const frame = lastFrame();
    expect(frame).toContain('✘'); // Error symbol
    expect(frame).toContain('bash: ls -la');
    expect(frame).toContain('exit 127');
  });

  it('should show pending status for running commands', () => {
    const item = {
      type: 'tool_execution' as const,
      call: mockBashCall,
      result: undefined, // Still running
      timestamp: new Date(),
      callId: 'call-123',
    };

    const { lastFrame } = renderWithProviders(<BashToolRenderer item={item} />);

    const frame = lastFrame();
    expect(frame).toContain('⧖'); // Pending symbol
    expect(frame).toContain('bash: ls -la');
    expect(frame).toContain('List files');
  });

  it('should handle commands without description', () => {
    const call = {
      id: 'call-123',
      name: 'bash',
      arguments: {
        command: 'pwd',
      },
    };

    const item = {
      type: 'tool_execution' as const,
      call,
      result: mockSuccessResult,
      timestamp: new Date(),
      callId: 'call-123',
    };

    const { lastFrame } = renderWithProviders(<BashToolRenderer item={item} />);

    const frame = lastFrame();
    expect(frame).toContain('✔'); // Success symbol
    expect(frame).toContain('bash: pwd');
    // Still has " - " for line count, just not for description
  });

  it('should start collapsed and show expansion indicator when expandable', () => {
    const item = {
      type: 'tool_execution' as const,
      call: mockBashCall,
      result: mockSuccessResult,
      timestamp: new Date(),
      callId: 'call-123',
    };

    // Test with selected=true so expansion indicators are visible
    const { lastFrame } = renderWithProviders(<BashToolRenderer item={item} />, true);

    const frame = lastFrame();
    // Should start collapsed and show collapsed indicator
    expect(frame).toContain('▶'); // Collapsed indicator
    expect(frame).toContain('to open'); // Expansion hint
    // Should not show expanded content initially (command line with $)
    expect(frame).not.toContain('$'); // Command prompt not visible when collapsed
  });

  it('should show compact preview when collapsed', () => {
    const item = {
      type: 'tool_execution' as const,
      call: mockBashCall,
      result: mockSuccessResult,
      timestamp: new Date(),
      callId: 'call-123',
    };

    const { lastFrame } = renderWithProviders(<BashToolRenderer item={item} />);

    const frame = lastFrame();
    // Should show preview content (limited lines from output)
    expect(frame).toContain('file1.txt'); // Preview from stdout
    expect(frame).toContain('3 lines'); // Line count
  });
});
