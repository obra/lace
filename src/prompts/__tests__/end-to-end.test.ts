// ABOUTME: End-to-end integration test for the complete template prompt system
// ABOUTME: Tests the full workflow from CLI integration to template rendering

import { loadPromptConfig } from '../../config/prompts.js';
import { ToolExecutor } from '../../tools/executor.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('End-to-End Template System', () => {
  let testLaceDir: string;
  let originalLaceDir: string | undefined;

  beforeEach(() => {
    // Create temporary test environment
    testLaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-e2e-test-'));
    originalLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = testLaceDir;
  });

  afterEach(() => {
    // Restore environment
    if (originalLaceDir !== undefined) {
      process.env.LACE_DIR = originalLaceDir;
    } else {
      delete process.env.LACE_DIR;
    }
    
    // Clean up
    fs.rmSync(testLaceDir, { recursive: true, force: true });
  });

  it('should work with the enhanced CLI workflow', () => {
    // Simulate CLI workflow: create tools, load enhanced prompts
    const toolExecutor = new ToolExecutor();
    toolExecutor.registerAllAvailableTools();
    
    const tools = toolExecutor.getAllTools();
    expect(tools.length).toBeGreaterThan(0);
    
    // Load prompts with tools (this triggers template mode)
    const promptConfig = loadPromptConfig({
      tools,
      workingDir: testLaceDir,
      model: {
        id: 'claude-3-5-sonnet',
        provider: 'anthropic'
      }
    });

    expect(promptConfig.systemPrompt).toBeDefined();
    expect(promptConfig.systemPrompt.length).toBeGreaterThan(100);
    
    // Should contain dynamic content
    expect(promptConfig.systemPrompt).toContain('claude-3-5-sonnet');
    expect(promptConfig.systemPrompt).toContain('anthropic');
    
    // Should contain tool information
    expect(promptConfig.systemPrompt).toContain('bash');
    
    // Should contain system information
    expect(promptConfig.systemPrompt).toMatch(/Operating System:/);
    
    // Should have created template files
    expect(promptConfig.filesCreated.length).toBeGreaterThan(0);
    
    const promptsDir = path.join(testLaceDir, 'prompts');
    expect(fs.existsSync(promptsDir)).toBe(true);
    expect(fs.existsSync(path.join(promptsDir, 'system.md'))).toBe(true);
    expect(fs.existsSync(path.join(promptsDir, 'sections'))).toBe(true);
  });

  it('should maintain backward compatibility for existing setups', () => {
    // Create old-style system prompt file
    const oldPrompt = 'You are a simple coding assistant.';
    fs.writeFileSync(path.join(testLaceDir, 'system-prompt.md'), oldPrompt);
    
    // Load without tools (should use legacy mode)
    const promptConfig = loadPromptConfig();
    
    expect(promptConfig.systemPrompt).toBe(oldPrompt);
    expect(promptConfig.filesCreated).toEqual([]); // No new files created
    
    // Prompts directory should not have been created
    const promptsDir = path.join(testLaceDir, 'prompts');
    expect(fs.existsSync(promptsDir)).toBe(false);
  });

  it('should gracefully transition from legacy to template mode', () => {
    // Start with legacy setup
    const oldPrompt = 'You are a simple coding assistant.';
    fs.writeFileSync(path.join(testLaceDir, 'system-prompt.md'), oldPrompt);
    
    // First load - legacy mode
    let promptConfig = loadPromptConfig();
    expect(promptConfig.systemPrompt).toBe(oldPrompt);
    
    // Second load with tools - should switch to template mode
    const toolExecutor = new ToolExecutor();
    toolExecutor.registerAllAvailableTools();
    
    promptConfig = loadPromptConfig({
      tools: toolExecutor.getAllTools(),
      model: { id: 'test-model', provider: 'test' }
    });
    
    // Should now have enhanced prompt with templates
    expect(promptConfig.systemPrompt).not.toBe(oldPrompt);
    expect(promptConfig.systemPrompt).toContain('test-model');
    expect(promptConfig.systemPrompt.length).toBeGreaterThan(oldPrompt.length);
  });

  it('should handle missing template gracefully', () => {
    // Create prompts directory but no template files
    const promptsDir = path.join(testLaceDir, 'prompts');
    fs.mkdirSync(promptsDir);
    
    const toolExecutor = new ToolExecutor();
    toolExecutor.registerAllAvailableTools();
    
    expect(() => loadPromptConfig({
      tools: toolExecutor.getAllTools()
    })).not.toThrow();
    
    const promptConfig = loadPromptConfig({
      tools: toolExecutor.getAllTools()
    });
    
    expect(promptConfig.systemPrompt).toBeDefined();
    expect(typeof promptConfig.systemPrompt).toBe('string');
  });

  it('should generate comprehensive system context', () => {
    const toolExecutor = new ToolExecutor();
    toolExecutor.registerAllAvailableTools();
    
    const promptConfig = loadPromptConfig({
      tools: toolExecutor.getAllTools(),
      workingDir: testLaceDir,
      model: { id: 'test-model', provider: 'test-provider' }
    });
    
    const prompt = promptConfig.systemPrompt;
    
    // Should contain all major sections
    expect(prompt).toMatch(/AI.*Assistant/i);
    expect(prompt).toMatch(/Operating System/);
    expect(prompt).toMatch(/Available Tools/);
    expect(prompt).toMatch(/Guidelines/);
    
    // Should contain dynamic values
    expect(prompt).toContain('test-model');
    expect(prompt).toContain('test-provider');
    expect(prompt).toContain(testLaceDir);
    
    // Should have reasonable length (substantial but not excessive)
    expect(prompt.length).toBeGreaterThan(500);
    expect(prompt.length).toBeLessThan(10000);
  });
});