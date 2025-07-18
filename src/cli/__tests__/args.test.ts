// ABOUTME: Unit tests for Commander-based CLI argument parsing
// ABOUTME: Tests tool approval flags, validation, and error cases with TDD approach

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withConsoleCapture } from '~/__tests__/setup/console-capture';
import { parseArgs, showHelp } from '~/cli/args';

describe('CLI Arguments (Commander-based)', () => {
  let consoleSpy: any;

  beforeEach(() => {
    // Use withConsoleCapture to get proper console spies
    const capture = withConsoleCapture();
    consoleSpy = capture.error;

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('basic argument parsing', () => {
    it('should return default options when no args provided', () => {
      const result = parseArgs([]);

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

    it('should parse existing provider and model flags', () => {
      const result = parseArgs(['--provider', 'lmstudio', '--model', 'test-model']);

      expect(result.provider).toBe('lmstudio');
      expect(result.model).toBe('test-model');
    });

    it('should parse help flag', () => {
      // Help flag triggers exit, so we expect it to throw
      expect(() => parseArgs(['--help'])).toThrow('process.exit called');
    });
  });

  describe('tool approval flags', () => {
    it('should parse --allow-non-destructive-tools flag', () => {
      const result = parseArgs(['--allow-non-destructive-tools']);
      expect(result.allowNonDestructiveTools).toBe(true);
    });

    it('should parse --auto-approve-tools with single tool', () => {
      const result = parseArgs(['--auto-approve-tools=bash']);
      expect(result.autoApproveTools).toEqual(['bash']);
    });

    it('should parse --auto-approve-tools with multiple tools', () => {
      const result = parseArgs(['--auto-approve-tools=bash,file_read,file_write']);
      expect(result.autoApproveTools).toEqual(['bash', 'file_read', 'file_write']);
    });

    it('should parse multiple --auto-approve-tools flags additively', () => {
      const result = parseArgs([
        '--auto-approve-tools=bash',
        '--auto-approve-tools=file_read',
        '--auto-approve-tools=file_write',
      ]);
      expect(result.autoApproveTools).toEqual(['bash', 'file_read', 'file_write']);
    });

    it('should parse --disable-tools with single tool', () => {
      const result = parseArgs(['--disable-tools=bash']);
      expect(result.disableTools).toEqual(['bash']);
    });

    it('should parse --disable-tools with multiple tools', () => {
      const result = parseArgs(['--disable-tools=bash,file_write']);
      expect(result.disableTools).toEqual(['bash', 'file_write']);
    });

    it('should parse multiple --disable-tools flags additively', () => {
      const result = parseArgs(['--disable-tools=bash', '--disable-tools=file_write']);
      expect(result.disableTools).toEqual(['bash', 'file_write']);
    });

    it('should parse --disable-all-tools flag', () => {
      const result = parseArgs(['--disable-all-tools']);
      expect(result.disableAllTools).toBe(true);
    });

    it('should parse --disable-tool-guardrails flag', () => {
      const result = parseArgs(['--disable-tool-guardrails']);
      expect(result.disableToolGuardrails).toBe(true);
    });

    it('should parse --list-tools flag', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {
        // Mock console.log to suppress output during test
      });

      // --list-tools triggers exit after listing tools
      expect(() => parseArgs(['--list-tools'])).toThrow('process.exit called');

      logSpy.mockRestore();
    });
  });

  describe('tool validation', () => {
    it('should reject unknown tools in --auto-approve-tools', () => {
      expect(() => parseArgs(['--auto-approve-tools=nonexistent'])).toThrow('process.exit called');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Unknown tool 'nonexistent'")
      );
    });

    it('should reject unknown tools in --disable-tools', () => {
      expect(() => parseArgs(['--disable-tools=unknown,bash'])).toThrow('process.exit called');

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown tool 'unknown'"));
    });

    it('should reject mixed known and unknown tools', () => {
      expect(() => parseArgs(['--auto-approve-tools=bash,unknown,file_read'])).toThrow(
        'process.exit called'
      );

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown tool 'unknown'"));
    });
  });

  describe('flag combination validation', () => {
    it('should reject --disable-all-tools with --auto-approve-tools', () => {
      expect(() => parseArgs(['--disable-all-tools', '--auto-approve-tools=bash'])).toThrow(
        'process.exit called'
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot auto-approve tools when all tools are disabled')
      );
    });

    it('should reject --disable-all-tools with --allow-non-destructive-tools', () => {
      expect(() => parseArgs(['--disable-all-tools', '--allow-non-destructive-tools'])).toThrow(
        'process.exit called'
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot allow tools when all tools are disabled')
      );
    });

    it('should reject --disable-tool-guardrails with --disable-all-tools', () => {
      expect(() => parseArgs(['--disable-tool-guardrails', '--disable-all-tools'])).toThrow(
        'process.exit called'
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot disable guardrails and all tools simultaneously')
      );
    });

    it('should reject auto-approving a disabled tool', () => {
      expect(() => parseArgs(['--disable-tools=bash', '--auto-approve-tools=bash'])).toThrow(
        'process.exit called'
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Cannot auto-approve disabled tool 'bash'")
      );
    });

    it('should reject auto-approving a tool that gets disabled later in args', () => {
      expect(() => parseArgs(['--auto-approve-tools=bash', '--disable-tools=bash'])).toThrow(
        'process.exit called'
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Cannot auto-approve disabled tool 'bash'")
      );
    });
  });

  describe('complex flag combinations', () => {
    it('should parse valid complex combination', () => {
      const result = parseArgs([
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

    it('should handle empty tool lists gracefully', () => {
      const result = parseArgs(['--auto-approve-tools=']);
      expect(result.autoApproveTools).toEqual([]);
    });

    it('should handle whitespace in tool lists', () => {
      const result = parseArgs(['--auto-approve-tools=bash, file_read ,file_write']);
      expect(result.autoApproveTools).toEqual(['bash', 'file_read', 'file_write']);
    });
  });

  describe('help and list functionality', () => {
    it('should show help with tool approval options', () => {
      const { log } = withConsoleCapture();
      // Mock process.stdout.write since Commander uses it for help output
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      showHelp();

      // Combine both console.log and stdout.write outputs
      const logOutput = log.mock.calls.map((call) => String(call[0])).join('');
      const stdoutOutput = stdoutSpy.mock.calls.map((call) => String(call[0])).join('');
      const helpText = logOutput + stdoutOutput;

      expect(helpText).toContain('--allow-non-destructive-tools');
      expect(helpText).toContain('--auto-approve-tools');
      expect(helpText).toContain('--disable-tools');
      expect(helpText).toContain('--disable-all-tools');
      expect(helpText).toContain('--disable-tool-guardrails');
      expect(helpText).toContain('--list-tools');

      stdoutSpy.mockRestore();
    });

    it('should list tools with descriptions when --list-tools is used', () => {
      const { log } = withConsoleCapture();

      // This would normally exit, but we'll test the behavior
      expect(() => parseArgs(['--list-tools'])).toThrow('process.exit called');

      // The tool listing should have been called
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Available tools:'));
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('bash - Use bash to execute unix commands')
      );
      expect(log).toHaveBeenCalledWith(expect.stringContaining('file_read - Read file contents'));
    });

    it('should show tool safety classification in list', () => {
      const { log } = withConsoleCapture();

      expect(() => parseArgs(['--list-tools'])).toThrow('process.exit called');

      const logOutput = log.mock.calls.map((call) => String(call[0])).join('');
      expect(logOutput).toContain('(destructive)');
      expect(logOutput).toContain('(read-only)');
    });
  });

  describe('error handling', () => {
    it('should reject unknown flags', () => {
      expect(() => parseArgs(['--unknown-flag'])).toThrow('process.exit called');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error: error: unknown option')
      );
    });
  });
});
