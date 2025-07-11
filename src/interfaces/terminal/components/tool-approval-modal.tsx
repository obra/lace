// ABOUTME: Visual tool approval modal component for terminal interface
// ABOUTME: Shows tool information, risk level, and parameters with clear approval options

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { ApprovalDecision } from '~/tools/approval-types.js';
import { ModalWrapper, useLaceFocus, FocusRegions } from '~/interfaces/terminal/focus/index.js';

export interface ToolApprovalModalProps {
  toolName: string;
  input: unknown;
  isReadOnly?: boolean;
  onDecision: (decision: ApprovalDecision) => void;
  isVisible: boolean;
}

const ToolApprovalModal: React.FC<ToolApprovalModalProps> = ({
  toolName,
  input,
  isReadOnly = false,
  onDecision,
  isVisible,
}) => {
  const [selectedOption, setSelectedOption] = useState(0);
  const { isFocused } = useLaceFocus(FocusRegions.modal('approval'));

  // Reset selection when modal becomes visible
  useEffect(() => {
    if (isVisible) {
      setSelectedOption(0);
    }
  }, [isVisible]);

  useInput(
    (inputChar, key) => {
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
    },
    { isActive: isVisible && isFocused }
  );

  // ModalWrapper handles visibility, so we just render the content

  // Format input parameters for pretty display
  const formatParameters = (value: unknown): React.ReactNode[] => {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const entries = Object.entries(value);
      return entries.map(([key, val]) => {
        const formattedValue = formatParameterValue(val);
        return (
          <Box key={key} flexDirection="row" marginBottom={0}>
            <Text>{key}: </Text>
            {formattedValue}
          </Box>
        );
      });
    } else {
      return [<Text key="single">{formatParameterValue(value)}</Text>];
    }
  };

  // Format individual parameter values
  const formatParameterValue = (value: unknown): React.ReactNode => {
    if (typeof value === 'string') {
      // Special handling for long content (file content, etc.)
      if (value.length > 200) {
        const preview = value.substring(0, 200);
        const lineCount = value.split('\n').length;
        return (
          <Box flexDirection="column">
            <Text color="white">{preview}...</Text>
            <Text color="dim" italic>
              ({value.length} chars, {lineCount} lines - truncated for display)
            </Text>
          </Box>
        );
      }
      return (
        <Text bold color="white">
          {value}
        </Text>
      );
    } else if (Array.isArray(value)) {
      return (
        <Box flexDirection="column">
          {value.slice(0, 5).map((item, idx) => (
            <Text key={idx} color="white">
              • {String(item)}
            </Text>
          ))}
          {value.length > 5 && (
            <Text color="dim" italic>
              ...and {value.length - 5} more items
            </Text>
          )}
        </Box>
      );
    } else if (typeof value === 'boolean') {
      return (
        <Text bold color={value ? 'green' : 'red'}>
          {String(value)}
        </Text>
      );
    } else if (typeof value === 'number') {
      return (
        <Text bold color="cyan">
          {String(value)}
        </Text>
      );
    } else {
      return (
        <Text bold color="white">
          {String(value)}
        </Text>
      );
    }
  };

  // Determine risk level and colors
  const _riskLevel = isReadOnly ? 'low' : 'high';
  const riskColor = isReadOnly ? 'green' : 'red';
  const riskLabel = isReadOnly ? 'READ-ONLY' : '⚠️POSSIBLY DESTRUCTIVE';

  const options = [
    { key: 'y', label: 'Allow Once', decision: ApprovalDecision.ALLOW_ONCE },
    { key: 's', label: 'Allow Session', decision: ApprovalDecision.ALLOW_SESSION },
    { key: 'n', label: 'Deny', decision: ApprovalDecision.DENY },
  ];

  return (
    <ModalWrapper focusId={FocusRegions.modal('approval')} isOpen={isVisible}>
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="yellow"
        paddingX={2}
        paddingY={1}
        width="100%"
      >
        {/* Header with tool name and risk indicator */}
        <Box justifyContent="space-between">
          <Text bold color="yellow">
            Approve tool use: {toolName}
          </Text>
          <Text bold color={riskColor}>
            {riskLabel}
          </Text>
        </Box>

        {/* Parameters section */}
        {input !== null && input !== undefined && (
          <Box flexDirection="column">
            <Text>Parameters:</Text>
            <Box paddingLeft={2} flexDirection="column">
              {formatParameters(input)}
            </Box>
          </Box>
        )}

        <Text> </Text>

        {/* Action selection */}
        <Text>Choose your action:</Text>
        <Box flexDirection="column" paddingLeft={2}>
          {options.map((option, index) => (
            <Box key={option.key} flexDirection="row">
              <Text
                color={selectedOption === index ? 'black' : 'white'}
                backgroundColor={selectedOption === index ? 'white' : undefined}
                bold={selectedOption === index}
              >
                {selectedOption === index ? '▶ ' : '  '}
                {option.key}) {option.label}
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
    </ModalWrapper>
  );
};

export default ToolApprovalModal;
