// ABOUTME: Pure utility functions for text rendering logic
// ABOUTME: Testable text manipulation and cursor positioning separated from UI

export interface CursorPosition {
  line: number;
  column: number;
}

export interface TextState {
  lines: string[];
  cursor: CursorPosition;
  isFocused: boolean;
}

export interface RenderableTextLine {
  beforeCursor: string;
  atCursor: string;
  afterCursor: string;
  isCurrentLine: boolean;
  isEmpty: boolean;
}

export const shouldShowPlaceholder = (
  lines: string[],
  isFocused: boolean
): boolean => {
  return !isFocused && lines.length === 1 && lines[0] === "";
};

export const getCurrentLine = (lines: string[], cursorLine: number): string => {
  return lines[cursorLine] || "";
};

export const splitLineAtCursor = (
  line: string,
  cursorColumn: number
): { before: string; at: string; after: string } => {
  const before = line.slice(0, cursorColumn);
  const at = line.slice(cursorColumn, cursorColumn + 1) || " ";
  const after = line.slice(cursorColumn + 1);
  
  return { before, at, after };
};

export const createRenderableLines = (
  lines: string[],
  cursorLine: number,
  cursorColumn: number,
  isFocused: boolean
): RenderableTextLine[] => {
  return lines.map((line, lineIndex) => {
    const isCurrentLine = lineIndex === cursorLine;
    const isEmpty = line.length === 0;
    
    if (isCurrentLine && isFocused) {
      const { before, at, after } = splitLineAtCursor(line, cursorColumn);
      return {
        beforeCursor: before,
        atCursor: at,
        afterCursor: after,
        isCurrentLine: true,
        isEmpty
      };
    }
    
    return {
      beforeCursor: line,
      atCursor: "",
      afterCursor: "",
      isCurrentLine: false,
      isEmpty
    };
  });
};

export const clampCursorPosition = (
  lines: string[],
  cursorLine: number,
  cursorColumn: number
): CursorPosition => {
  const maxLine = Math.max(0, lines.length - 1);
  const clampedLine = Math.max(0, Math.min(maxLine, cursorLine));
  
  const currentLine = lines[clampedLine] || "";
  const maxColumn = currentLine.length;
  const clampedColumn = Math.max(0, Math.min(maxColumn, cursorColumn));
  
  return {
    line: clampedLine,
    column: clampedColumn
  };
};

export const generateUniqueId = (): string => {
  return Math.random().toString(36).substring(7);
};

export const createLineKey = (instanceId: string, lineIndex: number): string => {
  return `${instanceId}-line-${lineIndex}`;
};

export const createCursorLineKey = (instanceId: string, lineIndex: number): string => {
  return `${instanceId}-cursor-line-${lineIndex}`;
};

export const isFirstEmptyLine = (lineIndex: number, line: string): boolean => {
  return lineIndex === 0 && line.length === 0;
};

export const shouldShowEmptyLinePlaceholder = (
  lineIndex: number,
  line: string,
  isCurrentLine: boolean,
  isFocused: boolean
): boolean => {
  return isFirstEmptyLine(lineIndex, line) && !isCurrentLine;
};

export interface TextDisplayConfig {
  showDebug: boolean;
  placeholder: string;
  debugLog: string[];
}

export const getDefaultDisplayConfig = (): TextDisplayConfig => ({
  showDebug: false,
  placeholder: "Type your message...",
  debugLog: []
});

export const mergeDisplayConfig = (
  partial: Partial<TextDisplayConfig>
): TextDisplayConfig => ({
  ...getDefaultDisplayConfig(),
  ...partial
});