// ABOUTME: Specialized renderer for delegate tool executions using three-layer architecture with complex state
// ABOUTME: Handles delegate threads with nested timeline display, focus management, and real-time updates

import React, { useState, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Box, Text, useInput } from 'ink';
import { TimelineItemRef } from '../../timeline-item-focus.js';
import { ToolDisplay } from './components/ToolDisplay.js';
import { useToolData } from './hooks/useToolData.js';
import { useToolState } from './hooks/useToolState.js';
import { UI_SYMBOLS, UI_COLORS } from '../../../../theme.js';
import { useThreadManager, useThreadProcessor } from '../../../../terminal-interface.js';
import { calculateTokens, formatTokenCount } from '../../../../../../utils/token-estimation.js';
import { useLaceFocus, FocusRegions, FocusLifecycleWrapper } from '../../../../focus/index.js';
import { useTimelineItemFocusEntry, TimelineExpansionProvider } from '../../hooks/useTimelineExpansionToggle.js';
import TimelineDisplay from '../../TimelineDisplay.js';
import { CompactOutput } from '../../../ui/CompactOutput.js';
import { CodeDisplay } from '../../../ui/CodeDisplay.js';
import { logger } from '../../../../../../utils/logger.js';
import {
  extractDelegateThreadId,
  isThreadComplete,
  extractTaskFromTimeline,
  calculateDuration,
} from '../../utils/timeline-utils.js';

// Extract tool execution timeline item type
type ToolExecutionItem = {
  type: 'tool_execution';
  call: any;
  result?: any;
  timestamp: Date;
  callId: string;
};

interface DelegateToolRendererProps {
  item: ToolExecutionItem;
  isStreaming?: boolean;
  isSelected?: boolean;
  onToggle?: () => void;
}

// Helper function to detect JSON output
function isJsonOutput(output: string): boolean {
  if (!output || typeof output !== 'string') return false;

  const trimmed = output.trim();
  return (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  );
}

// Custom header component for delegate tool
function DelegateHeader({ 
  toolData, 
  delegateThreadId 
}: { 
  toolData: any; 
  delegateThreadId: string | null; 
}) {
  const task = ((toolData.input.task || toolData.input.prompt) as string) || 'Unknown task';
  
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={UI_COLORS.TOOL}>{UI_SYMBOLS.TOOL} </Text>
        <Text color={UI_COLORS.TOOL} bold>
          delegate
        </Text>
        <Text color="gray"> </Text>
        <Text color="white">"{task}"</Text>
        <Text color="gray"> </Text>
        <Text color={toolData.success ? UI_COLORS.SUCCESS : toolData.result ? UI_COLORS.ERROR : UI_COLORS.PENDING}>
          {toolData.statusIcon}
        </Text>
        {toolData.isStreaming && <Text color="gray"> (running...)</Text>}
        <Text color="cyan"> [DELEGATE]</Text>
      </Box>

      {/* Show delegation status when collapsed */}
      {delegateThreadId && (
        <Box marginLeft={2} marginTop={1}>
          <Text color={UI_COLORS.DELEGATE}>{UI_SYMBOLS.DELEGATE} </Text>
          <Text color="gray">Thread: {delegateThreadId}</Text>
          {toolData.result && toolData.success && <Text color={UI_COLORS.SUCCESS}> - Delegation active</Text>}
        </Box>
      )}
    </Box>
  );
}

// Custom preview component for delegate tool
function DelegatePreview({ 
  toolData, 
  delegateThreadId 
}: { 
  toolData: any; 
  delegateThreadId: string | null; 
}) {
  // Only show output preview if no delegation or delegation failed
  if (delegateThreadId || !toolData.result || !toolData.success || !toolData.output) {
    return null;
  }

  return (
    <Box marginLeft={2} marginTop={1}>
      <CompactOutput
        output={toolData.output}
        language={isJsonOutput(toolData.output) ? 'json' : 'text'}
        maxLines={3}
        canExpand={false}
      />
    </Box>
  );
}

