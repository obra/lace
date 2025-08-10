'use client';

import { Badge, StatusDot } from '@/components/ui';

export interface TokenUsageData {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  contextLimit: number;
  percentUsed: number;
  nearLimit: boolean;
  eventCount: number;
  lastCompactionAt?: Date;
}

interface TokenUsageDisplayProps {
  tokenUsage: TokenUsageData | null;
  loading?: boolean;
  className?: string;
}

export default function TokenUsageDisplay({ 
  tokenUsage, 
  loading = false, 
  className = '' 
}: TokenUsageDisplayProps) {
  if (loading || !tokenUsage) {
    return (
      <div className={`flex items-center justify-between text-xs text-base-content/60 py-2 ${className}`}>
        <div className="flex items-center gap-2">
          <StatusDot status="info" size="xs" pulse />
          <span>Loading token usage...</span>
        </div>
      </div>
    );
  }

  const formatTokenCount = (tokens: number): string => {
    if (tokens < 1000) return tokens.toString();
    if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`;
    return `${(tokens / 1000000).toFixed(1)}M`;
  };

  const getUsageStatus = (percentUsed: number) => {
    if (percentUsed >= 90) return { status: 'error' as const, label: 'Critical' };
    if (percentUsed >= 75) return { status: 'warning' as const, label: 'High' };
    if (percentUsed >= 50) return { status: 'info' as const, label: 'Moderate' };
    return { status: 'success' as const, label: 'Low' };
  };

  const getCompactionDistance = (percentUsed: number): string => {
    // Assume auto-compaction triggers at 80%
    const compactionThreshold = 80;
    if (percentUsed >= compactionThreshold) {
      return 'Auto-compaction ready';
    }
    const remaining = compactionThreshold - percentUsed;
    return `${remaining.toFixed(0)}% until auto-compaction`;
  };

  const usageStatus = getUsageStatus(tokenUsage.percentUsed);
  const compactionDistance = getCompactionDistance(tokenUsage.percentUsed);

  return (
    <div className={`flex items-center justify-between text-xs text-base-content/70 py-2 px-1 ${className}`}>
      {/* Left side: Token usage */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <StatusDot 
            status={usageStatus.status} 
            size="xs"
            pulse={tokenUsage.nearLimit}
          />
          <span className="font-medium">
            {formatTokenCount(tokenUsage.totalTokens)} tokens
          </span>
          <Badge variant={usageStatus.status} size="xs">
            {tokenUsage.percentUsed.toFixed(0)}%
          </Badge>
        </div>
        
        {/* Context limit indicator */}
        <span className="text-base-content/50">
          of {formatTokenCount(tokenUsage.contextLimit)}
        </span>
      </div>

      {/* Right side: Compaction status */}
      <div className="flex items-center gap-2">
        {tokenUsage.lastCompactionAt && (
          <span className="text-base-content/50">
            Last compacted: {tokenUsage.lastCompactionAt.toLocaleTimeString()}
          </span>
        )}
        <span className={`text-base-content/60 ${tokenUsage.percentUsed >= 80 ? 'text-warning' : ''}`}>
          {compactionDistance}
        </span>
      </div>
    </div>
  );
}