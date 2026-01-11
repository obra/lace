// ABOUTME: Unit tests for content-helpers utilities
// ABOUTME: Tests text extraction from string or ContentBlock arrays

import { describe, it, expect } from 'vitest';
import { getTextContent } from '@lace/agent/providers/utils/content-helpers';

describe('getTextContent', () => {
  it('returns string content unchanged', () => {
    const result = getTextContent('hello world');
    expect(result).toBe('hello world');
  });

  it('returns empty string for empty string input', () => {
    const result = getTextContent('');
    expect(result).toBe('');
  });

  it('extracts text from a single text block', () => {
    const content = [{ type: 'text' as const, text: 'hello world' }];
    const result = getTextContent(content);
    expect(result).toBe('hello world');
  });

  it('joins multiple text blocks with newlines', () => {
    const content = [
      { type: 'text' as const, text: 'first line' },
      { type: 'text' as const, text: 'second line' },
    ];
    const result = getTextContent(content);
    expect(result).toBe('first line\nsecond line');
  });

  it('filters out non-text blocks', () => {
    const content = [
      { type: 'text' as const, text: 'visible text' },
      {
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: 'image/png', data: 'abc123' },
      },
      { type: 'text' as const, text: 'more text' },
    ];
    const result = getTextContent(content);
    expect(result).toBe('visible text\nmore text');
  });

  it('returns empty string for empty content array', () => {
    const result = getTextContent([]);
    expect(result).toBe('');
  });

  it('returns empty string for array with only non-text blocks', () => {
    const content = [
      {
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: 'image/png', data: 'abc123' },
      },
    ];
    const result = getTextContent(content);
    expect(result).toBe('');
  });

  it('preserves whitespace in text blocks', () => {
    const content = [{ type: 'text' as const, text: '  indented  text  ' }];
    const result = getTextContent(content);
    expect(result).toBe('  indented  text  ');
  });
});
