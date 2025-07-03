// ABOUTME: Tests for thinking block parsing utilities
// ABOUTME: Verifies extraction, word counting, and content transformation logic

import { describe, it, expect } from 'vitest';
import { parseThinkingBlocks, countWords } from '../thinking-parser.js';

describe('thinking-parser utilities', () => {
  describe('countWords', () => {
    it('should count words correctly', () => {
      expect(countWords('hello world')).toBe(2);
      expect(countWords('one')).toBe(1);
      expect(countWords('')).toBe(0);
      expect(countWords('   ')).toBe(0);
      expect(countWords('  hello   world  ')).toBe(2);
      expect(countWords('hello,world-test')).toBe(1); // Single word with punctuation
      expect(countWords('hello world test')).toBe(3);
    });
  });

  describe('parseThinkingBlocks', () => {
    it('should parse single thinking block', () => {
      const content = '<think>Let me think about this</think>Here is my response';
      const result = parseThinkingBlocks(content);

      expect(result.hasThinking).toBe(true);
      expect(result.thinkingBlocks).toHaveLength(1);
      expect(result.thinkingBlocks[0].content).toBe('Let me think about this');
      expect(result.contentWithoutThinking).toBe('Here is my response');
      expect(result.totalThinkingWords).toBe(5); // "Let me think about this"
    });

    it('should parse multiple thinking blocks', () => {
      const content =
        '<think>First thought</think>Some text<think>Second thought</think>Final text';
      const result = parseThinkingBlocks(content);

      expect(result.hasThinking).toBe(true);
      expect(result.thinkingBlocks).toHaveLength(2);
      expect(result.thinkingBlocks[0].content).toBe('First thought');
      expect(result.thinkingBlocks[1].content).toBe('Second thought');
      expect(result.contentWithoutThinking).toBe('Some textFinal text');
      expect(result.totalThinkingWords).toBe(4); // "First thought" + "Second thought" = 2 + 2
    });

    it('should handle content with no thinking blocks', () => {
      const content = 'Just regular content here';
      const result = parseThinkingBlocks(content);

      expect(result.hasThinking).toBe(false);
      expect(result.thinkingBlocks).toHaveLength(0);
      expect(result.contentWithoutThinking).toBe('Just regular content here');
      expect(result.totalThinkingWords).toBe(0);
    });

    it('should handle content with only thinking blocks', () => {
      const content = '<think>Only thinking here</think>';
      const result = parseThinkingBlocks(content);

      expect(result.hasThinking).toBe(true);
      expect(result.thinkingBlocks).toHaveLength(1);
      expect(result.thinkingBlocks[0].content).toBe('Only thinking here');
      expect(result.contentWithoutThinking).toBe('');
      expect(result.totalThinkingWords).toBe(3); // "Only thinking here"
    });

    it('should handle multiline thinking blocks', () => {
      const content = '<think>Line 1\nLine 2\nLine 3</think>Response';
      const result = parseThinkingBlocks(content);

      expect(result.hasThinking).toBe(true);
      expect(result.thinkingBlocks).toHaveLength(1);
      expect(result.thinkingBlocks[0].content).toBe('Line 1\nLine 2\nLine 3');
      expect(result.totalThinkingWords).toBe(6); // "Line 1 Line 2 Line 3"
    });

    it('should track relative start and end indices in clean content', () => {
      const content = 'Start <think>thinking</think> middle <think>more</think> end';
      const result = parseThinkingBlocks(content);

      expect(result.thinkingBlocks).toHaveLength(2);
      expect(result.thinkingBlocks[0].startIndex).toBe(6); // After "Start "
      expect(result.thinkingBlocks[1].startIndex).toBe(14); // After "Start  middle "
      expect(result.contentWithoutThinking).toBe('Start  middle  end');
    });
  });

  describe('Edge cases', () => {
    it('should handle malformed thinking tags as incomplete blocks', () => {
      const content = '<think>Unclosed thinking block';
      const result = parseThinkingBlocks(content);

      expect(result.hasThinking).toBe(true); // SAX treats as incomplete block
      expect(result.thinkingBlocks[0].content).toBe('Unclosed thinking block');
      expect(result.contentWithoutThinking).toBe('');
    });

    it('should handle nested-like content in thinking blocks', () => {
      const content = '<think>I think &lt;something&gt; is &lt;else&gt;</think>Response';
      const result = parseThinkingBlocks(content);

      expect(result.hasThinking).toBe(true);
      expect(result.thinkingBlocks[0].content).toContain('something');
      expect(result.contentWithoutThinking).toBe('Response');
    });

    it('should handle whitespace-only thinking blocks', () => {
      const content = '<think>   \n\t   </think>Response';
      const result = parseThinkingBlocks(content);

      expect(result.hasThinking).toBe(true);
      expect(result.thinkingBlocks[0].content).toBe(''); // Trimmed
      expect(result.totalThinkingWords).toBe(0);
    });
  });
});
