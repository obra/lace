// ABOUTME: Markdown renderer for terminal interface using marked-terminal
// ABOUTME: Converts markdown content to ANSI-styled terminal output with syntax highlighting

import React from 'react';
import { Box, Text } from 'ink';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';

interface MarkdownDisplayProps {
  content: string;
  showIcon?: boolean;
}

export function MarkdownDisplay({ content, showIcon = true }: MarkdownDisplayProps) {
  try {
    // Configure marked with terminal renderer for ANSI formatting
    marked.setOptions({
      renderer: new TerminalRenderer() as any
    });
    
    // Parse markdown to terminal-formatted text with ANSI colors
    const renderedContent = marked.parse(content) as string;
    
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          {showIcon && <Text color="green">❦ </Text>}
          <Text wrap="wrap">{renderedContent}</Text>
        </Box>
      </Box>
    );
  } catch (error) {
    // Fallback to plain text if markdown parsing fails
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          {showIcon && <Text color="green">❦ </Text>}
          <Text color="white" wrap="wrap">{content}</Text>
        </Box>
      </Box>
    );
  }
}