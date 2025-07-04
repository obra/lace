// ABOUTME: Tests for DelegateToolRenderer component with delegation-specific functionality
// ABOUTME: Verifies tool execution display, delegation box integration, and expansion behavior

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { DelegateToolRenderer } from '../DelegateToolRenderer.js';
import { ToolCall, ToolResult } from '../../../../../../tools/types.js';
import type { ToolExecutionItem } from '../hooks/useToolData.js';
import { LaceFocusProvider } from '../../../../focus/focus-provider.js';
import { UI_SYMBOLS, UI_COLORS } from '../../../../theme.js';

import { Text, Box } from 'ink';

// Mock all the dependencies BEFORE the component imports them
vi.mock('../../../focus/focus-lifecycle-wrapper.js', () => ({
  FocusLifecycleWrapper: ({ children }: any) => children,
}));

// Mock the utils
vi.mock('../../../../../utils/logger.js', () => ({
  logger: {
    debug: () => {},
    error: () => {},
    warn: () => {},
  },
}));

vi.mock('../../../../../utils/token-estimation.js', () => ({
  formatTokenCount: (count: number) => `${count} tokens`,
}));

vi.mock('../../utils/timeline-utils.js', () => ({
  extractDelegateThreadId: (item: any) => item.result?.metadata?.threadId || null,
  isThreadComplete: () => false,
  extractTaskFromTimeline: (timeline: any) => 'Task',
  calculateDuration: () => '0:00',
  calculateTokens: () => ({ tokensIn: 0, tokensOut: 0 }),
}));

// Mock the thread management
vi.mock('../../../../hooks/useThreadManager.js', () => ({
  useThreadManager: () => ({
    getEvents: () => [],
  }),
}));

vi.mock('../../../../hooks/useThreadProcessor.js', () => ({
  useThreadProcessor: () => ({
    processThreads: () => ({ items: [], metadata: {} }),
  }),
}));

// Create mock DelegateHeader component
const MockDelegateHeader = ({ toolData, delegateData }: any) => {
  return React.createElement(
    Box,
    { flexDirection: 'column' },
    React.createElement(
      Box,
      {},
      React.createElement(Text, {}, '🔧 delegate '),
      React.createElement(Text, {}, toolData.baseData.primaryInfo),
      React.createElement(Text, {}, ' '),
      React.createElement(Text, {}, toolData.baseData.statusIcon),
      React.createElement(Text, {}, ' [DELEGATE]')
    ),
    delegateData.delegateThreadId && React.createElement(
      Box,
      {},
      React.createElement(Text, {}, `${UI_SYMBOLS.DELEGATE} `),
      React.createElement(Text, {}, `Thread: ${delegateData.delegateThreadId}`)
    )
  );
};

// Mock the new architecture components
vi.mock('../components/ToolDisplay.js', () => ({
  ToolDisplay: ({ toolData, toolState, components }: any) => {
    // For DelegateToolRenderer, the toolData passed is the delegateData object
    // which has baseData property
    const actualToolData = toolData.baseData || toolData;
    
    return React.createElement(
      Box,
      { flexDirection: 'column' },
      // Render custom components
      components?.header || React.createElement(Text, {}, 'Default header'),
      !toolState.isExpanded && components?.preview,
      toolState.isExpanded && components?.content
    );
  },
}));

vi.mock('../hooks/useToolData.js', () => {
  return {
    useToolData: (item: any) => {
      const { call, result } = item;
      const success = result ? !result.isError : true;
      const isStreaming = !result;
      const output = result?.content?.[0]?.text || '';
      const task = call.arguments.task || call.arguments.prompt || 'Unknown task';
      
      return {
        toolName: 'delegate',
        primaryInfo: task,
        secondaryInfo: '[DELEGATE]',
        success,
        isStreaming,
        statusIcon: success ? '✓' : result ? '✗' : '⏳',
        output,
        language: 'text',
        isEmpty: false,
        stats: '',
        input: call.arguments,
        result,
      };
    },
    ToolExecutionItem: {},
  };
});

