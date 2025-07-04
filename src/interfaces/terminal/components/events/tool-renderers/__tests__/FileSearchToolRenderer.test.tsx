// ABOUTME: Tests for FileSearchToolRenderer component with direct composition pattern
// ABOUTME: Verifies search results display, match counts, and empty results handling

import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { FileSearchToolRenderer } from '../FileSearchToolRenderer.js';
import type { ToolRendererProps } from '../components/shared.js';
import { TimelineExpansionProvider } from '../../hooks/useTimelineExpansionToggle.js';

describe('FileSearchToolRenderer', () => {
  const createMockItem = (overrides?: Partial<ToolRendererProps['item']>): ToolRendererProps['item'] => ({
    type: 'tool_execution',
    call: {
      id: 'call-123',
      name: 'ripgrep-search',
      arguments: {
        pattern: 'TODO',
        path: '/path/to/search',
      },
    },
    result: undefined,
    timestamp: new Date(),
    callId: 'test-call-id',
    ...overrides,
  });

  // Helper to render with required providers
  const renderWithProviders = (component: React.ReactElement) => {
    return render(
      <TimelineExpansionProvider>
        {component}
      </TimelineExpansionProvider>
    );
  };

  it('should show search pattern and path in header', () => {
    const item = createMockItem();
    const { lastFrame } = renderWithProviders(<FileSearchToolRenderer item={item} />);
    
    expect(lastFrame()).toContain('ripgrep-search');
    expect(lastFrame()).toContain('TODO');
    expect(lastFrame()).toContain('/path/to/search');
  });

  it('should show pending status when running', () => {
    const item = createMockItem({ result: undefined });
    const { lastFrame } = renderWithProviders(<FileSearchToolRenderer item={item} />);
    
    expect(lastFrame()).toContain('⏳');
  });

  it('should show match count in header when results found', () => {
    const searchOutput = `Found 3 matches in 2 files:

src/file1.js
  10: // TODO: implement this feature
  25: // TODO: add error handling

src/file2.js
  5: # TODO: write documentation`;
    
    const item = createMockItem({
      result: {
        content: [{
          type: 'text',
          text: searchOutput,
        }],
        isError: false,
      },
    });
    
    const { lastFrame } = renderWithProviders(<FileSearchToolRenderer item={item} />);
    expect(lastFrame()).toContain('3 matches in 2 files');
  });

  it('should handle no matches found', () => {
    const item = createMockItem({
      result: {
        content: [{
          type: 'text',
          text: 'No matches found',
        }],
        isError: false,
      },
    });
    
    const { lastFrame } = renderWithProviders(<FileSearchToolRenderer item={item} />);
    expect(lastFrame()).toContain('No matches found');
    expect(lastFrame()).not.toContain('matches in');
  });

  it('should show error status on failure', () => {
    const item = createMockItem({
      result: {
        content: [{
          type: 'text',
          text: 'Error: Directory not found',
        }],
        isError: true,
      },
    });
    
    const { lastFrame } = renderWithProviders(<FileSearchToolRenderer item={item} />);
    expect(lastFrame()).toContain('✗');
  });

  it('should show search results preview when collapsed', () => {
    const searchOutput = `Found 5 matches in 3 files:

src/app.js
  15: // TODO: refactor this
  20: // TODO: optimize performance

src/test.js
  10: // TODO: add more tests
  30: // TODO: mock this properly

src/utils.js
  5: // TODO: deprecate this function`;
    
    const item = createMockItem({
      result: {
        content: [{
          type: 'text',
          text: searchOutput,
        }],
        isError: false,
      },
    });
    
    const { lastFrame } = renderWithProviders(<FileSearchToolRenderer item={item} />);
    expect(lastFrame()).toContain('src/app.js');
    expect(lastFrame()).toContain('15: // TODO: refactor this');
    expect(lastFrame()).toContain('... and more');
    // Should not show all results in preview
    expect(lastFrame()).not.toContain('src/utils.js');
  });

  it('should handle single match', () => {
    const searchOutput = `Found 1 match in 1 file:

src/config.js
  42: // TODO: move to env vars`;
    
    const item = createMockItem({
      result: {
        content: [{
          type: 'text',
          text: searchOutput,
        }],
        isError: false,
      },
    });
    
    const { lastFrame } = renderWithProviders(<FileSearchToolRenderer item={item} />);
    expect(lastFrame()).toContain('1 match in 1 file');
  });

  it('should extract match count from various formats', () => {
    const searchOutput = `Found 15 matches in 8 files:

[... search results ...]`;
    
    const item = createMockItem({
      result: {
        content: [{
          type: 'text',
          text: searchOutput,
        }],
        isError: false,
      },
    });
    
    const { lastFrame } = renderWithProviders(<FileSearchToolRenderer item={item} />);
    expect(lastFrame()).toContain('15 matches in 8 files');
  });
});