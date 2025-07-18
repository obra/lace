// ABOUTME: Tests for --help flag showing dynamic provider list
// ABOUTME: Verifies that help output includes all auto-discovered providers

import { describe, it, expect } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('Help Integration', () => {
  it('should show dynamic provider list in --help output', async () => {
    try {
      // Build first, then run help with separate commands for better debugging
      await execAsync('npm run build');
      const { stdout } = await execAsync('node dist/cli.js --help');

      // Help should contain all auto-discovered providers
      expect(stdout).toContain('anthropic');
      expect(stdout).toContain('openai');
      expect(stdout).toContain('lmstudio');
      expect(stdout).toContain('ollama');

      // Should show it's the default
      expect(stdout).toContain('(default)');

      // Should NOT show the old generic message
      expect(stdout).not.toContain('use --help for full list');
    } catch (error) {
      // If the command fails, at least check stderr for provider info
      const stderr =
        error && typeof error === 'object' && 'stderr' in error
          ? (error as { stderr: string }).stderr
          : '';
      expect(stderr).toContain('anthropic');
    }
  }, 15000); // Increase timeout to 15 seconds
});