vi.mock('../hooks/useDelegateToolData.js', () => ({
  useDelegateToolData: (item: any) => {
    const { call, result } = item;
    const task = call.arguments.task || call.arguments.prompt || 'Unknown task';
    const delegateThreadId = result?.metadata?.threadId || null;
    
    // Create a mock of the DelegateHeader component content inline
    const header = React.createElement(MockDelegateHeader, { 
      toolData: {
        baseData: {
          primaryInfo: `"${task}"`,
          statusIcon: result ? (!result.isError ? '✓' : '✗') : '⏳',
        }
      },
      delegateData: { delegateThreadId }
    });
    
    return {
      baseData: {
        toolName: 'delegate',
        primaryInfo: `"${task}"`,
        secondaryInfo: '[DELEGATE]',
        success: result ? !result.isError : true,
        isStreaming: !result,
        statusIcon: result ? (!result.isError ? '✓' : '✗') : '⏳',
        output: result?.content?.[0]?.text || '',
        language: 'text',
        isEmpty: false,
        stats: '',
        input: call.arguments,
        result,
      },
      delegateThreadId,
      delegateTask: task,
      timeline: { items: [], metadata: { eventCount: 0, messageCount: 0, lastActivity: new Date() } },
      hasThreadData: !!delegateThreadId,
      isComplete: false,
      taskDescription: task,
      duration: '0:00',
      tokens: { tokensIn: 0, tokensOut: 0 },
      // Include the header for rendering
      header,
    };
  },
}));

vi.mock('../hooks/useDelegateToolState.js', () => ({
  useDelegateToolState: (delegateThreadId: string | null, isSelected: boolean, onToggle?: () => void) => ({
    baseState: {
      isExpanded: false,
      onExpand: vi.fn(),
      onCollapse: vi.fn(),
      handleExpandedChange: vi.fn(),
    },
    isEntered: false,
    isFocused: false,
    focusId: delegateThreadId ? `delegate:${delegateThreadId}` : 'none',
    setIsEntered: vi.fn(),
    delegationExpanded: true,
    setDelegationExpanded: vi.fn(),
    handleFocusEntry: vi.fn(),
  }),
}));

vi.mock('../hooks/useToolState.js', () => ({
  useToolState: (isSelected: boolean, onToggle?: () => void) => ({
    isExpanded: false,
    onExpand: vi.fn(),
    onCollapse: vi.fn(),
    handleExpandedChange: vi.fn(),
  }),
}));

// Use actual theme values - no mocking needed since we import them

// Mock other dependencies
vi.mock('../../../focus/index.js', () => ({
  FocusLifecycleWrapper: ({ children }: any) => children,
  FocusRegions: {
    delegate: (id: string) => `delegate:${id}`,
  },
  useLaceFocus: () => ({ isFocused: false }),
}));

vi.mock('../hooks/useTimelineExpansionToggle.js', () => ({
  TimelineExpansionProvider: ({ children }: any) => children,
  useTimelineItemFocusEntry: () => {},
}));

vi.mock('ink', async () => {
  const actual = await vi.importActual<typeof import('ink')>('ink');
  return {
    ...actual,
    useInput: () => {},
  };
});

vi.mock('../TimelineDisplay.js', () => ({
  default: () => React.createElement(Text, {}, '[TimelineDisplay]'),
}));

