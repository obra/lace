// ABOUTME: Test file for FileListToolRenderer component
// ABOUTME: Verifies TimelineEntry rendering with proper headers and file/directory counts

import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { FileListToolRenderer } from './FileListToolRenderer.js';
import { TimelineExpansionProvider } from '../hooks/useTimelineExpansionToggle.js';
import { TimelineItemProvider } from '../contexts/TimelineItemContext.js';

const mockToolCall = {
  id: 'call-123',
  name: 'file-list',
  arguments: {
    path: '/home/user',
    recursive: true
  }
};

const mockSuccessResult = {
  content: [{
    type: 'text' as const,
    text: `Documents/
report.pdf (2048 bytes)
notes.txt (512 bytes)
Projects/
  my-app/
    src/
    package.json (1024 bytes)
    README.md (768 bytes)`
  }],
  isError: false
};

const mockEmptyResult = {
  content: [{
    type: 'text' as const,
    text: 'No files found'
  }],
  isError: false
};

function renderWithProviders(component: React.ReactElement) {
  return render(
    <TimelineExpansionProvider>
      <TimelineItemProvider
        isSelected={false}
        isExpanded={false}
        onExpand={() => {}}
        onCollapse={() => {}}
      >
        {component}
      </TimelineItemProvider>
    </TimelineExpansionProvider>
  );
}

describe('FileListToolRenderer', () => {
  it('should return TimelineEntry with file/directory counts in header', () => {
    const item = {
      type: 'tool_execution' as const,
      call: mockToolCall,
      result: mockSuccessResult,
      timestamp: new Date(),
      callId: 'call-123'
    };

    const { lastFrame } = renderWithProviders(
      <FileListToolRenderer item={item} />
    );

    // Should show tool name, path, and counts in header
    expect(lastFrame()).toContain('file-list: /home/user');
    expect(lastFrame()).toContain('4 files, 4 dirs');
    expect(lastFrame()).toContain('(recursive)');
  });

  it('should handle empty results', () => {
    const item = {
      type: 'tool_execution' as const,
      call: mockToolCall,
      result: mockEmptyResult,
      timestamp: new Date(),
      callId: 'call-123'
    };

    const { lastFrame } = renderWithProviders(
      <FileListToolRenderer item={item} />
    );

    expect(lastFrame()).toContain('file-list: /home/user');
    expect(lastFrame()).toContain('No files found');
  });

  it('should show pending status for running tools', () => {
    const item = {
      type: 'tool_execution' as const,
      call: mockToolCall,
      result: undefined,
      timestamp: new Date(),
      callId: 'call-123'
    };

    const { lastFrame } = renderWithProviders(
      <FileListToolRenderer item={item} />
    );

    expect(lastFrame()).toContain('file-list: /home/user');
    // Should not show counts when still running
    expect(lastFrame()).not.toContain('files');
  });

  it('should handle non-recursive listing', () => {
    const call = {
      id: 'call-123',
      name: 'file-list',
      arguments: {
        path: '/home/user'
      }
    };

    const item = {
      type: 'tool_execution' as const,
      call,
      result: mockSuccessResult,
      timestamp: new Date(),
      callId: 'call-123'
    };

    const { lastFrame } = renderWithProviders(
      <FileListToolRenderer item={item} />
    );

    expect(lastFrame()).toContain('file-list: /home/user');
    expect(lastFrame()).not.toContain('(recursive)');
  });
});