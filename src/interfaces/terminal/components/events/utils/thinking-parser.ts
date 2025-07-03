// ABOUTME: Utility functions for parsing thinking blocks from agent messages
// ABOUTME: Handles extraction, word counting, and content transformation for AgentMessageDisplay

import sax from 'sax';
import { logger } from '../../../../../utils/logger.js';

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

  try {
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

    parser.onerror = () => {
      // Parser error, fall back to regex
      throw new Error('SAX parser failed');
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

    // Parse the content - wrap in root element for well-formed XML
    parser.write(`<root>${content}</root>`).close();

    const result = {
      hasThinking: thinkingBlocks.length > 0,
      thinkingBlocks,
      contentWithoutThinking: cleanContent.trim(),
      totalThinkingWords,
    };
    return cacheResult(content, result);
  } catch (error) {
    // If SAX parser fails, fall back to regex for robustness
    logger.warn('SAX parser failed, falling back to regex:', error);
    const regex = /<think>([\s\S]*?)<\/think>/g;
    const blocks: ThinkingBlock[] = [];
    let match;
    let clean = content;

    while ((match = regex.exec(content)) !== null) {
      blocks.push({
        content: match[1].trim(),
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      });
      totalThinkingWords += countWords(match[1].trim());
    }

    clean = content.replace(regex, '').trim();
    const result = {
      hasThinking: blocks.length > 0,
      thinkingBlocks: blocks,
      contentWithoutThinking: clean,
      totalThinkingWords,
    };
    return cacheResult(content, result);
  }
}

/**
 * Create summary content by hiding thinking blocks and showing italic summary (for collapsed state)
 */
export function createSummaryContent(content: string): string {
  const { contentWithoutThinking, totalThinkingWords, hasThinking } = parseThinkingBlocks(content);

  if (!hasThinking) {
    return content;
  }

  if (!contentWithoutThinking) {
    // Only thinking blocks, no other content
    return `*thought for ${totalThinkingWords} word${totalThinkingWords === 1 ? '' : 's'}*`;
  }

  // For content with thinking blocks, show the clean content with an italic summary marker
  return `${contentWithoutThinking}\n\n*thought for ${totalThinkingWords} word${totalThinkingWords === 1 ? '' : 's'}*`;
}

/**
 * Count words in a text string
 */
export function countWords(text: string): number {
  if (!text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

/**
 * Format thinking content for display in expanded state
 * Converts <think> tags to italic markdown
 */
export function formatThinkingForDisplay(content: string): string {
  const { thinkingBlocks } = parseThinkingBlocks(content);

  if (thinkingBlocks.length === 0) {
    return content;
  }

  // Reconstruct content with thinking blocks as italics
  let result = '';
  let lastIndex = 0;

  // Find original positions of thinking blocks in the content
  const regex = /<think>([\s\S]*?)<\/think>/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    // Add content before this thinking block
    result += content.substring(lastIndex, match.index);

    // Add thinking block content in italics
    const thinkingContent = match[1].trim();
    if (thinkingContent) {
      result += `\n\n*${thinkingContent}*\n\n`;
    }

    lastIndex = match.index + match[0].length;
  }

  // Add any remaining content after the last thinking block
  result += content.substring(lastIndex);

  return result;
}
