// ABOUTME: Test utilities for mocking fetch responses with superjson compatibility
// ABOUTME: Provides Response mocks that work with parseResponse() function

import { stringify } from 'superjson';

export interface MockResponseOptions {
  ok?: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
}

/**
 * Creates a mock Response object that works with our parseResponse() function
 * Automatically serializes data using superjson
 */
export function createMockResponse<T>(data: T, options: MockResponseOptions = {}): Response {
  const {
    ok = true,
    status = ok ? 200 : 400,
    statusText = ok ? 'OK' : 'Bad Request',
    headers = {},
  } = options;

  const serializedData = stringify(data);

  return {
    ok,
    status,
    statusText,
    headers: new Headers({
      'Content-Type': 'application/json',
      ...headers,
    }),
    text: () => Promise.resolve(serializedData),
    json: () => Promise.resolve(JSON.parse(serializedData)), // Fallback for legacy tests
    blob: () => Promise.resolve(new Blob([serializedData])),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    formData: () => Promise.resolve(new FormData()),
    clone: () => createMockResponse(data, options),
    body: null,
    bodyUsed: false,
    redirected: false,
    type: 'basic' as ResponseType,
    url: '',
  } as Response;
}

/**
 * Creates an error response mock
 */
export function createMockErrorResponse(
  error: string,
  options: Omit<MockResponseOptions, 'ok'> = {}
): Response {
  return createMockResponse({ error }, { ...options, ok: false, status: options.status || 400 });
}

/**
 * Creates a fetch mock function that handles common API patterns
 */
export function createFetchMock(routes: Record<string, unknown>) {
  return (url: string | URL) => {
    const urlString = typeof url === 'string' ? url : url.toString();

    for (const [pattern, data] of Object.entries(routes)) {
      if (urlString.includes(pattern)) {
        return Promise.resolve(createMockResponse(data));
      }
    }

    // Default to unhandled/loading state
    return new Promise<Response>(() => {});
  };
}
