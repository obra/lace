// ABOUTME: Debug panel showing current focus state for troubleshooting focus issues
// ABOUTME: Displays focus stack, current focus region, and focus-related state

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useLaceFocusContext } from '../focus/focus-provider.js';

interface FocusDebugPanelProps {
  // Add any additional debug info props here
}

export function FocusDebugPanel({}: FocusDebugPanelProps) {
  // Get focus state from the context
  const { currentFocus, getFocusStack, pushFocus, popFocus } = useLaceFocusContext();
  const focusStack = getFocusStack();
  const [lastAction, setLastAction] = useState<string>('none');
  
  // Monitor focus changes
  useEffect(() => {
    setLastAction(`Focus changed to: ${currentFocus || 'none'}`);
  }, [currentFocus]);
  
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Box flexDirection="column">
        <Text color="cyan" bold>🔧 Focus Debug Panel</Text>
        
        <Box marginTop={1}>
          <Text color="yellow">Current Focus: </Text>
          <Text color="white">{currentFocus || 'none'}</Text>
        </Box>
        
        <Box>
          <Text color="yellow">Focus Stack: </Text>
          <Text color="white">[{focusStack ? focusStack.join(', ') : 'empty'}]</Text>
        </Box>
        
        <Box>
          <Text color="yellow">Stack Depth: </Text>
          <Text color="white">{focusStack ? focusStack.length : 0}</Text>
        </Box>
        
        <Box>
          <Text color="yellow">Last Action: </Text>
          <Text color="white">{lastAction}</Text>
        </Box>
      </Box>
    </Box>
  );
}