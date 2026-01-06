// ABOUTME: Hook for agent token usage tracking without polling
// ABOUTME: Loads token data from agent API + real-time updates from SSE events

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSessionEvents } from '@lace/web/components/providers/EventStreamProvider';
import type { ThreadId, ThreadTokenUsage } from '@lace/web/types/core';
import type { AppEvent } from '@lace/web/types/app-events';
import { isProtocolEvent, getAgentSessionId } from '@lace/web/types/app-events';
import type { AgentWithTokenUsage } from '@lace/web/types/api';
import { api } from '@lace/web/lib/api-client';
import { AbortError } from '@lace/web/lib/api-errors';

// Use the same type structure as the API
type AgentTokenUsage = ThreadTokenUsage;

export interface UseAgentTokenUsageResult {
  tokenUsage: AgentTokenUsage | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useAgentTokenUsage(agentId: ThreadId): UseAgentTokenUsageResult {
  const [tokenUsage, setTokenUsage] = useState<AgentTokenUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load initial token usage from agent API
  const fetchTokenUsage = useCallback(async () => {
    // Abort previous request to prevent race conditions
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      setLoading(true);
      setError(null);

      const data = await api.get<AgentWithTokenUsage>(`/api/agents/${agentId}`, {
        signal: controller.signal,
      });

      // If request was aborted, don't update state
      if (controller.signal.aborted) {
        return;
      }

      if (data.tokenUsage) {
        setTokenUsage(data.tokenUsage);
      }
    } catch (err) {
      // Check for both DOMException AbortError and our custom AbortError class
      if ((err instanceof DOMException && err.name === 'AbortError') || err instanceof AbortError) {
        // Abort is intentional when component unmounts or agentId changes
        // Don't log or set error state
        return;
      }

      console.error('[useAgentTokenUsage] Error fetching token usage:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch token usage');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  // Listen for protocol events with usage/context_window data
  const handleTokenUpdate = useCallback(
    (event: AppEvent) => {
      // Skip events not for this agent
      const eventAgentId = getAgentSessionId(event);
      if (eventAgentId !== agentId) {
        return;
      }

      // Handle ProtocolEvent with usage type
      if (isProtocolEvent(event) && event.update.type === 'usage') {
        const usageUpdate = event.update as {
          inputTokens?: number;
          outputTokens?: number;
          cacheRead?: number;
          cacheWrite?: number;
        };
        setTokenUsage((prev) => ({
          totalPromptTokens: (prev?.totalPromptTokens || 0) + (usageUpdate.inputTokens || 0),
          totalCompletionTokens:
            (prev?.totalCompletionTokens || 0) + (usageUpdate.outputTokens || 0),
          totalTokens:
            (prev?.totalTokens || 0) +
            (usageUpdate.inputTokens || 0) +
            (usageUpdate.outputTokens || 0),
          contextLimit: prev?.contextLimit || 0,
          percentUsed: prev?.percentUsed || 0,
          nearLimit: prev?.nearLimit || false,
        }));
        return;
      }

      // Handle ProtocolEvent with context_window type
      if (isProtocolEvent(event) && event.update.type === 'context_window') {
        const contextUpdate = event.update as {
          currentTokens?: number;
          limit?: number;
          percentUsed?: number;
          nearLimit?: boolean;
        };
        setTokenUsage((prev) => ({
          totalPromptTokens: contextUpdate.currentTokens ?? prev?.totalPromptTokens ?? 0,
          totalCompletionTokens: prev?.totalCompletionTokens || 0,
          totalTokens: contextUpdate.currentTokens ?? prev?.totalTokens ?? 0,
          contextLimit: contextUpdate.limit ?? prev?.contextLimit ?? 0,
          percentUsed: contextUpdate.percentUsed ?? prev?.percentUsed ?? 0,
          nearLimit: contextUpdate.nearLimit ?? prev?.nearLimit ?? false,
        }));
      }
    },
    [agentId]
  );

  // Use shared event stream context for real-time updates
  const { events } = useSessionEvents();

  // Find latest token-relevant event (usage or context_window ProtocolEvent) with O(1) reverse scan
  const latestTokenEvent = useMemo(() => {
    // Reverse scan to find the latest event with token data for this agent
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      const eventAgentId = getAgentSessionId(event);
      if (
        eventAgentId === agentId &&
        isProtocolEvent(event) &&
        (event.update.type === 'usage' || event.update.type === 'context_window')
      ) {
        return event;
      }
    }
    return null;
  }, [events, agentId]);

  // Handle latest token event for token updates
  useEffect(() => {
    if (latestTokenEvent) {
      handleTokenUpdate(latestTokenEvent);
    }
  }, [latestTokenEvent, handleTokenUpdate]);

  // Initial load on mount or agentId change
  useEffect(() => {
    void fetchTokenUsage();

    // Cleanup function to abort request on unmount
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [fetchTokenUsage]);

  return {
    tokenUsage,
    loading,
    error,
    refetch: fetchTokenUsage,
  };
}
