// ABOUTME: Jest tests for FilesAndDirectoriesCompletionProvider completion behavior  
// ABOUTME: Tests fuzzy completion logic, context handling, and filtering with mock filesystem data

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import * as path from "path";

// Mock fs module for ESM
jest.unstable_mockModule("fs", () => ({
  existsSync: jest.fn(),
  statSync: jest.fn(),
  promises: {
    readdir: jest.fn(),
    stat: jest.fn(),
  },
}));

// Import after mocking
const { FilesAndDirectoriesCompletionProvider } = await import(
  "@/ui/completion/FilesAndDirectoriesCompletionProvider.js"
);
const fs = await import("fs");

describe("FilesAndDirectoriesCompletionProvider", () => {
  let provider: InstanceType<typeof FilesAndDirectoriesCompletionProvider>;
  const testCwd = "/test/project";

  // Mock completion data representing a project structure
  const createMockEntries = (entries: Array<{name: string, isDirectory: boolean}>) => {
    return entries.map(entry => ({
      name: entry.name,
      isDirectory: () => entry.isDirectory,
      isFile: () => !entry.isDirectory,
    }));
  };

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new FilesAndDirectoriesCompletionProvider({
      cwd: testCwd,
      maxItems: 20,
      showHidden: false,
    });

    // Set up default mock behavior
    (fs.existsSync as jest.MockedFunction<any>).mockReturnValue(true);
    (fs.statSync as jest.MockedFunction<any>).mockReturnValue({
      isDirectory: () => false,
      size: 1024,
    });
    (fs.promises.stat as jest.MockedFunction<any>).mockResolvedValue({
      isDirectory: () => false,
      size: 1024,
    });
  });

  describe("Context Handling", () => {
    it("should handle non-command contexts", () => {
      const commandContext = {
        line: "/help",
        column: 5,
        lineNumber: 0,
        fullText: "/help",
        cwd: testCwd,
      };

      const fileContext = {
        line: "some file.txt",
        column: 9,
        lineNumber: 0,
        fullText: "some file.txt",
        cwd: testCwd,
      };

      expect(provider.canHandle(commandContext)).toBe(false);
      expect(provider.canHandle(fileContext)).toBe(true);
    });

    it("should handle multiline contexts", () => {
      const multilineContext = {
        line: "edit some file",
        column: 14,
        lineNumber: 1,
        fullText: "first line\nedit some file",
        cwd: testCwd,
      };

      expect(provider.canHandle(multilineContext)).toBe(true);
    });
  });

  describe("Basic Completion Functionality", () => {
    it("should return completions for file patterns", async () => {
      const mockEntries = createMockEntries([
        { name: "Button.tsx", isDirectory: false },
        { name: "Input.tsx", isDirectory: false },
        { name: "components", isDirectory: true },
      ]);

      (fs.promises.readdir as jest.MockedFunction<any>).mockResolvedValue(mockEntries);

      const result = await provider.getCompletions("button");

      expect(result.items.length).toBeGreaterThan(0);
      expect(result.prefix).toBe("button");

      // Should find Button.tsx
      const buttonFile = result.items.find((item) =>
        item.value.toLowerCase().includes("button"),
      );
      expect(buttonFile).toBeDefined();
      expect(buttonFile?.type).toBe("file");
    });

    it("should handle basic completion functionality", async () => {
      const mockEntries = createMockEntries([
        { name: "src", isDirectory: true },
        { name: "package.json", isDirectory: false },
      ]);

      (fs.promises.readdir as jest.MockedFunction<any>).mockResolvedValue(mockEntries);

      const result = await provider.getCompletions("s");

      expect(result.prefix).toBe("s");
      expect(result.items.length).toBeGreaterThan(0);
      
      // Should find items that match the search
      const matchingItems = result.items.filter(item => 
        item.value.toLowerCase().includes("s")
      );
      expect(matchingItems.length).toBeGreaterThan(0);
    });

    it("should find files in current directory", async () => {
      const mockEntries = createMockEntries([
        { name: "config.js", isDirectory: false },
        { name: "utils.js", isDirectory: false },
        { name: "src", isDirectory: true },
      ]);

      (fs.promises.readdir as jest.MockedFunction<any>).mockResolvedValue(mockEntries);

      const result = await provider.getCompletions("config");

      // Should find config.js
      const configFile = result.items.find((item) =>
        item.value.includes("config.js"),
      );
      expect(configFile).toBeDefined();
      expect(configFile?.type).toBe("file");
    });
  });

  describe("Path-based Completion", () => {
    it("should handle explicit path completion", async () => {
      // Mock directory structure for path completion
      (fs.promises.readdir as jest.MockedFunction<any>).mockImplementation(async (dirPath: string) => {
        if (dirPath.endsWith("src")) {
          return createMockEntries([
            { name: "config.js", isDirectory: false },
            { name: "utils.js", isDirectory: false },
            { name: "components", isDirectory: true },
          ]);
        }
        return [];
      });

      const result = await provider.getCompletions("src/");

      expect(result.items.length).toBeGreaterThan(0);
      expect(result.prefix).toBe("src/");
      
      const configFile = result.items.find(item => item.value.includes("config.js"));
      expect(configFile).toBeDefined();
    });

    it("should handle nested directory traversal", async () => {
      // Mock nested directory structure
      (fs.promises.readdir as jest.MockedFunction<any>).mockImplementation(async (dirPath: string) => {
        if (dirPath.includes("components")) {
          return createMockEntries([
            { name: "Button.tsx", isDirectory: false },
            { name: "Input.tsx", isDirectory: false },
          ]);
        }
        if (dirPath.endsWith("src")) {
          return createMockEntries([
            { name: "components", isDirectory: true },
          ]);
        }
        return createMockEntries([
          { name: "src", isDirectory: true },
        ]);
      });

      const result = await provider.getCompletions("src/components/");

      expect(result.prefix).toBe("src/components/");
    });
  });

  describe("Error Handling", () => {
    it("should handle filesystem errors gracefully", async () => {
      (fs.promises.readdir as jest.MockedFunction<any>).mockRejectedValue(
        new Error("Permission denied"),
      );

      const result = await provider.getCompletions("test");

      expect(result.items).toEqual([]);
      expect(result.prefix).toBe("test");
      expect(result.hasMore).toBe(false);
    });

    it("should handle non-existent directories", async () => {
      (fs.existsSync as jest.MockedFunction<any>).mockReturnValue(false);

      const result = await provider.getCompletions("nonexistent/path");

      expect(result.items).toEqual([]);
      expect(result.prefix).toBe("nonexistent/path");
      expect(result.hasMore).toBe(false);
    });

    it("should respect maxItems limit", async () => {
      // Mock many files to test limit
      const manyEntries = Array.from({ length: 30 }, (_, i) => ({
        name: `file${i}.txt`,
        isDirectory: () => false,
        isFile: () => true,
      }));
      
      (fs.promises.readdir as jest.MockedFunction<any>).mockResolvedValue(manyEntries);

      const result = await provider.getCompletions("file");

      expect(result.items.length).toBeLessThanOrEqual(20); // maxItems = 20
      expect(result.hasMore).toBe(true);
    });
  });

  describe("Configuration Management", () => {
    it("should update current working directory", () => {
      const newCwd = "/new/path";
      provider.setCwd(newCwd);

      expect(provider.getCwd()).toBe(path.resolve(newCwd));
    });

    it("should resolve relative paths to absolute", () => {
      provider.setCwd("relative/path");

      expect(path.isAbsolute(provider.getCwd())).toBe(true);
    });

    it("should manage hidden file visibility", () => {
      const settings = provider.getSettings();
      expect(settings.showHidden).toBe(false);

      provider.setShowHidden(true);
      expect(provider.getSettings().showHidden).toBe(true);
    });

    it("should maintain completion behavior after configuration changes", async () => {
      const mockEntries = createMockEntries([
        { name: "test.txt", isDirectory: false },
      ]);
      (fs.promises.readdir as jest.MockedFunction<any>).mockResolvedValue(mockEntries);

      provider.setCwd("/different/path");
      provider.setShowHidden(true);

      const result = await provider.getCompletions("test");
      
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.prefix).toBe("test");
    });
  });

  describe("Integration with Completion Manager", () => {
    it("should return well-formed completion results", async () => {
      const mockEntries = createMockEntries([
        { name: "src", isDirectory: true },
        { name: "package.json", isDirectory: false },
      ]);
      (fs.promises.readdir as jest.MockedFunction<any>).mockResolvedValue(mockEntries);

      const result = await provider.getCompletions("src");

      expect(result).toHaveProperty("items");
      expect(result).toHaveProperty("prefix");
      expect(result).toHaveProperty("hasMore");
      expect(Array.isArray(result.items)).toBe(true);
      expect(typeof result.prefix).toBe("string");
      expect(typeof result.hasMore).toBe("boolean");

      // Each item should have required properties
      result.items.forEach(item => {
        expect(item).toHaveProperty("type");
        expect(item).toHaveProperty("value");
        expect(["file", "directory"]).toContain(item.type);
        expect(typeof item.value).toBe("string");
      });
    });

    it("should handle context correctly for completion triggering", () => {
      const validContext = {
        line: "edit some-file.txt",
        column: 14,
        lineNumber: 0,
        fullText: "edit some-file.txt",
        cwd: testCwd,
      };

      const commandContext = {
        line: "/help",
        column: 3,
        lineNumber: 0,
        fullText: "/help",
        cwd: testCwd,
      };

      expect(provider.canHandle(validContext)).toBe(true);
      expect(provider.canHandle(commandContext)).toBe(false);
    });
  });
});