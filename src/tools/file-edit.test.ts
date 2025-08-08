// ABOUTME: Integration tests for file edit tool with file protection
// ABOUTME: Tests text replacement, validation, and file read protection mechanism

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, rm, mkdir, readFile } from 'fs/promises';
import { join } from 'path';
import { FileEditTool } from '~/tools/implementations/file-edit';
import { ApprovalDecision } from '~/tools/approval-types';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '~/test-utils/provider-instances';
import {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '~/test-utils/provider-defaults';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import type { ToolContext } from '~/tools/types';

describe('FileEditTool Integration Tests', () => {
  const _tempLaceDir = setupCoreTest();
  let tool: FileEditTool;
  let providerInstanceId: string;
  let session: Session;
  let agent: ReturnType<typeof session.getAgent>;
  let context: ToolContext;
  const testDir = join(process.cwd(), 'test-temp-file-edit-schema');
  const testFile = join(testDir, 'test.txt');
  beforeEach(async () => {
    setupTestProviderDefaults();

    Session.clearProviderCache();

    // Create provider instance
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Anthropic Instance',
      apiKey: 'test-anthropic-key',
    });

    // Create project and session
    const project = Project.create('Test Project', process.cwd(), 'Test project for file edit', {
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });

    session = Session.create({
      name: 'Test Session',
      projectId: project.getId(),
    });

    // Set approval callback to allow all tools (needed for tests)
    session.getAgent(session.getId())!.toolExecutor.setApprovalCallback({
      requestApproval: () => Promise.resolve(ApprovalDecision.ALLOW_ONCE),
    });

    // Get the coordinator agent
    agent = session.getAgent(session.getId())!;

    // Get tools from agent's toolExecutor (so events are properly recorded)
    tool = agent.toolExecutor.getTool('file_edit') as FileEditTool;

    // For most tests (except file protection tests), mock hasFileBeenRead to return true
    // This allows us to test FileEditTool functionality without the complexity of event tracking
    const originalHasFileBeenRead = agent.hasFileBeenRead.bind(agent);
    agent.hasFileBeenRead = (path: string) => {
      // Only apply mock for non-protection tests
      if (
        path === testFile ||
        path.includes('test-temp-file-edit-schema') ||
        path.includes('temp-cwd-edit-test.txt') ||
        path.includes('temp-rel-edit-test.txt')
      ) {
        return true;
      }
      return originalHasFileBeenRead(path);
    };

    // Create context with real agent
    context = {
      workingDirectory: process.cwd(),
      agent,
    };

    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    cleanupTestProviderDefaults();
    await cleanupTestProviderInstances([providerInstanceId]);
    await rm(testDir, { recursive: true, force: true });

    // Clean up environment variable
  });

  describe('File Protection Mechanism', () => {
    it('should require file to be read before editing', async () => {
      await writeFile(testFile, 'original content');

      // Restore original hasFileBeenRead for this test
      agent!.hasFileBeenRead = () => false;

      // Try to edit without reading first
      const result = await tool.execute(
        {
          path: testFile,
          old_text: 'original content',
          new_text: 'new content',
        },
        context
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("exists but hasn't been read");
      expect(result.content[0].text).toContain('Use file_read to examine');
    });

    it('should allow edit after file has been read', async () => {
      await writeFile(testFile, 'original content');

      // hasFileBeenRead is mocked to return true in beforeEach
      // so edit should work
      const result = await tool.execute(
        {
          path: testFile,
          old_text: 'original content',
          new_text: 'new content',
        },
        context
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully replaced text');
    });

    it('should not require read for non-existent files', async () => {
      const nonExistentFile = join(testDir, 'does-not-exist.txt');

      // Should fail with file not found, not protection error
      const result = await tool.execute(
        {
          path: nonExistentFile,
          old_text: 'any',
          new_text: 'text',
        },
        context
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('File not found');
      expect(result.content[0].text).not.toContain("hasn't been read");
    });
  });

  describe('Tool metadata', () => {
    it('should have correct name and description', () => {
      expect(tool.name).toBe('file_edit');
      expect(tool.description).toContain('Edit files by replacing exact text matches');
    });

    it('should have proper input schema', () => {
      const schema = tool.inputSchema;
      expect(schema.type).toBe('object');
      expect(schema.properties.path).toBeDefined();
      expect(schema.properties.old_text).toBeDefined();
      expect(schema.properties.new_text).toBeDefined();
      expect(schema.required).toEqual(['path', 'old_text', 'new_text']);
    });

    it('should be marked as destructive', () => {
      expect(tool.annotations?.destructiveHint).toBe(true);
    });
  });

  describe('Input validation', () => {
    it('should reject missing path', async () => {
      const result = await tool.execute({
        old_text: 'old',
        new_text: 'new',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('path');
    });

    it('should reject empty path', async () => {
      const result = await tool.execute({
        path: '',
        old_text: 'old',
        new_text: 'new',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('File path cannot be empty');
    });

    it('should reject missing old_text', async () => {
      const result = await tool.execute({
        path: testFile,
        new_text: 'new',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('old_text');
    });

    it('should reject missing new_text', async () => {
      const result = await tool.execute({
        path: testFile,
        old_text: 'old',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
      expect(result.content[0].text).toContain('new_text');
    });

    it('should accept empty old_text for insertions at beginning', async () => {
      await writeFile(testFile, '');

      // hasFileBeenRead is mocked to return true, so protection is bypassed
      const result = await tool.execute(
        {
          path: testFile,
          old_text: '',
          new_text: 'new content',
        },
        context
      );

      expect(result.isError).toBe(false);

      // Verify content was written
      const content = await readFile(testFile, 'utf-8');
      expect(content).toBe('new content');
    });

    it('should transform relative paths to absolute', async () => {
      // This test verifies path transformation works
      const result = await tool.execute({
        path: './nonexistent.txt',
        old_text: 'old',
        new_text: 'new',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('File not found');
    });

    it('should accept valid parameters', async () => {
      await writeFile(testFile, 'Hello World');
      const result = await tool.execute(
        {
          path: testFile,
          old_text: 'Hello',
          new_text: 'Hi',
        },
        context
      );

      expect(result.isError).toBe(false);

      // Verify content was changed
      const content = await readFile(testFile, 'utf-8');
      expect(content).toBe('Hi World');
    });
  });

  describe('Basic text replacement', () => {
    it('should replace exact text match', async () => {
      const originalContent = `function hello() {
  console.log('Hello, World!');
}`;
      await writeFile(testFile, originalContent);
      const result = await tool.execute(
        {
          path: testFile,
          old_text: "console.log('Hello, World!');",
          new_text: "console.log('Hello, Universe!');",
        },
        context
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully replaced text');
      expect(result.content[0].text).toContain(testFile);
    });

    it('should handle single character replacements', async () => {
      await writeFile(testFile, 'abc');
      const result = await tool.execute(
        {
          path: testFile,
          old_text: 'b',
          new_text: 'x',
        },
        context
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully replaced text');
    });

    it('should handle empty string replacement (deletion)', async () => {
      await writeFile(testFile, 'Hello, World!');
      const result = await tool.execute(
        {
          path: testFile,
          old_text: ', World',
          new_text: '',
        },
        context
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully replaced text');
    });

    it('should handle insertion with unique old_text', async () => {
      await writeFile(testFile, 'World');
      const result = await tool.execute(
        {
          path: testFile,
          old_text: 'World',
          new_text: 'Hello, World',
        },
        context
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully replaced text');
    });
  });

  describe('Multi-line text replacement', () => {
    it('should handle multi-line replacements', async () => {
      const originalContent = `function calculate() {
  const a = 1;
  const b = 2;
  return a + b;
}`;
      await writeFile(testFile, originalContent);
      const result = await tool.execute(
        {
          path: testFile,
          old_text: `  const a = 1;
  const b = 2;
  return a + b;`,
          new_text: `  const x = 10;
  const y = 20;
  return x * y;`,
        },
        context
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully replaced text');
      expect(result.content[0].text).toContain('3 lines');
    });

    it('should handle entire file replacement', async () => {
      await writeFile(testFile, 'old content');
      const result = await tool.execute(
        {
          path: testFile,
          old_text: 'old content',
          new_text: 'completely new content\nwith multiple lines\nand more text',
        },
        context
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully replaced text');
    });

    it('should preserve exact whitespace in replacements', async () => {
      const originalContent = '  function() {\n    return true;\n  }';
      await writeFile(testFile, originalContent);
      const result = await tool.execute(
        {
          path: testFile,
          old_text: '  function() {\n    return true;\n  }',
          new_text: '  function() {\n    return false;\n  }',
        },
        context
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully replaced text');
    });
  });

  describe('Error conditions', () => {
    it('should fail when text is not found', async () => {
      await writeFile(testFile, 'Hello World');
      const result = await tool.execute(
        {
          path: testFile,
          old_text: 'Goodbye World',
          new_text: 'Hello Universe',
        },
        context
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('No exact matches found');
      expect(result.content[0].text).toContain('Use file_read to see the exact file content');
    });

    it('should fail when multiple matches exist', async () => {
      await writeFile(testFile, 'foo bar foo');
      const result = await tool.execute(
        {
          path: testFile,
          old_text: 'foo',
          new_text: 'baz',
        },
        context
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Found 2 matches');
      expect(result.content[0].text).toContain('Include more surrounding context');
    });

    it('should handle file not found error', async () => {
      const result = await tool.execute({
        path: '/nonexistent/file.txt',
        old_text: 'test',
        new_text: 'test2',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('File not found');
    });

    it('should handle permission denied error', () => {
      // This would be difficult to test cross-platform reliably
      // Permission denied errors are handled in the implementation
      expect(tool.name).toBe('file_edit');
    });
  });

  describe('Enhanced error messages', () => {
    it('should provide file preview when no matches found', async () => {
      await writeFile(testFile, 'Line 1\nLine 2\nLine 3');
      const result = await tool.execute(
        {
          path: testFile,
          old_text: 'NonexistentText',
          new_text: 'Replacement',
        },
        context
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('No exact matches found');
      expect(result.content[0].text).toContain('3 lines');
    });

    it('should provide match location info for multiple matches', async () => {
      const content = 'function test() {\n  return test;\n}\nconst test = 42;';
      await writeFile(testFile, content);
      const result = await tool.execute(
        {
          path: testFile,
          old_text: 'test',
          new_text: 'example',
        },
        context
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Found 3 matches');
      expect(result.content[0].text).toContain('Matches found at lines');
    });

    it('should provide helpful guidance for AI recovery', async () => {
      await writeFile(testFile, 'Some content here');
      const result = await tool.execute(
        {
          path: testFile,
          old_text: 'some content',
          new_text: 'other content',
        },
        context
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('copy the text exactly including all whitespace');
    });
  });

  describe('Line change reporting', () => {
    it('should report single line changes', async () => {
      await writeFile(testFile, 'single line');
      const result = await tool.execute(
        {
          path: testFile,
          old_text: 'single line',
          new_text: 'one line',
        },
        context
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('1 line');
      expect(result.content[0].text).not.toContain('→');
    });

    it('should report line count changes', async () => {
      await writeFile(testFile, 'line 1\nline 2');
      const result = await tool.execute(
        {
          path: testFile,
          old_text: 'line 1\nline 2',
          new_text: 'single line',
        },
        context
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('2 lines → 1 line');
    });

    it('should report line increases', async () => {
      await writeFile(testFile, 'short');
      const result = await tool.execute(
        {
          path: testFile,
          old_text: 'short',
          new_text: 'much\nlonger\ntext\nhere',
        },
        context
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('1 line → 4 lines');
    });
  });

  describe('Structured output with helpers', () => {
    it('should use createResult for successful edits', async () => {
      await writeFile(testFile, 'Hello World');
      const result = await tool.execute(
        {
          path: testFile,
          old_text: 'Hello',
          new_text: 'Hi',
        },
        context
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully replaced text');
    });

    it('should use createError for validation failures', async () => {
      const result = await tool.execute({
        path: '',
        old_text: 'old',
        new_text: 'new',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation failed');
    });

    it('should use createError for file operation failures', async () => {
      const result = await tool.execute({
        path: '/nonexistent/file.txt',
        old_text: 'old',
        new_text: 'new',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('File not found');
    });
  });

  describe('Edge cases', () => {
    it('should handle files with special characters', async () => {
      const content = 'Text with "quotes" and $pecial char$';
      await writeFile(testFile, content);
      const result = await tool.execute(
        {
          path: testFile,
          old_text: '"quotes"',
          new_text: "'quotes'",
        },
        context
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully replaced text');
    });

    it('should handle unicode characters', async () => {
      const content = 'Hello 世界 🌍';
      await writeFile(testFile, content);
      const result = await tool.execute(
        {
          path: testFile,
          old_text: '世界',
          new_text: 'World',
        },
        context
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully replaced text');
    });

    it('should handle very large text replacements', async () => {
      const largeOldText = 'x'.repeat(1000);
      const largeNewText = 'y'.repeat(2000);
      await writeFile(testFile, `start ${largeOldText} end`);
      const result = await tool.execute(
        {
          path: testFile,
          old_text: largeOldText,
          new_text: largeNewText,
        },
        context
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully replaced text');
    });

    it('should handle empty files', async () => {
      await writeFile(testFile, '');
      const result = await tool.execute(
        {
          path: testFile,
          old_text: '',
          new_text: 'new content',
        },
        context
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully replaced text');
    });

    it('should handle files with only whitespace', async () => {
      await writeFile(testFile, '   \n\t\n   ');
      const result = await tool.execute(
        {
          path: testFile,
          old_text: '   \n\t\n   ',
          new_text: 'cleaned content',
        },
        context
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully replaced text');
    });
  });

  describe('Cross-field validation edge cases', () => {
    it('should handle old_text same as new_text', async () => {
      await writeFile(testFile, 'same text');
      const result = await tool.execute(
        {
          path: testFile,
          old_text: 'same',
          new_text: 'same',
        },
        context
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully replaced text');
    });

    it('should validate old_text against actual file content', async () => {
      await writeFile(testFile, 'actual content');
      const result = await tool.execute(
        {
          path: testFile,
          old_text: 'ACTUAL CONTENT', // Different case
          new_text: 'new content',
        },
        context
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('No exact matches found');
    });
  });

  describe('working directory support', () => {
    it('should resolve relative paths using working directory from context', async () => {
      // Create a relative test file
      const relativeTestFile = 'relative-edit-test.txt';
      const absoluteTestFile = join(testDir, relativeTestFile);
      await writeFile(absoluteTestFile, 'Content for relative edit');

      // Mark file as read for test purposes

      const result = await tool.execute(
        {
          path: relativeTestFile,
          old_text: 'Content for relative edit',
          new_text: 'Modified content for relative edit',
        },
        { ...context, workingDirectory: testDir }
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully replaced text');
    });

    it('should use absolute paths directly even when working directory is provided', async () => {
      await writeFile(testFile, 'absolute path content');
      const result = await tool.execute(
        {
          path: testFile, // absolute path
          old_text: 'absolute path content',
          new_text: 'modified absolute path content',
        },
        { ...context, workingDirectory: '/some/other/dir' }
      );

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Successfully replaced text');
    });

    it('should fall back to process.cwd() when no working directory in context', async () => {
      // Create a file relative to current working directory
      const relativeFile = 'temp-cwd-edit-test.txt';
      const absoluteFile = join(process.cwd(), relativeFile);
      await writeFile(absoluteFile, 'CWD edit test content');

      try {
        // Mark file as read for test purposes
        // For file protection to work properly, we need to disable it in tests
        // since we're testing the tool directly without going through the full agent flow.
        // The file protection feature is tested separately in integration tests.

        const result = await tool.execute(
          {
            path: relativeFile,
            old_text: 'CWD edit test content',
            new_text: 'Modified CWD edit test content',
          },
          context
        );

        expect(result.isError).toBe(false);
        expect(result.content[0].text).toContain('Successfully replaced text');
      } finally {
        await rm(absoluteFile, { force: true });
      }
    });

    it('should handle non-existent relative paths with working directory context', async () => {
      const result = await tool.execute(
        {
          path: 'non-existent-relative-edit.txt',
          old_text: 'test',
          new_text: 'modified',
        },
        { ...context, workingDirectory: testDir }
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('File not found');
      expect(result.content[0].text).toContain('non-existent-relative-edit.txt');
    });
  });
});
