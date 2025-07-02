// ABOUTME: Tests for schema-based bash tool implementation
// ABOUTME: Validates command execution, error handling, and success/failure distinction

import { describe, it, expect } from 'vitest';
import { BashTool } from '../implementations/bash.js';

describe('BashTool with schema validation', () => {
  const tool = new BashTool();

  describe('tool metadata', () => {
    it('should have correct name and description', () => {
      expect(tool.name).toBe('bash');
      expect(tool.description).toBe(
        "Use bash to execute unix commands to achieve the user's goals. Be smart and careful."
      );
    });

    it('should have correct input schema', () => {
      const schema = tool.inputSchema;
      expect(schema.type).toBe('object');
      expect(schema.properties.command).toBeDefined();
      expect(schema.properties.command.type).toBe('string');
      expect(schema.required).toContain('command');
    });

    it('should have annotations for policy system', () => {
      expect(tool.annotations?.destructiveHint).toBe(true);
      expect(tool.annotations?.openWorldHint).toBe(true);
    });
  });

  describe('input validation', () => {
    it('should reject empty command', async () => {
      const result = await tool.execute({ command: '' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('Cannot be empty');
    });

    it('should reject non-string command', async () => {
      const result = await tool.execute({ command: 123 });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
    });

    it('should reject missing command', async () => {
      const result = await tool.execute({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('Required');
    });
  });

  describe('successful command execution (exit code 0)', () => {
    it('should execute simple commands successfully', async () => {
      const result = await tool.execute({ command: 'echo "hello world"' });

      expect(result.isError).toBe(false);

      const output = JSON.parse(result.content[0].text);
      expect(output.exitCode).toBe(0);
      expect(output.stdout).toBe('hello world\n');
      expect(output.stderr).toBe('');
    });

    it('should handle commands with no output', async () => {
      const result = await tool.execute({ command: 'true' });

      expect(result.isError).toBe(false);

      const output = JSON.parse(result.content[0].text);
      expect(output.exitCode).toBe(0);
      expect(output.stdout).toBe('');
      expect(output.stderr).toBe('');
    });
  });

  describe('command execution with non-zero exit codes', () => {
    it('should handle commands that return non-zero exit codes as tool success', async () => {
      // `false` command always returns exit code 1
      const result = await tool.execute({ command: 'false' });

      // Tool should succeed because it executed the command successfully
      expect(result.isError).toBe(false);

      const output = JSON.parse(result.content[0].text);
      expect(output.exitCode).toBe(1); // Command failed, but tool succeeded
      expect(output.stdout).toBe('');
    });

    it('should handle grep with no matches (exit code 1)', async () => {
      const result = await tool.execute({
        command: 'echo "hello" | grep "world"',
      });

      expect(result.isError).toBe(false); // Tool executed successfully

      const output = JSON.parse(result.content[0].text);
      expect(output.exitCode).toBe(1); // grep found no matches
      expect(output.stdout).toBe(''); // No output because no matches
    });

    it('should handle linter-style commands with issues found', async () => {
      // Create a temporary file with issues, then "lint" it
      const result = await tool.execute({
        command: 'echo "  spaces  " | wc -w && exit 1', // Simulate linter finding issues
      });

      expect(result.isError).toBe(false); // Tool ran the "linter"

      const output = JSON.parse(result.content[0].text);
      expect(output.exitCode).toBe(1); // "Linter" found issues
      expect(output.stdout.trim()).toBe('1'); // wc output
    });
  });

  describe('command execution failures', () => {
    it('should handle not found as tool failure', async () => {
      const result = await tool.execute({
        command: 'nonexistentcommand12345',
      });

      // Based on observed behavior: single nonexistent command = tool failure
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
      expect(result.content[0].text).toContain('nonexistentcommand12345');

      const output = JSON.parse(result.content[0].text);
      expect(output.exitCode).toBe(127); // Command not found
      expect(output.stderr).toContain('not found');
    });

    it('should handle not found in sequence as tool success', async () => {
      const result = await tool.execute({
        command: 'echo "before"; nonexistentcommand12345; echo "Exit code: $?"',
      });

      // Based on observed behavior: command in sequence = tool success
      expect(result.isError).toBe(false);

      const output = JSON.parse(result.content[0].text);
      expect(output.stdout).toContain('before');
      expect(output.stdout).toContain('Exit code: 127');
      expect(output.stderr).toContain('not found');
    });

    it('should handle permission denied', async () => {
      // Try to read a file that doesn't exist with strict permissions
      const result = await tool.execute({
        command: 'cat /root/nonexistent 2>/dev/null || echo "permission issue" >&2 && exit 126',
      });

      expect(result.isError).toBe(false); // Command executed (even though it failed)

      const output = JSON.parse(result.content[0].text);
      expect(output.exitCode).toBe(126);
      expect(output.stderr).toContain('permission issue');
    });
  });

  describe('output handling', () => {
    it('should capture both stdout and stderr', async () => {
      const result = await tool.execute({
        command: 'echo "to stdout" && echo "to stderr" >&2',
      });

      expect(result.isError).toBe(false);

      const output = JSON.parse(result.content[0].text);
      expect(output.exitCode).toBe(0);
      expect(output.stdout).toBe('to stdout\n');
      expect(output.stderr).toBe('to stderr\n');
    });

    it('should handle large output', async () => {
      const result = await tool.execute({
        command: 'for i in {1..100}; do echo "line $i"; done',
      });

      expect(result.isError).toBe(false);

      const output = JSON.parse(result.content[0].text);
      expect(output.exitCode).toBe(0);
      expect(output.stdout.split('\n')).toHaveLength(101); // 100 lines + empty line
      expect(output.stdout).toContain('line 1');
      expect(output.stdout).toContain('line 100');
    });

    it('should handle unicode and special characters', async () => {
      const result = await tool.execute({
        command: 'echo "Hello 🌍 World! Special: àáâãäå"',
      });

      expect(result.isError).toBe(false);

      const output = JSON.parse(result.content[0].text);
      expect(output.exitCode).toBe(0);
      expect(output.stdout).toBe('Hello 🌍 World! Special: àáâãäå\n');
    });
  });

  describe('JSON output structure', () => {
    it('should always return valid JSON in output field', async () => {
      const result = await tool.execute({ command: 'echo "test"' });

      expect(result.isError).toBe(false);
      expect(() => JSON.parse(result.content[0].text)).not.toThrow();

      const output = JSON.parse(result.content[0].text);
      expect(output).toHaveProperty('stdout');
      expect(output).toHaveProperty('stderr');
      expect(output).toHaveProperty('exitCode');
      expect(typeof output.exitCode).toBe('number');
    });

    it('should maintain JSON structure even for complex output', async () => {
      // Command that outputs JSON itself
      const result = await tool.execute({
        command: 'echo \'{"test": "value", "number": 42}\'',
      });

      expect(result.isError).toBe(false);

      const output = JSON.parse(result.content[0].text);
      expect(output.stdout).toBe('{"test": "value", "number": 42}\n');

      // The stdout content should also be valid JSON
      const innerJson = JSON.parse(output.stdout.trim());
      expect(innerJson.test).toBe('value');
      expect(innerJson.number).toBe(42);
    });
  });

  describe('real-world scenarios based on observed behavior', () => {
    it('should handle ESLint finding issues (exit 1) as tool success', async () => {
      // This matches what I observed when running ESLint that found issues
      const result = await tool.execute({
        command: 'echo "src/file.ts:1:1 error Delete spaces" && exit 1',
      });

      expect(result.isError).toBe(false); // ✅ Tool completed (not ❌ Tool failed)

      const output = JSON.parse(result.content[0].text);
      expect(output.exitCode).toBe(1); // ESLint found issues
      expect(output.stdout).toContain('error Delete spaces');
    });

    it('should handle false command (exit 1) as tool success', async () => {
      // Observed: 'false' command shows as ✅ Tool completed
      const result = await tool.execute({ command: 'false' });

      expect(result.isError).toBe(false); // ✅ Tool completed

      const output = JSON.parse(result.content[0].text);
      expect(output.exitCode).toBe(1);
      expect(output.stdout).toBe('');
      expect(output.stderr).toBe('');
    });

    it('should handle echo with success (exit 0) as tool success', async () => {
      // Observed: 'echo' commands show as ✅ Tool completed
      const result = await tool.execute({ command: 'echo "hello"' });

      expect(result.isError).toBe(false); // ✅ Tool completed

      const output = JSON.parse(result.content[0].text);
      expect(output.exitCode).toBe(0);
      expect(output.stdout).toBe('hello\n');
      expect(output.stderr).toBe('');
    });

    it('should handle grep with no matches as tool success', async () => {
      // grep returns exit 1 when no matches found, but tool should succeed
      const result = await tool.execute({
        command: 'echo "hello" | grep "xyz"',
      });

      expect(result.isError).toBe(false); // ✅ Tool completed

      const output = JSON.parse(result.content[0].text);
      expect(output.exitCode).toBe(1); // grep found no matches
      expect(output.stdout).toBe(''); // No output
    });

    it('should match the behavior I observed with command sequences', async () => {
      // Based on: echo "Testing not found"; nonexistentcommand12345; echo "Exit code was: $?"
      const result = await tool.execute({
        command: 'echo "Testing"; nonexistentcmd123; echo "After error"',
      });

      expect(result.isError).toBe(false); // ✅ Tool completed (what I observed)

      const output = JSON.parse(result.content[0].text);
      expect(output.stdout).toContain('Testing');
      expect(output.stdout).toContain('After error');
      expect(output.stderr).toContain('not found');
    });
  });
});
