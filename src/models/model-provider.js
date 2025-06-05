// ABOUTME: Flexible model provider system supporting multiple LLM APIs and specialized roles
// ABOUTME: Allows different models for planning, execution, and specialized tasks

import { AnthropicProvider } from './providers/anthropic-provider.js';
import { OpenAIProvider } from './providers/openai-provider.js';
import { LocalProvider } from './providers/local-provider.js';

export class ModelProvider {
  constructor(config = {}) {
    this.providers = new Map();
    this.config = config;
    this.defaultProvider = null;
  }

  async initialize() {
    // Initialize Anthropic provider (our default for now)
    if (!this.config.skipAnthropic) {
      const anthropicProvider = new AnthropicProvider(this.config.anthropic);
      await anthropicProvider.initialize();
      this.providers.set('anthropic', anthropicProvider);
      this.defaultProvider = 'anthropic';
    }

    // TODO: Initialize other providers as needed
    // if (this.config.openai) {
    //   const openaiProvider = new OpenAIProvider(this.config.openai);
    //   this.providers.set('openai', openaiProvider);
    // }

    // if (this.config.local) {
    //   const localProvider = new LocalProvider(this.config.local);
    //   this.providers.set('local', localProvider);
    // }
  }

  async chat(messages, options = {}) {
    const provider = this.getProvider(options.provider);
    return await provider.chat(messages, {
      model: options.model,
      tools: options.tools,
      maxTokens: options.maxTokens,
      temperature: options.temperature
    });
  }

  async planningChat(messages, options = {}) {
    // Use specialized model for planning (e.g., o3 when available)
    return await this.chat(messages, {
      ...options,
      provider: options.provider || this.config.planningProvider || this.defaultProvider,
      model: options.model || this.config.planningModel || 'claude-3-5-sonnet-20241022',
      temperature: 0.1 // Lower temperature for planning
    });
  }

  async executionChat(messages, options = {}) {
    // Use efficient model for straightforward execution (e.g., Haiku)
    return await this.chat(messages, {
      ...options,
      provider: options.provider || this.config.executionProvider || this.defaultProvider,
      model: options.model || this.config.executionModel || 'claude-3-5-haiku-20241022',
      temperature: 0.3
    });
  }

  async reasoningChat(messages, options = {}) {
    // Use powerful model for complex reasoning
    return await this.chat(messages, {
      ...options,
      provider: options.provider || this.config.reasoningProvider || this.defaultProvider,
      model: options.model || this.config.reasoningModel || 'claude-3-5-sonnet-20241022',
      temperature: 0.5
    });
  }

  getProvider(providerName) {
    const name = providerName || this.defaultProvider;
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`Provider '${name}' not found or not initialized`);
    }
    return provider;
  }

  listProviders() {
    return Array.from(this.providers.keys());
  }

  getProviderInfo(providerName) {
    const provider = this.getProvider(providerName);
    return provider.getInfo();
  }
}