// ABOUTME: Unit tests for FileCompletionProvider completion behavior
// ABOUTME: Tests completion logic, filtering, and context handling with mock filesystem data

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import * as path from "path";

// Mock fs module for ESM
jest.unstable_mockModule("fs", () => ({
  existsSync: jest.fn(),
  statSync: jest.fn(),
  promises: {
    readdir: jest.fn(),
  },
}));

// Import after mocking
const { FileCompletionProvider } = await import(
  "@/ui/completion/FileCompletionProvider.js"
);
const fs = await import("fs");

describe("FileCompletionProvider", () => {
  let provider;
  let mockCwd;

  // Mock completion data representing common files
  const mockEntries = [
    { name: "file1.txt", isDirectory: () => false },
    { name: "file2.js", isDirectory: () => false },
    { name: "subdir", isDirectory: () => true },
    { name: ".hidden", isDirectory: () => false },
    { name: ".gitignore", isDirectory: () => false },
    { name: "afile.txt", isDirectory: () => false },
    { name: "adir", isDirectory: () => true },
    { name: "mydir", isDirectory: () => true },
  ];

  beforeEach(() => {
    mockCwd = "/test/dir";
    provider = new FileCompletionProvider({ cwd: mockCwd, maxItems: 10 });

    // Reset mocks
    jest.clearAllMocks();

    // Set up default mock behavior
    fs.existsSync.mockReturnValue(true);
    fs.promises.readdir.mockResolvedValue(mockEntries);
    fs.statSync.mockReturnValue({
      isDirectory: () => false,
      size: 1024,
    });
  });

  describe("canHandle", () => {
    it("should handle non-command contexts", () => {
      const context = {
        line: "some text",
        column: 5,
        lineNumber: 0,
        fullText: "some text",
      };

      expect(provider.canHandle(context)).toBe(true);
    });

    it("should not handle slash commands on first line", () => {
      const context = {
        line: "/help",
        column: 5,
        lineNumber: 0,
        fullText: "/help",
      };

      expect(provider.canHandle(context)).toBe(false);
    });

    it("should handle slash commands on non-first lines", () => {
      const context = {
        line: "/some/path",
        column: 5,
        lineNumber: 1,
        fullText: "first line\n/some/path",
      };

      expect(provider.canHandle(context)).toBe(true);
    });
  });

  describe("getCompletions", () => {
    it("should return completions for matching files", async () => {
      const result = await provider.getCompletions("file");

      expect(result.items.length).toBeGreaterThan(0);
      expect(result.prefix).toBe("file");

      // Should find matching files
      const file1 = result.items.find((item) =>
        item.value.includes("file1.txt"),
      );
      expect(file1).toBeDefined();
      expect(file1.type).toBe("file");

      const file2 = result.items.find((item) =>
        item.value.includes("file2.js"),
      );
      expect(file2).toBeDefined();
      expect(file2.type).toBe("file");
    });

    it("should prioritize directories over files", async () => {
      const result = await provider.getCompletions("a");

      // Should find both afile.txt and adir
      const dirItem = result.items.find(item => item.value.includes("adir"));
      const fileItem = result.items.find(item => item.value.includes("afile.txt"));
      
      expect(dirItem).toBeDefined();
      expect(fileItem).toBeDefined();
      expect(dirItem.type).toBe("directory");
      expect(fileItem.type).toBe("file");

      // Directory should come first in results
      const dirIndex = result.items.findIndex(item => item.value.includes("adir"));
      const fileIndex = result.items.findIndex(item => item.value.includes("afile.txt"));
      expect(dirIndex).toBeLessThan(fileIndex);
    });

    it("should add trailing slash to directories", async () => {
      const result = await provider.getCompletions("my");

      const dir = result.items.find((item) => item.type === "directory");
      expect(dir).toBeDefined();
      expect(dir.value).toMatch(/\/$/);
      expect(dir.value).toContain("mydir/");
    });

    it("should handle no matches gracefully", async () => {
      // Mock no matching entries
      const noMatchEntries = [
        { name: "other.txt", isDirectory: () => false },
      ];
      fs.promises.readdir.mockResolvedValue(noMatchEntries);

      const result = await provider.getCompletions("nomatch");

      expect(result.items).toHaveLength(0);
      expect(result.prefix).toBe("nomatch");
      expect(result.hasMore).toBe(false);
    });

    it("should handle filesystem errors gracefully", async () => {
      // Mock filesystem error
      fs.promises.readdir.mockRejectedValue(new Error("Access denied"));

      const result = await provider.getCompletions("test");

      expect(result.items).toHaveLength(0);
      expect(result.prefix).toBe("test");
      expect(result.hasMore).toBe(false);
    });

    it("should filter hidden files unless prefix starts with dot", async () => {
      const result = await provider.getCompletions("");

      // Should not include hidden files for empty prefix
      const hiddenFile = result.items.find((item) =>
        item.value.startsWith("."),
      );
      expect(hiddenFile).toBeUndefined();

      // Should include visible files
      const visibleFiles = result.items.filter((item) =>
        !item.value.startsWith("."),
      );
      expect(visibleFiles.length).toBeGreaterThan(0);
    });

    it("should include hidden files when prefix starts with dot", async () => {
      const result = await provider.getCompletions(".h");

      const hiddenFile = result.items.find((item) =>
        item.value.includes(".hidden"),
      );
      expect(hiddenFile).toBeDefined();
      expect(hiddenFile.type).toBe("file");
    });

    it("should respect maxItems limit", async () => {
      // Mock many files to test limit
      const manyEntries = Array.from({ length: 20 }, (_, i) => ({
        name: `file${i}.txt`,
        isDirectory: () => false,
      }));
      
      fs.promises.readdir.mockResolvedValue(manyEntries);

      const result = await provider.getCompletions("file");

      expect(result.items.length).toBeLessThanOrEqual(10); // maxItems = 10
      expect(result.hasMore).toBe(true);
    });

    it("should handle empty directory gracefully", async () => {
      fs.promises.readdir.mockResolvedValue([]);

      const result = await provider.getCompletions("empty");

      expect(result.items).toHaveLength(0);
      expect(result.prefix).toBe("empty");
      expect(result.hasMore).toBe(false);
    });

    it("should provide prefix correctly for partial matches", async () => {
      const result = await provider.getCompletions("fil");

      expect(result.prefix).toBe("fil");
      
      // Should find files that match the prefix
      const matchingItems = result.items.filter(item => 
        item.value.toLowerCase().includes("fil")
      );
      expect(matchingItems.length).toBeGreaterThan(0);
    });
  });

  describe("Configuration management", () => {
    it("should update current working directory", () => {
      const newCwd = "/new/path";
      provider.setCwd(newCwd);

      expect(provider.getCwd()).toBe(path.resolve(newCwd));
    });

    it("should resolve relative paths to absolute", () => {
      provider.setCwd("relative/path");

      expect(path.isAbsolute(provider.getCwd())).toBe(true);
    });

    it("should maintain completion behavior after cwd change", async () => {
      provider.setCwd("/different/path");

      const result = await provider.getCompletions("file");
      
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.prefix).toBe("file");
    });
  });
});