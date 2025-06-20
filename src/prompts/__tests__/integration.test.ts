// ABOUTME: Integration tests for full prompt generation with all components
// ABOUTME: Tests the complete template system including variable providers and file loading

import { PromptManager } from '../prompt-manager.js';
import { Tool } from '../../tools/types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Prompt System Integration', () => {
  let testDir: string;
  let promptsDir: string;
  let mockTools: Tool[];

  beforeEach(() => {
    // Create temporary directories
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-prompt-test-'));
    promptsDir = path.join(testDir, 'prompts');
    fs.mkdirSync(promptsDir);
    fs.mkdirSync(path.join(promptsDir, 'sections'));

    // Create mock tools
    mockTools = [
      {
        name: 'bash',
        description: 'Execute bash commands',
        input_schema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The bash command to execute' }
          },
          required: ['command']
        },
        executeTool: async () => ({ content: [{ type: 'text', text: 'result' }], isError: false })
      }
    ];
  });

  afterEach(() => {
    // Clean up
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should generate complete system prompt with all variables', () => {
    // Create main template
    const mainTemplate = `# AI Assistant

You are {{model.id}} running on {{system.os}}.

Current project: {{project.name}}
Working directory: {{project.cwd}}
Git branch: {{git.branch}}

Available tools:
{{tools.descriptions}}

{{include:sections/guidelines.md}}`;

    // Create section template
    const guidelinesTemplate = `## Guidelines

- Be helpful and accurate
- Current date: {{session.currentDate}}
- Total available tools: {{tools.count}}`;

    fs.writeFileSync(path.join(promptsDir, 'system.md'), mainTemplate);
    fs.writeFileSync(path.join(promptsDir, 'sections', 'guidelines.md'), guidelinesTemplate);

    const promptManager = new PromptManager(promptsDir, testDir, mockTools);
    const systemPrompt = promptManager.generateSystemPrompt({
      model: { id: 'claude-3-5-sonnet', provider: 'anthropic' }
    });

    expect(systemPrompt).toContain('claude-3-5-sonnet');
    expect(systemPrompt).toContain('Be helpful and accurate');
    expect(systemPrompt).toContain('bash: Execute bash commands');
    expect(systemPrompt).toContain('Total available tools: 1');
    expect(systemPrompt).not.toContain('{{'); // No unresolved variables
    expect(systemPrompt).not.toContain('include:'); // No unresolved includes
  });

  it('should handle missing template files gracefully', () => {
    const promptManager = new PromptManager(promptsDir, testDir, mockTools);
    
    // Should not throw when template doesn't exist
    expect(() => promptManager.generateSystemPrompt()).not.toThrow();
    
    const systemPrompt = promptManager.generateSystemPrompt();
    expect(typeof systemPrompt).toBe('string');
    expect(systemPrompt.length).toBeGreaterThan(0);
  });

  it('should support custom model information', () => {
    const template = `Model: {{model.id}} from {{model.provider}}`;
    fs.writeFileSync(path.join(promptsDir, 'system.md'), template);

    const promptManager = new PromptManager(promptsDir, testDir, mockTools);
    const systemPrompt = promptManager.generateSystemPrompt({
      model: { id: 'gpt-4', provider: 'openai' }
    });

    expect(systemPrompt).toContain('gpt-4');
    expect(systemPrompt).toContain('openai');
  });

  it('should provide fallback when git is not available', () => {
    const template = `Git status: {{git.status}}, Branch: {{git.branch}}`;
    fs.writeFileSync(path.join(promptsDir, 'system.md'), template);

    // Use a non-git directory
    const nonGitDir = path.join(testDir, 'non-git');
    fs.mkdirSync(nonGitDir);

    const promptManager = new PromptManager(promptsDir, nonGitDir, mockTools);
    const systemPrompt = promptManager.generateSystemPrompt();

    expect(systemPrompt).toContain('not a git repository');
  });

  it('should handle complex nested includes', () => {
    const mainTemplate = `{{include:level1.md}}`;
    const level1Template = `Level 1 {{include:sections/level2.md}}`;
    const level2Template = `Level 2 content with {{system.os}}`;

    fs.writeFileSync(path.join(promptsDir, 'system.md'), mainTemplate);
    fs.writeFileSync(path.join(promptsDir, 'level1.md'), level1Template);
    fs.writeFileSync(path.join(promptsDir, 'sections', 'level2.md'), level2Template);

    const promptManager = new PromptManager(promptsDir, testDir, mockTools);
    const systemPrompt = promptManager.generateSystemPrompt();

    expect(systemPrompt).toContain('Level 1');
    expect(systemPrompt).toContain('Level 2 content with');
    expect(systemPrompt).not.toContain('{{include:');
  });

  it('should provide project file tree information', () => {
    const template = `Project structure:\n{{project.tree}}`;
    fs.writeFileSync(path.join(promptsDir, 'system.md'), template);

    // Create some files in the test directory
    fs.writeFileSync(path.join(testDir, 'README.md'), 'readme');
    fs.mkdirSync(path.join(testDir, 'src'));
    fs.writeFileSync(path.join(testDir, 'src', 'index.js'), 'code');

    const promptManager = new PromptManager(promptsDir, testDir, mockTools);
    const systemPrompt = promptManager.generateSystemPrompt();

    expect(systemPrompt).toContain('README.md');
    expect(systemPrompt).toContain('src/');
    expect(systemPrompt).toContain('index.js');
  });

  it('should generate prompt with reasonable length', () => {
    const template = `# Assistant
{{tools.documentation}}
{{project.tree}}
Current: {{session.currentTime}}`;
    
    fs.writeFileSync(path.join(promptsDir, 'system.md'), template);

    const promptManager = new PromptManager(promptsDir, testDir, mockTools);
    const systemPrompt = promptManager.generateSystemPrompt();

    // Should be substantial but not excessive
    expect(systemPrompt.length).toBeGreaterThan(100);
    expect(systemPrompt.length).toBeLessThan(10000);
  });

  it('should handle provider errors gracefully', () => {
    const template = `System: {{system.os}}, Git: {{git.branch}}`;
    fs.writeFileSync(path.join(promptsDir, 'system.md'), template);

    const promptManager = new PromptManager('/non-existent-prompts', testDir, mockTools);
    
    expect(() => promptManager.generateSystemPrompt()).not.toThrow();
    
    const systemPrompt = promptManager.generateSystemPrompt();
    expect(typeof systemPrompt).toBe('string');
  });

  it('should merge additional variables correctly', () => {
    const template = `Custom: {{custom.value}}, System: {{system.os}}`;
    fs.writeFileSync(path.join(promptsDir, 'system.md'), template);

    const promptManager = new PromptManager(promptsDir, testDir, mockTools);
    const systemPrompt = promptManager.generateSystemPrompt({
      custom: { value: 'test-value' }
    });

    expect(systemPrompt).toContain('test-value');
    expect(systemPrompt).toContain('System:'); // Should still have system variables
  });
});