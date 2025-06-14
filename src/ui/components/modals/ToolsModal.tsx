// ABOUTME: Self-contained modal component for displaying available tools
// ABOUTME: Handles its own formatting logic for tool names and descriptions

import React from "react";
import { Box, Text } from "ink";

interface Tool {
  name: string;
  description: string;
}

interface ToolsData {
  tools: Tool[];
}

interface ToolsModalProps {
  data: ToolsData;
  onClose: () => void;
}

export const ToolsModal: React.FC<ToolsModalProps> = ({ data, onClose }) => {
  const formatContent = (data: ToolsData): string => {
    const { tools } = data;

    if (!tools || tools.length === 0) {
      return "🛠️ No tools available.";
    }

    let content = `🛠️ Available Tools (${tools.length}):\n\n`;

    tools.forEach((tool, index) => {
      content += `${index + 1}. ${tool.name}\n`;
      content += `   ${tool.description}\n\n`;
    });

    return content;
  };

  return (
    <Box
      borderStyle="round"
      borderColor="yellow"
      padding={1}
    >
      <Text>{formatContent(data)}</Text>
    </Box>
  );
};

export default ToolsModal;