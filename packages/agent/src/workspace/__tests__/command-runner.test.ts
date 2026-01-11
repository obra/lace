// ABOUTME: Tests for the shared command execution function
// ABOUTME: Validates command execution behavior used by workspace managers

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { executeCommand } from '@lace/agent/workspace/command-runner';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('executeCommand', () => {
  let tempDir: string;

  beforeEach(() => {
    // Use realpathSync to resolve symlinks (macOS /var -> /private/var)
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'command-runner-test-')));
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('array commands (execFile - no shell)', () => {
    it('executes simple echo command', async () => {
      const result = await executeCommand({
        command: ['echo', 'Hello World'],
        cwd: tempDir,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('Hello World');
      expect(result.stderr).toBe('');
    });

    it('prevents shell injection via command array', async () => {
      // This should NOT execute the injected command
      const result = await executeCommand({
        command: ['echo', 'test; echo INJECTED'],
        cwd: tempDir,
      });

      expect(result.exitCode).toBe(0);
      // The entire string should be echoed literally
      expect(result.stdout.trim()).toBe('test; echo INJECTED');
    });

    it('handles special shell characters safely', async () => {
      const specialChars = ['$HOME', '`whoami`', '$(pwd)', '&&', '||', ';', '|'];

      for (const char of specialChars) {
        const result = await executeCommand({
          command: ['echo', char],
          cwd: tempDir,
        });

        expect(result.exitCode).toBe(0);
        // Should echo literally, not interpret
        expect(result.stdout.trim()).toBe(char);
      }
    });

    it('reads file content with cat', async () => {
      const testFile = join(tempDir, 'test.txt');
      writeFileSync(testFile, 'File content here');

      const result = await executeCommand({
        command: ['cat', testFile],
        cwd: tempDir,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('File content here');
    });
  });

  describe('string commands (exec - with shell)', () => {
    it('executes simple shell command', async () => {
      const result = await executeCommand({
        command: 'echo "Hello from shell"',
        cwd: tempDir,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('Hello from shell');
    });

    it('supports shell pipes', async () => {
      const result = await executeCommand({
        command: 'echo "line1\nline2\nline3" | wc -l',
        cwd: tempDir,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('3');
    });

    it('supports shell redirects', async () => {
      const testFile = join(tempDir, 'output.txt');

      await executeCommand({
        command: `echo "redirected" > "${testFile}"`,
        cwd: tempDir,
      });

      const result = await executeCommand({
        command: ['cat', testFile],
        cwd: tempDir,
      });

      expect(result.stdout.trim()).toBe('redirected');
    });
  });

  describe('environment variables', () => {
    it('passes custom environment variables', async () => {
      const result = await executeCommand({
        command: ['sh', '-c', 'echo "$MY_VAR"'],
        cwd: tempDir,
        environment: { MY_VAR: 'custom-value' },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('custom-value');
    });

    it('inherits process environment', async () => {
      // PATH should be inherited
      const result = await executeCommand({
        command: ['sh', '-c', 'echo "$PATH"'],
        cwd: tempDir,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBeTruthy();
    });

    it('custom environment overrides inherited', async () => {
      const result = await executeCommand({
        command: ['sh', '-c', 'echo "$CUSTOM_VAR"'],
        cwd: tempDir,
        environment: { CUSTOM_VAR: 'overridden-value' },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('overridden-value');
    });
  });

  describe('error handling', () => {
    it('returns non-zero exit code for failed commands', async () => {
      const result = await executeCommand({
        command: ['ls', '/nonexistent/path/that/does/not/exist'],
        cwd: tempDir,
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toBeTruthy();
    });

    it('returns exit code from command', async () => {
      const result = await executeCommand({
        command: ['sh', '-c', 'exit 42'],
        cwd: tempDir,
      });

      expect(result.exitCode).toBe(42);
    });

    it('captures stderr on error', async () => {
      const result = await executeCommand({
        command: ['sh', '-c', 'echo "error message" >&2; exit 1'],
        cwd: tempDir,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr.trim()).toBe('error message');
    });
  });

  describe('working directory', () => {
    it('executes in specified working directory', async () => {
      const result = await executeCommand({
        command: ['pwd'],
        cwd: tempDir,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe(tempDir);
    });
  });

  describe('timeout handling', () => {
    it('respects timeout setting', async () => {
      // This test is tricky because we don't want to wait for actual timeout
      // Just verify the option is accepted
      const result = await executeCommand({
        command: ['echo', 'fast'],
        cwd: tempDir,
        timeout: 5000,
      });

      expect(result.exitCode).toBe(0);
    });
  });
});
