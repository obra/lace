// ABOUTME: Unit tests for Chat component
// ABOUTME: Tests layout, agent selection, props passing to child components

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Chat } from '@/components/chat/Chat';
import type { ThreadId, AgentInfo, LaceEvent } from '@/types/core';
import { createMockAgentContext } from '@/__tests__/utils/provider-mocks';

// Use vi.hoisted to ensure mock functions are available during hoisting
const mockTimelineView = vi.hoisted(() => {
  const MockTimelineView = ({
    events,
    agents,
    isTyping,
    currentAgent,
    selectedAgent,
  }: {
    events: LaceEvent[];
    agents: AgentInfo[] | undefined;
    isTyping: boolean;
    currentAgent: string;
    selectedAgent: ThreadId | undefined;
  }) => (
    <div data-testid="timeline-view">
      <div data-testid="events-count">{events.length}</div>
      <div data-testid="agents-count">{agents?.length || 0}</div>
      <div data-testid="is-typing">{isTyping.toString()}</div>
      <div data-testid="current-agent">{currentAgent}</div>
      <div data-testid="selected-agent">{selectedAgent || 'none'}</div>
    </div>
  );
  MockTimelineView.displayName = 'MockTimelineView';
  return MockTimelineView;
});

const mockMemoizedChatInput = vi.hoisted(() => {
  const MockMemoizedChatInput = ({
    onSubmit,
    onInterrupt,
    disabled,
    isStreaming,
    placeholder,
    agentId,
  }: {
    onSubmit: (message: string) => Promise<boolean | void>;
    onInterrupt?: () => Promise<boolean | void>;
    disabled: boolean;
    isStreaming?: boolean;
    placeholder: string;
    agentId?: ThreadId;
  }) => (
    <div data-testid="memoized-chat-input">
      <div data-testid="disabled">{disabled.toString()}</div>
      <div data-testid="is-streaming">{isStreaming?.toString() || 'false'}</div>
      <div data-testid="placeholder">{placeholder}</div>
      <div data-testid="agent-id">{agentId || 'none'}</div>
      <button onClick={() => onSubmit('test message')}>Send</button>
      {onInterrupt && <button onClick={() => onInterrupt()}>Stop</button>}
    </div>
  );
  MockMemoizedChatInput.displayName = 'MockMemoizedChatInput';
  return MockMemoizedChatInput;
});

// Mock dependencies
vi.mock('@/components/timeline/TimelineView', () => ({
  TimelineView: mockTimelineView,
}));

vi.mock('@/components/chat/MemoizedChatInput', () => ({
  MemoizedChatInput: mockMemoizedChatInput,
}));

// Mock providers
vi.mock('@/components/providers/EventStreamProvider', () => ({
  useSessionEvents: vi.fn(),
  useSessionAPI: vi.fn(),
}));

vi.mock('@/components/providers/AgentProvider', () => ({
  useAgentContext: vi.fn(),
}));

// Import mocked hooks
import { useSessionEvents, useSessionAPI } from '@/components/providers/EventStreamProvider';
import { useAgentContext } from '@/components/providers/AgentProvider';

const mockUseSessionEvents = vi.mocked(useSessionEvents);
const mockUseSessionAPI = vi.mocked(useSessionAPI);
const mockUseAgentContext = vi.mocked(useAgentContext);

// Test data factories
const createMockAgent = (id: string, name: string): AgentInfo => ({
  threadId: id as ThreadId,
  name,
  providerInstanceId: 'test-provider',
  modelId: 'test-model',
  status: 'idle',
});

const createMockEvent = (id: string): LaceEvent => ({
  id,
  type: 'USER_MESSAGE',
  threadId: 'test-thread' as ThreadId,
  timestamp: new Date(),
  data: 'Test message',
});

