// ABOUTME: Message component for displaying individual conversation messages
// ABOUTME: Handles user and assistant messages with appropriate prefixes and styling

import React from 'react';
import { Text, Box } from 'ink';
import { processContentWithHighlighting } from '../utils/syntax-highlight';

interface MessageProps {
  type: 'user' | 'assistant' | 'loading' | 'agent_activity';
  content: string | string[];
  summary?: string;
  folded?: boolean;
  isHighlighted?: boolean;
}

const Message: React.FC<MessageProps> = ({ 
  type, 
  content, 
  summary, 
  folded = false, 
  isHighlighted = false 
}) => {
  const getPrefix = () => {
    if (type === 'user') return '> ';
    if (type === 'assistant') return '🤖 ';
    if (type === 'loading') return '⠋ ';
    if (type === 'agent_activity') return folded ? '▶ ' : '▼ ';
    return '';
  };
  
  const getPrefixColor = () => {
    if (type === 'user') return 'cyan';
    if (type === 'assistant') return 'green';
    if (type === 'loading') return 'yellow';
    if (type === 'agent_activity') return 'blue';
    return 'white';
  };
  
  const prefix = getPrefix();
  const prefixColor = getPrefixColor();

  const renderContent = () => {
    if (type === 'agent_activity') {
      if (folded) {
        // Show only summary when folded
        return (
          <Box>
            <Text color={prefixColor}>{prefix}</Text>
            {/* @ts-expect-error - inverse prop exists in runtime but TypeScript is having issues */}
            <Text inverse={isHighlighted}>{summary}</Text>
          </Box>
        );
      } else {
        // Show full content when unfolded
        return (
          <Box flexDirection="column">
            <Box>
              <Text color={prefixColor}>{prefix}</Text>
              {/* @ts-expect-error - inverse prop exists in runtime but TypeScript is having issues */}
              <Text inverse={isHighlighted}>{summary}</Text>
            </Box>
            {Array.isArray(content) && content.map((item, index) => (
              <Box key={index}>
                <Text>  {item}</Text>
              </Box>
            ))}
          </Box>
        );
      }
    } else {
      // Regular message types (user, assistant, loading)
      const displayContent = type === 'assistant' && typeof content === 'string' 
        ? processContentWithHighlighting(content)
        : content;
        
      return (
        <Box>
          <Text color={prefixColor}>{prefix}</Text>
          {/* @ts-expect-error - inverse prop exists in runtime but TypeScript is having issues */}
          <Text inverse={isHighlighted}>{displayContent}</Text>
        </Box>
      );
    }
  };

  return (
    <Box flexDirection="column">
      {renderContent()}
      {type === 'agent_activity' && folded ? (
        <Text>{''}</Text>
      ) : (
        <Text>{''}</Text>
      )}
    </Box>
  );
};

export default Message;