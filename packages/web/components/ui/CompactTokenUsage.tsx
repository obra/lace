// ABOUTME: Compact token usage display component for tight spaces
// ABOUTME: Shows token usage data in minimal format, hides errors gracefully

'use client';

import React, { memo, useState } from 'react';
import { TokenUsageDisplay } from '@/components/ui';
import { useAgentTokenUsage } from '@/hooks/useAgentTokenUsage';
import type { UseAgentTokenUsageResult } from '@/hooks/useAgentTokenUsage';
import type { ThreadId } from '@/types/core';
import { ContextBreakdownModal } from '@/components/modals/ContextBreakdownModal';

export const CompactTokenUsage = memo(function CompactTokenUsage({
  agentId,
}: {
  agentId: ThreadId;
}) {
  const usageResult: UseAgentTokenUsageResult = useAgentTokenUsage(agentId);
  const [isModalOpen, setIsModalOpen] = useState(false);

  if (usageResult.loading) {
    return (
      <div className="text-xs text-base-content/40 flex items-center gap-1">
        <div className="loading loading-spinner loading-xs" role="status"></div>
        <span>Loading usage...</span>
      </div>
    );
  }

  if (usageResult.error || !usageResult.tokenUsage) {
    return null; // Don't show errors in compact view
  }

  return (
    <>
      <button
        className="text-xs text-base-content/40 hover:text-base-content/70 transition-colors cursor-pointer"
        onClick={() => setIsModalOpen(true)}
        title="View context breakdown"
      >
        <TokenUsageDisplay tokenUsage={usageResult.tokenUsage} loading={false} />
      </button>

      <ContextBreakdownModal
        agentId={agentId}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
});
