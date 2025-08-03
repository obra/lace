// ABOUTME: High-level test to ensure TypeScript compilation is clean
// ABOUTME: Catches type errors that could break the build process

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';

describe('TypeScript Compilation', () => {
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

  it('should have clean TypeScript output for build', () => {
    expect(() => {
      // Run the actual build command (includes web package build)
      execSync('npm run build', {
        stdio: 'pipe',
        encoding: 'utf8',
        cwd: process.cwd(),
        timeout: 60000, // 60 second timeout for full build including web package
      });
    }).not.toThrow();
  }, 70000); // 70 second timeout for vitest
});
