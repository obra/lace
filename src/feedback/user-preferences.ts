// ABOUTME: User preference management for contextual feedback system
// ABOUTME: Handles saving, loading, and managing user feedback preferences

import { FeedbackConfig, CommentaryType, FeedbackVerbosity, FeedbackTiming } from './types';
import { logger } from '~/utils/logger';
import { join } from 'path';
import { homedir } from 'os';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

export interface UserFeedbackPreferences {
  version: string;
  lastUpdated: Date;
  global: FeedbackConfig;
  perProject: Record<string, Partial<FeedbackConfig>>;
  templates: Record<string, FeedbackConfig>;
  ui: {
    theme: 'light' | 'dark' | 'auto';
    compactMode: boolean;
    showTimestamps: boolean;
    showIcons: boolean;
    showContext: boolean;
    animationsEnabled: boolean;
    soundEnabled: boolean;
    notificationPosition: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  };
  advanced: {
    enableExperimental: boolean;
    debugMode: boolean;
    performanceTracking: boolean;
    analyticsEnabled: boolean;
    cacheEnabled: boolean;
    maxHistorySize: number;
  };
}

export interface PreferenceProfile {
  id: string;
  name: string;
  description: string;
  config: FeedbackConfig;
  createdAt: Date;
  lastUsed: Date;
  usageCount: number;
}

export class UserPreferencesManager {
  private _preferences: UserFeedbackPreferences;
  private _preferencesPath: string;
  private _profiles: Map<string, PreferenceProfile> = new Map();
  private _profilesPath: string;
  private _activeProfile?: string;

  constructor(customPath?: string) {
    this._preferencesPath = customPath || join(homedir(), '.lace', 'feedback-preferences.json');
    this._profilesPath = join(homedir(), '.lace', 'feedback-profiles.json');
    
    this._preferences = this._loadPreferences();
    this._loadProfiles();

    logger.info('UserPreferencesManager initialized', {
      preferencesPath: this._preferencesPath,
      version: this._preferences.version
    });
  }

  // Get current preferences
  getPreferences(): UserFeedbackPreferences {
    return { ...this._preferences };
  }

  // Get global feedback config
  getGlobalConfig(): FeedbackConfig {
    return { ...this._preferences.global };
  }

  // Get project-specific config
  getProjectConfig(projectPath: string): FeedbackConfig {
    const projectOverrides = this._preferences.perProject[projectPath] || {};
    return { ...this._preferences.global, ...projectOverrides };
  }

  // Update global preferences
  updateGlobalConfig(config: Partial<FeedbackConfig>): void {
    this._preferences.global = { ...this._preferences.global, ...config };
    this._preferences.lastUpdated = new Date();
    this._savePreferences();

    logger.info('Global feedback config updated', { config });
  }

  // Update project-specific preferences
  updateProjectConfig(projectPath: string, config: Partial<FeedbackConfig>): void {
    this._preferences.perProject[projectPath] = {
      ...this._preferences.perProject[projectPath],
      ...config
    };
    this._preferences.lastUpdated = new Date();
    this._savePreferences();

    logger.info('Project feedback config updated', { projectPath, config });
  }

  // Update UI preferences
  updateUIPreferences(ui: Partial<UserFeedbackPreferences['ui']>): void {
    this._preferences.ui = { ...this._preferences.ui, ...ui };
    this._preferences.lastUpdated = new Date();
    this._savePreferences();

    logger.info('UI preferences updated', { ui });
  }

  // Update advanced preferences
  updateAdvancedPreferences(advanced: Partial<UserFeedbackPreferences['advanced']>): void {
    this._preferences.advanced = { ...this._preferences.advanced, ...advanced };
    this._preferences.lastUpdated = new Date();
    this._savePreferences();

    logger.info('Advanced preferences updated', { advanced });
  }

