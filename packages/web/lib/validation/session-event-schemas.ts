// ABOUTME: Zod schemas for SessionEvent validation and date hydration
// ABOUTME: Transforms string timestamps to Date objects during JSON parsing

import { z } from 'zod';
import type { SessionEvent } from '@/types/web-sse';
import type { ThreadId } from '@/types/core';
import type { ToolResult } from '@/types/core';

// ThreadId schema (assumes string validation exists elsewhere)
const ThreadIdSchema = z.string() as unknown as z.ZodType<ThreadId>;

// Timestamp schema - converts ISO strings to Date objects for internal consistency
const DateTimeSchema = z.union([
  z.date(), // Keep Date as-is
  z
    .string()
    .datetime()
    .transform((str) => new Date(str)), // Convert ISO string to Date
]);

// Event data schemas
const UserMessageEventDataSchema = z.object({
  content: z.string(),
});

const AgentMessageEventDataSchema = z.object({
  content: z.string(),
});

const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.unknown()),
});

const ToolResultSchema = z.unknown() as unknown as z.ZodType<ToolResult>;

const ToolAggregatedEventDataSchema = z.object({
  call: ToolCallSchema,
  result: ToolResultSchema.optional(),
  toolName: z.string(),
  toolId: z.string().optional(),
  arguments: z.unknown().optional(),
});

const LocalSystemMessageEventDataSchema = z.object({
  content: z.string(),
});

const AgentTokenEventDataSchema = z.object({
  token: z.string(),
});

const AgentStreamingEventDataSchema = z.object({
  content: z.string(),
});

const ToolApprovalRequestDataSchema = z.object({
  requestId: z.string(),
  toolName: z.string(),
  input: z.unknown(),
  isReadOnly: z.boolean(),
  toolDescription: z.string().optional(),
  toolAnnotations: z
    .object({
      title: z.string().optional(),
      readOnlyHint: z.boolean().optional(),
      destructiveHint: z.boolean().optional(),
      idempotentHint: z.boolean().optional(),
      safeInternal: z.boolean().optional(),
    })
    .optional(),
  riskLevel: z.enum(['safe', 'moderate', 'destructive']),
});

const ToolApprovalResponseDataSchema = z.object({
  toolCallId: z.string(),
  decision: z.string(),
});

const SystemPromptEventDataSchema = z.object({
  content: z.string(),
});

const UserSystemPromptEventDataSchema = z.object({
  content: z.string(),
});

const CompactionEventDataSchema = z.object({
  strategyId: z.string(),
  originalEventCount: z.number(),
  compactedEvents: z.array(z.unknown()),
  metadata: z.record(z.unknown()).optional(),
});

// Discriminated union schema for SessionEvent
export const SessionEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('USER_MESSAGE'),
    threadId: ThreadIdSchema,
    timestamp: DateTimeSchema,
    data: UserMessageEventDataSchema,
  }),
  z.object({
    type: z.literal('AGENT_MESSAGE'),
    threadId: ThreadIdSchema,
    timestamp: DateTimeSchema,
    data: AgentMessageEventDataSchema,
  }),
  z.object({
    type: z.literal('TOOL_CALL'),
    threadId: ThreadIdSchema,
    timestamp: DateTimeSchema,
    data: ToolCallSchema,
  }),
  z.object({
    type: z.literal('TOOL_RESULT'),
    threadId: ThreadIdSchema,
    timestamp: DateTimeSchema,
    data: ToolResultSchema,
  }),
  z.object({
    type: z.literal('TOOL_AGGREGATED'),
    threadId: ThreadIdSchema,
    timestamp: DateTimeSchema,
    data: ToolAggregatedEventDataSchema,
  }),
  z.object({
    type: z.literal('LOCAL_SYSTEM_MESSAGE'),
    threadId: ThreadIdSchema,
    timestamp: DateTimeSchema,
    data: LocalSystemMessageEventDataSchema,
  }),
  z.object({
    type: z.literal('AGENT_TOKEN'),
    threadId: ThreadIdSchema,
    timestamp: DateTimeSchema,
    data: AgentTokenEventDataSchema,
  }),
  z.object({
    type: z.literal('AGENT_STREAMING'),
    threadId: ThreadIdSchema,
    timestamp: DateTimeSchema,
    data: AgentStreamingEventDataSchema,
  }),
  z.object({
    type: z.literal('TOOL_APPROVAL_REQUEST'),
    threadId: ThreadIdSchema,
    timestamp: DateTimeSchema,
    data: ToolApprovalRequestDataSchema,
  }),
  z.object({
    type: z.literal('TOOL_APPROVAL_RESPONSE'),
    threadId: ThreadIdSchema,
    timestamp: DateTimeSchema,
    data: ToolApprovalResponseDataSchema,
  }),
  z.object({
    type: z.literal('SYSTEM_PROMPT'),
    threadId: ThreadIdSchema,
    timestamp: DateTimeSchema,
    data: SystemPromptEventDataSchema,
  }),
  z.object({
    type: z.literal('USER_SYSTEM_PROMPT'),
    threadId: ThreadIdSchema,
    timestamp: DateTimeSchema,
    data: UserSystemPromptEventDataSchema,
  }),
  z.object({
    type: z.literal('COMPACTION'),
    threadId: ThreadIdSchema,
    timestamp: DateTimeSchema,
    data: CompactionEventDataSchema,
  }),
  z.object({
    type: z.literal('COMPACTION_START'),
    threadId: ThreadIdSchema,
    timestamp: DateTimeSchema,
    data: z.object({
      strategy: z.string(),
      auto: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal('COMPACTION_COMPLETE'),
    threadId: ThreadIdSchema,
    timestamp: DateTimeSchema,
    data: z.object({
      success: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal('AGENT_STATE_CHANGE'),
    threadId: ThreadIdSchema,
    timestamp: DateTimeSchema,
    data: z.object({
      agentId: ThreadIdSchema,
      from: z.string(),
      to: z.string(),
    }),
  }),
]);

// StreamEvent timestamp schema (for the outer StreamEvent wrapper)
export const StreamEventTimestampSchema = DateTimeSchema;

// Helper function to safely parse SessionEvent from JSON
export function parseSessionEvent(data: unknown): SessionEvent {
  return SessionEventSchema.parse(data);
}

// Helper function to safely parse array of SessionEvents
export function parseSessionEvents(data: unknown[]): SessionEvent[] {
  return data.map(parseSessionEvent);
}
