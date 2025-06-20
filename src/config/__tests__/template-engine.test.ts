// ABOUTME: Tests for mustache template engine with include functionality
// ABOUTME: Tests variable substitution, includes, error handling, and recursion protection

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TemplateEngine } from '../template-engine.js';

describe('TemplateEngine', () => {
  let tempDir: string;
  let templateEngine: TemplateEngine;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'template-test-'));
    templateEngine = new TemplateEngine(tempDir);
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
        user: { name: 'John Doe', email: 'john@example.com' }
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
        items: [{ name: 'Item 1' }, { name: 'Item 2' }]
      });

      expect(result).toBe('- Item 1\n- Item 2\n');
    });

    it('should handle conditional sections', () => {
      const templatePath = path.join(tempDir, 'conditional.md');
      fs.writeFileSync(templatePath, '{{#isVisible}}This is visible{{/isVisible}}{{^isVisible}}This is hidden{{/isVisible}}');

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
      fs.writeFileSync(templatePath, '{{include:header.md}}\n\nMain content here.');

      const result = templateEngine.render('main.md', {});

      expect(result).toBe('# Header\n\nThis is included content.\n\nMain content here.');
    });

    it('should process includes with variables', () => {
      // Create included file with variables
      const includePath = path.join(tempDir, 'greeting.md');
      fs.writeFileSync(includePath, 'Hello {{name}}!');

      // Create main template
      const templatePath = path.join(tempDir, 'main.md');
      fs.writeFileSync(templatePath, '{{include:greeting.md}}');

      const result = templateEngine.render('main.md', { name: 'Alice' });

      expect(result).toBe('Hello Alice!');
    });

    it('should handle nested includes', () => {
      // Create deeply nested includes
      const level2Path = path.join(tempDir, 'level2.md');
      fs.writeFileSync(level2Path, 'Level 2 content');

      const level1Path = path.join(tempDir, 'level1.md');
      fs.writeFileSync(level1Path, 'Level 1: {{include:level2.md}}');

      const mainPath = path.join(tempDir, 'main.md');
      fs.writeFileSync(mainPath, 'Main: {{include:level1.md}}');

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
      fs.writeFileSync(templatePath, 'Main content\n{{include:sections/footer.md}}');

      const result = templateEngine.render('main.md', {});

      expect(result).toBe('Main content\nFooter content');
    });

    it('should prevent circular includes', () => {
      // Create circular include
      const file1Path = path.join(tempDir, 'file1.md');
      fs.writeFileSync(file1Path, 'File 1: {{include:file2.md}}');

      const file2Path = path.join(tempDir, 'file2.md');
      fs.writeFileSync(file2Path, 'File 2: {{include:file1.md}}');

      const result = templateEngine.render('file1.md', {});

      expect(result).toContain('File 1: File 2: <!-- Circular include:');
      expect(result).toContain('file1.md -->');
    });

    it('should handle missing include files gracefully', () => {
      const templatePath = path.join(tempDir, 'main.md');
      fs.writeFileSync(templatePath, 'Before {{include:missing.md}} After');

      const result = templateEngine.render('main.md', {});

      expect(result).toBe('Before <!-- Include not found: missing.md --> After');
    });
  });

  describe('error handling', () => {
    it('should return fallback content when template file is missing', () => {
      const result = templateEngine.render('nonexistent.md', {});

      expect(result).toBe('You are a coding assistant. Use the available tools to help with programming tasks.');
    });

    it('should handle template with syntax errors gracefully', () => {
      const templatePath = path.join(tempDir, 'broken.md');
      fs.writeFileSync(templatePath, 'Hello {{#broken}} {{/different}}');

      const result = templateEngine.render('broken.md', {});

      // Should return fallback content on mustache syntax errors
      expect(result).toBe('You are a coding assistant. Use the available tools to help with programming tasks.');
    });

    it('should handle permission errors on include files', () => {
      const includePath = path.join(tempDir, 'protected.md');
      fs.writeFileSync(includePath, 'Protected content');
      fs.chmodSync(includePath, 0o000); // Remove all permissions

      const templatePath = path.join(tempDir, 'main.md');
      fs.writeFileSync(templatePath, '{{include:protected.md}}');

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
      fs.writeFileSync(mainPath, '{{include:header.md}}\n\nMain content here.\n\n{{include:footer.md}}');

      const result = templateEngine.render('main.md', {
        title: 'My App',
        user: { name: 'John' },
        year: 2024,
        company: 'Acme Corp'
      });

      expect(result).toBe('# My App\n\nWelcome John!\n\nMain content here.\n\n\n---\n2024 Acme Corp');
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
});