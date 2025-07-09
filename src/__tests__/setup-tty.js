// ABOUTME: TTY setup for E2E tests to ensure proper terminal behavior in CI environments
// ABOUTME: Configures stdio streams to behave like real terminals for node-pty testing

import { WriteStream, ReadStream } from 'tty';

// Force TTY behavior for CI environments
// This ensures node-pty tests can run properly in headless CI environments
ReadStream.prototype.isTTY = true;
WriteStream.prototype.isTTY = true;

// Set environment variables for consistent terminal behavior
process.env.FORCE_COLOR = '3';
process.env.TERM = 'xterm-256color';
process.env.COLORTERM = 'truecolor';

// Override stdio TTY properties
if (process.stdout && typeof process.stdout.isTTY === 'undefined') {
  process.stdout.isTTY = true;
}
if (process.stderr && typeof process.stderr.isTTY === 'undefined') {
  process.stderr.isTTY = true;
}
if (process.stdin && typeof process.stdin.isTTY === 'undefined') {
  process.stdin.isTTY = true;
}

// Set additional terminal properties for better node-pty compatibility
process.stdout.columns = 80;
process.stdout.rows = 24;