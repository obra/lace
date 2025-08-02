// ABOUTME: Web-specific request types inferred from Zod validation schemas
// ABOUTME: Contains ONLY types that are unique to web and derived from schemas

import { z } from 'zod';
import {
  MessageRequestSchema,
  CreateTaskRequestSchema,
  UpdateTaskRequestSchema,
  CreateSessionRequestSchema,
  SpawnAgentRequestSchema,
  ToolCallIdSchema,
} from '@/lib/validation/schemas';

// Import only what we need for the SerializedTask type
import type { Task } from '@/types/core';

// Request types (inferred from validation schemas) - ONLY PLACE THESE EXIST
// These are derived from Zod schemas and don't exist anywhere else
export type ToolCallId = z.infer<typeof ToolCallIdSchema>;
export type MessageRequest = z.infer<typeof MessageRequestSchema>;
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequestSchema>;
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;
export type SpawnAgentRequest = z.infer<typeof SpawnAgentRequestSchema>;

// Serialized task type (dates as strings for JSON transport)
// This is specific to web serialization and doesn't belong in core or api.ts
export type SerializedTask = Omit<Task, 'createdAt' | 'updatedAt' | 'notes'> & {
  createdAt: string | undefined;
  updatedAt: string | undefined;
  notes: Array<Omit<Task['notes'][0], 'timestamp'> & { timestamp: string | undefined }>;
};
