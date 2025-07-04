// ABOUTME: Specialized renderer for delegate tool executions using three-layer architecture
// ABOUTME: Displays delegation with nested timeline showing sub-agent conversation progress

import React, { forwardRef, useImperativeHandle } from 'react';
import { Box, Text } from 'ink';
import { ToolDisplay } from './components/ToolDisplay.js';
import { type ToolExecutionItem } from './hooks/useToolData.js';
import { useDelegateToolData } from './hooks/useDelegateToolData.js';
import { useDelegateToolState } from './hooks/useDelegateToolState.js';
import { UI_SYMBOLS, UI_COLORS } from '../../../theme.js';
import { CompactOutput } from '../../ui/CompactOutput.js';
import { CodeDisplay } from '../../ui/CodeDisplay.js';
import { formatTokenCount } from '../../../../../utils/token-estimation.js';
import { FocusLifecycleWrapper, FocusRegions } from '../../../focus/index.js';
import { TimelineExpansionProvider } from '../hooks/useTimelineExpansionToggle.js';
import TimelineDisplay from '../TimelineDisplay.js';
import { TimelineItemRef } from '../../timeline-item-focus.js';
// Removed unused import
import { logger } from '../../../../../utils/logger.js';

interface DelegateToolRendererProps {
  item: ToolExecutionItem;
  isStreaming?: boolean;
  isSelected?: boolean;
  onToggle?: () => void;
}

// Custom header component for delegate
function DelegateHeader({ toolData, delegateData }: any) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={UI_COLORS.TOOL}>{UI_SYMBOLS.TOOL} </Text>
        <Text color={UI_COLORS.TOOL} bold>delegate</Text>
        <Text color="gray"> </Text>
        <Text color="white">"{toolData.baseData.primaryInfo}"</Text>
        <Text color="gray"> </Text>
        <Text color={toolData.baseData.success ? UI_COLORS.SUCCESS : UI_COLORS.ERROR}>
          {toolData.baseData.statusIcon}
        </Text>
        {toolData.baseData.isStreaming && <Text color="gray"> (running...)</Text>}
        <Text color="cyan"> [DELEGATE]</Text>
      </Box>
      
      {/* Show delegation status when collapsed */}
      {delegateData.delegateThreadId && (
        <Box marginLeft={2} marginTop={1}>
          <Text color={UI_COLORS.DELEGATE}>{UI_SYMBOLS.DELEGATE} </Text>
          <Text color="gray">Thread: {delegateData.delegateThreadId}</Text>
          {toolData.baseData.result && toolData.baseData.success && (
            <Text color={UI_COLORS.SUCCESS}> - Delegation active</Text>
          )}
        </Box>
      )}
    </Box>
  );
}

