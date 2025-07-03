// ABOUTME: Tests for ToolDisplay component ensuring proper composition and display functionality
// ABOUTME: Validates component-based tool rendering with custom header/preview/content sections

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ToolDisplay, DefaultToolHeader, DefaultToolPreview, DefaultToolContent } from '../ToolDisplay.js';
import { ToolData } from '../../hooks/useToolData.js';
import { ToolState } from '../../hooks/useToolState.js';

// Mock the TimelineEntryCollapsibleBox component
vi.mock('../../../ui/TimelineEntryCollapsibleBox.js', () => ({
  TimelineEntryCollapsibleBox: ({ label, summary, children, isExpanded, onExpandedChange, isSelected, status }: any) => (
    <div data-testid="collapsible-box">
      <div data-testid="label">{label}</div>
      {summary && <div data-testid="summary">{summary}</div>}
      <div data-testid="expanded-state">{isExpanded ? 'expanded' : 'collapsed'}</div>
      <div data-testid="selected-state">{isSelected ? 'selected' : 'not-selected'}</div>
      <div data-testid="status">{status}</div>
      <div data-testid="content">{children}</div>
    </div>
  )
}));

// Mock UI constants
vi.mock('../../../../theme.js', () => ({
  UI_COLORS: {
    TOOL: 'blue',
    SUCCESS: 'green',
    ERROR: 'red',
  },
  UI_SYMBOLS: {
    SUCCESS: '✓',
    ERROR: '✗',
    PENDING: '⏳',
  },
}));

// Create mock tool data
function createMockToolData(overrides: Partial<ToolData> = {}): ToolData {
  return {
    toolName: 'bash',
    input: { command: 'ls -la' },
    output: 'file1.txt\nfile2.txt',
    success: true,
    isStreaming: false,
    primaryInfo: '$ ls -la',
    secondaryInfo: undefined,
    statusIcon: '✓',
    markerStatus: 'success',
    isJsonOutput: false,
    detectedLanguage: 'text',
    ...overrides,
  };
}

// Create mock tool state
function createMockToolState(overrides: Partial<ToolState> = {}): ToolState {
  return {
    isExpanded: false,
    onExpand: vi.fn(),
    onCollapse: vi.fn(),
    handleExpandedChange: vi.fn(),
    customState: {},
    setCustomState: vi.fn(),
    ...overrides,
  };
}

describe('ToolDisplay', () => {
  describe('basic rendering', () => {
    it('renders with default components', () => {
      const toolData = createMockToolData();
      const toolState = createMockToolState();
      
      const { getByTestId } = render(
        <ToolDisplay toolData={toolData} toolState={toolState} isSelected={false} />
      );
      
      expect(getByTestId('collapsible-box')).toBeInTheDocument();
      expect(getByTestId('label')).toBeInTheDocument();
      expect(getByTestId('content')).toBeInTheDocument();
    });

    it('passes correct props to TimelineEntryCollapsibleBox', () => {
      const toolData = createMockToolData({ markerStatus: 'error' });
      const toolState = createMockToolState({ isExpanded: true });
      
      const { getByTestId } = render(
        <ToolDisplay toolData={toolData} toolState={toolState} isSelected={true} />
      );
      
      expect(getByTestId('expanded-state')).toHaveTextContent('expanded');
      expect(getByTestId('selected-state')).toHaveTextContent('selected');
      expect(getByTestId('status')).toHaveTextContent('error');
    });

    it('shows preview when successful', () => {
      const toolData = createMockToolData({ success: true, output: 'test output' });
      const toolState = createMockToolState();
      
      const { getByTestId } = render(
        <ToolDisplay toolData={toolData} toolState={toolState} isSelected={false} />
      );
      
      expect(getByTestId('summary')).toBeInTheDocument();
    });

    it('hides preview when not successful', () => {
      const toolData = createMockToolData({ success: false });
      const toolState = createMockToolState();
      
      const { queryByTestId } = render(
        <ToolDisplay toolData={toolData} toolState={toolState} isSelected={false} />
      );
      
      expect(queryByTestId('summary')).not.toBeInTheDocument();
    });
  });

  describe('custom components', () => {
    it('uses custom header component when provided', () => {
      const CustomHeader = ({ toolData }: { toolData: ToolData }) => (
        <span data-testid="custom-header">Custom: {toolData.toolName}</span>
      );
      
      const toolData = createMockToolData();
      const toolState = createMockToolState();
      
      const { getByTestId } = render(
        <ToolDisplay 
          toolData={toolData} 
          toolState={toolState} 
          isSelected={false}
          components={{ header: CustomHeader }}
        />
      );
      
      expect(getByTestId('custom-header')).toHaveTextContent('Custom: bash');
    });

    it('uses custom preview component when provided', () => {
      const CustomPreview = () => (
        <span data-testid="custom-preview">Custom preview</span>
      );
      
      const toolData = createMockToolData({ success: true });
      const toolState = createMockToolState();
      
      const { getByTestId } = render(
        <ToolDisplay 
          toolData={toolData} 
          toolState={toolState} 
          isSelected={false}
          components={{ preview: CustomPreview }}
        />
      );
      
      expect(getByTestId('custom-preview')).toHaveTextContent('Custom preview');
    });

    it('uses custom content component when provided', () => {
      const CustomContent = ({ toolData }: { toolData: ToolData }) => (
        <span data-testid="custom-content">Custom content: {toolData.output}</span>
      );
      
      const toolData = createMockToolData();
      const toolState = createMockToolState();
      
      const { getByTestId } = render(
        <ToolDisplay 
          toolData={toolData} 
          toolState={toolState} 
          isSelected={false}
          components={{ content: CustomContent }}
        />
      );
      
      expect(getByTestId('custom-content')).toHaveTextContent('Custom content: file1.txt');
    });

    it('uses children over custom content component', () => {
      const CustomContent = () => <span data-testid="custom-content">Should not appear</span>;
      
      const toolData = createMockToolData();
      const toolState = createMockToolState();
      
      const { getByTestId, queryByTestId } = render(
        <ToolDisplay 
          toolData={toolData} 
          toolState={toolState} 
          isSelected={false}
          components={{ content: CustomContent }}
        >
          <span data-testid="children-content">Children content</span>
        </ToolDisplay>
      );
      
      expect(getByTestId('children-content')).toHaveTextContent('Children content');
      expect(queryByTestId('custom-content')).not.toBeInTheDocument();
    });
  });
});

