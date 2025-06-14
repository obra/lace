// ABOUTME: Self-contained modal component for displaying recent activity log
// ABOUTME: Handles its own formatting logic for activity events and data

import React from "react";
import { Box, Text } from "ink";

interface ActivityEvent {
  timestamp: string;
  event_type: string;
  data?: string | object;
}

interface ActivityData {
  activities: ActivityEvent[];
}

interface ActivityModalProps {
  data: ActivityData;
  onClose: () => void;
}

export const ActivityModal: React.FC<ActivityModalProps> = ({ data, onClose }) => {
  const formatContent = (data: ActivityData): string => {
    const { activities } = data;

    if (!activities || activities.length === 0) {
      return "📝 No recent activity found.";
    }

    let content = `📝 Activity Log (${activities.length} events):\n\n`;

    activities.forEach((activity, index) => {
      const timestamp = new Date(activity.timestamp).toLocaleString();
      content += `${index + 1}. [${timestamp}] ${activity.event_type}\n`;

      if (activity.data) {
        try {
          const eventData =
            typeof activity.data === "string"
              ? JSON.parse(activity.data)
              : activity.data;
          if (eventData.input) {
            content += `   Input: ${eventData.input.substring(0, 100)}${eventData.input.length > 100 ? "..." : ""}\n`;
          }
          if (eventData.content) {
            content += `   Content: ${eventData.content.substring(0, 100)}${eventData.content.length > 100 ? "..." : ""}\n`;
          }
        } catch {
          // Ignore parsing errors
        }
      }
      content += "\n";
    });

    return content;
  };

  return (
    <Box
      borderStyle="round"
      borderColor="green"
      padding={1}
    >
      <Text>{formatContent(data)}</Text>
    </Box>
  );
};

export default ActivityModal;