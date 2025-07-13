// ABOUTME: Tests for agent status API endpoint
// ABOUTME: Verifies Agent status retrieval and thread information

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '~/interfaces/web/app/api/agent/status/route';

// Mock the agent context
vi.mock('~/interfaces/web/lib/agent-context', () => ({
  getAgentFromRequest: vi.fn(),
}));

import { getAgentFromRequest } from '~/interfaces/web/lib/agent-context';

describe('/api/agent/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return agent status with latest thread ID', async () => {
    const mockAgent = {
      getLatestThreadId: vi.fn().mockReturnValue('lace_20250713_abc123'),
    };

    vi.mocked(getAgentFromRequest).mockReturnValue(mockAgent as any);

    const request = new NextRequest('http://localhost:3000/api/agent/status');
    const response = await GET(request);

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toEqual({
      hasActiveThread: true,
      latestThreadId: 'lace_20250713_abc123',
      provider: 'anthropic',
      model: 'default',
    });
  });

  it('should return status without thread ID when no threads exist', async () => {
    const mockAgent = {
      getLatestThreadId: vi.fn().mockReturnValue(null),
    };

    vi.mocked(getAgentFromRequest).mockReturnValue(mockAgent as any);

    const request = new NextRequest('http://localhost:3000/api/agent/status');
    const response = await GET(request);

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toEqual({
      hasActiveThread: false,
      provider: 'anthropic',
      model: 'default',
    });
  });

  it('should handle agent context errors', async () => {
    vi.mocked(getAgentFromRequest).mockImplementation(() => {
      throw new Error('Agent not available in request context');
    });

    const request = new NextRequest('http://localhost:3000/api/agent/status');
    const response = await GET(request);

    expect(response.status).toBe(500);

    const data = await response.json();
    expect(data.error).toBe('Agent not available in request context');
  });
});