// Custom content component for delegate
function DelegateContent({ toolData, delegateData, state }: any) {
  const { baseData } = toolData;
  const isJsonOutput = (text: string) => {
    const trimmed = text?.trim() || '';
    return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
           (trimmed.startsWith('[') && trimmed.endsWith(']'));
  };
  
  return (
    <Box flexDirection="column">
      {/* Input parameters */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color="yellow">Input:</Text>
        <Box marginLeft={2}>
          <CodeDisplay 
            code={JSON.stringify(baseData.input, null, 2)} 
            language="json" 
            compact={false} 
          />
        </Box>
      </Box>

      {/* Output */}
      {baseData.result && (
        <Box flexDirection="column" marginBottom={delegateData.delegateThreadId ? 1 : 0}>
          <Text color={baseData.success ? 'green' : 'red'}>
            {baseData.success ? 'Output:' : 'Error:'}
          </Text>
          <Box marginLeft={2}>
            {baseData.success ? (
              <CompactOutput
                output={baseData.output || 'No output'}
                language={isJsonOutput(baseData.output) ? 'json' : 'text'}
                maxLines={50}
                canExpand={false}
              />
            ) : (
              <Text color="red">{baseData.output || 'Unknown error'}</Text>
            )}
          </Box>
        </Box>
      )}

      {/* Inline delegation details when expanded */}
      {delegateData.delegateThreadId && (
        <Box flexDirection="column">
          <Text color="yellow">Delegation:</Text>
          <Box marginLeft={2}>
            <Box
              flexDirection="column"
              borderStyle="round"
              borderColor={delegateData.isComplete ? 'green' : 'yellow'}
              padding={1}
              marginY={1}
            >
              {/* Header */}
              <Box justifyContent="space-between" marginBottom={state.delegationExpanded ? 1 : 0}>
                <Box>
                  <Text color={UI_COLORS.DELEGATE}>{UI_SYMBOLS.DELEGATE} </Text>
                  <Text color="gray">{delegateData.delegateThreadId}</Text>
                  <Text color="white"> ({delegateData.taskDescription})</Text>
                </Box>
                <Box>
                  {delegateData.isComplete ? (
                    <Text color={UI_COLORS.SUCCESS}>
                      {UI_SYMBOLS.SUCCESS} Complete ({delegateData.duration}){' '}
                    </Text>
                  ) : (
                    <Text color={UI_COLORS.PENDING}>
                      {UI_SYMBOLS.WORKING} Working... ({delegateData.duration}){' '}
                    </Text>
                  )}
                  <Text color="gray">
                    {UI_SYMBOLS.TOKEN_IN}
                    {formatTokenCount(delegateData.tokens.tokensIn)} {UI_SYMBOLS.TOKEN_OUT}
                    {formatTokenCount(delegateData.tokens.tokensOut)}{' '}
                  </Text>
                  <Text color="cyan">
                    {state.delegationExpanded
                      ? `[${UI_SYMBOLS.COLLAPSE_HINT} Collapse]`
                      : `[${UI_SYMBOLS.EXPAND_HINT} Expand]`}
                  </Text>
                </Box>
              </Box>

              {/* Content */}
              {state.delegationExpanded && (
                <Box flexDirection="column" paddingLeft={2}>
                  <TimelineExpansionProvider>
                    <TimelineDisplay 
                      timeline={delegateData.timeline} 
                      focusRegion={delegateData.delegateThreadId ? 
                        FocusRegions.delegate(delegateData.delegateThreadId) : undefined}
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
  const delegateData = useDelegateToolData(item);
  
  // Layer 2: State management
  const state = useDelegateToolState(
    delegateData.delegateThreadId,
    isSelected,
    onToggle
  );
  
  // Expose enterFocus method through ref
  useImperativeHandle(ref, () => ({
    enterFocus: () => {
      logger.debug('DelegateToolRenderer: enterFocus called via ref', {
        delegateThreadId: delegateData.delegateThreadId,
        currentIsEntered: state.isEntered,
      });
      if (delegateData.delegateThreadId) {
        state.setIsEntered(true);
        logger.debug('DelegateToolRenderer: setIsEntered(true) called via ref', {
          delegateThreadId: delegateData.delegateThreadId,
          focusId: state.focusId,
        });
      } else {
        logger.warn('DelegateToolRenderer: enterFocus called but no delegateThreadId');
      }
    },
  }), [delegateData.delegateThreadId, state]);
  
  // Layer 3: Display with focus wrapper
  const toolDisplay = (
    <ToolDisplay
      toolData={delegateData.baseData}
      toolState={state.baseState}
      isSelected={isSelected}
      onToggle={onToggle}
      components={{
        header: <DelegateHeader toolData={delegateData} delegateData={delegateData} />,
        content: <DelegateContent toolData={delegateData} delegateData={delegateData} state={state} />
      }}
    />
  );
  
  // Wrap with focus lifecycle for delegation support
  return (
    <FocusLifecycleWrapper
      focusId={state.focusId}
      isActive={state.isEntered}
      renderWhenInactive={true}
      onFocusRestored={() => state.setIsEntered(false)}
    >
      {toolDisplay}
    </FocusLifecycleWrapper>
  );
});