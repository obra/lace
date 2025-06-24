// ABOUTME: Status bar component showing system information and current state
// ABOUTME: Displays provider, model, token usage, thread ID and other key metrics

import React from 'react';
import { Text } from 'ink';
import useStdoutDimensions from '../../../utils/use-stdout-dimensions.js';
import { CurrentTurnMetrics } from '../../../agents/agent.js';

interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

interface StatusBarProps {
  providerName: string;
  modelName?: string;
  threadId?: string;
  tokenUsage?: TokenUsage;
  isProcessing?: boolean;
  messageCount?: number;
  isTurnActive?: boolean;
  turnMetrics?: CurrentTurnMetrics | null;
}

const StatusBar: React.FC<StatusBarProps> = ({
  providerName,
  modelName,
  threadId,
  tokenUsage,
  isProcessing = false,
  messageCount = 0,
  isTurnActive = false,
  turnMetrics = null,
}) => {
  // Format token usage for display
  const formatTokenUsage = (usage?: TokenUsage) => {
    if (!usage || !usage.totalTokens) {
      return "0 tokens";
    }
    
    if (usage.totalTokens > 1000) {
      return `${(usage.totalTokens / 1000).toFixed(1)}k tokens`;
    }
    
    return `${usage.totalTokens} tokens`;
  };

  // Format turn metrics for display
  const formatTurnMetrics = (metrics?: CurrentTurnMetrics | null) => {
    if (!metrics) return null;
    
    const elapsedSeconds = Math.floor(metrics.elapsedMs / 1000);
    const tokenDisplay = `↑${metrics.tokensIn} ↓${metrics.tokensOut}`;
    
    return `⏱️ ${elapsedSeconds}s • ${tokenDisplay}`;
  };

  // Format thread ID for display (don't truncate)
  const formatThreadId = (id?: string) => {
    if (!id) return "no-thread";
    return id;
  };

  // Use proper terminal dimensions hook
  const [currentWidth] = useStdoutDimensions();
  
  // Create content strings with turn-aware display
  const leftContent = `🧠 ${providerName}${modelName ? `:${modelName}` : ''} • 📁 ${formatThreadId(threadId)}`;
  
  // Right content shows turn progress when active, otherwise session info
  let rightContent: string;
  if (isTurnActive && turnMetrics) {
    rightContent = `${formatTurnMetrics(turnMetrics)} • ⚡ Processing`;
  } else {
    rightContent = `💬 ${messageCount} • ${formatTokenUsage(tokenUsage)} • ${isProcessing ? '⚡ Processing' : '✓ Ready'}`;
  }
  
  // Calculate padding needed to fill the terminal width
  const totalContentLength = leftContent.length + rightContent.length;
  const paddingNeeded = Math.max(0, currentWidth - totalContentLength - 2); // -2 for side padding
  const padding = ' '.repeat(paddingNeeded);

  return (
    <Text backgroundColor="blueBright" color="black">
      {' ' + leftContent + padding + rightContent + ' '}
    </Text>
  );
};

export default StatusBar;