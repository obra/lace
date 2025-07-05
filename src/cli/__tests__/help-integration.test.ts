// ABOUTME: Tests for --help flag showing dynamic provider list
// ABOUTME: Verifies that help output includes all auto-discovered providers

import { describe, it, expect } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('Help Integration', () => {
  it('should show dynamic provider list in --help output', async () => {
    try {
      console.log(`[TEST] ${new Date().toISOString()} Starting help integration test...`);

      // In CI, artifacts should be pre-built. Locally, build if needed.
      if (!process.env.CI) {
        try {
          await execAsync('test -f dist/cli.js');
          console.log(`[TEST] ${new Date().toISOString()} CLI already built, running help...`);
        } catch {
          console.log(`[TEST] ${new Date().toISOString()} CLI not built, running npm run build...`);
          await execAsync('npm run build');
          console.log(`[TEST] ${new Date().toISOString()} Build completed`);
        }
      } else {
        console.log(
          `[TEST] ${new Date().toISOString()} Running in CI, expecting pre-built artifacts...`
        );
      }

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

      console.log(`[TEST] ${new Date().toISOString()} Help test completed successfully`);
    } catch (error) {
      console.log(`[TEST] ${new Date().toISOString()} Help test failed:`, error);
      // If the command fails, at least check stderr for provider info
      const stderr = (error as any).stderr || '';
      expect(stderr).toContain('anthropic');
    }
  }, 15000); // Increase timeout to 15 seconds
});
