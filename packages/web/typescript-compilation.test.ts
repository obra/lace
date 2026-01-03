// ABOUTME: High-level test to ensure web package TypeScript compilation is clean
// ABOUTME: Catches type errors and linting issues that could break development

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { dirname } from 'path';

const packageRoot = process.env.npm_package_json
  ? dirname(process.env.npm_package_json)
  : process.cwd();

function execOrThrow(command: string): void {
  try {
    execSync(command, {
      stdio: 'pipe',
      encoding: 'utf8',
      cwd: packageRoot,
      timeout: 120000,
    });
  } catch (error) {
    const stdout =
      typeof error === 'object' && error !== null && 'stdout' in error
        ? String((error as { stdout?: unknown }).stdout || '')
        : '';
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error
        ? String((error as { stderr?: unknown }).stderr || '')
        : '';

    const message = [
      `Command failed: ${command}`,
      stdout.trim() ? `stdout:\n${stdout.trim()}` : '',
      stderr.trim() ? `stderr:\n${stderr.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    throw new Error(message, { cause: error as unknown });
  }
}

describe.sequential('Web Package TypeScript Compilation', () => {
  beforeAll(() => {
    execOrThrow('npm run typegen');
  }, 130000);

  it('should pass TypeScript type checking', () => {
    expect(() => execOrThrow('npx tsc --noEmit')).not.toThrow();
  }, 130000);

  it('should pass eslint linting', () => {
    expect(() => execOrThrow('npx eslint --max-warnings 0')).not.toThrow();
  }, 130000);
});
