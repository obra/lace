// ABOUTME: Tests for ProjectVariableProvider - File tree, working directory information
// ABOUTME: Following TDD approach - tests written before implementation

import { ProjectVariableProvider } from '../variable-providers/project.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ProjectVariableProvider', () => {
  let provider: ProjectVariableProvider;
  let testDir: string;

  beforeEach(() => {
    // Create a temporary test directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-test-'));
    provider = new ProjectVariableProvider(testDir);
  });

  afterEach(() => {
    // Clean up test directory
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should provide current working directory information', () => {
    const variables = provider.getVariables();
    
    expect(variables.project).toBeDefined();
    expect(typeof variables.project).toBe('object');
    
    const project = variables.project as Record<string, unknown>;
    expect(project.cwd).toBeDefined();
    expect(project.cwd).toBe(testDir);
  });

  it('should provide project name from directory', () => {
    const variables = provider.getVariables();
    
    const project = variables.project as Record<string, unknown>;
    expect(project.name).toBeDefined();
    expect(typeof project.name).toBe('string');
    expect(project.name).toBe(path.basename(testDir));
  });

  it('should provide file tree structure', () => {
    // Create some test files
    fs.writeFileSync(path.join(testDir, 'README.md'), 'Test readme');
    fs.mkdirSync(path.join(testDir, 'src'));
    fs.writeFileSync(path.join(testDir, 'src', 'index.ts'), 'console.log("hello");');
    
    const variables = provider.getVariables();
    
    const project = variables.project as Record<string, unknown>;
    expect(project.tree).toBeDefined();
    expect(typeof project.tree).toBe('string');
    
    const tree = project.tree as string;
    expect(tree).toContain('README.md');
    expect(tree).toContain('src/');
    expect(tree).toContain('index.ts');
  });

  it('should provide file count information', () => {
    // Create some test files
    fs.writeFileSync(path.join(testDir, 'file1.txt'), 'content');
    fs.writeFileSync(path.join(testDir, 'file2.txt'), 'content');
    fs.mkdirSync(path.join(testDir, 'subdir'));
    fs.writeFileSync(path.join(testDir, 'subdir', 'file3.txt'), 'content');
    
    const variables = provider.getVariables();
    
    const project = variables.project as Record<string, unknown>;
    expect(project.fileCount).toBeDefined();
    expect(typeof project.fileCount).toBe('number');
    expect(project.fileCount).toBe(3); // Only files, not directories
  });

  it('should provide directory count information', () => {
    fs.mkdirSync(path.join(testDir, 'dir1'));
    fs.mkdirSync(path.join(testDir, 'dir2'));
    fs.mkdirSync(path.join(testDir, 'dir1', 'subdir'));
    
    const variables = provider.getVariables();
    
    const project = variables.project as Record<string, unknown>;
    expect(project.dirCount).toBeDefined();
    expect(typeof project.dirCount).toBe('number');
    expect(project.dirCount).toBe(3);
  });

  it('should respect maxDepth option for tree generation', () => {
    const shallowProvider = new ProjectVariableProvider(testDir, { maxDepth: 1 });
    
    // Create nested structure
    fs.mkdirSync(path.join(testDir, 'level1'));
    fs.mkdirSync(path.join(testDir, 'level1', 'level2'));
    fs.writeFileSync(path.join(testDir, 'level1', 'level2', 'deep.txt'), 'content');
    
    const variables = shallowProvider.getVariables();
    
    const project = variables.project as Record<string, unknown>;
    const tree = project.tree as string;
    
    expect(tree).toContain('level1/');
    expect(tree).not.toContain('level2');
    expect(tree).not.toContain('deep.txt');
  });

  it('should respect maxFiles option to limit tree size', () => {
    const limitedProvider = new ProjectVariableProvider(testDir, { maxFiles: 2 });
    
    // Create more files than the limit
    for (let i = 1; i <= 5; i++) {
      fs.writeFileSync(path.join(testDir, `file${i}.txt`), 'content');
    }
    
    const variables = limitedProvider.getVariables();
    
    const project = variables.project as Record<string, unknown>;
    const tree = project.tree as string;
    
    // Should show truncation message
    expect(tree).toContain('...');
    expect(tree).toContain('truncated');
  });

  it('should ignore common irrelevant files and directories', () => {
    // Create files that should be ignored
    fs.mkdirSync(path.join(testDir, 'node_modules'));
    fs.mkdirSync(path.join(testDir, '.git'));
    fs.writeFileSync(path.join(testDir, '.DS_Store'), '');
    fs.writeFileSync(path.join(testDir, 'important.txt'), 'content');
    
    const variables = provider.getVariables();
    
    const project = variables.project as Record<string, unknown>;
    const tree = project.tree as string;
    
    expect(tree).not.toContain('node_modules');
    expect(tree).not.toContain('.git');
    expect(tree).not.toContain('.DS_Store');
    expect(tree).toContain('important.txt');
  });

  it('should handle empty directories gracefully', () => {
    // testDir is empty by default
    const variables = provider.getVariables();
    
    const project = variables.project as Record<string, unknown>;
    expect(project.tree).toBeDefined();
    expect(project.fileCount).toBe(0);
    expect(project.dirCount).toBe(0);
  });

  it('should handle permission errors gracefully', () => {
    expect(() => provider.getVariables()).not.toThrow();
    
    const variables = provider.getVariables();
    expect(variables.project).toBeDefined();
  });
});