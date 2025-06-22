// ABOUTME: Visual tool approval modal component for terminal interface
// ABOUTME: Shows tool information, risk level, and parameters with clear approval options

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useFocus } from 'ink';
import { ApprovalDecision } from '../../../tools/approval-types.js';

export interface ToolApprovalModalProps {
  toolName: string;
  input: unknown;
  isReadOnly?: boolean;
  onDecision: (decision: ApprovalDecision) => void;
  isVisible: boolean;
  focusId?: string;
}

const ToolApprovalModal: React.FC<ToolApprovalModalProps> = ({
  toolName,
  input,
  isReadOnly = false,
  onDecision,
  isVisible,
  focusId,
}) => {
  const [selectedOption, setSelectedOption] = useState(0);
  const { isFocused } = useFocus({ id: focusId, autoFocus: true });

  // Reset selection when modal becomes visible
  useEffect(() => {
    if (isVisible) {
      setSelectedOption(0);
    }
  }, [isVisible]);

  useInput((inputChar, key) => {
    if (!isVisible || !isFocused) return;

    if (key.upArrow || inputChar === 'k') {
      setSelectedOption((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow || inputChar === 'j') {
      setSelectedOption((prev) => Math.min(2, prev + 1));
    } else if (key.return) {
      // Execute selected option
      switch (selectedOption) {
        case 0:
          onDecision(ApprovalDecision.ALLOW_ONCE);
          break;
        case 1:
          onDecision(ApprovalDecision.ALLOW_SESSION);
          break;
        case 2:
          onDecision(ApprovalDecision.DENY);
          break;
      }
    } else if (inputChar === 'y' || inputChar === 'a') {
      onDecision(ApprovalDecision.ALLOW_ONCE);
    } else if (inputChar === 's') {
      onDecision(ApprovalDecision.ALLOW_SESSION);
    } else if (inputChar === 'n' || inputChar === 'd') {
      onDecision(ApprovalDecision.DENY);
    }
  });

  if (!isVisible) {
    return null;
  }

  // Format input parameters for display
  const formatInput = (value: unknown): string => {
    if (typeof value === 'string') {
      if (value.length > 150) {
        return `"${value.substring(0, 150)}..."`; 
      }
      return `"${value}"`;
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        return '[]';
      }
      const items = value.slice(0, 2).map(item => formatInput(item));
      const suffix = value.length > 2 ? `, ...${value.length - 2} more` : '';
      return `[${items.join(', ')}${suffix}]`;
    } else if (typeof value === 'object' && value !== null) {
      const entries = Object.entries(value).slice(0, 2);
      const formatted = entries.map(([k, v]) => `${k}: ${formatInput(v)}`);
      const suffix = Object.keys(value).length > 2 ? ', ...' : '';
      return `{ ${formatted.join(', ')}${suffix} }`;
    } else {
      return String(value);
    }
  };

  // Determine risk level and colors
  const riskLevel = isReadOnly ? 'low' : 'high';
  const riskColor = isReadOnly ? 'green' : 'red';
  const riskLabel = isReadOnly ? '✅ READ-ONLY' : '⚠️  DESTRUCTIVE';

  const options = [
    { key: 'y', label: 'Allow Once', decision: ApprovalDecision.ALLOW_ONCE },
    { key: 's', label: 'Allow Session', decision: ApprovalDecision.ALLOW_SESSION },
    { key: 'n', label: 'Deny', decision: ApprovalDecision.DENY }
  ];

  return (
    <Box flexDirection="column" borderStyle="double" borderColor="yellow" padding={1} marginY={1}>
      {/* Header */}
      <Box justifyContent="center" marginBottom={1}>
        <Text bold color="yellow">🛡️  TOOL APPROVAL REQUEST</Text>
      </Box>
      
      {/* Tool information */}
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text bold>Tool: </Text>
          <Text color="cyan">{toolName}</Text>
          <Text> </Text>
          <Text color={riskColor}>{riskLabel}</Text>
        </Box>
        
        {/* Parameters */}
        {input !== null && input !== undefined && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Parameters:</Text>
            <Box paddingLeft={2}>
              <Text wrap="wrap">{formatInput(input)}</Text>
            </Box>
          </Box>
        )}
      </Box>

      {/* Options */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Choose action (↑↓ to navigate, Enter to select):</Text>
        {options.map((option, index) => (
          <Box key={option.key} paddingLeft={2}>
            <Text color={selectedOption === index ? 'black' : 'white'} 
                  backgroundColor={selectedOption === index ? 'white' : undefined}>
              {selectedOption === index ? '▶ ' : '  '}
              <Text bold>{option.key}</Text>
              {') '}
              {option.label}
            </Text>
          </Box>
        ))}
      </Box>

      {/* Help text */}
      <Box borderTop borderColor="gray" paddingTop={1}>
        <Text color="dim">
          Keys: y/a=allow once, s=session, n/d=deny, ↑↓=navigate, Enter=select
        </Text>
      </Box>
    </Box>
  );
};

export default ToolApprovalModal;