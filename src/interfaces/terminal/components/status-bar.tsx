// ABOUTME: Status bar component showing system information and current state
// ABOUTME: Displays provider, model, token usage, thread ID and other key metrics

import React from 'react';
import { Text } from 'ink';
import useStdoutDimensions from '../../../utils/use-stdout-dimensions.js';
import { CurrentTurnMetrics } from '../../../agents/agent.js';

interface CumulativeTokens {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface StatusBarProps {
  providerName: string;
  modelName?: string;
  threadId?: string;
  cumulativeTokens?: CumulativeTokens;
  isProcessing?: boolean;
  messageCount?: number;
  isTurnActive?: boolean;
  turnMetrics?: CurrentTurnMetrics | null;
}

const StatusBar: React.FC<StatusBarProps> = ({
  providerName,
  modelName,
  threadId,
  cumulativeTokens,
  isProcessing = false,
  messageCount = 0,
  isTurnActive = false,
  turnMetrics = null,
}) => {
  // Format cumulative session tokens for display
  const formatCumulativeTokens = (tokens?: CumulativeTokens) => {
    if (!tokens || tokens.totalTokens === 0) {
      return "↑0 ↓0";
    }
    
    const formatCount = (count: number) => {
      if (count >= 1000) {
        return `${(count / 1000).toFixed(1)}k`;
      }
      return count.toString();
    };
    
    return `↑${formatCount(tokens.promptTokens)} ↓${formatCount(tokens.completionTokens)}`;
  };

  // Format turn metrics for display
  const formatTurnMetrics = (metrics?: CurrentTurnMetrics | null) => {
    if (!metrics) return null;
    
    const elapsedSeconds = Math.floor(metrics.elapsedMs / 1000);
    
    // Format duration for readability
    let duration: string;
    if (elapsedSeconds >= 60) {
      const minutes = Math.floor(elapsedSeconds / 60);
      const remainingSeconds = elapsedSeconds % 60;
      duration = `${minutes}m ${remainingSeconds}s`;
    } else {
      duration = `${elapsedSeconds}s`;
    }
    
    // Format tokens with k suffix for large numbers
    const formatTokenCount = (count: number) => {
      if (count >= 1000) {
        return `${(count / 1000).toFixed(1)}k`;
      }
      return count.toString();
    };
    
    const tokenDisplay = `↑${formatTokenCount(metrics.tokensIn)} ↓${formatTokenCount(metrics.tokensOut)}`;
    
    return `⏱️ ${duration} • ${tokenDisplay}`;
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
  
  // Right content shows turn progress when active, otherwise session info with cumulative tokens
  let rightContent: string;
  if (isTurnActive && turnMetrics) {
    rightContent = `${formatTurnMetrics(turnMetrics)} • ⚡ Processing`;
  } else {
    rightContent = `💬 ${messageCount} • ${formatCumulativeTokens(cumulativeTokens)} • ${isProcessing ? '⚡ Processing' : '✓ Ready'}`;
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