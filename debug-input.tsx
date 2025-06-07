// ABOUTME: Simple debug component to test Ink focus and input
// ABOUTME: Minimal implementation to isolate focus/input issues

import React, { useState } from 'react';
import { Box, Text, useInput, useFocus } from 'ink';

const DebugInput: React.FC = () => {
  const [text, setText] = useState('');
  const [cursorPos, setCursorPos] = useState(0);
  const { isFocused } = useFocus({ id: 'debug-input', autoFocus: true });

  useInput((input, key) => {
    console.log('Input received:', { input, key, isFocused });
    
    if (key.backspace) {
      if (cursorPos > 0) {
        setText(prev => prev.slice(0, cursorPos - 1) + prev.slice(cursorPos));
        setCursorPos(prev => prev - 1);
      }
      return;
    }
    
    if (key.leftArrow) {
      setCursorPos(prev => Math.max(0, prev - 1));
      return;
    }
    
    if (key.rightArrow) {
      setCursorPos(prev => Math.min(text.length, prev + 1));
      return;
    }
    
    if (key.return) {
      console.log('SUBMIT:', text);
      return;
    }
    
    if (input && input.length === 1 && !key.ctrl && !key.meta) {
      setText(prev => prev.slice(0, cursorPos) + input + prev.slice(cursorPos));
      setCursorPos(prev => prev + 1);
      return;
    }
  }, { isActive: isFocused });

  return (
    <Box>
      <Text>Debug Input (focused: {isFocused ? 'YES' : 'NO'}): </Text>
      <Text>
        {text.slice(0, cursorPos)}
        <Text color="yellow">|</Text>
        {text.slice(cursorPos)}
      </Text>
    </Box>
  );
};

export default DebugInput;