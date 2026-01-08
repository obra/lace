// ABOUTME: Web-owned user settings manager for arbitrary JSON preferences
// ABOUTME: Stores settings in ~/.lace_web/user-settings.json with no validation

import * as fs from 'fs';
import { ensureLaceWebDir, getLaceWebFilePath } from './web-data-dir';
import { logger } from '@lace/web/lib/logger';

/**
 * Manages user settings stored in ~/.lace_web/user-settings.json
 * No validation - stores arbitrary JSON objects
 */
export class UserSettingsManager {
  private static readonly SETTINGS_FILENAME = 'user-settings.json';
  private static cachedSettings: Record<string, unknown> | null = null;

  static getFilePath(): string {
    return getLaceWebFilePath(this.SETTINGS_FILENAME);
  }

  static load(): Record<string, unknown> {
    if (this.cachedSettings) {
      return globalThis.structuredClone
        ? globalThis.structuredClone(this.cachedSettings)
        : (JSON.parse(JSON.stringify(this.cachedSettings)) as Record<string, unknown>);
    }

    const settingsPath = this.getFilePath();

    try {
      if (fs.existsSync(settingsPath)) {
        const settingsContent = fs.readFileSync(settingsPath, 'utf-8');
        const parsed = JSON.parse(settingsContent) as unknown;

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
      const err =
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : { message: String(error) };
      logger.warn('Failed to load user settings', { settingsPath, err });
      this.cachedSettings = {};
    }

    const settings = this.cachedSettings || {};
    return globalThis.structuredClone
      ? globalThis.structuredClone(settings)
      : (JSON.parse(JSON.stringify(settings)) as Record<string, unknown>);
  }

  static save(settings: Record<string, unknown>): void {
    const settingsPath = this.getFilePath();
    ensureLaceWebDir();

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });

    this.cachedSettings = settings;
  }

  static update(partialSettings: Record<string, unknown>): Record<string, unknown> {
    if (
      typeof partialSettings !== 'object' ||
      partialSettings === null ||
      Array.isArray(partialSettings)
    ) {
      logger.warn('UserSettingsManager.update() called with non-object input, skipping update', {
        inputType: Array.isArray(partialSettings) ? 'array' : typeof partialSettings,
      });
      return this.load();
    }

    const currentSettings = this.load();

    const dangerous = new Set(['__proto__', 'constructor', 'prototype']);
    const sanitized = Object.fromEntries(
      Object.entries(partialSettings).filter(([key]) => !dangerous.has(key))
    ) as Record<string, unknown>;

    const updatedSettings = { ...currentSettings, ...sanitized };
    this.save(updatedSettings);

    return globalThis.structuredClone
      ? globalThis.structuredClone(updatedSettings)
      : (JSON.parse(JSON.stringify(updatedSettings)) as Record<string, unknown>);
  }

  static clearCache(): void {
    this.cachedSettings = null;
  }
}
