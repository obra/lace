// ABOUTME: Message component for displaying individual conversation messages
// ABOUTME: Handles user and assistant messages with appropriate prefixes and styling

import React from 'react';
import { Text, Box } from 'ink';

interface MessageProps {
  type: 'user' | 'assistant';
  content: string;
}

const Message: React.FC<MessageProps> = ({ type, content }) => {
  const prefix = type === 'user' ? '> ' : '🤖 ';
  const prefixColor = type === 'user' ? 'cyan' : 'green';

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={prefixColor}>{prefix}</Text>
        <Text>{content}</Text>
      </Box>
      <Text>{''}</Text>
    </Box>
  );
};

export default Message;