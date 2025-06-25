// ABOUTME: Message display component with markdown rendering and collapsible content
// ABOUTME: Shows conversation messages with proper formatting for code blocks and tool outputs

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { MarkdownDisplay } from './ui/MarkdownDisplay.js';
import { UI_SYMBOLS } from '../theme.js';

interface Message {
  type: "user" | "assistant" | "system" | "tool" | "thinking";
  content: string;
  timestamp: Date;
}

interface MessageDisplayProps {
  message: Message;
  isStreaming?: boolean;
  showCursor?: boolean;
  isFocused?: boolean;
}

const MessageDisplay: React.FC<MessageDisplayProps> = ({
  message,
  isStreaming = false,
  showCursor = false,
  isFocused = false,
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
      case "user": return "> ";
      case "assistant": return UI_SYMBOLS.AGENT + " ";
      case "thinking": return `${UI_SYMBOLS.THINKING} `;
      case "tool": return `${UI_SYMBOLS.TOOL} `;
      case "system": return UI_SYMBOLS.INFO + "  ";
      default: return "";
    }
  };

  // Get prefix color
  const getPrefixColor = (type: string) => {
    switch (type) {
      case "user": return "dim";
      case "assistant": return "green";
      case "thinking": return "gray";
      case "tool": return "yellow";
      case "system": return "gray";
      default: return "white";
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
  const prefixColor = getPrefixColor(message.type);

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Inline prefix with content */}
      <Box flexDirection="column">
        {message.type === "thinking" ? (
          <Box>
            <Text color={prefixColor}>{prefix}</Text>
            <Text italic color={messageColor}>{displayContent}</Text>
          </Box>
        ) : message.type === "assistant" ? (
          // Use markdown rendering for assistant messages (streaming and final)
          <Box flexDirection="column">
            <MarkdownDisplay content={displayContent} showIcon={true} />
            {isStreaming && showCursor && (
              <Text inverse> </Text>
            )}
            {shouldShowCollapse && (
              <Text color="dim"> 
                {isCollapsed ? ' [+]' : ' [-]'}
              </Text>
            )}
          </Box>
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
                <Box>
                  {index === 0 && (
                    <Text color={prefixColor}>{prefix}</Text>
                  )}
                  <Text color={messageColor} wrap="wrap">
                    {part.content}
                    {isStreaming && index === contentParts.length - 1 && showCursor && (
                      <Text inverse> </Text>
                    )}
                  </Text>
                  {shouldShowCollapse && index === 0 && (
                    <Text color="dim"> 
                      {isCollapsed ? ' [+]' : ' [-]'}
                    </Text>
                  )}
                </Box>
              )}
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
};

export default MessageDisplay;
