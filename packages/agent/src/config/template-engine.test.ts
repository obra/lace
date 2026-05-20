// ABOUTME: Tests for mustache template engine with @path include functionality
// ABOUTME: Tests variable substitution, @path expansion, error handling, and recursion protection

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TemplateEngine } from './template-engine';

describe('TemplateEngine', () => {
  let tempDir: string;
  let templateEngine: TemplateEngine;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'template-test-'));
    templateEngine = new TemplateEngine([tempDir]);
  });

  afterEach(() => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('variable substitution', () => {
    it('should render simple variables', () => {
      const templatePath = path.join(tempDir, 'simple.md');
      fs.writeFileSync(templatePath, 'Hello {{name}}!');

      const result = templateEngine.render('simple.md', { name: 'World' });

      expect(result).toBe('Hello World!');
    });

    it('should render object properties with dot notation', () => {
      const templatePath = path.join(tempDir, 'object.md');
      fs.writeFileSync(templatePath, 'User: {{user.name}} <{{user.email}}>');

      const result = templateEngine.render('object.md', {
        user: { name: 'John Doe', email: 'john@example.com' },
      });

      expect(result).toBe('User: John Doe <john@example.com>');
    });

    it('should handle missing variables gracefully', () => {
      const templatePath = path.join(tempDir, 'missing.md');
      fs.writeFileSync(templatePath, 'Hello {{missing}}!');

      const result = templateEngine.render('missing.md', {});

      expect(result).toBe('Hello !');
    });

    it('should handle array rendering with mustache sections', () => {
      const templatePath = path.join(tempDir, 'array.md');
      fs.writeFileSync(templatePath, '{{#items}}- {{name}}\n{{/items}}');

      const result = templateEngine.render('array.md', {
        items: [{ name: 'Item 1' }, { name: 'Item 2' }],
      });

      expect(result).toBe('- Item 1\n- Item 2\n');
    });

    it('should handle conditional sections', () => {
      const templatePath = path.join(tempDir, 'conditional.md');
      fs.writeFileSync(
        templatePath,
        '{{#isVisible}}This is visible{{/isVisible}}{{^isVisible}}This is hidden{{/isVisible}}'
      );

      const visibleResult = templateEngine.render('conditional.md', { isVisible: true });
      const hiddenResult = templateEngine.render('conditional.md', { isVisible: false });

      expect(visibleResult).toBe('This is visible');
      expect(hiddenResult).toBe('This is hidden');
    });
  });

  describe('include functionality', () => {
    it('should process simple includes', () => {
      // Create included file
      const includePath = path.join(tempDir, 'header.md');
      fs.writeFileSync(includePath, '# Header\n\nThis is included content.');

      // Create main template
      const templatePath = path.join(tempDir, 'main.md');
      fs.writeFileSync(templatePath, '@header.md\n\nMain content here.');

      const result = templateEngine.render('main.md', {});

      expect(result).toBe('# Header\n\nThis is included content.\n\nMain content here.');
    });

    it('should process includes with variables', () => {
      // Create included file with variables
      const includePath = path.join(tempDir, 'greeting.md');
      fs.writeFileSync(includePath, 'Hello {{name}}!');

      // Create main template
      const templatePath = path.join(tempDir, 'main.md');
      fs.writeFileSync(templatePath, '@greeting.md');

      const result = templateEngine.render('main.md', { name: 'Alice' });

      expect(result).toBe('Hello Alice!');
    });

    it('should handle nested includes', () => {
      // Create deeply nested includes
      const level2Path = path.join(tempDir, 'level2.md');
      fs.writeFileSync(level2Path, 'Level 2 content');

      const level1Path = path.join(tempDir, 'level1.md');
      fs.writeFileSync(level1Path, 'Level 1: @level2.md');

      const mainPath = path.join(tempDir, 'main.md');
      fs.writeFileSync(mainPath, 'Main: @level1.md');

      const result = templateEngine.render('main.md', {});

      expect(result).toBe('Main: Level 1: Level 2 content');
    });

    it('should handle includes in subdirectories', () => {
      // Create subdirectory structure
      const subDir = path.join(tempDir, 'sections');
      fs.mkdirSync(subDir);

      const includePath = path.join(subDir, 'footer.md');
      fs.writeFileSync(includePath, 'Footer content');

      const templatePath = path.join(tempDir, 'main.md');
      fs.writeFileSync(templatePath, 'Main content\n@sections/footer.md');

      const result = templateEngine.render('main.md', {});

      expect(result).toBe('Main content\nFooter content');
    });

    it('should prevent circular includes', () => {
      // Create circular include
      const file1Path = path.join(tempDir, 'file1.md');
      fs.writeFileSync(file1Path, 'File 1: @file2.md');

      const file2Path = path.join(tempDir, 'file2.md');
      fs.writeFileSync(file2Path, 'File 2: @file1.md');

      const result = templateEngine.render('file1.md', {});

      expect(result).toContain('File 1: File 2: File 1: <!-- Circular include:');
      expect(result).toContain('file2.md -->');
    });

    it('should leave the original @path text in place when the include file is missing', () => {
      const templatePath = path.join(tempDir, 'main.md');
      fs.writeFileSync(templatePath, 'Before @missing.md After');

      const result = templateEngine.render('main.md', {});

      expect(result).toBe('Before @missing.md After');
    });

    it('should leave bare @username mentions in prose untouched', () => {
      const templatePath = path.join(tempDir, 'main.md');
      fs.writeFileSync(templatePath, 'Hi @alice and @bob, see @sections/footer.md');
      const subDir = path.join(tempDir, 'sections');
      fs.mkdirSync(subDir);
      fs.writeFileSync(path.join(subDir, 'footer.md'), 'shared footer');

      const result = templateEngine.render('main.md', {});

      expect(result).toBe('Hi @alice and @bob, see shared footer');
    });

    it('should leave email addresses untouched', () => {
      // The `@` in `name@example.com` is preceded by a non-whitespace char,
      // so it must not be treated as a path reference.
      const templatePath = path.join(tempDir, 'main.md');
      fs.writeFileSync(templatePath, "email: 'test@example.com'");

      const result = templateEngine.render('main.md', {});

      expect(result).toBe("email: 'test@example.com'");
    });

    it('should expand mustache variables that appear inside an included file', () => {
      const includePath = path.join(tempDir, 'greeting.md');
      fs.writeFileSync(includePath, 'Hello {{name}}!');

      const templatePath = path.join(tempDir, 'main.md');
      fs.writeFileSync(templatePath, '@greeting.md');

      const result = templateEngine.render('main.md', { name: 'Alice' });

      expect(result).toBe('Hello Alice!');
    });

    it('should no longer process {{include:...}} as a directive', () => {
      // Sanity: the legacy mustache-style include syntax must be inert. Mustache
      // will treat `include:foo.md` as a missing variable and render empty, so
      // the produced bytes must not contain the included file contents.
      const includePath = path.join(tempDir, 'header.md');
      fs.writeFileSync(includePath, 'INCLUDED HEADER CONTENT');

      const templatePath = path.join(tempDir, 'main.md');
      fs.writeFileSync(templatePath, '{{include:header.md}}\nrest');

      const result = templateEngine.render('main.md', {});

      expect(result).not.toContain('INCLUDED HEADER CONTENT');
    });
  });

  describe('error handling', () => {
    it('should return fallback content when template file is missing', () => {
      const result = templateEngine.render('nonexistent.md', {});

      expect(result).toBe(
        'You are Lace, an AI coding assistant. Use the available tools to help with programming tasks.'
      );
    });

    it('should handle template with syntax errors gracefully', () => {
      const templatePath = path.join(tempDir, 'broken.md');
      fs.writeFileSync(templatePath, 'Hello {{#broken}} {{/different}}');

      const result = templateEngine.render('broken.md', {});

      // Should return fallback content on mustache syntax errors
      expect(result).toBe(
        'You are Lace, an AI coding assistant. Use the available tools to help with programming tasks.'
      );
    });

    it('should handle permission errors on include files', () => {
      const includePath = path.join(tempDir, 'protected.md');
      fs.writeFileSync(includePath, 'Protected content');
      fs.chmodSync(includePath, 0o000); // Remove all permissions

      const templatePath = path.join(tempDir, 'main.md');
      fs.writeFileSync(templatePath, '@protected.md');

      try {
        const result = templateEngine.render('main.md', {});
        expect(result).toContain('<!-- Include error: protected.md -->');
      } finally {
        // Restore permissions for cleanup
        fs.chmodSync(includePath, 0o644);
      }
    });
  });

  describe('complex scenarios', () => {
    it('should handle template with multiple includes and variables', () => {
      // Create header
      const headerPath = path.join(tempDir, 'header.md');
      fs.writeFileSync(headerPath, '# {{title}}\n\nWelcome {{user.name}}!');

      // Create footer
      const footerPath = path.join(tempDir, 'footer.md');
      fs.writeFileSync(footerPath, '\n---\n{{year}} {{company}}');

      // Create main template
      const mainPath = path.join(tempDir, 'main.md');
      fs.writeFileSync(mainPath, '@header.md\n\nMain content here.\n\n@footer.md');

      const result = templateEngine.render('main.md', {
        title: 'My App',
        user: { name: 'John' },
        year: 2024,
        company: 'Acme Corp',
      });

      expect(result).toBe(
        '# My App\n\nWelcome John!\n\nMain content here.\n\n\n---\n2024 Acme Corp'
      );
    });

    it('should handle empty template files', () => {
      const templatePath = path.join(tempDir, 'empty.md');
      fs.writeFileSync(templatePath, '');

      const result = templateEngine.render('empty.md', { name: 'test' });

      expect(result).toBe('');
    });

    it('should handle whitespace-only template files', () => {
      const templatePath = path.join(tempDir, 'whitespace.md');
      fs.writeFileSync(templatePath, '   \n\t\r\n   ');

      const result = templateEngine.render('whitespace.md', { name: 'test' });

      expect(result).toBe('   \n\t\r\n   ');
    });
  });

  describe('multiple template directories', () => {
    let secondTempDir: string;
    let multiDirEngine: TemplateEngine;

    beforeEach(() => {
      secondTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'template-test-2-'));
      multiDirEngine = new TemplateEngine([tempDir, secondTempDir]);
    });

    afterEach(() => {
      if (fs.existsSync(secondTempDir)) {
        fs.rmSync(secondTempDir, { recursive: true, force: true });
      }
    });

    it('should prioritize first directory in array', () => {
      // Create same template in both directories
      fs.writeFileSync(path.join(tempDir, 'priority.md'), 'First directory: {{name}}');
      fs.writeFileSync(path.join(secondTempDir, 'priority.md'), 'Second directory: {{name}}');

      const result = multiDirEngine.render('priority.md', { name: 'test' });

      expect(result).toBe('First directory: test');
    });

    it('should fall back to second directory when file not in first', () => {
      // Only create template in second directory
      fs.writeFileSync(path.join(secondTempDir, 'fallback.md'), 'Fallback: {{name}}');

      const result = multiDirEngine.render('fallback.md', { name: 'test' });

      expect(result).toBe('Fallback: test');
    });

    it('should handle includes across multiple directories', () => {
      // Create main template in first directory
      fs.writeFileSync(path.join(tempDir, 'main.md'), 'Main: @shared.md');

      // Create include file only in second directory
      fs.writeFileSync(path.join(secondTempDir, 'shared.md'), 'Shared content: {{name}}');

      const result = multiDirEngine.render('main.md', { name: 'test' });

      expect(result).toBe('Main: Shared content: test');
    });

    it('should prioritize includes from first directory', () => {
      // Create main template
      fs.writeFileSync(path.join(tempDir, 'main.md'), 'Main: @shared.md');

      // Create include file in both directories
      fs.writeFileSync(path.join(tempDir, 'shared.md'), 'First: {{name}}');
      fs.writeFileSync(path.join(secondTempDir, 'shared.md'), 'Second: {{name}}');

      const result = multiDirEngine.render('main.md', { name: 'test' });

      expect(result).toBe('Main: First: test');
    });
  });
});
