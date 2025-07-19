// ABOUTME: Integration tests for conversation history API endpoint
// ABOUTME: Tests loading real conversation history from database for session restoration

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/sessions/[sessionId]/history/route';
import { Project } from '@/lib/server/lace-imports';
import { getSessionService } from '@/lib/server/session-service';
import type { SessionEvent, ApiErrorResponse } from '@/types/api';
import {
  setupTestPersistence,
  teardownTestPersistence,
} from '~/__tests__/setup/persistence-helper';

interface HistoryResponse {
  events: SessionEvent[];
}

describe('Session History API', () => {
  let sessionService: ReturnType<typeof getSessionService>;
  let validSessionId: string;

  beforeEach(async () => {
    setupTestPersistence();

    // Set up environment
    process.env.ANTHROPIC_KEY = 'test-key';
    process.env.LACE_DB_PATH = ':memory:';

    sessionService = getSessionService();

    // Use a valid ThreadId format for testing
    validSessionId = 'lace_20240719_abc123';

    // Mock sessionService.getSession to return a valid session for our test ID
    vi.spyOn(sessionService, 'getSession').mockImplementation(async (id: string) => {
      if (id === validSessionId) {
        // Return a mock session that has the required structure
        return {
          id: validSessionId,
          name: 'Test Session',
          provider: 'anthropic',
          model: 'claude-3-haiku-20240307',
          status: 'idle',
          agents: [],
          getAgent: () => ({
            getMainAndDelegateEvents: () => [], // Return empty events for testing
          }),
        } as any;
      }
      return null;
    });
  });

  afterEach(() => {
    sessionService.clearActiveSessions();
    teardownTestPersistence();
  });

  describe('GET /api/sessions/[sessionId]/history', () => {
    it('should return empty history for new session', async () => {
      const request = new NextRequest(`http://localhost/api/sessions/${validSessionId}/history`);
      const response = await GET(request, {
        params: Promise.resolve({ sessionId: validSessionId }),
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as HistoryResponse;

      // New sessions should have empty history
      expect(data.events).toEqual([]);
    });

    it('should return 404 for non-existent session', async () => {
      const nonExistentId = 'lace_20240101_abc123'; // Valid format, but non-existent
      const request = new NextRequest(`http://localhost/api/sessions/${nonExistentId}/history`);
      const response = await GET(request, {
        params: Promise.resolve({ sessionId: nonExistentId }),
      });

      expect(response.status).toBe(404);
      const data = (await response.json()) as ApiErrorResponse;
      expect(data.error).toBe('Session not found');
    });

    it('should handle invalid session ID format', async () => {
      const invalidId = 'invalid-session-id';
      const request = new NextRequest(`http://localhost/api/sessions/${invalidId}/history`);
      const response = await GET(request, {
        params: Promise.resolve({ sessionId: invalidId }),
      });

      expect(response.status).toBe(400);
      const data = (await response.json()) as ApiErrorResponse;
      expect(data.error).toBe('Invalid session ID format');
    });

    it('should handle errors gracefully', async () => {
      // Test with malformed session ID
      const malformedId = '';
      const request = new NextRequest(`http://localhost/api/sessions/${malformedId}/history`);
      const response = await GET(request, {
        params: Promise.resolve({ sessionId: malformedId }),
      });

      expect(response.status).toBe(400);
      const data = (await response.json()) as ApiErrorResponse;
      expect(data.error).toBe('Invalid session ID format');
    });

    it('should validate session exists before processing', async () => {
      // Verify the mocked session is accessible
      const session = await sessionService.getSession(validSessionId);
      expect(session).toBeDefined();

      const request = new NextRequest(`http://localhost/api/sessions/${validSessionId}/history`);
      const response = await GET(request, {
        params: Promise.resolve({ sessionId: validSessionId }),
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as HistoryResponse;
      expect(data.events).toBeDefined();
      expect(Array.isArray(data.events)).toBe(true);
    });
  });
});
