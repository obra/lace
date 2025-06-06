// ABOUTME: Modal component for tool execution approval in Ink UI
// ABOUTME: Replaces console prompts with visual modal interface for better UX

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Select, TextInput } from '@inkjs/ui';

interface ToolCall {
  name: string;
  input: Record<string, any>;
  description?: string;
}

interface ToolApprovalModalProps {
  toolCall: ToolCall;
  riskLevel: 'low' | 'medium' | 'high';
  context?: {
    reasoning?: string;
  };
  onApprove: (modifiedCall?: ToolCall, comment?: string) => void;
  onDeny: (reason?: string) => void;
  onStop: () => void;
}

const ToolApprovalModal: React.FC<ToolApprovalModalProps> = ({
  toolCall,
  riskLevel,
  context,
  onApprove,
  onDeny,
  onStop
}) => {
  const [mode, setMode] = useState<'select' | 'modify' | 'comment'>('select');
  const [modifiedParams, setModifiedParams] = useState(JSON.stringify(toolCall.input, null, 2));
  const [comment, setComment] = useState('');
  
  const options = [
    { label: 'Yes, execute as-is', value: 'approve' },
    { label: 'Yes, but modify arguments', value: 'modify' },
    { label: 'Yes, with comment after', value: 'comment' },
    { label: 'No, skip this tool', value: 'deny' },
    { label: 'No, stop and give instructions', value: 'stop' }
  ];

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'high': return 'red';
      case 'medium': return 'yellow';
      case 'low': return 'green';
      default: return 'white';
    }
  };

  const formatParameters = (params: Record<string, any>) => {
    return Object.entries(params).map(([key, value]) => {
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      return `${key}: ${stringValue}`;
    }).join('\n');
  };

  const handleSelectChange = (value: string) => {
    switch (value) {
      case 'approve':
        onApprove(toolCall);
        break;
      case 'modify':
        setMode('modify');
        break;
      case 'comment':
        setMode('comment');
        break;
      case 'deny':
        onDeny('User denied tool execution');
        break;
      case 'stop':
        onStop();
        break;
    }
  };

  // Handle escape key to go back to select mode
  useInput((input, key) => {
    if (!isInputActive('tool-approval')) return;
    
    if (key.escape && mode !== 'select') {
      setMode('select');
    }
  }, [isInputActive, mode]);

  // Handle mode transitions and initial focus
  React.useEffect(() => {
    // Activate tool approval input when modal appears
    setActiveInput('tool-approval');
  }, [setActiveInput]);

  React.useEffect(() => {
    if (mode !== 'select') {
      setActiveInput('tool-approval');
    }
  }, [mode, setActiveInput]);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      padding={1}
      marginX={2}
      marginY={1}
    >
      {/* Header */}
      <Box justifyContent="center" marginBottom={1}>
        <Text bold color="yellow">Tool Execution Request</Text>
      </Box>

      {/* Tool Information */}
      <Box flexDirection="column" marginBottom={1}>
        <Box marginBottom={1}>
          <Text bold color="blue">Tool: </Text>
          <Text>{toolCall.name}</Text>
        </Box>
        
        {toolCall.description && (
          <Box marginBottom={1}>
            <Text bold color="blue">Description: </Text>
            <Text>{toolCall.description}</Text>
          </Box>
        )}

        <Box marginBottom={1}>
          <Text bold color="blue">Risk Level: </Text>
          <Text color={getRiskColor(riskLevel)}>{riskLevel.toUpperCase()}</Text>
        </Box>

        {context?.reasoning && (
          <Box marginBottom={1}>
            <Text bold color="blue">Agent Reasoning: </Text>
            <Text color="dim">{context.reasoning}</Text>
          </Box>
        )}
      </Box>

      {/* Parameters */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="blue">Parameters:</Text>
        <Box borderStyle="single" borderColor="gray" padding={1} marginTop={1}>
          <Text color="gray">{formatParameters(toolCall.input)}</Text>
        </Box>
      </Box>

      {/* Mode-specific content */}
      {mode === 'select' && (
        <Box flexDirection="column">
          <Text bold color="blue" marginBottom={1}>Choose an action:</Text>
          <Select 
            options={options} 
            onChange={handleSelectChange}
            isDisabled={!isFocused}
          />
        </Box>
      )}

      {mode === 'modify' && (
        <>
          <Box flexDirection="column">
            <Text bold color="blue" marginBottom={1}>Modify Parameters (JSON):</Text>
            <TextInput
              value={modifiedParams}
              onChange={setModifiedParams}
              onSubmit={(value) => {
                try {
                  const parsed = JSON.parse(value);
                  const modifiedCall = { ...toolCall, input: parsed };
                  onApprove(modifiedCall);
                } catch (error) {
                  // Invalid JSON, just use original
                  onApprove(toolCall);
                }
              }}
              isDisabled={!isInputActive('tool-approval')}
              placeholder="Enter JSON parameters..."
            />
          </Box>
          <Box justifyContent="center" marginTop={1}>
            <Text color="dim">Edit JSON, Enter to approve, Esc to cancel</Text>
          </Box>
        </>
      )}

      {mode === 'comment' && (
        <>
          <Box flexDirection="column">
            <Text bold color="blue" marginBottom={1}>Add Comment:</Text>
            <TextInput
              value={comment}
              onChange={setComment}
              onSubmit={(value) => onApprove(toolCall, value)}
              isDisabled={!isInputActive('tool-approval')}
              placeholder="Enter your comment..."
            />
          </Box>
          <Box justifyContent="center" marginTop={1}>
            <Text color="dim">Type your comment, Enter to approve with comment, Esc to cancel</Text>
          </Box>
        </>
      )}
    </Box>
  );
};

export default ToolApprovalModal;