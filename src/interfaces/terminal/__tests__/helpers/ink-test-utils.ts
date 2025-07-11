// ABOUTME: Custom Ink testing utilities adapted from original lace
// ABOUTME: Provides helpers for testing React/Ink components with proper TTY and ANSI handling

import { EventEmitter } from 'node:events';
import { render as inkRender } from 'ink';
import { act } from '@testing-library/react';
import tty from 'node:tty';
import { expect } from 'vitest';
import React from 'react';
import { LaceFocusProvider } from '~/interfaces/terminal/focus/focus-provider.js';

/**
 * Strips ANSI escape codes from text for content testing
 * Useful when testing cursor highlighting or other styled text
 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
}

/**
 * Wraps a character with ANSI inverse/cursor highlighting codes
 */
export function withCursor(char: string): string {
  return `\u001b[7m${char}\u001b[27m`;
}

/**
 * Generate expected text with cursor highlighting at specific position
 */
export function cursorText(text: string, cursorPos: number): string {
  if (cursorPos >= text.length) {
    // Cursor beyond text length shows highlighted space character
    return text + withCursor(' ');
  }

  const before = text.slice(0, cursorPos);
  const cursorChar = text[cursorPos];
  const after = text.slice(cursorPos + 1);

  return before + withCursor(cursorChar) + after;
}

/**
 * Custom assertion for testing cursor position in rendered output
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
 */
export function expectNoCursor(output: string, expectedText: string) {
  expect(stripAnsi(output)).toContain(expectedText);
  // eslint-disable-next-line no-control-regex
  expect(output).not.toMatch(/\u001b\[7m.*\u001b\[27m/); // No inverse highlighting
}

/**
 * Assert that cursor appears beyond the end of text (as highlighted space)
 */
export function expectCursorBeyondText(output: string, text: string) {
  const expected = text + withCursor(' ');
  expect(output).toContain(expected);
}

/**
 * Assert that cursor appears on an empty line (as highlighted space)
 */
export function expectCursorOnEmptyLine(output: string) {
  expect(output).toContain(withCursor(' '));
}

class EnhancedStdin extends EventEmitter {
  public isTTY = true;

  public write(data: string) {
    this.emit('data', data);
  }

  public setEncoding() {
    // Mock implementation
  }

  public setRawMode() {
    // Mock implementation
  }

  public resume() {
    // Mock implementation
  }

  public pause() {
    // Mock implementation
  }

  // Missing methods that Ink's App component needs
  public ref() {
    // Mock implementation
  }

  public unref() {
    // Mock implementation
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

  public lastNonEmptyFrame = () => {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (this.frames[i]?.trim() !== '') {
        return this.frames[i];
      }
    }
    return undefined;
  };

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

/**
 * Renders an Ink component wrapped with LaceFocusProvider for focus system testing
 */
export function renderInkComponentWithFocus(tree: React.ReactElement): RenderResult {
  return renderInkComponent(React.createElement(LaceFocusProvider, { children: tree }));
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.stdout.write = function (chunk: any) {
    if (typeof chunk === 'string') {
      capturedWrites.push(chunk);
      stdout.write(chunk);
    }
    return true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let instance: any;
  act(() => {
    instance = inkRender(tree, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stdout: process.stdout as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stderr: stderr as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stdin: stdin as any,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
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
    cleanup: () =>
      act(() => {
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
    lastFrame: () => {
      if (capturedWrites.length === 0) return undefined;

      // Start with the last frame
      const result = capturedWrites[capturedWrites.length - 1] || '';

      // If the last frame is only ANSI codes (no visible content),
      // look backwards and coalesce with frames that have content
      // eslint-disable-next-line no-control-regex
      const stripped = result.replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '');
      if (stripped.trim() === '') {
        // Last frame is only ANSI, find the last frame with content and combine
        for (let i = capturedWrites.length - 2; i >= 0; i--) {
          const frame = capturedWrites[i];
          if (frame) {
            // eslint-disable-next-line no-control-regex
            const frameStripped = frame.replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '');
            if (frameStripped.trim() !== '') {
              // Found a frame with content, combine it with trailing ANSI codes
              return frame + result;
            }
          }
        }
      }

      return result;
    },
  };
}
