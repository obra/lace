// ABOUTME: Shared utilities for API route handlers
// ABOUTME: Provides validation, serialization, and common patterns for RESTful endpoints

import { z } from 'zod';
import { logger } from '@lace/agent/utils/logger';
import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';

// Route parameter validation schemas
export const ProjectIdSchema = z.string().uuid('Invalid project ID format');

// Validation helper
export function validateRouteParams<T>(params: unknown, schema: z.ZodSchema<T>): T {
  try {
    return schema.parse(params);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join(', ');
      logger.error('Route parameter validation failed', { error: messages, params });
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
