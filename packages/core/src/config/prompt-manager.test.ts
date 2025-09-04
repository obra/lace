// ABOUTME: Tests for PromptManager that orchestrates template engine and variable providers
// ABOUTME: Tests template loading, variable provision, rendering, and fallback behavior

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PromptManager } from '~/config/prompt-manager';

// Mock logger to avoid console output during tests
vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock child_process for git commands
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execSync: vi.fn().mockReturnValue(Buffer.from('')),
  };
});

describe('PromptManager', () => {
  let tempDir: string;
  let originalLaceDir: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-manager-test-'));
    // Override LACE_DIR to use our test directory
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

    it('should initialize with custom template directories', () => {
      const manager = new PromptManager({ templateDirs: [tempDir] });
      expect(manager).toBeDefined();
    });

    it('should initialize with tool information', () => {
      const tools = [
        { name: 'bash', description: 'Execute bash commands' },
        { name: 'file-read', description: 'Read files' },
      ];

      const manager = new PromptManager({ tools, templateDirs: [tempDir] });
      expect(manager).toBeDefined();
    });
  });

  describe('template system availability', () => {
    it('should detect when template system is available', () => {
      // Create required template files
      fs.writeFileSync(path.join(tempDir, 'lace.md'), 'Test template');

      const manager = new PromptManager({ templateDirs: [tempDir] });
      expect(manager.isTemplateSystemAvailable()).toBe(true);
    });

    it('should detect when template system is not available', () => {
      const manager = new PromptManager({ templateDirs: [tempDir] });
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
        path.join(tempDir, 'lace.md'),
        '{{include:sections/agent-personality.md}}\n\n{{include:sections/environment.md}}\n\n{{include:sections/tools.md}}\n\n{{include:sections/guidelines.md}}\n\n{{context.disclaimer}}'
      );

      const tools = [
        { name: 'bash', description: 'Execute bash commands' },
        { name: 'file-read', description: 'Read file contents' },
      ];

      const manager = new PromptManager({ tools, templateDirs: [tempDir] });
      const prompt = await manager.generateSystemPrompt();

      expect(prompt).toContain('You are Lace, an AI coding assistant.');
      expect(prompt).toContain('OS:');
      expect(prompt).toContain('Working Dir:');
      expect(prompt).toContain('Tool: bash - Execute bash commands');
      expect(prompt).toContain('Tool: file-read - Read file contents');
      expect(prompt).toContain('Follow best practices and be helpful.');
      expect(prompt).toContain('start of our conversation');
    });

    it('should generate prompt without tools when none provided', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'lace.md'),
        '{{include:sections/agent-personality.md}}\n\n{{#tools}}Tools available{{/tools}}{{^tools}}No tools available{{/tools}}'
      );

      const manager = new PromptManager({ templateDirs: [tempDir] });
      const prompt = await manager.generateSystemPrompt();

      expect(prompt).toContain('You are Lace, an AI coding assistant.');
      expect(prompt).toContain('No tools available');
    });

    it('should handle missing include files gracefully', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'lace.md'),
        '{{include:sections/agent-personality.md}}\n\n{{include:sections/missing.md}}\n\nEnd of prompt'
      );

      const manager = new PromptManager({ templateDirs: [tempDir] });
      const prompt = await manager.generateSystemPrompt();

      expect(prompt).toContain('You are Lace, an AI coding assistant.');
      expect(prompt).toContain('<!-- Include not found: sections/missing.md -->');
      expect(prompt).toContain('End of prompt');
    });

    it('should return fallback prompt when template system fails', async () => {
      // Don't create lace.md template
      const manager = new PromptManager({ templateDirs: [tempDir] });
      const prompt = await manager.generateSystemPrompt();

      expect(prompt).toBe(
        'You are Lace, an AI coding assistant. Use the available tools to help with programming tasks.'
      );
    });

    it('should handle template syntax errors with fallback', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'lace.md'),
        'Valid start {{#broken}} {{/different}} Invalid syntax'
      );

      const manager = new PromptManager({ templateDirs: [tempDir] });
      const prompt = await manager.generateSystemPrompt();

      expect(prompt).toBe(
        'You are Lace, an AI coding assistant. Use the available tools to help with programming tasks.'
      );
    });
  });

  describe('error handling', () => {
    it('should handle template directory permission errors', async () => {
      // Create template file then make directory unreadable
      fs.writeFileSync(path.join(tempDir, 'lace.md'), 'Test template');
      fs.chmodSync(tempDir, 0o000);

      try {
        const manager = new PromptManager({ templateDirs: [tempDir] });
        const prompt = await manager.generateSystemPrompt();

        expect(prompt).toBe(
          'You are Lace, an AI coding assistant. Use the available tools to help with programming tasks.'
        );
      } finally {
        fs.chmodSync(tempDir, 0o755);
      }
    });

    it('should handle variable provider errors gracefully', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'lace.md'),
        'System: {{system.os}}\nProject: {{project.cwd}}'
      );

      // Mock execSync to throw error for git commands
      const { execSync } = await import('child_process');
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('Git command failed');
      });

      const manager = new PromptManager({ templateDirs: [tempDir] });
      const prompt = await manager.generateSystemPrompt();

      // Should still generate prompt with available variables
      expect(prompt).toContain('System:');
      expect(prompt).toContain('Project:');
    });

    it('should handle empty template file', async () => {
      fs.writeFileSync(path.join(tempDir, 'lace.md'), '');

      const manager = new PromptManager({ templateDirs: [tempDir] });
      const prompt = await manager.generateSystemPrompt();

      expect(prompt).toBe('');
    });

    it('should handle template with only whitespace', async () => {
      fs.writeFileSync(path.join(tempDir, 'lace.md'), '   \n\t\r\n   ');

      const manager = new PromptManager({ templateDirs: [tempDir] });
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
        path.join(tempDir, 'lace.md'),
        '{{include:sections/header.md}}\n\n{{include:sections/environment.md}}\n\n{{include:sections/tools.md}}\n\n{{context.disclaimer}}'
      );

      const tools = [
        { name: 'bash', description: 'Execute shell commands' },
        { name: 'file-edit', description: 'Edit files' },
        { name: 'web-search', description: 'Search the web' },
      ];

      const manager = new PromptManager({ tools, templateDirs: [tempDir] });
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
      expect(prompt).toContain('start of our conversation');
    });

    it('should work with minimal template', async () => {
      fs.writeFileSync(path.join(tempDir, 'lace.md'), 'Hello {{name}}!');

      const manager = new PromptManager({ templateDirs: [tempDir] });
      const prompt = await manager.generateSystemPrompt();

      expect(prompt).toBe('Hello !'); // No name provided, mustache renders empty
    });
  });

  describe('template overlay functionality', () => {
    it('should use user template when available, fall back to default', async () => {
      // Create two template directories
      const userTemplateDir = path.join(tempDir, 'user');
      const defaultTemplateDir = path.join(tempDir, 'default');

      fs.mkdirSync(userTemplateDir, { recursive: true });
      fs.mkdirSync(defaultTemplateDir, { recursive: true });

      // Create different templates in each directory
      fs.writeFileSync(
        path.join(userTemplateDir, 'lace.md'),
        'Custom user template: {{system.os}}'
      );

      fs.writeFileSync(path.join(defaultTemplateDir, 'lace.md'), 'Default template: {{system.os}}');

      // User template should take precedence
      const manager = new PromptManager({ templateDirs: [userTemplateDir, defaultTemplateDir] });
      const prompt = await manager.generateSystemPrompt();

      expect(prompt).toContain('Custom user template:');
      expect(prompt).not.toContain('Default template:');
    });

    it('should fall back to default template when user template is missing', async () => {
      const userTemplateDir = path.join(tempDir, 'user');
      const defaultTemplateDir = path.join(tempDir, 'default');

      fs.mkdirSync(userTemplateDir, { recursive: true });
      fs.mkdirSync(defaultTemplateDir, { recursive: true });

      // Only create template in default directory
      fs.writeFileSync(
        path.join(defaultTemplateDir, 'lace.md'),
        'Default fallback template: {{system.os}}'
      );

      const manager = new PromptManager({ templateDirs: [userTemplateDir, defaultTemplateDir] });
      const prompt = await manager.generateSystemPrompt();

      expect(prompt).toContain('Default fallback template:');
    });

    it('should handle overlay with includes correctly', async () => {
      const userTemplateDir = path.join(tempDir, 'user');
      const defaultTemplateDir = path.join(tempDir, 'default');

      fs.mkdirSync(userTemplateDir, { recursive: true });
      fs.mkdirSync(defaultTemplateDir, { recursive: true });

      // Create sections directories
      fs.mkdirSync(path.join(userTemplateDir, 'sections'), { recursive: true });
      fs.mkdirSync(path.join(defaultTemplateDir, 'sections'), { recursive: true });

      // User has custom personality, default has environment
      fs.writeFileSync(
        path.join(userTemplateDir, 'sections', 'agent-personality.md'),
        'Custom AI Assistant'
      );

      fs.writeFileSync(
        path.join(defaultTemplateDir, 'sections', 'environment.md'),
        'Environment: {{system.os}}'
      );

      // System template uses both includes
      fs.writeFileSync(
        path.join(userTemplateDir, 'lace.md'),
        '{{include:sections/agent-personality.md}}\n\n{{include:sections/environment.md}}'
      );

      const manager = new PromptManager({ templateDirs: [userTemplateDir, defaultTemplateDir] });
      const prompt = await manager.generateSystemPrompt();

      expect(prompt).toContain('Custom AI Assistant'); // From user directory
      expect(prompt).toContain('Environment:'); // From default directory
    });
  });
});
