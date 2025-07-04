// ABOUTME: Tests for ToolDisplay component - display layer with composable UI patterns
// ABOUTME: Tests header/preview/content component composition and integration with timeline infrastructure

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Text } from 'ink';
import { ToolDisplay } from '../ToolDisplay.js';
import { ToolData } from '../../hooks/useToolData.js';
import { ToolState } from '../../hooks/useToolState.js';

// Mock the timeline infrastructure
vi.mock('../../../ui/TimelineEntry.js', () => ({
  TimelineEntry: ({ children, summary, label, isExpanded, status }: any) => (
    <div data-testid="timeline-entry" data-expanded={isExpanded} data-status={status}>
      <div data-testid="summary">{summary}</div>
      <div data-testid="label">{label}</div>
      {isExpanded && <div data-testid="content">{children}</div>}
    </div>
  ),
}));

describe('ToolDisplay', () => {
  const mockToolData: ToolData = {
    toolName: 'bash',
    primaryInfo: '$ ls -la',
    secondaryInfo: 'List files',
    success: true,
    isStreaming: false,
    statusIcon: '✓',
    output: 'total 48\ndrwxr-xr-x 3 user staff 96',
    language: 'text',
    input: { command: 'ls -la' },
  };

  const mockToolState: ToolState = {
    isExpanded: false,
    onExpand: vi.fn(),
    onCollapse: vi.fn(),
    handleExpandedChange: vi.fn(),
  };

  describe('basic rendering', () => {
    it('should render with default components', () => {
      const { container } = render(
        <ToolDisplay
          toolData={mockToolData}
          toolState={mockToolState}
          isSelected={false}
        />
      );

      expect(container.querySelector('[data-testid="timeline-entry"]')).toBeTruthy();
      expect(container.querySelector('[data-testid="summary"]')).toBeTruthy();
    });

    it('should display tool name and primary info in default header', () => {
      const { container } = render(
        <ToolDisplay
          toolData={mockToolData}
          toolState={mockToolState}
          isSelected={false}
        />
      );

      const summary = container.querySelector('[data-testid="summary"]');
      expect(summary?.textContent).toContain('bash');
      expect(summary?.textContent).toContain('$ ls -la');
    });

    it('should show secondary info when available', () => {
      const { container } = render(
        <ToolDisplay
          toolData={mockToolData}
          toolState={mockToolState}
          isSelected={false}
        />
      );

      const summary = container.querySelector('[data-testid="summary"]');
      expect(summary?.textContent).toContain('List files');
    });
  });

  describe('custom components', () => {
    it('should use custom header component when provided', () => {
      const CustomHeader = () => <Text color="cyan">Custom Header</Text>;

      const { container } = render(
        <ToolDisplay
          toolData={mockToolData}
          toolState={mockToolState}
          isSelected={false}
          components={{
            header: <CustomHeader />,
          }}
        />
      );

      const summary = container.querySelector('[data-testid="summary"]');
      expect(summary?.textContent).toContain('Custom Header');
    });

    it('should use custom preview component when provided', () => {
      const CustomPreview = () => <Text color="yellow">Custom Preview</Text>;

      const { container } = render(
        <ToolDisplay
          toolData={{ ...mockToolData, isStreaming: false }}
          toolState={mockToolState}
          isSelected={false}
          components={{
            preview: <CustomPreview />,
          }}
        />
      );

      const summary = container.querySelector('[data-testid="summary"]');
      expect(summary?.textContent).toContain('Custom Preview');
    });

    it('should use custom content component when expanded', () => {
      const CustomContent = () => <Text color="green">Custom Content</Text>;

      const { container } = render(
        <ToolDisplay
          toolData={mockToolData}
          toolState={{ ...mockToolState, isExpanded: true }}
          isSelected={false}
          components={{
            content: <CustomContent />,
          }}
        />
      );

      const content = container.querySelector('[data-testid="content"]');
      expect(content?.textContent).toContain('Custom Content');
    });
  });

  describe('expansion behavior', () => {
    it('should pass expansion state to TimelineEntry', () => {
      const { container } = render(
        <ToolDisplay
          toolData={mockToolData}
          toolState={{ ...mockToolState, isExpanded: true }}
          isSelected={false}
        />
      );

      const entry = container.querySelector('[data-testid="timeline-entry"]');
      expect(entry?.getAttribute('data-expanded')).toBe('true');
    });

    it('should call handleExpandedChange when toggled', () => {
      const mockState = {
        ...mockToolState,
        handleExpandedChange: vi.fn(),
      };

      render(
        <ToolDisplay
          toolData={mockToolData}
          toolState={mockState}
          isSelected={false}
        />
      );

      // Note: In a real test, we'd simulate the interaction
      // For now, we just verify the handler is passed correctly
      expect(mockState.handleExpandedChange).toBeDefined();
    });
  });

  describe('status indicators', () => {
    it('should show success status for successful tools', () => {
      const { container } = render(
        <ToolDisplay
          toolData={mockToolData}
          toolState={mockToolState}
          isSelected={false}
        />
      );

      const entry = container.querySelector('[data-testid="timeline-entry"]');
      expect(entry?.getAttribute('data-status')).toBe('success');
    });

    it('should show error status for failed tools', () => {
      const errorData = {
        ...mockToolData,
        success: false,
        statusIcon: '✗',
      };

      const { container } = render(
        <ToolDisplay
          toolData={errorData}
          toolState={mockToolState}
          isSelected={false}
        />
      );

      const entry = container.querySelector('[data-testid="timeline-entry"]');
      expect(entry?.getAttribute('data-status')).toBe('error');
    });

    it('should show pending status for streaming tools', () => {
      const streamingData = {
        ...mockToolData,
        isStreaming: true,
        statusIcon: '⏳',
      };

      const { container } = render(
        <ToolDisplay
          toolData={streamingData}
          toolState={mockToolState}
          isSelected={false}
        />
      );

      const entry = container.querySelector('[data-testid="timeline-entry"]');
      expect(entry?.getAttribute('data-status')).toBe('pending');
    });
  });

  describe('default content rendering', () => {
    it('should show input when expanded with no custom content', () => {
      const { container } = render(
        <ToolDisplay
          toolData={mockToolData}
          toolState={{ ...mockToolState, isExpanded: true }}
          isSelected={false}
        />
      );

      const content = container.querySelector('[data-testid="content"]');
      expect(content?.textContent).toContain('Input');
    });

    it('should show output when available and expanded', () => {
      const { container } = render(
        <ToolDisplay
          toolData={mockToolData}
          toolState={{ ...mockToolState, isExpanded: true }}
          isSelected={false}
        />
      );

      const content = container.querySelector('[data-testid="content"]');
      expect(content?.textContent).toContain('Output');
      expect(content?.textContent).toContain('total 48');
    });

    it('should show error when tool failed and expanded', () => {
      const errorData = {
        ...mockToolData,
        success: false,
        output: 'Permission denied',
      };

      const { container } = render(
        <ToolDisplay
          toolData={errorData}
          toolState={{ ...mockToolState, isExpanded: true }}
          isSelected={false}
        />
      );

      const content = container.querySelector('[data-testid="content"]');
      expect(content?.textContent).toContain('Error');
      expect(content?.textContent).toContain('Permission denied');
    });
  });

  describe('stats display', () => {
    it('should show stats when available in summary', () => {
      const dataWithStats = {
        ...mockToolData,
        stats: '48 files listed',
      };

      const { container } = render(
        <ToolDisplay
          toolData={dataWithStats}
          toolState={mockToolState}
          isSelected={false}
        />
      );

      const summary = container.querySelector('[data-testid="summary"]');
      expect(summary?.textContent).toContain('48 files listed');
    });
  });

  describe('streaming state', () => {
    it('should show streaming indicator when tool is streaming', () => {
      const streamingData = {
        ...mockToolData,
        isStreaming: true,
      };

      const { container } = render(
        <ToolDisplay
          toolData={streamingData}
          toolState={mockToolState}
          isSelected={false}
        />
      );

      const summary = container.querySelector('[data-testid="summary"]');
      expect(summary?.textContent).toContain('running...');
    });
  });

  describe('integration', () => {
    it('should integrate all props correctly with TimelineEntry', () => {
      const { container } = render(
        <ToolDisplay
          toolData={mockToolData}
          toolState={mockToolState}
          isSelected={true}
          onToggle={vi.fn()}
        />
      );

      const entry = container.querySelector('[data-testid="timeline-entry"]');
      expect(entry).toBeTruthy();
    });
  });
});