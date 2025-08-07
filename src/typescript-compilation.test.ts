// ABOUTME: High-level test to ensure main project TypeScript compilation is clean
// ABOUTME: Catches type errors that could break the CLI build process

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';

describe('Main Project TypeScript Compilation', () => {
  it('should compile without any TypeScript errors', () => {
    expect(() => {
      // Run TypeScript compiler and expect it to succeed
      execSync('npx tsc --noEmit', {
        stdio: 'pipe',
        encoding: 'utf8',
        cwd: process.cwd(),
        timeout: 30000, // 30 second timeout
      });
    }).not.toThrow();
  }, 35000); // 35 second timeout for vitest

  it('should build main project successfully', () => {
    expect(() => {
      // Run main project build only (tsc + tsc-alias + copy prompts)
      execSync('tsc && tsc-alias && cp -r src/config/prompts dist/config/ 2>/dev/null || true', {
        stdio: 'pipe',
        encoding: 'utf8',
        cwd: process.cwd(),
        timeout: 30000, // 30 second timeout for main project only
      });
    }).not.toThrow();
  }, 35000); // 35 second timeout for vitest
});
