// ABOUTME: Comprehensive tests for session file content API endpoint
// ABOUTME: Tests file reading, MIME type detection, security controls, and error handling

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseResponse } from '@/lib/serialization';
import type { SessionFileContentResponse } from '@/types/session-files';
import type { ApiErrorResponse } from '@/types/api';

// Mock session service with proper dependency injection
const mockGetSession = vi.fn();

vi.mock('@/lib/server/session-service', () => ({
  SessionService: vi.fn().mockImplementation(() => ({
    getSession: mockGetSession,
  })),
}));

vi.mock('@/types/core', () => ({
  asThreadId: vi.fn().mockImplementation((id) => id),
  isThreadId: vi.fn().mockReturnValue(true),
}));

describe('/api/sessions/[sessionId]/files/[...path]', () => {
  let testDir: string;
  let testSessionId: string;
  let mockSession: { getWorkingDirectory: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    // Create temporary test directory with real filesystem
    testDir = join(tmpdir(), `lace-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    // Create test files with different content types
    await fs.writeFile(join(testDir, 'test.ts'), 'const hello = "world";');
    await fs.writeFile(join(testDir, 'package.json'), '{"name": "test", "version": "1.0.0"}');
    await fs.writeFile(join(testDir, 'README.md'), '# Test Project\n\nThis is a test.');
    await fs.writeFile(join(testDir, 'large-file.txt'), 'x'.repeat(2 * 1024 * 1024)); // 2MB file

    // Create subdirectory with file
    await fs.mkdir(join(testDir, 'src'));
    await fs.writeFile(join(testDir, 'src', 'index.js'), 'console.log("Hello from subdirectory");');

    testSessionId = 'test-session-123';

    // Mock session with working directory
    mockSession = {
      getWorkingDirectory: vi.fn().mockReturnValue(testDir),
    };

    // Reset and configure mock
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue(mockSession);
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
    vi.clearAllMocks();
  });

  it('should return file content for valid TypeScript file', async () => {
    const request = new NextRequest(`http://localhost/api/sessions/${testSessionId}/files/test.ts`);

    const response = await GET(request, {
      params: { sessionId: testSessionId, path: ['test.ts'] },
    });

    expect(response.status).toBe(200);
    const data = await parseResponse<SessionFileContentResponse>(response);
    expect(data.content).toBe('const hello = "world";');
    expect(data.mimeType).toBe('text/typescript');
    expect(data.encoding).toBe('utf8');
    expect(data.size).toBeGreaterThan(0);
    expect(data.path).toBe('test.ts');
  });

  it('should return file content for JSON file', async () => {
    const request = new NextRequest(
      `http://localhost/api/sessions/${testSessionId}/files/package.json`
    );

    const response = await GET(request, {
      params: { sessionId: testSessionId, path: ['package.json'] },
    });

    expect(response.status).toBe(200);
    const data = await parseResponse<SessionFileContentResponse>(response);
    expect(data.content).toBe('{"name": "test", "version": "1.0.0"}');
    expect(data.mimeType).toBe('application/json');
    expect(data.encoding).toBe('utf8');
  });

  it('should return file content from subdirectory', async () => {
    const request = new NextRequest(
      `http://localhost/api/sessions/${testSessionId}/files/src/index.js`
    );

    const response = await GET(request, {
      params: { sessionId: testSessionId, path: ['src', 'index.js'] },
    });

    expect(response.status).toBe(200);
    const data = await parseResponse<SessionFileContentResponse>(response);
    expect(data.content).toBe('console.log("Hello from subdirectory");');
    expect(data.mimeType).toBe('text/javascript');
    expect(data.path).toBe('src/index.js');
  });

  it('should reject files that are too large', async () => {
    const request = new NextRequest(
      `http://localhost/api/sessions/${testSessionId}/files/large-file.txt`
    );

    const response = await GET(request, {
      params: { sessionId: testSessionId, path: ['large-file.txt'] },
    });

    expect(response.status).toBe(413);
    const data = await parseResponse<ApiErrorResponse>(response);
    expect(data.code).toBe('FILE_TOO_LARGE');
    expect(data.details).toHaveProperty('maxSize');
    expect(data.details).toHaveProperty('actualSize');
  });

  it('should prevent path traversal attacks', async () => {
    const request = new NextRequest(
      `http://localhost/api/sessions/${testSessionId}/files/../../../etc/passwd`
    );

    const response = await GET(request, {
      params: { sessionId: testSessionId, path: ['..', '..', '..', 'etc', 'passwd'] },
    });

    expect(response.status).toBe(403);
    const data = await parseResponse<ApiErrorResponse>(response);
    expect(data.code).toBe('PATH_ACCESS_DENIED');
  });

  it('should handle non-existent files', async () => {
    const request = new NextRequest(
      `http://localhost/api/sessions/${testSessionId}/files/non-existent.txt`
    );

    const response = await GET(request, {
      params: { sessionId: testSessionId, path: ['non-existent.txt'] },
    });

    expect(response.status).toBe(404);
    const data = await parseResponse<ApiErrorResponse>(response);
    expect(data.code).toBe('FILE_NOT_FOUND');
  });

  it('should reject directories', async () => {
    const request = new NextRequest(`http://localhost/api/sessions/${testSessionId}/files/src`);

    const response = await GET(request, {
      params: { sessionId: testSessionId, path: ['src'] },
    });

    expect(response.status).toBe(400);
    const data = await parseResponse<ApiErrorResponse>(response);
    expect(data.code).toBe('PATH_IS_DIRECTORY');
  });

  it('should handle non-existent session', async () => {
    mockGetSession.mockResolvedValue(null);

    const request = new NextRequest('http://localhost/api/sessions/invalid-session/files/test.ts');

    const response = await GET(request, {
      params: { sessionId: 'invalid-session', path: ['test.ts'] },
    });

    expect(response.status).toBe(404);
    const data = await parseResponse<ApiErrorResponse>(response);
    expect(data.code).toBe('SESSION_NOT_FOUND');
  });

  it('should handle session without working directory', async () => {
    mockSession.getWorkingDirectory.mockReturnValue(null);

    const request = new NextRequest(`http://localhost/api/sessions/${testSessionId}/files/test.ts`);

    const response = await GET(request, {
      params: { sessionId: testSessionId, path: ['test.ts'] },
    });

    expect(response.status).toBe(400);
    const data = await parseResponse<ApiErrorResponse>(response);
    expect(data.code).toBe('NO_WORKING_DIRECTORY');
  });

  it('should detect MIME types correctly for various file extensions', async () => {
    // Test markdown file MIME type
    const request = new NextRequest(
      `http://localhost/api/sessions/${testSessionId}/files/README.md`
    );

    const response = await GET(request, {
      params: { sessionId: testSessionId, path: ['README.md'] },
    });

    expect(response.status).toBe(200);
    const data = await parseResponse<SessionFileContentResponse>(response);
    expect(data.mimeType).toBe('text/markdown');
    expect(data.content).toContain('# Test Project');
  });
});
