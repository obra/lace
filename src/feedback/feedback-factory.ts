// ABOUTME: Factory for creating and configuring contextual feedback systems
// ABOUTME: Provides presets and easy initialization for different use cases

import { ContextualFeedback } from './contextual-feedback';
import { FeedbackIntegration, FeedbackIntegrationConfig } from './feedback-integration';
import { FeedbackConfig, FeedbackContext, CommentaryType } from './types';
import { Agent } from '~/agents/agent';
import { ToolExecutor } from '~/tools/executor';
import { ThreadManager } from '~/threads/thread-manager';
import { logger } from '~/utils/logger';

export type FeedbackPreset = 'minimal' | 'standard' | 'verbose' | 'debug' | 'tennis-commentary';

export class FeedbackFactory {
  private static _presets: Record<FeedbackPreset, Partial<FeedbackIntegrationConfig>> = {
    minimal: {
      verbosity: 'quiet',
      timing: 'milestone',
      enabledTypes: ['error', 'celebration'],
      showPerformanceMetrics: false,
      showPredictions: false,
      showInsights: false,
      maxFeedbacksPerMinute: 5,
      enableTennisBanter: false,
      autoAttach: true,
      trackPerformance: false,
      trackErrors: true,
      trackToolUsage: false,
      trackTurns: false
    },
    standard: {
      verbosity: 'normal',
      timing: 'immediate',
      enabledTypes: ['action', 'performance', 'error', 'celebration'],
      showPerformanceMetrics: true,
      showPredictions: false,
      showInsights: true,
      maxFeedbacksPerMinute: 15,
      enableTennisBanter: false,
      autoAttach: true,
      trackPerformance: true,
      trackErrors: true,
      trackToolUsage: true,
      trackTurns: true
    },
    verbose: {
      verbosity: 'verbose',
      timing: 'immediate',
      enabledTypes: ['action', 'performance', 'educational', 'error', 'optimization', 'celebration'],
      showPerformanceMetrics: true,
      showPredictions: true,
      showInsights: true,
      maxFeedbacksPerMinute: 30,
      enableTennisBanter: false,
      autoAttach: true,
      trackPerformance: true,
      trackErrors: true,
      trackToolUsage: true,
      trackTurns: true
    },
    debug: {
      verbosity: 'commentary',
      timing: 'immediate',
      enabledTypes: ['action', 'performance', 'educational', 'predictive', 'error', 'optimization', 'insight', 'celebration'],
      showPerformanceMetrics: true,
      showPredictions: true,
      showInsights: true,
      maxFeedbacksPerMinute: 60,
      enableTennisBanter: false,
      autoAttach: true,
      trackPerformance: true,
      trackErrors: true,
      trackToolUsage: true,
      trackTurns: true
    },
    'tennis-commentary': {
      verbosity: 'commentary',
      timing: 'immediate',
      enabledTypes: ['action', 'performance', 'educational', 'predictive', 'error', 'optimization', 'insight', 'celebration'],
      showPerformanceMetrics: true,
      showPredictions: true,
      showInsights: true,
      maxFeedbacksPerMinute: 45,
      enableTennisBanter: true,
      autoAttach: true,
      trackPerformance: true,
      trackErrors: true,
      trackToolUsage: true,
      trackTurns: true
    }
  };

  /**
   * Create a contextual feedback system with preset configuration
   */
  static createWithPreset(
    preset: FeedbackPreset,
    context: FeedbackContext,
    overrides?: Partial<FeedbackIntegrationConfig>
  ): FeedbackIntegration {
    const presetConfig = this._presets[preset];
    const config: FeedbackIntegrationConfig = {
      ...this._getDefaultConfig(),
      ...presetConfig,
      ...overrides
    };

    logger.info('Creating feedback system with preset', {
      preset,
      threadId: context.threadId,
      verbosity: config.verbosity,
      enableTennisBanter: config.enableTennisBanter
    });

    return new FeedbackIntegration(config, context);
  }