describe('DefaultToolHeader', () => {
  it('displays tool name and primary info', () => {
    const toolData = createMockToolData({
      toolName: 'file-read',
      primaryInfo: '/home/test.txt',
    });
    
    const { container } = render(<DefaultToolHeader toolData={toolData} />);
    expect(container).toHaveTextContent('File Read: /home/test.txt');
  });

  it('displays secondary info when present', () => {
    const toolData = createMockToolData({
      primaryInfo: '$ ls',
      secondaryInfo: ' (List files)',
    });
    
    const { container } = render(<DefaultToolHeader toolData={toolData} />);
    expect(container).toHaveTextContent('$ ls (List files)');
  });

  it('displays status icon', () => {
    const toolData = createMockToolData({
      success: true,
      statusIcon: '✓',
    });
    
    const { container } = render(<DefaultToolHeader toolData={toolData} />);
    expect(container).toHaveTextContent('✓');
  });

  it('displays streaming indicator', () => {
    const toolData = createMockToolData({
      isStreaming: true,
    });
    
    const { container } = render(<DefaultToolHeader toolData={toolData} />);
    expect(container).toHaveTextContent('(working...)');
  });
});

describe('DefaultToolPreview', () => {
  it('shows nothing for unsuccessful tools', () => {
    const toolData = createMockToolData({ success: false });
    const { container } = render(<DefaultToolPreview toolData={toolData} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing for tools with no output', () => {
    const toolData = createMockToolData({ success: true, output: '' });
    const { container } = render(<DefaultToolPreview toolData={toolData} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows first few lines of output', () => {
    const toolData = createMockToolData({
      success: true,
      output: 'line1\nline2\nline3',
    });
    
    const { container } = render(<DefaultToolPreview toolData={toolData} />);
    expect(container).toHaveTextContent('line1\nline2\nline3');
  });

  it('shows truncation indicator for long output', () => {
    const toolData = createMockToolData({
      success: true,
      output: 'line1\nline2\nline3\nline4\nline5',
    });
    
    const { container } = render(<DefaultToolPreview toolData={toolData} />);
    expect(container).toHaveTextContent('(+ 2 lines)');
  });
});

describe('DefaultToolContent', () => {
  it('shows "No output" for successful tools with no output', () => {
    const toolData = createMockToolData({ 
      success: true, 
      output: '' 
    });
    
    const { container } = render(<DefaultToolContent toolData={toolData} />);
    expect(container).toHaveTextContent('No output');
  });

  it('shows error message for failed tools', () => {
    const toolData = createMockToolData({
      success: false,
      output: 'Command failed',
    });
    
    const { container } = render(<DefaultToolContent toolData={toolData} />);
    expect(container).toHaveTextContent('Error:');
    expect(container).toHaveTextContent('Command failed');
  });

  it('shows full output for successful tools', () => {
    const toolData = createMockToolData({
      success: true,
      output: 'Complete output here',
    });
    
    const { container } = render(<DefaultToolContent toolData={toolData} />);
    expect(container).toHaveTextContent('Complete output here');
  });

  it('shows "Unknown error" when no error message provided', () => {
    const toolData = createMockToolData({
      success: false,
      output: '',
    });
    
    const { container } = render(<DefaultToolContent toolData={toolData} />);
    expect(container).toHaveTextContent('Unknown error');
  });
});