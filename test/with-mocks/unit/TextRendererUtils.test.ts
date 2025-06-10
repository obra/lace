// ABOUTME: Unit tests for text renderer utility functions
// ABOUTME: Tests pure text manipulation and cursor positioning logic

import {
  shouldShowPlaceholder,
  getCurrentLine,
  splitLineAtCursor,
  createRenderableLines,
  clampCursorPosition,
  generateUniqueId,
  createLineKey,
  createCursorLineKey,
  isFirstEmptyLine,
  shouldShowEmptyLinePlaceholder,
  getDefaultDisplayConfig,
  mergeDisplayConfig
} from "@/ui/components/TextRendererUtils";

describe("TextRendererUtils", () => {
  describe("shouldShowPlaceholder", () => {
    test("should show placeholder when not focused and empty", () => {
      expect(shouldShowPlaceholder([""], false)).toBe(true);
    });

    test("should not show placeholder when focused", () => {
      expect(shouldShowPlaceholder([""], true)).toBe(false);
    });

    test("should not show placeholder when has content", () => {
      expect(shouldShowPlaceholder(["hello"], false)).toBe(false);
    });

    test("should not show placeholder with multiple lines", () => {
      expect(shouldShowPlaceholder(["", ""], false)).toBe(false);
    });
  });

  describe("getCurrentLine", () => {
    test("should return correct line", () => {
      const lines = ["first", "second", "third"];
      expect(getCurrentLine(lines, 0)).toBe("first");
      expect(getCurrentLine(lines, 1)).toBe("second");
      expect(getCurrentLine(lines, 2)).toBe("third");
    });

    test("should return empty string for out of bounds", () => {
      const lines = ["only line"];
      expect(getCurrentLine(lines, 5)).toBe("");
      expect(getCurrentLine(lines, -1)).toBe("");
    });

    test("should handle empty lines array", () => {
      expect(getCurrentLine([], 0)).toBe("");
    });
  });

  describe("splitLineAtCursor", () => {
    test("should split line at cursor position", () => {
      const result = splitLineAtCursor("hello world", 5);
      expect(result.before).toBe("hello");
      expect(result.at).toBe(" ");
      expect(result.after).toBe("world");
    });

    test("should handle cursor at beginning", () => {
      const result = splitLineAtCursor("test", 0);
      expect(result.before).toBe("");
      expect(result.at).toBe("t");
      expect(result.after).toBe("est");
    });

    test("should handle cursor at end", () => {
      const result = splitLineAtCursor("test", 4);
      expect(result.before).toBe("test");
      expect(result.at).toBe(" "); // Default space when beyond line
      expect(result.after).toBe("");
    });

    test("should handle cursor beyond line", () => {
      const result = splitLineAtCursor("hi", 10);
      expect(result.before).toBe("hi");
      expect(result.at).toBe(" ");
      expect(result.after).toBe("");
    });

    test("should handle empty line", () => {
      const result = splitLineAtCursor("", 0);
      expect(result.before).toBe("");
      expect(result.at).toBe(" ");
      expect(result.after).toBe("");
    });
  });

  describe("createRenderableLines", () => {
    test("should create renderable lines for focused cursor", () => {
      const lines = ["hello", "world"];
      const result = createRenderableLines(lines, 0, 2, true);

      expect(result).toHaveLength(2);
      
      // First line (with cursor)
      expect(result[0].beforeCursor).toBe("he");
      expect(result[0].atCursor).toBe("l");
      expect(result[0].afterCursor).toBe("lo");
      expect(result[0].isCurrentLine).toBe(true);
      expect(result[0].isEmpty).toBe(false);

      // Second line (no cursor)
      expect(result[1].beforeCursor).toBe("world");
      expect(result[1].atCursor).toBe("");
      expect(result[1].afterCursor).toBe("");
      expect(result[1].isCurrentLine).toBe(false);
      expect(result[1].isEmpty).toBe(false);
    });

    test("should create renderable lines for unfocused text", () => {
      const lines = ["test"];
      const result = createRenderableLines(lines, 0, 0, false);

      expect(result[0].beforeCursor).toBe("test");
      expect(result[0].atCursor).toBe("");
      expect(result[0].afterCursor).toBe("");
      expect(result[0].isCurrentLine).toBe(false);
    });

    test("should handle empty lines", () => {
      const lines = ["", "content", ""];
      const result = createRenderableLines(lines, 1, 0, true);

      expect(result[0].isEmpty).toBe(true);
      expect(result[1].isEmpty).toBe(false);
      expect(result[2].isEmpty).toBe(true);
    });
  });

  describe("clampCursorPosition", () => {
    test("should clamp cursor within bounds", () => {
      const lines = ["short", "much longer line"];
      
      // Normal position
      expect(clampCursorPosition(lines, 1, 5)).toEqual({ line: 1, column: 5 });
      
      // Clamp line
      expect(clampCursorPosition(lines, 5, 0)).toEqual({ line: 1, column: 0 });
      expect(clampCursorPosition(lines, -1, 0)).toEqual({ line: 0, column: 0 });
      
      // Clamp column
      expect(clampCursorPosition(lines, 0, 10)).toEqual({ line: 0, column: 5 }); // "short".length = 5
      expect(clampCursorPosition(lines, 1, -1)).toEqual({ line: 1, column: 0 });
    });

    test("should handle empty lines array", () => {
      expect(clampCursorPosition([], 0, 0)).toEqual({ line: 0, column: 0 });
      expect(clampCursorPosition([], 5, 10)).toEqual({ line: 0, column: 0 });
    });

    test("should handle single empty line", () => {
      expect(clampCursorPosition([""], 0, 5)).toEqual({ line: 0, column: 0 });
    });
  });

  describe("generateUniqueId", () => {
    test("should generate different IDs", () => {
      const id1 = generateUniqueId();
      const id2 = generateUniqueId();
      
      expect(id1).not.toBe(id2);
      expect(typeof id1).toBe("string");
      expect(id1.length).toBeGreaterThan(0);
    });
  });

  describe("createLineKey and createCursorLineKey", () => {
    test("should create consistent keys", () => {
      const instanceId = "test-instance";
      
      expect(createLineKey(instanceId, 0)).toBe("test-instance-line-0");
      expect(createLineKey(instanceId, 5)).toBe("test-instance-line-5");
      
      expect(createCursorLineKey(instanceId, 0)).toBe("test-instance-cursor-line-0");
      expect(createCursorLineKey(instanceId, 3)).toBe("test-instance-cursor-line-3");
    });
  });

  describe("isFirstEmptyLine", () => {
    test("should identify first empty line", () => {
      expect(isFirstEmptyLine(0, "")).toBe(true);
      expect(isFirstEmptyLine(0, "content")).toBe(false);
      expect(isFirstEmptyLine(1, "")).toBe(false);
    });
  });

  describe("shouldShowEmptyLinePlaceholder", () => {
    test("should show placeholder for first empty non-current line", () => {
      expect(shouldShowEmptyLinePlaceholder(0, "", false, true)).toBe(true);
      expect(shouldShowEmptyLinePlaceholder(0, "", false, false)).toBe(true);
    });

    test("should not show placeholder for current line", () => {
      expect(shouldShowEmptyLinePlaceholder(0, "", true, true)).toBe(false);
    });

    test("should not show placeholder for non-empty line", () => {
      expect(shouldShowEmptyLinePlaceholder(0, "content", false, true)).toBe(false);
    });

    test("should not show placeholder for non-first line", () => {
      expect(shouldShowEmptyLinePlaceholder(1, "", false, true)).toBe(false);
    });
  });

  describe("getDefaultDisplayConfig and mergeDisplayConfig", () => {
    test("should return default configuration", () => {
      const config = getDefaultDisplayConfig();
      
      expect(config.showDebug).toBe(false);
      expect(config.placeholder).toBe("Type your message...");
      expect(config.debugLog).toEqual([]);
    });

    test("should merge partial configuration", () => {
      const config = mergeDisplayConfig({
        showDebug: true,
        placeholder: "Custom placeholder"
      });
      
      expect(config.showDebug).toBe(true);
      expect(config.placeholder).toBe("Custom placeholder");
      expect(config.debugLog).toEqual([]); // Should keep default
    });

    test("should handle empty partial configuration", () => {
      const config = mergeDisplayConfig({});
      
      expect(config).toEqual(getDefaultDisplayConfig());
    });
  });
});