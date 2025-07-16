// ABOUTME: Zod schemas for API validation
// ABOUTME: Provides runtime type validation for API endpoints

import { z } from 'zod';

// Thread ID schema with regex validation
export const ThreadIdSchema = z
  .string()
  .regex(
    /^lace_\d{8}_[a-z0-9]+(\.\d+)?$/,
    'Invalid thread ID format. Expected: lace_YYYYMMDD_randomId or lace_YYYYMMDD_randomId.number'
  );

// Message request schema
export const MessageRequestSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty'),
  metadata: z
    .object({
      source: z.enum(['web', 'cli', 'api']).optional(),
      timestamp: z.string().datetime().optional(),
    })
    .optional(),
});

// Task request schemas
export const CreateTaskRequestSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional().default(''),
  prompt: z.string().min(1, 'Prompt is required'),
  priority: z.enum(['high', 'medium', 'low']).optional().default('medium'),
  assignedTo: z.string().optional(),
});

export const UpdateTaskRequestSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  prompt: z.string().min(1).optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'blocked']).optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  assignedTo: z.string().nullable().optional(),
});

// Session request schema
export const CreateSessionRequestSchema = z.object({
  name: z.string().optional(),
  provider: z.string().min(1, 'Provider is required'),
  model: z.string().min(1, 'Model is required'),
});

// Agent spawn request schema
export const SpawnAgentRequestSchema = z.object({
  provider: z.string().min(1, 'Provider is required'),
  model: z.string().min(1, 'Model is required'),
  isCoordinator: z.boolean().optional().default(false),
});

// Type exports for use in code
export type ThreadId = z.infer<typeof ThreadIdSchema>;
export type MessageRequest = z.infer<typeof MessageRequestSchema>;
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequestSchema>;
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;
export type SpawnAgentRequest = z.infer<typeof SpawnAgentRequestSchema>;
