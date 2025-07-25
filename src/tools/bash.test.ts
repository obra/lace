// ABOUTME: Comprehensive tests for BashTool implementation
// ABOUTME: Tests command execution, error handling, and success/failure distinction

import { describe, it, expect, beforeEach } from 'vitest';
import { BashTool } from '~/tools/implementations/bash';

describe('BashTool', () => {
  let bashTool: BashTool;

  beforeEach(() => {
    bashTool = new BashTool();
  });

  describe('Tool metadata', () => {
    it('should have correct name and description', () => {
      expect(bashTool.name).toBe('bash');
      expect(bashTool.description).toBe(
        "Use bash to execute unix commands to achieve the user's goals. Be smart and careful."
      );
    });

    it('should have proper input schema', () => {
      const schema = bashTool.inputSchema;
      expect(schema.type).toBe('object');
      expect(schema.properties.command).toBeDefined();
      expect(schema.properties.command.type).toBe('string');
      expect(schema.properties.command).toBeDefined();
      expect(schema.required).toContain('command');
    });

    it('should be marked as destructive', () => {
      expect(bashTool.annotations?.destructiveHint).toBe(true);
    });
  });

  describe('Input validation', () => {
    it('should reject empty command', async () => {
      const result = await bashTool.execute({ command: '' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('Cannot be empty');
    });

    it('should reject non-string command', async () => {
      const result = await bashTool.execute({ command: 123 });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
    });

    it('should reject missing command', async () => {
      const result = await bashTool.execute({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('Required');
    });
  });

  describe('Successful command execution (exit code 0)', () => {
    it('should execute simple commands successfully', async () => {
      const result = await bashTool.execute({ command: 'echo "hello world"' });

      expect(result.isError).toBe(false);

      const output = JSON.parse(result.content[0].text!) as {
        exitCode: number;
        stdout: string;
        stderr: string;
      };
      expect(output.exitCode).toBe(0);
      expect(output.stdout).toBe('hello world\n');
      expect(output.stderr).toBe('');
    });

    it('should handle commands with no output', async () => {
      const result = await bashTool.execute({ command: 'true' });

      expect(result.isError).toBe(false);

      const output = JSON.parse(result.content[0].text!) as {
        exitCode: number;
        stdout: string;
        stderr: string;
      };
      expect(output.exitCode).toBe(0);
      expect(output.stdout).toBe('');
      expect(output.stderr).toBe('');
    });
  });

  describe('Command execution with non-zero exit codes', () => {
    it('should handle commands that return non-zero exit codes as tool success', async () => {
      // `false` command always returns exit code 1
      const result = await bashTool.execute({ command: 'false' });

      // Tool should succeed because it executed the command successfully
      expect(result.isError).toBe(false);

      const output = JSON.parse(result.content[0].text!) as {
        exitCode: number;
        stdout: string;
        stderr: string;
      };
      expect(output.exitCode).toBe(1); // Command failed, but tool succeeded
      expect(output.stdout).toBe('');
    });

    it('should handle grep with no matches (exit code 1)', async () => {
      const result = await bashTool.execute({
        command: 'echo "hello" | grep "world"',
      });

      expect(result.isError).toBe(false); // Tool executed successfully

      const output = JSON.parse(result.content[0].text!) as {
        exitCode: number;
        stdout: string;
        stderr: string;
      };
      expect(output.exitCode).toBe(1); // grep found no matches
      expect(output.stdout).toBe(''); // No output because no matches
    });

    it('should handle linter-style commands with issues found', async () => {
      // Create a temporary file with issues, then "lint" it
      const result = await bashTool.execute({
        command: 'echo "  spaces  " | wc -w && exit 1', // Simulate linter finding issues
      });

      expect(result.isError).toBe(false); // Tool ran the "linter"

      const output = JSON.parse(result.content[0].text!) as {
        exitCode: number;
        stdout: string;
        stderr: string;
      };
      expect(output.exitCode).toBe(1); // "Linter" found issues
      expect(output.stdout.trim()).toBe('1'); // wc output
    });
  });

  describe('Command execution failures', () => {
    it('should handle not found as tool failure', async () => {
      const result = await bashTool.execute({
        command: 'nonexistentcommand12345',
      });

      // Based on observed behavior: single nonexistent command = tool failure
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
      expect(result.content[0].text).toContain('nonexistentcommand12345');

      const output = JSON.parse(result.content[0].text!) as {
        exitCode: number;
        stdout: string;
        stderr: string;
      };
      expect(output.exitCode).toBe(127); // Command not found
      expect(output.stderr).toContain('not found');
    });

    it('should handle not found in sequence as tool success', async () => {
      const result = await bashTool.execute({
        command: 'echo "before"; nonexistentcommand12345; echo "Exit code: $?"',
      });

      // Based on observed behavior: command in sequence = tool success
      expect(result.isError).toBe(false);

      const output = JSON.parse(result.content[0].text!) as {
        exitCode: number;
        stdout: string;
        stderr: string;
      };
      expect(output.stdout).toContain('before');
      expect(output.stdout).toContain('Exit code: 127');
      expect(output.stderr).toContain('not found');
    });

    it('should handle permission denied', async () => {
      // Try to read a file that doesn't exist with strict permissions
      const result = await bashTool.execute({
        command: 'cat /root/nonexistent 2>/dev/null || echo "permission issue" >&2 && exit 126',
      });

      expect(result.isError).toBe(false); // Command executed (even though it failed)

      const output = JSON.parse(result.content[0].text!) as {
        exitCode: number;
        stdout: string;
        stderr: string;
      };
      expect(output.exitCode).toBe(126);
      expect(output.stderr).toContain('permission issue');
    });
  });

  describe('Output handling', () => {
    it('should capture both stdout and stderr', async () => {
      const result = await bashTool.execute({
        command: 'echo "to stdout" && echo "to stderr" >&2',
      });

      expect(result.isError).toBe(false);

      const output = JSON.parse(result.content[0].text!) as {
        exitCode: number;
        stdout: string;
        stderr: string;
      };
      expect(output.exitCode).toBe(0);
      expect(output.stdout).toBe('to stdout\n');
      expect(output.stderr).toBe('to stderr\n');
    });

    it('should handle large output', async () => {
      const result = await bashTool.execute({
        command: 'for i in {1..100}; do echo "line $i"; done',
      });

      expect(result.isError).toBe(false);

      const output = JSON.parse(result.content[0].text!) as {
        exitCode: number;
        stdout: string;
        stderr: string;
      };
      expect(output.exitCode).toBe(0);
      expect(output.stdout.split('\n')).toHaveLength(101); // 100 lines + empty line
      expect(output.stdout).toContain('line 1');
      expect(output.stdout).toContain('line 100');
    });

    it('should handle unicode and special characters', async () => {
      const result = await bashTool.execute({
        command: 'echo "Hello 🌍 World! Special: àáâãäå"',
      });

      expect(result.isError).toBe(false);

      const output = JSON.parse(result.content[0].text!) as {
        exitCode: number;
        stdout: string;
        stderr: string;
      };
      expect(output.exitCode).toBe(0);
      expect(output.stdout).toBe('Hello 🌍 World! Special: àáâãäå\n');
    });
  });

  describe('JSON output structure', () => {
    it('should always return valid JSON in output field', async () => {
      const result = await bashTool.execute({ command: 'echo "test"' });

      expect(result.isError).toBe(false);
      expect(() => JSON.parse(result.content[0].text!) as unknown).not.toThrow();

      const output = JSON.parse(result.content[0].text!) as {
        exitCode: number;
        stdout: string;
        stderr: string;
      };
      expect(output).toHaveProperty('stdout');
      expect(output).toHaveProperty('stderr');
      expect(output).toHaveProperty('exitCode');
      expect(typeof output.exitCode).toBe('number');
    });

    it('should maintain JSON structure even for complex output', async () => {
      // Command that outputs JSON itself
      const result = await bashTool.execute({
        command: 'echo \'{"test": "value", "number": 42}\'',
      });

      expect(result.isError).toBe(false);

      const output = JSON.parse(result.content[0].text!) as {
        exitCode: number;
        stdout: string;
        stderr: string;
      };
      expect(output.stdout).toBe('{"test": "value", "number": 42}\n');

      // The stdout content should also be valid JSON
      const innerJson = JSON.parse(output.stdout.trim()) as { test: string; number: number };
      expect(innerJson.test).toBe('value');
      expect(innerJson.number).toBe(42);
    });
  });

  describe('Real-world scenarios based on observed behavior', () => {
    it('should handle ESLint finding issues (exit 1) as tool success', async () => {
      // This matches what I observed when running ESLint that found issues
      const result = await bashTool.execute({
        command: 'echo "src/file.ts:1:1 error Delete spaces" && exit 1',
      });

      expect(result.isError).toBe(false); // ✅ Tool completed (not ❌ Tool failed)

      const output = JSON.parse(result.content[0].text!) as {
        exitCode: number;
        stdout: string;
        stderr: string;
      };
      expect(output.exitCode).toBe(1); // ESLint found issues
      expect(output.stdout).toContain('error Delete spaces');
    });

    it('should handle false command (exit 1) as tool success', async () => {
      // Observed: 'false' command shows as ✅ Tool completed
      const result = await bashTool.execute({ command: 'false' });

      expect(result.isError).toBe(false); // ✅ Tool completed

      const output = JSON.parse(result.content[0].text!) as {
        exitCode: number;
        stdout: string;
        stderr: string;
      };
      expect(output.exitCode).toBe(1);
      expect(output.stdout).toBe('');
      expect(output.stderr).toBe('');
    });

    it('should handle echo with success (exit 0) as tool success', async () => {
      // Observed: 'echo' commands show as ✅ Tool completed
      const result = await bashTool.execute({ command: 'echo "hello"' });

      expect(result.isError).toBe(false); // ✅ Tool completed

      const output = JSON.parse(result.content[0].text!) as {
        exitCode: number;
        stdout: string;
        stderr: string;
      };
      expect(output.exitCode).toBe(0);
      expect(output.stdout).toBe('hello\n');
      expect(output.stderr).toBe('');
    });

    it('should handle grep with no matches as tool success', async () => {
      // grep returns exit 1 when no matches found, but tool should succeed
      const result = await bashTool.execute({
        command: 'echo "hello" | grep "xyz"',
      });

      expect(result.isError).toBe(false); // ✅ Tool completed

      const output = JSON.parse(result.content[0].text!) as {
        exitCode: number;
        stdout: string;
        stderr: string;
      };
      expect(output.exitCode).toBe(1); // grep found no matches
      expect(output.stdout).toBe(''); // No output
    });

    it('should match the behavior I observed with command sequences', async () => {
      // Based on: echo "Testing not found"; nonexistentcommand12345; echo "Exit code was: $?"
      const result = await bashTool.execute({
        command: 'echo "Testing"; nonexistentcmd123; echo "After error"',
      });

      expect(result.isError).toBe(false); // ✅ Tool completed (what I observed)

      const output = JSON.parse(result.content[0].text!) as {
        exitCode: number;
        stdout: string;
        stderr: string;
      };
      expect(output.stdout).toContain('Testing');
      expect(output.stdout).toContain('After error');
      expect(output.stderr).toContain('not found');
    });
  });

  describe('Working directory context', () => {
    it('should use working directory from context when provided', async () => {
      // Create a temporary directory and test file
      const result = await bashTool.execute({
        command:
          'mkdir -p /tmp/test-bash-tool && echo "test content" > /tmp/test-bash-tool/test.txt',
      });
      expect(result.isError).toBe(false);

      // Now execute a command with context pointing to that directory
      const context = { workingDirectory: '/tmp/test-bash-tool' };
      const pwdResult = await bashTool.execute({ command: 'pwd && cat test.txt' }, context);

      expect(pwdResult.isError).toBe(false);

      const output = JSON.parse(pwdResult.content[0].text!) as {
        exitCode: number;
        stdout: string;
        stderr: string;
      };

      expect(output.exitCode).toBe(0);
      expect(output.stdout).toContain('/tmp/test-bash-tool');
      expect(output.stdout).toContain('test content');
    });

    it('should use process.cwd() when no context provided', async () => {
      const result = await bashTool.execute({ command: 'pwd' });

      expect(result.isError).toBe(false);

      const output = JSON.parse(result.content[0].text!) as {
        exitCode: number;
        stdout: string;
        stderr: string;
      };

      expect(output.exitCode).toBe(0);
      expect(output.stdout.trim()).toBe(process.cwd());
    });

    it('should use process.cwd() when context has no workingDirectory', async () => {
      const context = {}; // Empty context
      const result = await bashTool.execute({ command: 'pwd' }, context);

      expect(result.isError).toBe(false);

      const output = JSON.parse(result.content[0].text!) as {
        exitCode: number;
        stdout: string;
        stderr: string;
      };

      expect(output.exitCode).toBe(0);
      expect(output.stdout.trim()).toBe(process.cwd());
    });

    it('should handle relative paths correctly with working directory', async () => {
      // Create a test structure
      const setupResult = await bashTool.execute({
        command:
          'mkdir -p /tmp/test-bash-relative/subdir && echo "relative test" > /tmp/test-bash-relative/subdir/file.txt',
      });
      expect(setupResult.isError).toBe(false);

      // Use context to set working directory and test relative path
      const context = { workingDirectory: '/tmp/test-bash-relative' };
      const result = await bashTool.execute({ command: 'cat subdir/file.txt' }, context);

      expect(result.isError).toBe(false);

      const output = JSON.parse(result.content[0].text!) as {
        exitCode: number;
        stdout: string;
        stderr: string;
      };

      expect(output.exitCode).toBe(0);
      expect(output.stdout).toContain('relative test');
    });
  });
});
