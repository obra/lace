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
  type ReactNode,
} from 'react';
import type { ThreadId } from '@/types/core';
import type { PendingApproval } from '@/types/api';
import { parse } from '@/lib/serialization';

// Types for tool approval context
interface ToolApprovalContextType {
  // Approval data
  pendingApprovals: PendingApproval[];
  loading: boolean;

  // Approval actions
  handleApprovalRequest: (approval: PendingApproval) => void;
  handleApprovalResponse: (toolCallId: string) => void;
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

  // Refresh pending approvals from API
  const refreshPendingApprovals = useCallback(async () => {
    if (!agentId) {
      setPendingApprovals([]);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/threads/${agentId}/approvals/pending`);
      const text = await res.text();
      const data = (await parse(text)) as PendingApproval[];

      if (data?.length > 0) {
        const approvals = data.map((approval: PendingApproval) => ({
          toolCallId: approval.toolCallId,
          toolCall: approval.toolCall,
          requestedAt: approval.requestedAt,
          requestData: approval.requestData,
        }));
        setPendingApprovals(approvals);
      } else {
        setPendingApprovals([]);
      }
    } catch (error) {
      console.error('[TOOL_APPROVAL] Failed to fetch pending approvals:', error);
      setPendingApprovals([]);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  // Handle approval requests (triggered by event stream)
  const handleApprovalRequest = useCallback(
    (approval: PendingApproval) => {
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

  const value: ToolApprovalContextType = {
    // Approval data
    pendingApprovals,
    loading,

    // Approval actions
    handleApprovalRequest,
    handleApprovalResponse,
    clearApprovalRequest,
    refreshPendingApprovals,
  };

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
