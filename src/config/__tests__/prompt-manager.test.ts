// ABOUTME: Tests for prompt manager that orchestrates template system

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PromptManager } from '../prompt-manager.js';

// Mock the logger to avoid file system operations in tests
vi.mock('../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}));

// Mock getLaceDir to use test directory
const mockLaceDir = vi.fn();
vi.mock('../lace-dir.js', () => ({
  getLaceDir: mockLaceDir
}));

describe('PromptManager', () => {
  let tempDir: string;
  let tempLaceDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-prompt-test-'));
    tempLaceDir = path.join(tempDir, '.lace');
    fs.mkdirSync(tempLaceDir);
    mockLaceDir.mockReturnValue(tempLaceDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default configuration', () => {
      const manager = new PromptManager();
      expect(manager).toBeInstanceOf(PromptManager);
    });

    it('should accept custom template directory', () => {
      const customDir = path.join(tempDir, 'custom-prompts');
      fs.mkdirSync(customDir);
      
      const manager = new PromptManager({ templateDir: customDir });
      expect(manager).toBeInstanceOf(PromptManager);
    });

    it('should accept tools configuration', () => {
      const tools = [
        { name: 'bash', description: 'Execute shell commands' }
      ];
      
      const manager = new PromptManager({ tools });
      expect(manager).toBeInstanceOf(PromptManager);
    });

    it('should accept model configuration', () => {
      const model = { id: 'claude-3', provider: 'anthropic' };
      
      const manager = new PromptManager({ model });
      expect(manager).toBeInstanceOf(PromptManager);
    });
  });

  describe('generateSystemPrompt', () => {
    it('should use template system when system.md exists', () => {
      const promptsDir = path.join(tempLaceDir, 'prompts');
      fs.mkdirSync(promptsDir);
      
      const systemTemplate = path.join(promptsDir, 'system.md');
      fs.writeFileSync(systemTemplate, 'Template-based prompt: {{system.os}}');
      
      const manager = new PromptManager();
      const result = manager.generateSystemPrompt();
      
      expect(result).toContain('Template-based prompt:');
      expect(result).toContain(os.platform()); // Should substitute system.os
    });

    it('should fallback to simple system-prompt.md', () => {
      const promptsDir = path.join(tempLaceDir, 'prompts');
      fs.mkdirSync(promptsDir);
      
      const simplePrompt = path.join(promptsDir, 'system-prompt.md');
      fs.writeFileSync(simplePrompt, 'Simple system prompt');
      
      const manager = new PromptManager();
      const result = manager.generateSystemPrompt();
      
      expect(result).toBe('Simple system prompt');
    });

    it('should fallback to legacy location', () => {
      const legacyPrompt = path.join(tempLaceDir, 'system-prompt.md');
      fs.writeFileSync(legacyPrompt, 'Legacy system prompt');
      
      const manager = new PromptManager();
      const result = manager.generateSystemPrompt();
      
      expect(result).toBe('Legacy system prompt');
    });

    it('should use default prompt when no files exist', () => {
      const manager = new PromptManager();
      const result = manager.generateSystemPrompt();
      
      expect(result).toContain('coding assistant');
      expect(result).toContain('bash tool');
    });

    it('should include tools context when provided', () => {
      const promptsDir = path.join(tempLaceDir, 'prompts');
      fs.mkdirSync(promptsDir);
      
      const systemTemplate = path.join(promptsDir, 'system.md');
      fs.writeFileSync(systemTemplate, 'Tools: {{#tools.list}}{{.}} {{/tools.list}}');
      
      const tools = [
        { name: 'bash', description: 'Execute commands' },
        { name: 'git', description: 'Version control' }
      ];
      
      const manager = new PromptManager({ tools });
      const result = manager.generateSystemPrompt();
      
      expect(result).toContain('Tools: bash git');
    });

    it('should include model context when provided', () => {
      const promptsDir = path.join(tempLaceDir, 'prompts');
      fs.mkdirSync(promptsDir);
      
      const systemTemplate = path.join(promptsDir, 'system.md');
      fs.writeFileSync(systemTemplate, 'Model: {{model.id}} ({{model.provider}})');
      
      const model = { id: 'claude-3', provider: 'anthropic' };
      
      const manager = new PromptManager({ model });
      const result = manager.generateSystemPrompt();
      
      expect(result).toContain('Model: claude-3 (anthropic)');
    });
  });

  describe('generateUserInstructions', () => {
    it('should use template system when instructions.md exists', () => {
      const promptsDir = path.join(tempLaceDir, 'prompts');
      fs.mkdirSync(promptsDir);
      
      const instructionsTemplate = path.join(promptsDir, 'instructions.md');
      fs.writeFileSync(instructionsTemplate, 'Template instructions: {{project.name}}');
      
      const manager = new PromptManager();
      const result = manager.generateUserInstructions();
      
      expect(result).toContain('Template instructions:');
    });

    it('should fallback to legacy location', () => {
      const legacyInstructions = path.join(tempLaceDir, 'instructions.md');
      fs.writeFileSync(legacyInstructions, 'Legacy user instructions');
      
      const manager = new PromptManager();
      const result = manager.generateUserInstructions();
      
      expect(result).toBe('Legacy user instructions');
    });

    it('should return empty string when no files exist', () => {
      const manager = new PromptManager();
      const result = manager.generateUserInstructions();
      
      expect(result).toBe('');
    });
  });

  describe('createDefaultTemplates', () => {
    it('should create default template structure', () => {
      const manager = new PromptManager();
      const created = manager.createDefaultTemplates();
      
      expect(created.length).toBeGreaterThan(0);
      
      // Check main system template
      const systemTemplate = path.join(tempLaceDir, 'prompts', 'system.md');
      expect(fs.existsSync(systemTemplate)).toBe(true);
      
      // Check sections directory
      const sectionsDir = path.join(tempLaceDir, 'prompts', 'sections');
      expect(fs.existsSync(sectionsDir)).toBe(true);
      
      // Check individual sections
      const expectedSections = [
        'agent-personality.md',
        'environment.md',
        'tools.md',
        'guidelines.md'
      ];
      
      for (const section of expectedSections) {
        const sectionPath = path.join(sectionsDir, section);
        expect(fs.existsSync(sectionPath)).toBe(true);
      }
    });

    it('should not overwrite existing files', () => {
      const promptsDir = path.join(tempLaceDir, 'prompts');
      fs.mkdirSync(promptsDir);
      
      const systemTemplate = path.join(promptsDir, 'system.md');
      fs.writeFileSync(systemTemplate, 'Existing content');
      
      const manager = new PromptManager();
      const created = manager.createDefaultTemplates();
      
      // Should not include the existing file in created list
      expect(created).not.toContain(systemTemplate);
      
      // Should preserve existing content
      const content = fs.readFileSync(systemTemplate, 'utf-8');
      expect(content).toBe('Existing content');
    });

    it('should include context disclaimer in templates', () => {
      const manager = new PromptManager();
      manager.createDefaultTemplates();
      
      const systemTemplate = path.join(tempLaceDir, 'prompts', 'system.md');
      const content = fs.readFileSync(systemTemplate, 'utf-8');
      
      expect(content).toContain('{{context.disclaimer}}');
    });
  });

  describe('error handling', () => {
    it('should handle template rendering errors gracefully', () => {
      const promptsDir = path.join(tempLaceDir, 'prompts');
      fs.mkdirSync(promptsDir);
      
      const systemTemplate = path.join(promptsDir, 'system.md');
      fs.writeFileSync(systemTemplate, '{{include:nonexistent.md}}');
      
      const manager = new PromptManager();
      const result = manager.generateSystemPrompt();
      
      // Should not throw and should return some content
      expect(typeof result).toBe('string');
    });

    it('should handle file system errors during template creation', () => {
      // Mock fs.mkdirSync to throw an error
      const originalMkdirSync = fs.mkdirSync;
      fs.mkdirSync = vi.fn().mockImplementation(() => {
        throw new Error('Permission denied');
      });
      
      try {
        const manager = new PromptManager();
        const created = manager.createDefaultTemplates();
        
        // Should handle the error and return empty array
        expect(Array.isArray(created)).toBe(true);
      } finally {
        fs.mkdirSync = originalMkdirSync;
      }
    });
  });
});