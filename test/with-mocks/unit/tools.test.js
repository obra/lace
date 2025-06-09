// ABOUTME: Unit tests for tool system components
// ABOUTME: Tests individual tools and tool registry functionality

import { test, describe, beforeEach, afterEach } from '../../test-harness.js';
import { TestHarness, assert, utils } from '../../test-harness.js';

describe('Tool System', () => {
  let harness;

  beforeEach(async () => {
    harness = new TestHarness();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  describe('ToolRegistry', () => {
    test('should initialize with core tools', async () => {
      const { ToolRegistry } = await import('../../../src/tools/tool-registry.js');
      const registry = new ToolRegistry();
      await registry.initialize();

      const tools = registry.listTools();
      assert.ok(tools.includes('shell'), 'Should include shell tool');
      assert.ok(tools.includes('file'), 'Should include file tool');
      assert.ok(tools.includes('javascript'), 'Should include javascript tool');
      assert.ok(tools.includes('search'), 'Should include search tool');
    });

    test('should provide tool schemas', async () => {
      const { ToolRegistry } = await import('../../../src/tools/tool-registry.js');
      const registry = new ToolRegistry();
      await registry.initialize();

      const schema = registry.getToolSchema('file');
      assert.ok(schema, 'Should have file tool schema');
      assert.ok(schema.methods, 'Schema should have methods');
      assert.ok(schema.methods.read, 'Should have read method');
      assert.ok(schema.methods.write, 'Should have write method');
    });

    test('should execute tool methods', async () => {
      const { ToolRegistry } = await import('../../../src/tools/tool-registry.js');
      const registry = new ToolRegistry();
      await registry.initialize();

      const tempFile = await harness.createTempFile('test content');
      const result = await registry.callTool('file', 'read', { path: tempFile });
      
      assert.ok(result.success, 'File read should succeed');
      assert.strictEqual(result.content, 'test content', 'Should read correct content');
    });
  });

  describe('JavaScriptTool', () => {
    test('should evaluate simple expressions', async () => {
      const { JavaScriptTool } = await import('../../../src/tools/javascript-tool.js');
      const tool = new JavaScriptTool();

      const result = await tool.evaluate({ code: '2 + 3' });
      assert.ok(result.success, 'Evaluation should succeed');
      assert.strictEqual(result.result, 5, 'Should calculate correctly');
    });

    test('should handle calculation method', async () => {
      const { JavaScriptTool } = await import('../../../src/tools/javascript-tool.js');
      const tool = new JavaScriptTool();

      const result = await tool.calculate({ expression: '6 * 12' });
      assert.ok(result.success, 'Calculation should succeed');
      assert.strictEqual(result.result, 72, 'Should multiply correctly');
    });

    test('should handle errors gracefully', async () => {
      const { JavaScriptTool } = await import('../../../src/tools/javascript-tool.js');
      const tool = new JavaScriptTool();

      const result = await tool.evaluate({ code: 'undefined.property' });
      assert.ok(!result.success, 'Should fail for invalid code');
      assert.ok(result.error, 'Should provide error message');
    });

    test('should provide console output', async () => {
      const { JavaScriptTool } = await import('../../../src/tools/javascript-tool.js');
      const tool = new JavaScriptTool();

      const result = await tool.evaluate({ code: 'console.log("test"); 42' });
      assert.ok(result.success, 'Evaluation should succeed');
      assert.strictEqual(result.result, 42, 'Should return result');
      assert.ok(result.output.length > 0, 'Should capture console output');
    });
  });

  describe('FileTool', () => {
    test('should read and write files', async () => {
      const { FileTool } = await import('../../../src/tools/file-tool.js');
      const tool = new FileTool();

      const tempFile = await harness.createTempFile();
      
      // Write content
      const writeResult = await tool.write({ path: tempFile, content: 'hello world' });
      assert.ok(writeResult.success, 'Write should succeed');

      // Read content
      const readResult = await tool.read({ path: tempFile });
      assert.ok(readResult.success, 'Read should succeed');
      assert.strictEqual(readResult.content, 'hello world', 'Should read written content');
    });

    test('should list directory contents', async () => {
      const { FileTool } = await import('../../../src/tools/file-tool.js');
      const tool = new FileTool();

      const result = await tool.list({ path: './src' });
      assert.ok(result.success, 'List should succeed');
      assert.ok(Array.isArray(result.files), 'Should return array of files');
      assert.ok(result.files.length > 0, 'Should find files in src directory');
    });

    test('should handle non-existent files', async () => {
      const { FileTool } = await import('../../../src/tools/file-tool.js');
      const tool = new FileTool();

      const result = await tool.read({ path: '/non/existent/file.txt' });
      assert.ok(!result.success, 'Should fail for non-existent file');
      assert.ok(result.error, 'Should provide error message');
    });
  });

  describe('ShellTool', () => {
    test('should execute simple commands', async () => {
      const { ShellTool } = await import('../../../src/tools/shell-tool.js');
      const tool = new ShellTool();

      const result = await tool.execute({ command: 'echo "test"' });
      assert.ok(result.success, 'Command should succeed');
      assert.strictEqual(result.stdout.trim(), 'test', 'Should return command output');
      assert.strictEqual(result.exitCode, 0, 'Should have exit code 0');
    });

    test('should handle command errors', async () => {
      const { ShellTool } = await import('../../../src/tools/shell-tool.js');
      const tool = new ShellTool();

      const result = await tool.execute({ command: 'nonexistentcommand' });
      assert.ok(!result.success, 'Should fail for invalid command');
      assert.ok(result.exitCode !== 0, 'Should have non-zero exit code');
    });

    test('should respect working directory', async () => {
      const { ShellTool } = await import('../../../src/tools/shell-tool.js');
      const tool = new ShellTool();

      const result = await tool.execute({ command: 'pwd', cwd: '/tmp' });
      assert.ok(result.success, 'Command should succeed');
      assert.ok(result.stdout.includes('/tmp'), 'Should execute in specified directory');
    });
  });
});