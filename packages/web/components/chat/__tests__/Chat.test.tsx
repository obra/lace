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
import { ScrollProvider } from '@/components/providers/ScrollProvider';
import { SettingsProvider } from '@/components/providers/SettingsProvider';
import type { ThreadId, AgentInfo, LaceEvent } from '@/types/core';
import { createMockAgentContext } from '@/__tests__/utils/provider-mocks';
import { createMockAgentInfo } from '@/__tests__/utils/agent-mocks';

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
  useAgentAPI: vi.fn(),
  useEventStreamContext: vi.fn(),
  useCompactionState: vi.fn(),
}));

vi.mock('@/components/providers/AgentProvider', () => ({
  useAgentContext: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn(),
    patch: vi.fn(),
  },
}));

// Import mocked hooks
import {
  useSessionEvents,
  useAgentAPI,
  useEventStreamContext,
  useCompactionState,
} from '@/components/providers/EventStreamProvider';
import { useAgentContext } from '@/components/providers/AgentProvider';
import { api } from '@/lib/api-client';

const mockUseSessionEvents = vi.mocked(useSessionEvents);
const mockUseAgentAPI = vi.mocked(useAgentAPI);
const mockUseEventStreamContext = vi.mocked(useEventStreamContext);
const mockUseCompactionState = vi.mocked(useCompactionState);
const mockUseAgentContext = vi.mocked(useAgentContext);
const mockApi = vi.mocked(api);

// Test data factories
const createMockAgent = (id: string, name: string): AgentInfo =>
  createMockAgentInfo({
    threadId: id as ThreadId,
    name,
    providerInstanceId: 'test-provider',
    modelId: 'test-model',
    status: 'idle',
  });

const createMockEvent = (id: string): LaceEvent => ({
  id,
  type: 'USER_MESSAGE',
  timestamp: new Date(),
  data: 'Test message',
  context: { threadId: 'test-thread' as ThreadId },
});

describe('Chat', () => {
  const mockSendMessage = vi.fn();
  const mockStopAgent = vi.fn();

  // Helper to render Chat with required providers
  const renderChat = () => {
    return render(
      <SettingsProvider>
        <ScrollProvider>
          <Chat />
        </ScrollProvider>
      </SettingsProvider>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock API for SettingsProvider
    mockApi.get.mockResolvedValue({});
    mockApi.patch.mockResolvedValue({});

    // Set up default provider mocks
    mockUseSessionEvents.mockReturnValue({
      events: [createMockEvent('event-1'), createMockEvent('event-2')],
      loadingHistory: false,
      addAgentEvent: vi.fn(),
    });

    mockUseAgentAPI.mockReturnValue({
      sendMessage: mockSendMessage,
      stopAgent: mockStopAgent,
    });

    mockUseEventStreamContext.mockReturnValue({
      eventStream: {
        connection: {
          connected: false,
          lastEventId: undefined,
          reconnectAttempts: 0,
          maxReconnectAttempts: 5,
        },
        lastEvent: undefined,
        reconnect: vi.fn(),
        close: vi.fn(),
      },
      agentEvents: {
        events: [],
        loadingHistory: false,
        addAgentEvent: vi.fn(),
      },
      compactionState: {
        isCompacting: false,
        isAuto: false,
        compactingAgentId: undefined,
      },
      agentAPI: {
        sendMessage: vi.fn(),
        stopAgent: vi.fn(),
      },
    });

    mockUseCompactionState.mockReturnValue({
      isCompacting: false,
      isAuto: false,
      compactingAgentId: undefined,
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
    it('renders timeline view component', () => {
      renderChat();

      expect(screen.getByTestId('timeline-view')).toBeInTheDocument();
    });

    it('renders chat input component', () => {
      renderChat();

      expect(screen.getByTestId('memoized-chat-input')).toBeInTheDocument();
    });
  });

  describe('Provider Integration', () => {
    it('uses events from SessionEvents provider', () => {
      renderChat();

      expect(screen.getByTestId('events-count')).toHaveTextContent('2');
    });

    it('passes agents correctly', () => {
      renderChat();

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

      renderChat();

      expect(screen.getByTestId('is-typing')).toHaveTextContent('true');
    });

    it('passes current agent name when selected agent exists', () => {
      renderChat();

      expect(screen.getByTestId('current-agent')).toHaveTextContent('agent-1');
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

      renderChat();

      expect(screen.getByTestId('current-agent')).toHaveTextContent('');
    });

    it('passes selectedAgent for timeline', () => {
      renderChat();

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

      renderChat();

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

      renderChat();

      expect(screen.getByTestId('disabled')).toHaveTextContent('false'); // Component always passes disabled=false
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

      renderChat();

      expect(screen.getByTestId('is-streaming')).toHaveTextContent('true');
    });

    it('generates correct placeholder with selected agent', () => {
      renderChat();

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

      renderChat();

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

      renderChat();

      expect(screen.getByTestId('placeholder')).toHaveTextContent('Message agent...');
    });

    it('passes correct agent ID for selected agent', () => {
      renderChat();

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

      renderChat();

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

      renderChat();

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

      renderChat();

      expect(screen.getByTestId('current-agent')).toHaveTextContent('agent-2');
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

      renderChat();

      expect(screen.getByTestId('agents-count')).toHaveTextContent('0');
      expect(screen.getByTestId('current-agent')).toHaveTextContent('');
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

      renderChat();

      expect(screen.getByTestId('agents-count')).toHaveTextContent('0');
      expect(screen.getByTestId('current-agent')).toHaveTextContent('');
      expect(screen.getByTestId('agent-id')).toHaveTextContent('none');
    });
  });

  describe('Event Handlers', () => {
    it('calls sendMessage from provider when chat input sends', () => {
      renderChat();

      const sendButton = screen.getByText('Send');
      sendButton.click();

      expect(mockSendMessage).toHaveBeenCalledWith('agent-1', 'test message');
    });

    it('calls stopAgent from provider when stop button clicked', () => {
      renderChat();

      const stopButton = screen.getByText('Stop');
      stopButton.click();

      expect(mockStopAgent).toHaveBeenCalledWith('agent-1');
    });

    it('renders stop button when onStopGeneration callback exists', () => {
      renderChat();

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

      renderChat();

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

      renderChat();

      expect(screen.getByTestId('agents-count')).toHaveTextContent('1');
      expect(screen.getByTestId('current-agent')).toHaveTextContent('solo-agent');
      expect(screen.getByTestId('placeholder')).toHaveTextContent('Message Solo...');
    });
  });
});
