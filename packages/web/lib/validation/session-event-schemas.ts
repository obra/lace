// ABOUTME: Zod schemas for SessionEvent validation and date hydration
// ABOUTME: Transforms string timestamps to Date objects during JSON parsing

import { z } from 'zod';
import type { SessionEvent } from '@/types/web-sse';
import type { ThreadId } from '@/types/core';
import type { ToolResult } from '@/types/core';
import { ApprovalDecision } from '@/types/core';

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

// Event data schemas - USER_MESSAGE is just a string per ThreadEvent type

const AgentMessageDataSchema = z.object({
  content: z.string(),
  tokenUsage: z
    .object({
      message: z
        .object({
          promptTokens: z.number(),
          completionTokens: z.number(),
          totalTokens: z.number(),
        })
        .optional(),
      thread: z.object({
        totalPromptTokens: z.number(),
        totalCompletionTokens: z.number(),
        totalTokens: z.number(),
        contextLimit: z.number(),
        percentUsed: z.number(),
        nearLimit: z.boolean(),
      }),
    })
    .optional(),
});

const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.unknown()),
});

const ToolResultSchema = z.unknown() as unknown as z.ZodType<ToolResult>;

// LOCAL_SYSTEM_MESSAGE data is just a string per ThreadEvent type

const AgentTokenEventDataSchema = z.object({
  token: z.string(),
});

const AgentStreamingEventDataSchema = z.object({
  content: z.string(),
});


const ToolApprovalResponseDataSchema = z.object({
  toolCallId: z.string(),
  decision: z.nativeEnum(ApprovalDecision),
});

// SYSTEM_PROMPT and USER_SYSTEM_PROMPT data are just strings per ThreadEvent type

// We need to use z.lazy to avoid circular dependency since ThreadEvent contains CompactionData
// which contains ThreadEvent[]
const CompactionEventDataSchema = z.object({
  strategyId: z.string(),
  originalEventCount: z.number(),
  compactedEvents: z.array(z.lazy(() => SessionEventSchema)),
  metadata: z.record(z.unknown()).optional(),
});

// Discriminated union schema for SessionEvent
export const SessionEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('USER_MESSAGE'),
    threadId: ThreadIdSchema,
    timestamp: DateTimeSchema,
    data: z.string(), // USER_MESSAGE data is just a string
  }),
  z.object({
    type: z.literal('AGENT_MESSAGE'),
    threadId: ThreadIdSchema,
    timestamp: DateTimeSchema,
    data: AgentMessageDataSchema,
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
    type: z.literal('LOCAL_SYSTEM_MESSAGE'),
    threadId: ThreadIdSchema,
    timestamp: DateTimeSchema,
    data: z.string(), // LOCAL_SYSTEM_MESSAGE data is just a string,
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
    data: z.object({
      toolCallId: z.string(),
    }),
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
    data: z.string(), // SYSTEM_PROMPT data is just a string,
  }),
  z.object({
    type: z.literal('USER_SYSTEM_PROMPT'),
    threadId: ThreadIdSchema,
    timestamp: DateTimeSchema,
    data: z.string(), // USER_SYSTEM_PROMPT data is just a string,
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

// ThreadEvent timestamp schema
export const ThreadEventTimestampSchema = DateTimeSchema;

// Helper function to safely parse SessionEvent from JSON
export function parseSessionEvent(data: unknown): SessionEvent {
  return SessionEventSchema.parse(data);
}

// Helper function to safely parse array of SessionEvents
export function parseSessionEvents(data: unknown[]): SessionEvent[] {
  return data.map(parseSessionEvent);
}
