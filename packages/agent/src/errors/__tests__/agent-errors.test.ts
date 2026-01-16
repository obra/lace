// ABOUTME: Tests for typed error classes

import { describe, it, expect } from 'vitest';
import { SessionStorageError, RpcError } from '../agent-errors';

describe('SessionStorageError', () => {
  it('has correct code property', () => {
    const error = new SessionStorageError('Storage failed', '/path/to/sessions');
    expect(error.code).toBe('SessionStorageUnavailable');
    expect(error.path).toBe('/path/to/sessions');
    expect(error.message).toBe('Storage failed');
    expect(error.name).toBe('SessionStorageError');
  });

  it('is instanceof Error', () => {
    const error = new SessionStorageError('Test', '/path');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(SessionStorageError);
  });
});

describe('RpcError', () => {
  it('has correct properties', () => {
    const error = new RpcError('Not found', -32602, { category: 'protocol' });
    expect(error.code).toBe(-32602);
    expect(error.data).toEqual({ category: 'protocol' });
    expect(error.message).toBe('Not found');
    expect(error.name).toBe('RpcError');
  });

  it('works without data', () => {
    const error = new RpcError('Simple error', -32600);
    expect(error.code).toBe(-32600);
    expect(error.data).toBeUndefined();
  });
});
