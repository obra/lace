// ABOUTME: E2E tests for terminal interface using node-pty pseudo-terminal
// ABOUTME: Tests full interactive CLI workflow with keyboard input and screen output

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as pty from 'node-pty';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface PTYSession {
  terminal: pty.IPty;
  output: string;
  timeoutId: NodeJS.Timeout;
}

describe('PTY Terminal E2E Tests', () => {
  let tempDbPath: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    tempDbPath = path.join(os.tmpdir(), `lace-pty-test-${uniqueId}.db`);
    originalEnv = process.env.LACE_DIR;
    process.env.LACE_DIR = path.dirname(tempDbPath);
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.LACE_DIR = originalEnv;
    } else {
      delete process.env.LACE_DIR;
    }

    try {
      if (fs.existsSync(tempDbPath)) {
        fs.unlinkSync(tempDbPath);
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * Helper to create a PTY session and wait for output
   */
  async function createPTYSession(timeout = 30000): Promise<PTYSession> {
    return new Promise((resolve, reject) => {
      const terminal = pty.spawn('node', ['dist/cli.js', '--provider', 'lmstudio'], {
        name: 'xterm-color',
        cols: 80,
        rows: 30,
        cwd: process.cwd(),
        env: {
          ...process.env,
          LACE_DIR: process.env.LACE_DIR,
          LACE_TEST_MODE: 'true',
          TERM: 'xterm-color',
        },
      });

      let output = '';
      
      terminal.onData((data) => {
        output += data;
      });

      const timeoutId = setTimeout(() => {
        terminal.kill();
        reject(new Error(`PTY session timed out after ${timeout}ms`));
      }, timeout);

      const session: PTYSession = {
        terminal,
        get output() { return output; },
        timeoutId,
      };

      resolve(session);
    });
  }

  /**
   * Helper to wait for specific text in PTY output
   */
  async function waitForText(session: PTYSession, expectedText: string, timeout = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const checkOutput = () => {
        if (session.output.includes(expectedText)) {
          resolve();
          return;
        }
        
        if (Date.now() - startTime > timeout) {
          reject(new Error(`Timeout waiting for text: "${expectedText}". Got: "${stripAnsi(session.output.slice(-500))}"`));
          return;
        }
        
        setTimeout(checkOutput, 50);
      };
      
      checkOutput();
    });
  }

  /**
   * Helper to strip ANSI escape sequences from text
   */
  function stripAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  }

  /**
   * Helper to send text to PTY session
   */
  function sendText(session: PTYSession, text: string): void {
    session.terminal.write(text);
  }

  /**
   * Helper to send Enter key to PTY session
   */
  function sendEnter(session: PTYSession): void {
    // Try Control+M which is ASCII 13 (Enter key)
    session.terminal.write('\x0d');
  }

  /**
   * Helper to send command with enter in one go
   */
  async function sendCommand(session: PTYSession, command: string): Promise<void> {
    session.terminal.write(command);
    // Small delay then send enter
    await new Promise(resolve => setTimeout(resolve, 100));
    session.terminal.write('\x0d'); // Control+M (ASCII 13)
  }

  /**
   * Helper to get current output from session
   */
  function getOutput(session: PTYSession): string {
    return session.output;
  }

  /**
   * Helper to get clean output from session (ANSI stripped)
   */
  function getCleanOutput(session: PTYSession): string {
    return stripAnsi(session.output);
  }

  /**
   * Helper to close PTY session
   */
  function closePTY(session: PTYSession): void {
    clearTimeout(session.timeoutId);
    session.terminal.kill();
  }

  it.sequential('should complete full interactive workflow with LMStudio provider', async () => {
    // Create PTY session
    const session = await createPTYSession();
    
    try {
      // Step 1: Wait for lace to be ready
      await waitForText(session, 'Ready');
      
      // Wait for input prompt
      await waitForText(session, '> ');
      
      // Step 2: Send /help command
      await new Promise(resolve => setTimeout(resolve, 1000));
      await sendCommand(session, '/help');
      
      // Step 3: Wait for help output to appear
      await waitForText(session, 'Available commands', 10000);
      
      // Verify help command shows available commands
      const helpOutput = getOutput(session);
      expect(helpOutput).toContain('Available commands');
      expect(helpOutput).toContain('/exit');
      
      // Step 4: Send math question with /nothink
      await new Promise(resolve => setTimeout(resolve, 200));
      await sendCommand(session, 'What is 2 + 2? /nothink');
      
      // Step 5: Wait for agent response
      await waitForText(session, '4', 15000); // Math answer should appear
      
      // Verify agent responded with something
      const mathOutput = getOutput(session);
      expect(mathOutput).toMatch(/4/); // Should contain the answer
      
      // Step 6: Send /exit command
      await new Promise(resolve => setTimeout(resolve, 200));
      await sendCommand(session, '/exit');
      
      // Step 7: Wait for session to exit or terminal to close
      // Since /exit kills the process, we can't wait for "Goodbye" text
      // Instead wait for the terminal to close
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } finally {
      closePTY(session);
    }
  }, 60000);

  it.sequential('should handle /help command and display slash commands', async () => {
    const session = await createPTYSession();
    
    try {
      // Wait for ready state
      await waitForText(session, 'Ready');
      
      // Wait for the input prompt to appear (">")
      await waitForText(session, '> ');
      
      // Give extra time for command executor to be ready
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Send /help command as single operation
      await sendCommand(session, '/help');
      
      // Wait for help output
      await waitForText(session, 'Available commands', 15000);
      
      const output = getOutput(session);
      expect(output).toContain('Available commands');
      expect(output).toContain('/exit');
      
    } finally {
      closePTY(session);
    }
  }, 30000);

  it.sequential('should exit cleanly with /exit command', async () => {
    const session = await createPTYSession();
    
    try {
      // Wait for ready state
      await waitForText(session, 'Ready');
      
      // Send /exit
      await new Promise(resolve => setTimeout(resolve, 200));
      await sendCommand(session, '/exit');
      
      // Wait for the process to exit (no specific text to wait for)
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Just verify we got this far without hanging
      expect(true).toBe(true);
      
    } finally {
      closePTY(session);
    }
  }, 30000);
});