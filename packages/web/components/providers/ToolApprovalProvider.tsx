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
import type { SessionPendingApproval } from '@/types/api';
import { api } from '@/lib/api-client';
import { AbortError } from '@/lib/api-errors';
import type { ApprovalDecision } from '@/types/core';

// Types for tool approval context
interface ToolApprovalContextType {
  // Approval data
  pendingApprovals: SessionPendingApproval[];
  loading: boolean;

  // Approval actions
  handleApprovalRequest: (approval: SessionPendingApproval) => void;
  handleApprovalResponse: (toolCallId: string) => void;
  handleApprovalDecision: (toolCallId: string, decision: ApprovalDecision) => Promise<void>;
  clearApprovalRequest: () => void;
  refreshSessionPendingApprovals: () => Promise<void>;
}

const ToolApprovalContext = createContext<ToolApprovalContextType | null>(null);

interface ToolApprovalProviderProps {
  children: ReactNode;
  sessionId: ThreadId | null;
}

export function ToolApprovalProvider({ children, sessionId }: ToolApprovalProviderProps) {
  const [pendingApprovals, setSessionPendingApprovals] = useState<SessionPendingApproval[]>([]);
  const [loading, setLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Refresh pending approvals from API (session-wide)
  const refreshSessionPendingApprovals = useCallback(async () => {
    if (!sessionId) {
      setSessionPendingApprovals([]);
      return;
    }

    setLoading(true);
    try {
      // Abort any in-flight request before starting a new one
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const data = await api.get<SessionPendingApproval[]>(
        `/api/sessions/${sessionId}/approvals/pending`,
        {
          signal: controller.signal,
        }
      );

      if (Array.isArray(data)) {
        setSessionPendingApprovals(data);
      } else {
        setSessionPendingApprovals([]);
      }
    } catch (error) {
      if (error instanceof AbortError) return;
      console.error('[TOOL_APPROVAL] Failed to fetch pending approvals:', error);
      setSessionPendingApprovals([]);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  // Handle approval requests (triggered by event stream)
  const handleApprovalRequest = useCallback(
    (_approval: SessionPendingApproval) => {
      // When we get a new approval request, refresh the pending approvals
      // to get the most up-to-date data from the API with tool metadata
      void refreshSessionPendingApprovals();
    },
    [refreshSessionPendingApprovals]
  );

  // Handle approval responses (remove from pending list)
  const handleApprovalResponse = useCallback((toolCallId: string) => {
    setSessionPendingApprovals((prev) => prev.filter((p) => p.toolCallId !== toolCallId));
  }, []);

  // Handle approval decision and submit to API (session-scoped)
  const handleApprovalDecision = useCallback(
    async (toolCallId: string, decision: ApprovalDecision) => {
      if (!sessionId) return;

      try {
        await api.post(`/api/sessions/${sessionId}/approvals/${encodeURIComponent(toolCallId)}`, {
          decision,
        });

        // Remove the approval from pending list after successful submission
        handleApprovalResponse(toolCallId);
      } catch (error) {
        console.error('[TOOL_APPROVAL] Failed to submit approval decision:', error);
      }
    },
    [sessionId, handleApprovalResponse]
  );

  // Clear all approval requests
  const clearApprovalRequest = useCallback(() => {
    setSessionPendingApprovals([]);
  }, []);

  // Load pending approvals when session changes
  useEffect(() => {
    if (!sessionId) {
      setSessionPendingApprovals([]);
      return;
    }

    void refreshSessionPendingApprovals();
  }, [sessionId, refreshSessionPendingApprovals]);

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
      refreshSessionPendingApprovals,
    }),
    [
      pendingApprovals,
      loading,
      handleApprovalRequest,
      handleApprovalResponse,
      handleApprovalDecision,
      clearApprovalRequest,
      refreshSessionPendingApprovals,
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
