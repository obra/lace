// ABOUTME: Simple user settings manager for arbitrary JSON preferences
// ABOUTME: Stores settings in ~/.lace/user-settings.json with no validation

import * as fs from 'fs';
import { getLaceFilePath, ensureLaceDir } from '~/config/lace-dir';

/**
 * Manages user settings stored in ~/.lace/user-settings.json
 * No validation - stores arbitrary JSON objects
 */
export class UserSettingsManager {
  private static readonly SETTINGS_FILENAME = 'user-settings.json';
  private static cachedSettings: Record<string, unknown> | null = null;

  /**
   * Get the path to the user settings file
   */
  static getFilePath(): string {
    return getLaceFilePath(this.SETTINGS_FILENAME);
  }

  /**
   * Load user settings from disk
   * Returns empty object if file doesn't exist or is invalid
   */
  static load(): Record<string, unknown> {
    if (this.cachedSettings) {
      return this.cachedSettings;
    }

    const settingsPath = this.getFilePath();

    try {
      if (fs.existsSync(settingsPath)) {
        const settingsContent = fs.readFileSync(settingsPath, 'utf-8');
        this.cachedSettings = JSON.parse(settingsContent) as Record<string, unknown>;
      } else {
        this.cachedSettings = {};
      }
    } catch (error) {
      // If file is malformed or can't be read, return empty object
      console.warn(`Failed to load user settings from ${settingsPath}:`, error);
      this.cachedSettings = {};
    }

    return this.cachedSettings || {};
  }

  /**
   * Save user settings to disk
   */
  static save(settings: Record<string, unknown>): void {
    const settingsPath = this.getFilePath();

    // Ensure directory exists
    ensureLaceDir();

    // Write settings to file
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

    // Update cache
    this.cachedSettings = settings;
  }

  /**
   * Update specific settings (merges with existing)
   */
  static update(partialSettings: Record<string, unknown>): Record<string, unknown> {
    const currentSettings = this.load();
    const updatedSettings = { ...currentSettings, ...partialSettings };
    this.save(updatedSettings);
    return updatedSettings;
  }

  /**
   * Reset settings to empty object
   */
  static reset(): Record<string, unknown> {
    const emptySettings = {};
    this.save(emptySettings);
    return emptySettings;
  }

  /**
   * Clear cached settings (for testing)
   */
  static clearCache(): void {
    this.cachedSettings = null;
  }

  /**
   * Check if settings file exists
   */
  static exists(): boolean {
    return fs.existsSync(this.getFilePath());
  }
}
