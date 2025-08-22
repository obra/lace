// ABOUTME: Zod schemas for API validation
// ABOUTME: Provides runtime type validation for API endpoints

import { z } from 'zod';
import { isValidThreadId } from '@/lib/validation/thread-id-validation';

// Thread ID schema using client-safe validation with transform
export const ThreadIdSchema = z
  .string()
  .refine(
    (value) => isValidThreadId(value),
    'Invalid thread ID format. Expected: lace_YYYYMMDD_randomId, UUID, or either with .number suffix'
  );

// Tool Call ID schema for API validation
export const ToolCallIdSchema = z
  .string()
  .min(1, 'toolCallId cannot be empty')
  .regex(
    /^[a-zA-Z0-9_.:/-]+$/,
    'Invalid toolCallId format. Expected alphanumeric characters, underscores, hyphens, periods, and colons only'
  );

// Message request schema with size limits
export const MessageRequestSchema = z.object({
  message: z
    .string()
    .min(1, 'Message cannot be empty')
    .max(10000, 'Message too long (max 10000 characters)'),
});
