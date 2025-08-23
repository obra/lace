// ABOUTME: Tests for useAgentManagement hook
// ABOUTME: Validates agent creation, selection, and state management operations

import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionInfo, ThreadId } from '@/types/core';
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
    mockParseResponse.mockImplementation(async (res: Response) => {
      if (!res || typeof res.text !== 'function') {
        return Promise.resolve(null);
      }
      const text = await res.text();
      return JSON.parse(text);
    });
  });

  it('loads session details when session is selected', async () => {
    const mockResponse = {
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockSessionWithAgents)),
      clone: function () {
        return this;
      },
    } as Response;
    mockFetch.mockResolvedValueOnce(mockResponse);
    mockParseResponse.mockResolvedValueOnce(mockSessionWithAgents);

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
    const mockSessionResponse = {
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockSessionWithAgents)),
      clone: function () {
        return this;
      },
    } as Response;
    const mockCreateResponse = {
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ threadId: 'new-agent' })),
      clone: function () {
        return this;
      },
    } as Response;
    const updatedSession = {
      ...mockSessionWithAgents,
      agents: [...mockSessionWithAgents.agents!, { threadId: 'new-agent', name: 'New Agent' }],
    };
    const mockUpdatedResponse = {
      ok: true,
      text: () => Promise.resolve(JSON.stringify(updatedSession)),
      clone: function () {
        return this;
      },
    } as Response;

    mockFetch
      .mockResolvedValueOnce(mockSessionResponse)
      .mockResolvedValueOnce(mockCreateResponse)
      .mockResolvedValueOnce(mockUpdatedResponse);

    mockParseResponse
      .mockResolvedValueOnce(mockSessionWithAgents)
      .mockResolvedValueOnce({ threadId: 'new-agent' })
      .mockResolvedValueOnce(updatedSession);

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
    const mockResponse = {
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockSessionWithAgents)),
      clone: function () {
        return this;
      },
    } as Response;
    mockFetch.mockResolvedValueOnce(mockResponse);
    mockParseResponse.mockResolvedValueOnce(mockSessionWithAgents);

    const { result } = renderHook(() => useAgentManagement('session-1'));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    act(() => {
      result.current.updateAgentState('agent-1', 'thinking');
    });

    expect(result.current.sessionDetails?.agents?.[0]?.status).toBe('thinking');
  });

  it('handles agent state changes when session details exist', async () => {
    const mockResponse = {
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockSessionWithAgents)),
      clone: function () {
        return this;
      },
    } as Response;
    mockFetch.mockResolvedValueOnce(mockResponse);
    mockParseResponse.mockResolvedValueOnce(mockSessionWithAgents);

    const { result } = renderHook(() => useAgentManagement('session-1'));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Update agent state
    act(() => {
      result.current.updateAgentState('agent-1', 'streaming');
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
    expect(consoleSpy).toHaveBeenCalledWith('Failed to load session details:', expect.any(Error));

    consoleSpy.mockRestore();
  });

  it('handles create agent errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const createError = new Error('Create failed');
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockSessionWithAgents)),
        clone: function () {
          return this;
        },
      } as Response)
      .mockRejectedValueOnce(createError);

    mockParseResponse.mockResolvedValueOnce(mockSessionWithAgents);

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

  it('handles create agent HTTP errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockSessionWithAgents)),
        clone: function () {
          return this;
        },
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve(JSON.stringify({ error: 'Agent creation failed' })),
        clone: function () {
          return this;
        },
      } as Response);

    mockParseResponse
      .mockResolvedValueOnce(mockSessionWithAgents)
      .mockResolvedValueOnce({ error: 'Agent creation failed' });

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
    const mockSessionResponse = {
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockSessionWithAgents)),
      clone: function () {
        return this;
      },
    } as Response;
    mockFetch.mockResolvedValueOnce(mockSessionResponse).mockRejectedValueOnce(configError);
    mockParseResponse.mockResolvedValueOnce(mockSessionWithAgents);

    const { result } = renderHook(() => useAgentManagement('session-1'));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      await expect(result.current.loadAgentConfiguration('agent-1')).rejects.toThrow(
        'Config load failed'
      );
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Error loading agent configuration:',
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  it('handles update agent errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const updateError = new Error('Update failed');
    const mockSessionResponse = {
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockSessionWithAgents)),
      clone: function () {
        return this;
      },
    } as Response;
    mockFetch.mockResolvedValueOnce(mockSessionResponse).mockRejectedValueOnce(updateError);
    mockParseResponse.mockResolvedValueOnce(mockSessionWithAgents);

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

    expect(consoleSpy).toHaveBeenCalledWith('Error updating agent:', expect.any(Error));

    consoleSpy.mockRestore();
  });
});
