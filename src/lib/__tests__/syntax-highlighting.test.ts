// ABOUTME: Comprehensive tests for the syntax highlighting service
// ABOUTME: Tests language detection, highlighting, caching, and performance

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { syntaxHighlighting } from '../syntax-highlighting';
import { clearHighlightCache } from '../performance-utils';

// Mock highlight.js
vi.mock('highlight.js/lib/core', () => ({
  default: {
    registerLanguage: vi.fn(),
    highlight: vi.fn((code: string, options: any) => ({
      value: `<span class="hljs-string">${code}</span>`,
      language: options.language,
    })),
    highlightAuto: vi.fn((code: string) => ({
      value: `<span class="hljs-auto">${code}</span>`,
      language: 'javascript',
    })),
  },
}));

describe('SyntaxHighlightingService', () => {
  beforeEach(() => {
    clearHighlightCache();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize the service', async () => {
      await syntaxHighlighting.initialize();
      expect(syntaxHighlighting.getSupportedLanguages()).toContain('javascript');
      expect(syntaxHighlighting.getSupportedLanguages()).toContain('python');
      expect(syntaxHighlighting.getSupportedLanguages()).toContain('typescript');
    });

    it('should not initialize twice', async () => {
      await syntaxHighlighting.initialize();
      await syntaxHighlighting.initialize(); // Should not throw
    });
  });

  describe('language detection', () => {
    it('should detect JavaScript from code patterns', () => {
      const jsCode = 'const x = 42; console.log(x);';
      const language = syntaxHighlighting.detectLanguage(jsCode);
      expect(language).toBe('javascript');
    });

    it('should detect Python from code patterns', () => {
      const pythonCode = 'def hello_world():\n    print("Hello, world!")';
      const language = syntaxHighlighting.detectLanguage(pythonCode);
      expect(language).toBe('python');
    });

    it('should detect language from filename extension', () => {
      const code = 'some code';
      const language = syntaxHighlighting.detectLanguage(code, 'script.py');
      expect(language).toBe('python');
    });

    it('should handle unknown file extensions', () => {
      const code = 'some code';
      const language = syntaxHighlighting.detectLanguage(code, 'unknown.xyz');
      expect(language).toBe('plaintext');
    });

    it('should detect JSON from code structure', () => {
      const jsonCode = '{"name": "test", "value": 42}';
      const language = syntaxHighlighting.detectLanguage(jsonCode);
      expect(language).toBe('json');
    });

    it('should detect bash from shebang', () => {
      const bashCode = '#!/bin/bash\necho "Hello"';
      const language = syntaxHighlighting.detectLanguage(bashCode);
      expect(language).toBe('bash');
    });
  });

  describe('language normalization', () => {
    it('should normalize language aliases', () => {
      expect(syntaxHighlighting.isLanguageSupported('js')).toBe(true);
      expect(syntaxHighlighting.isLanguageSupported('py')).toBe(true);
      expect(syntaxHighlighting.isLanguageSupported('ts')).toBe(true);
    });

    it('should handle case insensitive languages', () => {
      expect(syntaxHighlighting.isLanguageSupported('JavaScript')).toBe(true);
      expect(syntaxHighlighting.isLanguageSupported('PYTHON')).toBe(true);
    });

    it('should identify unsupported languages', () => {
      expect(syntaxHighlighting.isLanguageSupported('nonexistent')).toBe(false);
    });
  });

  describe('code highlighting', () => {
    beforeEach(async () => {
      await syntaxHighlighting.initialize();
    });

    it('should highlight JavaScript code', async () => {
      const code = 'const x = 42;';
      const result = await syntaxHighlighting.highlightCode(code, 'javascript');
      
      expect(result.success).toBe(true);
      expect(result.language).toBe('javascript');
      expect(result.highlighted).toContain('<span class="hljs-string">');
    });

    it('should handle empty code', async () => {
      const result = await syntaxHighlighting.highlightCode('');
      
      expect(result.success).toBe(true);
      expect(result.language).toBe('plaintext');
      expect(result.highlighted).toBe('');
    });

    it('should handle plaintext without highlighting', async () => {
      const code = 'plain text content';
      const result = await syntaxHighlighting.highlightCode(code, 'plaintext');
      
      expect(result.success).toBe(true);
      expect(result.language).toBe('plaintext');
      expect(result.highlighted).toBe(code);
    });

    it('should auto-detect language when not specified', async () => {
      const code = 'console.log("Hello, world!");';
      const result = await syntaxHighlighting.highlightCode(code);
      
      expect(result.success).toBe(true);
      expect(result.language).toBe('javascript');
    });

    it('should format JSON code', async () => {
      const code = '{"name":"test","value":42}';
      const result = await syntaxHighlighting.highlightCode(code, 'json');
      
      expect(result.success).toBe(true);
      expect(result.language).toBe('json');
      expect(result.highlighted).toContain('{\n  "name": "test",\n  "value": 42\n}');
    });

    it('should handle malformed JSON gracefully', async () => {
      const code = '{invalid json';
      const result = await syntaxHighlighting.highlightCode(code, 'json');
      
      expect(result.success).toBe(true);
      expect(result.highlighted).toBe(code); // Should keep original
    });

    it('should use filename for language detection', async () => {
      const code = 'print("Hello")';
      const result = await syntaxHighlighting.highlightCode(code, undefined, 'script.py');
      
      expect(result.success).toBe(true);
      expect(result.language).toBe('python');
    });
  });

  describe('large code handling', () => {
    beforeEach(async () => {
      await syntaxHighlighting.initialize();
    });

    it('should handle large code blocks', async () => {
      const largeCode = 'console.log("test");'.repeat(10000);
      const result = await syntaxHighlighting.highlightCode(largeCode, 'javascript');
      
      expect(result.success).toBe(false); // Should fall back to plaintext
      expect(result.language).toBe('plaintext');
    });

    it('should use chunk processing for large code', async () => {
      const largeCode = 'console.log("test");'.repeat(10000);
      const result = await syntaxHighlighting.highlightLargeCode(largeCode, 'javascript');
      
      expect(result.success).toBe(true);
      expect(result.language).toBe('javascript');
    });
  });

  describe('error handling', () => {
    beforeEach(async () => {
      await syntaxHighlighting.initialize();
    });

    it('should handle unsupported language gracefully', async () => {
      const code = 'some code';
      const result = await syntaxHighlighting.highlightCode(code, 'unsupported');
      
      expect(result.success).toBe(false);
      expect(result.language).toBe('plaintext');
      expect(result.highlighted).toBe(code);
    });

    it('should fallback to auto-detection on highlighting failure', async () => {
      // Mock highlight.js to throw an error
      const hljs = await import('highlight.js/lib/core');
      const originalHighlight = hljs.default.highlight;
      hljs.default.highlight = vi.fn().mockImplementation(() => {
        throw new Error('Highlighting failed');
      });

      const code = 'console.log("test");';
      const result = await syntaxHighlighting.highlightCode(code, 'javascript');
      
      expect(result.success).toBe(true);
      expect(result.language).toBe('javascript');
      expect(result.highlighted).toContain('<span class="hljs-auto">');

      // Restore original function
      hljs.default.highlight = originalHighlight;
    });
  });

  describe('language information', () => {
    it('should return language information', () => {
      const info = syntaxHighlighting.getLanguageInfo('javascript');
      
      expect(info.name).toBe('javascript');
      expect(info.aliases).toContain('js');
    });

    it('should handle language aliases in info', () => {
      const info = syntaxHighlighting.getLanguageInfo('js');
      
      expect(info.name).toBe('javascript');
      expect(info.aliases).toContain('js');
    });
  });

  describe('supported languages', () => {
    it('should return list of supported languages', () => {
      const languages = syntaxHighlighting.getSupportedLanguages();
      
      expect(languages).toContain('javascript');
      expect(languages).toContain('python');
      expect(languages).toContain('typescript');
      expect(languages).toContain('bash');
      expect(languages).toContain('json');
      expect(languages).toContain('css');
      expect(languages).toContain('html');
    });

    it('should have reasonable number of supported languages', () => {
      const languages = syntaxHighlighting.getSupportedLanguages();
      expect(languages.length).toBeGreaterThan(20);
    });
  });
});