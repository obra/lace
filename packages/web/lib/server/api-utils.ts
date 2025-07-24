// ABOUTME: Shared utilities for API route handlers
// ABOUTME: Provides validation, serialization, and common patterns for RESTful endpoints

import { z } from 'zod';
import { NextResponse } from 'next/server';
import { logger } from '~/utils/logger';
import type { Task } from '@/types/api';

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
});

export const UpdateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'blocked']).optional(),
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

// Date serialization utility
export function serializeDate(date: Date | string | undefined): string | undefined {
  if (!date) return undefined;
  return date instanceof Date ? date.toISOString() : date;
}

// Task serialization utility
export function serializeTask(task: Task): Task {
  return {
    ...task,
    createdAt: serializeDate(task.createdAt),
    updatedAt: serializeDate(task.updatedAt),
    notes: task.notes?.map((note) => ({
      ...note,
      timestamp: serializeDate(note.timestamp),
    })),
  } as Task;
}

// Error response helper
export function createErrorResponse(message: string, status: number = 400, error?: unknown) {
  logger.error(`API Error: ${message}`, { status, error });
  return NextResponse.json({ error: message }, { status });
}

// Success response helper
export function createSuccessResponse<T>(data: T, status: number = 200) {
  return NextResponse.json(data, { status });
}
