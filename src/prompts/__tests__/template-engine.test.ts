// ABOUTME: Tests for the PromptTemplateEngine class
// ABOUTME: Covers variable substitution, includes, and error handling

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PromptTemplateEngine } from '../template-engine.js';

describe('PromptTemplateEngine', () => {
  let engine: PromptTemplateEngine;
  let tempDir: string;

  beforeEach(() => {
    engine = new PromptTemplateEngine();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'template-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('variable substitution', () => {
    it('should substitute simple variables', () => {
      const template = 'Hello {{name}}!';
      const variables = { name: 'World' };
      
      const result = engine.render(template, variables);
      expect(result).toBe('Hello World!');
    });

    it('should substitute multiple variables', () => {
      const template = '{{greeting}} {{name}}, today is {{day}}';
      const variables = { 
        greeting: 'Hello',
        name: 'Alice',
        day: 'Monday'
      };
      
      const result = engine.render(template, variables);
      expect(result).toBe('Hello Alice, today is Monday');
    });

    it('should handle dot notation for nested variables', () => {
      const template = 'User: {{user.name}} ({{user.email}})';
      const variables = { 
        'user.name': 'John Doe',
        'user.email': 'john@example.com'
      };
      
      const result = engine.render(template, variables);
      expect(result).toBe('User: John Doe (john@example.com)');
    });

    it('should leave unmatched variables unchanged', () => {
      const template = 'Hello {{name}}, {{unknown}} variable';
      const variables = { name: 'World' };
      
      const result = engine.render(template, variables);
      expect(result).toBe('Hello World, {{unknown}} variable');
    });
  });

  describe('include functionality', () => {
    it('should include external files', () => {
      // Create include file
      const includeFile = path.join(tempDir, 'include.md');
      fs.writeFileSync(includeFile, 'This is included content');
      
      const template = 'Before\n{{include:include.md}}\nAfter';
      
      const result = engine.render(template, {}, tempDir);
      expect(result).toBe('Before\nThis is included content\nAfter');
    });

    it('should handle nested includes', () => {
      // Create nested include files
      const nestedFile = path.join(tempDir, 'nested.md');
      fs.writeFileSync(nestedFile, 'Nested content');
      
      const includeFile = path.join(tempDir, 'include.md');
      fs.writeFileSync(includeFile, 'Before nested\n{{include:nested.md}}\nAfter nested');
      
      const template = 'Main\n{{include:include.md}}\nEnd';
      
      const result = engine.render(template, {}, tempDir);
      expect(result).toBe('Main\nBefore nested\nNested content\nAfter nested\nEnd');
    });

    it('should detect circular includes', () => {
      // Create circular include files
      const file1 = path.join(tempDir, 'file1.md');
      const file2 = path.join(tempDir, 'file2.md');
      
      fs.writeFileSync(file1, 'File 1\n{{include:file2.md}}');
      fs.writeFileSync(file2, 'File 2\n{{include:file1.md}}');
      
      const template = '{{include:file1.md}}';
      
      expect(() => {
        engine.render(template, {}, tempDir);
      }).toThrow(/circular include/i);
    });

    it('should throw error for missing include files', () => {
      const template = '{{include:missing.md}}';
      
      expect(() => {
        engine.render(template, {}, tempDir);
      }).toThrow(/include file not found/i);
    });
  });

  describe('combined functionality', () => {
    it('should handle variables in included files', () => {
      // Create include file with variables
      const includeFile = path.join(tempDir, 'include.md');
      fs.writeFileSync(includeFile, 'Hello {{name}} from include');
      
      const template = 'Main: {{include:include.md}}';
      const variables = { name: 'World' };
      
      const result = engine.render(template, variables, tempDir);
      expect(result).toBe('Main: Hello World from include');
    });

    it('should process includes before variables', () => {
      // Create include file
      const includeFile = path.join(tempDir, 'include.md');
      fs.writeFileSync(includeFile, '{{message}}');
      
      const template = 'Result: {{include:include.md}}';
      const variables = { message: 'Hello from variable' };
      
      const result = engine.render(template, variables, tempDir);
      expect(result).toBe('Result: Hello from variable');
    });
  });

  describe('cache management', () => {
    it('should cache included files', () => {
      // Create include file
      const includeFile = path.join(tempDir, 'cached.md');
      fs.writeFileSync(includeFile, 'Original content');
      
      const template = '{{include:cached.md}}';
      
      // First render
      const result1 = engine.render(template, {}, tempDir);
      expect(result1).toBe('Original content');
      
      // Modify file (should still use cached version)
      fs.writeFileSync(includeFile, 'Modified content');
      
      const result2 = engine.render(template, {}, tempDir);
      expect(result2).toBe('Original content'); // Still cached
      
      // Clear cache and re-render
      engine.clearCache();
      const result3 = engine.render(template, {}, tempDir);
      expect(result3).toBe('Modified content'); // Now updated
    });
  });
});