// ABOUTME: ThreadId validation using core functions
// ABOUTME: Wrapper around core validation for web package convenience

import { isThreadId, asThreadId } from '@/types/core';

// Re-export core functions with web-friendly names
export const isValidThreadId = isThreadId;
export const asValidThreadId = asThreadId;
