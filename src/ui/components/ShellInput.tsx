// ABOUTME: Simple text editor input using modular components
// ABOUTME: Composition of TextBuffer hook, TextRenderer, and input handling

import React, { useEffect, useState, useCallback, useRef } from "react";
import { Box, Text, useInput, useFocus } from "ink";
import { useTextBuffer } from "./useTextBuffer";
import TextRenderer from "./TextRenderer";
import {
  CompletionManager,
  CompletionItem,
  CompletionContext,
} from "../completion/index.js";

interface ShellInputProps {
  value?: string;
  placeholder?: string;
  focusId?: string;
  autoFocus?: boolean;
  onSubmit?: (value: string) => void;
  onChange?: (value: string) => void;
  history?: string[];
  showDebug?: boolean;
  completionManager?: CompletionManager;
}

const ShellInput: React.FC<ShellInputProps> = ({
  value = "",
  placeholder = "Type your message...",
  focusId = "text-editor",
  autoFocus = false,
  onSubmit,
  onChange,
  history = [],
  showDebug = false,
  completionManager,
}) => {
  // Safe focus handling - avoid useFocus in test environments where raw mode may not work reliably
  const [isFocused, setIsFocused] = useState(autoFocus);

  // Only use useFocus if we're in a real terminal environment
  const useRealFocus =
    process.env.NODE_ENV !== "test" &&
    typeof process.stdin?.isTTY === "boolean" &&
    process.stdin.isTTY;

  const focusResult = useRealFocus
    ? useFocus({ id: focusId, autoFocus })
    : null;
  const actualIsFocused = useRealFocus ? focusResult?.isFocused : isFocused;
  const [bufferState, bufferOps] = useTextBuffer(value);

  // Completion state
  const [completions, setCompletions] = useState<CompletionItem[]>([]);
  const [completionIndex, setCompletionIndex] = useState(0);
  const [showCompletions, setShowCompletions] = useState(false);
  const [completionPrefix, setCompletionPrefix] = useState("");

  // Scrolling state for completion modal
  const [completionViewportStart, setCompletionViewportStart] = useState(0);
  const maxVisibleCompletions = 8;

  // Calculate viewport scrolling to keep selected item visible
  const updateCompletionViewport = useCallback(
    (newIndex: number, totalItems: number) => {
      if (totalItems <= maxVisibleCompletions) {
        setCompletionViewportStart(0);
        return;
      }

      const currentStart = completionViewportStart;
      const currentEnd = currentStart + maxVisibleCompletions - 1;

      // If selected item is below visible area, scroll down
      if (newIndex > currentEnd) {
        setCompletionViewportStart(newIndex - maxVisibleCompletions + 1);
      }
      // If selected item is above visible area, scroll up
      else if (newIndex < currentStart) {
        setCompletionViewportStart(newIndex);
      }
      // Otherwise, keep current viewport
    },
    [completionViewportStart, maxVisibleCompletions],
  );

  // Only sync external value changes on first mount or significant changes (like history)
  const [lastExternalValue, setLastExternalValue] = useState(value);

  useEffect(() => {
    // Only update if the external value changed significantly (not from our onChange)
    if (value !== lastExternalValue && value !== bufferOps.getText()) {
      bufferOps.setText(value);
      setLastExternalValue(value);
    }
  }, [value, lastExternalValue, bufferOps]);

  // Debounced onChange to reduce conflicts
  const notifyChange = useCallback(
    (newText: string) => {
      if (onChange && newText !== value) {
        setLastExternalValue(newText); // Pre-mark as our change
        onChange(newText);
      }
    },
    [onChange, value],
  );

  // Notify parent when buffer actually changes
  useEffect(() => {
    const currentText = bufferOps.getText();
    notifyChange(currentText);
  }, [bufferState.lines, notifyChange, bufferOps]);

  // Trigger completion logic
  const triggerCompletion = useCallback(async () => {
    setShowCompletions(false);

    if (!completionManager) {
      // bufferOps.addDebug('No completion manager available');
      return;
    }

    const currentLine = bufferState.lines[bufferState.cursorLine] || "";
    const { cursorLine, cursorColumn } = bufferState;

    const context: CompletionContext = {
      line: currentLine,
      column: cursorColumn,
      lineNumber: cursorLine,
      fullText: bufferOps.getText(),
      cwd: process.cwd(),
    };

    try {
      const result = await completionManager.getCompletions(context);
      // bufferOps.addDebug(`Completion: found ${result.items.length} items for "${result.prefix}"`);

      if (result.items.length > 0) {
        setCompletions(result.items);
        setCompletionIndex(0);
        setCompletionViewportStart(0); // Reset viewport to top
        setCompletionPrefix(result.prefix);
        setShowCompletions(true);
      }
    } catch (error) {
      // bufferOps.addDebug(`Completion error: ${error.message}`);
    }
  }, [bufferState, bufferOps, completionManager]);

  // Apply selected completion
  const applyCompletion = useCallback(() => {
    if (!showCompletions || completions.length === 0) return;

    const selectedItem = completions[completionIndex];
    if (!selectedItem) return;

    const currentLine = bufferState.lines[bufferState.cursorLine] || "";
    const { cursorLine, cursorColumn } = bufferState;

    if (
      cursorLine === 0 &&
      currentLine.startsWith("/") &&
      selectedItem.type === "command"
    ) {
      // Replace entire command (from / to cursor)
      const newLine = "/" + selectedItem.value;
      bufferOps.setText(newLine);
      bufferOps.setCursorPosition(0, newLine.length);
    } else {
      // Replace word/path before cursor using the stored prefix
      const prefixLength = completionPrefix.length;
      const replaceStart = cursorColumn - prefixLength;
      const newLine =
        currentLine.slice(0, replaceStart) +
        selectedItem.value +
        currentLine.slice(cursorColumn);
      const newLines = [...bufferState.lines];
      newLines[cursorLine] = newLine;
      bufferOps.setText(newLines.join("\n"));
      bufferOps.setCursorPosition(
        cursorLine,
        replaceStart + selectedItem.value.length,
      );
    }

    setShowCompletions(false);
    // bufferOps.addDebug(`Applied completion: ${selectedItem.value}`);
  }, [
    showCompletions,
    completions,
    completionIndex,
    completionPrefix,
    bufferState,
    bufferOps,
  ]);

  // Input handler
  useInput(
    (input, key) => {
      // Debug ALL key properties
      const keyProps = Object.keys(key)
        .filter((k) => key[k])
        .join(",");
      // bufferOps.addDebug(`KEY: input="${input}" props=[${keyProps}]`);

      // Handle completion mode
      if (showCompletions) {
        if (key.escape) {
          setShowCompletions(false);
          return;
        }
        if (key.upArrow) {
          const newIndex = Math.max(0, completionIndex - 1);
          setCompletionIndex(newIndex);
          updateCompletionViewport(newIndex, completions.length);
          return;
        }
        if (key.downArrow) {
          const newIndex = Math.min(
            completions.length - 1,
            completionIndex + 1,
          );
          setCompletionIndex(newIndex);
          updateCompletionViewport(newIndex, completions.length);
          return;
        }
        if (key.tab) {
          // Apply completion on Tab
          bufferOps.addDebug("Applying completion");
          applyCompletion();
          return;
        }
        if (key.return) {
          // Apply completion on Enter when in completion mode
          bufferOps.addDebug("Applying completion");
          applyCompletion();
          return;
        }
        // Any other key dismisses completions and continues processing
        bufferOps.addDebug(
          `Dismissing completions, continuing with key: shift=${key.shift} return=${key.return}`,
        );
        setShowCompletions(false);
      }

      // Handle Enter - submit or newline based on line ending
      if (key.return) {
        const currentLine = bufferState.lines[bufferState.cursorLine] || "";
        const trimmedLine = currentLine.trim();

        if (trimmedLine.endsWith("\\")) {
          // Line ends with backslash - remove backslash and insert newline
          bufferOps.addDebug(
            "Line ends with \\, removing backslash and inserting newline",
          );
          const lineWithoutBackslash = currentLine.replace(/\\(\s*)$/, "$1"); // Remove backslash but keep trailing whitespace
          const newLines = [...bufferState.lines];
          newLines[bufferState.cursorLine] = lineWithoutBackslash;
          newLines.splice(bufferState.cursorLine + 1, 0, ""); // Insert empty line after current
          bufferOps.setText(newLines.join("\n"));
          bufferOps.setCursorPosition(bufferState.cursorLine + 1, 0); // Move to start of next line
        } else {
          // Submit the message
          bufferOps.addDebug("ENTER DETECTED - submitting");
          if (onSubmit) {
            onSubmit(bufferOps.getText());
          }
        }
        return;
      }

      // Navigation
      if (key.leftArrow) {
        bufferOps.moveCursor("left");
        return;
      }
      if (key.rightArrow) {
        bufferOps.moveCursor("right");
        return;
      }
      if (key.upArrow) {
        bufferOps.moveCursor("up");
        return;
      }
      if (key.downArrow) {
        bufferOps.moveCursor("down");
        return;
      }
      if (key.ctrl && input === "a") {
        bufferOps.moveCursor("home");
        return;
      }
      if (key.ctrl && input === "e") {
        bufferOps.moveCursor("end");
        return;
      }

      // Emacs-style editing commands
      if (key.ctrl && input === "k") {
        // Kill line (delete from cursor to end of line)
        bufferOps.killLine();
        return;
      }
      if (key.ctrl && input === "u") {
        // Kill line backward (delete from beginning of line to cursor)
        bufferOps.killLineBackward();
        return;
      }
      if (key.ctrl && input === "d") {
        // Delete character forward (like Delete key)
        bufferOps.deleteChar("forward");
        return;
      }
      if (key.ctrl && input === "h") {
        // Delete character backward (like Backspace key)
        bufferOps.deleteChar("backward");
        return;
      }

      // Tab completion
      if (key.tab) {
        triggerCompletion();
        return;
      }

      // Deletion
      if (key.delete) {
        bufferOps.addDebug("DELETE/BACKSPACE KEY DETECTED in input handler");
        bufferOps.deleteChar("backward");
        return;
      }
      if (key.backspace) {
        bufferOps.deleteChar("forward");
        return;
      }

      // Regular character input
      if (input && input.length === 1 && !key.ctrl && !key.meta) {
        bufferOps.insertText(input);
        return;
      }
    },
    { isActive: actualIsFocused },
  );

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="cyan">&gt; </Text>
        <Box flexDirection="column" flexGrow={1}>
          <TextRenderer
            lines={bufferState.lines}
            cursorLine={bufferState.cursorLine}
            cursorColumn={bufferState.cursorColumn}
            isFocused={actualIsFocused}
            placeholder={placeholder}
            showDebug={false}
            debugLog={[]}
          />
        </Box>
      </Box>

      {showCompletions &&
        completions.length > 0 &&
        (() => {
          const viewportEnd = Math.min(
            completionViewportStart + maxVisibleCompletions,
            completions.length,
          );
          const visibleCompletions = completions.slice(
            completionViewportStart,
            viewportEnd,
          );
          const hasItemsAbove = completionViewportStart > 0;
          const hasItemsBelow = viewportEnd < completions.length;

          return (
            <Box
              flexDirection="column"
              borderStyle="single"
              borderColor="yellow"
              padding={1}
              marginTop={1}
              marginLeft={2} // Offset for prompt
            >
              <Text color="yellow" bold>
                Completions ({completionIndex + 1}/{completions.length}):
              </Text>

              {hasItemsAbove && (
                <Text color="dim">▲ {completionViewportStart} more above</Text>
              )}

              {visibleCompletions.map((item, viewportIndex) => {
                const actualIndex = completionViewportStart + viewportIndex;
                return (
                  <Box
                    key={`completion-${completionViewportStart}-${viewportIndex}`}
                    flexDirection="row"
                  >
                    <Text
                      color={
                        actualIndex === completionIndex ? "black" : "white"
                      }
                      backgroundColor={
                        actualIndex === completionIndex ? "yellow" : undefined
                      }
                    >
                      {item.value}
                    </Text>
                    {item.description && (
                      <Text color="dim"> - {item.description}</Text>
                    )}
                    <Text color="dim"> [{item.type}]</Text>
                  </Box>
                );
              })}

              {hasItemsBelow && (
                <Text color="dim">
                  ▼ {completions.length - viewportEnd} more below
                </Text>
              )}

              <Box marginTop={1}>
                <Text color="dim">
                  ↑↓ navigate • Tab/Enter apply • Esc cancel
                </Text>
              </Box>
            </Box>
          );
        })()}
    </Box>
  );
};

export default ShellInput;
