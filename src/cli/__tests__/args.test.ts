// ABOUTME: Unit tests for CLI argument parsing
// ABOUTME: Tests all argument combinations, validation, and error cases

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseArgs, showHelp } from '../args.js';

describe('CLI Arguments', () => {
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

  describe('parseArgs', () => {
    it('should return default options when no args provided', () => {
      const result = parseArgs([]);

      expect(result).toEqual({
        provider: 'anthropic',
        model: undefined,
        help: false,
        logLevel: 'info',
        logFile: undefined,
        prompt: undefined,
      });
    });

    it('should parse help flags', () => {
      expect(parseArgs(['--help']).help).toBe(true);
      expect(parseArgs(['-h']).help).toBe(true);
    });

    it('should parse provider flags', () => {
      expect(parseArgs(['--provider', 'lmstudio']).provider).toBe('lmstudio');
      expect(parseArgs(['-p', 'ollama']).provider).toBe('ollama');
      expect(parseArgs(['--provider=anthropic']).provider).toBe('anthropic');
      expect(parseArgs(['--provider', 'openai']).provider).toBe('openai');
      expect(parseArgs(['-p', 'openai']).provider).toBe('openai');
    });

    it('should validate provider values', () => {
      expect(() => parseArgs(['--provider', 'invalid'])).toThrow('process.exit called');
      expect(consoleSpy).toHaveBeenCalledWith(
        'Error: --provider must be "anthropic", "openai", "lmstudio", or "ollama"'
      );
    });

    it('should handle missing provider value', () => {
      expect(() => parseArgs(['--provider'])).toThrow('process.exit called');
      expect(consoleSpy).toHaveBeenCalledWith(
        'Error: --provider must be "anthropic", "openai", "lmstudio", or "ollama"'
      );
    });

    it('should parse model flags', () => {
      expect(parseArgs(['--model', 'claude-3-haiku-20240307']).model).toBe(
        'claude-3-haiku-20240307'
      );
      expect(parseArgs(['-m', 'gpt-4']).model).toBe('gpt-4');
      expect(parseArgs(['--model=mistralai/devstral-small-2505']).model).toBe(
        'mistralai/devstral-small-2505'
      );
    });

    it('should handle missing model value', () => {
      expect(() => parseArgs(['--model'])).toThrow('process.exit called');
      expect(consoleSpy).toHaveBeenCalledWith('Error: --model requires a model name');
    });

    it('should handle empty model value with equals', () => {
      expect(() => parseArgs(['--model='])).toThrow('process.exit called');
      expect(consoleSpy).toHaveBeenCalledWith('Error: --model requires a model name');
    });

    it('should parse log level flags', () => {
      expect(parseArgs(['--log-level', 'debug']).logLevel).toBe('debug');
      expect(parseArgs(['--log-level=error']).logLevel).toBe('error');
    });

    it('should validate log level values', () => {
      expect(() => parseArgs(['--log-level', 'invalid'])).toThrow('process.exit called');
      expect(consoleSpy).toHaveBeenCalledWith(
        'Error: --log-level must be "error", "warn", "info", or "debug"'
      );
    });

    it('should parse log file flags', () => {
      expect(parseArgs(['--log-file', 'debug.log']).logFile).toBe('debug.log');
      expect(parseArgs(['--log-file=/tmp/test.log']).logFile).toBe('/tmp/test.log');
    });

    it('should handle missing log file value', () => {
      expect(() => parseArgs(['--log-file'])).toThrow('process.exit called');
      expect(consoleSpy).toHaveBeenCalledWith('Error: --log-file requires a file path');
    });

    it('should parse prompt flags', () => {
      expect(parseArgs(['--prompt', 'Hello world']).prompt).toBe('Hello world');
      expect(parseArgs(['--prompt=Test prompt']).prompt).toBe('Test prompt');
    });

    it('should handle missing prompt value', () => {
      expect(() => parseArgs(['--prompt'])).toThrow('process.exit called');
      expect(consoleSpy).toHaveBeenCalledWith('Error: --prompt requires a prompt text');
    });

    it('should allow session management arguments to pass through', () => {
      // These shouldn't cause errors
      expect(parseArgs(['--continue']).help).toBe(false);
      expect(parseArgs(['lace_20250615_abc123']).help).toBe(false);
    });

    it('should reject unknown arguments', () => {
      expect(() => parseArgs(['--unknown'])).toThrow('process.exit called');
      expect(consoleSpy).toHaveBeenCalledWith('Error: Unknown argument "--unknown"');
    });

    it('should parse complex argument combinations', () => {
      const result = parseArgs([
        '--provider',
        'lmstudio',
        '--model=mistralai/devstral-small-2505',
        '--log-level=debug',
        '--log-file',
        '/tmp/debug.log',
        '--prompt=What is 2+2?',
      ]);

      expect(result).toEqual({
        provider: 'lmstudio',
        model: 'mistralai/devstral-small-2505',
        help: false,
        logLevel: 'debug',
        logFile: '/tmp/debug.log',
        prompt: 'What is 2+2?',
      });
    });

    it('should handle arguments with spaces in values', () => {
      const result = parseArgs([
        '--prompt',
        'This is a long prompt with spaces',
        '--log-file',
        '/path/with spaces/log.txt',
      ]);

      expect(result.prompt).toBe('This is a long prompt with spaces');
      expect(result.logFile).toBe('/path/with spaces/log.txt');
    });
  });

  describe('showHelp', () => {
    it('should output help text', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      showHelp();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Lace AI Coding Assistant'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: lace [options]'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('--provider'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Examples:'));

      logSpy.mockRestore();
    });

    it('should include all supported options in help', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      showHelp();

      const helpText = logSpy.mock.calls.map((call) => call[0]).join('');

      expect(helpText).toContain('--help');
      expect(helpText).toContain('--provider');
      expect(helpText).toContain('--model');
      expect(helpText).toContain('--log-level');
      expect(helpText).toContain('--log-file');
      expect(helpText).toContain('--prompt');
      expect(helpText).toContain('--continue');
      expect(helpText).toContain('ANTHROPIC_KEY');

      logSpy.mockRestore();
    });
  });
});
