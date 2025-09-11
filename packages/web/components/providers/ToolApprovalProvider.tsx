// ABOUTME: Context provider for shared tool approval state across the app
// ABOUTME: Manages tool approval workflows and provides approval actions

'use client';

import React, {
  createContext,
  useContext,
  useMemo,
  useCallback,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import type { ThreadId } from '@/types/core';
import type { PendingApproval } from '@/types/api';
import { api } from '@/lib/api-client';
import { AbortError } from '@/lib/api-errors';
import type { ApprovalDecision } from '@/types/core';

// Types for tool approval context
interface ToolApprovalContextType {
  // Approval data
  pendingApprovals: PendingApproval[];
  loading: boolean;

  // Approval actions
  handleApprovalRequest: (approval: PendingApproval) => void;
  handleApprovalResponse: (toolCallId: string) => void;
  handleApprovalDecision: (toolCallId: string, decision: ApprovalDecision) => Promise<void>;
  clearApprovalRequest: () => void;
  refreshPendingApprovals: () => Promise<void>;
}

const ToolApprovalContext = createContext<ToolApprovalContextType | null>(null);

interface ToolApprovalProviderProps {
  children: ReactNode;
  agentId: ThreadId | null;
}

export function ToolApprovalProvider({ children, agentId }: ToolApprovalProviderProps) {
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Refresh pending approvals from API
  const refreshPendingApprovals = useCallback(async () => {
    if (!agentId) {
      setPendingApprovals([]);
      return;
    }

    setLoading(true);
    try {
      // Abort any in-flight request before starting a new one
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const data = await api.get<PendingApproval[]>(`/api/threads/${agentId}/approvals/pending`, {
        signal: controller.signal,
      });

      if (Array.isArray(data)) {
        setPendingApprovals(data);
      } else {
        setPendingApprovals([]);
      }
    } catch (error) {
      if (error instanceof AbortError) return;
      console.error('[TOOL_APPROVAL] Failed to fetch pending approvals:', error);
      setPendingApprovals([]);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  // Handle approval requests (triggered by event stream)
  const handleApprovalRequest = useCallback(
    (_approval: PendingApproval) => {
      // When we get a new approval request, refresh the pending approvals
      // to get the most up-to-date data from the API with tool metadata
      void refreshPendingApprovals();
    },
    [refreshPendingApprovals]
  );

  // Handle approval responses (remove from pending list)
  const handleApprovalResponse = useCallback((toolCallId: string) => {
    setPendingApprovals((prev) => prev.filter((p) => p.toolCallId !== toolCallId));
  }, []);

  // Handle approval decision and submit to API
  const handleApprovalDecision = useCallback(
    async (toolCallId: string, decision: ApprovalDecision) => {
      if (!agentId) return;

      try {
        await api.post(`/api/threads/${agentId}/approvals/${encodeURIComponent(toolCallId)}`, {
          decision,
        });

        // Remove the approval from pending list after successful submission
        handleApprovalResponse(toolCallId);
      } catch (error) {
        console.error('[TOOL_APPROVAL] Failed to submit approval decision:', error);
      }
    },
    [agentId, handleApprovalResponse]
  );

  // Clear all approval requests
  const clearApprovalRequest = useCallback(() => {
    setPendingApprovals([]);
  }, []);

  // Load pending approvals when agent changes
  useEffect(() => {
    if (!agentId) {
      setPendingApprovals([]);
      return;
    }

    void refreshPendingApprovals();
  }, [agentId, refreshPendingApprovals]);

  const value: ToolApprovalContextType = useMemo(
    () => ({
      // Approval data
      pendingApprovals,
      loading,

      // Approval actions
      handleApprovalRequest,
      handleApprovalResponse,
      handleApprovalDecision,
      clearApprovalRequest,
      refreshPendingApprovals,
    }),
    [
      pendingApprovals,
      loading,
      handleApprovalRequest,
      handleApprovalResponse,
      handleApprovalDecision,
      clearApprovalRequest,
      refreshPendingApprovals,
    ]
  );

  return <ToolApprovalContext.Provider value={value}>{children}</ToolApprovalContext.Provider>;
}

// Hook to use tool approval context
export function useToolApprovalContext(): ToolApprovalContextType {
  const context = useContext(ToolApprovalContext);
  if (!context) {
    throw new Error('useToolApprovalContext must be used within a ToolApprovalProvider');
  }
  return context;
}
