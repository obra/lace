// ABOUTME: Debug panel showing current focus state for troubleshooting focus issues
// ABOUTME: Displays focus stack, current focus region, and focus-related state

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useLaceFocusContext } from '../focus/focus-provider.js';

interface FocusDebugPanelProps {
  // Add any additional debug info props here
}

interface FocusHistoryEntry {
  timestamp: string;
  action: string;
  focus: string;
  stackDepth: number;
}

export function FocusDebugPanel({}: FocusDebugPanelProps) {
  // Get focus state from the context
  const { currentFocus, getFocusStack, pushFocus, popFocus } = useLaceFocusContext();
  const focusStack = getFocusStack();
  const [lastAction, setLastAction] = useState<string>('none');
  const [focusHistory, setFocusHistory] = useState<FocusHistoryEntry[]>([]);
  
  // Monitor focus changes and maintain history
  useEffect(() => {
    const timestamp = new Date().toLocaleTimeString();
    const action = `Focus changed to: ${currentFocus || 'none'}`;
    setLastAction(action);
    
    // Add to history (keep last 8 entries for more context) - use ref to prevent feedback loop
    const newEntry: FocusHistoryEntry = {
      timestamp,
      action: currentFocus ? 'PUSH' : 'POP',
      focus: currentFocus || 'none',
      stackDepth: focusStack ? focusStack.length : 0
    };
    
    setFocusHistory(prev => {
      // Only add if it's actually different from the last entry
      if (prev.length > 0 && 
          prev[0].focus === newEntry.focus && 
          prev[0].action === newEntry.action) {
        return prev; // Don't add duplicate
      }
      return [newEntry, ...prev].slice(0, 8);
    });
  }, [currentFocus]);
  
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Box flexDirection="row">
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
        
        <Box marginTop={1} flexDirection="column">
          <Text color="cyan" bold>Focus History (last 5):</Text>
          {focusHistory.map((entry, index) => (
            <Box key={index} marginLeft={2}>
              <Text color="gray">{entry.timestamp} </Text>
              <Text color={entry.action === 'PUSH' ? 'green' : 'red'}>{entry.action} </Text>
              <Text color="white">{entry.focus} </Text>
              <Text color="gray">(depth: {entry.stackDepth})</Text>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
