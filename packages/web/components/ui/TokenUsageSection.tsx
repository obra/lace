// ABOUTME: Token usage section component with loading, error and success states
// ABOUTME: Displays token usage data for a given agent with appropriate styling

'use client';

import React, { memo } from 'react';
import { TokenUsageDisplay } from '@/components/ui';
import { useAgentTokenUsage } from '@/hooks/useAgentTokenUsage';
import type { UseAgentTokenUsageResult } from '@/hooks/useAgentTokenUsage';
import type { ThreadId } from '@/types/core';

export const TokenUsageSection = memo(function TokenUsageSection({
  agentId,
}: {
  agentId: ThreadId;
}) {
  const usageResult: UseAgentTokenUsageResult = useAgentTokenUsage(agentId);

  if (usageResult.loading) {
    return (
      <div className="flex justify-center p-2 border-t border-base-300/50 bg-base-100/50 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-xs text-base-content/60">
          <div className="loading loading-spinner loading-xs" role="status"></div>
          <span className="animate-pulse-soft">Loading usage data...</span>
        </div>
      </div>
    );
  }

  if (usageResult.error) {
    return (
      <div className="flex justify-center p-2 border-t border-base-300/50 bg-base-100/50 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-xs text-error/80">
          <span>⚠️</span>
          <span>Could not load usage data</span>
        </div>
      </div>
    );
  }

  if (!usageResult.tokenUsage) {
    return (
      <div className="flex justify-center p-2 border-t border-base-300/50 bg-base-100/50 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-xs text-base-content/50">
          <span>📊</span>
          <span>No usage data yet</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-center p-2 border-t border-base-300/50 bg-base-100/50 backdrop-blur-sm">
      <TokenUsageDisplay tokenUsage={usageResult.tokenUsage} loading={usageResult.loading} />
    </div>
  );
});
