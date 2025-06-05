// ABOUTME: Message component for displaying individual conversation messages
// ABOUTME: Handles user and assistant messages with appropriate prefixes and styling

import React from 'react';
import { Text, Box } from 'ink';

interface MessageProps {
  type: 'user' | 'assistant';
  content: string;
  isHighlighted?: boolean;
}

const Message: React.FC<MessageProps> = ({ type, content, isHighlighted = false }) => {
  const prefix = type === 'user' ? '> ' : '🤖 ';
  const prefixColor = type === 'user' ? 'cyan' : 'green';

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={prefixColor}>{prefix}</Text>
        {/* @ts-expect-error - inverse prop exists in runtime but TypeScript is having issues */}
        <Text inverse={isHighlighted}>{content}</Text>
      </Box>
      <Text>{''}</Text>
    </Box>
  );
};

export default Message;