// ABOUTME: Status bar component showing system information and current state
// ABOUTME: Displays provider, model, token usage, thread ID and other key metrics

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

interface StatusBarProps {
  providerName: string;
  modelName?: string;
  threadId?: string;
  tokenUsage?: TokenUsage;
  isProcessing?: boolean;
  messageCount?: number;
}

const StatusBar: React.FC<StatusBarProps> = ({
  providerName,
  modelName,
  threadId,
  tokenUsage,
  isProcessing = false,
  messageCount = 0,
}) => {
  // Format token usage for display
  const formatTokenUsage = (usage?: TokenUsage) => {
    if (!usage || !usage.totalTokens) {
      return "0 tokens";
    }
    
    if (usage.totalTokens > 1000) {
      return `${(usage.totalTokens / 1000).toFixed(1)}k tokens`;
    }
    
    return `${usage.totalTokens} tokens`;
  };

  // Format thread ID for display (don't truncate)
  const formatThreadId = (id?: string) => {
    if (!id) return "no-thread";
    return id;
  };


  // Track terminal width with proper SIGWINCH event handling
  const [terminalWidth, setTerminalWidth] = useState(process.stdout.columns || 80);
  
  useEffect(() => {
    const updateWidth = () => {
      setTerminalWidth(process.stdout.columns || 80);
    };
    
    // Listen for SIGWINCH (window change) signal
    process.on('SIGWINCH', updateWidth);
    
    return () => {
      process.off('SIGWINCH', updateWidth);
    };
  }, []);
  
  // Use the tracked width
  const currentWidth = terminalWidth;
  
  // Create content strings
  const leftContent = `🧠 ${providerName}${modelName ? `:${modelName}` : ''} • 📁 ${formatThreadId(threadId)}`;
  const rightContent = `💬 ${messageCount} • ${formatTokenUsage(tokenUsage)} • ${isProcessing ? '⚡ Processing' : '✓ Ready'}`;
  
  // Calculate padding needed to fill the terminal width
  const totalContentLength = leftContent.length + rightContent.length;
  const paddingNeeded = Math.max(0, currentWidth - totalContentLength - 2); // -2 for side padding
  const padding = ' '.repeat(paddingNeeded);

  return (
    <Text backgroundColor="blueBright" color="black">
      {' ' + leftContent + padding + rightContent + ' '}
    </Text>
  );
};

export default StatusBar;