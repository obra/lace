// ABOUTME: Tests for user settings API endpoint
// ABOUTME: Verifies GET, PUT, and PATCH operations work correctly

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loader, action } from './api.settings';
import { UserSettingsManager } from '@/lib/server/lace-imports';
import { parseResponse } from '@/lib/serialization';

describe('api.settings', () => {
  let tempDir: string;
  let originalLaceDir: string | undefined;

  beforeEach(() => {
    // Create temp directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-api-test-'));

    // Mock LACE_DIR
    originalLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = tempDir;

    // Clear cache
    UserSettingsManager.clearCache();
  });

  afterEach(() => {
    // Restore original LACE_DIR
    if (originalLaceDir !== undefined) {
      process.env.LACE_DIR = originalLaceDir;
    } else {
      delete process.env.LACE_DIR;
    }

    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    UserSettingsManager.clearCache();
  });

  describe('loader (GET)', () => {
    it('should return empty settings when none exist', async () => {
      const request = new Request('http://localhost/api/settings');
      const response = await loader({ request, params: {}, context: {} });

      const data = await parseResponse(response);
      expect(data).toEqual({});
    });

    it('should return existing settings', async () => {
      const testSettings = { theme: 'dark', fontSize: 14 };
      UserSettingsManager.save(testSettings);

      const request = new Request('http://localhost/api/settings');
      const response = await loader({ request, params: {}, context: {} });

      const data = await parseResponse(response);
      expect(data).toEqual(testSettings);
    });
  });

  describe('action (PUT)', () => {
    it('should replace entire settings', async () => {
      // Set initial settings
      UserSettingsManager.save({ theme: 'light', fontSize: 12, sidebar: true });

      const newSettings = { theme: 'dark', email: 'test@example.com' };
      const request = new Request('http://localhost/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(200);
      const data = await parseResponse(response);
      expect(data).toEqual(newSettings);

      // Verify settings were actually saved
      const savedSettings = UserSettingsManager.load();
      expect(savedSettings).toEqual(newSettings);
    });
  });

  describe('action (PATCH)', () => {
    it('should merge partial settings', async () => {
      // Set initial settings
      const initialSettings = { theme: 'light', fontSize: 12, sidebar: true };
      UserSettingsManager.save(initialSettings);

      const partialUpdate = { theme: 'dark', email: 'test@example.com' };
      const request = new Request('http://localhost/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partialUpdate),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(200);
      const data = await parseResponse(response);

      const expectedSettings = {
        theme: 'dark',
        fontSize: 12,
        sidebar: true,
        email: 'test@example.com',
      };

      expect(data).toEqual(expectedSettings);

      // Verify settings were actually saved
      const savedSettings = UserSettingsManager.load();
      expect(savedSettings).toEqual(expectedSettings);
    });
  });

  describe('error handling', () => {
    it('should return 405 for unsupported methods', async () => {
      const request = new Request('http://localhost/api/settings', {
        method: 'DELETE',
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(405);
      const data = await parseResponse<{ error: string }>(response);
      expect(data.error).toBe('Method not allowed');
    });

    it('should handle invalid JSON in request body', async () => {
      const request = new Request('http://localhost/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json',
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(400);
      const data = await parseResponse<{ error: string }>(response);
      expect(data.error).toContain('Invalid JSON');
    });

    it('should handle file system errors gracefully', async () => {
      // Mock UserSettingsManager to throw an error
      const originalLoad = UserSettingsManager.load;
      UserSettingsManager.load = vi.fn(() => {
        throw new Error('File system error');
      });

      const request = new Request('http://localhost/api/settings');
      const response = await loader({ request, params: {}, context: {} });

      expect(response.status).toBe(500);
      const data = await parseResponse<{ error: string }>(response);
      expect(data.error).toContain('File system error');

      // Restore original method
      UserSettingsManager.load = originalLoad;
    });
  });
});