// Custom content component for delegate tool with nested timeline
function DelegateContent({ 
  toolData, 
  delegateThreadId,
  delegationExpanded,
  setDelegationExpanded 
}: { 
  toolData: any; 
  delegateThreadId: string | null;
  delegationExpanded: boolean;
  setDelegationExpanded: (expanded: boolean) => void;
}) {
  const threadManager = useThreadManager();
  const threadProcessor = useThreadProcessor();

  // Fetch and process delegate thread data
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
      return processed;
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
  }, [delegateThreadId, threadManager, threadProcessor]);

  // Determine delegation status
  const isComplete = isThreadComplete(timeline);
  const taskDescription = extractTaskFromTimeline(timeline);
  const duration = calculateDuration(timeline);
  const tokens = calculateTokens(timeline);

  return (
    <Box flexDirection="column">
      {/* Input parameters */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color="yellow">Input:</Text>
        <Box marginLeft={2}>
          <CodeDisplay code={JSON.stringify(toolData.input, null, 2)} language="json" compact={false} />
        </Box>
      </Box>

      {/* Output */}
      {toolData.result && (
        <Box flexDirection="column" marginBottom={delegateThreadId ? 1 : 0}>
          <Text color={toolData.success ? 'green' : 'red'}>
            {toolData.success ? 'Output:' : 'Error:'}
          </Text>
          <Box marginLeft={2}>
            {toolData.success ? (
              <CompactOutput
                output={toolData.output || 'No output'}
                language={isJsonOutput(toolData.output || '') ? 'json' : 'text'}
                maxLines={50}
                canExpand={false}
              />
            ) : (
              <Text color="red">{toolData.output || 'Unknown error'}</Text>
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
}

export const DelegateToolRenderer = forwardRef<TimelineItemRef, DelegateToolRendererProps>(({
  item,
  isStreaming = false,
  isSelected = false,
  onToggle,
}, ref) => {
  
  // Layer 1: Data processing
  const toolData = useToolData(item);
  
  // Extract delegate thread ID
  const delegateThreadId = useMemo(() => extractDelegateThreadId(item), [item]);
  
  // Layer 2: State management with delegate-specific extensions
  const toolState = useToolState(toolData, isSelected, onToggle, { 
    enableDelegateState: true 
  });
  
  // Focus state management for delegate thread
  const [isEntered, setIsEntered] = useState(false);
  const { isFocused } = useLaceFocus(
    delegateThreadId ? FocusRegions.delegate(delegateThreadId) : 'none', 
    { autoFocus: false }
  );

  // Handle keyboard input when focused
  useInput((input: string, key: any) => {
    if (!isFocused) return;
    
    if (key.escape) {
      logger.debug('DelegateToolRenderer: Escape pressed, exiting delegate focus');
      setIsEntered(false);
      return;
    }
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

  // Expose enterFocus method through ref (compatibility)
  useImperativeHandle(ref, () => ({
    enterFocus: () => {
      logger.debug('DelegateToolRenderer: enterFocus called via ref', {
        delegateThreadId,
        currentIsEntered: isEntered,
      });
      if (delegateThreadId) {
        setIsEntered(true);
      } else {
        logger.warn('DelegateToolRenderer: enterFocus called but no delegateThreadId');
      }
    },
  }), [delegateThreadId, isEntered]);

  // Layer 3: Display with custom components wrapped in focus lifecycle
  const displayComponent = (
    <ToolDisplay
      toolData={toolData}
      toolState={toolState}
      isSelected={isSelected}
      onToggle={onToggle}
      components={{
        header: (
          <DelegateHeader 
            toolData={toolData}
            delegateThreadId={delegateThreadId}
          />
        ),
        preview: !toolData.isStreaming ? (
          <DelegatePreview 
            toolData={toolData}
            delegateThreadId={delegateThreadId}
          />
        ) : undefined,
        content: (
          <DelegateContent
            toolData={toolData}
            delegateThreadId={delegateThreadId}
            delegationExpanded={toolState.customState?.delegationExpanded || true}
            setDelegationExpanded={toolState.customState?.setDelegationExpanded || (() => {})}
          />
        ),
      }}
    />
  );

  // Wrap with focus lifecycle if delegation exists
  if (delegateThreadId) {
    return (
      <FocusLifecycleWrapper
        focusId={FocusRegions.delegate(delegateThreadId)}
        isActive={isEntered}
        renderWhenInactive={true}
        onFocusRestored={() => setIsEntered(false)}
      >
        {displayComponent}
      </FocusLifecycleWrapper>
    );
  }

  return displayComponent;
});