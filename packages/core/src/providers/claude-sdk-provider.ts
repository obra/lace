// ABOUTME: Claude Agent SDK provider using subscription-based authentication
// ABOUTME: Integrates Anthropic's SDK while using Lace's tool system and approval flow

import {
  AIProvider,
  ProviderConfig,
  ProviderResponse,
  ProviderInfo,
  ModelInfo,
  ProviderRequestContext,
} from '~/providers/base-provider';
import type { ProviderMessage } from '~/providers/base-provider';
import type { Tool } from '~/tools/tool';
import { logger } from '~/utils/logger';
import { createHash } from 'crypto';

interface ClaudeSDKProviderConfig extends ProviderConfig {
  sessionToken: string | null; // SDK session credentials
}

export class ClaudeSDKProvider extends AIProvider {
  private sessionId?: string;
  private lastHistoryFingerprint?: string;

  constructor(config: ClaudeSDKProviderConfig) {
    super(config);
  }

  get providerName(): string {
    return 'claude-agents-sdk';
  }

  get supportsStreaming(): boolean {
    return true;
  }

  async createResponse(
    messages: ProviderMessage[],
    tools: Tool[],
    model: string,
    signal?: AbortSignal,
    context?: ProviderRequestContext
  ): Promise<ProviderResponse> {
    throw new Error('Not implemented');
  }

  getProviderInfo(): ProviderInfo {
    return {
      name: 'claude-agents-sdk',
      displayName: 'Claude Agent SDK (Subscription)',
      requiresApiKey: true,
      configurationHint: 'Requires Claude Pro/Team subscription authentication',
    };
  }

  getAvailableModels(): ModelInfo[] {
    // Hardcoded fallback - will be replaced with dynamic fetching
    return [
      this.createModel({
        id: 'claude-sonnet-4',
        displayName: 'Claude 4 Sonnet',
        description: 'Balanced performance and capability',
        contextWindow: 200000,
        maxOutputTokens: 8192,
        isDefault: true,
      }),
      this.createModel({
        id: 'claude-opus-4',
        displayName: 'Claude 4 Opus',
        description: 'Most capable model',
        contextWindow: 200000,
        maxOutputTokens: 8192,
      }),
      this.createModel({
        id: 'claude-haiku-4',
        displayName: 'Claude 4 Haiku',
        description: 'Fastest model',
        contextWindow: 200000,
        maxOutputTokens: 8192,
      }),
    ];
  }

  isConfigured(): boolean {
    const config = this._config as ClaudeSDKProviderConfig;
    return !!config.sessionToken && config.sessionToken.length > 0;
  }

  /**
   * Fingerprint conversation history to detect changes (compaction, edits)
   * Returns SHA256 hash of all messages to enable change detection
   */
  protected fingerprintHistory(messages: ProviderMessage[]): string {
    return createHash('sha256').update(JSON.stringify(messages)).digest('hex');
  }

  /**
   * Check if history has changed since last turn
   * Returns true if we can resume, false if we need new session
   */
  protected canResumeSession(messages: ProviderMessage[]): boolean {
    if (!this.sessionId || !this.lastHistoryFingerprint) {
      return false;
    }

    // Fingerprint everything except the latest user message
    const historyMessages = messages.slice(0, -1);
    const currentFingerprint = this.fingerprintHistory(historyMessages);

    return currentFingerprint === this.lastHistoryFingerprint;
  }

  /**
   * Update fingerprint after successful turn
   */
  protected updateFingerprint(messages: ProviderMessage[]): void {
    this.lastHistoryFingerprint = this.fingerprintHistory(messages);
  }
}
