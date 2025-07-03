// ABOUTME: Status bar component showing system information and current state
// ABOUTME: Displays provider, model, token usage, thread ID and other key metrics

import React from 'react';
import { Text, Box } from 'ink';
import useStdoutDimensions from '../../../utils/use-stdout-dimensions.js';
import { CurrentTurnMetrics } from '../../../agents/agent.js';
import { UI_SYMBOLS } from '../theme.js';
import type { ProjectContext } from '../hooks/use-project-context.js';

interface CumulativeTokens {
  promptTokens: number;      // Current context size
  completionTokens: number;   // Total completion tokens
  totalTokens: number;        // Actual total tokens used
  contextGrowth?: number;     // How much context has grown
  lastPromptTokens?: number;  // For delta calculation
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
  projectContext?: ProjectContext;
  contextWindow?: number;  // Provider's context window limit
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
  projectContext,
  contextWindow,
}) => {
  // Format cumulative session tokens for display with context awareness
  const formatCumulativeTokens = (tokens?: CumulativeTokens, contextLimit?: number) => {
    if (!tokens || tokens.totalTokens === 0) {
      return `${UI_SYMBOLS.TOKEN_IN}0 ${UI_SYMBOLS.TOKEN_OUT}0`;
    }

    const formatCount = (count: number) => {
      if (count >= 1000) {
        return `${(count / 1000).toFixed(1)}k`;
      }
      return count.toString();
    };

    let contextDisplay = `${UI_SYMBOLS.TOKEN_IN}${formatCount(tokens.promptTokens)}`;
    
    // Add context percentage if we know the limit
    if (contextLimit && contextLimit > 0) {
      const percentage = Math.floor((tokens.promptTokens / contextLimit) * 100);
      const warningLevel = percentage >= 90 ? ' 🚨' : percentage >= 75 ? ' ⚠️' : '';
      contextDisplay += `/${formatCount(contextLimit)} (${percentage}%${warningLevel})`;
    }

    return `${contextDisplay} ${UI_SYMBOLS.TOKEN_OUT}${formatCount(tokens.completionTokens)}`;
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

    const tokenDisplay = `${UI_SYMBOLS.TOKEN_IN}${formatTokenCount(metrics.tokensIn)} ${UI_SYMBOLS.TOKEN_OUT}${formatTokenCount(metrics.tokensOut)}`;

    return `${UI_SYMBOLS.TIME} ${duration} • ${tokenDisplay}`;
  };

  // Format thread ID for display (don't truncate)
  const formatThreadId = (id?: string) => {
    if (!id) return 'no-thread';
    return id;
  };

  // Format project context for display
  const formatProjectContext = (context?: ProjectContext) => {
    if (!context) return null;

    // Left content: path
    const leftContent = context.displayPath;

    // Right content: git information
    let rightContent = '';
    
    if (context.isGitRepo && context.gitStatus) {
      const { gitStatus } = context;
      const rightParts: string[] = [];
      
      // Add branch name if available
      if (gitStatus.branch) {
        rightParts.push(`${UI_SYMBOLS.GIT_BRANCH} ${gitStatus.branch}`);
      }

      // Add git status counts (only non-zero)
      const statusParts: string[] = [];
      if (gitStatus.staged > 0) statusParts.push(`${gitStatus.staged}${UI_SYMBOLS.GIT_STAGED}`);
      if (gitStatus.modified > 0) statusParts.push(`${gitStatus.modified}${UI_SYMBOLS.GIT_MODIFIED}`);
      if (gitStatus.deleted > 0) statusParts.push(`${gitStatus.deleted}${UI_SYMBOLS.GIT_DELETED}`);
      if (gitStatus.untracked > 0) statusParts.push(`${gitStatus.untracked}${UI_SYMBOLS.GIT_UNTRACKED}`);

      if (statusParts.length > 0) {
        rightParts.push(statusParts.join(' '));
      }

      rightContent = rightParts.join(` ${UI_SYMBOLS.PATH_SEP} `);
    } else if (context.error) {
      // Show error indicator for git errors
      rightContent = UI_SYMBOLS.GIT_ERROR;
    }

    return { leftContent, rightContent };
  };

  // Use proper terminal dimensions hook
  const [currentWidth] = useStdoutDimensions();

  // Create content strings with turn-aware display
  const leftContent = `${UI_SYMBOLS.PROVIDER} ${providerName}${modelName ? `:${modelName}` : ''} • ${UI_SYMBOLS.FOLDER} ${formatThreadId(threadId)}`;

  // Right content shows turn progress when active, otherwise session info with cumulative tokens
  let rightContent: string;
  if (isTurnActive && turnMetrics) {
    rightContent = `${formatTurnMetrics(turnMetrics)} • ${UI_SYMBOLS.LIGHTNING} Processing`;
  } else {
    rightContent = `${UI_SYMBOLS.MESSAGE} ${messageCount} • ${formatCumulativeTokens(cumulativeTokens, contextWindow)} • ${isProcessing ? UI_SYMBOLS.LIGHTNING + ' Processing' : UI_SYMBOLS.READY + ' Ready'}`;
  }

  // Format project context row if available
  const projectContextData = formatProjectContext(projectContext);

  if (projectContextData) {
    // Two-row layout with project context
    
    // Row 1: Original status bar
    const row1TotalLength = leftContent.length + rightContent.length;
    const availableSpace = currentWidth - 3; // Account for leading/trailing spaces + terminal wrapping buffer
    
    let row1LeftContent = leftContent;
    let row1RightContent = rightContent;
    
    // If content is too long, truncate to fit
    if (row1TotalLength > availableSpace) {
      const leftPriority = Math.floor(availableSpace * 0.6); // Give 60% to left content
      const rightPriority = availableSpace - leftPriority;
      
      if (leftContent.length > leftPriority) {
        row1LeftContent = leftContent.substring(0, leftPriority - 3) + '...';
      }
      if (rightContent.length > rightPriority) {
        row1RightContent = '...' + rightContent.substring(rightContent.length - rightPriority + 3);
      }
    }
    
    const row1ActualLength = row1LeftContent.length + row1RightContent.length;
    const row1Padding = Math.max(0, availableSpace - row1ActualLength);
    const row1PaddingStr = ' '.repeat(row1Padding);

    // Row 2: Project context with left/right layout like row 1
    let row2LeftContent = projectContextData.leftContent;
    let row2RightContent = projectContextData.rightContent;
    const row2TotalLength = row2LeftContent.length + row2RightContent.length;
    
    // If content is too long, truncate to fit
    if (row2TotalLength > availableSpace) {
      const leftPriority = Math.floor(availableSpace * 0.7); // Give 70% to path (left content)
      const rightPriority = availableSpace - leftPriority;
      
      if (row2LeftContent.length > leftPriority) {
        row2LeftContent = row2LeftContent.substring(0, leftPriority - 3) + '...';
      }
      if (row2RightContent.length > rightPriority) {
        row2RightContent = '...' + row2RightContent.substring(row2RightContent.length - rightPriority + 3);
      }
    }
    
    const row2ActualLength = row2LeftContent.length + row2RightContent.length;
    const row2Padding = Math.max(0, availableSpace - row2ActualLength);
    const row2PaddingStr = ' '.repeat(row2Padding);

    return (
      <Box flexDirection="column">
        <Text backgroundColor="blueBright" color="black">
          {' ' + row1LeftContent + row1PaddingStr + row1RightContent + ' '}
        </Text>
        <Text backgroundColor="blueBright" color="black">
          {' ' + row2LeftContent + row2PaddingStr + row2RightContent + ' '}
        </Text>
      </Box>
    );
  } else {
    // Single-row layout (original behavior)
    const totalContentLength = leftContent.length + rightContent.length;
    const availableSpace = currentWidth - 3; // Account for leading/trailing spaces + terminal wrapping buffer
    
    let finalLeftContent = leftContent;
    let finalRightContent = rightContent;
    
    // If content is too long, truncate to fit
    if (totalContentLength > availableSpace) {
      const leftPriority = Math.floor(availableSpace * 0.6); // Give 60% to left content
      const rightPriority = availableSpace - leftPriority;
      
      if (leftContent.length > leftPriority) {
        finalLeftContent = leftContent.substring(0, leftPriority - 3) + '...';
      }
      if (rightContent.length > rightPriority) {
        finalRightContent = '...' + rightContent.substring(rightContent.length - rightPriority + 3);
      }
    }
    
    const finalContentLength = finalLeftContent.length + finalRightContent.length;
    const paddingNeeded = Math.max(0, availableSpace - finalContentLength);
    const padding = ' '.repeat(paddingNeeded);

    return (
      <Text backgroundColor="blueBright" color="black">
        {' ' + finalLeftContent + padding + finalRightContent + ' '}
      </Text>
    );
  }
};

export default StatusBar;
