// ABOUTME: Tests for user settings manager
// ABOUTME: Ensures settings persist correctly and merge operations work as expected

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { UserSettingsManager } from './user-settings';

describe('UserSettingsManager', () => {
  let tempDir: string;
  let originalLaceDir: string | undefined;

  beforeEach(() => {
    // Create a temp directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'user-settings-test-'));

    // Mock LACE_DIR to point to our temp directory
    originalLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = tempDir;

    // Clear cache before each test
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

  describe('load', () => {
    it('should return empty object when settings file does not exist', () => {
      const settings = UserSettingsManager.load();
      expect(settings).toEqual({});
    });

    it('should load existing settings from file', () => {
      const testSettings = { theme: 'dark', fontSize: 14 };
      const settingsPath = UserSettingsManager.getFilePath();

      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(settingsPath, JSON.stringify(testSettings));

      const settings = UserSettingsManager.load();
      expect(settings).toEqual(testSettings);
    });

    it('should return empty object for malformed JSON', () => {
      const settingsPath = UserSettingsManager.getFilePath();

      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(settingsPath, 'invalid json');

      const settings = UserSettingsManager.load();
      expect(settings).toEqual({});
    });

    it('should cache settings after first load', () => {
      const testSettings = { theme: 'dark' };
      const settingsPath = UserSettingsManager.getFilePath();

      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(settingsPath, JSON.stringify(testSettings));

      const settings1 = UserSettingsManager.load();

      // Modify file on disk
      fs.writeFileSync(settingsPath, JSON.stringify({ theme: 'light' }));

      const settings2 = UserSettingsManager.load();

      // Should return cached version
      expect(settings1).toEqual(settings2);
      expect(settings2).toEqual(testSettings);
    });
  });

  describe('save', () => {
    it('should save settings to file', () => {
      const testSettings = { theme: 'dark', fontSize: 14 };

      UserSettingsManager.save(testSettings);

      const settingsPath = UserSettingsManager.getFilePath();
      expect(fs.existsSync(settingsPath)).toBe(true);

      const savedContent = fs.readFileSync(settingsPath, 'utf-8');
      expect(JSON.parse(savedContent)).toEqual(testSettings);
    });

    it('should update cache when saving', () => {
      const testSettings = { theme: 'dark' };

      UserSettingsManager.save(testSettings);

      const loadedSettings = UserSettingsManager.load();
      expect(loadedSettings).toEqual(testSettings);
    });

    it('should create directory if it does not exist', () => {
      const testSettings = { theme: 'dark' };

      UserSettingsManager.save(testSettings);

      const settingsPath = UserSettingsManager.getFilePath();
      expect(fs.existsSync(path.dirname(settingsPath))).toBe(true);
      expect(fs.existsSync(settingsPath)).toBe(true);
    });
  });

  describe('update', () => {
    it('should merge partial settings with existing settings', () => {
      const initialSettings = { theme: 'light', fontSize: 12, sidebarOpen: true };
      UserSettingsManager.save(initialSettings);

      const updatedSettings = UserSettingsManager.update({ theme: 'dark', fontSize: 14 });

      expect(updatedSettings).toEqual({
        theme: 'dark',
        fontSize: 14,
        sidebarOpen: true,
      });
    });

    it('should work with empty initial settings', () => {
      const updatedSettings = UserSettingsManager.update({ theme: 'dark' });

      expect(updatedSettings).toEqual({ theme: 'dark' });
    });

    it('should handle nested object merging', () => {
      const initialSettings = {
        ui: { theme: 'light', fontSize: 12 },
        editor: { tabSize: 2 },
      };
      UserSettingsManager.save(initialSettings);

      const updatedSettings = UserSettingsManager.update({
        ui: { theme: 'dark' },
      });

      expect(updatedSettings).toEqual({
        ui: { theme: 'dark' },
        editor: { tabSize: 2 },
      });
    });
  });

  describe('reset', () => {
    it('should reset settings to empty object', () => {
      UserSettingsManager.save({ theme: 'dark', fontSize: 14 });

      const resetSettings = UserSettingsManager.reset();

      expect(resetSettings).toEqual({});

      const loadedSettings = UserSettingsManager.load();
      expect(loadedSettings).toEqual({});
    });
  });

  describe('exists', () => {
    it('should return false when settings file does not exist', () => {
      expect(UserSettingsManager.exists()).toBe(false);
    });

    it('should return true when settings file exists', () => {
      UserSettingsManager.save({ theme: 'dark' });
      expect(UserSettingsManager.exists()).toBe(true);
    });
  });

  describe('getFilePath', () => {
    it('should return correct file path', () => {
      const filePath = UserSettingsManager.getFilePath();
      expect(filePath).toBe(path.join(tempDir, 'user-settings.json'));
    });
  });
});
