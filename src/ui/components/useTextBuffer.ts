// ABOUTME: Custom hook for managing text buffer state and operations
// ABOUTME: Handles lines, cursor position, and text manipulation without UI concerns

import { useState, useCallback } from "react";

export interface TextBufferState {
  lines: string[];
  cursorLine: number;
  cursorColumn: number;
  debugLog: string[];
}

export interface TextBufferOperations {
  insertText: (text: string) => void;
  deleteChar: (direction: "forward" | "backward") => void;
  moveCursor: (
    direction: "left" | "right" | "up" | "down" | "home" | "end",
  ) => void;
  setText: (text: string) => void;
  getText: () => string;
  setCursorPosition: (line: number, column: number) => void;
  getCurrentLine: () => string;
  killLine: () => void;
  killLineBackward: () => void;
  addDebug: (message: string) => void;
}

export function useTextBuffer(
  initialText: string = "",
): [TextBufferState, TextBufferOperations] {
  const [lines, setLines] = useState(initialText.split("\n"));
  const [cursorLine, setCursorLine] = useState(0);
  const [cursorColumn, setCursorColumn] = useState(0);
  const [debugLog, setDebugLog] = useState<string[]>([
    "TextBuffer initialized",
  ]);

  const state: TextBufferState = {
    lines,
    cursorLine,
    cursorColumn,
    debugLog,
  };

  const insertText = useCallback(
    (text: string) => {
      setDebugLog((prev) => [
        ...prev.slice(-4),
        `INSERT: "${text}" at pos ${cursorColumn}`,
      ]);

      if (text === "\n") {
        // Handle newline
        const currentLine = lines[cursorLine] || "";
        const beforeCursor = currentLine.slice(0, cursorColumn);
        const afterCursor = currentLine.slice(cursorColumn);

        const newLines = [...lines];
        newLines[cursorLine] = beforeCursor;
        newLines.splice(cursorLine + 1, 0, afterCursor);

        setLines(newLines);
        setCursorLine(cursorLine + 1);
        setCursorColumn(0);
      } else {
        // Regular text
        const currentLine = lines[cursorLine] || "";
        const newLine =
          currentLine.slice(0, cursorColumn) +
          text +
          currentLine.slice(cursorColumn);

        const newLines = [...lines];
        newLines[cursorLine] = newLine;

        setLines(newLines);
        setCursorColumn(cursorColumn + text.length);
      }
    },
    [lines, cursorLine, cursorColumn],
  );

  const deleteChar = useCallback(
    (direction: "forward" | "backward") => {
      if (direction === "backward" && cursorColumn > 0) {
        // Simple backspace within line
        const currentLine = lines[cursorLine] || "";
        const charToDelete = currentLine[cursorColumn - 1];

        // Add debug BEFORE the operation
        setDebugLog((prev) => [
          ...prev.slice(-4),
          `BEFORE: line="${currentLine}" pos=${cursorColumn} deleting="${charToDelete}"`,
        ]);

        setLines((currentLines) => {
          const currentLine = currentLines[cursorLine] || "";
          const newLine =
            currentLine.slice(0, cursorColumn - 1) +
            currentLine.slice(cursorColumn);
          const newLines = [...currentLines];
          newLines[cursorLine] = newLine;
          return newLines;
        });
        setCursorColumn(cursorColumn - 1);

        // Add debug AFTER the operation
        setDebugLog((prev) => [
          ...prev.slice(-4),
          `AFTER: newPos=${cursorColumn - 1}`,
        ]);
      } else if (direction === "backward" && cursorLine > 0) {
        // Merge with previous line
        const currentLine = lines[cursorLine] || "";
        const prevLine = lines[cursorLine - 1];
        const mergedLine = prevLine + currentLine;
        const newLines = [...lines];
        newLines[cursorLine - 1] = mergedLine;
        newLines.splice(cursorLine, 1);
        setLines(newLines);
        setCursorLine(cursorLine - 1);
        setCursorColumn(prevLine.length);
      } else if (direction === "forward") {
        const currentLine = lines[cursorLine] || "";
        if (cursorColumn < currentLine.length) {
          const newLine =
            currentLine.slice(0, cursorColumn) +
            currentLine.slice(cursorColumn + 1);
          const newLines = [...lines];
          newLines[cursorLine] = newLine;
          setLines(newLines);
        } else if (cursorLine < lines.length - 1) {
          // Merge with next line
          const nextLine = lines[cursorLine + 1];
          const mergedLine = currentLine + nextLine;
          const newLines = [...lines];
          newLines[cursorLine] = mergedLine;
          newLines.splice(cursorLine + 1, 1);
          setLines(newLines);
        }
      }
    },
    [lines, cursorLine, cursorColumn],
  );

  const moveCursor = useCallback(
    (direction: "left" | "right" | "up" | "down" | "home" | "end") => {
      const currentLine = lines[cursorLine] || "";

      switch (direction) {
        case "left":
          if (cursorColumn > 0) {
            setCursorColumn(cursorColumn - 1);
          } else if (cursorLine > 0) {
            setCursorLine(cursorLine - 1);
            setCursorColumn(lines[cursorLine - 1].length);
          }
          break;
        case "right":
          if (cursorColumn < currentLine.length) {
            setCursorColumn(cursorColumn + 1);
          } else if (cursorLine < lines.length - 1) {
            setCursorLine(cursorLine + 1);
            setCursorColumn(0);
          }
          break;
        case "up":
          if (cursorLine > 0) {
            setCursorLine(cursorLine - 1);
            setCursorColumn(
              Math.min(cursorColumn, lines[cursorLine - 1].length),
            );
          }
          break;
        case "down":
          if (cursorLine < lines.length - 1) {
            setCursorLine(cursorLine + 1);
            setCursorColumn(
              Math.min(cursorColumn, lines[cursorLine + 1].length),
            );
          }
          break;
        case "home":
          setCursorColumn(0);
          break;
        case "end":
          setCursorColumn(currentLine.length);
          break;
      }
    },
    [lines, cursorLine, cursorColumn],
  );

  const setText = useCallback(
    (text: string) => {
      const newLines = text.split("\n");
      setLines(newLines);
      setCursorLine(Math.min(newLines.length - 1, cursorLine));
      setCursorColumn(0);
    },
    [cursorLine],
  );

  const getText = useCallback(() => {
    return lines.join("\n");
  }, [lines]);

  const setCursorPosition = useCallback(
    (line: number, column: number) => {
      setCursorLine(Math.max(0, Math.min(line, lines.length - 1)));
      setCursorColumn(Math.max(0, column));
    },
    [lines.length],
  );

  const getCurrentLine = useCallback(() => {
    return lines[cursorLine] || "";
  }, [lines, cursorLine]);

  const killLine = useCallback(() => {
    setDebugLog((prev) => [
      ...prev.slice(-4),
      `KILL LINE at pos ${cursorColumn}`,
    ]);

    const currentLine = lines[cursorLine] || "";
    if (cursorColumn < currentLine.length) {
      // Kill from cursor to end of line
      const newLine = currentLine.slice(0, cursorColumn);
      const newLines = [...lines];
      newLines[cursorLine] = newLine;
      setLines(newLines);
      // Cursor stays at same position
    }
  }, [lines, cursorLine, cursorColumn]);

  const killLineBackward = useCallback(() => {
    setDebugLog((prev) => [
      ...prev.slice(-4),
      `KILL LINE BACKWARD at pos ${cursorColumn}`,
    ]);

    const currentLine = lines[cursorLine] || "";
    if (cursorColumn > 0) {
      // Kill from beginning of line to cursor
      const newLine = currentLine.slice(cursorColumn);
      const newLines = [...lines];
      newLines[cursorLine] = newLine;
      setLines(newLines);
      setCursorColumn(0);
    }
  }, [lines, cursorLine, cursorColumn]);

  const addDebug = useCallback((message: string) => {
    setDebugLog((prev) => [...prev.slice(-4), message]);
  }, []);

  const operations: TextBufferOperations = {
    insertText,
    deleteChar,
    moveCursor,
    setText,
    getText,
    setCursorPosition,
    getCurrentLine,
    killLine,
    killLineBackward,
    addDebug,
  };

  return [state, operations];
}