  // Profile management
  createProfile(name: string, description: string, config: FeedbackConfig): string {
    const id = `profile_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const profile: PreferenceProfile = {
      id,
      name,
      description,
      config: { ...config },
      createdAt: new Date(),
      lastUsed: new Date(),
      usageCount: 0
    };

    this._profiles.set(id, profile);
    this._saveProfiles();

    logger.info('Profile created', { id, name });
    return id;
  }

  // Get all profiles
  getProfiles(): PreferenceProfile[] {
    return Array.from(this._profiles.values()).sort((a, b) => b.lastUsed.getTime() - a.lastUsed.getTime());
  }

  // Get specific profile
  getProfile(id: string): PreferenceProfile | undefined {
    return this._profiles.get(id);
  }

  // Apply profile
  applyProfile(id: string, scope: 'global' | 'project', projectPath?: string): boolean {
    const profile = this._profiles.get(id);
    if (!profile) {
      logger.warn('Profile not found', { id });
      return false;
    }

    profile.lastUsed = new Date();
    profile.usageCount++;
    this._activeProfile = id;

    if (scope === 'global') {
      this.updateGlobalConfig(profile.config);
    } else if (scope === 'project' && projectPath) {
      this.updateProjectConfig(projectPath, profile.config);
    }

    this._saveProfiles();
    logger.info('Profile applied', { id, scope, projectPath });
    return true;
  }

  // Delete profile
  deleteProfile(id: string): boolean {
    const success = this._profiles.delete(id);
    if (success) {
      this._saveProfiles();
      logger.info('Profile deleted', { id });
    }
    return success;
  }

  // Get current active profile
  getActiveProfile(): PreferenceProfile | undefined {
    return this._activeProfile ? this._profiles.get(this._activeProfile) : undefined;
  }

  // Template management
  saveTemplate(name: string, config: FeedbackConfig): void {
    this._preferences.templates[name] = { ...config };
    this._preferences.lastUpdated = new Date();
    this._savePreferences();

    logger.info('Template saved', { name });
  }

  // Get template
  getTemplate(name: string): FeedbackConfig | undefined {
    return this._preferences.templates[name] ? { ...this._preferences.templates[name] } : undefined;
  }

  // Get all templates
  getTemplates(): Record<string, FeedbackConfig> {
    return { ...this._preferences.templates };
  }

  // Delete template
  deleteTemplate(name: string): boolean {
    const success = delete this._preferences.templates[name];
    if (success) {
      this._preferences.lastUpdated = new Date();
      this._savePreferences();
      logger.info('Template deleted', { name });
    }
    return success;
  }

  // Quick settings
  setVerbosity(verbosity: FeedbackVerbosity): void {
    this.updateGlobalConfig({ verbosity });
  }

  setTiming(timing: FeedbackTiming): void {
    this.updateGlobalConfig({ timing });
  }

  setEnabledTypes(types: CommentaryType[]): void {
    this.updateGlobalConfig({ enabledTypes: types });
  }

  toggleTennisBanter(): void {
    this.updateGlobalConfig({ enableTennisBanter: !this._preferences.global.enableTennisBanter });
  }

  // Import/Export
  exportPreferences(): string {
    const exportData = {
      preferences: this._preferences,
      profiles: Array.from(this._profiles.values()),
      exportedAt: new Date(),
      version: this._preferences.version
    };

    logger.info('Preferences exported');
    return JSON.stringify(exportData, null, 2);
  }

  importPreferences(data: string): boolean {
    try {
      const importData = JSON.parse(data);
      
      // Validate structure
      if (!importData.preferences || !importData.profiles) {
        throw new Error('Invalid import data structure');
      }

      // Backup current preferences
      const backup = { ...this._preferences };
      const backupProfiles = new Map(this._profiles);

      try {
        // Import preferences
        this._preferences = { ...this._preferences, ...importData.preferences };
        this._preferences.lastUpdated = new Date();

        // Import profiles
        importData.profiles.forEach((profile: PreferenceProfile) => {
          this._profiles.set(profile.id, profile);
        });

        // Save
        this._savePreferences();
        this._saveProfiles();

        logger.info('Preferences imported successfully');
        return true;
      } catch (error) {
        // Restore backup on error
        this._preferences = backup;
        this._profiles = backupProfiles;
        throw error;
      }
    } catch (error) {
      logger.error('Failed to import preferences', { error });
      return false;
    }
  }

  // Reset to defaults
  resetToDefaults(): void {
    this._preferences = this._getDefaultPreferences();
    this._profiles.clear();
    this._activeProfile = undefined;
    
    this._savePreferences();
    this._saveProfiles();

    logger.info('Preferences reset to defaults');
  }

  // Validation
  validateConfig(config: Partial<FeedbackConfig>): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate verbosity
    if (config.verbosity && !['quiet', 'normal', 'verbose', 'commentary'].includes(config.verbosity)) {
      errors.push('Invalid verbosity level');
    }

    // Validate timing
    if (config.timing && !['immediate', 'batched', 'milestone'].includes(config.timing)) {
      errors.push('Invalid timing setting');
    }

    // Validate enabled types
    if (config.enabledTypes) {
      const validTypes: CommentaryType[] = ['action', 'performance', 'educational', 'predictive', 'error', 'optimization', 'insight', 'celebration'];
      const invalidTypes = config.enabledTypes.filter(type => !validTypes.includes(type));
      if (invalidTypes.length > 0) {
        errors.push(`Invalid commentary types: ${invalidTypes.join(', ')}`);
      }
    }

    // Validate rate limiting
    if (config.maxFeedbacksPerMinute !== undefined) {
      if (config.maxFeedbacksPerMinute < 1 || config.maxFeedbacksPerMinute > 100) {
        warnings.push('maxFeedbacksPerMinute should be between 1 and 100');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  // Private methods

  private _loadPreferences(): UserFeedbackPreferences {
    try {
      if (existsSync(this._preferencesPath)) {
        const data = readFileSync(this._preferencesPath, 'utf8');
        const parsed = JSON.parse(data);
        
        // Migrate if needed
        const migrated = this._migratePreferences(parsed);
        
        return { ...this._getDefaultPreferences(), ...migrated };
      }
    } catch (error) {
      logger.warn('Failed to load preferences, using defaults', { error });
    }

    return this._getDefaultPreferences();
  }

  private _savePreferences(): void {
    try {
      const dir = join(homedir(), '.lace');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(this._preferencesPath, JSON.stringify(this._preferences, null, 2));
    } catch (error) {
      logger.error('Failed to save preferences', { error });
    }
  }

  private _loadProfiles(): void {
    try {
      if (existsSync(this._profilesPath)) {
        const data = readFileSync(this._profilesPath, 'utf8');
        const profiles = JSON.parse(data) as PreferenceProfile[];
        
        profiles.forEach(profile => {
          this._profiles.set(profile.id, profile);
        });
      }
    } catch (error) {
      logger.warn('Failed to load profiles', { error });
    }
  }

  private _saveProfiles(): void {
    try {
      const dir = join(homedir(), '.lace');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const profiles = Array.from(this._profiles.values());
      writeFileSync(this._profilesPath, JSON.stringify(profiles, null, 2));
    } catch (error) {
      logger.error('Failed to save profiles', { error });
    }
  }

  private _getDefaultPreferences(): UserFeedbackPreferences {
    return {
      version: '1.0.0',
      lastUpdated: new Date(),
      global: {
        verbosity: 'normal',
        timing: 'immediate',
        enabledTypes: ['action', 'performance', 'error', 'celebration'],
        showPerformanceMetrics: true,
        showPredictions: false,
        showInsights: true,
        maxFeedbacksPerMinute: 15,
        enableTennisBanter: false
      },
      perProject: {},
      templates: {
        minimal: {
          verbosity: 'quiet',
          timing: 'milestone',
          enabledTypes: ['error', 'celebration'],
          showPerformanceMetrics: false,
          showPredictions: false,
          showInsights: false,
          maxFeedbacksPerMinute: 5,
          enableTennisBanter: false
        },
        debug: {
          verbosity: 'commentary',
          timing: 'immediate',
          enabledTypes: ['action', 'performance', 'educational', 'predictive', 'error', 'optimization', 'insight', 'celebration'],
          showPerformanceMetrics: true,
          showPredictions: true,
          showInsights: true,
          maxFeedbacksPerMinute: 60,
          enableTennisBanter: false
        },
        entertainment: {
          verbosity: 'commentary',
          timing: 'immediate',
          enabledTypes: ['action', 'performance', 'educational', 'predictive', 'error', 'optimization', 'insight', 'celebration'],
          showPerformanceMetrics: true,
          showPredictions: true,
          showInsights: true,
          maxFeedbacksPerMinute: 45,
          enableTennisBanter: true
        }
      },
      ui: {
        theme: 'auto',
        compactMode: false,
        showTimestamps: true,
        showIcons: true,
        showContext: false,
        animationsEnabled: true,
        soundEnabled: false,
        notificationPosition: 'top-right'
      },
      advanced: {
        enableExperimental: false,
        debugMode: false,
        performanceTracking: true,
        analyticsEnabled: true,
        cacheEnabled: true,
        maxHistorySize: 1000
      }
    };
  }

  private _migratePreferences(preferences: any): UserFeedbackPreferences {
    // Handle version migrations here
    if (!preferences.version) {
      preferences.version = '1.0.0';
    }

    // Ensure required fields exist
    const defaults = this._getDefaultPreferences();
    return {
      ...defaults,
      ...preferences,
      global: { ...defaults.global, ...preferences.global },
      ui: { ...defaults.ui, ...preferences.ui },
      advanced: { ...defaults.advanced, ...preferences.advanced }
    };
  }
}