describe('Chat', () => {
  const mockSendMessage = vi.fn();
  const mockStopAgent = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up default provider mocks
    mockUseSessionEvents.mockReturnValue({
      events: [createMockEvent('event-1'), createMockEvent('event-2')],
      loadingHistory: false,
      addAgentEvent: vi.fn(),
    });

    mockUseSessionAPI.mockReturnValue({
      sendMessage: mockSendMessage,
      stopAgent: mockStopAgent,
    });

    mockUseAgentContext.mockReturnValue(
      createMockAgentContext({
        sessionDetails: {
          id: 'session-1' as ThreadId,
          name: 'Test Session',
          createdAt: new Date(),
          agents: [createMockAgent('agent-1', 'Alice'), createMockAgent('agent-2', 'Bob')],
        },
        selectedAgent: 'agent-1' as ThreadId,
        agentBusy: false,
      })
    );
  });

  describe('Layout Structure', () => {
    it('renders with correct layout classes', () => {
      render(<Chat />);

      const container = screen.getByTestId('timeline-view').closest('.flex-1.flex.flex-col.h-full');
      expect(container).toBeInTheDocument();
    });

    it('renders timeline view in scrollable container', () => {
      render(<Chat />);

      const timelineContainer = screen
        .getByTestId('timeline-view')
        .closest('.max-w-3xl.mx-auto.px-4');
      expect(timelineContainer).toBeInTheDocument();

      const scrollableArea = timelineContainer?.closest('.flex-1.overflow-y-auto');
      expect(scrollableArea).toBeInTheDocument();
    });

    it('renders chat input in fixed bottom container', () => {
      render(<Chat />);

      const inputContainer = screen
        .getByTestId('memoized-chat-input')
        .closest('.max-w-3xl.mx-auto.px-4');
      expect(inputContainer).toBeInTheDocument();

      const fixedBottom = inputContainer?.closest('.flex-shrink-0.pb-6.pt-2.min-h-\\[80px\\]');
      expect(fixedBottom).toBeInTheDocument();
    });
  });

  describe('Provider Integration', () => {
    it('uses events from SessionEvents provider', () => {
      render(<Chat />);

      expect(screen.getByTestId('events-count')).toHaveTextContent('2');
    });

    it('passes agents correctly', () => {
      render(<Chat />);

      expect(screen.getByTestId('agents-count')).toHaveTextContent('2');
    });

    it('passes isTyping based on agentBusy from provider', () => {
      mockUseAgentContext.mockReturnValue(
        createMockAgentContext({
          sessionDetails: {
            id: 'session-1' as ThreadId,
            name: 'Test Session',
            createdAt: new Date(),
            agents: [createMockAgent('agent-1', 'Alice'), createMockAgent('agent-2', 'Bob')],
          },
          selectedAgent: 'agent-1' as ThreadId,
          agentBusy: true,
        })
      );

      render(<Chat />);

      expect(screen.getByTestId('is-typing')).toHaveTextContent('true');
    });

    it('passes current agent name when selected agent exists', () => {
      render(<Chat />);

      expect(screen.getByTestId('current-agent')).toHaveTextContent('Alice');
    });

    it('passes default Agent name when selected agent not found', () => {
      mockUseAgentContext.mockReturnValue(
        createMockAgentContext({
          sessionDetails: {
            id: 'session-1' as ThreadId,
            name: 'Test Session',
            createdAt: new Date(),
            agents: [createMockAgent('agent-1', 'Alice'), createMockAgent('agent-2', 'Bob')],
          },
          selectedAgent: 'nonexistent' as ThreadId,
        })
      );

      render(<Chat />);

      expect(screen.getByTestId('current-agent')).toHaveTextContent('Agent');
    });

    it('passes selectedAgent for timeline', () => {
      render(<Chat />);

      expect(screen.getByTestId('selected-agent')).toHaveTextContent('agent-1');
    });

    it('falls back to first agent when no agent selected', () => {
      mockUseAgentContext.mockReturnValue(
        createMockAgentContext({
          sessionDetails: {
            id: 'session-1' as ThreadId,
            name: 'Test Session',
            createdAt: new Date(),
            agents: [createMockAgent('agent-1', 'Alice'), createMockAgent('agent-2', 'Bob')],
          },
          selectedAgent: null,
        })
      );

      render(<Chat />);

      expect(screen.getByTestId('selected-agent')).toHaveTextContent('agent-1');
    });
  });

  describe('Data Passing to MemoizedChatInput', () => {
    it('passes disabled state based on agentBusy from provider', () => {
      mockUseAgentContext.mockReturnValue(
        createMockAgentContext({
          sessionDetails: {
            id: 'session-1' as ThreadId,
            name: 'Test Session',
            createdAt: new Date(),
            agents: [createMockAgent('agent-1', 'Alice')],
          },
          selectedAgent: 'agent-1' as ThreadId,
          agentBusy: true,
        })
      );

      render(<Chat />);

      expect(screen.getByTestId('disabled')).toHaveTextContent('true');
    });

    it('passes streaming state based on agentBusy from provider', () => {
      mockUseAgentContext.mockReturnValue(
        createMockAgentContext({
          sessionDetails: {
            id: 'session-1' as ThreadId,
            name: 'Test Session',
            createdAt: new Date(),
            agents: [createMockAgent('agent-1', 'Alice')],
          },
          selectedAgent: 'agent-1' as ThreadId,
          agentBusy: true,
        })
      );

      render(<Chat />);

      expect(screen.getByTestId('is-streaming')).toHaveTextContent('true');
    });

    it('generates correct placeholder with selected agent', () => {
      render(<Chat />);

      expect(screen.getByTestId('placeholder')).toHaveTextContent('Message Alice...');
    });

    it('generates placeholder with first agent when none selected', () => {
      mockUseAgentContext.mockReturnValue(
        createMockAgentContext({
          sessionDetails: {
            id: 'session-1' as ThreadId,
            name: 'Test Session',
            createdAt: new Date(),
            agents: [createMockAgent('agent-1', 'Alice')],
          },
          selectedAgent: null,
        })
      );

      render(<Chat />);

      expect(screen.getByTestId('placeholder')).toHaveTextContent('Message Alice...');
    });

    it('uses fallback placeholder when no agents', () => {
      mockUseAgentContext.mockReturnValue(
        createMockAgentContext({
          sessionDetails: {
            id: 'session-1' as ThreadId,
            name: 'Test Session',
            createdAt: new Date(),
            agents: [],
          },
          selectedAgent: null,
        })
      );

      render(<Chat />);

      expect(screen.getByTestId('placeholder')).toHaveTextContent('Message agent...');
    });

    it('passes correct agent ID for selected agent', () => {
      render(<Chat />);

      expect(screen.getByTestId('agent-id')).toHaveTextContent('agent-1');
    });

    it('passes first agent ID when none selected', () => {
      mockUseAgentContext.mockReturnValue(
        createMockAgentContext({
          sessionDetails: {
            id: 'session-1' as ThreadId,
            name: 'Test Session',
            createdAt: new Date(),
            agents: [createMockAgent('agent-1', 'Alice')],
          },
          selectedAgent: null,
        })
      );

      render(<Chat />);

      expect(screen.getByTestId('agent-id')).toHaveTextContent('agent-1');
    });

    it('passes none when no agents available', () => {
      mockUseAgentContext.mockReturnValue(
        createMockAgentContext({
          sessionDetails: {
            id: 'session-1' as ThreadId,
            name: 'Test Session',
            createdAt: new Date(),
            agents: [],
          },
          selectedAgent: null,
        })
      );

      render(<Chat />);

      expect(screen.getByTestId('agent-id')).toHaveTextContent('none');
    });
  });

  describe('Agent Selection Logic', () => {
    it('prefers selected agent over first agent', () => {
      mockUseAgentContext.mockReturnValue(
        createMockAgentContext({
          sessionDetails: {
            id: 'session-1' as ThreadId,
            name: 'Test Session',
            createdAt: new Date(),
            agents: [createMockAgent('agent-1', 'Alice'), createMockAgent('agent-2', 'Bob')],
          },
          selectedAgent: 'agent-2' as ThreadId,
        })
      );

      render(<Chat />);

      expect(screen.getByTestId('current-agent')).toHaveTextContent('Bob');
      expect(screen.getByTestId('agent-id')).toHaveTextContent('agent-2');
      expect(screen.getByTestId('placeholder')).toHaveTextContent('Message Bob...');
    });

    it('handles no session details gracefully', () => {
      mockUseAgentContext.mockReturnValue(
        createMockAgentContext({
          sessionDetails: null,
          selectedAgent: null,
        })
      );

      render(<Chat />);

      expect(screen.getByTestId('agents-count')).toHaveTextContent('0');
      expect(screen.getByTestId('current-agent')).toHaveTextContent('Agent');
      expect(screen.getByTestId('agent-id')).toHaveTextContent('none');
      expect(screen.getByTestId('placeholder')).toHaveTextContent('Message agent...');
    });

    it('handles empty agents array', () => {
      mockUseAgentContext.mockReturnValue(
        createMockAgentContext({
          sessionDetails: {
            id: 'session-1' as ThreadId,
            name: 'Test Session',
            createdAt: new Date(),
            agents: [],
          },
          selectedAgent: null,
        })
      );

      render(<Chat />);

      expect(screen.getByTestId('agents-count')).toHaveTextContent('0');
      expect(screen.getByTestId('current-agent')).toHaveTextContent('Agent');
      expect(screen.getByTestId('agent-id')).toHaveTextContent('none');
    });
  });

  describe('Event Handlers', () => {
    it('calls sendMessage from provider when chat input sends', () => {
      render(<Chat />);

      const sendButton = screen.getByText('Send');
      sendButton.click();

      expect(mockSendMessage).toHaveBeenCalledWith('agent-1', 'test message');
    });

    it('calls stopAgent from provider when stop button clicked', () => {
      render(<Chat />);

      const stopButton = screen.getByText('Stop');
      stopButton.click();

      expect(mockStopAgent).toHaveBeenCalledWith('agent-1');
    });

    it('renders stop button when onStopGeneration callback exists', () => {
      render(<Chat />);

      const stopButton = screen.getByText('Stop');
      expect(stopButton).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles empty events array from provider', () => {
      mockUseSessionEvents.mockReturnValue({
        events: [],
        loadingHistory: false,
        addAgentEvent: vi.fn(),
      });

      render(<Chat />);

      expect(screen.getByTestId('events-count')).toHaveTextContent('0');
    });

    it('handles single agent from provider', () => {
      mockUseAgentContext.mockReturnValue(
        createMockAgentContext({
          sessionDetails: {
            id: 'session-1' as ThreadId,
            name: 'Test Session',
            createdAt: new Date(),
            agents: [createMockAgent('solo-agent', 'Solo')],
          },
          selectedAgent: 'solo-agent' as ThreadId,
        })
      );

      render(<Chat />);

      expect(screen.getByTestId('agents-count')).toHaveTextContent('1');
      expect(screen.getByTestId('current-agent')).toHaveTextContent('Solo');
      expect(screen.getByTestId('placeholder')).toHaveTextContent('Message Solo...');
    });
  });
});
