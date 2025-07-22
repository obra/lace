// ABOUTME: Unit tests for Commander-based CLI argument parsing
// ABOUTME: Tests tool approval flags, validation, and error cases with TDD approach

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseArgs, showHelp } from '~/cli/args';

// Test helpers for capturing CLI behavior instead of testing mocks
class CLITestCapture {
  errorMessages: string[] = [];
  logMessages: string[] = [];
  stdoutOutput: string[] = [];
  stderrOutput: string[] = [];
  exitCalled = false;
  exitCode?: number;

  captureError = (message: string): void => {
    this.errorMessages.push(message);
  };

  captureLog = (...args: unknown[]): void => {
    this.logMessages.push(args.map((arg) => String(arg)).join(' '));
  };

  captureStdout = (data: string | Uint8Array): boolean => {
    this.stdoutOutput.push(typeof data === 'string' ? data : data.toString());
    return true;
  };

  captureStderr = (data: string | Uint8Array): boolean => {
    this.stderrOutput.push(typeof data === 'string' ? data : data.toString());
    return true;
  };

  captureExit = (code?: string | number | null): never => {
    this.exitCalled = true;
    this.exitCode = typeof code === 'number' ? code : code ? Number(code) : undefined;
    throw new Error('process.exit called');
  };

  getAllOutput(): string {
    return [
      ...this.errorMessages,
      ...this.logMessages,
      ...this.stdoutOutput,
      ...this.stderrOutput,
    ].join('');
  }

  hasErrorMessage(content: string): boolean {
    return this.errorMessages.some((msg) => msg.includes(content));
  }

  hasLogMessage(content: string): boolean {
    return this.logMessages.some((msg) => msg.includes(content));
  }

  hasOutput(content: string): boolean {
    return this.getAllOutput().includes(content);
  }

  reset(): void {
    this.errorMessages = [];
    this.logMessages = [];
    this.stdoutOutput = [];
    this.stderrOutput = [];
    this.exitCalled = false;
    this.exitCode = undefined;
  }
}

