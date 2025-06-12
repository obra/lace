// ABOUTME: Unit tests for tool system components
// ABOUTME: Tests individual tools and tool registry functionality

import {
  test,
  describe,
  beforeEach,
  afterEach,
  TestHarness,
  assert,
  utils,
} from "../../test-harness.js";

describe("Tool System", () => {
  let harness;

  beforeEach(async () => {
    harness = new TestHarness();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  describe("ToolRegistry", () => {
    test("should initialize with core tools", async () => {
      const { ToolRegistry } = await import(
        "@/tools/tool-registry.js"
      );
      const registry = new ToolRegistry();
      await registry.initialize();

      const tools = registry.listTools();
      assert.ok(tools.includes("shell"), "Should include shell tool");
      assert.ok(tools.includes("read_file"), "Should include read_file tool");
      assert.ok(tools.includes("write_file"), "Should include write_file tool");
      assert.ok(tools.includes("list_files"), "Should include list_files tool");
      assert.ok(tools.includes("file_search"), "Should include file_search tool");
      assert.ok(tools.includes("javascript"), "Should include javascript tool");
      assert.ok(tools.includes("agent_delegate"), "Should include agent_delegate tool");
    });

    test("should provide tool schemas", async () => {
      const { ToolRegistry } = await import(
        "@/tools/tool-registry.js"
      );
      const registry = new ToolRegistry();
      await registry.initialize();

      const schema = registry.getToolSchema("read_file");
      assert.ok(schema, "Should have read_file tool schema");
      assert.ok(schema.methods, "Schema should have methods");
      assert.ok(schema.methods.file_read, "Should have file_read method");
    });

    test("should execute tool methods", async () => {
      const { ToolRegistry } = await import(
        "@/tools/tool-registry.js"
      );
      const registry = new ToolRegistry();
      await registry.initialize();

      const tempFile = await harness.createTempFile("test content");
      const result = await registry.callTool("read_file", "file_read", {
        path: tempFile,
      });

      assert.ok(result.content, "File read should return content");
      assert.strictEqual(
        result.content,
        "test content",
        "Should read correct content",
      );
    });
  });

  describe("JavaScriptTool", () => {
    test("should evaluate simple expressions", async () => {
      const { JavaScriptTool } = await import(
        "@/tools/javascript.js"
      );
      const tool = new JavaScriptTool();

      const result = await tool.execute("js_eval", { code: "2 + 3" });
      assert.ok(result.success, "Evaluation should succeed");
      assert.strictEqual(result.data.result, 5, "Should calculate correctly");
    });

    test("should handle errors gracefully", async () => {
      const { JavaScriptTool } = await import(
        "@/tools/javascript.js"
      );
      const tool = new JavaScriptTool();

      const result = await tool.execute("js_eval", { code: "undefined.property" });
      assert.ok(!result.success, "Should fail for invalid code");
      assert.ok(result.error, "Should provide error message");
    });

    test("should provide console output", async () => {
      const { JavaScriptTool } = await import(
        "@/tools/javascript.js"
      );
      const tool = new JavaScriptTool();

      const result = await tool.execute("js_eval", { code: 'console.log("test"); 42' });
      assert.ok(result.success, "Evaluation should succeed");
      assert.strictEqual(result.data.result, 42, "Should return result");
      assert.ok(result.data.output.length > 0, "Should capture console output");
    });
  });

  describe("File Tools", () => {
    test("should read and write files", async () => {
      const { ReadFileTool } = await import("@/tools/read-file.js");
      const { WriteFileTool } = await import("@/tools/write-file.js");
      const readTool = new ReadFileTool();
      const writeTool = new WriteFileTool();

      const tempFile = await harness.createTempFile();

      // Write content
      const writeResult = await writeTool.execute("file_write", {
        path: tempFile,
        content: "hello world",
      });
      assert.ok(writeResult.success, "Write should succeed");
      assert.ok(writeResult.data.bytes_written > 0, "Write should return bytes written");

      // Read content
      const readResult = await readTool.execute("file_read", { path: tempFile });
      assert.ok(readResult.success, "Read should succeed");
      assert.strictEqual(
        readResult.data.content,
        "hello world",
        "Should read written content",
      );
    });

    test("should list directory contents", async () => {
      const { ListFilesTool } = await import("@/tools/list-files.js");
      const tool = new ListFilesTool();

      const result = await tool.execute("file_list", { path: "." });
      assert.ok(result.success, "List should succeed");
      assert.ok(Array.isArray(result.data.entries), "Should return array of entries");
      assert.ok(result.data.entries.length > 0, "Should find files in current directory");
    });

    test("should handle non-existent files", async () => {
      const { ReadFileTool } = await import("@/tools/read-file.js");
      const tool = new ReadFileTool();

      const result = await tool.execute("file_read", { path: "/non/existent/file.txt" });
      assert.ok(!result.success, "Should fail for non-existent file");
      assert.ok(result.error, "Should provide error message");
    });
  });

  describe("ShellTool", () => {
    test("should execute simple commands", async () => {
      const { ShellTool } = await import("@/tools/shell.js");
      const tool = new ShellTool();

      const result = await tool.execute("shell_exec", { command: 'echo "test"' });
      assert.ok(result.success, "Command should succeed");
      assert.strictEqual(
        result.data.stdout.trim(),
        "test",
        "Should return command output",
      );
      assert.strictEqual(result.data.exitCode, 0, "Should have exit code 0");
    });

    test("should handle command errors", async () => {
      const { ShellTool } = await import("@/tools/shell.js");
      const tool = new ShellTool();

      const result = await tool.execute("shell_exec", { command: "nonexistentcommand" });
      assert.ok(result.success, "Command execution should succeed (non-zero exit code is handled)");
      assert.ok(result.data.exitCode !== 0, "Should have non-zero exit code for invalid command");
    });

    test("should respect working directory", async () => {
      const { ShellTool } = await import("@/tools/shell.js");
      const tool = new ShellTool();

      const result = await tool.execute("shell_exec", { command: "pwd", cwd: "/tmp" });
      assert.ok(result.success, "Command should succeed");
      assert.ok(
        result.data.stdout.includes("/tmp"),
        "Should execute in specified directory",
      );
    });
  });
});
