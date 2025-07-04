// ABOUTME: Renderer for delegate tool executions with direct component composition
// ABOUTME: Displays delegation with thread information and completion status

import React, { forwardRef, useImperativeHandle, useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { ToolHeader, ToolPreview, ToolContent, useToolExpansion, type ToolRendererProps } from './components/shared.js';
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
  if (!result?.content?.[0]?.text) return null;
  
  try {
    const text = result.content[0].text;
    // Try to parse as JSON first
    if (text.trim().startsWith('{')) {
      return JSON.parse(text);
    }
    // Otherwise return as error text
    return { error: text };
  } catch {
    return { error: result.content[0].text };
  }
}

export const DelegateToolRenderer = forwardRef<TimelineItemRef, ToolRendererProps>(({
  item,
  isSelected = false,
  onToggle,
}, ref) => {
  const { isExpanded } = useToolExpansion(isSelected, onToggle);
  
  // Extract data directly
  const task = (item.call.arguments.task || item.call.arguments.prompt || 'Unknown task') as string;
  const delegateResult = item.result ? parseDelegateResult(item.result) : null;
  const hasError = item.result?.isError || delegateResult?.status === 'error';
  const isRunning = !item.result;
  
  // Determine status
  const status = isRunning ? 'pending' : hasError ? 'error' : 'success';
  
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
  
  return (
    <Box flexDirection="column">
      <Box flexDirection="column">
        <ToolHeader icon="🔧" status={status}>
          <Text color={UI_COLORS.TOOL} bold>delegate</Text>
          <Text> "{task}"</Text>
          <Text color="cyan"> [DELEGATE]</Text>
        </ToolHeader>
        
        {/* Show delegation status when collapsed */}
        {delegateThreadId && (
          <Box marginLeft={2} marginTop={1}>
            <Text color={UI_COLORS.DELEGATE}>{UI_SYMBOLS.DELEGATE} </Text>
            <Text color="gray">Thread: {delegateThreadId}</Text>
            {delegateResult?.status === 'active' && (
              <Text color={UI_COLORS.SUCCESS}> - Delegation active</Text>
            )}
          </Box>
        )}
      </Box>
      
      {!isExpanded && delegateResult && item.result && !isRunning && (
        <ToolPreview>
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
        </ToolPreview>
      )}
      
      {isExpanded && (
        <ToolContent>
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
                <>
                  <Text color="red">Error:</Text>
                  <Box marginLeft={2}>
                    <Text color="red">{delegateResult.error}</Text>
                  </Box>
                </>
              ) : (
                <>
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
                </>
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
        </ToolContent>
      )}
    </Box>
  );
});