// ABOUTME: Tests for PromptManager that orchestrates template engine and variable providers
// ABOUTME: Tests template loading, variable provision, rendering, and fallback behavior

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PromptManager } from '../prompt-manager.js';

// Mock logger to avoid console output during tests
vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}));

// Mock child_process for git commands
vi.mock('child_process', () => ({
  execSync: vi.fn().mockReturnValue(Buffer.from(''))
}));

describe('PromptManager', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-manager-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with default embedded template directory', () => {
      const manager = new PromptManager();
      expect(manager).toBeDefined();
    });

    it('should initialize with custom template directory', () => {
      const manager = new PromptManager({ templateDir: tempDir });
      expect(manager).toBeDefined();
    });

    it('should initialize with tool information', () => {
      const tools = [
        { name: 'bash', description: 'Execute bash commands' },
        { name: 'file-read', description: 'Read files' }
      ];

      const manager = new PromptManager({ tools, templateDir: tempDir });
      expect(manager).toBeDefined();
    });
  });

  describe('template system availability', () => {
    it('should detect when template system is available', () => {
      // Create required template files
      fs.writeFileSync(path.join(tempDir, 'system.md'), 'Test template');

      const manager = new PromptManager({ templateDir: tempDir });
      expect(manager.isTemplateSystemAvailable()).toBe(true);
    });

    it('should detect when template system is not available', () => {
      const manager = new PromptManager({ templateDir: tempDir });
      expect(manager.isTemplateSystemAvailable()).toBe(false);
    });
  });

  describe('prompt generation', () => {
    beforeEach(() => {
      // Create sections directory
      const sectionsDir = path.join(tempDir, 'sections');
      fs.mkdirSync(sectionsDir);

      // Create template sections
      fs.writeFileSync(
        path.join(sectionsDir, 'agent-personality.md'),
        'You are Lace, an AI coding assistant.'
      );

      fs.writeFileSync(
        path.join(sectionsDir, 'environment.md'),
        'OS: {{system.os}}\nWorking Dir: {{project.cwd}}'
      );

      fs.writeFileSync(
        path.join(sectionsDir, 'tools.md'),
        '{{#tools}}Tool: {{name}} - {{description}}\n{{/tools}}'
      );

      fs.writeFileSync(
        path.join(sectionsDir, 'guidelines.md'),
        'Follow best practices and be helpful.'
      );
    });

    it('should generate prompt with all includes and variables', async () => {
      // Create main system template
      fs.writeFileSync(
        path.join(tempDir, 'system.md'),
        '{{include:sections/agent-personality.md}}\n\n{{include:sections/environment.md}}\n\n{{include:sections/tools.md}}\n\n{{include:sections/guidelines.md}}\n\n{{context.disclaimer}}'
      );

      const tools = [
        { name: 'bash', description: 'Execute bash commands' },
        { name: 'file-read', description: 'Read file contents' }
      ];

      const manager = new PromptManager({ tools, templateDir: tempDir });
      const prompt = await manager.generateSystemPrompt();

      expect(prompt).toContain('You are Lace, an AI coding assistant.');
      expect(prompt).toContain('OS:');
      expect(prompt).toContain('Working Dir:');
      expect(prompt).toContain('Tool: bash - Execute bash commands');
      expect(prompt).toContain('Tool: file-read - Read file contents');
      expect(prompt).toContain('Follow best practices and be helpful.');
      expect(prompt).toContain('conversation start');
    });

    it('should generate prompt without tools when none provided', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'system.md'),
        '{{include:sections/agent-personality.md}}\n\n{{#tools}}Tools available{{/tools}}{{^tools}}No tools available{{/tools}}'
      );

      const manager = new PromptManager({ templateDir: tempDir });
      const prompt = await manager.generateSystemPrompt();

      expect(prompt).toContain('You are Lace, an AI coding assistant.');
      expect(prompt).toContain('No tools available');
    });

    it('should handle missing include files gracefully', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'system.md'),
        '{{include:sections/agent-personality.md}}\n\n{{include:sections/missing.md}}\n\nEnd of prompt'
      );

      const manager = new PromptManager({ templateDir: tempDir });
      const prompt = await manager.generateSystemPrompt();

      expect(prompt).toContain('You are Lace, an AI coding assistant.');
      expect(prompt).toContain('<!-- Include not found: sections/missing.md -->');
      expect(prompt).toContain('End of prompt');
    });

    it('should return fallback prompt when template system fails', async () => {
      // Don't create system.md template
      const manager = new PromptManager({ templateDir: tempDir });
      const prompt = await manager.generateSystemPrompt();

      expect(prompt).toBe('You are Lace, an AI coding assistant. Use the available tools to help with programming tasks.');
    });

    it('should handle template syntax errors with fallback', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'system.md'),
        'Valid start {{#broken}} {{/different}} Invalid syntax'
      );

      const manager = new PromptManager({ templateDir: tempDir });
      const prompt = await manager.generateSystemPrompt();

      expect(prompt).toBe('You are Lace, an AI coding assistant. Use the available tools to help with programming tasks.');
    });
  });

  describe('error handling', () => {
    it('should handle template directory permission errors', async () => {
      // Create template file then make directory unreadable
      fs.writeFileSync(path.join(tempDir, 'system.md'), 'Test template');
      fs.chmodSync(tempDir, 0o000);

      try {
        const manager = new PromptManager({ templateDir: tempDir });
        const prompt = await manager.generateSystemPrompt();

        expect(prompt).toBe('You are Lace, an AI coding assistant. Use the available tools to help with programming tasks.');
      } finally {
        fs.chmodSync(tempDir, 0o755);
      }
    });

    it('should handle variable provider errors gracefully', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'system.md'),
        'System: {{system.os}}\nProject: {{project.cwd}}'
      );

      // Mock execSync to throw error for git commands
      const { execSync } = await import('child_process');
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('Git command failed');
      });

      const manager = new PromptManager({ templateDir: tempDir });
      const prompt = await manager.generateSystemPrompt();

      // Should still generate prompt with available variables
      expect(prompt).toContain('System:');
      expect(prompt).toContain('Project:');
    });

    it('should handle empty template file', async () => {
      fs.writeFileSync(path.join(tempDir, 'system.md'), '');

      const manager = new PromptManager({ templateDir: tempDir });
      const prompt = await manager.generateSystemPrompt();

      expect(prompt).toBe('');
    });

    it('should handle template with only whitespace', async () => {
      fs.writeFileSync(path.join(tempDir, 'system.md'), '   \n\t\r\n   ');

      const manager = new PromptManager({ templateDir: tempDir });
      const prompt = await manager.generateSystemPrompt();

      expect(prompt).toBe('   \n\t\r\n   ');
    });
  });

  describe('integration scenarios', () => {
    it('should generate comprehensive prompt with all features', async () => {
      // Create comprehensive template structure
      const sectionsDir = path.join(tempDir, 'sections');
      fs.mkdirSync(sectionsDir);

      fs.writeFileSync(
        path.join(sectionsDir, 'header.md'),
        '# {{title}}\n\nYou are {{agent.name}}, an AI assistant.'
      );

      fs.writeFileSync(
        path.join(sectionsDir, 'environment.md'),
        '## Environment\n\nOS: {{system.os}}\nSession: {{system.sessionTime}}\n{{#git.branch}}Git Branch: {{git.branch}}{{/git.branch}}'
      );

      fs.writeFileSync(
        path.join(sectionsDir, 'tools.md'),
        '## Available Tools\n\n{{#tools}}- **{{name}}**: {{description}}\n{{/tools}}'
      );

      fs.writeFileSync(
        path.join(tempDir, 'system.md'),
        '{{include:sections/header.md}}\n\n{{include:sections/environment.md}}\n\n{{include:sections/tools.md}}\n\n{{context.disclaimer}}'
      );

      const tools = [
        { name: 'bash', description: 'Execute shell commands' },
        { name: 'file-edit', description: 'Edit files' },
        { name: 'web-search', description: 'Search the web' }
      ];

      const manager = new PromptManager({ tools, templateDir: tempDir });
      const prompt = await manager.generateSystemPrompt();

      // Should contain all expected sections
      expect(prompt).toMatch(/# .+/); // Title
      expect(prompt).toContain('You are'); // Agent name
      expect(prompt).toContain('## Environment');
      expect(prompt).toContain('OS:');
      expect(prompt).toContain('Session:');
      expect(prompt).toContain('## Available Tools');
      expect(prompt).toContain('- **bash**: Execute shell commands');
      expect(prompt).toContain('- **file-edit**: Edit files');
      expect(prompt).toContain('- **web-search**: Search the web');
      expect(prompt).toContain('conversation start');
    });

    it('should work with minimal template', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'system.md'),
        'Hello {{name}}!'
      );

      const manager = new PromptManager({ templateDir: tempDir });
      const prompt = await manager.generateSystemPrompt();

      expect(prompt).toBe('Hello !'); // No name provided, mustache renders empty
    });
  });
});