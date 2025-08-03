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

// Request types (inferred from validation schemas) - ONLY PLACE THESE EXIST
// These are derived from Zod schemas and don't exist anywhere else
export type ToolCallId = z.infer<typeof ToolCallIdSchema>;
export type MessageRequest = z.infer<typeof MessageRequestSchema>;
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequestSchema>;
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;
export type SpawnAgentRequest = z.infer<typeof SpawnAgentRequestSchema>;
