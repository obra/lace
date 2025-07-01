// ABOUTME: Specialized tool renderer for delegate tool executions with inline delegation timeline display
// ABOUTME: Combines tool execution display with delegation timeline using TimelineEntryCollapsibleBox for consistency

import React, { useState, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Box, Text, useInput } from 'ink';
import { TimelineEntryCollapsibleBox } from '../../ui/TimelineEntryCollapsibleBox.js';
import { ToolCall, ToolResult } from '../../../../../tools/types.js';
import { CompactOutput } from '../../ui/CompactOutput.js';
import { CodeDisplay } from '../../ui/CodeDisplay.js';
import { UI_SYMBOLS, UI_COLORS } from '../../../theme.js';
import { useTimelineItemExpansion, useTimelineItemFocusEntry, TimelineExpansionProvider } from '../hooks/useTimelineExpansionToggle.js';
import { useThreadManager, useThreadProcessor } from '../../../terminal-interface.js';
import { calculateTokens, formatTokenCount } from '../../../../../utils/token-estimation.js';
import { useLaceFocus, FocusRegions, FocusLifecycleWrapper } from '../../../focus/index.js';
import TimelineDisplay from '../TimelineDisplay.js';
import { logger } from '../../../../../utils/logger.js';
import { TimelineItemRef } from '../../timeline-item-focus.js';
import { type MarkerStatus } from '../../ui/SideMarkerRenderer.js';
import {
  extractDelegateThreadId,
  isThreadComplete,
  extractTaskFromTimeline,
  calculateDuration,
} from '../utils/timeline-utils.js';

// Extract tool execution timeline item type
type ToolExecutionItem = {
  type: 'tool_execution';
  call: ToolCall;
  result?: ToolResult;
  timestamp: Date;
  callId: string;
};

interface DelegateToolRendererProps {
  item: ToolExecutionItem;
  isStreaming?: boolean;
  isSelected?: boolean; // Whether timeline cursor is on this item
  _isFocused?: boolean; // Whether this item has keyboard focus (unused)
  onToggle?: () => void;
}

function isJsonOutput(output: string): boolean {
  if (!output || typeof output !== 'string') return false;

  const trimmed = output.trim();
  return (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  );
}

