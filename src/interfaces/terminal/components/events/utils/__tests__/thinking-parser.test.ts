// ABOUTME: Tests for thinking block parsing utilities
// ABOUTME: Verifies extraction, word counting, and content transformation logic

import { describe, it, expect } from 'vitest';
import {
  parseThinkingBlocks,
  createSummaryContent,
  countWords,
  formatThinkingForDisplay,
} from '../thinking-parser.js';

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

  describe('createSummaryContent', () => {
    it('should create summary with thinking word count markers', () => {
      const content = '<think>Let me think about this</think>Here is my response';
      const result = createSummaryContent(content);

      expect(result).toContain('*thought for 5 words*');
      expect(result).toContain('Here is my response');
      expect(result).not.toContain('<think>');
    });

    it('should handle multiple thinking blocks with total word count', () => {
      const content = '<think>First</think>Text<think>Second thought</think>More text';
      const result = createSummaryContent(content);

      expect(result).toBe('*thought for 1 word*Text*thought for 2 words*More text'); // Inline replacement
      expect(result).toContain('Text');
      expect(result).toContain('More text');
    });

    it('should handle single word thinking blocks', () => {
      const content = '<think>Hmm</think>Response';
      const result = createSummaryContent(content);

      expect(result).toContain('*thought for 1 word*'); // Singular "word"
      expect(result).toContain('Response');
    });

    it('should handle thinking-only content', () => {
      const content = '<think>Only thinking content here</think>';
      const result = createSummaryContent(content);

      expect(result).toBe('*thought for 4 words*');
    });

    it('should return unchanged content when no thinking blocks', () => {
      const content = 'Just regular content';
      const result = createSummaryContent(content);

      expect(result).toBe('Just regular content');
    });

    it('should handle empty thinking blocks', () => {
      const content = '<think></think>Response';
      const result = createSummaryContent(content);

      expect(result).toContain('*thought for 0 words*');
      expect(result).toContain('Response');
    });

    it('should handle complex mixed content', () => {
      const content =
        'Start <think>First thought process</think> middle text <think>Second</think> end';
      const result = createSummaryContent(content);

      expect(result).toBe('Start *thought for 3 words* middle text *thought for 1 word* end'); // Inline replacement
    });
  });

  describe('formatThinkingForDisplay', () => {
    it('should convert thinking blocks to italic markdown', () => {
      const content = '<think>Some thinking</think>Response content';
      const result = formatThinkingForDisplay(content);

      expect(result).toBe('*Some thinking*Response content');
    });

    it('should handle empty content', () => {
      const result = formatThinkingForDisplay('');
      expect(result).toBe('');
    });

    it('should handle multiple thinking blocks', () => {
      const content =
        '<think>First thought</think>Middle content<think>Second thought</think>End content';
      const result = formatThinkingForDisplay(content);

      expect(result).toBe('*First thought*Middle content*Second thought*End content');
    });

    it('should handle content without thinking blocks', () => {
      const content = 'Just regular content';
      const result = formatThinkingForDisplay(content);

      expect(result).toBe('Just regular content');
    });

    it('should handle unclosed thinking blocks (streaming case)', () => {
      const content = 'Some response <think>partial thinking';
      const result = formatThinkingForDisplay(content);

      expect(result).toBe('Some response *partial thinking*');
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
