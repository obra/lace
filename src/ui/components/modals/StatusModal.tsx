// ABOUTME: Self-contained modal component for displaying agent status information  
// ABOUTME: Handles its own formatting logic for status, context usage, and pricing data

import React from "react";
import { Box, Text } from "ink";

interface AgentInfo {
  role: string;
  model: string;
  provider: string;
  generation: number;
}

interface ContextUsage {
  used: number;
  total: number;
  percentage: number;
  remaining: number;
  approachingHandoff?: boolean;
}

interface PricingInfo {
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  currentContextCost?: number | null;
}

interface StatusData {
  agentInfo: AgentInfo;
  contextUsage?: ContextUsage;
  pricingInfo?: PricingInfo;
}

interface StatusModalProps {
  data: StatusData;
  onClose: () => void;
}

export const StatusModal: React.FC<StatusModalProps> = ({ data, onClose }) => {
  const formatContent = (data: StatusData): string => {
    const { agentInfo, contextUsage, pricingInfo } = data;

    let content = "🤖 Agent Status:\n";
    content += `  Role: ${agentInfo.role}\n`;
    content += `  Model: ${agentInfo.model}\n`;
    content += `  Provider: ${agentInfo.provider}\n`;
    content += `  Generation: ${agentInfo.generation}\n`;

    if (contextUsage) {
      content += "\n📊 Context Window Usage:\n";
      content += `  Used: ${contextUsage.used.toLocaleString()} tokens\n`;
      content += `  Total: ${contextUsage.total.toLocaleString()} tokens\n`;
      content += `  Usage: ${contextUsage.percentage.toFixed(1)}%\n`;
      content += `  Remaining: ${contextUsage.remaining.toLocaleString()} tokens\n`;

      if (contextUsage.approachingHandoff) {
        content += "  ⚠️ Context approaching handoff threshold!\n";
      }
    }

    if (pricingInfo) {
      content += "\n💰 Model Pricing:\n";
      content += `  Input: $${pricingInfo.inputPricePerMillion.toFixed(2)} per million tokens\n`;
      content += `  Output: $${pricingInfo.outputPricePerMillion.toFixed(2)} per million tokens\n`;

      if (pricingInfo.currentContextCost !== null && pricingInfo.currentContextCost !== undefined) {
        content += `  Current context cost: ~$${pricingInfo.currentContextCost.toFixed(4)}\n`;
      }
    }

    return content;
  };

  return (
    <Box
      borderStyle="round"
      borderColor="blue"
      padding={1}
    >
      <Text>{formatContent(data)}</Text>
    </Box>
  );
};

export default StatusModal;