// ABOUTME: Centralized API client that enforces correct error handling patterns
// ABOUTME: Prevents JSON parsing of HTML error pages by checking HTTP status first

import { parseResponse } from '@/lib/serialization';
import { isApiError } from '@/types/api';

/**
 * Internal implementation - enforces correct error handling pattern
 */
async function makeRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);

  // Check HTTP status first - never parse error pages
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  // Only parse when we know it's a successful response
  const data = await parseResponse<T>(response);

  // Check for API business logic errors
  if (isApiError(data)) {
    throw new Error(data.error);
  }

  return data;
}

/**
 * The standard API client for this application.
 * Use these methods for all API calls to ensure proper error handling.
 */
export const api = {
  get: <T>(url: string, options?: Omit<RequestInit, 'method'>) =>
    makeRequest<T>(url, { ...options, method: 'GET' }),

  post: <T>(url: string, body?: unknown, options?: Omit<RequestInit, 'method' | 'body'>) =>
    makeRequest<T>(url, {
      ...options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    }),

  put: <T>(url: string, body?: unknown, options?: Omit<RequestInit, 'method' | 'body'>) =>
    makeRequest<T>(url, {
      ...options,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    }),

  delete: <T>(url: string, options?: Omit<RequestInit, 'method'>) =>
    makeRequest<T>(url, { ...options, method: 'DELETE' }),
} as const;
