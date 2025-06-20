// ABOUTME: Tests for configurable prompt system using LACE_DIR
// ABOUTME: Tests file auto-creation, default content, and environment variable handling

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadPromptConfig, getUserInstructionsFilePath } from '../prompts.js';

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
    it('should create instructions file when it does not exist and generate system prompt from templates', async () => {
      const config = await loadPromptConfig();

      // System prompt should come from templates, not be the old default
      expect(config.systemPrompt).toContain('Lace');
      expect(config.systemPrompt.length).toBeGreaterThan(50); // Templates generate longer prompts
      expect(config.userInstructions).toBe('');
      expect(config.filesCreated).toHaveLength(1);

      const instructionsPath = path.join(tempDir, 'instructions.md');
      expect(config.filesCreated).toContain(instructionsPath);

      // Only instructions file should be created (not system-prompt.md)
      expect(fs.existsSync(instructionsPath)).toBe(true);
      
      const systemPromptPath = path.join(tempDir, 'system-prompt.md');
      expect(fs.existsSync(systemPromptPath)).toBe(false);
    });

    it('should read existing instructions file and generate system prompt from templates', async () => {
      // Pre-create instructions file with custom content
      const instructionsPath = path.join(tempDir, 'instructions.md');
      const customInstructions = 'Always use strict typing.';
      fs.writeFileSync(instructionsPath, customInstructions);

      const config = await loadPromptConfig();

      // System prompt should come from templates (not from any file)
      expect(config.systemPrompt).toContain('Lace');
      expect(config.systemPrompt.length).toBeGreaterThan(50);
      expect(config.userInstructions).toBe(customInstructions);
      expect(config.filesCreated).toHaveLength(0);
    });

    it('should create instructions file when it does not exist', async () => {
      // No files exist initially

      const config = await loadPromptConfig();

      // System prompt should come from templates
      expect(config.systemPrompt).toContain('Lace');
      expect(config.systemPrompt.length).toBeGreaterThan(50);
      expect(config.userInstructions).toBe(''); // Default empty
      expect(config.filesCreated).toHaveLength(1);

      const instructionsPath = path.join(tempDir, 'instructions.md');
      expect(config.filesCreated).toContain(instructionsPath);
      expect(fs.existsSync(instructionsPath)).toBe(true);
    });

    it('should trim whitespace from instructions file contents', async () => {
      const instructionsPath = path.join(tempDir, 'instructions.md');
      const instructionsWithWhitespace = '  \n  Custom instructions  \n  ';

      fs.writeFileSync(instructionsPath, instructionsWithWhitespace);

      const config = await loadPromptConfig();

      // System prompt comes from templates
      expect(config.systemPrompt).toContain('Lace');
      expect(config.userInstructions).toBe('Custom instructions');
    });

    it('should handle empty instructions file gracefully', async () => {
      const instructionsPath = path.join(tempDir, 'instructions.md');
      fs.writeFileSync(instructionsPath, '');

      const config = await loadPromptConfig();

      // System prompt comes from templates
      expect(config.systemPrompt).toContain('Lace');
      expect(config.userInstructions).toBe('');
      expect(config.filesCreated).toHaveLength(0);
    });

    it('should create LACE_DIR if it does not exist', async () => {
      const nestedTempDir = path.join(tempDir, 'nested', 'directory');
      process.env.LACE_DIR = nestedTempDir;

      expect(fs.existsSync(nestedTempDir)).toBe(false);

      const config = await loadPromptConfig();

      expect(fs.existsSync(nestedTempDir)).toBe(true);
      expect(config.filesCreated).toHaveLength(1); // Only instructions.md
    });

    it('should handle multiline instructions correctly', async () => {
      const instructionsPath = path.join(tempDir, 'instructions.md');
      const multilineInstructions = `Key responsibilities:
1. Help with programming tasks
2. Use appropriate tools
3. Provide clear explanations

Remember to be helpful and accurate.`;

      fs.writeFileSync(instructionsPath, multilineInstructions);

      const config = await loadPromptConfig();

      // System prompt comes from templates
      expect(config.systemPrompt).toContain('Lace');
      expect(config.userInstructions).toBe(multilineInstructions);
    });
  });

  describe('getUserInstructionsFilePath', () => {
    it('should return correct instructions file path based on LACE_DIR', () => {
      const instructionsPath = getUserInstructionsFilePath();

      expect(instructionsPath).toBe(path.join(tempDir, 'instructions.md'));
    });

    it('should default to ~/.lace when LACE_DIR is not set', () => {
      delete process.env.LACE_DIR;

      const instructionsPath = getUserInstructionsFilePath();
      const expectedPath = path.join(os.homedir(), '.lace', 'instructions.md');

      expect(instructionsPath).toBe(expectedPath);
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

    it('should throw meaningful error if instructions file cannot be created', async () => {
      // Create a directory where the instructions file should be
      const instructionsPath = path.join(tempDir, 'instructions.md');
      fs.mkdirSync(instructionsPath);

      await expect(loadPromptConfig()).rejects.toThrow(/Failed to read\/create prompt file/);
    });
  });

  describe('file content validation', () => {
    it('should handle instructions files with only whitespace', async () => {
      const instructionsPath = path.join(tempDir, 'instructions.md');
      fs.writeFileSync(instructionsPath, '   \n\t\r\n   ');

      const config = await loadPromptConfig();

      // System prompt comes from templates
      expect(config.systemPrompt).toContain('Lace');
      expect(config.userInstructions).toBe('');
    });

    it('should preserve newlines within instructions content after trimming edges', async () => {
      const instructionsPath = path.join(tempDir, 'instructions.md');
      const contentWithNewlines = `  First line\n\nSecond paragraph\n\nThird paragraph  `;
      fs.writeFileSync(instructionsPath, contentWithNewlines);

      const config = await loadPromptConfig();

      // System prompt comes from templates
      expect(config.systemPrompt).toContain('Lace');
      expect(config.userInstructions).toBe('First line\n\nSecond paragraph\n\nThird paragraph');
    });
  });

  describe('default content', () => {
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
