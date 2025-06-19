// ABOUTME: Message display component with syntax highlighting and collapsible content
// ABOUTME: Shows conversation messages with proper formatting for code blocks and tool outputs

import React, { useState } from 'react';
import { Box, Text } from 'ink';

interface Message {
  type: "user" | "assistant" | "system" | "tool" | "thinking";
  content: string;
  timestamp: Date;
}

interface MessageDisplayProps {
  message: Message;
  isStreaming?: boolean;
  showCursor?: boolean;
}

const MessageDisplay: React.FC<MessageDisplayProps> = ({
  message,
  isStreaming = false,
  showCursor = false,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

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

  // Get message color based on type
  const getMessageColor = (type: string) => {
    switch (type) {
      case "user": return "cyan";
      case "assistant": return "white";
      case "thinking": return "dim";
      case "tool": return "yellow";
      case "system": return "gray";
      default: return "white";
    }
  };

  // Get message prefix
  const getMessagePrefix = (type: string) => {
    switch (type) {
      case "user": return "👤 ";
      case "assistant": return "🤖 ";
      case "thinking": return "💭 ";
      case "tool": return "🔧 ";
      case "system": return "ℹ️  ";
      default: return "";
    }
  };

  // Check if content is long enough to be collapsible (tool outputs, long assistant responses)
  const isLongContent = message.content.length > 500 || message.content.split('\n').length > 10;
  const shouldShowCollapse = (message.type === 'tool' || message.type === 'assistant') && isLongContent;

  // Collapse logic for tool outputs
  const displayContent = shouldShowCollapse && isCollapsed 
    ? message.content.split('\n').slice(0, 3).join('\n') + '\n... (collapsed, click to expand)'
    : message.content;

  const contentParts = parseContent(displayContent);
  const messageColor = getMessageColor(message.type);
  const prefix = getMessagePrefix(message.type);

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Message header with type indicator and timestamp */}
      <Box>
        <Text color={messageColor} bold>
          {prefix}
          {message.type.charAt(0).toUpperCase() + message.type.slice(1)}
        </Text>
        <Text color="dim" dimColor>
          {' '}({message.timestamp.toLocaleTimeString()})
        </Text>
        {shouldShowCollapse && (
          <Text color="dim"> 
            {isCollapsed ? ' [+]' : ' [-]'}
          </Text>
        )}
      </Box>

      {/* Message content with syntax highlighting */}
      <Box flexDirection="column" paddingLeft={2}>
        {message.type === "thinking" ? (
          <Text italic color={messageColor}>{displayContent}</Text>
        ) : (
          contentParts.map((part, index) => (
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
                  <Text color="green" wrap="wrap">
                    {part.content}
                  </Text>
                </Box>
              ) : (
                <Text color={messageColor} wrap="wrap">
                  {part.content}
                  {isStreaming && index === contentParts.length - 1 && showCursor && (
                    <Text inverse> </Text>
                  )}
                </Text>
              )}
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
};

export default MessageDisplay;