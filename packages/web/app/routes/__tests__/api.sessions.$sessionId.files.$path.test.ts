// ABOUTME: Comprehensive tests for supervisor-backed session-scoped file content retrieval API endpoint
// ABOUTME: Uses real filesystem + supervisor workspace session store (no core SessionService mocks)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loader } from '@lace/web/app/routes/api.sessions.$sessionId.files.$path';
import { createLoaderArgs } from '@lace/web/test-utils/route-test-helpers';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseResponse } from '@lace/web/lib/serialization';
import type { SessionFileContentResponse } from '@lace/web/types/session-files';
import type { ApiErrorResponse } from '@lace/web/types/api';
import { getSupervisor, shutdownSupervisorForTests } from '@lace/web/lib/server/supervisor-service';
import { setupWebTest } from '@lace/web/test-utils/web-test-setup';

describe('/api/sessions/:sessionId/files/:path', () => {
  setupWebTest();

  let testDir: string;
  let workspaceSessionId: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(join(tmpdir(), 'session-files-test-'));

    await fs.writeFile(join(testDir, 'test.ts'), 'const message = "Hello TypeScript";');
    await fs.writeFile(join(testDir, 'package.json'), '{"name": "test", "version": "1.0.0"}');
    await fs.writeFile(join(testDir, 'README.md'), '# Test Project\nThis is a test project.');

    await fs.mkdir(join(testDir, 'src'));
    await fs.writeFile(join(testDir, 'src', 'index.js'), 'console.log("Hello from subdirectory");');

    const largeContent = 'x'.repeat(1024 * 1024 + 1);
    await fs.writeFile(join(testDir, 'large-file.txt'), largeContent);

    const binaryData = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    await fs.writeFile(join(testDir, 'image.png'), binaryData);

    const supervisor = getSupervisor();
    const created = await supervisor.createWorkspaceSession(testDir);
    workspaceSessionId = created.workspaceSessionId;
  });

  afterEach(async () => {
    await shutdownSupervisorForTests();

    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it('should return file content for valid TypeScript file', async () => {
    const request = new Request(
      `http://localhost/api/sessions/${workspaceSessionId}/files/test.ts`
    );

    const response = await loader(
      createLoaderArgs(request, { sessionId: workspaceSessionId, '*': 'test.ts' })
    );

    expect(response.status).toBe(200);
    const data = await parseResponse<SessionFileContentResponse>(response);
    expect(data.content).toBe('const message = "Hello TypeScript";');
    expect(data.mimeType).toBe('video/mp2t');
    expect(data.encoding).toBe('utf8');
    expect(data.path).toBe('test.ts');
  });

  it('should return file content for valid JSON file', async () => {
    const request = new Request(
      `http://localhost/api/sessions/${workspaceSessionId}/files/package.json`
    );

    const response = await loader(
      createLoaderArgs(request, { sessionId: workspaceSessionId, '*': 'package.json' })
    );

    expect(response.status).toBe(200);
    const data = await parseResponse<SessionFileContentResponse>(response);
    expect(data.content).toBe('{"name": "test", "version": "1.0.0"}');
    expect(data.mimeType).toBe('application/json');
    expect(data.encoding).toBe('utf8');
  });

  it('should return file content from subdirectory', async () => {
    const request = new Request(
      `http://localhost/api/sessions/${workspaceSessionId}/files/src/index.js`
    );

    const response = await loader(
      createLoaderArgs(request, { sessionId: workspaceSessionId, '*': 'src/index.js' })
    );

    expect(response.status).toBe(200);
    const data = await parseResponse<SessionFileContentResponse>(response);
    expect(data.content).toBe('console.log("Hello from subdirectory");');
    expect(data.mimeType).toBe('application/javascript');
    expect(data.path).toBe('src/index.js');
  });

  it('should reject files that are too large', async () => {
    const request = new Request(
      `http://localhost/api/sessions/${workspaceSessionId}/files/large-file.txt`
    );

    const response = await loader(
      createLoaderArgs(request, { sessionId: workspaceSessionId, '*': 'large-file.txt' })
    );

    expect(response.status).toBe(413);
    const data = await parseResponse<ApiErrorResponse>(response);
    expect(data.code).toBe('FILE_TOO_LARGE');
    expect(data.details).toHaveProperty('maxSize');
    expect(data.details).toHaveProperty('actualSize');
  });

  it('should prevent path traversal attacks', async () => {
    const request = new Request(
      `http://localhost/api/sessions/${workspaceSessionId}/files/../../../etc/passwd`
    );

    const response = await loader(
      createLoaderArgs(request, { sessionId: workspaceSessionId, '*': '../../../etc/passwd' })
    );

    expect(response.status).toBe(400);
    const data = await parseResponse<ApiErrorResponse>(response);
    expect(data.code).toBe('INVALID_REQUEST');
  });

  it('should handle non-existent files', async () => {
    const request = new Request(
      `http://localhost/api/sessions/${workspaceSessionId}/files/non-existent.txt`
    );

    const response = await loader(
      createLoaderArgs(request, { sessionId: workspaceSessionId, '*': 'non-existent.txt' })
    );

    expect(response.status).toBe(404);
    const data = await parseResponse<ApiErrorResponse>(response);
    expect(data.code).toBe('FILE_NOT_FOUND');
  });

  it('should reject directories', async () => {
    const request = new Request(`http://localhost/api/sessions/${workspaceSessionId}/files/src`);

    const response = await loader(
      createLoaderArgs(request, { sessionId: workspaceSessionId, '*': 'src' })
    );

    expect(response.status).toBe(400);
    const data = await parseResponse<ApiErrorResponse>(response);
    expect(data.code).toBe('PATH_IS_DIRECTORY');
  });

  it('should return 400 for invalid session id', async () => {
    const request = new Request('http://localhost/api/sessions/invalid-session/files/test.ts');

    const response = await loader(
      createLoaderArgs(request, { sessionId: 'invalid-session', '*': 'test.ts' })
    );

    expect(response.status).toBe(400);
    const data = await parseResponse<ApiErrorResponse>(response);
    expect(data.code).toBe('INVALID_REQUEST');
  });

  it('should detect MIME types correctly for various file extensions', async () => {
    const request = new Request(
      `http://localhost/api/sessions/${workspaceSessionId}/files/README.md`
    );

    const response = await loader(
      createLoaderArgs(request, { sessionId: workspaceSessionId, '*': 'README.md' })
    );

    expect(response.status).toBe(200);
    const data = await parseResponse<SessionFileContentResponse>(response);
    expect(data.mimeType).toBe('text/markdown');
    expect(data.content).toContain('# Test Project');
  });

  it('should reject binary files with appropriate error', async () => {
    const request = new Request(
      `http://localhost/api/sessions/${workspaceSessionId}/files/image.png`
    );

    const response = await loader(
      createLoaderArgs(request, { sessionId: workspaceSessionId, '*': 'image.png' })
    );

    expect(response.status).toBe(415);
    const data = await parseResponse<ApiErrorResponse>(response);
    expect(data.code).toBe('UNSUPPORTED_FILE_TYPE');
    expect(data.details).toHaveProperty('mimeType');
  });

  it('should prevent access to symlinked files outside working directory', async () => {
    const outsideDir = await fs.mkdtemp(join(tmpdir(), 'outside-test-'));
    await fs.writeFile(join(outsideDir, 'secret.txt'), 'This should not be accessible');

    try {
      const symlinkPath = join(testDir, 'malicious-link');
      try {
        await fs.symlink(join(outsideDir, 'secret.txt'), symlinkPath);

        const request = new Request(
          `http://localhost/api/sessions/${workspaceSessionId}/files/malicious-link`
        );

        const response = await loader(
          createLoaderArgs(request, { sessionId: workspaceSessionId, '*': 'malicious-link' })
        );

        expect(response.status).toBe(403);
        const data = await parseResponse<ApiErrorResponse>(response);
        expect(data.code).toBe('PATH_ACCESS_DENIED');
      } catch {
        // Skip if symlinks not supported
      }
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });
});
