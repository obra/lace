// ABOUTME: Tests for variable providers that generate template context

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { 
  SystemVariableProvider,
  GitVariableProvider,
  ProjectVariableProvider,
  ToolVariableProvider,
  ContextDisclaimerProvider
} from '../variable-providers.js';

describe('SystemVariableProvider', () => {
  it('should provide system information', () => {
    const provider = new SystemVariableProvider();
    const variables = provider.getVariables();

    expect(variables).toHaveProperty('system');
    expect(variables.system).toHaveProperty('os');
    expect(variables.system).toHaveProperty('arch');
    expect(variables.system).toHaveProperty('version');
    expect(variables.system).toHaveProperty('homedir');

    expect(variables).toHaveProperty('session');
    expect(variables.session).toHaveProperty('startTime');
    expect(variables.session).toHaveProperty('pid');
    
    // Verify types
    expect(typeof variables.system.os).toBe('string');
    expect(typeof variables.session.startTime).toBe('string');
    expect(typeof variables.session.pid).toBe('number');
  });

  it('should provide consistent session start time', () => {
    const provider = new SystemVariableProvider();
    const vars1 = provider.getVariables();
    const vars2 = provider.getVariables();

    expect(vars1.session.startTime).toBe(vars2.session.startTime);
  });
});

describe('GitVariableProvider', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-git-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should handle non-git directory', () => {
    const provider = new GitVariableProvider(tempDir);
    const variables = provider.getVariables();

    expect(variables).toHaveProperty('git');
    expect(variables.git).toHaveProperty('branch', 'no-git');
    expect(variables.git).toHaveProperty('status', '');
  });

  it('should provide git information when available', () => {
    // Create a mock git directory structure
    const gitDir = path.join(tempDir, '.git');
    fs.mkdirSync(gitDir);
    
    // Mock git commands using vitest
    const mockExec = vi.fn();
    
    // This test would require actual git setup or more complex mocking
    // For now, just test the structure
    const provider = new GitVariableProvider(tempDir);
    const variables = provider.getVariables();

    expect(variables).toHaveProperty('git');
    expect(variables.git).toHaveProperty('branch');
    expect(variables.git).toHaveProperty('status');
  });

  it('should handle custom working directory', () => {
    const provider = new GitVariableProvider('/tmp');
    const variables = provider.getVariables();

    expect(variables).toHaveProperty('git');
    // Should not throw an error
  });
});

describe('ProjectVariableProvider', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-project-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should provide basic project information', () => {
    const provider = new ProjectVariableProvider(tempDir);
    const variables = provider.getVariables();

    expect(variables).toHaveProperty('project');
    expect(variables.project).toHaveProperty('cwd', tempDir);
    expect(variables.project).toHaveProperty('name', path.basename(tempDir));
    expect(variables.project).toHaveProperty('files');
    expect(variables.project).toHaveProperty('configFiles');
    expect(variables.project).toHaveProperty('directories');
  });

  it('should detect config files', () => {
    // Create some test files
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# Test');
    fs.writeFileSync(path.join(tempDir, 'Cargo.toml'), '[package]');
    fs.mkdirSync(path.join(tempDir, 'src'));

    const provider = new ProjectVariableProvider(tempDir);
    const variables = provider.getVariables();

    expect(variables.project.files).toBe(4);
    expect(variables.project.configFiles).toContain('package.json');
    expect(variables.project.configFiles).toContain('Cargo.toml');
    expect(variables.project.configFiles).not.toContain('README.md');
    expect(variables.project.directories).toContain('src');
  });

  it('should handle empty directory', () => {
    const provider = new ProjectVariableProvider(tempDir);
    const variables = provider.getVariables();

    expect(variables.project.files).toBe(0);
    expect(Array.isArray(variables.project.configFiles)).toBe(true);
    expect(Array.isArray(variables.project.directories)).toBe(true);
  });

  it('should handle read errors gracefully', () => {
    const provider = new ProjectVariableProvider('/nonexistent/path');
    const variables = provider.getVariables();

    expect(variables).toHaveProperty('project');
    expect(variables.project).toHaveProperty('cwd', '/nonexistent/path');
    expect(variables.project).toHaveProperty('name', 'path');
  });
});

describe('ToolVariableProvider', () => {
  it('should provide empty tool information by default', () => {
    const provider = new ToolVariableProvider();
    const variables = provider.getVariables();

    expect(variables).toHaveProperty('tools');
    expect(variables.tools).toHaveProperty('list', []);
    expect(variables.tools).toHaveProperty('descriptions', {});
    expect(variables.tools).toHaveProperty('count', 0);
  });

  it('should provide tool information when configured', () => {
    const tools = [
      { name: 'bash', description: 'Execute shell commands' },
      { name: 'git', description: 'Version control operations' }
    ];

    const provider = new ToolVariableProvider(tools);
    const variables = provider.getVariables();

    expect(variables.tools.list).toEqual(['bash', 'git']);
    expect(variables.tools.descriptions).toEqual({
      bash: 'Execute shell commands',
      git: 'Version control operations'
    });
    expect(variables.tools.count).toBe(2);
  });

  it('should update tools dynamically', () => {
    const provider = new ToolVariableProvider();
    
    // Initially empty
    let variables = provider.getVariables();
    expect(variables.tools.count).toBe(0);

    // Update tools
    provider.updateTools([
      { name: 'test', description: 'Test tool' }
    ]);

    variables = provider.getVariables();
    expect(variables.tools.count).toBe(1);
    expect(variables.tools.list).toEqual(['test']);
  });
});

describe('ContextDisclaimerProvider', () => {
  it('should provide context disclaimer', () => {
    const provider = new ContextDisclaimerProvider();
    const variables = provider.getVariables();

    expect(variables).toHaveProperty('context');
    expect(variables.context).toHaveProperty('disclaimer');
    expect(variables.context).toHaveProperty('timestamp');

    expect(typeof variables.context.disclaimer).toBe('string');
    expect(variables.context.disclaimer).toContain('conversation start');
    expect(typeof variables.context.timestamp).toBe('string');
  });

  it('should provide ISO timestamp', () => {
    const provider = new ContextDisclaimerProvider();
    const variables = provider.getVariables();

    // Should be a valid ISO timestamp
    const timestamp = new Date(variables.context.timestamp as string);
    expect(timestamp).toBeInstanceOf(Date);
    expect(timestamp.getTime()).not.toBeNaN();
  });
});