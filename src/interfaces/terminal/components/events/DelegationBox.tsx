// ABOUTME: Collapsible delegation box component for displaying delegate thread conversations
// ABOUTME: Shows delegation progress, events, and provides expand/collapse functionality

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { Timeline } from '../../../thread-processor.js';
import TimelineDisplay from './TimelineDisplay.js';

interface DelegationBoxProps {
  threadId: string;
  timeline: Timeline;
  delegateTimelines?: Map<string, Timeline>;
}

export function DelegationBox({ threadId, timeline, delegateTimelines }: DelegationBoxProps) {
  const [expanded, setExpanded] = useState(true);
  
  // Determine delegation status
  const isComplete = isThreadComplete(timeline);
  const taskDescription = extractTaskFromTimeline(timeline);
  const duration = calculateDuration(timeline);
  const tokens = calculateTokens(timeline);
  
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={isComplete ? "green" : "yellow"} padding={1} marginY={1}>
      {/* Header */}
      <Box justifyContent="space-between" marginBottom={expanded ? 1 : 0}>
        <Box>
          <Text color="blue">🤖 </Text>
          <Text color="gray">{threadId}</Text>
          <Text color="white"> ({taskDescription})</Text>
        </Box>
        <Box>
          {isComplete ? (
            <Text color="green">✅ Complete ({duration}) </Text>
          ) : (
            <Text color="yellow">⚡ Working... ({duration}) </Text>
          )}
          <Text color="gray">↑{formatTokenCount(tokens.tokensIn)} ↓{formatTokenCount(tokens.tokensOut)} </Text>
          <Text color="cyan">
            {expanded ? '[▼ Collapse]' : '[▶ Expand]'}
          </Text>
        </Box>
      </Box>
      
      {/* Content */}
      {expanded && (
        <Box flexDirection="column" paddingLeft={2}>
          <TimelineDisplay 
            timeline={timeline} 
            delegateTimelines={delegateTimelines}
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