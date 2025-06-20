// ABOUTME: Unit tests for Commander-based CLI argument parsing
// ABOUTME: Tests tool approval flags, validation, and error cases with TDD approach

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseArgs, showHelp } from '../args.js';

describe('CLI Arguments (Commander-based)', () => {
  let consoleSpy: any;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('basic argument parsing', () => {
    it('should return default options when no args provided', async () => {
      const result = await parseArgs([]);

      expect(result).toEqual({
        provider: 'anthropic',
        model: undefined,
        help: false,
        logLevel: 'info',
        logFile: undefined,
        prompt: undefined,
        ui: 'terminal',
        continue: undefined,
        // Tool approval defaults
        allowNonDestructiveTools: false,
        autoApproveTools: [],
        disableTools: [],
        disableAllTools: false,
        disableToolGuardrails: false,
        listTools: false,
      });
    });

    it('should parse existing provider and model flags', async () => {
      const result = await parseArgs(['--provider', 'lmstudio', '--model', 'test-model']);

      expect(result.provider).toBe('lmstudio');
      expect(result.model).toBe('test-model');
    });

    it('should parse help flag', async () => {
      // Help flag triggers exit, so we expect it to throw
      await expect(() => parseArgs(['--help'])).rejects.toThrow('process.exit called');
    });
  });

  describe('tool approval flags', () => {
    it('should parse --allow-non-destructive-tools flag', async () => {
      const result = await parseArgs(['--allow-non-destructive-tools']);
      expect(result.allowNonDestructiveTools).toBe(true);
    });

    it('should parse --auto-approve-tools with single tool', async () => {
      const result = await parseArgs(['--auto-approve-tools=bash']);
      expect(result.autoApproveTools).toEqual(['bash']);
    });

    it('should parse --auto-approve-tools with multiple tools', async () => {
      const result = await parseArgs(['--auto-approve-tools=bash,file_read,file_write']);
      expect(result.autoApproveTools).toEqual(['bash', 'file_read', 'file_write']);
    });

    it('should parse multiple --auto-approve-tools flags additively', async () => {
      const result = await parseArgs([
        '--auto-approve-tools=bash',
        '--auto-approve-tools=file_read',
        '--auto-approve-tools=file_write',
      ]);
      expect(result.autoApproveTools).toEqual(['bash', 'file_read', 'file_write']);
    });

    it('should parse --disable-tools with single tool', async () => {
      const result = await parseArgs(['--disable-tools=bash']);
      expect(result.disableTools).toEqual(['bash']);
    });

    it('should parse --disable-tools with multiple tools', async () => {
      const result = await parseArgs(['--disable-tools=bash,file_write']);
      expect(result.disableTools).toEqual(['bash', 'file_write']);
    });

    it('should parse multiple --disable-tools flags additively', async () => {
      const result = await parseArgs(['--disable-tools=bash', '--disable-tools=file_write']);
      expect(result.disableTools).toEqual(['bash', 'file_write']);
    });

    it('should parse --disable-all-tools flag', async () => {
      const result = await parseArgs(['--disable-all-tools']);
      expect(result.disableAllTools).toBe(true);
    });

    it('should parse --disable-tool-guardrails flag', async () => {
      const result = await parseArgs(['--disable-tool-guardrails']);
      expect(result.disableToolGuardrails).toBe(true);
    });

    it('should parse --list-tools flag', async () => {
      // --list-tools triggers exit after listing tools
      await expect(() => parseArgs(['--list-tools'])).rejects.toThrow('process.exit called');
    });
  });

  describe('tool validation', () => {
    it('should reject unknown tools in --auto-approve-tools', async () => {
      await expect(() => parseArgs(['--auto-approve-tools=nonexistent'])).rejects.toThrow(
        'process.exit called'
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Unknown tool 'nonexistent'")
      );
    });

    it('should reject unknown tools in --disable-tools', async () => {
      await expect(() => parseArgs(['--disable-tools=unknown,bash'])).rejects.toThrow(
        'process.exit called'
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown tool 'unknown'"));
    });

    it('should reject mixed known and unknown tools', async () => {
      await expect(() =>
        parseArgs(['--auto-approve-tools=bash,unknown,file_read'])
      ).rejects.toThrow('process.exit called');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown tool 'unknown'"));
    });
  });

  describe('flag combination validation', () => {
    it('should reject --disable-all-tools with --auto-approve-tools', async () => {
      await expect(() =>
        parseArgs(['--disable-all-tools', '--auto-approve-tools=bash'])
      ).rejects.toThrow('process.exit called');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot auto-approve tools when all tools are disabled')
      );
    });

    it('should reject --disable-all-tools with --allow-non-destructive-tools', async () => {
      await expect(() =>
        parseArgs(['--disable-all-tools', '--allow-non-destructive-tools'])
      ).rejects.toThrow('process.exit called');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot allow tools when all tools are disabled')
      );
    });

    it('should reject --disable-tool-guardrails with --disable-all-tools', async () => {
      await expect(() =>
        parseArgs(['--disable-tool-guardrails', '--disable-all-tools'])
      ).rejects.toThrow('process.exit called');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot disable guardrails and all tools simultaneously')
      );
    });

    it('should reject auto-approving a disabled tool', async () => {
      await expect(() =>
        parseArgs(['--disable-tools=bash', '--auto-approve-tools=bash'])
      ).rejects.toThrow('process.exit called');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Cannot auto-approve disabled tool 'bash'")
      );
    });

    it('should reject auto-approving a tool that gets disabled later in args', async () => {
      await expect(() =>
        parseArgs(['--auto-approve-tools=bash', '--disable-tools=bash'])
      ).rejects.toThrow('process.exit called');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Cannot auto-approve disabled tool 'bash'")
      );
    });
  });

  describe('complex flag combinations', () => {
    it('should parse valid complex combination', async () => {
      const result = await parseArgs([
        '--provider=lmstudio',
        '--allow-non-destructive-tools',
        '--auto-approve-tools=bash',
        '--disable-tools=file_write',
        '--log-level=debug',
      ]);

      expect(result).toEqual({
        provider: 'lmstudio',
        model: undefined,
        help: false,
        logLevel: 'debug',
        logFile: undefined,
        prompt: undefined,
        ui: 'terminal',
        continue: undefined,
        allowNonDestructiveTools: true,
        autoApproveTools: ['bash'],
        disableTools: ['file_write'],
        disableAllTools: false,
        disableToolGuardrails: false,
        listTools: false,
      });
    });

    it('should handle empty tool lists gracefully', async () => {
      const result = await parseArgs(['--auto-approve-tools=']);
      expect(result.autoApproveTools).toEqual([]);
    });

    it('should handle whitespace in tool lists', async () => {
      const result = await parseArgs(['--auto-approve-tools=bash, file_read ,file_write']);
      expect(result.autoApproveTools).toEqual(['bash', 'file_read', 'file_write']);
    });
  });

  describe('help and list functionality', () => {
    it('should show help with tool approval options', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      // Mock process.stdout.write since Commander uses it for help output
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      await showHelp();

      // Combine both console.log and stdout.write outputs
      const logOutput = logSpy.mock.calls.map((call) => call[0]).join('');
      const stdoutOutput = stdoutSpy.mock.calls.map((call) => call[0]).join('');
      const helpText = logOutput + stdoutOutput;

      expect(helpText).toContain('--allow-non-destructive-tools');
      expect(helpText).toContain('--auto-approve-tools');
      expect(helpText).toContain('--disable-tools');
      expect(helpText).toContain('--disable-all-tools');
      expect(helpText).toContain('--disable-tool-guardrails');
      expect(helpText).toContain('--list-tools');

      logSpy.mockRestore();
      stdoutSpy.mockRestore();
    });

    it('should list tools with descriptions when --list-tools is used', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // This would normally exit, but we'll test the behavior
      await expect(() => parseArgs(['--list-tools'])).rejects.toThrow('process.exit called');

      // The tool listing should have been called
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Available tools:'));
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('bash - Use bash to execute unix commands')
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('file_read - Read file contents')
      );

      logSpy.mockRestore();
    });

    it('should show tool safety classification in list', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await expect(() => parseArgs(['--list-tools'])).rejects.toThrow('process.exit called');

      const logOutput = logSpy.mock.calls.map((call) => call[0]).join('');
      expect(logOutput).toContain('(destructive)');
      expect(logOutput).toContain('(read-only)');

      logSpy.mockRestore();
    });
  });

  describe('error handling', () => {
    it('should reject unknown flags', async () => {
      await expect(() => parseArgs(['--unknown-flag'])).rejects.toThrow('process.exit called');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error: error: unknown option')
      );
    });
  });
});
