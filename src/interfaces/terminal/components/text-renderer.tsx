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
  inlineCompletion?: string;
}

const TextRenderer: React.FC<TextRendererProps> = ({
  lines,
  cursorLine,
  cursorColumn,
  isFocused,
  placeholder = "Type your message...",
  inlineCompletion,
}) => {
  // Generate unique instance ID to prevent key collisions
  const instanceId = useRef(Math.random().toString(36).substring(7));
  
  // Ensure lines array is never empty to prevent edge cases
  const safeLines = lines.length === 0 ? [''] : lines;
  
  // Bound cursor position to valid ranges to prevent rendering issues
  const safeCursorLine = Math.max(0, Math.min(cursorLine, safeLines.length - 1));
  const currentLine = safeLines[safeCursorLine] || '';
  const safeCursorColumn = Math.max(0, Math.min(cursorColumn, currentLine.length));
  
  // Show placeholder when empty and not focused
  if (!isFocused && safeLines.length === 1 && safeLines[0] === "") {
    return <Text color="dim">{placeholder}</Text>;
  }

  return (
    <Box flexDirection="column">
      {safeLines.map((line, lineIndex) => {
        const isCurrentLine = lineIndex === safeCursorLine;
        const effectiveCursorColumn = isCurrentLine ? safeCursorColumn : 0;

        return (
          <Box key={`${instanceId.current}-line-${lineIndex}`}>
            {isCurrentLine && isFocused ? (
              // Render line with cursor and optional inline completion
              <Box
                key={`${instanceId.current}-cursor-line-${lineIndex}`}
                flexDirection="row"
              >
                <Text>{line.slice(0, effectiveCursorColumn)}</Text>
                {inlineCompletion ? (
                  // When showing inline completion, merge cursor with the preview
                  <Box flexDirection="row">
                    <Text inverse>{inlineCompletion.charAt(0) || " "}</Text>
                    <Text color="dim">{inlineCompletion.slice(1)}</Text>
                    <Text>{line.slice(effectiveCursorColumn + 1)}</Text>
                  </Box>
                ) : (
                  // Normal cursor display when no completion
                  <Box flexDirection="row">
                    <Text inverse>
                      {line.slice(effectiveCursorColumn, effectiveCursorColumn + 1) || " "}
                    </Text>
                    <Text>{line.slice(effectiveCursorColumn + 1)}</Text>
                  </Box>
                )}
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