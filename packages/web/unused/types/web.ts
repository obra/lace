// ABOUTME: Web-specific request types inferred from Zod validation schemas
// ABOUTME: Contains ONLY types that are unique to web and derived from schemas

import { z } from 'zod';
import {
  CreateTaskRequestSchema,
  UpdateTaskRequestSchema,
  SpawnAgentRequestSchema,
  ToolCallIdSchema,
} from '@/lib/validation/schemas';

// Request types (inferred from validation schemas) - ONLY for types not in api.ts
// Note: MessageRequest and CreateSessionRequest are defined in @/types/api
export type ToolCallId = z.infer<typeof ToolCallIdSchema>;
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequestSchema>;
export type SpawnAgentRequest = z.infer<typeof SpawnAgentRequestSchema>;
