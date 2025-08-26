// ABOUTME: Tests for filesystem API endpoint with real filesystem operations
// ABOUTME: Validates security restrictions, error handling, and directory listing functionality

import { describe, it, expect } from 'vitest';
import { loader } from '@/app/routes/api.filesystem.list';
import { homedir } from 'os';
import { join } from 'path';
import { promises as fs } from 'fs';
import { parseResponse } from '@/lib/serialization';
import type { ListDirectoryResponse } from '@/types/filesystem';

describe('/api/filesystem/list', () => {
  it('should list home directory contents', async () => {
    const request = new Request(`http://localhost/api/filesystem/list?path=${homedir()}`);
    const response = await loader({ request, params: {} });

    expect(response.status).toBe(200);
    const data = await parseResponse<ListDirectoryResponse>(response);
    expect(data.currentPath).toBe(homedir());
    expect(data.parentPath).toBeNull();
    expect(Array.isArray(data.entries)).toBe(true);
  });

  it('should reject paths outside home directory', async () => {
    const request = new Request('http://localhost/api/filesystem/list?path=/etc');
    const response = await loader({ request, params: {} });

    expect(response.status).toBe(403);
    const data = await parseResponse<{ error: string; code: string }>(response);
    expect(data.code).toBe('PATH_ACCESS_DENIED');
  });

  it('should handle non-existent directories', async () => {
    const invalidPath = join(homedir(), 'definitely-does-not-exist-12345');
    const request = new Request(`http://localhost/api/filesystem/list?path=${invalidPath}`);
    const response = await loader({ request, params: {} });

    expect(response.status).toBe(404);
    const data = await parseResponse<{ error: string; code: string }>(response);
    expect(data.code).toBe('DIRECTORY_NOT_FOUND');
  });

  it('should only return directories', async () => {
    const request = new Request(`http://localhost/api/filesystem/list?path=${homedir()}`);
    const response = await loader({ request, params: {} });

    const data = await parseResponse<ListDirectoryResponse>(response);
    for (const entry of data.entries) {
      expect(entry.type).toBe('directory');
    }
  });

  it('should default to home directory when no path provided', async () => {
    const request = new Request('http://localhost/api/filesystem/list');
    const response = await loader({ request, params: {} });

    expect(response.status).toBe(200);
    const data = await parseResponse<ListDirectoryResponse>(response);
    expect(data.currentPath).toBe(homedir());
  });

  it('should handle path traversal attempts', async () => {
    const maliciousPath = join(homedir(), '../../../etc');
    const request = new Request(`http://localhost/api/filesystem/list?path=${maliciousPath}`);
    const response = await loader({ request, params: {} });

    expect(response.status).toBe(403);
    const data = await parseResponse<{ error: string; code: string }>(response);
    expect(data.code).toBe('PATH_ACCESS_DENIED');
  });

  it('should include permission information in entries', async () => {
    const request = new Request(`http://localhost/api/filesystem/list?path=${homedir()}`);
    const response = await loader({ request, params: {} });

    const data = await parseResponse<ListDirectoryResponse>(response);
    if (data.entries.length > 0) {
      const entry = data.entries[0];
      expect(typeof entry.permissions.canRead).toBe('boolean');
      expect(typeof entry.permissions.canWrite).toBe('boolean');
      expect(entry.permissions.canRead).toBe(true); // Should be readable since we can list it
    }
  });

  it('should sort directories alphabetically', async () => {
    const request = new Request(`http://localhost/api/filesystem/list?path=${homedir()}`);
    const response = await loader({ request, params: {} });

    const data = await parseResponse<ListDirectoryResponse>(response);
    if (data.entries.length > 1) {
      for (let i = 1; i < data.entries.length; i++) {
        expect(data.entries[i - 1].name.localeCompare(data.entries[i].name)).toBeLessThanOrEqual(0);
      }
    }
  });

  it('should handle file path as invalid directory', async () => {
    // Create a temporary file inside home directory to ensure it exists and is accessible
    const tempFilePath = join(homedir(), `test-file-${Date.now()}.txt`);

    try {
      await fs.writeFile(tempFilePath, 'test content');

      const request = new Request(`http://localhost/api/filesystem/list?path=${tempFilePath}`);
      const response = await loader({ request, params: {} });

      // Should be 400 (not a directory) since we created a file
      expect(response.status).toBe(400);
      const data = await parseResponse<{ error: string; code: string }>(response);
      expect(data.code).toBe('NOT_A_DIRECTORY');
    } finally {
      // Clean up the temporary file
      try {
        await fs.unlink(tempFilePath);
      } catch {
        // Ignore cleanup errors
      }
    }
  });
});
