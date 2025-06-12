// ABOUTME: Custom Ink testing utilities that extend ink-testing-library with missing methods
// ABOUTME: Fixes stdin.ref() and other missing stream methods for proper Ink component testing

import { EventEmitter } from 'node:events';
import { render as inkRender } from 'ink';
import { act } from 'react';
import tty from 'node:tty';

/**
 * Strips ANSI escape codes from text for content testing
 * Useful when testing search highlighting or other styled text where you need to verify underlying content
 * @param text - Text potentially containing ANSI escape codes
 * @returns Clean text without ANSI codes
 */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Wraps a character with ANSI inverse/cursor highlighting codes
 * @param char - Character to highlight (usually the character under cursor)
 * @returns Character wrapped with inverse ANSI codes
 */
export function withCursor(char: string): string {
  return `\u001b[7m${char}\u001b[27m`;
}

/**
 * Generate expected text with cursor highlighting at specific position
 * @param text - The base text
 * @param cursorPos - Position where cursor should be (0-based)
 * @returns Text with cursor highlighting at the specified position
 */
export function cursorText(text: string, cursorPos: number): string {
  if (cursorPos >= text.length) {
    // Cursor beyond text length shows highlighted space character
    return text + withCursor(" ");
  }
  
  const before = text.slice(0, cursorPos);
  const cursorChar = text[cursorPos];
  const after = text.slice(cursorPos + 1);
  
  return before + withCursor(cursorChar) + after;
}

/**
 * Custom assertion for testing cursor position in rendered output
 * Verifies both content (without ANSI) and cursor highlighting (with ANSI)
 * @param output - The rendered output from renderInkComponent
 * @param expectedText - The expected text content
 * @param cursorPos - Expected cursor position (0-based)
 */
export function expectCursorAt(output: string, expectedText: string, cursorPos: number) {
  // Verify content is present (without ANSI codes)
  expect(stripAnsi(output)).toContain(expectedText);
  
  // Verify cursor is at correct position (with ANSI codes)
  const expectedWithCursor = cursorText(expectedText, cursorPos);
  expect(output).toContain(expectedWithCursor);
}

/**
 * Assert that output contains no cursor highlighting
 * @param output - The rendered output from renderInkComponent
 * @param expectedText - The expected text content
 */
export function expectNoCursor(output: string, expectedText: string) {
  expect(stripAnsi(output)).toContain(expectedText);
  expect(output).not.toMatch(/\u001b\[7m.*\u001b\[27m/); // No inverse highlighting
}

/**
 * Assert that cursor appears beyond the end of text (as highlighted space)
 * @param output - The rendered output from renderInkComponent  
 * @param text - The text that should appear before the cursor
 */
export function expectCursorBeyondText(output: string, text: string) {
  const expected = text + withCursor(" ");
  expect(output).toContain(expected);
}

/**
 * Assert that cursor appears on an empty line (as highlighted space)
 * @param output - The rendered output from renderInkComponent
 */
export function expectCursorOnEmptyLine(output: string) {
  expect(output).toContain(withCursor(" "));
}

class EnhancedStdin extends EventEmitter {
  public isTTY = true;

  public write(data: string) {
    this.emit('data', data);
  }

  public setEncoding() {
    // Do nothing - mock implementation
  }

  public setRawMode() {
    // Do nothing - mock implementation  
  }

  public resume() {
    // Do nothing - mock implementation
  }

  public pause() {
    // Do nothing - mock implementation
  }

  // Missing methods that Ink's App component needs
  public ref() {
    // Do nothing - mock implementation
  }

  public unref() {
    // Do nothing - mock implementation
  }

  public read() {
    // Return null to indicate no data available
    return null;
  }
}

class EnhancedStdout extends EventEmitter {
  public frames: string[] = [];
  private _lastFrame: string | undefined;

  public columns = 130;
  public rows = 40;
  public isTTY = true;

  public write = (frame: string) => {
    this.frames.push(frame);
    this._lastFrame = frame;
    return true;
  };

  public lastFrame = () => this._lastFrame;

  // Add methods that Ink might call
  public cursorTo = () => {};
  public clearLine = () => {};
  public moveCursor = () => {};
}

class EnhancedStderr extends EventEmitter {
  public frames: string[] = [];
  private _lastFrame: string | undefined;

  public write = (frame: string) => {
    this.frames.push(frame);
    this._lastFrame = frame;
  };

  public lastFrame = () => this._lastFrame;
}

interface RenderResult {
  rerender: (tree: React.ReactElement) => void;
  unmount: () => void;
  cleanup: () => void;
  stdout: EnhancedStdout;
  stderr: EnhancedStderr;
  stdin: EnhancedStdin;
  frames: string[];
  lastFrame: () => string | undefined;
}

export function renderInkComponent(tree: React.ReactElement): RenderResult {
  const stdout = new EnhancedStdout();
  const stderr = new EnhancedStderr();
  const stdin = new EnhancedStdin();

  // Force TTY mode and color support to enable cursor rendering in tests
  const originalIsTTY = process.stdout.isTTY;
  const originalStderrIsTTY = process.stderr.isTTY;
  const originalWrite = process.stdout.write;
  const originalForceColor = process.env.FORCE_COLOR;
  const originalIsatty = tty.isatty;
  const originalColumns = process.stdout.columns;
  const originalRows = process.stdout.rows;
  
  process.stdout.isTTY = true;
  process.stderr.isTTY = true;
  process.stdout.columns = 130;
  process.stdout.rows = 40;
  process.env.FORCE_COLOR = '1'; // Force chalk to enable ANSI codes
  
  // Mock tty.isatty to return true for stdout/stderr file descriptors
  tty.isatty = (fd: number) => {
    if (fd === 1 || fd === 2) return true; // stdout and stderr
    return originalIsatty(fd);
  };

  // Intercept actual stdout writes to capture ANSI codes
  const capturedWrites: string[] = [];
  process.stdout.write = function(chunk: any) {
    if (typeof chunk === 'string') {
      capturedWrites.push(chunk);
      stdout.write(chunk);
    }
    return true;
  } as any;

  let instance: any;
  act(() => {
    instance = inkRender(tree, {
      stdout: process.stdout as any,
      stderr: stderr as any,
      stdin: stdin as any,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false
    });
  });

  // Restore original methods
  const originalUnmount = instance.unmount;
  instance.unmount = () => {
    process.stdout.isTTY = originalIsTTY;
    process.stderr.isTTY = originalStderrIsTTY;
    process.stdout.write = originalWrite;
    process.stdout.columns = originalColumns;
    process.stdout.rows = originalRows;
    tty.isatty = originalIsatty;
    if (originalForceColor === undefined) {
      delete process.env.FORCE_COLOR;
    } else {
      process.env.FORCE_COLOR = originalForceColor;
    }
    return originalUnmount();
  };

  return {
    rerender: instance.rerender,
    unmount: () => act(() => instance.unmount()),
    cleanup: () => act(() => {
      process.stdout.isTTY = originalIsTTY;
      process.stderr.isTTY = originalStderrIsTTY;
      process.stdout.write = originalWrite;
      process.stdout.columns = originalColumns;
      process.stdout.rows = originalRows;
      tty.isatty = originalIsatty;
      if (originalForceColor === undefined) {
        delete process.env.FORCE_COLOR;
      } else {
        process.env.FORCE_COLOR = originalForceColor;
      }
      instance.cleanup();
    }),
    stdout,
    stderr,
    stdin,
    frames: capturedWrites,
    lastFrame: () => capturedWrites.join('')
  };
}