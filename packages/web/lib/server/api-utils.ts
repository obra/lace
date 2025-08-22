// ABOUTME: Shared utilities for API route handlers
// ABOUTME: Provides validation, serialization, and common patterns for RESTful endpoints

import { z } from 'zod';
import { logger } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { TASK_STATUS_VALUES } from '@/types/core';

// Route parameter validation schemas
export const ProjectIdSchema = z.string().uuid('Invalid project ID format');
export const SessionIdSchema = z
  .string()
  .regex(/^lace_\d{8}_[a-z0-9]{6}(\.\d+)*$/, 'Invalid session ID format');
export const TaskIdSchema = z.string().min(1, 'Task ID cannot be empty');

// Request body validation schemas
export const CreateTaskSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  prompt: z.string().min(1, 'Prompt is required'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  assignedTo: z.string().optional(),
});

export const UpdateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(TASK_STATUS_VALUES as [string, ...string[]]).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  assignedTo: z.string().optional(),
});

export const AddNoteSchema = z.object({
  content: z.string().min(1, 'Note content is required'),
  author: z.string().optional(),
});

// Validation helper
export async function validateRouteParams<T>(
  params: Promise<unknown>,
  schema: z.ZodSchema<T>
): Promise<T> {
  try {
    const resolvedParams = await params;
    return schema.parse(resolvedParams);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join(', ');
      logger.error('Route parameter validation failed', { error: messages, params: await params });
      throw new Error(`Invalid route parameters: ${messages}`);
    }
    logger.error('Route parameter validation failed', { error, params });
    throw new Error('Invalid route parameters');
  }
}

export function validateRequestBody<T>(body: unknown, schema: z.ZodSchema<T>): T {
  try {
    return schema.parse(body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join(', ');
      logger.error('Request body validation failed', { error: messages, body });
      throw new Error(`Invalid request body: ${messages}`);
    }
    logger.error('Request body validation failed', { error, body });
    throw new Error('Invalid request body');
  }
}

// Error response helper
export function createErrorResponse(
  message: string,
  status: number = 400,
  options?: { code?: string; error?: unknown; details?: unknown }
) {
  logger.error(`API Error: ${message}`, { status, code: options?.code, error: options?.error });
  const response: { error: string; code?: string; details?: unknown } = { error: message };
  if (options?.code) response.code = options.code;
  if (options?.details) response.details = options.details;

  return createSuperjsonResponse(response, { status });
}

// Success response helper
export function createSuccessResponse<T>(data: T, status: number = 200) {
  return createSuperjsonResponse(data, { status });
}
