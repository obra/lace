// ABOUTME: Tests for template engine with mustache variable substitution and includes

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TemplateEngine } from '../template-engine.js';

describe('TemplateEngine', () => {
  let tempDir: string;
  let templateEngine: TemplateEngine;

  beforeEach(() => {
    // Create temporary directory for test templates
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lace-template-test-'));
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

    it('should render nested object variables', () => {
      const templatePath = path.join(tempDir, 'nested.md');
      fs.writeFileSync(templatePath, 'OS: {{system.os}}, User: {{user.name}}');

      const result = templateEngine.render('nested.md', {
        system: { os: 'linux' },
        user: { name: 'test-user' }
      });
      expect(result).toBe('OS: linux, User: test-user');
    });

    it('should handle missing variables gracefully', () => {
      const templatePath = path.join(tempDir, 'missing.md');
      fs.writeFileSync(templatePath, 'Hello {{missing}}!');

      const result = templateEngine.render('missing.md', {});
      expect(result).toBe('Hello !');
    });

    it('should handle conditional sections', () => {
      const templatePath = path.join(tempDir, 'conditional.md');
      fs.writeFileSync(templatePath, `{{#hasTools}}Tools available{{/hasTools}}{{^hasTools}}No tools{{/hasTools}}`);

      const withTools = templateEngine.render('conditional.md', { hasTools: true });
      expect(withTools).toBe('Tools available');

      const withoutTools = templateEngine.render('conditional.md', { hasTools: false });
      expect(withoutTools).toBe('No tools');
    });

    it('should handle array iteration', () => {
      const templatePath = path.join(tempDir, 'array.md');
      fs.writeFileSync(templatePath, `{{#tools}}Tool: {{name}}\n{{/tools}}`);

      const result = templateEngine.render('array.md', {
        tools: [
          { name: 'bash' },
          { name: 'git' }
        ]
      });
      expect(result).toBe('Tool: bash\nTool: git\n');
    });
  });

  describe('include functionality', () => {
    it('should process simple includes', () => {
      const mainPath = path.join(tempDir, 'main.md');
      const includePath = path.join(tempDir, 'include.md');
      
      fs.writeFileSync(mainPath, 'Header\n{{include:include.md}}\nFooter');
      fs.writeFileSync(includePath, 'Included content');

      const result = templateEngine.render('main.md', {});
      expect(result).toBe('Header\nIncluded content\nFooter');
    });

    it('should process includes with variables', () => {
      const mainPath = path.join(tempDir, 'main.md');
      const includePath = path.join(tempDir, 'include.md');
      
      fs.writeFileSync(mainPath, 'Hello {{include:include.md}}');
      fs.writeFileSync(includePath, '{{name}}!');

      const result = templateEngine.render('main.md', { name: 'World' });
      expect(result).toBe('Hello World!');
    });

    it('should handle nested includes', () => {
      const mainPath = path.join(tempDir, 'main.md');
      const level1Path = path.join(tempDir, 'level1.md');
      const level2Path = path.join(tempDir, 'level2.md');
      
      fs.writeFileSync(mainPath, 'Main {{include:level1.md}}');
      fs.writeFileSync(level1Path, 'Level1 {{include:level2.md}}');
      fs.writeFileSync(level2Path, 'Level2');

      const result = templateEngine.render('main.md', {});
      expect(result).toBe('Main Level1 Level2');
    });

    it('should handle includes in subdirectories', () => {
      const sectionsDir = path.join(tempDir, 'sections');
      fs.mkdirSync(sectionsDir);

      const mainPath = path.join(tempDir, 'main.md');
      const sectionPath = path.join(sectionsDir, 'section.md');
      
      fs.writeFileSync(mainPath, 'Main\n{{include:sections/section.md}}');
      fs.writeFileSync(sectionPath, 'Section content');

      const result = templateEngine.render('main.md', {});
      expect(result).toBe('Main\nSection content');
    });

    it('should prevent circular includes', () => {
      const file1Path = path.join(tempDir, 'file1.md');
      const file2Path = path.join(tempDir, 'file2.md');
      
      fs.writeFileSync(file1Path, 'File1 {{include:file2.md}}');
      fs.writeFileSync(file2Path, 'File2 {{include:file1.md}}');

      const result = templateEngine.render('file1.md', {});
      // Should not hang and should gracefully handle the circular reference
      expect(result).toBe('File1 File2 ');
    });

    it('should handle missing include files gracefully', () => {
      const mainPath = path.join(tempDir, 'main.md');
      fs.writeFileSync(mainPath, 'Before {{include:missing.md}} After');

      const result = templateEngine.render('main.md', {});
      expect(result).toBe('Before  After');
    });
  });

  describe('error handling', () => {
    it('should handle missing template files', () => {
      const result = templateEngine.render('nonexistent.md', {});
      expect(result).toBe('');
    });

    it('should handle template with invalid mustache syntax', () => {
      const templatePath = path.join(tempDir, 'invalid.md');
      fs.writeFileSync(templatePath, 'Invalid {{#unclosed');

      const result = templateEngine.render('invalid.md', {});
      // Should not throw an error, might return empty or partial content
      expect(typeof result).toBe('string');
    });

    it('should handle absolute template paths', () => {
      const templatePath = path.join(tempDir, 'absolute.md');
      fs.writeFileSync(templatePath, 'Absolute path template');

      const result = templateEngine.render(templatePath, {});
      expect(result).toBe('Absolute path template');
    });
  });
});