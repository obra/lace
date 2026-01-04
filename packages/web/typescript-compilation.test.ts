// ABOUTME: High-level test to ensure web package TypeScript compilation is clean
// ABOUTME: Catches type errors and linting issues that could break development

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

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
  async function ensureTypegenOutputs(): Promise<void> {
    execOrThrow('npm run typegen');

    const expectedTypeFiles = [
      join(packageRoot, '.react-router/types/app/routes/+types/_index.ts'),
      join(packageRoot, '.react-router/types/app/routes/+types/docs.ts'),
      join(packageRoot, '.react-router/types/app/routes/+types/play.ts'),
    ];

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (expectedTypeFiles.every((p) => existsSync(p))) return;
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(expectedTypeFiles.filter((p) => !existsSync(p))).toEqual([]);
  }

  beforeAll(async () => {
    await ensureTypegenOutputs();
  }, 130000);

  it('should pass TypeScript type checking', async () => {
    await ensureTypegenOutputs();
    execOrThrow('npx tsc --noEmit');
  }, 130000);

  it('should pass eslint linting', async () => {
    await ensureTypegenOutputs();
    execOrThrow('npx eslint --max-warnings 0');
  }, 130000);
});