describe('DelegateToolRenderer', () => {
  const createToolExecutionItem = (call: ToolCall, result?: ToolResult): ToolExecutionItem => ({
    type: 'tool_execution' as const,
    call,
    result,
    timestamp: new Date(),
    callId: 'test-call-id',
  });

  describe('Task extraction and display', () => {
    it('should extract task from input.task field', () => {
      const call: ToolCall = {
        id: 'test-call-1',
        name: 'delegate',
        arguments: { task: 'Fix the tests' },
      };
      const item = createToolExecutionItem(call);
      const { lastFrame } = render(
        <LaceFocusProvider>
          <DelegateToolRenderer item={item} />
        </LaceFocusProvider>
      );

      const frame = lastFrame();
      expect(frame).toContain('"Fix the tests"');
      expect(frame).toContain('[DELEGATE]');
    });

    it('should extract task from input.prompt field as fallback', () => {
      const call: ToolCall = {
        id: 'test-call-2',
        name: 'delegate',
        arguments: { prompt: 'Analyze the code' },
      };
      const item = createToolExecutionItem(call);
      const { lastFrame } = render(
        <LaceFocusProvider>
          <DelegateToolRenderer item={item} />
        </LaceFocusProvider>
      );

      const frame = lastFrame();
      expect(frame).toContain('"Analyze the code"');
      expect(frame).toContain('[DELEGATE]');
    });

    it('should use fallback when no task or prompt provided', () => {
      const call: ToolCall = {
        id: 'test-call-3',
        name: 'delegate',
        arguments: {},
      };
      const item = createToolExecutionItem(call);
      const { lastFrame } = render(
        <LaceFocusProvider>
          <DelegateToolRenderer item={item} />
        </LaceFocusProvider>
      );

      const frame = lastFrame();
      expect(frame).toContain('"Unknown task"');
    });
  });

  describe('Delegation status display', () => {
    it('should show thread ID when delegation is successful', () => {
      const call: ToolCall = {
        id: 'test-call-5',
        name: 'delegate',
        arguments: { task: 'Test task' },
      };
      const result: ToolResult = {
        content: [{ type: 'text', text: 'Task completed' }],
        isError: false,
        metadata: { threadId: 'thread-123' },
      };
      const item = createToolExecutionItem(call, result);
      const { lastFrame } = render(
        <LaceFocusProvider>
          <DelegateToolRenderer item={item} />
        </LaceFocusProvider>
      );

      const frame = lastFrame();
      expect(frame).toContain('Thread: thread-123');
      expect(frame).toContain('✓');
    });

    it('should show error status when delegation fails', () => {
      const call: ToolCall = {
        id: 'test-call-6',
        name: 'delegate',
        arguments: { task: 'Test task' },
      };
      const result: ToolResult = {
        content: [{ type: 'text', text: 'Error occurred' }],
        isError: true,
      };
      const item = createToolExecutionItem(call, result);
      const { lastFrame } = render(
        <LaceFocusProvider>
          <DelegateToolRenderer item={item} />
        </LaceFocusProvider>
      );

      const frame = lastFrame();
      expect(frame).toContain('✗');
    });

    it('should show pending status when no result yet', () => {
      const call: ToolCall = {
        id: 'test-call-7',
        name: 'delegate',
        arguments: { task: 'Test task' },
      };
      const item = createToolExecutionItem(call);
      const { lastFrame } = render(
        <LaceFocusProvider>
          <DelegateToolRenderer item={item} />
        </LaceFocusProvider>
      );

      const frame = lastFrame();
      expect(frame).toContain('⏳');
    });
  });

  describe('Input handling', () => {
    it('should handle complex input objects', () => {
      const call: ToolCall = {
        id: 'test-call-8',
        name: 'delegate',
        arguments: {
          task: 'Complex task',
          context: { key: 'value' },
          options: ['option1', 'option2'],
        },
      };
      const item = createToolExecutionItem(call);
      const { lastFrame } = render(
        <LaceFocusProvider>
          <DelegateToolRenderer item={item} />
        </LaceFocusProvider>
      );

      const frame = lastFrame();
      expect(frame).toContain('"Complex task"');
    });

    it('should handle empty input objects', () => {
      const call: ToolCall = {
        id: 'test-call-4',
        name: 'delegate',
        arguments: {},
      };
      const item = createToolExecutionItem(call);
      const { lastFrame } = render(
        <LaceFocusProvider>
          <DelegateToolRenderer item={item} />
        </LaceFocusProvider>
      );

      const frame = lastFrame();
      // Should still render without crashing
      expect(frame).toContain('Unknown task');
    });
  });

  describe('Thread ID extraction from metadata', () => {
    it('should extract thread ID from result metadata', () => {
      const call: ToolCall = {
        id: 'test-call-9',
        name: 'delegate',
        arguments: { task: 'Test task' },
      };
      const result: ToolResult = {
        content: [{ type: 'text', text: 'Success' }],
        isError: false,
        metadata: { threadId: 'thread-456' },
      };
      const item = createToolExecutionItem(call, result);
      const { lastFrame } = render(
        <LaceFocusProvider>
          <DelegateToolRenderer item={item} />
        </LaceFocusProvider>
      );

      const frame = lastFrame();
      expect(frame).toContain('thread-456');
    });

    it('should show delegation active status when thread ID present in metadata', () => {
      const call: ToolCall = {
        id: 'test-call-10',
        name: 'delegate',
        arguments: { task: 'Test task' },
      };
      const result: ToolResult = {
        content: [{ type: 'text', text: 'Working...' }],
        isError: false,
        metadata: { threadId: 'thread-789' },
      };
      const item = createToolExecutionItem(call, result);
      const { lastFrame } = render(
        <LaceFocusProvider>
          <DelegateToolRenderer item={item} />
        </LaceFocusProvider>
      );

      const frame = lastFrame();
      expect(frame).toContain(UI_SYMBOLS.DELEGATE); // Delegate symbol
      expect(frame).toContain('Thread: thread-789');
    });
  });
});