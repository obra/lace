// ABOUTME: Display component for AGENT_MESSAGE events with streaming support
// ABOUTME: Shows agent responses with distinct styling and handles markdown rendering

import React from 'react';
import { Box, Text } from 'ink';
import { ThreadEvent } from '../../../../threads/types.js';
import { CodeDisplay } from '../ui/CodeDisplay.js';

interface AgentMessageDisplayProps {
  event: ThreadEvent;
  isStreaming?: boolean;
}

// Parse code blocks and apply syntax highlighting
const parseContent = (content: string) => {
  // Split content by code blocks (```language...```)
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  const parts: Array<{ type: 'text' | 'code'; content: string; language?: string }> = [];
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    // Add text before code block
    if (match.index > lastIndex) {
      parts.push({
        type: 'text',
        content: content.slice(lastIndex, match.index)
      });
    }

    // Add code block
    parts.push({
      type: 'code',
      content: match[2] || '',
      language: match[1] || 'text'
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < content.length) {
    parts.push({
      type: 'text',
      content: content.slice(lastIndex)
    });
  }

  return parts.length > 0 ? parts : [{ type: 'text' as const, content }];
};

export function AgentMessageDisplay({ event, isStreaming }: AgentMessageDisplayProps) {
  const message = event.data as string;
  
  // Strip thinking blocks since they're displayed separately as thinking timeline items
  const messageWithoutThinking = message.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  
  // Don't render if message is empty after stripping thinking blocks
  if (!messageWithoutThinking) {
    return null;
  }
  
  const contentParts = parseContent(messageWithoutThinking);
  
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="column">
        {contentParts.map((part, index) => (
          <Box key={index} flexDirection="column">
            {part.type === 'code' ? (
              <Box 
                borderStyle="single" 
                borderColor="gray"
                padding={1}
                marginY={1}
                flexDirection="column"
              >
                {part.language && (
                  <Text color="blue" bold dimColor>
                    {part.language}
                  </Text>
                )}
                <CodeDisplay code={part.content} language={part.language} />
              </Box>
            ) : (
              <Box>
                {index === 0 && (
                  <Text color="green">{'❦ '}</Text>
                )}
                <Text color="white" wrap="wrap">
                  {part.content}
                </Text>
                {index === 0 && isStreaming && <Text color="gray"> (thinking...)</Text>}
              </Box>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}