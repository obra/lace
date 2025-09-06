// ABOUTME: Simple user settings manager for arbitrary JSON preferences
// ABOUTME: Stores settings in ~/.lace/user-settings.json with no validation

import * as fs from 'fs';
import { getLaceFilePath, ensureLaceDir } from '~/config/lace-dir';
import { logger } from '~/utils/logger';

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
      // Return a deep clone to prevent accidental mutation of cache
      return globalThis.structuredClone
        ? globalThis.structuredClone(this.cachedSettings)
        : (JSON.parse(JSON.stringify(this.cachedSettings)) as Record<string, unknown>);
    }

    const settingsPath = this.getFilePath();

    try {
      if (fs.existsSync(settingsPath)) {
        const settingsContent = fs.readFileSync(settingsPath, 'utf-8');
        const parsed = JSON.parse(settingsContent) as unknown;

        // Validate that parsed JSON is a plain object
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          this.cachedSettings = parsed as Record<string, unknown>;
        } else {
          logger.warn('Settings file contains non-object JSON, using empty settings', {
            settingsPath,
            parsedType: Array.isArray(parsed) ? 'array' : typeof parsed,
          });
          this.cachedSettings = {};
        }
      } else {
        this.cachedSettings = {};
      }
    } catch (error) {
      // If file is malformed or can't be read, return empty object
      const err =
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : { message: String(error) };
      logger.warn('Failed to load user settings', { settingsPath, err });
      this.cachedSettings = {};
    }

    // Return a deep clone to prevent accidental mutation of cache
    const settings = this.cachedSettings || {};
    return globalThis.structuredClone
      ? globalThis.structuredClone(settings)
      : (JSON.parse(JSON.stringify(settings)) as Record<string, unknown>);
  }

  /**
   * Save user settings to disk
   */
  static save(settings: Record<string, unknown>): void {
    const settingsPath = this.getFilePath();

    // Ensure directory exists
    ensureLaceDir();

    // Write settings to file with secure permissions
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });

    // Update cache
    this.cachedSettings = settings;
  }

  /**
   * Update specific settings (merges with existing)
   */
  static update(partialSettings: Record<string, unknown>): Record<string, unknown> {
    // Validate that partialSettings is a plain object
    if (
      typeof partialSettings !== 'object' ||
      partialSettings === null ||
      Array.isArray(partialSettings)
    ) {
      logger.warn('UserSettingsManager.update() called with non-object input, skipping update', {
        inputType: Array.isArray(partialSettings) ? 'array' : typeof partialSettings,
      });
      // Return current settings unchanged
      return this.load();
    }

    const currentSettings = this.load();

    // Filter out dangerous prototype pollution keys
    const dangerous = new Set(['__proto__', 'constructor', 'prototype']);
    const sanitized = Object.fromEntries(
      Object.entries(partialSettings).filter(([key]) => !dangerous.has(key))
    ) as Record<string, unknown>;

    const updatedSettings = { ...currentSettings, ...sanitized };
    this.save(updatedSettings);
    // Return a deep clone to prevent accidental mutation
    return globalThis.structuredClone
      ? globalThis.structuredClone(updatedSettings)
      : (JSON.parse(JSON.stringify(updatedSettings)) as Record<string, unknown>);
  }

  /**
   * Reset settings to empty object
   */
  static reset(): Record<string, unknown> {
    const emptySettings = {};
    this.save(emptySettings);
    // Return a deep clone to prevent accidental mutation
    return globalThis.structuredClone
      ? globalThis.structuredClone(emptySettings)
      : (JSON.parse(JSON.stringify(emptySettings)) as Record<string, unknown>);
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
