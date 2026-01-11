// ABOUTME: Shared utility functions for extracting content from ProviderMessage content
// ABOUTME: Centralizes text extraction logic used by multiple provider implementations

import { ContentBlock } from '@lace/agent/providers/base-provider';

/**
 * Extracts text content from a string or ContentBlock array.
 * When given a ContentBlock array, filters for text blocks and joins them with newlines.
 *
 * @param content - Either a plain string or an array of ContentBlocks
 * @returns The extracted text content as a string
 */
export function getTextContent(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b): b is ContentBlock & { type: 'text' } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}
