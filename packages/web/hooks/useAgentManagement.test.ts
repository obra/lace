// ABOUTME: Tests for useAgentManagement hook
// ABOUTME: Validates agent creation, selection, and state management operations

import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionInfo, AgentInfo, ThreadId } from '@/types/core';
import { useAgentManagement } from './useAgentManagement';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock parseResponse
vi.mock('@/lib/serialization', () => ({
  parseResponse: vi.fn((res) => {
    if (!res.ok) throw new Error('Network error');
    return res.json();
  }),
}));

const mockSessionWithAgents: SessionInfo = {
  id: 'session-1' as ThreadId,
  name: 'Test Session',
  createdAt: new Date('2024-01-01'),
  agents: [
    {
      threadId: 'agent-1' as ThreadId,
      name: 'Agent 1',
      modelId: 'claude-3-5-haiku',
      status: 'idle',
      providerInstanceId: 'provider-1',
    },
    {
      threadId: 'agent-2' as ThreadId,
      name: 'Agent 2',
      modelId: 'claude-3-5-sonnet',
      status: 'thinking',
      providerInstanceId: 'provider-2',
    },
  ],
};

describe('useAgentManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads session details when session is selected', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockSessionWithAgents),
    });

    const { result } = renderHook(() => useAgentManagement('session-1'));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.sessionDetails).toEqual(mockSessionWithAgents);
    expect(result.current.loading).toBe(false);
    expect(mockFetch).toHaveBeenCalledWith('/api/sessions/session-1');
  });

  it('clears session details when session is deselected', () => {
    const { result, rerender } = renderHook(
      (props: { sessionId: string | null }) => useAgentManagement(props.sessionId),
      {
        initialProps: { sessionId: 'session-1' as string | null },
      }
    );

    // Clear session
    rerender({ sessionId: null });

    expect(result.current.sessionDetails).toBeNull();
  });

  it('creates a new agent', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSessionWithAgents),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ threadId: 'new-agent' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            ...mockSessionWithAgents,
            agents: [
              ...mockSessionWithAgents.agents!,
              { threadId: 'new-agent', name: 'New Agent' },
            ],
          }),
      });

    const { result } = renderHook(() => useAgentManagement('session-1'));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      await result.current.createAgent('session-1', {
        name: 'New Agent',
        modelId: 'gpt-4',
        providerInstanceId: 'openai',
      });
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/sessions/session-1/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'New Agent',
        modelId: 'gpt-4',
        providerInstanceId: 'openai',
      }),
    });

    // Should reload session details after creation
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('updates agent state', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockSessionWithAgents),
    });

    const { result } = renderHook(() => useAgentManagement('session-1'));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    act(() => {
      result.current.updateAgentState('agent-1', 'idle', 'thinking');
    });

    expect(result.current.sessionDetails?.agents?.[0]?.status).toBe('thinking');
  });

  it('handles agent state changes when session details exist', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockSessionWithAgents),
    });

    const { result } = renderHook(() => useAgentManagement('session-1'));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Update agent state
    act(() => {
      result.current.updateAgentState('agent-1', 'idle', 'streaming');
    });

    expect(result.current.sessionDetails?.agents?.[0]?.status).toBe('streaming');
  });

  it('handles API errors gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useAgentManagement('session-1'));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.sessionDetails).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
