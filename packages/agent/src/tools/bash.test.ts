// ABOUTME: Comprehensive tests for BashTool implementation
// ABOUTME: Tests command execution, error handling, and success/failure distinction

import { PassThrough } from 'node:stream';
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { BashTool, type BashOutput } from '@lace/agent/tools/implementations/bash';
import type { ToolContext } from './types';
import { createStreamingFakeRuntime } from './runtime/__tests__/fake-runtime';
import { HostToolRuntime } from './runtime/host';
import { logger } from '@lace/agent/utils/logger';

describe('BashTool', () => {
  let bashTool: BashTool;
  let testTempDir: string;
  let toolContext: ToolContext;
  let runtimeId = 0;

  function createToolContext(cwd = process.cwd()): ToolContext {
    return {
      signal: new AbortController().signal,
      toolTempDir: testTempDir,
      runtime: new HostToolRuntime({ id: `rt_bash_test_${runtimeId++}`, cwd }),
    };
  }

  function waitForToolListeners(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
  }

  beforeEach(() => {
    bashTool = new BashTool();

    // Create unique temp directory for this test
    testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-tool-test-'));

    // Create ToolContext with temp directory
    toolContext = createToolContext();
  });

  afterEach(() => {
    // Clean up temp directory
    if (testTempDir && fs.existsSync(testTempDir)) {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    }
  });

  describe('Tool metadata', () => {
    it('should have correct name and description', () => {
      // The default timeout in the description comes from
      // LACE_BASH_FOREGROUND_TIMEOUT_MS, so pin it to "unset" here.
      const saved = process.env.LACE_BASH_FOREGROUND_TIMEOUT_MS;
      delete process.env.LACE_BASH_FOREGROUND_TIMEOUT_MS;
      let tool: BashTool;
      try {
        tool = new BashTool();
      } finally {
        if (saved !== undefined) process.env.LACE_BASH_FOREGROUND_TIMEOUT_MS = saved;
      }
      expect(tool.name).toBe('bash');
      expect(tool.description).toBe(
        `Execute shell commands in isolated bash processes.

Parameters:
- command: The shell command to run
- background: Set to true for background execution (returns jobId immediately)
- description: Label shown in job listings when background=true (optional)
- progressIntervalMs: For background jobs, interval in ms for periodic progress notifications (5000-600000). **Off by default** — set this only if you want a fixed cadence regardless of subscribers. Subscribing to a job via job_notify(on=['progress'], ...) arms the timer on its own at the default cadence.
- timeoutMs: Sync calls only. Kill the command if it runs longer than this many ms (1000-600000). Defaults to 600000.

When background=true, returns { jobId, status: "started" }. Use job_output(jobId) to check status/output.
Background jobs send completion notifications automatically. Progress notifications are opt-in (see progressIntervalMs / job_notify).

Default (sync): Blocks until complete. Output truncated to 100+50 lines. Chain with && or ;.
A sync command that runs past its timeout (600s unless timeoutMs is set) is killed (SIGTERM, then SIGKILL 2s later) — for anything long-running (installs, builds, long fetches) use background=true and poll job_output(jobId).`
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
      expect(result.content[0].text).toContain('ValidationError');
      expect(result.content[0].text).toContain('Cannot be empty');
    });

    it('should reject non-string command', async () => {
      const result = await bashTool.execute(
        { command: 123 },
        { signal: new AbortController().signal }
      );

      expect(result.status).not.toBe('completed');
      expect(result.content[0].text).toContain('ValidationError');
    });

    it('should reject missing command', async () => {
      const result = await bashTool.execute({}, { signal: new AbortController().signal });

      expect(result.status).not.toBe('completed');
      expect(result.content[0].text).toContain('ValidationError');
      expect(result.content[0].text).toContain('Missing required');
    });
  });

  describe('Successful command execution (exit code 0)', () => {
    it('runs sync bash through runtime process', async () => {
      const tool = new BashTool();
      const runtime = createStreamingFakeRuntime({ stdout: 'ok\n', exitCode: 0 });

      const result = await tool.execute(
        { command: 'echo ok' },
        {
          signal: new AbortController().signal,
          runtime,
          toolTempDir: testTempDir,
        }
      );

      expect(result.status).toBe('completed');
      expect(runtime.process.start).toHaveBeenCalledWith(
        ['/bin/bash', '-c', 'echo ok'],
        expect.objectContaining({ cwd: runtime.cwd })
      );
    });

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

  describe('Runtime process behavior', () => {
    it('preserves partial output when cancellation kills the runtime process', async () => {
      const tool = new BashTool();
      const runtime = createStreamingFakeRuntime();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      let resolveCompletion!: (result: {
        exitCode: number | null;
        signal?: NodeJS.Signals;
      }) => void;
      const completion = new Promise<{ exitCode: number | null; signal?: NodeJS.Signals }>(
        (resolve) => {
          resolveCompletion = resolve;
        }
      );
      const kill = vi.fn((signal?: NodeJS.Signals) => {
        resolveCompletion({ exitCode: null, signal });
      });

      runtime.process.start = vi.fn(async () => {
        return {
          pid: 123,
          stdout,
          stderr,
          kill,
          completion,
        };
      });

      const abortController = new AbortController();
      const resultPromise = tool.execute(
        { command: 'sleep 10' },
        {
          signal: abortController.signal,
          runtime,
          toolTempDir: testTempDir,
        }
      );

      await waitForToolListeners();
      stdout.write('before cancel\n');
      abortController.abort();
      stdout.end();
      stderr.end();

      const result = await resultPromise;
      const startOptions = vi.mocked(runtime.process.start).mock.calls[0][1];

      expect(startOptions).toHaveProperty('signal', abortController.signal);
      expect(result.status).toBe('aborted');
      expect(result.content[0].text).toContain('Partial output');
      expect(result.content[0].text).toContain('before cancel');
    });

    it('kills the runtime process when cancellation happens while process start is pending', async () => {
      const tool = new BashTool();
      const runtime = createStreamingFakeRuntime();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      let resolveStart!: (handle: Awaited<ReturnType<typeof runtime.process.start>>) => void;
      let resolveCompletion!: (result: {
        exitCode: number | null;
        signal?: NodeJS.Signals;
      }) => void;
      const completion = new Promise<{ exitCode: number | null; signal?: NodeJS.Signals }>(
        (resolve) => {
          resolveCompletion = resolve;
        }
      );
      const kill = vi.fn((signal?: NodeJS.Signals) => {
        stdout.end();
        stderr.end();
        resolveCompletion({ exitCode: null, signal });
      });

      runtime.process.start = vi.fn((_command, _opts) => {
        return new Promise((resolve) => {
          resolveStart = resolve;
        });
      });

      const abortController = new AbortController();
      const resultPromise = tool.execute(
        { command: 'sleep 10' },
        {
          signal: abortController.signal,
          runtime,
          toolTempDir: testTempDir,
        }
      );

      await waitForToolListeners();
      abortController.abort();
      resolveStart({
        pid: 123,
        stdout,
        stderr,
        kill,
        completion,
      });

      const result = await resultPromise;

      expect(kill).toHaveBeenCalledWith('SIGTERM');
      expect(result.status).toBe('aborted');
    });

    it('reports non-user signal termination as tool failure', async () => {
      const tool = new BashTool();
      const runtime = createStreamingFakeRuntime();
      const stdout = new PassThrough();
      const stderr = new PassThrough();

      runtime.process.start = vi.fn(async () => ({
        pid: 123,
        stdout,
        stderr,
        kill: vi.fn(),
        completion: Promise.resolve({
          exitCode: null,
          signal: 'SIGTERM' as NodeJS.Signals,
        }),
      }));

      const resultPromise = tool.execute(
        { command: 'self-terminating-command' },
        {
          signal: new AbortController().signal,
          runtime,
          toolTempDir: testTempDir,
        }
      );

      await waitForToolListeners();
      stdout.end('terminated\n');
      stderr.end();

      const result = await resultPromise;

      expect(result.status).toBe('failed');
      const output = JSON.parse(result.content[0].text!) as BashOutput;
      expect(output.exitCode).toBeNull();
      expect(output.stdoutPreview).toBe('terminated\n');
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

  describe('Runtime cwd context', () => {
    it('should use runtime cwd when provided', async () => {
      // Create a temporary directory and test file
      const result = await bashTool.execute(
        {
          command:
            'mkdir -p /tmp/test-bash-tool && echo "test content" > /tmp/test-bash-tool/test.txt',
        },
        toolContext
      );
      expect(result.status).toBe('completed');

      // Now execute a command with runtime cwd pointing to that directory
      const contextWithWorkingDir = createToolContext('/tmp/test-bash-tool');
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

    it('should use process.cwd() when runtime cwd is process.cwd()', async () => {
      const result = await bashTool.execute({ command: 'pwd' }, toolContext);

      expect(result.status).toBe('completed');

      const output = JSON.parse(result.content[0].text!) as BashOutput;

      expect(output.exitCode).toBe(0);
      expect(fs.realpathSync(output.stdoutPreview.trim())).toBe(fs.realpathSync(process.cwd()));
      expect(output.command).toBe('pwd');
    });

    it('should use runtime cwd when context has no workingDirectory', async () => {
      const contextWithoutWorkingDir = { ...toolContext }; // No workingDirectory property
      const result = await bashTool.execute({ command: 'pwd' }, contextWithoutWorkingDir);

      expect(result.status).toBe('completed');

      const output = JSON.parse(result.content[0].text!) as BashOutput;

      expect(output.exitCode).toBe(0);
      expect(fs.realpathSync(output.stdoutPreview.trim())).toBe(fs.realpathSync(process.cwd()));
      expect(output.command).toBe('pwd');
    });

    it('should handle relative paths correctly with runtime cwd', async () => {
      // Create a test structure
      const setupResult = await bashTool.execute(
        {
          command:
            'mkdir -p /tmp/test-bash-relative/subdir && echo "relative test" > /tmp/test-bash-relative/subdir/file.txt',
        },
        toolContext
      );
      expect(setupResult.status).toBe('completed');

      // Use runtime cwd to set working directory and test relative path
      const contextWithWorkingDir = createToolContext('/tmp/test-bash-relative');
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

  // PRI-3243: stdin was left as an open, unwritten pipe. Any command that
  // reads from stdin when it doesn't get file args (classically: a failed
  // `$(find ... )` substitution leaving `head`/`cat` with none) blocked
  // forever instead of seeing immediate EOF.
  describe('PRI-3243: stdin gets EOF instead of hanging', () => {
    it('head with no file args (empty command substitution) returns promptly', async () => {
      // Mirrors the reported repro: `head -8 $(find ... | head -1)` where the
      // find returns nothing, so head is invoked with zero file args and
      // falls back to reading stdin.
      const result = await bashTool.execute(
        {
          command: 'head -8 $(find /nonexistent-dir-for-pri-3243 -name nope 2>/dev/null | head -1)',
        },
        toolContext
      );

      expect(result.status).toBe('completed');
      const output = JSON.parse(result.content[0].text!) as BashOutput;
      expect(output.exitCode).toBe(0);
      expect(output.stdoutPreview).toBe('');
      // Milliseconds in practice; the bound is generous for loaded CI hosts.
      expect(output.runtime).toBeLessThan(5000);
    }, 10000);

    it('bare cat with no args returns promptly', async () => {
      const result = await bashTool.execute({ command: 'cat' }, toolContext);

      expect(result.status).toBe('completed');
      const output = JSON.parse(result.content[0].text!) as BashOutput;
      expect(output.exitCode).toBe(0);
      expect(output.stdoutPreview).toBe('');
      expect(output.runtime).toBeLessThan(5000);
    }, 10000);
  });

  // PRI-3251: sync bash calls get a real timeout. On timeout the tool
  // SIGTERMs the shell it spawned, SIGKILLs it after a 2s grace period, and
  // stops waiting on stdout/stderr once that grace period is over, so a call
  // is bounded by timeoutMs + 2s even when a descendant keeps the pipes open.
  describe('PRI-3251: foreground timeout', () => {
    const KILL_GRACE_MS = 2000;

    function hostContext(label: string, signal = new AbortController().signal): ToolContext {
      return {
        signal,
        runtime: new HostToolRuntime({ id: `rt_bash_${label}_${runtimeId++}`, cwd: process.cwd() }),
        toolTempDir: testTempDir,
      };
    }

    // Polls until the command under test has written its `$$` into pidFile.
    async function readPidFile(pidFile: string): Promise<number> {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (fs.existsSync(pidFile)) {
          const pid = Number.parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
          if (Number.isInteger(pid) && pid > 0) return pid;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`no pid written to ${pidFile}`);
    }

    // Only ESRCH means the process is gone; EPERM means it exists.
    function isAlive(pid: number): boolean {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
        throw error;
      }
    }

    function killIfAlive(pid: number | undefined): void {
      if (pid !== undefined && isAlive(pid)) process.kill(pid, 'SIGKILL');
    }

    it('rejects a per-call timeoutMs outside 1000..600000', async () => {
      for (const timeoutMs of [999, 600_001]) {
        const result = await bashTool.execute({ command: 'true', timeoutMs }, toolContext);
        expect(result.status).toBe('failed');
        expect(result.content[0].text).toContain('ValidationError');
      }
      for (const timeoutMs of [1000, 600_000]) {
        const result = await bashTool.execute({ command: 'true', timeoutMs }, toolContext);
        expect(result.status).toBe('completed');
      }
    });

    it('kills a hung command after timeoutMs and keeps its partial output', async () => {
      const result = await bashTool.execute(
        { command: 'echo before-timeout; exec sleep 60', timeoutMs: 1000 },
        toolContext
      );

      expect(result.status).toBe('failed');
      const output = JSON.parse(result.content[0].text!) as BashOutput;
      expect(output.timedOut).toBe(true);
      expect(output.timeoutMessage).toBe(
        'Command timed out after 1s and its shell was killed (SIGTERM, then SIGKILL 2s later if still running). Processes it started may still be running.'
      );
      expect(output.stdoutPreview).toContain('before-timeout');
      expect(output.runtime).toBeLessThan(1000 + KILL_GRACE_MS);
    }, 15000);

    it('SIGKILLs a TERM-ignoring command and still ends within timeoutMs + grace', async () => {
      const pidFile = path.join(testTempDir, 'term-ignoring-pid');
      const start = Date.now();
      const execPromise = bashTool.execute(
        // `exec` keeps the TERM-ignoring sleep as the tool's direct child,
        // so `$$` is the pid the timeout has to kill.
        { command: `trap '' TERM; echo $$ > ${pidFile}; exec sleep 60`, timeoutMs: 1000 },
        hostContext('timeout_trap')
      );
      const pid = await readPidFile(pidFile);

      try {
        const result = await execPromise;
        const elapsed = Date.now() - start;

        expect(result.status).toBe('failed');
        const output = JSON.parse(result.content[0].text!) as BashOutput;
        expect(output.timedOut).toBe(true);
        // SIGTERM was ignored, so only the SIGKILL after the grace period ends it.
        expect(elapsed).toBeGreaterThanOrEqual(1000 + KILL_GRACE_MS - 100);
        expect(elapsed).toBeLessThan(1000 + KILL_GRACE_MS + 1500);
        expect(isAlive(pid)).toBe(false);
      } finally {
        killIfAlive(pid);
      }
    }, 15000);

    it('stops waiting when an escaped descendant keeps the pipes open after SIGKILL', async () => {
      const pidFile = path.join(testTempDir, 'escaped-pid');
      const start = Date.now();
      const execPromise = bashTool.execute(
        {
          // The setsid'd sleep is in its own session, is never signaled, and
          // inherits (and holds open) the call's stdout/stderr.
          command: `(setsid sh -c 'echo $$ > ${pidFile}; exec sleep 30' &); exec sleep 30`,
          timeoutMs: 1000,
        },
        hostContext('timeout_escaped')
      );
      const escapedPid = await readPidFile(pidFile);

      try {
        const result = await execPromise;
        const elapsed = Date.now() - start;

        const output = JSON.parse(result.content[0].text!) as BashOutput;
        expect(result.status).toBe('failed');
        expect(output.timedOut).toBe(true);
        expect(elapsed).toBeLessThan(1000 + KILL_GRACE_MS + 1500);
      } finally {
        killIfAlive(escapedPid);
      }
    }, 15000);

    it('releases the pipes when it stops waiting, so an escaped descendant cannot write into a settled call', async () => {
      const pidFile = path.join(testTempDir, 'late-writer-pid');
      const statusFile = path.join(testTempDir, 'late-writer-status');
      const start = Date.now();
      const execPromise = bashTool.execute(
        {
          // The setsid'd writer escapes the timeout's signals and holds the
          // pipes. It writes after the call has settled (timeoutMs + grace)
          // and records the write's exit status: 0 means the tool still had
          // the read end open, anything else (EPIPE or SIGPIPE) means the tool
          // let go of it.
          command:
            `(setsid sh -c 'echo $$ > ${pidFile}; sleep 5; (echo late-output) 2>/dev/null; ` +
            `echo $? > ${statusFile}' &); exec sleep 30`,
          timeoutMs: 1000,
        },
        hostContext('timeout_late_writer')
      );
      const writerPid = await readPidFile(pidFile);

      try {
        const result = await execPromise;
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(1000 + KILL_GRACE_MS + 1500);
        const output = JSON.parse(result.content[0].text!) as BashOutput;
        expect(output.timedOut).toBe(true);

        const deadline = Date.now() + 8000;
        while (!fs.existsSync(statusFile) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(fs.readFileSync(statusFile, 'utf8').trim()).not.toBe('0');
      } finally {
        // setsid made the writer a process-group leader, so this reaches its
        // sleep too and nothing else.
        if (isAlive(writerPid)) process.kill(-writerPid, 'SIGKILL');
      }
    }, 20000);

    it('says so when the shell exited but a background process kept the pipes open', async () => {
      const pidFile = path.join(testTempDir, 'background-pid');
      const start = Date.now();
      const execPromise = bashTool.execute(
        {
          command: `sh -c 'echo $$ > ${pidFile}; exec sleep 30' & echo started`,
          timeoutMs: 1000,
        },
        hostContext('timeout_background')
      );
      const backgroundPid = await readPidFile(pidFile);

      try {
        const result = await execPromise;
        const elapsed = Date.now() - start;

        expect(result.status).toBe('failed');
        const output = JSON.parse(result.content[0].text!) as BashOutput;
        expect(output.timedOut).toBe(true);
        expect(output.exitCode).toBe(0);
        expect(output.stdoutPreview).toContain('started');
        expect(output.timeoutMessage).toBe(
          "Command exited with code 0, but its stdout/stderr stayed open until the 1s timeout, probably held by a background process it started (that process may still be running). For long-running work use background=true, or redirect the background process's output (e.g. `cmd > out.log 2>&1 &`)."
        );
        // Nothing left to kill, so no grace period.
        expect(elapsed).toBeLessThan(1000 + 1500);
      } finally {
        killIfAlive(backgroundPid);
      }
    }, 15000);

    it('does not delay or flag a fast command', async () => {
      const result = await bashTool.execute(
        { command: 'echo quick', timeoutMs: 1000 },
        toolContext
      );

      expect(result.status).toBe('completed');
      const output = JSON.parse(result.content[0].text!) as BashOutput;
      expect(output.timedOut).toBe(false);
      expect(output.timeoutMessage).toBeUndefined();
      expect(output.stdoutPreview.trim()).toBe('quick');
    }, 10000);

    it('still SIGKILLs a TERM-ignoring command after an abort settles the call', async () => {
      const pidFile = path.join(testTempDir, 'abort-trap-pid');
      const abortController = new AbortController();
      const execPromise = bashTool.execute(
        { command: `trap '' TERM; echo $$ > ${pidFile}; exec sleep 30` },
        hostContext('abort_trap', abortController.signal)
      );
      const pid = await readPidFile(pidFile);

      try {
        abortController.abort();
        const result = await execPromise;
        expect(result.status).toBe('aborted');
        // The call settles as soon as the abort rejects the process's
        // completion; the SIGKILL comes after the grace period regardless.
        await new Promise((resolve) => setTimeout(resolve, KILL_GRACE_MS + 500));
        expect(isAlive(pid)).toBe(false);
      } finally {
        killIfAlive(pid);
      }
    }, 15000);
  });

  // The default for calls that omit timeoutMs is a per-instance setting,
  // LACE_BASH_FOREGROUND_TIMEOUT_MS. It can only lower the default: values
  // above the 600000ms per-call ceiling are clamped to it.
  describe('PRI-3251: LACE_BASH_FOREGROUND_TIMEOUT_MS', () => {
    const ENV_VAR = 'LACE_BASH_FOREGROUND_TIMEOUT_MS';
    let savedEnvValue: string | undefined;
    let warn: MockInstance<typeof logger.warn>;

    beforeEach(() => {
      savedEnvValue = process.env[ENV_VAR];
      warn = vi.spyOn(logger, 'warn');
    });

    afterEach(() => {
      warn.mockRestore();
      if (savedEnvValue === undefined) delete process.env[ENV_VAR];
      else process.env[ENV_VAR] = savedEnvValue;
    });

    function describedDefault(): string | undefined {
      return /Defaults to (\d+)\./.exec(new BashTool().description)?.[1];
    }

    it('defaults to 600000ms when unset, without warning', () => {
      delete process.env[ENV_VAR];
      expect(describedDefault()).toBe('600000');
      expect(warn).not.toHaveBeenCalled();
    });

    it('accepts an in-range value without warning', () => {
      process.env[ENV_VAR] = '120000';
      expect(describedDefault()).toBe('120000');
      expect(new BashTool().description).toContain('(120s unless timeoutMs is set)');
      expect(warn).not.toHaveBeenCalled();
    });

    it.each([
      ['1800000', '600000', 'clamped'],
      ['500', '1000', 'clamped'],
      ['10s', '600000', 'not a positive integer'],
      ['0', '600000', 'not a positive integer'],
    ])('maps %s to %sms and warns', (raw, expected, reason) => {
      process.env[ENV_VAR] = raw;
      expect(describedDefault()).toBe(expected);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(reason),
        expect.objectContaining({ value: raw, effectiveMs: Number(expected) })
      );
    });

    it('applies the configured default to a call that omits timeoutMs', async () => {
      process.env[ENV_VAR] = '1000';
      const tool = new BashTool();

      const result = await tool.execute({ command: 'exec sleep 30' }, toolContext);

      expect(result.status).toBe('failed');
      const output = JSON.parse(result.content[0].text!) as BashOutput;
      expect(output.timedOut).toBe(true);
      expect(output.timeoutMessage).toContain('timed out after 1s');
    }, 15000);
  });
});
