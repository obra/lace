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
  parseResponse: vi.fn(),
}));

import { parseResponse } from '@/lib/serialization';
const mockParseResponse = vi.mocked(parseResponse);

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
    // Default parseResponse behavior - safely handle response
    mockParseResponse.mockImplementation((res: Response) => {
      if (!res || typeof res.json !== 'function') {
        return Promise.resolve(null);
      }
      return res.json();
    });
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
    expect(mockFetch).toHaveBeenCalledWith('/api/sessions/session-1', { method: 'GET' });
  });

  it('clears session details when session is deselected', async () => {
    const { result, rerender } = renderHook(
      (props: { sessionId: string | null }) => useAgentManagement(props.sessionId),
      {
        initialProps: { sessionId: 'session-1' as string | null },
      }
    );

    // Clear session
    await act(async () => {
      rerender({ sessionId: null });
      // Allow state updates to complete
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

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
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const networkError = new Error('Network error');
    mockFetch.mockRejectedValueOnce(networkError);

    const { result } = renderHook(() => useAgentManagement('session-1'));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.sessionDetails).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith('Failed to load session details:', networkError);

    consoleSpy.mockRestore();
  });

  it('handles create agent errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const createError = new Error('Create failed');
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSessionWithAgents),
      })
      .mockRejectedValueOnce(createError);

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

    expect(consoleSpy).toHaveBeenCalledWith('Failed to create agent:', createError);

    consoleSpy.mockRestore();
  });

  it('handles create agent HTTP errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSessionWithAgents),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Agent creation failed' }),
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

    expect(consoleSpy).toHaveBeenCalledWith('Failed to create agent:', expect.any(Error));

    consoleSpy.mockRestore();
  });

  it('handles load agent configuration errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const configError = new Error('Config load failed');
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSessionWithAgents),
      })
      .mockRejectedValueOnce(configError);

    const { result } = renderHook(() => useAgentManagement('session-1'));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      await expect(result.current.loadAgentConfiguration('agent-1')).rejects.toThrow(
        'Config load failed'
      );
    });

    expect(consoleSpy).toHaveBeenCalledWith('Error loading agent configuration:', configError);

    consoleSpy.mockRestore();
  });

  it('handles update agent errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const updateError = new Error('Update failed');
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSessionWithAgents),
      })
      .mockRejectedValueOnce(updateError);

    const { result } = renderHook(() => useAgentManagement('session-1'));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      await expect(
        result.current.updateAgent('agent-1', {
          name: 'Updated Agent',
          providerInstanceId: 'openai',
          modelId: 'gpt-4',
        })
      ).rejects.toThrow('Update failed');
    });

    expect(consoleSpy).toHaveBeenCalledWith('Error updating agent:', updateError);

    consoleSpy.mockRestore();
  });
});
