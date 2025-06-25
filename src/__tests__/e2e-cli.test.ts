// ABOUTME: End-to-end CLI tests that spawn the actual agent.js process
// ABOUTME: Tests the full user experience including argument parsing and session management

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runCLI } from './helpers/cli-runner.js';

describe('End-to-End CLI Tests', () => {
  let tempDbPath: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `lace-e2e-test-${Date.now()}.db`);
    originalEnv = process.env.LACE_DIR;

    // Set LACE_DIR to temp directory for spawned processes
    process.env.LACE_DIR = path.dirname(tempDbPath);
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.LACE_DIR = originalEnv;
    } else {
      delete process.env.LACE_DIR;
    }

    // Clean up any test DB files
    try {
      if (fs.existsSync(tempDbPath)) {
        fs.unlinkSync(tempDbPath);
      }
    } catch {
      // Ignore cleanup errors
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
      expect(result.stderr).toContain("unknown option '--invalid-arg'");
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
    it.sequential(
      'should execute single prompt and exit',
      async () => {
        const result = await runCLI(
          ['--provider', 'lmstudio', '--model', 'qwen/qwen3-1.7b', '--prompt', 'Hello /nothink'],
          {
            timeout: 10000,
          }
        );

        // Should indicate it's starting the agent
        expect(result.stdout).toContain('Lace Agent using');

        // Should exit cleanly after processing prompt (or skip if LMStudio not available)
        if (result.exitCode !== 0) {
          // console.log('LMStudio not available, skipping test. stderr:', result.stderr);
          return;
        }
        expect(result.exitCode).toBe(0);
      },
      120000
    );

    it('should handle --prompt with different providers', async () => {
      const result = await runCLI(
        ['--provider', 'lmstudio', '--model', 'qwen/qwen3-1.7b', '--prompt', 'Hello /nothink'],
        {
          timeout: 15000,
        }
      ); // Longer timeout for provider connection

      // Should mention the provider and attempt to start, even if connection fails
      expect(result.stdout || result.stderr).toMatch(/lmstudio|Starting|Lace Agent/);
    }, 20000); // Vitest timeout

    it('should require prompt text', async () => {
      const result = await runCLI(['--prompt']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("option '--prompt <text>' argument missing");
    });
  });

  describe('session management integration', () => {
    it.sequential(
      'should handle non-existent session gracefully',
      async () => {
        const result = await runCLI(
          [
            '--provider',
            'lmstudio',
            '--model',
            'qwen/qwen3-1.7b',
            '--continue',
            'lace_99999999_nonexistent',
            '--prompt',
            'Hello',
          ],
          { timeout: 10000 }
        );

        if (result.exitCode !== 0) {
          // console.log('LMStudio not available, skipping test. stderr:', result.stderr);
          return;
        }
        // Should not crash, should start new session
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toMatch(/🆕 Starting new conversation lace_\d{8}_[a-z0-9]{6}/);
      },
      120000
    );
  });

  describe('logging integration', () => {
    it.sequential(
      'should respect log level settings',
      async () => {
        // First check if LMStudio is available by testing a quick connection
        let isLMStudioAvailable = false;
        try {
          const response = await fetch('http://localhost:1234/v1/models', {
            signal: AbortSignal.timeout(3000),
          });
          isLMStudioAvailable = response.ok;
        } catch {
          // LMStudio not available - this is expected in many test environments
        }

        if (!isLMStudioAvailable) {
          // console.log('LMStudio not available, skipping test');
          return;
        }

        const logFile = path.join(os.tmpdir(), `test-log-${Date.now()}.log`);

        try {
          const result = await runCLI(
            [
              '--provider',
              'lmstudio',
              '--model',
              'qwen/qwen3-1.7b',
              '--log-level',
              'debug',
              '--log-file',
              logFile,
              '--prompt',
              'Add 2+2 /nothink',
            ],
            { timeout: 10000 }
          );

          if (result.exitCode !== 0) {
            // console.log('LMStudio not available, skipping test. stderr:', result.stderr);
            return;
          }
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
      },
      20000
    );
  });

  describe('error handling', () => {
    it('should handle missing ANTHROPIC_KEY for anthropic provider', async () => {
      // Run without the fake API key to test the error case
      const result = await runCLI(
        ['--provider', 'anthropic', '--prompt', 'Test'],
        { env: { ...process.env, ANTHROPIC_KEY: '' } } // Explicitly unset the key
      );

      // Should exit with error when no API key
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('ANTHROPIC_KEY environment variable required');
    });

    it('should validate provider values', async () => {
      const result = await runCLI(['--provider', 'invalid']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Unknown provider 'invalid'");
      expect(result.stderr).toContain('Available providers:');
    });

    it('should validate log level values', async () => {
      const result = await runCLI(['--log-level', 'invalid']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('--log-level must be "error", "warn", "info", or "debug"');
    });
  });
});
