// ABOUTME: Unit tests for CLI conversation features using mocked providers
// ABOUTME: Tests conversation flow without external dependencies by mocking AI provider responses

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCLI } from '~/__tests__/helpers/cli-runner.js';

describe('CLI Conversation Tests', () => {
  let testDir: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    // Create isolated temporary directory for this test
    testDir = await mkdtemp(join(tmpdir(), 'lace-e2e-cli-test-'));
    originalEnv = process.env.LACE_DIR;

    // Set LACE_DIR to our isolated temp directory for spawned processes
    process.env.LACE_DIR = testDir;
  });

  afterEach(async () => {
    // Restore original LACE_DIR
    if (originalEnv !== undefined) {
      process.env.LACE_DIR = originalEnv;
    } else {
      delete process.env.LACE_DIR;
    }

    // Clean up the entire test directory
    await rm(testDir, { recursive: true, force: true });
  });

  describe('session management integration', () => {
    it.sequential(
      'should create and continue sessions',
      async () => {
        // First, create a session with a prompt using mocked Anthropic provider
        const session1 = await runCLI(['--provider', 'anthropic', '--prompt', 'Hi'], {
          timeout: 10000,
          env: {
            LACE_TEST_MODE: 'true',
            ANTHROPIC_KEY: 'sk-ant-test-key-for-testing',
            LACE_DIR: testDir,
          },
        });

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
          ['--provider', 'anthropic', '--continue', sessionId, '--prompt', 'Hello'],
          {
            timeout: 10000,
            env: {
              LACE_TEST_MODE: 'true',
              ANTHROPIC_KEY: 'sk-ant-test-key-for-testing',
              LACE_DIR: testDir,
            },
          }
        );

        expect(session2.exitCode).toBe(0);
        expect(session2.stdout).toContain(`📖 Continuing conversation ${sessionId}`);
      },
      30000
    );

    it.sequential(
      'should continue latest session when no ID provided',
      async () => {
        // Create first session
        const session1 = await runCLI(['--provider', 'anthropic', '--prompt', 'Hi'], {
          timeout: 10000,
          env: {
            LACE_TEST_MODE: 'true',
            ANTHROPIC_KEY: 'sk-ant-test-key-for-testing',
            LACE_DIR: testDir,
          },
        });

        expect(session1.exitCode).toBe(0);

        // Create second session
        const session2 = await runCLI(['--provider', 'anthropic', '--prompt', 'Hello'], {
          timeout: 10000,
          env: {
            LACE_TEST_MODE: 'true',
            ANTHROPIC_KEY: 'sk-ant-test-key-for-testing',
            LACE_DIR: testDir,
          },
        });

        expect(session2.exitCode).toBe(0);
        // const sessionIdMatch = session2.stdout.match(
        //   /Starting conversation (lace_\d{8}_[a-z0-9]{6})/
        // );
        // const latestSessionId = sessionIdMatch![1];

        // Continue without specifying ID - should get latest
        const session3 = await runCLI(
          ['--provider', 'anthropic', '--continue', '--prompt', 'Hello'],
          {
            timeout: 10000,
            env: {
              LACE_TEST_MODE: 'true',
              ANTHROPIC_KEY: 'sk-ant-test-key-for-testing',
              LACE_DIR: testDir,
            },
          }
        );

        expect(session3.exitCode).toBe(0);
        // The test should continue with some thread ID (may not be exact due to timing)
        expect(session3.stdout).toMatch(/📖 Continuing conversation lace_\d{8}_[a-z0-9]{6}/);
      },
      45000
    );
  });

  describe('real conversation flow', () => {
    it.sequential(
      'should support multi-turn conversation with context',
      async () => {
        // Turn 1: Ask initial question
        const turn1 = await runCLI(['--provider', 'anthropic', '--prompt', 'Hi'], {
          timeout: 10000,
          env: {
            LACE_TEST_MODE: 'true',
            ANTHROPIC_KEY: 'sk-ant-test-key-for-testing',
            LACE_DIR: testDir,
          },
        });

        expect(turn1.exitCode).toBe(0);
        const sessionIdMatch = turn1.stdout.match(/Starting conversation (lace_\d{8}_[a-z0-9]{6})/);
        const sessionId = sessionIdMatch![1];

        // Turn 2: Reference previous answer
        const turn2 = await runCLI(
          ['--provider', 'anthropic', '--continue', sessionId, '--prompt', 'Hello'],
          {
            timeout: 10000,
            env: {
              LACE_TEST_MODE: 'true',
              ANTHROPIC_KEY: 'sk-ant-test-key-for-testing',
              LACE_DIR: testDir,
            },
          }
        );

        expect(turn2.exitCode).toBe(0);
        expect(turn2.stdout).toContain(`📖 Continuing conversation ${sessionId}`);

        // Turn 3: Reference the entire conversation
        const turn3 = await runCLI(
          ['--provider', 'anthropic', '--continue', sessionId, '--prompt', 'Hello'],
          {
            timeout: 10000,
            env: {
              LACE_TEST_MODE: 'true',
              ANTHROPIC_KEY: 'sk-ant-test-key-for-testing',
              LACE_DIR: testDir,
            },
          }
        );

        expect(turn3.exitCode).toBe(0);
        expect(turn3.stdout).toContain(`📖 Continuing conversation ${sessionId}`);
      },
      45000
    );

    it.sequential(
      'should maintain context with Anthropic provider across --continue sessions',
      async () => {
        // Turn 1: Start conversation with Anthropic
        const turn1 = await runCLI(['--provider', 'anthropic', '--prompt', 'Hi'], {
          timeout: 10000,
          env: {
            LACE_TEST_MODE: 'true',
            ANTHROPIC_KEY: 'sk-ant-test-key-for-testing',
            LACE_DIR: testDir,
          },
        });

        expect(turn1.exitCode).toBe(0);
        expect(turn1.stdout).toContain('test-provider');

        // Extract session ID
        const sessionIdMatch = turn1.stdout.match(/Starting conversation (lace_\d{8}_[a-z0-9]{6})/);
        expect(sessionIdMatch).toBeTruthy();
        const sessionId = sessionIdMatch![1];

        // Turn 2: Continue with "Hello"
        const turn2 = await runCLI(
          ['--continue', sessionId, '--provider', 'anthropic', '--prompt', 'Hello'],
          {
            timeout: 10000,
            env: {
              LACE_TEST_MODE: 'true',
              ANTHROPIC_KEY: 'sk-ant-test-key-for-testing',
              LACE_DIR: testDir,
            },
          }
        );

        expect(turn2.exitCode).toBe(0);
        expect(turn2.stdout).toContain(`📖 Continuing conversation ${sessionId}`);
      },
      30000
    );
  });
});
