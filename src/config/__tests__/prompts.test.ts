// ABOUTME: Tests for configurable prompt system using LACE_DIR
// ABOUTME: Tests file auto-creation, default content, and environment variable handling

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadPromptConfig, getPromptFilePaths } from '../prompts.js';

describe('Prompt Configuration', () => {
  let tempDir: string;
  let originalLaceDir: string | undefined;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-test-'));

    // Save original LACE_DIR and set to temp directory
    originalLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = tempDir;
  });

  afterEach(() => {
    // Restore original LACE_DIR
    if (originalLaceDir !== undefined) {
      process.env.LACE_DIR = originalLaceDir;
    } else {
      delete process.env.LACE_DIR;
    }

    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('loadPromptConfig', () => {
    it('should create default files when they do not exist', async () => {
      const config = await loadPromptConfig();

      expect(config.systemPrompt).toBe(
        'You are Lace, an AI coding assistant. Use the available tools to help with programming tasks.'
      );
      expect(config.userInstructions).toBe('');
      expect(config.filesCreated).toHaveLength(2);

      const systemPromptPath = path.join(tempDir, 'system-prompt.md');
      const instructionsPath = path.join(tempDir, 'instructions.md');

      expect(config.filesCreated).toContain(systemPromptPath);
      expect(config.filesCreated).toContain(instructionsPath);

      // Verify files actually exist
      expect(fs.existsSync(systemPromptPath)).toBe(true);
      expect(fs.existsSync(instructionsPath)).toBe(true);
    });

    it('should read existing files without creating new ones', async () => {
      // Pre-create files with custom content
      const systemPromptPath = path.join(tempDir, 'system-prompt.md');
      const instructionsPath = path.join(tempDir, 'instructions.md');

      const customSystemPrompt = 'You are a specialized TypeScript assistant.';
      const customInstructions = 'Always use strict typing.';

      fs.writeFileSync(systemPromptPath, customSystemPrompt);
      fs.writeFileSync(instructionsPath, customInstructions);

      const config = await loadPromptConfig();

      expect(config.systemPrompt).toBe(customSystemPrompt);
      expect(config.userInstructions).toBe(customInstructions);
      expect(config.filesCreated).toHaveLength(0);
    });

    it('should handle mixed scenario where only one file exists', async () => {
      // Pre-create only system prompt file
      const systemPromptPath = path.join(tempDir, 'system-prompt.md');
      const customSystemPrompt = 'Custom system prompt';

      fs.writeFileSync(systemPromptPath, customSystemPrompt);

      const config = await loadPromptConfig();

      expect(config.systemPrompt).toBe(customSystemPrompt);
      expect(config.userInstructions).toBe(''); // Default empty
      expect(config.filesCreated).toHaveLength(1);

      const instructionsPath = path.join(tempDir, 'instructions.md');
      expect(config.filesCreated).toContain(instructionsPath);
      expect(fs.existsSync(instructionsPath)).toBe(true);
    });

    it('should trim whitespace from file contents', async () => {
      const systemPromptPath = path.join(tempDir, 'system-prompt.md');
      const instructionsPath = path.join(tempDir, 'instructions.md');

      const systemPromptWithWhitespace = '  \n  Custom system prompt  \n  ';
      const instructionsWithWhitespace = '  \n  Custom instructions  \n  ';

      fs.writeFileSync(systemPromptPath, systemPromptWithWhitespace);
      fs.writeFileSync(instructionsPath, instructionsWithWhitespace);

      const config = await loadPromptConfig();

      expect(config.systemPrompt).toBe('Custom system prompt');
      expect(config.userInstructions).toBe('Custom instructions');
    });

    it('should handle empty files gracefully', async () => {
      const systemPromptPath = path.join(tempDir, 'system-prompt.md');
      const instructionsPath = path.join(tempDir, 'instructions.md');

      fs.writeFileSync(systemPromptPath, '');
      fs.writeFileSync(instructionsPath, '');

      const config = await loadPromptConfig();

      expect(config.systemPrompt).toBe('');
      expect(config.userInstructions).toBe('');
      expect(config.filesCreated).toHaveLength(0);
    });

    it('should create LACE_DIR if it does not exist', async () => {
      const nestedTempDir = path.join(tempDir, 'nested', 'directory');
      process.env.LACE_DIR = nestedTempDir;

      expect(fs.existsSync(nestedTempDir)).toBe(false);

      const config = await loadPromptConfig();

      expect(fs.existsSync(nestedTempDir)).toBe(true);
      expect(config.filesCreated).toHaveLength(2);
    });

    it('should handle multiline prompts correctly', async () => {
      const systemPromptPath = path.join(tempDir, 'system-prompt.md');
      const multilinePrompt = `You are a coding assistant.

Key responsibilities:
1. Help with programming tasks
2. Use appropriate tools
3. Provide clear explanations

Remember to be helpful and accurate.`;

      fs.writeFileSync(systemPromptPath, multilinePrompt);

      const config = await loadPromptConfig();

      expect(config.systemPrompt).toBe(multilinePrompt);
    });
  });

  describe('getPromptFilePaths', () => {
    it('should return correct file paths based on LACE_DIR', () => {
      const paths = getPromptFilePaths();

      expect(paths.systemPromptPath).toBe(path.join(tempDir, 'system-prompt.md'));
      expect(paths.userInstructionsPath).toBe(path.join(tempDir, 'instructions.md'));
    });

    it('should default to ~/.lace when LACE_DIR is not set', () => {
      delete process.env.LACE_DIR;

      const paths = getPromptFilePaths();
      const expectedDir = path.join(os.homedir(), '.lace');

      expect(paths.systemPromptPath).toBe(path.join(expectedDir, 'system-prompt.md'));
      expect(paths.userInstructionsPath).toBe(path.join(expectedDir, 'instructions.md'));
    });
  });

  describe('error handling', () => {
    it('should throw meaningful error if directory creation fails', async () => {
      // Set LACE_DIR to a path that cannot be created (e.g., inside a file)
      const invalidPath = path.join(tempDir, 'file.txt', 'invalid');
      fs.writeFileSync(path.join(tempDir, 'file.txt'), 'content');
      process.env.LACE_DIR = invalidPath;

      await expect(loadPromptConfig()).rejects.toThrow(/Failed to create Lace configuration directory/);
    });

    it('should throw meaningful error if file cannot be created', async () => {
      // Create a directory where the system prompt file should be
      const systemPromptPath = path.join(tempDir, 'system-prompt.md');
      fs.mkdirSync(systemPromptPath);

      await expect(loadPromptConfig()).rejects.toThrow(/Failed to read\/create prompt file/);
    });
  });

  describe('file content validation', () => {
    it('should handle files with only whitespace', async () => {
      const systemPromptPath = path.join(tempDir, 'system-prompt.md');
      fs.writeFileSync(systemPromptPath, '   \n\t\r\n   ');

      const config = await loadPromptConfig();

      expect(config.systemPrompt).toBe('');
    });

    it('should preserve newlines within content after trimming edges', async () => {
      const systemPromptPath = path.join(tempDir, 'system-prompt.md');
      const contentWithNewlines = `  First line\n\nSecond paragraph\n\nThird paragraph  `;
      fs.writeFileSync(systemPromptPath, contentWithNewlines);

      const config = await loadPromptConfig();

      expect(config.systemPrompt).toBe('First line\n\nSecond paragraph\n\nThird paragraph');
    });
  });

  describe('default content', () => {
    it('should create system prompt with expected default content', async () => {
      await loadPromptConfig();

      const systemPromptPath = path.join(tempDir, 'system-prompt.md');
      const content = fs.readFileSync(systemPromptPath, 'utf-8');

      expect(content).toBe(
        'You are Lace, an AI coding assistant. Use the available tools to help with programming tasks.'
      );
    });

    it('should create instructions file with empty default content', async () => {
      await loadPromptConfig();

      const instructionsPath = path.join(tempDir, 'instructions.md');
      const content = fs.readFileSync(instructionsPath, 'utf-8');

      expect(content).toBe('');
    });
  });

  describe('filesystem edge cases', () => {
    it('should handle readonly directory gracefully', async () => {
      // Make the directory readonly
      fs.chmodSync(tempDir, 0o444);

      try {
        await expect(loadPromptConfig()).rejects.toThrow();
      } finally {
        // Restore write permissions for cleanup
        fs.chmodSync(tempDir, 0o755);
      }
    });

    it('should handle very long file paths', async () => {
      const longPath = path.join(tempDir, 'a'.repeat(100), 'b'.repeat(100));
      process.env.LACE_DIR = longPath;

      // This should either work or throw a meaningful error
      await expect(async () => {
        const config = await loadPromptConfig();
        expect(config).toBeDefined();
      }).not.toThrow(/undefined/);
    });
  });
});
