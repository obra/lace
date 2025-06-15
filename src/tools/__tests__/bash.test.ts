// ABOUTME: Comprehensive tests for BashTool implementation
// ABOUTME: Tests command execution, error handling, and success/failure distinction

import { describe, it, expect, beforeEach } from 'vitest';
import { BashTool } from '../implementations/bash.js';

describe('BashTool', () => {
  let bashTool: BashTool;

  beforeEach(() => {
    bashTool = new BashTool();
  });

  describe('Tool metadata', () => {
    it('should have correct name and description', () => {
      expect(bashTool.name).toBe('bash');
      expect(bashTool.description).toBe('Execute bash commands');
    });

    it('should have proper input schema', () => {
      expect(bashTool.input_schema).toEqual({
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash command to execute' },
        },
        required: ['command'],
      });
    });
  });

  describe('Input validation', () => {
    it('should reject empty command', async () => {
      const result = await bashTool.executeTool({ command: '' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Command must be a non-empty string');

      const output = JSON.parse(result.output);
      expect(output.exitCode).toBe(1);
      expect(output.stderr).toBe('Command must be a non-empty string');
    });

    it('should reject non-string command', async () => {
      const result = await bashTool.executeTool({ command: 123 });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Command must be a non-empty string');
    });

    it('should reject missing command', async () => {
      const result = await bashTool.executeTool({});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Command must be a non-empty string');
    });
  });

  describe('Successful command execution (exit code 0)', () => {
    it('should execute simple commands successfully', async () => {
      const result = await bashTool.executeTool({ command: 'echo "hello world"' });

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();

      const output = JSON.parse(result.output);
      expect(output.exitCode).toBe(0);
      expect(output.stdout).toBe('hello world\n');
      expect(output.stderr).toBe('');
    });

    it('should handle commands with no output', async () => {
      const result = await bashTool.executeTool({ command: 'true' });

      expect(result.success).toBe(true);

      const output = JSON.parse(result.output);
      expect(output.exitCode).toBe(0);
      expect(output.stdout).toBe('');
      expect(output.stderr).toBe('');
    });
  });

  describe('Command execution with non-zero exit codes', () => {
    it('should handle commands that return non-zero exit codes as tool success', async () => {
      // `false` command always returns exit code 1
      const result = await bashTool.executeTool({ command: 'false' });

      // Tool should succeed because it executed the command successfully
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();

      const output = JSON.parse(result.output);
      expect(output.exitCode).toBe(1); // Command failed, but tool succeeded
      expect(output.stdout).toBe('');
    });

    it('should handle grep with no matches (exit code 1)', async () => {
      const result = await bashTool.executeTool({
        command: 'echo "hello" | grep "world"',
      });

      expect(result.success).toBe(true); // Tool executed successfully

      const output = JSON.parse(result.output);
      expect(output.exitCode).toBe(1); // grep found no matches
      expect(output.stdout).toBe(''); // No output because no matches
    });

    it('should handle linter-style commands with issues found', async () => {
      // Create a temporary file with issues, then "lint" it
      const result = await bashTool.executeTool({
        command: 'echo "  spaces  " | wc -w && exit 1', // Simulate linter finding issues
      });

      expect(result.success).toBe(true); // Tool ran the "linter"

      const output = JSON.parse(result.output);
      expect(output.exitCode).toBe(1); // "Linter" found issues
      expect(output.stdout.trim()).toBe('1'); // wc output
    });
  });

  describe('Command execution failures', () => {
    it('should handle command not found as tool failure', async () => {
      const result = await bashTool.executeTool({
        command: 'nonexistentcommand12345',
      });

      // Based on observed behavior: single nonexistent command = tool failure
      expect(result.success).toBe(false);
      expect(result.error).toContain('command not found');
      expect(result.error).toContain('nonexistentcommand12345');

      const output = JSON.parse(result.output);
      expect(output.exitCode).toBe(127); // Command not found
      expect(output.stderr).toContain('command not found');
    });

    it('should handle command not found in sequence as tool success', async () => {
      const result = await bashTool.executeTool({
        command: 'echo "before"; nonexistentcommand12345; echo "Exit code: $?"',
      });

      // Based on observed behavior: command in sequence = tool success
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();

      const output = JSON.parse(result.output);
      expect(output.stdout).toContain('before');
      expect(output.stdout).toContain('Exit code: 127');
      expect(output.stderr).toContain('command not found');
    });

    it('should handle permission denied', async () => {
      // Try to read a file that doesn't exist with strict permissions
      const result = await bashTool.executeTool({
        command: 'cat /root/nonexistent 2>/dev/null || echo "permission issue" >&2 && exit 126',
      });

      expect(result.success).toBe(true); // Command executed (even though it failed)

      const output = JSON.parse(result.output);
      expect(output.exitCode).toBe(126);
      expect(output.stderr).toContain('permission issue');
    });
  });

  describe('Output handling', () => {
    it('should capture both stdout and stderr', async () => {
      const result = await bashTool.executeTool({
        command: 'echo "to stdout" && echo "to stderr" >&2',
      });

      expect(result.success).toBe(true);

      const output = JSON.parse(result.output);
      expect(output.exitCode).toBe(0);
      expect(output.stdout).toBe('to stdout\n');
      expect(output.stderr).toBe('to stderr\n');
    });

    it('should handle large output', async () => {
      const result = await bashTool.executeTool({
        command: 'for i in {1..100}; do echo "line $i"; done',
      });

      expect(result.success).toBe(true);

      const output = JSON.parse(result.output);
      expect(output.exitCode).toBe(0);
      expect(output.stdout.split('\n')).toHaveLength(101); // 100 lines + empty line
      expect(output.stdout).toContain('line 1');
      expect(output.stdout).toContain('line 100');
    });

    it('should handle unicode and special characters', async () => {
      const result = await bashTool.executeTool({
        command: 'echo "Hello 🌍 World! Special: àáâãäå"',
      });

      expect(result.success).toBe(true);

      const output = JSON.parse(result.output);
      expect(output.exitCode).toBe(0);
      expect(output.stdout).toBe('Hello 🌍 World! Special: àáâãäå\n');
    });
  });

  describe('JSON output structure', () => {
    it('should always return valid JSON in output field', async () => {
      const result = await bashTool.executeTool({ command: 'echo "test"' });

      expect(result.success).toBe(true);
      expect(() => JSON.parse(result.output)).not.toThrow();

      const output = JSON.parse(result.output);
      expect(output).toHaveProperty('stdout');
      expect(output).toHaveProperty('stderr');
      expect(output).toHaveProperty('exitCode');
      expect(typeof output.exitCode).toBe('number');
    });

    it('should maintain JSON structure even for complex output', async () => {
      // Command that outputs JSON itself
      const result = await bashTool.executeTool({
        command: 'echo \'{"test": "value", "number": 42}\'',
      });

      expect(result.success).toBe(true);

      const output = JSON.parse(result.output);
      expect(output.stdout).toBe('{"test": "value", "number": 42}\n');

      // The stdout content should also be valid JSON
      const innerJson = JSON.parse(output.stdout.trim());
      expect(innerJson.test).toBe('value');
      expect(innerJson.number).toBe(42);
    });
  });

  describe('Real-world scenarios based on observed behavior', () => {
    it('should handle ESLint finding issues (exit 1) as tool success', async () => {
      // This matches what I observed when running ESLint that found issues
      const result = await bashTool.executeTool({
        command: 'echo "src/file.ts:1:1 error Delete spaces" && exit 1',
      });

      expect(result.success).toBe(true); // ✅ Tool completed (not ❌ Tool failed)

      const output = JSON.parse(result.output);
      expect(output.exitCode).toBe(1); // ESLint found issues
      expect(output.stdout).toContain('error Delete spaces');
    });

    it('should handle false command (exit 1) as tool success', async () => {
      // Observed: 'false' command shows as ✅ Tool completed
      const result = await bashTool.executeTool({ command: 'false' });

      expect(result.success).toBe(true); // ✅ Tool completed

      const output = JSON.parse(result.output);
      expect(output.exitCode).toBe(1);
      expect(output.stdout).toBe('');
      expect(output.stderr).toBe('');
    });

    it('should handle echo with success (exit 0) as tool success', async () => {
      // Observed: 'echo' commands show as ✅ Tool completed
      const result = await bashTool.executeTool({ command: 'echo "hello"' });

      expect(result.success).toBe(true); // ✅ Tool completed

      const output = JSON.parse(result.output);
      expect(output.exitCode).toBe(0);
      expect(output.stdout).toBe('hello\n');
      expect(output.stderr).toBe('');
    });

    it('should handle grep with no matches as tool success', async () => {
      // grep returns exit 1 when no matches found, but tool should succeed
      const result = await bashTool.executeTool({
        command: 'echo "hello" | grep "xyz"',
      });

      expect(result.success).toBe(true); // ✅ Tool completed

      const output = JSON.parse(result.output);
      expect(output.exitCode).toBe(1); // grep found no matches
      expect(output.stdout).toBe(''); // No output
    });

    it('should match the behavior I observed with command sequences', async () => {
      // Based on: echo "Testing command not found"; nonexistentcommand12345; echo "Exit code was: $?"
      const result = await bashTool.executeTool({
        command: 'echo "Testing"; nonexistentcmd123; echo "After error"',
      });

      expect(result.success).toBe(true); // ✅ Tool completed (what I observed)

      const output = JSON.parse(result.output);
      expect(output.stdout).toContain('Testing');
      expect(output.stdout).toContain('After error');
      expect(output.stderr).toContain('command not found');
    });
  });
});
