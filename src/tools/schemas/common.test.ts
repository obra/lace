// ABOUTME: Tests for common tool schema patterns
// ABOUTME: Validates reusable schema components work correctly

import { describe, it, expect } from 'vitest';
import { NonEmptyString, FilePath, LineNumber, MaxResults, FilePattern } from './common.js';

describe('Common schema patterns', () => {
  describe('NonEmptyString', () => {
    it('accepts non-empty strings', () => {
      expect(NonEmptyString.parse('hello')).toBe('hello');
      expect(NonEmptyString.parse(' spaces are fine ')).toBe(' spaces are fine ');
    });

    it('rejects empty strings', () => {
      expect(() => NonEmptyString.parse('')).toThrow();
    });

    it('rejects null and undefined', () => {
      expect(() => NonEmptyString.parse(null)).toThrow();
      expect(() => NonEmptyString.parse(undefined)).toThrow();
    });

    it('provides helpful error message', () => {
      try {
        NonEmptyString.parse('');
      } catch (error: any) {
        expect(error.issues[0].message).toContain('Cannot be empty');
      }
    });
  });

  describe('FilePath', () => {
    it('normalizes relative paths to absolute', () => {
      const result = FilePath.parse('./test.txt');
      expect(result).toMatch(/^\/.*test\.txt$/);
    });

    it('keeps absolute paths unchanged', () => {
      const absolutePath = '/some/absolute/path.txt';
      const result = FilePath.parse(absolutePath);
      expect(result).toBe(absolutePath);
    });

    it('rejects empty paths', () => {
      expect(() => FilePath.parse('')).toThrow();
    });

    it('handles complex relative paths', () => {
      const result = FilePath.parse('../parent/file.txt');
      expect(result).toMatch(/^\/.*parent\/file\.txt$/);
    });
  });

  describe('LineNumber', () => {
    it('accepts positive integers', () => {
      expect(LineNumber.parse(1)).toBe(1);
      expect(LineNumber.parse(100)).toBe(100);
      expect(LineNumber.parse(999999)).toBe(999999);
    });

    it('rejects zero and negative numbers', () => {
      expect(() => LineNumber.parse(0)).toThrow();
      expect(() => LineNumber.parse(-1)).toThrow();
      expect(() => LineNumber.parse(-100)).toThrow();
    });

    it('rejects non-integers', () => {
      expect(() => LineNumber.parse(1.5)).toThrow();
      expect(() => LineNumber.parse(3.14)).toThrow();
    });

    it('rejects non-numbers', () => {
      expect(() => LineNumber.parse('1')).toThrow();
      expect(() => LineNumber.parse(null)).toThrow();
    });

    it('provides helpful error messages', () => {
      try {
        LineNumber.parse(0);
      } catch (error: any) {
        expect(error.issues[0].message).toContain('Must be positive');
      }

      try {
        LineNumber.parse(1.5);
      } catch (error: any) {
        expect(error.issues[0].message).toContain('Must be an integer');
      }
    });
  });

  describe('MaxResults', () => {
    it('accepts valid range values', () => {
      expect(MaxResults.parse(1)).toBe(1);
      expect(MaxResults.parse(500)).toBe(500);
      expect(MaxResults.parse(1000)).toBe(1000);
    });

    it('uses default value when not provided', () => {
      expect(MaxResults.parse(undefined)).toBe(100);
    });

    it('rejects values outside range', () => {
      expect(() => MaxResults.parse(0)).toThrow();
      expect(() => MaxResults.parse(1001)).toThrow();
      expect(() => MaxResults.parse(-1)).toThrow();
    });

    it('rejects non-integers', () => {
      expect(() => MaxResults.parse(50.5)).toThrow();
    });
  });

  describe('FilePattern', () => {
    it('accepts valid patterns', () => {
      expect(FilePattern.parse('*.js')).toBe('*.js');
      expect(FilePattern.parse('**/*.ts')).toBe('**/*.ts');
      expect(FilePattern.parse('src/components/*.jsx')).toBe('src/components/*.jsx');
    });

    it('rejects empty patterns', () => {
      expect(() => FilePattern.parse('')).toThrow();
    });

    it('provides helpful error message', () => {
      try {
        FilePattern.parse('');
      } catch (error: any) {
        expect(error.issues[0].message).toContain('Pattern cannot be empty');
      }
    });
  });
});
