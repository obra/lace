// ABOUTME: Self-contained modal component for displaying conversation history
// ABOUTME: Handles its own formatting logic for memory and message history

import React from "react";
import { Box, Text } from "ink";

interface HistoryMessage {
  timestamp?: string;
  role: string;
  content: string;
}

interface MemoryData {
  history: HistoryMessage[];
}

interface MemoryModalProps {
  data: MemoryData;
  onClose: () => void;
}

export const MemoryModal: React.FC<MemoryModalProps> = ({ data, onClose }) => {
  const formatContent = (data: MemoryData): string => {
    const { history } = data;

    if (!history || history.length === 0) {
      return "🧠 No conversation history found.";
    }

    let content = `🧠 Conversation History (${history.length} messages):\n\n`;

    history.forEach((msg, index) => {
      const timestamp = msg.timestamp
        ? new Date(msg.timestamp).toLocaleString()
        : "Unknown time";
      content += `${index + 1}. [${timestamp}] ${msg.role}: ${msg.content.substring(0, 150)}${msg.content.length > 150 ? "..." : ""}\n\n`;
    });

    return content;
  };

  return (
    <Box
      borderStyle="round"
      borderColor="magenta"
      padding={1}
    >
      <Text>{formatContent(data)}</Text>
    </Box>
  );
};

export default MemoryModal;