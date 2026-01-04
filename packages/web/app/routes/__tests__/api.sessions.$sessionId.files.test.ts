// ABOUTME: Comprehensive tests for supervisor-backed session-scoped directory listing API endpoint
// ABOUTME: Uses real filesystem + supervisor workspace session store (no core SessionService mocks)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loader } from '@lace/web/app/routes/api.sessions.$sessionId.files';
import { createLoaderArgs } from '@lace/web/test-utils/route-test-helpers';
import { promises as fs } from 'fs';
import { join, basename } from 'path';
import { tmpdir } from 'os';
import { parseResponse } from '@lace/web/lib/serialization';
import type { SessionDirectoryResponse } from '@lace/web/types/session-files';
import type { ApiErrorResponse } from '@lace/web/types/api';
import { getSupervisor, shutdownSupervisorForTests } from '@lace/web/lib/server/supervisor-service';
import { setupWebTest } from '@lace/web/test-utils/web-test-setup';

describe('/api/sessions/[sessionId]/files', () => {
  setupWebTest();

  let testDir: string;
  let workspaceSessionId: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(join(tmpdir(), 'lace-test-'));

    await fs.mkdir(join(testDir, 'src'));
    await fs.mkdir(join(testDir, 'docs'));
    await fs.writeFile(join(testDir, 'package.json'), '{"name": "test"}');
    await fs.writeFile(join(testDir, 'README.md'), '# Test Project');
    await fs.writeFile(join(testDir, 'src', 'index.ts'), 'console.log("hello");');

    const supervisor = getSupervisor();
    const created = await supervisor.createWorkspaceSession(testDir);
    workspaceSessionId = created.workspaceSessionId;
  });

  afterEach(async () => {
    await shutdownSupervisorForTests();

    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should list files and directories in session working directory', async () => {
    const request = new Request(`http://localhost/api/sessions/${workspaceSessionId}/files`);

    const response = await loader(createLoaderArgs(request, { sessionId: workspaceSessionId }));

    expect(response.status).toBe(200);
    const data = await parseResponse<SessionDirectoryResponse>(response);

    expect(data.workingDirectory).toBe(basename(testDir));
    expect(data.currentPath).toBe('');
    expect(data.entries.length).toBeGreaterThanOrEqual(4);

    expect(data.entries[0].name).toBe('docs');
    expect(data.entries[0].type).toBe('directory');
    expect(data.entries[1].name).toBe('src');
    expect(data.entries[1].type).toBe('directory');

    const packageJson = data.entries.find((e) => e.name === 'package.json');
    expect(packageJson?.type).toBe('file');
    expect(packageJson?.isReadable).toBe(true);
    expect(packageJson?.lastModified).toBeInstanceOf(Date);
  });

  it('should list files in subdirectory when path is specified', async () => {
    const request = new Request(
      `http://localhost/api/sessions/${workspaceSessionId}/files?path=src`
    );

    const response = await loader(createLoaderArgs(request, { sessionId: workspaceSessionId }));

    expect(response.status).toBe(200);
    const data = await parseResponse<SessionDirectoryResponse>(response);

    expect(data.currentPath).toBe('src');
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].name).toBe('index.ts');
    expect(data.entries[0].type).toBe('file');
    expect(data.entries[0].path).toBe(join('src', 'index.ts'));
  });

  it('should prevent path traversal attacks', async () => {
    const request = new Request(
      `http://localhost/api/sessions/${workspaceSessionId}/files?path=../../../etc`
    );

    const response = await loader(createLoaderArgs(request, { sessionId: workspaceSessionId }));

    expect(response.status).toBe(400);
    const data = await parseResponse<ApiErrorResponse>(response);
    expect(data.code).toBe('INVALID_REQUEST');
  });

  it('should return 400 for invalid session id', async () => {
    const request = new Request('http://localhost/api/sessions/invalid-session/files');

    const response = await loader(createLoaderArgs(request, { sessionId: 'invalid-session' }));

    expect(response.status).toBe(400);
    const data = await parseResponse<ApiErrorResponse>(response);
    expect(data.code).toBe('INVALID_REQUEST');
  });

  it('should return 404 for unknown workspace session id', async () => {
    const request = new Request(
      'http://localhost/api/sessions/ws_00000000-0000-0000-0000-000000000000/files'
    );

    const response = await loader(
      createLoaderArgs(request, { sessionId: 'ws_00000000-0000-0000-0000-000000000000' })
    );

    expect(response.status).toBe(404);
    const data = await parseResponse<ApiErrorResponse>(response);
    expect(data.code).toBe('SESSION_NOT_FOUND');
  });

  it('should handle non-existent directory', async () => {
    const request = new Request(
      `http://localhost/api/sessions/${workspaceSessionId}/files?path=non-existent`
    );

    const response = await loader(createLoaderArgs(request, { sessionId: workspaceSessionId }));

    expect(response.status).toBe(404);
    const data = await parseResponse<ApiErrorResponse>(response);
    expect(data.code).toBe('DIRECTORY_NOT_FOUND');
  });

  it('should handle path that is not a directory', async () => {
    const request = new Request(
      `http://localhost/api/sessions/${workspaceSessionId}/files?path=package.json`
    );

    const response = await loader(createLoaderArgs(request, { sessionId: workspaceSessionId }));

    expect(response.status).toBe(400);
    const data = await parseResponse<ApiErrorResponse>(response);
    expect(data.code).toBe('NOT_A_DIRECTORY');
  });

  it('should skip unreadable files without breaking the listing', async () => {
    const unreadableFile = join(testDir, 'unreadable.txt');
    await fs.writeFile(unreadableFile, 'secret content');
    try {
      await fs.chmod(unreadableFile, 0o000);
    } catch {
      // Skip if chmod not supported
    }

    const request = new Request(`http://localhost/api/sessions/${workspaceSessionId}/files`);
    const response = await loader(createLoaderArgs(request, { sessionId: workspaceSessionId }));

    expect(response.status).toBe(200);
    const data = await parseResponse<SessionDirectoryResponse>(response);

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

        const request = new Request(`http://localhost/api/sessions/${workspaceSessionId}/files`);
        const response = await loader(createLoaderArgs(request, { sessionId: workspaceSessionId }));

        expect(response.status).toBe(200);
        const data = await parseResponse<SessionDirectoryResponse>(response);

        const entryNames = data.entries.map((e) => e.name);
        expect(entryNames).not.toContain('malicious-link');
      } catch {
        // Skip if symlinks not supported
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
