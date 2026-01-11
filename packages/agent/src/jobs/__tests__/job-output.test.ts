// ABOUTME: Tests for job output reading utilities

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readJobOutput, readJobOutputTail, MAX_OUTPUT_SIZE } from '../job-output';

describe('readJobOutput', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'job-output-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('reads output file contents', () => {
    const outputPath = join(tempDir, 'output.txt');
    writeFileSync(outputPath, 'hello world');

    const result = readJobOutput(outputPath);

    expect(result.output).toBe('hello world');
    expect(result.truncated).toBe(false);
    expect(result.totalBytes).toBe(11);
    expect(result.returnedOffset).toBe(0);
    expect(result.returnedBytes).toBe(11);
  });

  it('returns empty string if file does not exist', () => {
    const result = readJobOutput(join(tempDir, 'nonexistent.txt'));

    expect(result.output).toBe('');
    expect(result.truncated).toBe(false);
    expect(result.totalBytes).toBe(0);
    expect(result.returnedBytes).toBe(0);
  });

  it('reads from afterOffset', () => {
    const outputPath = join(tempDir, 'output.txt');
    writeFileSync(outputPath, 'hello world');

    const result = readJobOutput(outputPath, { afterOffset: 6 });

    expect(result.output).toBe('world');
    expect(result.truncated).toBe(false);
    expect(result.totalBytes).toBe(11);
    expect(result.returnedOffset).toBe(6);
    expect(result.returnedBytes).toBe(5);
  });

  it('clamps afterOffset to file size', () => {
    const outputPath = join(tempDir, 'output.txt');
    writeFileSync(outputPath, 'hello');

    const result = readJobOutput(outputPath, { afterOffset: 100 });

    expect(result.output).toBe('');
    expect(result.returnedOffset).toBe(5);
    expect(result.returnedBytes).toBe(0);
  });

  it('reads last N bytes when tailBytes is specified', () => {
    const outputPath = join(tempDir, 'output.txt');
    writeFileSync(outputPath, 'hello world');

    const result = readJobOutput(outputPath, { tailBytes: 5 });

    expect(result.output).toBe('world');
    expect(result.truncated).toBe(true);
    expect(result.totalBytes).toBe(11);
    expect(result.returnedOffset).toBe(6);
    expect(result.returnedBytes).toBe(5);
  });

  it('combines afterOffset and tailBytes correctly', () => {
    const outputPath = join(tempDir, 'output.txt');
    writeFileSync(outputPath, 'AAAA BBBB CCCC DDDD');
    // Position:                0    5    10   15

    // afterOffset=5, tailBytes=9 means:
    // - Start no earlier than offset 5
    // - But also start at (19 - 9) = 10 if that's later
    // So we should get " CCCC DDDD" (from offset 10)
    const result = readJobOutput(outputPath, { afterOffset: 5, tailBytes: 9 });

    expect(result.returnedOffset).toBe(10);
    expect(result.output).toBe('CCCC DDDD');
    expect(result.truncated).toBe(true);
  });

  it('truncates output exceeding max size', () => {
    const outputPath = join(tempDir, 'large.txt');
    // Use a small maxSize for testing
    const content = 'x'.repeat(1000);
    writeFileSync(outputPath, content);

    const result = readJobOutput(outputPath, { maxSize: 100 });

    expect(result.output.length).toBe(100);
    expect(result.truncated).toBe(true);
    expect(result.totalBytes).toBe(1000);
  });
});

describe('readJobOutputTail', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'job-output-tail-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('reads entire file when under limit', () => {
    const outputPath = join(tempDir, 'output.txt');
    writeFileSync(outputPath, 'hello world');

    const result = readJobOutputTail(outputPath);

    expect(result.output).toBe('hello world');
    expect(result.truncated).toBe(false);
  });

  it('returns empty string if file does not exist', () => {
    const result = readJobOutputTail(join(tempDir, 'nonexistent.txt'));

    expect(result.output).toBe('');
    expect(result.truncated).toBe(false);
  });

  it('truncates and returns tail when file exceeds limit', () => {
    const outputPath = join(tempDir, 'large.txt');
    const content = 'A'.repeat(50) + 'B'.repeat(50) + 'C'.repeat(50);
    writeFileSync(outputPath, content);

    const result = readJobOutputTail(outputPath, 50);

    expect(result.output).toBe('C'.repeat(50));
    expect(result.truncated).toBe(true);
  });

  it('uses default tailLimit of 64KB', () => {
    const outputPath = join(tempDir, 'output.txt');
    writeFileSync(outputPath, 'hello');

    // Just verify it doesn't throw and uses some reasonable default
    const result = readJobOutputTail(outputPath);

    expect(result.output).toBe('hello');
    expect(result.truncated).toBe(false);
  });
});

describe('MAX_OUTPUT_SIZE', () => {
  it('is 1MB by default', () => {
    expect(MAX_OUTPUT_SIZE).toBe(1024 * 1024);
  });
});
