// ABOUTME: End-to-end CLI tests that spawn the actual agent.js process
// ABOUTME: Tests the full user experience including argument parsing and session management

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as laceDir from '../config/lace-dir.js';

// Helper to run CLI commands and capture output
async function runCLI(
  args: string[],
  options: { timeout?: number; input?: string } = {}
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const { timeout = 10000, input } = options;

  return new Promise((resolve, reject) => {
    const child = spawn('node', ['dist/cli.js', ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ANTHROPIC_KEY: 'fake-key-for-testing' },
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    // Send input if provided
    if (input) {
      child.stdin?.write(input);
      child.stdin?.end();
    }

    const timeoutId = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`CLI command timed out after ${timeout}ms`));
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timeoutId);
      resolve({
        exitCode: code || 0,
        stdout,
        stderr,
      });
    });

    child.on('error', (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
  });
}

describe('End-to-End CLI Tests', () => {
  let tempDbPath: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `lace-e2e-test-${Date.now()}.db`);
    originalEnv = process.env.LACE_DIR;

    // Mock the config to use temp database
    vi.spyOn(laceDir, 'getLaceDbPath').mockReturnValue(tempDbPath);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalEnv !== undefined) {
      process.env.LACE_DIR = originalEnv;
    } else {
      delete process.env.LACE_DIR;
    }

    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }
  });

  describe('argument parsing', () => {
    it('should show help when --help is provided', async () => {
      const result = await runCLI(['--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Lace AI Coding Assistant');
      expect(result.stdout).toContain('--continue [session_id]');
      expect(result.stdout).toContain('--prompt <text>');
    });

    it('should reject unknown arguments', async () => {
      const result = await runCLI(['--invalid-arg']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Unknown argument "--invalid-arg"');
    });

    it('should accept --continue argument without error', async () => {
      // Use --prompt to avoid interactive mode, just test argument parsing
      const result = await runCLI(['--continue', '--prompt', 'test'], { timeout: 3000 });

      // Should not exit with argument parsing error (exitCode 1)
      expect(result.stderr).not.toContain('Unknown argument');
      expect(result.stderr).not.toContain('--continue');
    });

    it('should accept thread ID arguments', async () => {
      // Use --prompt to avoid interactive mode
      const result = await runCLI(['--continue', 'lace_20250615_abc123', '--prompt', 'test'], {
        timeout: 3000,
      });

      // Should not exit with argument parsing error
      expect(result.stderr).not.toContain('Unknown argument');
      // Thread ID should be handled gracefully (may appear in "could not resume" message)
      expect(result.stderr).not.toContain('Unknown argument "lace_20250615_abc123"');
    });
  });

  describe('--prompt functionality', () => {
    it('should execute single prompt and exit', async () => {
      const result = await runCLI(['--prompt', 'Hello world'], { timeout: 5000 });

      // Should indicate it's starting the agent
      expect(result.stdout).toContain('Lace Agent using');

      // Should exit cleanly after processing prompt
      expect(result.exitCode).toBe(0);
    });

    it('should handle --prompt with different providers', async () => {
      const result = await runCLI(['--provider', 'ollama', '--prompt', 'Test message'], {
        timeout: 10000,
      }); // Longer timeout for provider connection

      // Should mention the provider even if connection fails
      expect(result.stdout).toContain('ollama');
    }, 15000); // Vitest timeout

    it('should require prompt text', async () => {
      const result = await runCLI(['--prompt']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('--prompt requires a prompt text');
    });
  });

  describe('session management integration', () => {
    it('should create and continue sessions', async () => {
      // First, create a session with a prompt
      const session1 = await runCLI(['--prompt', 'What is 2+2?'], { timeout: 5000 });

      expect(session1.exitCode).toBe(0);
      expect(session1.stdout).toContain('Starting conversation');

      // Extract session ID from output
      const sessionIdMatch = session1.stdout.match(
        /Starting conversation (lace_\d{8}_[a-z0-9]{6})/
      );
      expect(sessionIdMatch).toBeTruthy();
      const sessionId = sessionIdMatch![1];

      // Continue the session with a new prompt
      const session2 = await runCLI(
        ['--continue', sessionId, '--prompt', 'Now multiply that by 3'],
        { timeout: 5000 }
      );

      expect(session2.exitCode).toBe(0);
      expect(session2.stdout).toContain(`Continuing conversation ${sessionId}`);
    });

    it('should continue latest session when no ID provided', async () => {
      // Create first session
      const session1 = await runCLI(['--prompt', 'First session'], { timeout: 5000 });

      expect(session1.exitCode).toBe(0);

      // Create second session
      const session2 = await runCLI(['--prompt', 'Second session'], { timeout: 5000 });

      expect(session2.exitCode).toBe(0);
      const sessionIdMatch = session2.stdout.match(
        /Starting conversation (lace_\d{8}_[a-z0-9]{6})/
      );
      const latestSessionId = sessionIdMatch![1];

      // Continue without specifying ID - should get latest
      const session3 = await runCLI(['--continue', '--prompt', 'Continue latest'], {
        timeout: 5000,
      });

      expect(session3.exitCode).toBe(0);
      expect(session3.stdout).toContain(`Continuing conversation ${latestSessionId}`);
    });

    it('should handle non-existent session gracefully', async () => {
      const result = await runCLI(
        ['--continue', 'lace_99999999_nonexistent', '--prompt', 'This should start new session'],
        { timeout: 5000 }
      );

      // Should not crash, should start new session
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/🆕 Starting new conversation lace_\d{8}_[a-z0-9]{6}/);
    });
  });

  describe('logging integration', () => {
    it('should respect log level settings', async () => {
      const logFile = path.join(os.tmpdir(), `test-log-${Date.now()}.log`);

      try {
        const result = await runCLI(
          ['--log-level', 'debug', '--log-file', logFile, '--prompt', 'Test logging'],
          { timeout: 5000 }
        );

        expect(result.exitCode).toBe(0);

        // Check that log file was created and contains debug info
        expect(fs.existsSync(logFile)).toBe(true);
        const logContent = fs.readFileSync(logFile, 'utf-8');
        expect(logContent).toContain('Starting Lace Agent');
      } finally {
        if (fs.existsSync(logFile)) {
          fs.unlinkSync(logFile);
        }
      }
    });
  });

  describe('error handling', () => {
    it('should handle missing ANTHROPIC_KEY for anthropic provider', async () => {
      // Run without the fake API key to test the error case
      const child = spawn('node', ['dist/cli.js', '--provider', 'anthropic', '--prompt', 'Test'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ANTHROPIC_KEY: undefined }, // Explicitly unset the key
      });

      let stderr = '';
      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      const exitCode = await new Promise<number>((resolve) => {
        child.on('close', (code) => resolve(code || 0));
      });

      // Should exit with error when no API key
      expect(exitCode).toBe(1);
      expect(stderr).toContain('ANTHROPIC_KEY environment variable required');
    });

    it('should validate provider values', async () => {
      const result = await runCLI(['--provider', 'invalid']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('--provider must be "anthropic", "lmstudio", or "ollama"');
    });

    it('should validate log level values', async () => {
      const result = await runCLI(['--log-level', 'invalid']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('--log-level must be "error", "warn", "info", or "debug"');
    });
  });

  describe('real conversation flow', () => {
    it('should support multi-turn conversation with context', async () => {
      // Turn 1: Ask initial question
      const turn1 = await runCLI(['--prompt', 'What is 2+2?'], { timeout: 5000 });

      expect(turn1.exitCode).toBe(0);
      const sessionIdMatch = turn1.stdout.match(/Starting conversation (lace_\d{8}_[a-z0-9]{6})/);
      const sessionId = sessionIdMatch![1];

      // Turn 2: Reference previous answer
      const turn2 = await runCLI(['--continue', sessionId, '--prompt', 'Now multiply that by 3'], {
        timeout: 5000,
      });

      expect(turn2.exitCode).toBe(0);
      expect(turn2.stdout).toContain(`Continuing conversation ${sessionId}`);

      // Turn 3: Reference the entire conversation
      const turn3 = await runCLI(
        ['--continue', sessionId, '--prompt', 'What was my original question?'],
        { timeout: 5000 }
      );

      expect(turn3.exitCode).toBe(0);
      expect(turn3.stdout).toContain(`Continuing conversation ${sessionId}`);
    });
  });
});
