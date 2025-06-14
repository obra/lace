// ABOUTME: Pure component for rendering text with cursor
// ABOUTME: Takes state and renders, no logic or input handling

import React, { useRef } from "react";
import { Box, Text } from "ink";

interface TextRendererProps {
  lines: string[];
  cursorLine: number;
  cursorColumn: number;
  isFocused: boolean;
  placeholder?: string;
  showDebug?: boolean;
  debugLog?: string[];
}

const TextRenderer: React.FC<TextRendererProps> = ({
  lines,
  cursorLine,
  cursorColumn,
  isFocused,
  placeholder = "Type your message...",
  showDebug = false,
  debugLog = [],
}) => {
  // Generate unique instance ID to prevent key collisions
  const instanceId = useRef(Math.random().toString(36).substring(7));
  // Show placeholder when empty and not focused
  if (!isFocused && lines.length === 1 && lines[0] === "") {
    return <Text color="dim">{placeholder}</Text>;
  }

  return (
    <Box flexDirection="column">
      {/* Debugging disabled
      {showDebug && (
        <Box borderStyle="single" borderColor="red" padding={1} flexDirection="column">
          <Text>Debug: line={cursorLine} col={cursorColumn} focused={isFocused ? 'Y' : 'N'} lines={lines.length}</Text>
          <Text>Current line: "{lines[cursorLine] || ''}" (len={lines[cursorLine]?.length || 0})</Text>
          <Text>Char under cursor: "{lines[cursorLine]?.slice(cursorColumn, cursorColumn + 1) || 'EOF'}"</Text>
          <Text>Backspace would delete: "{cursorColumn > 0 ? lines[cursorLine]?.slice(cursorColumn - 1, cursorColumn) || 'none' : 'none'}"</Text>
          {debugLog.map((log, i) => (
            <Text key={`debug-${i}-${log.slice(0, 10).replace(/[^a-zA-Z0-9]/g, '_')}`} color="yellow">LOG: {log}</Text>
          ))}
        </Box>
      )}
      */}

      {lines.map((line, lineIndex) => {
        const isCurrentLine = lineIndex === cursorLine;

        return (
          <Box key={`${instanceId.current}-line-${lineIndex}`}>
            {isCurrentLine && isFocused ? (
              // Render line with cursor
              <Box
                key={`${instanceId.current}-cursor-line-${lineIndex}`}
                flexDirection="row"
              >
                <Text>{line.slice(0, cursorColumn)}</Text>
                <Text inverse>
                  {line.slice(cursorColumn, cursorColumn + 1) || " "}
                </Text>
                <Text>{line.slice(cursorColumn + 1)}</Text>
              </Box>
            ) : // Regular line without cursor - show placeholder only on first line if empty
            lineIndex === 0 && line.length === 0 ? (
              <Text color="dim">{placeholder}</Text>
            ) : line.length === 0 ? (
              <Text> </Text>
            ) : (
              <Text>{line}</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
};

export default TextRenderer;
