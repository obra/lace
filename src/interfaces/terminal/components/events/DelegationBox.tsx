// ABOUTME: Collapsible delegation box component for displaying delegate thread conversations
// ABOUTME: Shows delegation progress, events, and provides expand/collapse functionality

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { Timeline } from '../../../thread-processor.js';
import TimelineDisplay from './TimelineDisplay.js';
import { logger } from '../../../../utils/logger.js';
import { UI_SYMBOLS, UI_COLORS } from '../../theme.js';

interface DelegationBoxProps {
  threadId: string;
  timeline: Timeline;
  delegateTimelines?: Map<string, Timeline>;
  parentFocusId?: string; // Focus ID of the parent timeline for escape hierarchy
  onToggle?: () => void;
}

export function DelegationBox({ threadId, timeline, delegateTimelines, parentFocusId, onToggle }: DelegationBoxProps) {
  // Manage own expansion state
  const [expanded, setExpanded] = useState(true); // Default to expanded for delegation
  
  logger.debug('DelegationBox: Rendering', {
    threadId,
    expanded,
    timelineItemCount: timeline.items.length,
    hasDelegateTimelines: !!delegateTimelines
  });
  
  // Determine delegation status
  const isComplete = isThreadComplete(timeline);
  const taskDescription = extractTaskFromTimeline(timeline);
  const duration = calculateDuration(timeline);
  const tokens = calculateTokens(timeline);
  
  logger.debug('DelegationBox: Status calculated', {
    threadId,
    isComplete,
    taskDescription,
    duration,
    tokens: `↑${tokens.tokensIn} ↓${tokens.tokensOut}`
  });
  
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={isComplete ? "green" : "yellow"} padding={1} marginY={1}>
      {/* Header */}
      <Box justifyContent="space-between" marginBottom={expanded ? 1 : 0}>
        <Box>
          <Text color={UI_COLORS.DELEGATE}>{UI_SYMBOLS.DELEGATE} </Text>
          <Text color="gray">{threadId}</Text>
          <Text color="white"> ({taskDescription})</Text>
        </Box>
        <Box>
          {isComplete ? (
            <Text color={UI_COLORS.SUCCESS}>{UI_SYMBOLS.SUCCESS} Complete ({duration}) </Text>
          ) : (
            <Text color={UI_COLORS.PENDING}>{UI_SYMBOLS.WORKING} Working... ({duration}) </Text>
          )}
          <Text color="gray">{UI_SYMBOLS.TOKEN_IN}{formatTokenCount(tokens.tokensIn)} {UI_SYMBOLS.TOKEN_OUT}{formatTokenCount(tokens.tokensOut)} </Text>
          <Text color="cyan">
            {expanded ? `[${UI_SYMBOLS.COLLAPSE_HINT} Collapse]` : `[${UI_SYMBOLS.EXPAND_HINT} Expand]`}
          </Text>
        </Box>
      </Box>
      
      {/* Content */}
      {expanded && (
        <Box flexDirection="column" paddingLeft={2}>
          <TimelineDisplay 
            timeline={timeline} 
            delegateTimelines={delegateTimelines}
            focusId={`delegate-${threadId}`}
            parentFocusId={parentFocusId}
          />
        </Box>
      )}
    </Box>
  );
}

// Helper functions
function isThreadComplete(timeline: Timeline): boolean {
  const items = timeline.items;
  if (items.length === 0) return false;
  
  const lastItem = items[items.length - 1];
  
  // Consider complete if last item is an agent message and no pending tool calls
  if (lastItem.type === 'agent_message') {
    const pendingCalls = items
      .filter(item => item.type === 'tool_execution' && !('result' in item && item.result))
      .map(item => item.type === 'tool_execution' ? item.callId : '');
    
    return pendingCalls.length === 0;
  }
  
  return false;
}

function extractTaskFromTimeline(timeline: Timeline): string {
  // Look for task description in first agent message or system message
  const firstMessage = timeline.items.find(
    item => item.type === 'agent_message' || item.type === 'system_message'
  );
  
  if (firstMessage && 'content' in firstMessage) {
    const content = firstMessage.content;
    // Extract first sentence or first 50 characters
    const firstSentence = content.split('.')[0];
    return firstSentence.slice(0, 50) + (firstSentence.length > 50 ? '...' : '');
  }
  return 'Unknown Task';
}

function calculateDuration(timeline: Timeline): string {
  const items = timeline.items;
  if (items.length === 0) return '0s';
  
  const start = items[0].timestamp;
  const end = items[items.length - 1].timestamp;
  const seconds = Math.floor((end.getTime() - start.getTime()) / 1000);
  
  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
}

// Shared token estimation function to match main agent logic
function estimateTokens(text: string): number {
  // Rough approximation: 1 token ≈ 4 characters for most models
  return Math.ceil(text.length / 4);
}

function calculateTokens(timeline: Timeline): { tokensIn: number; tokensOut: number } {
  let tokensIn = 0;
  let tokensOut = 0;
  
  timeline.items.forEach(item => {
    // Use proper type guards instead of runtime 'content' checks
    if (item.type === 'user_message') {
      const userItem = item as Extract<Timeline['items'][0], { type: 'user_message' }>;
      tokensIn += estimateTokens(userItem.content);
    } else if (item.type === 'agent_message') {
      const agentItem = item as Extract<Timeline['items'][0], { type: 'agent_message' }>;
      tokensOut += estimateTokens(agentItem.content);
    } else if (item.type === 'tool_execution') {
      const toolItem = item as Extract<Timeline['items'][0], { type: 'tool_execution' }>;
      // Tool results count as input to the agent
      if (toolItem.result?.output && typeof toolItem.result.output === 'string') {
        tokensIn += estimateTokens(toolItem.result.output);
      }
    }
  });
  
  return { tokensIn, tokensOut };
}

function formatTokenCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return count.toString();
}