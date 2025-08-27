// ABOUTME: High-level test to ensure web package TypeScript compilation is clean
// ABOUTME: Catches type errors and linting issues that could break development

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';

describe('Web Package TypeScript Compilation', () => {
  it('should pass TypeScript type checking', () => {
    expect(() => {
      // Run TypeScript compiler without emitting files
      execSync('npx tsc --noEmit', {
        stdio: 'pipe',
        encoding: 'utf8',
        cwd: process.cwd(),
        timeout: 30000, // 30 second timeout
      });
    }).not.toThrow();
  }, 35000); // 35 second timeout for vitest

  it('should pass Next.js linting', () => {
    expect(() => {
      // Run linting with zero warnings allowed
      execSync('npx eslint --max-warnings 0', {
        stdio: 'pipe',
        encoding: 'utf8',
        cwd: process.cwd(),
        timeout: 30000, // 30 second timeout
      });
    }).not.toThrow();
  }, 35000); // 35 second timeout for vitest
});
