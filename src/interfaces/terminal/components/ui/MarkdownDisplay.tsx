// ABOUTME: Markdown renderer for terminal interface using marked-terminal
// ABOUTME: Converts markdown content to ANSI-styled terminal output with syntax highlighting

import React from 'react';
import { Box, Text } from 'ink';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';

interface MarkdownDisplayProps {
  content: string;
  showIcon?: boolean;
  dimmed?: boolean;
}

export function MarkdownDisplay({ content, showIcon = true, dimmed = false }: MarkdownDisplayProps) {
  try {
    // Configure marked with terminal renderer for ANSI formatting
    marked.setOptions({
      renderer: new TerminalRenderer() as any
    });
    
    // Parse markdown to terminal-formatted text with ANSI colors
    const renderedContent = marked.parse(content.trim()) as string;
    // Remove trailing whitespace from each line and the overall content
    const cleanedContent = renderedContent.trim().split('\n').map(line => line.trimEnd()).join('\n');
    
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box flexDirection="row">
          <Box><Text color={dimmed ? "dim" : "green"}>❦ </Text></Box>
	  <Box><Text wrap="wrap" dimColor={dimmed}>{cleanedContent}</Text></Box>
        </Box>
      </Box>
    );
  } catch (error) {
    // Fallback to plain text if markdown parsing fails
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box flexDirection="row">
          {showIcon && <Text color={dimmed ? "dim" : "green"}>❦</Text>}
          <Text color={dimmed ? "dim" : "white"} wrap="wrap">{content.trim()}</Text>
        </Box>
      </Box>
    );
  }
}
