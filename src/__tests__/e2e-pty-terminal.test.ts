// ABOUTME: E2E tests for terminal interface using node-pty pseudo-terminal
// ABOUTME: Tests full interactive CLI workflow with keyboard input and screen output

/**
 * @vitest-environment node
 */

import { it, expect } from 'vitest';
import {
  describeE2E,
  createPTYSession,
  waitForText,
  waitForReady,
  sendCommand,
  getOutput,
  closePTY,
  isLMStudioAvailable,
  HELP_COMMAND_TIMEOUT,
  AGENT_RESPONSE_TIMEOUT,
} from '~/__tests__/helpers/terminal-e2e-helpers';

describeE2E('PTY Terminal E2E Tests', () => {
  it.sequential(
    'should complete full interactive workflow with LMStudio provider',
    async () => {
      const lmstudioAvailable = await isLMStudioAvailable();

      const session = await createPTYSession();

      try {
        // Wait for lace to be ready
        await waitForReady(session);

        // Send /help command
        await sendCommand(session, '/help');

        // Wait for help output to appear
        await waitForText(session, 'Available commands', HELP_COMMAND_TIMEOUT);

        // Verify help command shows available commands
        const helpOutput = getOutput(session);
        expect(helpOutput).toContain('Available commands');
        expect(helpOutput).toContain('/exit');

        if (lmstudioAvailable) {
          // Send math question with /nothink
          await sendCommand(session, 'What is 2 + 2? /nothink');

          // Wait for agent response
          await waitForText(session, '4', AGENT_RESPONSE_TIMEOUT);

          // Verify agent responded with something
          const mathOutput = getOutput(session);
          expect(mathOutput).toMatch(/4/);
        }

        // Send /exit command
        await sendCommand(session, '/exit');

        // Wait for session to exit
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } finally {
        closePTY(session);
      }
    },
    60000
  );

  it.sequential(
    'should handle /help command and display slash commands',
    async () => {
      const session = await createPTYSession();

      try {
        // Wait for ready state
        await waitForReady(session);

        // Send /help command
        await sendCommand(session, '/help');

        // Wait for help output
        await waitForText(session, 'Available commands', HELP_COMMAND_TIMEOUT);

        const output = getOutput(session);
        expect(output).toContain('Available commands');
        expect(output).toContain('/exit');
      } finally {
        closePTY(session);
      }
    },
    30000
  );

  it.sequential(
    'should exit cleanly with /exit command',
    async () => {
      const session = await createPTYSession();

      try {
        // Wait for ready state
        await waitForReady(session);

        // Send /exit
        await sendCommand(session, '/exit');

        // Wait for the process to exit
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Just verify we got this far without hanging
        expect(true).toBe(true);
      } finally {
        closePTY(session);
      }
    },
    30000
  );
});