describe('CLI Arguments (Commander-based)', () => {
  let cliCapture: CLITestCapture;

  beforeEach(() => {
    cliCapture = new CLITestCapture();

    vi.spyOn(console, 'error').mockImplementation(cliCapture.captureError);
    vi.spyOn(console, 'log').mockImplementation(cliCapture.captureLog);
    vi.spyOn(process.stdout, 'write').mockImplementation(cliCapture.captureStdout);
    vi.spyOn(process.stderr, 'write').mockImplementation(cliCapture.captureStderr);
    vi.spyOn(process, 'exit').mockImplementation(cliCapture.captureExit);
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
      // --list-tools triggers exit after listing tools
      expect(() => parseArgs(['--list-tools'])).toThrow('process.exit called');

      // Test actual behavior - exit was called (tools are listed as side effect)
      expect(cliCapture.exitCalled).toBe(true);
    });
  });

  describe('tool validation', () => {
    it('should reject unknown tools in --auto-approve-tools', () => {
      expect(() => parseArgs(['--auto-approve-tools=nonexistent'])).toThrow('process.exit called');

      // Test actual behavior - error message was displayed and exit was called
      expect(cliCapture.hasErrorMessage("Unknown tool 'nonexistent'")).toBe(true);
      expect(cliCapture.exitCalled).toBe(true);
    });

    it('should reject unknown tools in --disable-tools', () => {
      expect(() => parseArgs(['--disable-tools=unknown,bash'])).toThrow('process.exit called');

      // Test actual behavior - error message was displayed and exit was called
      expect(cliCapture.hasErrorMessage("Unknown tool 'unknown'")).toBe(true);
      expect(cliCapture.exitCalled).toBe(true);
    });

    it('should reject mixed known and unknown tools', () => {
      expect(() => parseArgs(['--auto-approve-tools=bash,unknown,file_read'])).toThrow(
        'process.exit called'
      );

      // Test actual behavior - error message was displayed and exit was called
      expect(cliCapture.hasErrorMessage("Unknown tool 'unknown'")).toBe(true);
      expect(cliCapture.exitCalled).toBe(true);
    });
  });

  describe('flag combination validation', () => {
    it('should reject --disable-all-tools with --auto-approve-tools', () => {
      expect(() => parseArgs(['--disable-all-tools', '--auto-approve-tools=bash'])).toThrow(
        'process.exit called'
      );

      // Test actual behavior - validation error was displayed and exit was called
      expect(
        cliCapture.hasErrorMessage('Cannot auto-approve tools when all tools are disabled')
      ).toBe(true);
      expect(cliCapture.exitCalled).toBe(true);
    });

    it('should reject --disable-all-tools with --allow-non-destructive-tools', () => {
      expect(() => parseArgs(['--disable-all-tools', '--allow-non-destructive-tools'])).toThrow(
        'process.exit called'
      );

      // Test actual behavior - validation error was displayed and exit was called
      expect(cliCapture.hasErrorMessage('Cannot allow tools when all tools are disabled')).toBe(
        true
      );
      expect(cliCapture.exitCalled).toBe(true);
    });

    it('should reject --disable-tool-guardrails with --disable-all-tools', () => {
      expect(() => parseArgs(['--disable-tool-guardrails', '--disable-all-tools'])).toThrow(
        'process.exit called'
      );

      // Test actual behavior - validation error was displayed and exit was called
      expect(
        cliCapture.hasErrorMessage('Cannot disable guardrails and all tools simultaneously')
      ).toBe(true);
      expect(cliCapture.exitCalled).toBe(true);
    });

    it('should reject auto-approving a disabled tool', () => {
      expect(() => parseArgs(['--disable-tools=bash', '--auto-approve-tools=bash'])).toThrow(
        'process.exit called'
      );

      // Test actual behavior - validation error was displayed and exit was called
      expect(cliCapture.hasErrorMessage("Cannot auto-approve disabled tool 'bash'")).toBe(true);
      expect(cliCapture.exitCalled).toBe(true);
    });

    it('should reject auto-approving a tool that gets disabled later in args', () => {
      expect(() => parseArgs(['--auto-approve-tools=bash', '--disable-tools=bash'])).toThrow(
        'process.exit called'
      );

      // Test actual behavior - validation error was displayed and exit was called
      expect(cliCapture.hasErrorMessage("Cannot auto-approve disabled tool 'bash'")).toBe(true);
      expect(cliCapture.exitCalled).toBe(true);
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
      showHelp();

      // Test actual behavior - help text was output
      const allOutput = cliCapture.getAllOutput();
      expect(allOutput).toContain('--allow-non-destructive-tools');
      expect(allOutput).toContain('--auto-approve-tools');
      expect(allOutput).toContain('--disable-tools');
      expect(allOutput).toContain('--disable-all-tools');
      expect(allOutput).toContain('--disable-tool-guardrails');
      expect(allOutput).toContain('--list-tools');
    });

    it('should list tools with descriptions when --list-tools is used', () => {
      // This would normally exit, but we'll test the behavior
      expect(() => parseArgs(['--list-tools'])).toThrow('process.exit called');

      // Test actual behavior - tools were listed
      expect(cliCapture.hasLogMessage('Available tools:')).toBe(true);
      expect(cliCapture.hasLogMessage('bash - Use bash to execute unix commands')).toBe(true);
      expect(cliCapture.hasLogMessage('file_read - Read file contents')).toBe(true);
    });

    it('should show tool safety classification in list', () => {
      expect(() => parseArgs(['--list-tools'])).toThrow('process.exit called');

      // Test actual behavior - safety classifications were shown
      const allOutput = cliCapture.getAllOutput();
      expect(allOutput).toContain('(destructive)');
      expect(allOutput).toContain('(read-only)');
    });
  });

  describe('error handling', () => {
    it('should reject unknown flags', () => {
      expect(() => parseArgs(['--unknown-flag'])).toThrow('process.exit called');

      // Test actual behavior - error message was displayed and exit was called
      expect(cliCapture.hasErrorMessage('Error: error: unknown option')).toBe(true);
      expect(cliCapture.exitCalled).toBe(true);
    });

    it('should validate log level values', () => {
      expect(() => parseArgs(['--log-level=invalid'])).toThrow('process.exit called');

      // Test actual behavior - validation error was displayed
      expect(
        cliCapture.hasErrorMessage('--log-level must be "error", "warn", "info", or "debug"')
      ).toBe(true);
      expect(cliCapture.exitCalled).toBe(true);
    });

    it('should handle empty tool lists gracefully in validation', () => {
      // This should not throw - empty lists are valid
      const result = parseArgs(['--auto-approve-tools=', '--disable-tools=']);
      expect(result.autoApproveTools).toEqual([]);
      expect(result.disableTools).toEqual([]);
    });
  });
});
