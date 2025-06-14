// ABOUTME: Self-contained modal component for displaying help information
// ABOUTME: Handles its own formatting logic for help text content

import React from "react";
import { Box, Text } from "ink";

interface HelpData {
  helpText?: string;
}

interface HelpModalProps {
  data: HelpData;
  onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ data, onClose }) => {
  const formatContent = (data: HelpData): string => {
    return data.helpText || "Help information not available.";
  };

  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      padding={1}
    >
      <Text>{formatContent(data)}</Text>
    </Box>
  );
};

export default HelpModal;