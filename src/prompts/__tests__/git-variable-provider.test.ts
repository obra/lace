// ABOUTME: Tests for GitVariableProvider - Git context using existing git commands
// ABOUTME: Following TDD approach - tests written before implementation

import { GitVariableProvider } from '../variable-providers/git.js';

describe('GitVariableProvider', () => {
  let provider: GitVariableProvider;

  beforeEach(() => {
    provider = new GitVariableProvider();
  });

  it('should provide git branch information', () => {
    const variables = provider.getVariables();
    
    expect(variables.git).toBeDefined();
    expect(typeof variables.git).toBe('object');
    
    const git = variables.git as Record<string, unknown>;
    expect(git.branch).toBeDefined();
    expect(typeof git.branch).toBe('string');
  });

  it('should provide git status information', () => {
    const variables = provider.getVariables();
    
    const git = variables.git as Record<string, unknown>;
    expect(git.status).toBeDefined();
    expect(typeof git.status).toBe('string');
  });

  it('should provide git user information', () => {
    const variables = provider.getVariables();
    
    const git = variables.git as Record<string, unknown>;
    expect(git.user).toBeDefined();
    expect(typeof git.user).toBe('object');
    
    const user = git.user as Record<string, unknown>;
    expect(user.name).toBeDefined();
    expect(user.email).toBeDefined();
  });

  it('should provide commit log information', () => {
    const variables = provider.getVariables();
    
    const git = variables.git as Record<string, unknown>;
    expect(git.shortlog).toBeDefined();
    expect(typeof git.shortlog).toBe('string');
  });

  it('should provide repository root path', () => {
    const variables = provider.getVariables();
    
    const git = variables.git as Record<string, unknown>;
    expect(git.root).toBeDefined();
    expect(typeof git.root).toBe('string');
  });

  it('should handle non-git directories gracefully', () => {
    // Create provider with a non-git directory
    const provider = new GitVariableProvider('/tmp');
    
    expect(() => provider.getVariables()).not.toThrow();
    
    const variables = provider.getVariables();
    const git = variables.git as Record<string, unknown>;
    
    // Should provide defaults when not in a git repo
    expect(git.branch).toBe('(not a git repository)');
    expect(git.status).toBe('(not a git repository)');
  });

  it('should handle git command errors gracefully', () => {
    expect(() => provider.getVariables()).not.toThrow();
    
    const variables = provider.getVariables();
    expect(variables.git).toBeDefined();
  });

  it('should provide working directory information', () => {
    const variables = provider.getVariables();
    
    const git = variables.git as Record<string, unknown>;
    expect(git.workingDir).toBeDefined();
    expect(typeof git.workingDir).toBe('string');
  });

  it('should indicate if working directory is clean', () => {
    const variables = provider.getVariables();
    
    const git = variables.git as Record<string, unknown>;
    expect(git.isClean).toBeDefined();
    expect(typeof git.isClean).toBe('boolean');
  });

  it('should provide remote information if available', () => {
    const variables = provider.getVariables();
    
    const git = variables.git as Record<string, unknown>;
    expect(git.remote).toBeDefined();
    // Could be string (URL) or null if no remote
    expect(['string', 'object'].includes(typeof git.remote)).toBe(true);
  });
});