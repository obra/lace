// ABOUTME: Route helper utilities for extracting and validating common route parameters
// ABOUTME: Provides typed error classes for cleaner route handlers with testable error responses

import { createErrorResponse } from './api-utils';
import {
  isWorkspaceSessionId,
  isAgentSessionId,
} from '@lace/web/lib/validation/session-id-validation';

/**
 * Custom error class for route validation errors.
 * Includes HTTP status code and error code for conversion to Response.
 */
export class RouteValidationError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string
  ) {
    super(message);
    this.name = 'RouteValidationError';
  }

  toResponse(): Response {
    return createErrorResponse(this.message, this.status, { code: this.code });
  }
}

/**
 * Extracts a required route parameter, throwing RouteValidationError if missing.
 */
export function requireParam(params: Record<string, string | undefined>, name: string): string {
  const value = params[name];
  if (!value || value.trim() === '') {
    throw new RouteValidationError(`${name} is required`, 400, 'VALIDATION_FAILED');
  }
  return value;
}

/**
 * Extracts and validates a sessionId parameter (workspace session format).
 * Throws RouteValidationError if missing or invalid format.
 */
export function requireSessionId(params: Record<string, string | undefined>): string {
  const sessionId = requireParam(params, 'sessionId');
  if (!isWorkspaceSessionId(sessionId)) {
    throw new RouteValidationError('Invalid session ID', 400, 'VALIDATION_FAILED');
  }
  return sessionId;
}

/**
 * Extracts and validates a projectId parameter.
 * Throws RouteValidationError if missing or empty.
 */
export function requireProjectId(params: Record<string, string | undefined>): string {
  return requireParam(params, 'projectId');
}

/**
 * Extracts and validates an agentId parameter (agent session format).
 * Throws RouteValidationError if missing or invalid format.
 */
export function requireAgentId(params: Record<string, string | undefined>): string {
  const agentId = requireParam(params, 'agentId');
  if (!isAgentSessionId(agentId)) {
    throw new RouteValidationError('Invalid agent ID', 400, 'VALIDATION_FAILED');
  }
  return agentId;
}

/**
 * Extracts and validates a threadId parameter (agent session format).
 * Thread IDs are agent session IDs accessed via the threadId URL parameter.
 * Throws RouteValidationError if missing or invalid format.
 */
export function requireThreadId(params: Record<string, string | undefined>): string {
  const threadId = requireParam(params, 'threadId');
  if (!isAgentSessionId(threadId)) {
    throw new RouteValidationError('Invalid thread ID format', 400, 'VALIDATION_FAILED');
  }
  return threadId;
}

/**
 * Throws a RouteValidationError for a missing resource.
 * @param entity - The type of entity that wasn't found (e.g., 'Session', 'Project', 'Agent')
 */
export function throwNotFound(entity: string): never {
  throw new RouteValidationError(`${entity} not found`, 404, 'RESOURCE_NOT_FOUND');
}

/**
 * Throws a RouteValidationError for unsupported HTTP methods.
 */
export function throwMethodNotAllowed(): never {
  throw new RouteValidationError('Method not allowed', 405, 'METHOD_NOT_ALLOWED');
}

/**
 * Converts a caught error to an appropriate Response.
 * Use in catch blocks to handle RouteValidationError and other errors uniformly.
 */
export function errorToResponse(
  error: unknown,
  fallbackMessage: string = 'Internal server error'
): Response {
  if (error instanceof RouteValidationError) {
    return error.toResponse();
  }
  const message = error instanceof Error ? error.message : fallbackMessage;
  return createErrorResponse(message, 500, { code: 'INTERNAL_SERVER_ERROR' });
}