export const DelegateToolRenderer = forwardRef<TimelineItemRef, DelegateToolRendererProps>(({
  item,
  isStreaming,
  isSelected,
  _isFocused,
  onToggle,
}, ref) => {
  // Use shared expansion management for consistent behavior
  const { isExpanded, onExpand, onCollapse } = useTimelineItemExpansion(
    isSelected || false,
    (_expanded) => onToggle?.()
  );

  // Focus state management
  const [isEntered, setIsEntered] = useState(false);
  const delegateThreadId = useMemo(() => extractDelegateThreadId(item), [item]);
  const { isFocused } = useLaceFocus(delegateThreadId ? FocusRegions.delegate(delegateThreadId) : 'none', { autoFocus: false });

  // Handle keyboard input when focused - only for focus management
  useInput((input: string, key: any) => {
    if (!isFocused) return;
    
    if (key.escape) {
      logger.debug('DelegateToolRenderer: Escape pressed, exiting delegate focus');
      setIsEntered(false); // Let FocusLifecycleWrapper handle popFocus
      return;
    }
    
    // Let embedded TimelineViewport handle all navigation keys
    // Don't try to "consume" events - Ink broadcasts to all handlers
    
  }, { isActive: isFocused });

  // Handle focus entry events from timeline
  const handleFocusEntry = useCallback(() => {
    logger.debug('DelegateToolRenderer: handleFocusEntry called', {
      delegateThreadId,
    });
    if (delegateThreadId) {
      setIsEntered(true);
      logger.debug('DelegateToolRenderer: setIsEntered(true) called via event', {
        delegateThreadId,
        focusId: FocusRegions.delegate(delegateThreadId),
      });
    } else {
      logger.warn('DelegateToolRenderer: handleFocusEntry called but no delegateThreadId');
    }
  }, [delegateThreadId]);

  // Listen for focus entry events when this item is selected
  useTimelineItemFocusEntry(isSelected || false, handleFocusEntry);

  // Expose enterFocus method through ref (kept for compatibility)
  useImperativeHandle(ref, () => ({
    enterFocus: () => {
      logger.debug('DelegateToolRenderer: enterFocus called via ref', {
        delegateThreadId,
        currentIsEntered: isEntered,
      });
      if (delegateThreadId) {
        setIsEntered(true);
        logger.debug('DelegateToolRenderer: setIsEntered(true) called via ref', {
          delegateThreadId,
          focusId: FocusRegions.delegate(delegateThreadId),
        });
      } else {
        logger.warn('DelegateToolRenderer: enterFocus called but no delegateThreadId');
      }
    },
  }), [delegateThreadId, isEntered]);

  // Create handler that works with TimelineEntryCollapsibleBox interface
  const handleExpandedChange = (expanded: boolean) => {
    if (expanded) {
      onExpand();
    } else {
      onCollapse();
    }
  };

  const { call, result } = item;
  const { arguments: input } = call;

  const success = result ? !result.isError : true;
  const output = result?.content?.[0]?.text;
  const error = result?.isError ? output : undefined;
  const markerStatus: MarkerStatus = isStreaming ? 'pending' : success ? 'success' : result ? 'error' : 'none';

  // Extract delegate task from input
  const delegateTask = ((input.task || input.prompt) as string) || 'Unknown task';
  const statusIcon = success ? UI_SYMBOLS.SUCCESS : result ? UI_SYMBOLS.ERROR : UI_SYMBOLS.PENDING;

  // Extract delegate thread ID from result metadata (moved to focus section above)

  // Get thread data from context
  const threadManager = useThreadManager();
  const threadProcessor = useThreadProcessor();

  // Manage delegation expansion state - mutable for local control
  const [delegationExpanded, setDelegationExpanded] = useState(true); // Default to expanded for delegation

  // Fetch and process delegate thread data (only if threadId exists)
  const timeline = useMemo(() => {
    if (!delegateThreadId) {
      return {
        items: [],
        metadata: { eventCount: 0, messageCount: 0, lastActivity: new Date() },
      };
    }

    try {
      const events = threadManager.getEvents(delegateThreadId);
      const processed = threadProcessor.processThreads(events);
      return processed; // processThreads now returns Timeline directly
    } catch (error) {
      logger.error('Failed to load delegate thread', {
        threadId: delegateThreadId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        items: [],
        metadata: { eventCount: 0, messageCount: 0, lastActivity: new Date() },
      };
    }
  }, [delegateThreadId]);

  // Determine delegation status
  const isComplete = isThreadComplete(timeline);
  const taskDescription = extractTaskFromTimeline(timeline);
  const duration = calculateDuration(timeline);
  const tokens = calculateTokens(timeline);

  // Create compact summary for collapsed state
  const delegateSummary = (
    <Box flexDirection="column">
      <Box>
        <Text color={UI_COLORS.TOOL}>{UI_SYMBOLS.TOOL} </Text>
        <Text color={UI_COLORS.TOOL} bold>
          delegate
        </Text>
        <Text color="gray"> </Text>
        <Text color="white">"{delegateTask}"</Text>
        <Text color="gray"> </Text>
        <Text color={success ? UI_COLORS.SUCCESS : result ? UI_COLORS.ERROR : UI_COLORS.PENDING}>
          {statusIcon}
        </Text>
        {isStreaming && <Text color="gray"> (running...)</Text>}
        <Text color="cyan"> [DELEGATE]</Text>
      </Box>

      {/* Show delegation status when collapsed */}
      {delegateThreadId && (
        <Box marginLeft={2} marginTop={1}>
          <Text color={UI_COLORS.DELEGATE}>{UI_SYMBOLS.DELEGATE} </Text>
          <Text color="gray">Thread: {delegateThreadId}</Text>
          {result && success && <Text color={UI_COLORS.SUCCESS}> - Delegation active</Text>}
        </Box>
      )}

      {/* Compact output preview when collapsed and successful */}
      {result && success && output && !delegateThreadId && (
        <Box marginLeft={2} marginTop={1}>
          <CompactOutput
            output={output}
            language={isJsonOutput(output) ? 'json' : 'text'}
            maxLines={3}
            canExpand={false}
          />
        </Box>
      )}
    </Box>
  );

  // Create expanded content showing full input/output + delegation
  const expandedContent = (
    <Box flexDirection="column">
      {/* Input parameters */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color="yellow">Input:</Text>
        <Box marginLeft={2}>
          <CodeDisplay code={JSON.stringify(input, null, 2)} language="json" compact={false} />
        </Box>
      </Box>

      {/* Output */}
      {result && (
        <Box flexDirection="column" marginBottom={delegateThreadId ? 1 : 0}>
          <Text color={success ? 'green' : 'red'}>{success ? 'Output:' : 'Error:'}</Text>
          <Box marginLeft={2}>
            {success ? (
              <CompactOutput
                output={output || 'No output'}
                language={isJsonOutput(output || '') ? 'json' : 'text'}
                maxLines={50}
                canExpand={false}
              />
            ) : (
              <Text color="red">{error || 'Unknown error'}</Text>
            )}
          </Box>
        </Box>
      )}

      {/* Inline delegation details when expanded */}
      {delegateThreadId && (
        <Box flexDirection="column">
          <Text color="yellow">Delegation:</Text>
          <Box marginLeft={2}>
            <Box
              flexDirection="column"
              borderStyle="round"
              borderColor={isComplete ? 'green' : 'yellow'}
              padding={1}
              marginY={1}
            >
              {/* Header */}
              <Box justifyContent="space-between" marginBottom={delegationExpanded ? 1 : 0}>
                <Box>
                  <Text color={UI_COLORS.DELEGATE}>{UI_SYMBOLS.DELEGATE} </Text>
                  <Text color="gray">{delegateThreadId}</Text>
                  <Text color="white"> ({taskDescription})</Text>
                </Box>
                <Box>
                  {isComplete ? (
                    <Text color={UI_COLORS.SUCCESS}>
                      {UI_SYMBOLS.SUCCESS} Complete ({duration}){' '}
                    </Text>
                  ) : (
                    <Text color={UI_COLORS.PENDING}>
                      {UI_SYMBOLS.WORKING} Working... ({duration}){' '}
                    </Text>
                  )}
                  <Text color="gray">
                    {UI_SYMBOLS.TOKEN_IN}
                    {formatTokenCount(tokens.tokensIn)} {UI_SYMBOLS.TOKEN_OUT}
                    {formatTokenCount(tokens.tokensOut)}{' '}
                  </Text>
                  <Text color="cyan">
                    {delegationExpanded
                      ? `[${UI_SYMBOLS.COLLAPSE_HINT} Collapse]`
                      : `[${UI_SYMBOLS.EXPAND_HINT} Expand]`}
                  </Text>
                </Box>
              </Box>

              {/* Content */}
              {delegationExpanded && (
                <Box flexDirection="column" paddingLeft={2}>
                  {/* Wrap TimelineDisplay with its own expansion provider to isolate events */}
                  <TimelineExpansionProvider>
                    <TimelineDisplay 
                      timeline={timeline} 
                      focusRegion={delegateThreadId ? FocusRegions.delegate(delegateThreadId) : undefined}
                    />
                  </TimelineExpansionProvider>
                </Box>
              )}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );

  return (
    <FocusLifecycleWrapper
      focusId={delegateThreadId ? FocusRegions.delegate(delegateThreadId) : 'none'}
      isActive={isEntered}
      renderWhenInactive={true}
      onFocusRestored={() => setIsEntered(false)}
    >
      <TimelineEntryCollapsibleBox
        label={`delegate "${delegateTask}"`}
        summary={delegateSummary}
        isExpanded={isExpanded}
        onExpandedChange={handleExpandedChange}
        isSelected={isSelected}
        isFocused={isFocused}
        onToggle={onToggle}
        status={markerStatus}
      >
        {expandedContent}
      </TimelineEntryCollapsibleBox>
    </FocusLifecycleWrapper>
  );
});
