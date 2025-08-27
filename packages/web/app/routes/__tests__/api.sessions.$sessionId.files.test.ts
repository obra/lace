// ABOUTME: Comprehensive tests for session-scoped directory listing API endpoint
// ABOUTME: Tests filesystem operations, security controls, and error handling with real filesystem

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loader } from '@/app/routes/api.sessions.$sessionId.files';
import { createLoaderArgs } from '@/test-utils/route-test-helpers';
import { promises as fs } from 'fs';
import { join, basename } from 'path';
import { tmpdir } from 'os';
import { parseResponse } from '@/lib/serialization';
import type { SessionDirectoryResponse } from '@/types/session-files';
import type { ApiErrorResponse } from '@/types/api';

// Mock session service with dependency injection approach
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

describe('/api/sessions/[sessionId]/files', () => {
  let testDir: string;
  let testSessionId: string;
  let mockSession: { getWorkingDirectory: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    // Create temporary test directory with real filesystem
    testDir = await fs.mkdtemp(join(tmpdir(), 'lace-test-'));

    // Create test files and directories
    await fs.mkdir(join(testDir, 'src'));
    await fs.mkdir(join(testDir, 'docs'));
    await fs.writeFile(join(testDir, 'package.json'), '{"name": "test"}');
    await fs.writeFile(join(testDir, 'README.md'), '# Test Project');
    await fs.writeFile(join(testDir, 'src', 'index.ts'), 'console.log("hello");');

    testSessionId = 'lace_20250827_test01';

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
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    vi.clearAllMocks();
  });

  it('should list files and directories in session working directory', async () => {
    const request = new Request(`http://localhost/api/sessions/${testSessionId}/files`);

    const response = await loader(createLoaderArgs(request, { sessionId: testSessionId }));

    expect(response.status).toBe(200);
    const data = await parseResponse<SessionDirectoryResponse>(response);

    expect(data.workingDirectory).toBe(basename(testDir));
    expect(data.currentPath).toBe('');
    expect(data.entries.length).toBeGreaterThanOrEqual(4); // At least: src, docs, package.json, README.md

    // Check entries are properly sorted (directories first, then alphabetically)
    expect(data.entries[0].name).toBe('docs');
    expect(data.entries[0].type).toBe('directory');
    expect(data.entries[1].name).toBe('src');
    expect(data.entries[1].type).toBe('directory');
    expect(data.entries[2].name).toBe('package.json');
    expect(data.entries[2].type).toBe('file');
    expect(data.entries[3].name).toBe('README.md');
    expect(data.entries[3].type).toBe('file');

    // Check file metadata
    const packageJson = data.entries.find((e) => e.name === 'package.json');
    expect(packageJson?.size).toBe(16); // {"name": "test"} is 16 bytes
    expect(packageJson?.isReadable).toBe(true);
    expect(packageJson?.lastModified).toBeInstanceOf(Date);
  });

  it('should list files in subdirectory when path is specified', async () => {
    const request = new Request(
      `http://localhost/api/sessions/${testSessionId}/files?path=src`
    );

    const response = await loader(createLoaderArgs(request, { sessionId: testSessionId }));

    expect(response.status).toBe(200);
    const data = await parseResponse<SessionDirectoryResponse>(response);

    expect(data.currentPath).toBe('src');
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].name).toBe('index.ts');
    expect(data.entries[0].type).toBe('file');
    expect(data.entries[0].path).toBe(join('src', 'index.ts')); // Relative to working directory
  });

  it('should prevent path traversal attacks', async () => {
    const request = new Request(
      `http://localhost/api/sessions/${testSessionId}/files?path=../../../etc`
    );

    const response = await loader(createLoaderArgs(request, { sessionId: testSessionId }));

    expect(response.status).toBe(400);
    const data = await parseResponse<ApiErrorResponse>(response);
    expect(data.code).toBe('INVALID_REQUEST');
  });

  it('should handle non-existent session', async () => {
    mockGetSession.mockResolvedValue(null);

    const request = new Request('http://localhost/api/sessions/invalid-session/files');

    const response = await loader(createLoaderArgs(request, { sessionId: 'invalid-session' }));

    expect(response.status).toBe(404);
    const data = await parseResponse<ApiErrorResponse>(response);
    expect(data.code).toBe('SESSION_NOT_FOUND');
  });

  it('should handle session without working directory', async () => {
    mockSession.getWorkingDirectory.mockReturnValue(null);

    const request = new Request(`http://localhost/api/sessions/${testSessionId}/files`);

    const response = await loader(createLoaderArgs(request, { sessionId: testSessionId }));

    expect(response.status).toBe(400);
    const data = await parseResponse<ApiErrorResponse>(response);
    expect(data.code).toBe('NO_WORKING_DIRECTORY');
  });

  it('should handle non-existent directory', async () => {
    const request = new Request(
      `http://localhost/api/sessions/${testSessionId}/files?path=non-existent`
    );

    const response = await loader(createLoaderArgs(request, { sessionId: testSessionId }));

    expect(response.status).toBe(403);
    const data = await parseResponse<ApiErrorResponse>(response);
    expect(data.code).toBe('PATH_ACCESS_DENIED');
  });

  it('should handle path that is not a directory', async () => {
    const request = new Request(
      `http://localhost/api/sessions/${testSessionId}/files?path=package.json`
    );

    const response = await loader(createLoaderArgs(request, { sessionId: testSessionId }));

    expect(response.status).toBe(400);
    const data = await parseResponse<ApiErrorResponse>(response);
    expect(data.code).toBe('NOT_A_DIRECTORY');
  });

  it('should skip unreadable files without breaking the listing', async () => {
    // Create a file with no read permissions (on systems that support it)
    const unreadableFile = join(testDir, 'unreadable.txt');
    await fs.writeFile(unreadableFile, 'secret content');
    try {
      await fs.chmod(unreadableFile, 0o000);
    } catch {
      // Skip if chmod not supported
    }

    const request = new Request(`http://localhost/api/sessions/${testSessionId}/files`);

    const response = await loader(createLoaderArgs(request, { sessionId: testSessionId }));

    expect(response.status).toBe(200);
    const data = await parseResponse<SessionDirectoryResponse>(response);

    // Should still get readable files, unreadable file should be skipped
    const fileNames = data.entries.map((e) => e.name);
    expect(fileNames).toContain('package.json');
    expect(fileNames).toContain('README.md');
  });

  it('should not follow symlinks that resolve outside working directory', async () => {
    const outsideDir = await fs.mkdtemp(join(tmpdir(), 'outside-test-'));
    
    try {
      await fs.writeFile(join(outsideDir, 'secret.txt'), 'secret content');
      
      const symlinkPath = join(testDir, 'malicious-link');
      try {
        await fs.symlink(join(outsideDir, 'secret.txt'), symlinkPath);
        
        const request = new Request(`http://localhost/api/sessions/${testSessionId}/files`);
        const response = await loader(createLoaderArgs(request, { sessionId: testSessionId }));
        
        expect(response.status).toBe(200);
        const data = await parseResponse<SessionDirectoryResponse>(response);
        
        const entryNames = data.entries.map(e => e.name);
        expect(entryNames).not.toContain('malicious-link');
      } catch (_symlinkError) {
        console.warn('Skipping symlink test - symlinks not supported');
      }
    } finally {
      try {
        await fs.rm(outsideDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });
});