  /**
   * Create a contextual feedback system with custom configuration
   */
  static createWithConfig(
    config: FeedbackIntegrationConfig,
    context: FeedbackContext
  ): FeedbackIntegration {
    const fullConfig: FeedbackIntegrationConfig = {
      ...this._getDefaultConfig(),
      ...config
    };

    logger.info('Creating feedback system with custom config', {
      threadId: context.threadId,
      verbosity: fullConfig.verbosity
    });

    return new FeedbackIntegration(fullConfig, context);
  }

  /**
   * Create a standalone contextual feedback system (without integration)
   */
  static createStandalone(
    preset: FeedbackPreset,
    context: FeedbackContext,
    overrides?: Partial<FeedbackConfig>
  ): ContextualFeedback {
    const presetConfig = this._presets[preset];
    const config: FeedbackConfig = {
      verbosity: presetConfig.verbosity || 'normal',
      timing: presetConfig.timing || 'immediate',
      enabledTypes: presetConfig.enabledTypes || ['action', 'performance', 'error'],
      showPerformanceMetrics: presetConfig.showPerformanceMetrics || false,
      showPredictions: presetConfig.showPredictions || false,
      showInsights: presetConfig.showInsights || false,
      maxFeedbacksPerMinute: presetConfig.maxFeedbacksPerMinute || 15,
      enableTennisBanter: presetConfig.enableTennisBanter || false,
      ...overrides
    };

    logger.info('Creating standalone feedback system', {
      preset,
      threadId: context.threadId,
      verbosity: config.verbosity
    });

    return new ContextualFeedback(config, context);
  }

  /**
   * Create and auto-integrate with existing systems
   */
  static createAndIntegrate(
    preset: FeedbackPreset,
    context: FeedbackContext,
    systems: {
      agent: Agent;
      toolExecutor: ToolExecutor;
      threadManager: ThreadManager;
    },
    overrides?: Partial<FeedbackIntegrationConfig>
  ): FeedbackIntegration {
    const integration = this.createWithPreset(preset, context, overrides);
    
    if (integration._config?.autoAttach) {
      integration.integrateWithSystems(
        systems.agent,
        systems.toolExecutor,
        systems.threadManager
      );
    }

    logger.info('Feedback system created and integrated', {
      preset,
      threadId: context.threadId,
      autoAttached: integration._config?.autoAttach
    });

    return integration;
  }

  /**
   * Create context from minimal information
   */
  static createContext(threadId: string, additionalContext?: Partial<FeedbackContext>): FeedbackContext {
    return {
      threadId,
      ...additionalContext
    };
  }

  /**
   * Get available presets
   */
  static getAvailablePresets(): FeedbackPreset[] {
    return Object.keys(this._presets) as FeedbackPreset[];
  }

  /**
   * Get preset configuration
   */
  static getPresetConfig(preset: FeedbackPreset): Partial<FeedbackIntegrationConfig> {
    return { ...this._presets[preset] };
  }

  /**
   * Validate configuration
   */
  static validateConfig(config: Partial<FeedbackIntegrationConfig>): {
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

    // Performance warnings
    if (config.verbosity === 'commentary' && config.timing === 'immediate') {
      warnings.push('High verbosity with immediate timing may impact performance');
    }

    if (config.enableTennisBanter && config.verbosity === 'quiet') {
      warnings.push('Tennis banter enabled but verbosity is quiet');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Get recommended preset based on use case
   */
  static getRecommendedPreset(useCase: 'development' | 'production' | 'debugging' | 'demo'): FeedbackPreset {
    switch (useCase) {
      case 'development':
        return 'standard';
      case 'production':
        return 'minimal';
      case 'debugging':
        return 'debug';
      case 'demo':
        return 'tennis-commentary';
      default:
        return 'standard';
    }
  }

  private static _getDefaultConfig(): FeedbackIntegrationConfig {
    return {
      verbosity: 'normal',
      timing: 'immediate',
      enabledTypes: ['action', 'performance', 'error', 'celebration'],
      showPerformanceMetrics: true,
      showPredictions: false,
      showInsights: true,
      maxFeedbacksPerMinute: 15,
      enableTennisBanter: false,
      autoAttach: true,
      trackPerformance: true,
      trackErrors: true,
      trackToolUsage: true,
      trackTurns: true
    };
  }
}