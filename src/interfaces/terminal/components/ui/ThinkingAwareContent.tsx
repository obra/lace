// ABOUTME: React component that properly renders content with thinking blocks using Ink styling
// ABOUTME: Parses thinking blocks and renders them as italic Text components instead of ANSI hacks

import React from 'react';
import { Box, Text } from 'ink';
import { parseThinkingBlocks } from '~/interfaces/terminal/components/events/utils/thinking-parser.js';
import { MarkdownDisplay } from '~/interfaces/terminal/components/ui/MarkdownDisplay.js';

interface ContentPart {
  type: 'text' | 'thinking';
  content: string;
}

interface ThinkingAwareContentProps {
  content: string;
  showThinking: boolean; // true = show thinking in italics, false = show summary markers
  showIcon?: boolean;
  dimmed?: boolean;
}

/**
 * Parse content into alternating text and thinking segments
 */
function parseContentParts(content: string): ContentPart[] {
  const parts: ContentPart[] = [];
  const remaining = content;

  // Handle complete thinking blocks
  const completeThinkingRegex = /<think>([\s\S]*?)<\/think>/g;
  let lastIndex = 0;
  let match;

  while ((match = completeThinkingRegex.exec(content)) !== null) {
    // Add text before this thinking block
    if (match.index > lastIndex) {
      const textBefore = content.substring(lastIndex, match.index);
      if (textBefore) {
        parts.push({ type: 'text', content: textBefore });
      }
    }

    // Add the thinking block
    parts.push({ type: 'thinking', content: match[1] });
    lastIndex = match.index + match[0].length;
  }

  // Handle unclosed thinking block (streaming case)
  const unclosedMatch = content.substring(lastIndex).match(/<think>([\s\S]*)$/);
  if (unclosedMatch) {
    // Add text before unclosed thinking
    const textBefore = content.substring(lastIndex, lastIndex + unclosedMatch.index!);
    if (textBefore) {
      parts.push({ type: 'text', content: textBefore });
    }

    // Add the unclosed thinking
    parts.push({ type: 'thinking', content: unclosedMatch[1] });
  } else {
    // Add remaining text after last thinking block
    const remainingText = content.substring(lastIndex);
    if (remainingText) {
      parts.push({ type: 'text', content: remainingText });
    }
  }

  return parts;
}

/**
 * Count words in text
 */
function countWords(text: string): number {
  if (!text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

export function ThinkingAwareContent({
  content,
  showThinking,
  showIcon = true,
  dimmed = false,
}: ThinkingAwareContentProps) {
  const { hasThinking } = parseThinkingBlocks(content);

  // If no thinking blocks, render normally
  if (!hasThinking) {
    return <MarkdownDisplay content={content} showIcon={showIcon} dimmed={dimmed} />;
  }

  const parts = parseContentParts(content);

  const renderedParts = parts
    .map((part, index) => {
      if (part.type === 'thinking') {
        if (showThinking) {
          // Show thinking content in italics (skip empty content)
          const trimmedContent = part.content.trim();
          return trimmedContent ? (
            <Text key={index} italic dimColor={dimmed}>
              {trimmedContent}
            </Text>
          ) : null;
        } else {
          // Show summary marker (skip empty thinking blocks)
          const wordCount = countWords(part.content);
          return wordCount > 0 ? (
            <Text key={index} italic dimColor={dimmed}>
              thought for {wordCount} word{wordCount === 1 ? '' : 's'}
            </Text>
          ) : null;
        }
      } else {
        // Regular text content - render with markdown if it has content
        return part.content.trim() ? (
          <MarkdownDisplay
            key={index}
            content={part.content}
            showIcon={index === 0 ? showIcon : false}
            dimmed={dimmed}
          />
        ) : null;
      }
    })
    .filter(Boolean); // Remove null elements

  return <Box flexDirection="column">{renderedParts}</Box>;
}
