// ABOUTME: Storybook stories for UnknownEventEntry component
// ABOUTME: Shows expandable unknown event messages with various content types and metadata

import type { Meta, StoryObj } from '@storybook/react';
import { UnknownEventEntry } from './UnknownEventEntry';

const meta = {
  title: 'Components/Timeline/UnknownEventEntry',
  component: UnknownEventEntry,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Timeline entry for unknown events with expandable content and metadata display.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    eventType: {
      control: 'text',
      description: 'The type of unknown event',
    },
    content: {
      control: 'text',
      description: 'Event content to display',
    },
    compact: {
      control: 'boolean',
      description: 'Whether to show compact version',
    },
    metadata: {
      control: 'object',
      description: 'Event metadata to show in expandable table',
    },
  },
} satisfies Meta<typeof UnknownEventEntry>;

export default meta;
type Story = StoryObj<typeof meta>;

// Short content that doesn't need truncation
export const Short: Story = {
  args: {
    id: 'unknown-1',
    eventType: 'CUSTOM_EVENT',
    content: 'This is a short unknown event message that fits on one line.',
    timestamp: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
    metadata: {
      source: 'system',
      priority: 'low',
      userId: '12345',
    },
  },
};

// Long content that gets truncated
export const Long: Story = {
  args: {
    id: 'unknown-2',
    eventType: 'COMPLEX_SYSTEM_PROMPT',
    content: `This is a much longer unknown event message that spans multiple lines.
It contains detailed information about what happened.
Line 3 with more details about the event processing.
Line 4 continues with technical details.
Line 5 should be hidden by default due to truncation.
Line 6 contains additional context.
Line 7 has error codes and debugging info.
Line 8 finishes with cleanup information.`,
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
    metadata: {
      eventId: 'evt_12345',
      source: 'background-processor',
      processingTime: 1.234,
      status: 'completed',
      retries: 0,
      context: {
        sessionId: 'session_abc123',
        agentId: 'agent_xyz789',
      },
      timestamp: '2024-01-15T10:30:00.000Z',
    },
  },
};

// JSON-like content
export const JsonContent: Story = {
  args: {
    id: 'unknown-3',
    eventType: 'API_RESPONSE_EVENT',
    content: `{
  "status": "error",
  "code": 500,
  "message": "Internal server error occurred during processing",
  "details": {
    "trace_id": "abc123xyz789",
    "request_id": "req_456",
    "timestamp": "2024-01-15T10:30:00Z"
  },
  "retry_after": 30
}`,
    timestamp: new Date(Date.now() - 15 * 60 * 1000), // 15 minutes ago
    metadata: {
      endpoint: '/api/v1/process',
      method: 'POST',
      statusCode: 500,
      responseTime: 5.234,
      userAgent: 'LaceWebClient/1.0',
    },
  },
};

// Code-like content
export const CodeContent: Story = {
  args: {
    id: 'unknown-4',
    eventType: 'DEBUG_TRACE',
    content: `function processEvent(event) {
  console.log('Processing:', event.type);
  
  if (event.type === 'USER_MESSAGE') {
    return handleUserMessage(event);
  }
  
  throw new Error('Unknown event type: ' + event.type);
}`,
    timestamp: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
    metadata: {
      function: 'processEvent',
      line: 42,
      file: 'event-processor.js',
      stack: ['processEvent', 'handleEvents', 'main'],
    },
  },
};

// Compact version
export const Compact: Story = {
  args: {
    id: 'unknown-5',
    eventType: 'SYSTEM_NOTIFICATION',
    content: `Background task completed successfully.
Processing took 2.3 seconds.
All files were updated correctly.`,
    timestamp: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
    compact: true,
    metadata: {
      taskId: 'task_789',
      duration: 2.3,
    },
  },
};

// No metadata
export const NoMetadata: Story = {
  args: {
    id: 'unknown-6',
    eventType: 'SIMPLE_EVENT',
    content: 'A simple event with no additional metadata.',
    timestamp: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
  },
};

// Complex metadata
export const ComplexMetadata: Story = {
  args: {
    id: 'unknown-7',
    eventType: 'WORKFLOW_STATE_CHANGE',
    content: `Workflow state changed from 'processing' to 'completed'.
All dependent tasks have been notified.
Cleanup procedures initiated.`,
    timestamp: new Date(Date.now() - 45 * 60 * 1000), // 45 minutes ago
    metadata: {
      workflowId: 'wf_abc123',
      previousState: 'processing',
      newState: 'completed',
      stateChangeReason: 'all_tasks_completed',
      affectedTasks: ['task1', 'task2', 'task3'],
      notifications: {
        sent: 3,
        failed: 0,
        pending: 0,
      },
      performance: {
        totalDuration: 125.7,
        memoryUsed: '45.2MB',
        cpuTime: 2.1,
      },
      createdAt: new Date('2024-01-15T09:15:00Z'),
      updatedAt: new Date('2024-01-15T10:30:00Z'),
      isNull: null,
      isUndefined: undefined,
      isEmpty: '',
      isZero: 0,
      isFalse: false,
    },
  },
};