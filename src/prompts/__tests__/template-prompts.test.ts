// ABOUTME: Tests for template-based prompt configuration that replaces the old static system
// ABOUTME: Tests integration with existing config/prompts.ts interface

import { loadTemplatePromptConfig } from '../template-prompts.js';
import { Tool } from '../../tools/types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Template Prompt Configuration', () => {
  let testLaceDir: string;
  let promptsDir: string;
  let mockTools: Tool[];

  beforeEach(() => {
    // Create temporary lace directory structure
    testLaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-config-test-'));
    promptsDir = path.join(testLaceDir, 'prompts');
    fs.mkdirSync(promptsDir);
    fs.mkdirSync(path.join(promptsDir, 'sections'));

    mockTools = [
      {
        name: 'bash',
        description: 'Execute bash commands',
        input_schema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Command to execute' }
          },
          required: ['command']
        },
        executeTool: async () => ({ content: [{ type: 'text', text: 'output' }], isError: false })
      }
    ];
  });

  afterEach(() => {
    fs.rmSync(testLaceDir, { recursive: true, force: true });
  });

  it('should maintain compatibility with existing PromptConfig interface', () => {
    const template = `You are an AI assistant.\n\n{{tools.descriptions}}`;
    fs.writeFileSync(path.join(promptsDir, 'system.md'), template);

    const config = loadTemplatePromptConfig({
      laceDir: testLaceDir,
      workingDir: testLaceDir,
      tools: mockTools
    });

    // Should maintain the same interface as the old config
    expect(config).toHaveProperty('systemPrompt');
    expect(config).toHaveProperty('userInstructions');
    expect(config).toHaveProperty('filesCreated');

    expect(typeof config.systemPrompt).toBe('string');
    expect(typeof config.userInstructions).toBe('string');
    expect(Array.isArray(config.filesCreated)).toBe(true);
  });

  it('should auto-create template files if they do not exist', () => {
    // Initially no files exist
    expect(fs.existsSync(path.join(promptsDir, 'system.md'))).toBe(false);

    const config = loadTemplatePromptConfig({
      laceDir: testLaceDir,
      workingDir: testLaceDir,
      tools: mockTools
    });

    // Should have created template files
    expect(fs.existsSync(path.join(promptsDir, 'system.md'))).toBe(true);
    expect(config.filesCreated.length).toBeGreaterThan(0);
    expect(config.filesCreated.some(f => f.includes('system.md'))).toBe(true);
  });

  it('should use existing template files if they exist', () => {
    const customTemplate = `# Custom Template\nYou are {{model.id}}.`;
    fs.writeFileSync(path.join(promptsDir, 'system.md'), customTemplate);

    const config = loadTemplatePromptConfig({
      laceDir: testLaceDir,
      workingDir: testLaceDir,
      tools: mockTools,
      model: { id: 'claude-3-5-sonnet', provider: 'anthropic' }
    });

    expect(config.systemPrompt).toContain('Custom Template');
    expect(config.systemPrompt).toContain('claude-3-5-sonnet');
    expect(config.filesCreated).toEqual([]); // No new files created
  });

  it('should handle user instructions file', () => {
    const userInstructions = `Please be concise and helpful.`;
    fs.writeFileSync(path.join(testLaceDir, 'instructions.md'), userInstructions);

    const config = loadTemplatePromptConfig({
      laceDir: testLaceDir,
      workingDir: testLaceDir,
      tools: mockTools
    });

    expect(config.userInstructions).toBe(userInstructions);
  });

  it('should include dynamic context in generated prompts', () => {
    const template = `System: {{system.os}}\nGit: {{git.branch}}\nTools: {{tools.count}}`;
    fs.writeFileSync(path.join(promptsDir, 'system.md'), template);

    const config = loadTemplatePromptConfig({
      laceDir: testLaceDir,
      workingDir: testLaceDir,
      tools: mockTools
    });

    const prompt = config.systemPrompt;
    expect(prompt).toMatch(/System: \w+/); // Should have actual OS
    expect(prompt).toMatch(/Git: .+/); // Should have git info (even if "not a git repository")
    expect(prompt).toContain('Tools: 1'); // Should have tool count
  });

  it('should support custom model information', () => {
    const template = `Model: {{model.id}} from {{model.provider}}`;
    fs.writeFileSync(path.join(promptsDir, 'system.md'), template);

    const config = loadTemplatePromptConfig({
      laceDir: testLaceDir,
      workingDir: testLaceDir,
      tools: mockTools,
      model: { id: 'gpt-4', provider: 'openai' }
    });

    expect(config.systemPrompt).toContain('gpt-4');
    expect(config.systemPrompt).toContain('openai');
  });

  it('should handle template processing errors gracefully', () => {
    // Create an invalid template (circular include)
    const template = `{{include:circular.md}}`;
    const circular = `This includes itself: {{include:circular.md}}`;
    
    fs.writeFileSync(path.join(promptsDir, 'system.md'), template);
    fs.writeFileSync(path.join(promptsDir, 'circular.md'), circular);

    expect(() => loadTemplatePromptConfig({
      laceDir: testLaceDir,
      workingDir: testLaceDir,
      tools: mockTools
    })).not.toThrow();

    const config = loadTemplatePromptConfig({
      laceDir: testLaceDir,
      workingDir: testLaceDir,
      tools: mockTools
    });

    expect(typeof config.systemPrompt).toBe('string');
    expect(config.systemPrompt.length).toBeGreaterThan(0);
  });

  it('should create reasonable default templates', () => {
    const config = loadTemplatePromptConfig({
      laceDir: testLaceDir,
      workingDir: testLaceDir,
      tools: mockTools
    });

    const prompt = config.systemPrompt;
    
    // Should contain essential elements
    expect(prompt).toMatch(/AI|assistant|coding/i);
    expect(prompt).toContain('bash'); // Tool should be mentioned
    expect(prompt.length).toBeGreaterThan(100); // Should be substantial
    expect(prompt.length).toBeLessThan(5000); // But not excessive
  });

  it('should preserve user instructions functionality', () => {
    const instructions = 'Always explain your reasoning step by step.';
    fs.writeFileSync(path.join(testLaceDir, 'instructions.md'), instructions);

    const config = loadTemplatePromptConfig({
      laceDir: testLaceDir,
      workingDir: testLaceDir,
      tools: mockTools
    });

    expect(config.userInstructions).toBe(instructions);
  });
});