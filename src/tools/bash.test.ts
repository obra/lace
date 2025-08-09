// ABOUTME: Comprehensive tests for BashTool implementation
// ABOUTME: Tests command execution, error handling, and success/failure distinction

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { BashTool, type BashOutput } from '~/tools/implementations/bash';
import type { ToolContext } from '~/tools/types';

describe('BashTool', () => {
  let bashTool: BashTool;
  let testTempDir: string;
  let toolContext: ToolContext;

  beforeEach(() => {
    bashTool = new BashTool();

    // Create unique temp directory for this test
    testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-tool-test-'));

    // Create ToolContext with temp directory
    toolContext = {
      signal: new AbortController().signal,
      toolTempDir: testTempDir,
    };
  });

  afterEach(() => {
    // Clean up temp directory
    if (testTempDir && fs.existsSync(testTempDir)) {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    }
  });

  describe('Tool metadata', () => {
    it('should have correct name and description', () => {
      expect(bashTool.name).toBe('bash');
      expect(bashTool.description).toBe(
        `Execute shell commands in isolated bash processes. Each call is independent - no state persists between calls.
Output truncated to first 100 + last 50 lines. Chain commands with && or ; for sequential operations.
Exit codes shown even for successful tool execution. Working directory persists within session.`
      );
    });

    it('should have proper input schema', () => {
      const schema = bashTool.inputSchema;
      expect(schema.type).toBe('object');
      expect(schema.properties.command).toBeDefined();
      expect(schema.properties.command.type).toBe('string');
      expect(schema.properties.command).toBeDefined();
      expect(schema.required).toContain('command');
    });

    it('should be marked as destructive', () => {
      expect(bashTool.annotations?.destructiveHint).toBe(true);
    });
  });

  describe('Input validation', () => {
    it('should reject empty command', async () => {
      const result = await bashTool.execute(
        { command: '' },
        { signal: new AbortController().signal }
      );

      expect(result.status).not.toBe('completed');
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('Cannot be empty');
    });

    it('should reject non-string command', async () => {
      const result = await bashTool.execute(
        { command: 123 },
        { signal: new AbortController().signal }
      );

      expect(result.status).not.toBe('completed');
      expect(result.content[0].text).toContain('Validation failed');
    });

    it('should reject missing command', async () => {
      const result = await bashTool.execute({}, { signal: new AbortController().signal });

      expect(result.status).not.toBe('completed');
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('Required');
    });
  });

  describe('Successful command execution (exit code 0)', () => {
    it('should execute simple commands successfully', async () => {
      const result = await bashTool.execute({ command: 'echo "hello world"' }, toolContext);

      expect(result.status).toBe('completed');

      const output = JSON.parse(result.content[0].text!) as BashOutput;
      expect(output.exitCode).toBe(0);
      expect(output.stdoutPreview).toBe('hello world\n');
      expect(output.stderrPreview).toBe('');
      expect(output.command).toBe('echo "hello world"');
      expect(typeof output.runtime).toBe('number');
      expect(output.outputFiles.stdout).toBeDefined();
      expect(output.outputFiles.stderr).toBeDefined();
      expect(output.outputFiles.combined).toBeDefined();
    });

    it('should handle commands with no output', async () => {
      const result = await bashTool.execute({ command: 'true' }, toolContext);

      expect(result.status).toBe('completed');

      const output = JSON.parse(result.content[0].text!) as BashOutput;
      expect(output.exitCode).toBe(0);
      expect(output.stdoutPreview).toBe('');
      expect(output.stderrPreview).toBe('');
      expect(output.command).toBe('true');
      expect(typeof output.runtime).toBe('number');
    });
  });

  describe('Command execution with non-zero exit codes', () => {
    it('should handle commands that return non-zero exit codes as tool success', async () => {
      // `false` command always returns exit code 1
      const result = await bashTool.execute({ command: 'false' }, toolContext);

      // Tool should succeed because it executed the command successfully
      expect(result.status).toBe('completed');

      const output = JSON.parse(result.content[0].text!) as BashOutput;
      expect(output.exitCode).toBe(1); // Command failed, but tool succeeded
      expect(output.stdoutPreview).toBe('');
      expect(output.command).toBe('false');
    });

    it('should handle grep with no matches (exit code 1)', async () => {
      const result = await bashTool.execute(
        {
          command: 'echo "hello" | grep "world"',
        },
        toolContext
      );

      expect(result.status).toBe('completed'); // Tool executed successfully

      const output = JSON.parse(result.content[0].text!) as BashOutput;
      expect(output.exitCode).toBe(1); // grep found no matches
      expect(output.stdoutPreview).toBe(''); // No output because no matches
      expect(output.command).toBe('echo "hello" | grep "world"');
    });

    it('should handle linter-style commands with issues found', async () => {
      // Create a temporary file with issues, then "lint" it
      const result = await bashTool.execute(
        {
          command: 'echo "  spaces  " | wc -w && exit 1', // Simulate linter finding issues
        },
        toolContext
      );

      expect(result.status).toBe('completed'); // Tool ran the "linter"

      const output = JSON.parse(result.content[0].text!) as BashOutput;
      expect(output.exitCode).toBe(1); // "Linter" found issues
      expect(output.stdoutPreview.trim()).toBe('1'); // wc output
      expect(output.command).toBe('echo "  spaces  " | wc -w && exit 1');
    });
  });

  describe('Command execution failures', () => {
    it('should handle not found as tool failure', async () => {
      const result = await bashTool.execute(
        {
          command: 'nonexistentcommand12345',
        },
        toolContext
      );

      // Based on observed behavior: single nonexistent command = tool failure
      expect(result.status).not.toBe('completed');
      expect(result.content[0].text).toContain('not found');
      expect(result.content[0].text).toContain('nonexistentcommand12345');

      const output = JSON.parse(result.content[0].text!) as BashOutput;
      expect(output.exitCode).toBe(127); // Command not found
      expect(output.stderrPreview).toContain('not found');
      expect(output.command).toBe('nonexistentcommand12345');
    });

    it('should handle not found in sequence as tool success', async () => {
      const result = await bashTool.execute(
        {
          command: 'echo "before"; nonexistentcommand12345; echo "Exit code: $?"',
        },
        toolContext
      );

      // Based on observed behavior: command in sequence = tool success
      expect(result.status).toBe('completed');

      const output = JSON.parse(result.content[0].text!) as BashOutput;
      expect(output.stdoutPreview).toContain('before');
      expect(output.stdoutPreview).toContain('Exit code: 127');
      expect(output.stderrPreview).toContain('not found');
      expect(output.command).toBe('echo "before"; nonexistentcommand12345; echo "Exit code: $?"');
    });

    it('should handle permission denied', async () => {
      // Try to read a file that doesn't exist with strict permissions
      const result = await bashTool.execute(
        {
          command: 'cat /root/nonexistent 2>/dev/null || echo "permission issue" >&2 && exit 126',
        },
        toolContext
      );

      expect(result.status).toBe('completed'); // Command executed (even though it failed)

      const output = JSON.parse(result.content[0].text!) as BashOutput;
      expect(output.exitCode).toBe(126);
      expect(output.stderrPreview).toContain('permission issue');
      expect(output.command).toBe(
        'cat /root/nonexistent 2>/dev/null || echo "permission issue" >&2 && exit 126'
      );
    });
  });

  describe('Output handling', () => {
    it('should capture both stdout and stderr', async () => {
      const result = await bashTool.execute(
        {
          command: 'echo "to stdout" && echo "to stderr" >&2',
        },
        toolContext
      );

      expect(result.status).toBe('completed');

      const output = JSON.parse(result.content[0].text!) as BashOutput;
      expect(output.exitCode).toBe(0);
      expect(output.stdoutPreview).toBe('to stdout\n');
      expect(output.stderrPreview).toBe('to stderr\n');
      expect(output.command).toBe('echo "to stdout" && echo "to stderr" >&2');
    });

    it('should handle large output', async () => {
      const result = await bashTool.execute(
        {
          command: 'for i in {1..100}; do echo "line $i"; done',
        },
        toolContext
      );

      expect(result.status).toBe('completed');

      const output = JSON.parse(result.content[0].text!) as BashOutput;
      expect(output.exitCode).toBe(0);
      // For 100 lines of output, we expect roughly that many lines in preview
      const previewLines = output.stdoutPreview.split('\n').length;
      expect(previewLines).toBeGreaterThanOrEqual(100);
      expect(previewLines).toBeLessThanOrEqual(105);
      expect(output.stdoutPreview).toContain('line 1');
      expect(output.stdoutPreview).toContain('line 95'); // Should include most lines in preview
      // Verify truncation information
      expect(output.truncated.stdout.total).toBeGreaterThanOrEqual(100);
      expect(output.truncated.stdout.skipped).toBeGreaterThanOrEqual(0);
      expect(output.command).toBe('for i in {1..100}; do echo "line $i"; done');
      // Check that full output files are available
      expect(output.outputFiles.stdout).toBeDefined();
      expect(output.outputFiles.stderr).toBeDefined();
      expect(output.outputFiles.combined).toBeDefined();
    });

    it('should handle unicode and special characters', async () => {
      const result = await bashTool.execute(
        {
          command: 'echo "Hello 🌍 World! Special: àáâãäå"',
        },
        toolContext
      );

      expect(result.status).toBe('completed');

      const output = JSON.parse(result.content[0].text!) as BashOutput;
      expect(output.exitCode).toBe(0);
      expect(output.stdoutPreview).toBe('Hello 🌍 World! Special: àáâãäå\n');
      expect(output.command).toBe('echo "Hello 🌍 World! Special: àáâãäå"');
    });
  });

  describe('JSON output structure', () => {
    it('should always return valid JSON in output field', async () => {
      const result = await bashTool.execute({ command: 'echo "test"' }, toolContext);

      expect(result.status).toBe('completed');
      expect(() => JSON.parse(result.content[0].text!) as unknown).not.toThrow();

      const output = JSON.parse(result.content[0].text!) as BashOutput;
      expect(output).toHaveProperty('stdoutPreview');
      expect(output).toHaveProperty('stderrPreview');
      expect(output).toHaveProperty('exitCode');
      expect(output).toHaveProperty('command');
      expect(output).toHaveProperty('runtime');
      expect(output).toHaveProperty('truncated');
      expect(output).toHaveProperty('outputFiles');
      expect(typeof output.exitCode).toBe('number');
    });

    it('should maintain JSON structure even for complex output', async () => {
      // Command that outputs JSON itself
      const result = await bashTool.execute(
        {
          command: 'echo \'{"test": "value", "number": 42}\'',
        },
        toolContext
      );

      expect(result.status).toBe('completed');

      const output = JSON.parse(result.content[0].text!) as BashOutput;
      expect(output.stdoutPreview).toBe('{"test": "value", "number": 42}\n');
      expect(output.command).toBe('echo \'{"test": "value", "number": 42}\'');

      // The stdout content should also be valid JSON
      const innerJson = JSON.parse(output.stdoutPreview.trim()) as { test: string; number: number };
      expect(innerJson.test).toBe('value');
      expect(innerJson.number).toBe(42);
    });
  });

  describe('Real-world scenarios based on observed behavior', () => {
    it('should handle ESLint finding issues (exit 1) as tool success', async () => {
      // This matches what I observed when running ESLint that found issues
      const result = await bashTool.execute(
        {
          command: 'echo "src/file.ts:1:1 error Delete spaces" && exit 1',
        },
        toolContext
      );

      expect(result.status).toBe('completed'); // ✅ Tool completed (not ❌ Tool failed)

      const output = JSON.parse(result.content[0].text!) as BashOutput;
      expect(output.exitCode).toBe(1); // ESLint found issues
      expect(output.stdoutPreview).toContain('error Delete spaces');
      expect(output.command).toBe('echo "src/file.ts:1:1 error Delete spaces" && exit 1');
    });

    it('should handle false command (exit 1) as tool success', async () => {
      // Observed: 'false' command shows as ✅ Tool completed
      const result = await bashTool.execute({ command: 'false' }, toolContext);

      expect(result.status).toBe('completed'); // ✅ Tool completed

      const output = JSON.parse(result.content[0].text!) as BashOutput;
      expect(output.exitCode).toBe(1);
      expect(output.stdoutPreview).toBe('');
      expect(output.stderrPreview).toBe('');
      expect(output.command).toBe('false');
    });

    it('should handle echo with success (exit 0) as tool success', async () => {
      // Observed: 'echo' commands show as ✅ Tool completed
      const result = await bashTool.execute({ command: 'echo "hello"' }, toolContext);

      expect(result.status).toBe('completed'); // ✅ Tool completed

      const output = JSON.parse(result.content[0].text!) as BashOutput;
      expect(output.exitCode).toBe(0);
      expect(output.stdoutPreview).toBe('hello\n');
      expect(output.stderrPreview).toBe('');
      expect(output.command).toBe('echo "hello"');
    });

    it('should handle grep with no matches as tool success', async () => {
      // grep returns exit 1 when no matches found, but tool should succeed
      const result = await bashTool.execute(
        {
          command: 'echo "hello" | grep "xyz"',
        },
        toolContext
      );

      expect(result.status).toBe('completed'); // ✅ Tool completed

      const output = JSON.parse(result.content[0].text!) as BashOutput;
      expect(output.exitCode).toBe(1); // grep found no matches
      expect(output.stdoutPreview).toBe(''); // No output
      expect(output.command).toBe('echo "hello" | grep "xyz"');
    });

    it('should match the behavior I observed with command sequences', async () => {
      // Based on: echo "Testing not found"; nonexistentcommand12345; echo "Exit code was: $?"
      const result = await bashTool.execute(
        {
          command: 'echo "Testing"; nonexistentcmd123; echo "After error"',
        },
        toolContext
      );

      expect(result.status).toBe('completed'); // ✅ Tool completed (what I observed)

      const output = JSON.parse(result.content[0].text!) as BashOutput;
      expect(output.stdoutPreview).toContain('Testing');
      expect(output.stdoutPreview).toContain('After error');
      expect(output.stderrPreview).toContain('not found');
      expect(output.command).toBe('echo "Testing"; nonexistentcmd123; echo "After error"');
    });
  });

  describe('Working directory context', () => {
    it('should use working directory from context when provided', async () => {
      // Create a temporary directory and test file
      const result = await bashTool.execute(
        {
          command:
            'mkdir -p /tmp/test-bash-tool && echo "test content" > /tmp/test-bash-tool/test.txt',
        },
        toolContext
      );
      expect(result.status).toBe('completed');

      // Now execute a command with context pointing to that directory
      const contextWithWorkingDir = { ...toolContext, workingDirectory: '/tmp/test-bash-tool' };
      const pwdResult = await bashTool.execute(
        { command: 'pwd && cat test.txt' },
        contextWithWorkingDir
      );

      expect(pwdResult.status).toBe('completed');

      const output = JSON.parse(pwdResult.content[0].text!) as BashOutput;

      expect(output.exitCode).toBe(0);
      expect(output.stdoutPreview).toContain('/tmp/test-bash-tool');
      expect(output.stdoutPreview).toContain('test content');
      expect(output.command).toBe('pwd && cat test.txt');
    });

    it('should use process.cwd() when no context provided', async () => {
      const result = await bashTool.execute({ command: 'pwd' }, toolContext);

      expect(result.status).toBe('completed');

      const output = JSON.parse(result.content[0].text!) as BashOutput;

      expect(output.exitCode).toBe(0);
      expect(fs.realpathSync(output.stdoutPreview.trim())).toBe(fs.realpathSync(process.cwd()));
      expect(output.command).toBe('pwd');
    });

    it('should use process.cwd() when context has no workingDirectory', async () => {
      const contextWithoutWorkingDir = { ...toolContext }; // No workingDirectory property
      const result = await bashTool.execute({ command: 'pwd' }, contextWithoutWorkingDir);

      expect(result.status).toBe('completed');

      const output = JSON.parse(result.content[0].text!) as BashOutput;

      expect(output.exitCode).toBe(0);
      expect(fs.realpathSync(output.stdoutPreview.trim())).toBe(fs.realpathSync(process.cwd()));
      expect(output.command).toBe('pwd');
    });

    it('should handle relative paths correctly with working directory', async () => {
      // Create a test structure
      const setupResult = await bashTool.execute(
        {
          command:
            'mkdir -p /tmp/test-bash-relative/subdir && echo "relative test" > /tmp/test-bash-relative/subdir/file.txt',
        },
        toolContext
      );
      expect(setupResult.status).toBe('completed');

      // Use context to set working directory and test relative path
      const contextWithWorkingDir = { ...toolContext, workingDirectory: '/tmp/test-bash-relative' };
      const result = await bashTool.execute(
        { command: 'cat subdir/file.txt' },
        contextWithWorkingDir
      );

      expect(result.status).toBe('completed');

      const output = JSON.parse(result.content[0].text!) as BashOutput;

      expect(output.exitCode).toBe(0);
      expect(output.stdoutPreview).toContain('relative test');
      expect(output.command).toBe('cat subdir/file.txt');
    });
  });

  describe('Large output integration tests', () => {
    it('should truncate very large output correctly', async () => {
      // Generate 200 lines of output (exceeds PREVIEW_HEAD_LINES = 100)
      const result = await bashTool.execute(
        {
          command: 'for i in {1..200}; do echo "line $i"; done',
        },
        toolContext
      );

      expect(result.status).toBe('completed');

      const output = JSON.parse(result.content[0].text!) as BashOutput;
      expect(output.exitCode).toBe(0);

      // Should have truncation info showing skipped lines
      expect(output.truncated.stdout.total).toBe(200);
      expect(output.truncated.stdout.skipped).toBeGreaterThan(0);

      // Preview should contain early lines (head)
      expect(output.stdoutPreview).toContain('line 1');
      expect(output.stdoutPreview).toContain('line 10');

      // Preview should contain later lines (tail) due to rotation
      expect(output.stdoutPreview).toContain('line 190');
      expect(output.stdoutPreview).toContain('line 200');

      // Output files should be created
      expect(output.outputFiles.stdout).toBeDefined();
      expect(output.outputFiles.stderr).toBeDefined();
      expect(output.outputFiles.combined).toBeDefined();
    });

    it('should handle mixed stdout and stderr with truncation', async () => {
      // Generate output to both stdout and stderr
      const result = await bashTool.execute(
        {
          command: 'for i in {1..60}; do echo "stdout line $i"; echo "stderr line $i" >&2; done',
        },
        toolContext
      );

      expect(result.status).toBe('completed');

      const output = JSON.parse(result.content[0].text!) as BashOutput;
      expect(output.exitCode).toBe(0);

      // Both stdout and stderr should have content
      expect(output.stdoutPreview).toContain('stdout line 1');
      expect(output.stdoutPreview).toContain('stdout line 60');
      expect(output.stderrPreview).toContain('stderr line 1');
      expect(output.stderrPreview).toContain('stderr line 60');

      // Should have truncation tracking for both streams
      expect(output.truncated.stdout.total).toBeGreaterThan(50);
      expect(output.truncated.stderr.total).toBeGreaterThan(50);

      // All output files should exist
      expect(output.outputFiles.stdout).toBeDefined();
      expect(output.outputFiles.stderr).toBeDefined();
      expect(output.outputFiles.combined).toBeDefined();
    });

    it('should enforce character limit safety check', async () => {
      // Generate very long lines that exceed MAX_PREVIEW_CHARS = 10000
      const longLine = 'A'.repeat(15000);
      const result = await bashTool.execute(
        {
          command: `echo "${longLine}"`,
        },
        toolContext
      );

      expect(result.status).toBe('completed');

      const output = JSON.parse(result.content[0].text!) as BashOutput;
      expect(output.exitCode).toBe(0);

      // Preview should be truncated by character limit
      expect(output.stdoutPreview.length).toBeLessThanOrEqual(10020); // MAX_PREVIEW_CHARS + '...[truncated]'
      expect(output.stdoutPreview).toContain('...[truncated]');

      // Original data should still be in files
      expect(output.outputFiles.stdout).toBeDefined();
    });
  });
});
