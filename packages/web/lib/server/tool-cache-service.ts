// ABOUTME: Cached tool service for efficient tool registry access
// ABOUTME: Singleton service to avoid re-registering tools on every API call

import { ToolExecutor } from '@/lib/server/lace-imports';
import { logger } from '~/utils/logger';

class ToolCacheService {
  private static instance: ToolCacheService | null = null;
  private toolExecutor: ToolExecutor | null = null;
  private userConfigurableTools: string[] | null = null;

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): ToolCacheService {
    if (!ToolCacheService.instance) {
      ToolCacheService.instance = new ToolCacheService();
    }
    return ToolCacheService.instance;
  }

  getUserConfigurableTools(): string[] {
    if (this.userConfigurableTools === null) {
      try {
        this.initializeTools();
      } catch (error) {
        logger.error('Failed to initialize tool registry', { error });
        this.userConfigurableTools = [];
      }
    }
    // Return immutable copy to prevent cache mutation
    return [...(this.userConfigurableTools ?? [])];
  }

  private initializeTools(): void {
    try {
      if (!this.toolExecutor) {
        this.toolExecutor = new ToolExecutor();
        this.toolExecutor.registerAllAvailableTools();
      }

      this.userConfigurableTools = this.toolExecutor
        .getAllTools()
        .filter((tool) => !tool.annotations?.safeInternal)
        .map((tool) => tool.name);
    } catch (error) {
      logger.error('Failed to register tools', { error });
      this.userConfigurableTools = [];
      throw error; // Re-throw for caller to handle
    }
  }

  // Method to refresh cache if needed (for testing or tool changes)
  refreshCache(): void {
    this.toolExecutor = null;
    this.userConfigurableTools = null;
  }
}

export const toolCacheService = ToolCacheService.getInstance();
