// ABOUTME: Completion manager that coordinates multiple completion providers
// ABOUTME: Provides unified API for tab completion in the UI layer

import { CompletionProvider, CompletionResult, CompletionContext, CompletionItem, CompletionManagerOptions } from './types';

export class CompletionManager {
  private providers: CompletionProvider[] = [];
  private options: Required<CompletionManagerOptions>;

  constructor(options: CompletionManagerOptions = {}) {
    this.options = {
      maxItems: options.maxItems || 20,
      includeHistory: options.includeHistory ?? true,
      history: options.history || []
    };
  }

  /**
   * Register a completion provider
   */
  addProvider(provider: CompletionProvider) {
    this.providers.push(provider);
  }

  /**
   * Remove a completion provider
   */
  removeProvider(provider: CompletionProvider) {
    const index = this.providers.indexOf(provider);
    if (index > -1) {
      this.providers.splice(index, 1);
    }
  }

  /**
   * Get completions for the given context
   */
  async getCompletions(context: CompletionContext): Promise<CompletionResult> {
    const prefix = this.extractPrefix(context);
    
    // Find the appropriate provider
    const provider = this.providers.find(p => p.canHandle(context));
    
    if (!provider) {
      return {
        items: this.getHistoryCompletions(prefix),
        prefix
      };
    }

    try {
      const result = await provider.getCompletions(prefix);
      
      // Merge with history completions if enabled
      if (this.options.includeHistory) {
        const historyItems = this.getHistoryCompletions(prefix);
        result.items = [...result.items, ...historyItems];
      }

      // Limit total items
      if (result.items.length > this.options.maxItems) {
        result.items = result.items.slice(0, this.options.maxItems);
        result.hasMore = true;
      }

      return result;
      
    } catch (error) {
      console.warn('Completion error:', error);
      
      // Fallback to history completions
      return {
        items: this.getHistoryCompletions(prefix),
        prefix
      };
    }
  }

  /**
   * Extract the prefix to complete from the current context
   */
  private extractPrefix(context: CompletionContext): string {
    const { line, column } = context;
    
    if (context.lineNumber === 0 && line.startsWith('/')) {
      // Command completion: everything from / to cursor
      return line.slice(0, column);
    }
    
    // File completion: word before cursor
    const beforeCursor = line.slice(0, column);
    const match = beforeCursor.match(/(\S+)$/);
    return match ? match[1] : '';
  }

  /**
   * Get history-based completions
   */
  private getHistoryCompletions(prefix: string): CompletionItem[] {
    if (!this.options.includeHistory || !prefix.trim()) {
      return [];
    }

    return this.options.history
      .filter(item => {
        const lowerItem = item.toLowerCase();
        const lowerPrefix = prefix.toLowerCase();
        return lowerItem.includes(lowerPrefix) && lowerItem !== lowerPrefix;
      })
      .slice(0, 5) // Limit history items
      .map(item => ({
        value: item,
        description: 'from history',
        type: 'history' as const,
        priority: -1 // Lower priority than other completions
      }));
  }

  /**
   * Update the history for completion
   */
  updateHistory(history: string[]) {
    this.options.history = [...history];
  }

  /**
   * Get current options
   */
  getOptions(): CompletionManagerOptions {
    return { ...this.options };
  }

  /**
   * Update manager options
   */
  updateOptions(options: Partial<CompletionManagerOptions>) {
    this.options = { ...this.options, ...options };
  }

  /**
   * Get the number of registered providers (for testing)
   */
  getProviderCount(): number {
    return this.providers.length;
  }

  /**
   * Get provider at index (for testing)
   */
  getProvider(index: number): CompletionProvider | undefined {
    return this.providers[index];
  }
}