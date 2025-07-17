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

// Message request schema with size limits
export const MessageRequestSchema = z.object({
  message: z
    .string()
    .min(1, 'Message cannot be empty')
    .max(10000, 'Message too long (max 10000 characters)'),
  metadata: z
    .object({
      source: z.enum(['web', 'cli', 'api']).optional(),
      timestamp: z.string().datetime().optional(),
    })
    .optional(),
});

// Task request schemas with proper validation
export const CreateTaskRequestSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long (max 200 characters)'),
  description: z
    .string()
    .max(1000, 'Description too long (max 1000 characters)')
    .optional()
    .default(''),
  prompt: z
    .string()
    .min(1, 'Prompt is required')
    .max(5000, 'Prompt too long (max 5000 characters)'),
  priority: z.enum(['high', 'medium', 'low']).optional().default('medium'),
  assignedTo: z
    .string()
    .regex(/^lace_\d{8}_[a-z0-9]+(\.\d+)?$/, 'Invalid assignee ID format')
    .optional(),
});

export const UpdateTaskRequestSchema = z.object({
  title: z.string().min(1).max(200, 'Title too long').optional(),
  description: z.string().max(1000, 'Description too long').optional(),
  prompt: z.string().min(1).max(5000, 'Prompt too long').optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'blocked']).optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  assignedTo: z
    .string()
    .regex(/^lace_\d{8}_[a-z0-9]+(\.\d+)?$/, 'Invalid assignee ID')
    .nullable()
    .optional(),
});

// Session request schema with validation
export const CreateSessionRequestSchema = z.object({
  name: z.string().max(100, 'Name too long (max 100 characters)').optional(),
  provider: z.string().min(1).max(50, 'Provider name too long').optional(),
  model: z.string().min(1).max(100, 'Model name too long').optional(),
});

// Agent spawn request schema with validation
export const SpawnAgentRequestSchema = z.object({
  provider: z.string().min(1, 'Provider is required').max(50, 'Provider name too long'),
  model: z.string().min(1, 'Model is required').max(100, 'Model name too long'),
  isCoordinator: z.boolean().optional().default(false),
});

// Type exports for use in code
export type ThreadId = z.infer<typeof ThreadIdSchema>;
export type MessageRequest = z.infer<typeof MessageRequestSchema>;
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequestSchema>;
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;
export type SpawnAgentRequest = z.infer<typeof SpawnAgentRequestSchema>;
