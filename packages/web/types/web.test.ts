// ABOUTME: Test web-specific type definitions
// ABOUTME: Verifies API types and type guards work correctly

import { describe, it, expect } from 'vitest';
import type { Session, MessageRequest } from './web';
import { isApiError, isApiSuccess } from './web';
import { asThreadId } from '@/lib/core';

describe('Web Types', () => {
  it('should create valid Session type', () => {
    const session: Session = {
      id: asThreadId('lace_20250731_abc123'),
      name: 'Test Session',
      createdAt: new Date(),
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      agents: [],
    };

    expect(session.name).toBe('Test Session');
    expect(session.id).toBe('lace_20250731_abc123');
  });

  it('should validate API error responses', () => {
    const errorResponse = { error: 'Something went wrong' };
    const successResponse = { data: { result: 'success' } };

    expect(isApiError(errorResponse)).toBe(true);
    expect(isApiError(successResponse)).toBe(false);
    expect(isApiSuccess(successResponse)).toBe(true);
    expect(isApiSuccess(errorResponse)).toBe(false);
  });

  it('should create valid MessageRequest', () => {
    const request: MessageRequest = {
      message: 'Hello world',
    };

    expect(request.message).toBe('Hello world');
  });
});
