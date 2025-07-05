// ABOUTME: Renderer for delegate tool executions using TimelineEntry
// ABOUTME: Displays delegation with thread information and completion status

import React, { forwardRef, useImperativeHandle, useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { TimelineEntry, TimelineStatus } from '../../ui/TimelineEntry.js';
import { useTimelineItem } from '../contexts/TimelineItemContext.js';
import { type ToolRendererProps } from './components/shared.js';
import { TimelineItemRef } from '../../timeline-item-focus.js';
import { formatTokenCount } from '../../../../../utils/token-estimation.js';
import { UI_SYMBOLS, UI_COLORS } from '../../../theme.js';
import { useInput } from 'ink';
import { useLaceFocus, FocusRegions } from '../../../focus/index.js';
import { useTimelineItemFocusEntry } from '../hooks/useTimelineExpansionToggle.js';
import { logger } from '../../../../../utils/logger.js';

// Parse delegate result to extract structured data
interface DelegateResult {
  threadId?: string;
  status?: 'active' | 'completed' | 'error';
  summary?: string;
  totalTokens?: number;
  error?: string;
}

function parseDelegateResult(result: any): DelegateResult | null {
  if (!result?.content?.[0]?.text) {
    logger.debug('DelegateToolRenderer: No content in result');
    return null;
  }
  
  try {
    const text = result.content[0].text;
    
    // Try to parse as JSON first
    if (text.trim().startsWith('{')) {
      const parsed = JSON.parse(text);
      
      // Validate structure
      if (typeof parsed !== 'object' || parsed === null) {
        logger.warn('DelegateToolRenderer: Parsed result is not an object', { parsed });
        return { error: text };
      }
      
      // Validate optional fields have correct types if present
      if (parsed.threadId !== undefined && typeof parsed.threadId !== 'string') {
        logger.warn('DelegateToolRenderer: Invalid threadId type', { threadId: parsed.threadId });
      }
      
      if (parsed.status !== undefined && 
          !['active', 'completed', 'error'].includes(parsed.status)) {
        logger.warn('DelegateToolRenderer: Invalid status value', { status: parsed.status });
      }
      
      if (parsed.totalTokens !== undefined && typeof parsed.totalTokens !== 'number') {
        logger.warn('DelegateToolRenderer: Invalid totalTokens type', { totalTokens: parsed.totalTokens });
      }
      
      return parsed as DelegateResult;
    }
    
    // Otherwise return as error text
    return { error: text };
  } catch (error) {
    logger.warn('DelegateToolRenderer: Failed to parse delegate result JSON', {
      error: error instanceof Error ? error.message : String(error),
      content: result.content[0].text?.slice(0, 200) + '...'
    });
    return { error: result.content[0].text };
  }
}

export const DelegateToolRenderer = forwardRef<TimelineItemRef, ToolRendererProps>(({
  item,
}, ref) => {
  const { isExpanded, isSelected } = useTimelineItem();
  
  // Extract and validate data
  const args = item.call.arguments as Record<string, unknown>;
  
  // Get task from either task or prompt argument
  let task: string;
  if (typeof args.task === 'string') {
    task = args.task;
  } else if (typeof args.prompt === 'string') {
    task = args.prompt;
  } else {
    logger.warn('DelegateToolRenderer: No valid task or prompt argument', { 
      args, 
      callId: item.call.id 
    });
    task = 'Unknown task';
  }
  
  const delegateResult = item.result ? parseDelegateResult(item.result) : null;
  const hasError = item.result?.isError || delegateResult?.status === 'error';
  const isRunning = !item.result;
  
  // Determine status
  const status: TimelineStatus = isRunning ? 'pending' : hasError ? 'error' : 'success';
  
  // Delegation-specific state
  const [isEntered, setIsEntered] = useState(false);
  const delegateThreadId = delegateResult?.threadId || null;
  const focusId = delegateThreadId ? FocusRegions.delegate(delegateThreadId) : 'none';
  const { isFocused } = useLaceFocus(focusId, { autoFocus: false });
  const [delegationExpanded, setDelegationExpanded] = useState(true);
  
  // Handle keyboard input when focused
  useInput(
    (input: string, key: { escape?: boolean }) => {
      if (!isFocused) return;

      if (key.escape) {
        logger.debug('DelegateToolRenderer: Escape pressed, exiting delegate focus');
        setIsEntered(false);
        return;
      }
    },
    { isActive: isFocused }
  );

  // Handle focus entry
  const handleFocusEntry = useCallback(() => {
    logger.debug('DelegateToolRenderer: handleFocusEntry called', {
      delegateThreadId,
    });
    if (delegateThreadId) {
      setIsEntered(true);
    }
  }, [delegateThreadId]);

  // Listen for focus entry events
  useTimelineItemFocusEntry(isSelected, handleFocusEntry);
  
  // Expose enterFocus method through ref
  useImperativeHandle(ref, () => ({
    enterFocus: () => {
      logger.debug('DelegateToolRenderer: enterFocus called via ref', {
        delegateThreadId,
        currentIsEntered: isEntered,
      });
      if (delegateThreadId) {
        setIsEntered(true);
      }
    },
  }), [delegateThreadId, isEntered]);
  
  // Build header with task and delegation indicator
  const header = (
    <Box>
      <Text color={UI_COLORS.TOOL} bold>delegate</Text>
      <Text>: "{task}"</Text>
      <Text color="cyan"> [DELEGATE]</Text>
    </Box>
  );
  
  // Build preview content 
  const preview = delegateResult && item.result && !isRunning ? (() => {
    return (
      <Box flexDirection="column">
        {/* Show delegation status info */}
        {delegateThreadId && (
          <Box>
            <Text color={UI_COLORS.DELEGATE}>{UI_SYMBOLS.DELEGATE} </Text>
            <Text color="gray">Thread: {delegateThreadId}</Text>
            {delegateResult?.status === 'active' && (
              <Text color={UI_COLORS.SUCCESS}> - Delegation active</Text>
            )}
          </Box>
        )}
        
        {/* Show result or error */}
        {delegateResult.error ? (
          <Text color="red">{delegateResult.error}</Text>
        ) : delegateResult.summary ? (
          <Box flexDirection="column">
            <Text>{delegateResult.summary}</Text>
            {delegateResult.totalTokens && (
              <Text color="gray">{formatTokenCount(delegateResult.totalTokens)}</Text>
            )}
          </Box>
        ) : (
          <Text color="gray">Delegation in progress...</Text>
        )}
      </Box>
    );
  })() : null;
  
  // Build expanded content
  const expandedContent = (
    <Box flexDirection="column">
      {/* Input parameters */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color="yellow">Input:</Text>
        <Box marginLeft={2}>
          <Text>{JSON.stringify(item.call.arguments, null, 2)}</Text>
        </Box>
      </Box>

      {/* Delegation result or status */}
      {item.result && (
        <Box flexDirection="column">
          {delegateResult?.error ? (
            <React.Fragment>
              <Text color="red">Error:</Text>
              <Box marginLeft={2}>
                <Text color="red">{delegateResult.error}</Text>
              </Box>
            </React.Fragment>
          ) : (
            <React.Fragment>
              <Text color="green">Delegation Status:</Text>
              <Box marginLeft={2} flexDirection="column">
                {delegateThreadId && (
                  <Text>Thread ID: {delegateThreadId}</Text>
                )}
                {delegateResult?.status && (
                  <Text>Status: {delegateResult.status}</Text>
                )}
                {delegateResult?.summary && (
                  <Text>Summary: {delegateResult.summary}</Text>
                )}
                {delegateResult?.totalTokens && (
                  <Text>Tokens: {formatTokenCount(delegateResult.totalTokens)}</Text>
                )}
              </Box>
            </React.Fragment>
          )}
        </Box>
      )}
      
      {/* Delegation instructions */}
      {delegateThreadId && delegateResult?.status === 'active' && (
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text color={UI_COLORS.DELEGATE}>{UI_SYMBOLS.DELEGATE} </Text>
            <Text color="gray">Delegation Thread - </Text>
            <Text color={isEntered ? 'green' : 'gray'}>
              {isEntered
                ? '[ESC to exit]'
                : `[${UI_SYMBOLS.EXPAND_HINT} to enter]`}
            </Text>
          </Box>
          
          {delegationExpanded && (
            <Box marginTop={1}>
              <Text color="gray" italic>
                Note: Full delegation timeline display requires additional context providers.
              </Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );

  return (
    <TimelineEntry
      label={header}
      summary={preview}
      status={status}
      isExpandable={true}
    >
      {expandedContent}
    </TimelineEntry>
  );
});