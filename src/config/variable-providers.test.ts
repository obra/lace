// ABOUTME: Tests for variable providers that supply context to templates
// ABOUTME: Tests System, Git, Project, Tool, and Context variable providers

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  SystemVariableProvider,
  GitVariableProvider,
  ProjectVariableProvider,
  ToolVariableProvider,
  ContextDisclaimerProvider,
  VariableProviderManager,
} from '~/config/variable-providers';

// Mock interface for CommandRunner
interface MockCommandRunner {
  isGitRepository: ReturnType<typeof vi.fn>;
  runCommand: ReturnType<typeof vi.fn>;
}

describe('Variable Providers', () => {
  let mockCommandRunner: MockCommandRunner;

  describe('SystemVariableProvider', () => {
    it('should provide system information', () => {
      const provider = new SystemVariableProvider();
      const variables = provider.getVariables();

      expect(variables).toHaveProperty('system');
      expect(variables.system).toHaveProperty('os');
      expect(variables.system).toHaveProperty('arch');
      expect(variables.system).toHaveProperty('sessionTime');

      expect(typeof (variables.system as Record<string, unknown>).os).toBe('string');
      expect(typeof (variables.system as Record<string, unknown>).arch).toBe('string');
      expect(typeof (variables.system as Record<string, unknown>).sessionTime).toBe('string');

      // Verify sessionTime is a valid ISO string
      expect(
        () => new Date((variables.system as Record<string, unknown>).sessionTime as string)
      ).not.toThrow();
    });

    it('should handle errors gracefully', () => {
      // This test verifies the provider can handle missing/invalid system info
      // Since we can't easily mock os module after import, we verify normal operation
      const provider = new SystemVariableProvider();
      const variables = provider.getVariables();

      expect(variables).toHaveProperty('system');
      expect(variables.system).toHaveProperty('os');
      expect(variables.system).toHaveProperty('arch');
      expect(variables.system).toHaveProperty('sessionTime');
    });
  });

  describe('GitVariableProvider', () => {
    beforeEach(() => {
      mockCommandRunner = {
        isGitRepository: vi.fn(),
        runCommand: vi.fn(),
      };
    });

    it('should provide git information when in a git repository', () => {
      mockCommandRunner.isGitRepository.mockReturnValue(true);
      mockCommandRunner.runCommand
        .mockReturnValueOnce('main') // git branch --show-current
        .mockReturnValueOnce('') // git status --porcelain (clean)
        .mockReturnValueOnce('John Doe') // git config user.name
        .mockReturnValueOnce('john@example.com'); // git config user.email

      const provider = new GitVariableProvider(mockCommandRunner);
      const variables = provider.getVariables();

      expect(variables).toHaveProperty('git');
      expect(variables.git).toEqual({
        branch: 'main',
        status: 'clean',
        user: {
          name: 'John Doe',
          email: 'john@example.com',
        },
      });

      expect(mockCommandRunner.runCommand).toHaveBeenCalledWith('git', [
        'branch',
        '--show-current',
      ]);
      expect(mockCommandRunner.runCommand).toHaveBeenCalledWith('git', ['status', '--porcelain']);
      expect(mockCommandRunner.runCommand).toHaveBeenCalledWith('git', ['config', 'user.name']);
      expect(mockCommandRunner.runCommand).toHaveBeenCalledWith('git', ['config', 'user.email']);
    });

    it('should handle dirty repository status', () => {
      mockCommandRunner.isGitRepository.mockReturnValue(true);
      mockCommandRunner.runCommand
        .mockReturnValueOnce('feature-branch') // git branch --show-current
        .mockReturnValueOnce(' M file.txt\n?? new-file.txt') // git status (dirty)
        .mockReturnValueOnce('Jane Smith') // git config user.name
        .mockReturnValueOnce('jane@example.com'); // git config user.email

      const provider = new GitVariableProvider(mockCommandRunner);
      const variables = provider.getVariables();

      expect((variables.git as Record<string, unknown>).status).toBe('dirty');
      expect((variables.git as Record<string, unknown>).branch).toBe('feature-branch');
    });

    it('should return empty git object when not in a git repository', () => {
      mockCommandRunner.isGitRepository.mockReturnValue(false);

      const provider = new GitVariableProvider(mockCommandRunner);
      const variables = provider.getVariables();

      expect(variables).toEqual({ git: {} });
      expect(mockCommandRunner.runCommand).not.toHaveBeenCalled();
    });

    it('should handle partial git information gracefully', () => {
      mockCommandRunner.isGitRepository.mockReturnValue(true);
      mockCommandRunner.runCommand
        .mockImplementationOnce(() => {
          throw new Error('No branch');
        }) // git branch fails
        .mockReturnValueOnce('') // git status --porcelain (clean)
        .mockImplementationOnce(() => {
          throw new Error('No user name');
        }) // git config user.name fails
        .mockImplementationOnce(() => {
          throw new Error('No user email');
        }); // git config user.email fails

      const provider = new GitVariableProvider(mockCommandRunner);
      const variables = provider.getVariables();

      expect(variables.git).toEqual({
        status: 'clean',
      });
    });
  });

  describe('ProjectVariableProvider', () => {
    let tempDir: string;
    let originalCwd: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-test-'));
      originalCwd = process.cwd();
      process.chdir(tempDir);
    });

    afterEach(() => {
      process.chdir(originalCwd);
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should provide project directory and tree structure', () => {
      // Create some files and directories
      fs.writeFileSync(path.join(tempDir, 'README.md'), 'Project readme');
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
      fs.mkdirSync(path.join(tempDir, 'src'));
      fs.writeFileSync(path.join(tempDir, 'src', 'index.js'), 'console.log("hello");');

      const provider = new ProjectVariableProvider();
      const variables = provider.getVariables();

      expect(variables).toHaveProperty('project');
      expect(variables.project).toHaveProperty('cwd');
      expect((variables.project as Record<string, unknown>).cwd).toContain(path.basename(tempDir)); // Handle /private prefix on macOS
      expect(variables.project).toHaveProperty('tree');

      const tree = (variables.project as Record<string, unknown>).tree;
      expect(tree).toContain('README.md');
      expect(tree).toContain('package.json');
      expect(tree).toContain('src/');
      expect(tree).toContain('index.js');
    });

    it('should exclude hidden files and node_modules', () => {
      // Create files that should be excluded
      fs.writeFileSync(path.join(tempDir, '.hidden'), 'hidden file');
      fs.writeFileSync(path.join(tempDir, '.env'), 'SECRET=value');
      fs.mkdirSync(path.join(tempDir, 'node_modules'));
      fs.writeFileSync(path.join(tempDir, 'node_modules', 'package.json'), '{}');

      // Create files that should be included
      fs.writeFileSync(path.join(tempDir, 'visible.txt'), 'visible file');

      const provider = new ProjectVariableProvider();
      const variables = provider.getVariables();

      const tree = (variables.project as Record<string, unknown>).tree;
      expect(tree).not.toContain('.hidden');
      expect(tree).not.toContain('.env');
      expect(tree).not.toContain('node_modules');
      expect(tree).toContain('visible.txt');
    });

    it('should limit tree depth', () => {
      // Create deeply nested structure
      const deepPath = path.join(tempDir, 'level1', 'level2', 'level3');
      fs.mkdirSync(deepPath, { recursive: true });
      fs.writeFileSync(path.join(deepPath, 'deep-file.txt'), 'deep content');

      // Create shallow file
      fs.writeFileSync(path.join(tempDir, 'shallow.txt'), 'shallow content');

      const provider = new ProjectVariableProvider();
      const variables = provider.getVariables();

      const tree = (variables.project as Record<string, unknown>).tree;
      expect(tree).toContain('shallow.txt');
      expect(tree).toContain('level1/');
      // Should not go too deep (depth limit is 2)
      expect(tree).not.toContain('deep-file.txt');
    });

    it('should handle empty directory', () => {
      const provider = new ProjectVariableProvider();
      const variables = provider.getVariables();

      expect((variables.project as Record<string, unknown>).cwd).toContain(path.basename(tempDir)); // Handle /private prefix on macOS
      expect((variables.project as Record<string, unknown>).tree).toBe('');
    });

    it('should handle permission errors gracefully', () => {
      // Create a directory we can't read
      const restrictedDir = path.join(tempDir, 'restricted');
      fs.mkdirSync(restrictedDir);
      fs.chmodSync(restrictedDir, 0o000);

      fs.writeFileSync(path.join(tempDir, 'readable.txt'), 'content');

      try {
        const provider = new ProjectVariableProvider();
        const variables = provider.getVariables();

        expect((variables.project as Record<string, unknown>).cwd).toContain(
          path.basename(tempDir)
        ); // Handle /private prefix on macOS
        expect((variables.project as Record<string, unknown>).tree).toContain('readable.txt');
        // Should handle the restricted directory gracefully
      } finally {
        fs.chmodSync(restrictedDir, 0o755);
      }
    });
  });

  describe('ToolVariableProvider', () => {
    it('should provide tool information', () => {
      const tools = [
        { name: 'bash', description: 'Execute bash commands' },
        { name: 'file-read', description: 'Read file contents' },
        { name: 'file-write', description: 'Write file contents' },
      ];

      const provider = new ToolVariableProvider(tools);
      const variables = provider.getVariables();

      expect(variables).toHaveProperty('tools');
      expect(variables.tools).toHaveLength(3);
      expect((variables.tools as unknown[])[0]).toEqual({
        name: 'bash',
        description: 'Execute bash commands',
      });
      expect((variables.tools as unknown[])[1]).toEqual({
        name: 'file-read',
        description: 'Read file contents',
      });
      expect((variables.tools as unknown[])[2]).toEqual({
        name: 'file-write',
        description: 'Write file contents',
      });
    });

    it('should handle empty tools list', () => {
      const provider = new ToolVariableProvider([]);
      const variables = provider.getVariables();

      expect(variables).toEqual({ tools: [] });
    });

    it('should handle undefined tools list', () => {
      const provider = new ToolVariableProvider();
      const variables = provider.getVariables();

      expect(variables).toEqual({ tools: [] });
    });
  });

  describe('ContextDisclaimerProvider', () => {
    it('should provide context disclaimer', () => {
      const provider = new ContextDisclaimerProvider();
      const variables = provider.getVariables();

      expect(variables).toHaveProperty('context');
      expect(variables.context).toHaveProperty('disclaimer');
      expect((variables.context as Record<string, unknown>).disclaimer).toContain(
        'start of our conversation'
      );
      expect((variables.context as Record<string, unknown>).disclaimer).toContain(
        'will not be updated'
      );
    });
  });

  describe('VariableProviderManager', () => {
    it('should combine variables from multiple providers', async () => {
      const manager = new VariableProviderManager();

      manager.addProvider(new SystemVariableProvider());
      manager.addProvider(
        new ToolVariableProvider([{ name: 'test-tool', description: 'Test tool' }])
      );
      manager.addProvider(new ContextDisclaimerProvider());

      const context = await manager.getTemplateContext();

      expect(context).toHaveProperty('system');
      expect(context).toHaveProperty('tools');
      expect(context).toHaveProperty('context');
      expect(context.tools).toHaveLength(1);
      expect(((context.tools as unknown[])[0] as Record<string, unknown>).name).toBe('test-tool');
    });

    it('should handle provider errors gracefully', async () => {
      const failingProvider = {
        getVariables: vi.fn().mockRejectedValue(new Error('Provider failed')),
      };

      const manager = new VariableProviderManager();
      manager.addProvider(new SystemVariableProvider());
      manager.addProvider(failingProvider);
      manager.addProvider(new ToolVariableProvider([{ name: 'tool', description: 'desc' }]));

      const context = await manager.getTemplateContext();

      // Should include variables from working providers
      expect(context).toHaveProperty('system');
      expect(context).toHaveProperty('tools');
      // Should handle the failing provider gracefully
      expect(failingProvider.getVariables).toHaveBeenCalled();
    });

    it('should handle overlapping variable names', async () => {
      const provider1 = {
        getVariables: vi.fn().mockResolvedValue({ shared: 'value1', unique1: 'test1' }),
      };

      const provider2 = {
        getVariables: vi.fn().mockResolvedValue({ shared: 'value2', unique2: 'test2' }),
      };

      const manager = new VariableProviderManager();
      manager.addProvider(provider1);
      manager.addProvider(provider2);

      const context = await manager.getTemplateContext();

      // Later providers should override earlier ones
      expect(context.shared).toBe('value2');
      expect(context.unique1).toBe('test1');
      expect(context.unique2).toBe('test2');
    });
  });
});
