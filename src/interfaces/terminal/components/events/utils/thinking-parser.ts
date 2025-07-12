// ABOUTME: Utility functions for parsing thinking blocks from agent messages
// ABOUTME: Handles extraction, word counting, and content transformation for AgentMessageDisplay

import sax from 'sax';
import { logger } from '~/utils/logger';

// Simple LRU cache for parsing results
const CACHE_SIZE = 100;
const parseCache = new Map<string, ParsedContent>();

function cacheResult(content: string, result: ParsedContent): ParsedContent {
  // Implement simple LRU by removing oldest entries when cache is full
  if (parseCache.size >= CACHE_SIZE) {
    const firstKey = parseCache.keys().next().value;
    if (firstKey !== undefined) {
      parseCache.delete(firstKey);
    }
  }
  parseCache.set(content, result);
  return result;
}

export interface ThinkingBlock {
  content: string;
  startIndex: number;
  endIndex: number;
}

export interface ParsedContent {
  hasThinking: boolean;
  thinkingBlocks: ThinkingBlock[];
  contentWithoutThinking: string;
  totalThinkingWords: number;
}

/**
 * Parse agent message content to extract thinking blocks and clean content
 * Uses SAX parser to handle streaming cases with incomplete thinking blocks
 * Results are memoized for performance
 */
export function parseThinkingBlocks(content: string): ParsedContent {
  // Check cache first
  if (parseCache.has(content)) {
    return parseCache.get(content)!;
  }

  const thinkingBlocks: ThinkingBlock[] = [];
  let cleanContent = '';
  let totalThinkingWords = 0;

  // Use SAX parser for consistent thinking block extraction (handles streaming)
  const parser = sax.parser(false, { lowercase: true });
  let insideThinkTag = false;
  let thinkContent = '';
  let textBuffer = '';

  parser.onopentag = (tag) => {
    if (tag.name === 'think') {
      // Add any accumulated text before think tag
      cleanContent += textBuffer;
      textBuffer = '';
      insideThinkTag = true;
      thinkContent = '';
    }
    // Ignore root tag - it's just our wrapper
  };

  parser.ontext = (text) => {
    if (insideThinkTag) {
      thinkContent += text;
    } else {
      textBuffer += text;
    }
  };

  parser.oncdata = (text) => {
    if (insideThinkTag) {
      thinkContent += text;
    } else {
      textBuffer += text;
    }
  };

  parser.onclosetag = (tagName) => {
    if (tagName === 'think' && insideThinkTag) {
      // Extract completed thinking block (even if empty)
      thinkingBlocks.push({
        content: thinkContent.trim(),
        startIndex: cleanContent.length,
        endIndex: cleanContent.length + thinkContent.length,
      });
      totalThinkingWords += countWords(thinkContent.trim());
      insideThinkTag = false;
      thinkContent = '';
    }
    // Ignore root tag - it's just our wrapper
  };

  parser.onerror = (error) => {
    // Log error but continue - SAX can handle malformed XML gracefully
    logger.warn('SAX parser encountered error, continuing:', error);
  };

  parser.onend = () => {
    // Add any remaining text
    cleanContent += textBuffer;

    // Handle incomplete thinking block (streaming edge case)
    if (insideThinkTag && thinkContent.trim()) {
      // For streaming case where we have partial thinking
      const incompleteContent = `${thinkContent.trim()} [incomplete]`;
      thinkingBlocks.push({
        content: incompleteContent,
        startIndex: cleanContent.length,
        endIndex: cleanContent.length + thinkContent.length,
      });
      totalThinkingWords += countWords(thinkContent.trim());
    }
  };

  try {
    // Parse the content - wrap in root element for well-formed XML
    parser.write(`<root>${content}</root>`).close();
  } catch (error) {
    // Continue processing even if parser fails
    logger.warn('SAX parser write/close failed:', error);
  }

  const result = {
    hasThinking: thinkingBlocks.length > 0,
    thinkingBlocks,
    contentWithoutThinking: cleanContent.trim(),
    totalThinkingWords,
  };

  return cacheResult(content, result);
}

/**
 * Count words in a text string
 */
export function countWords(text: string): number {
  if (!text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}
