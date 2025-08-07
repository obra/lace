// ABOUTME: Tests for file suggestions utility
// ABOUTME: Validates misspelling detection and fuzzy matching accuracy

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { findSimilarPaths } from '~/tools/utils/file-suggestions';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { createTestTempDir } from '~/test-utils/temp-directory';

describe('File suggestions utility', () => {
  const tempDir = createTestTempDir();
  let testDir: string;

  beforeEach(async () => {
    testDir = await tempDir.getPath();

    // Create a variety of test files that simulate real-world scenarios
    const testFiles = [
      'test.txt',
      'test-file.js',
      'test_data.csv',
      'testing.md',
      'readme.md',
      'README.MD',
      'package.json',
      'src-main.ts',
      'src_utils.ts',
      'component.tsx',
      'styles.css',
      'index.html',
    ];

    for (const fileName of testFiles) {
      await writeFile(join(testDir, fileName), `content of ${fileName}`);
    }
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  describe('misspelling detection', () => {
    it('catches single character typos', async () => {
      const suggestions = await findSimilarPaths(join(testDir, 'tset.txt')); // 'test' misspelled

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]).toContain('test.txt');
    });

    it('catches transposed characters', async () => {
      const suggestions = await findSimilarPaths(join(testDir, 'tets.txt')); // 'test' transposed

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0]).toContain('test.txt');
    });

    it('catches missing characters', async () => {
      const suggestions = await findSimilarPaths(join(testDir, 'tes.txt')); // missing 't'

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0]).toContain('test.txt');
    });

    it('catches extra characters', async () => {
      const suggestions = await findSimilarPaths(join(testDir, 'testt.txt')); // extra 't'

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0]).toContain('test.txt');
    });

    it('handles wrong extensions', async () => {
      const suggestions = await findSimilarPaths(join(testDir, 'test.js')); // wrong extension

      expect(suggestions.length).toBeGreaterThan(0);
      // Should suggest files with similar names, prioritizing same extension if available
      expect(suggestions.some((s) => s.includes('test'))).toBe(true);
    });
  });

  describe('case sensitivity', () => {
    it('suggests files with different cases', async () => {
      const suggestions = await findSimilarPaths(join(testDir, 'readme.txt')); // wrong extension

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.some((s) => s.includes('readme.md') || s.includes('README.MD'))).toBe(
        true
      );
    });

    it('handles completely wrong case', async () => {
      const suggestions = await findSimilarPaths(join(testDir, 'PACKAGE.JSON'));

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0]).toContain('package.json');
    });
  });

  describe('separator handling', () => {
    it('suggests files with different separators', async () => {
      const suggestions = await findSimilarPaths(join(testDir, 'test_file.js')); // underscore vs dash

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.some((s) => s.includes('test-file.js'))).toBe(true);
    });

    it('handles mixed separators', async () => {
      const suggestions = await findSimilarPaths(join(testDir, 'src.main.ts')); // dot vs dash

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.some((s) => s.includes('src-main.ts'))).toBe(true);
    });
  });

  describe('ranking and limits', () => {
    it('returns closest matches first', async () => {
      const suggestions = await findSimilarPaths(join(testDir, 'test.js'));

      expect(suggestions.length).toBeGreaterThan(0);
      // First suggestion should be most similar
      const firstSuggestion = suggestions[0];
      expect(firstSuggestion).toContain('test');
    });

    it('respects maxSuggestions limit', async () => {
      const suggestions = await findSimilarPaths(join(testDir, 'test.xyz'), 2);

      expect(suggestions.length).toBeLessThanOrEqual(2);
    });

    it('filters out very dissimilar files', async () => {
      const suggestions = await findSimilarPaths(join(testDir, 'completely-different-name.abc'));

      // Should not suggest files that are very different
      // (though might suggest some if directory has few files)
      expect(suggestions.length).toBeLessThan(5);
    });
  });

  describe('edge cases', () => {
    it('handles non-existent directories gracefully', async () => {
      const suggestions = await findSimilarPaths('/non/existent/directory/file.txt');

      expect(suggestions).toEqual([]);
    });

    it('handles files with no extension', async () => {
      // Create a file with no extension
      await writeFile(join(testDir, 'makefile'), 'makefile content');

      const suggestions = await findSimilarPaths(join(testDir, 'makeflie')); // misspelled

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0]).toContain('makefile');
    });

    it('handles very short filenames', async () => {
      await writeFile(join(testDir, 'a.txt'), 'short filename');

      const suggestions = await findSimilarPaths(join(testDir, 'b.txt'));

      // Might or might not suggest 'a.txt' depending on similarity threshold
      expect(suggestions).toBeInstanceOf(Array);
    });
  });

  describe('real-world scenarios', () => {
    it('helps with common JavaScript file misspellings', async () => {
      await writeFile(join(testDir, 'index.js'), 'js content');
      await writeFile(join(testDir, 'utils.js'), 'utils content');

      const suggestions = await findSimilarPaths(join(testDir, 'utlis.js')); // common typo

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0]).toContain('utils.js');
    });

    it('helps with config file misspellings', async () => {
      await writeFile(join(testDir, 'config.json'), 'config content');
      await writeFile(join(testDir, 'tsconfig.json'), 'ts config');

      const suggestions = await findSimilarPaths(join(testDir, 'conifg.json')); // common typo

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0]).toContain('config.json');
    });
  });
});
