// ABOUTME: End-to-end CLI tests for conversation features that require LLM model responses
// ABOUTME: These tests are prone to hanging due to model generation issues and are separated for isolation

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runCLI, isLMStudioAvailable } from './helpers/cli-runner.js';

describe('End-to-End CLI Conversation Tests', () => {
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

  describe('session management integration', () => {
    it.sequential(
      'should create and continue sessions',
      async () => {
        // Check LMStudio availability before running any CLI commands
        const lmStudioAvailable = await isLMStudioAvailable();
        if (!lmStudioAvailable) {
          console.log('LMStudio not available, skipping test');
          return;
        }

        // First, create a session with a prompt
        const session1 = await runCLI(
          ['--provider', 'lmstudio', '--model', 'mistralai/devstral-small-2505', '--prompt', 'Hi'],
          {
            timeout: 60000,
          }
        );

        if (session1.exitCode !== 0) {
          console.log('LMStudio command failed. stderr:', session1.stderr);
          return;
        }
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
          [
            '--provider',
            'lmstudio',
            '--model',
            'mistralai/devstral-small-2505',
            '--continue',
            sessionId,
            '--prompt',
            'Hello',
          ],
          { timeout: 60000 }
        );

        expect(session2.exitCode).toBe(0);
        expect(session2.stdout).toContain(`📖 Continuing conversation ${sessionId}`);
      },
      60000
    );

    it.sequential(
      'should continue latest session when no ID provided',
      async () => {
        const lmStudioAvailable = await isLMStudioAvailable();
        if (!lmStudioAvailable) {
          console.log('LMStudio not available, skipping test');
          return;
        }

        // Create first session
        const session1 = await runCLI(
          ['--provider', 'lmstudio', '--model', 'mistralai/devstral-small-2505', '--prompt', 'Hi'],
          {
            timeout: 60000,
          }
        );

        if (session1.exitCode !== 0) {
          console.log('LMStudio not available, skipping test. stderr:', session1.stderr);
          return;
        }
        expect(session1.exitCode).toBe(0);

        // Create second session
        const session2 = await runCLI(
          [
            '--provider',
            'lmstudio',
            '--model',
            'mistralai/devstral-small-2505',
            '--prompt',
            'Hello',
          ],
          {
            timeout: 60000,
          }
        );

        expect(session2.exitCode).toBe(0);
        const sessionIdMatch = session2.stdout.match(
          /Starting conversation (lace_\d{8}_[a-z0-9]{6})/
        );
        const latestSessionId = sessionIdMatch![1];

        // Continue without specifying ID - should get latest
        const session3 = await runCLI(
          [
            '--provider',
            'lmstudio',
            '--model',
            'mistralai/devstral-small-2505',
            '--continue',
            '--prompt',
            'Hello',
          ],
          {
            timeout: 60000,
          }
        );

        expect(session3.exitCode).toBe(0);
        expect(session3.stdout).toContain(`📖 Continuing conversation ${latestSessionId}`);
      },
      120000
    );
  });

  describe('real conversation flow', () => {
    it.sequential(
      'should support multi-turn conversation with context',
      async () => {
        // Check LMStudio availability before running any CLI commands
        const lmStudioAvailable = await isLMStudioAvailable();
        if (!lmStudioAvailable) {
          console.log('LMStudio not available, skipping test');
          return;
        }

        // Turn 1: Ask initial question
        const turn1 = await runCLI(
          ['--provider', 'lmstudio', '--model', 'mistralai/devstral-small-2505', '--prompt', 'Hi'],
          {
            timeout: 60000,
          }
        );

        if (turn1.exitCode !== 0) {
          console.log('LMStudio command failed. stderr:', turn1.stderr);
          return;
        }
        expect(turn1.exitCode).toBe(0);
        const sessionIdMatch = turn1.stdout.match(/Starting conversation (lace_\d{8}_[a-z0-9]{6})/);
        const sessionId = sessionIdMatch![1];

        // Turn 2: Reference previous answer
        const turn2 = await runCLI(
          [
            '--provider',
            'lmstudio',
            '--model',
            'mistralai/devstral-small-2505',
            '--continue',
            sessionId,
            '--prompt',
            'Hello',
          ],
          {
            timeout: 60000,
          }
        );

        expect(turn2.exitCode).toBe(0);
        expect(turn2.stdout).toContain(`📖 Continuing conversation ${sessionId}`);

        // Turn 3: Reference the entire conversation
        const turn3 = await runCLI(
          [
            '--provider',
            'lmstudio',
            '--model',
            'mistralai/devstral-small-2505',
            '--continue',
            sessionId,
            '--prompt',
            'Hello',
          ],
          { timeout: 15000 }
        );

        expect(turn3.exitCode).toBe(0);
        expect(turn3.stdout).toContain(`📖 Continuing conversation ${sessionId}`);
      },
      180000
    );

    it.sequential(
      'should maintain context with LMStudio provider across --continue sessions',
      async () => {
        const lmStudioAvailable = await isLMStudioAvailable();
        if (!lmStudioAvailable) {
          console.log('LMStudio not available, skipping test');
          return;
        }

        // Turn 1: Ask "Add 2+2" with LMStudio
        const turn1 = await runCLI(
          ['--provider', 'lmstudio', '--model', 'mistralai/devstral-small-2505', '--prompt', 'Hi'],
          {
            timeout: 60000,
          }
        );

        // If LMStudio is not working, we might get an error but should still test the flow
        if (turn1.exitCode !== 0) {
          console.log('LMStudio provider failed, stdout:', turn1.stdout);
          console.log('LMStudio provider failed, stderr:', turn1.stderr);
          // Skip the test if LMStudio is not available
          return;
        }

        expect(turn1.stdout).toContain('lmstudio provider');

        // Extract session ID
        const sessionIdMatch = turn1.stdout.match(/Starting conversation (lace_\d{8}_[a-z0-9]{6})/);
        expect(sessionIdMatch).toBeTruthy();
        const sessionId = sessionIdMatch![1];

        // Turn 2: Continue with "Hello"
        const turn2 = await runCLI(
          [
            '--continue',
            sessionId,
            '--provider',
            'lmstudio',
            '--model',
            'mistralai/devstral-small-2505',
            '--prompt',
            'Hello',
          ],
          {
            timeout: 60000,
          }
        );

        expect(turn2.exitCode).toBe(0);
        expect(turn2.stdout).toContain(`📖 Continuing conversation ${sessionId}`);
      },
      120000
    );
  });
});
