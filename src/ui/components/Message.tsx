// ABOUTME: Message component for displaying individual conversation messages
// ABOUTME: Handles user and assistant messages with appropriate prefixes and styling

import React from 'react';
import { Text, Box } from 'ink';

interface MessageProps {
  type: 'user' | 'assistant' | 'loading';
  content: string;
  isHighlighted?: boolean;
}

const Message: React.FC<MessageProps> = ({ type, content, isHighlighted = false }) => {
  const getPrefix = () => {
    if (type === 'user') return '> ';
    if (type === 'assistant') return '🤖 ';
    return '⠋ '; // Spinner for loading
  };
  
  const getPrefixColor = () => {
    if (type === 'user') return 'cyan';
    if (type === 'assistant') return 'green';
    return 'yellow'; // Yellow for loading
  };
  
  const prefix = getPrefix();
  const prefixColor = getPrefixColor();

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