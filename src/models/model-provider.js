// ABOUTME: Flexible model provider system supporting multiple LLM APIs and specialized roles
// ABOUTME: Allows different models for planning, execution, and specialized tasks

import { createHash } from "crypto";
import { AnthropicProvider } from "./providers/anthropic-provider.js";
import { OpenAIProvider } from "./providers/openai-provider.js";
import { LocalProvider } from "./providers/local-provider.js";

export class ModelProvider {
  constructor(config = {}) {
    this.providers = new Map();
    this.config = config;
    this.defaultProvider = null;
    this.debugLogger = config.debugLogger || null;
    this.sessionId = null; // Set by agent or caller
    this.messageContentCache = new Map(); // For deduplicating message content in logs
  }

  async initialize() {
    // Initialize Anthropic provider (our default for now)
    if (!this.config.skipAnthropic) {
      const anthropicProvider = new AnthropicProvider(this.config.anthropic);
      await anthropicProvider.initialize();
      this.providers.set("anthropic", anthropicProvider);
      this.defaultProvider = "anthropic";
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

  setSessionId(sessionId) {
    this.sessionId = sessionId;
    // Clear message cache for new session to avoid cross-session deduplication
    this.messageContentCache.clear();
  }

  hashMessageContent(content) {
    const contentStr = typeof content === "string" ? content : JSON.stringify(content);
    return createHash("sha256").update(contentStr, "utf8").digest("hex").substring(0, 12);
  }

  getFirstLine(content) {
    const contentStr = typeof content === "string" ? content : JSON.stringify(content);
    const firstLine = contentStr.split('\n')[0];
    return firstLine.length > 80 ? firstLine.substring(0, 77) + "..." : firstLine;
  }

  logMessageContent(message, index) {
    if (!this.debugLogger) return;

    const contentHash = this.hashMessageContent(message.content);
    const cacheKey = `${message.role}:${contentHash}`;
    
    if (this.messageContentCache.has(cacheKey)) {
      // Log condensed format for repeated messages
      const firstLine = this.getFirstLine(message.content);
      this.debugLogger.debug(`📨 Message[${index}] [${message.role}] (sha256:${contentHash}) [CACHED] "${firstLine}"`);
    } else {
      // Log full content for first-time messages
      this.messageContentCache.set(cacheKey, { 
        content: message.content,
        firstSeen: new Date().toISOString()
      });
      
      const contentStr = typeof message.content === "string" ? message.content : JSON.stringify(message.content, null, 2);
      this.debugLogger.debug(`📨 Message[${index}] [${message.role}] (sha256:${contentHash})`);
      this.debugLogger.debug(`====== CONTENT ======`);
      this.debugLogger.debug(contentStr);
      this.debugLogger.debug(`====== END CONTENT ======`);
    }
  }

  async chat(messages, options = {}) {
    const provider = this.getProvider(options.provider);
    const startTime = Date.now();

    // Log request
    if (this.debugLogger) {
      const requestInfo = `provider=${options.provider || this.defaultProvider}, model=${options.model || "default"}, messages=${messages.length}, tools=${!!(options.tools && options.tools.length > 0)}, temp=${options.temperature}`;
      this.debugLogger.debug(`🤖 LLM Request: ${requestInfo}`);

      // Enhanced message logging with content deduplication
      messages.forEach((msg, index) => {
        this.logMessageContent(msg, index);
      });
    }

    const result = await provider.chat(messages, {
      model: options.model,
      tools: options.tools,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      onTokenUpdate: options.onTokenUpdate,
    });

    // Log response
    if (this.debugLogger) {
      const duration = Date.now() - startTime;
      const responseInfo = `success=${result.success}, duration=${duration}ms, tokens=${result.usage?.total_tokens || "unknown"} (in:${result.usage?.input_tokens || "?"} out:${result.usage?.output_tokens || "?"}), tools=${!!(result.toolCalls && result.toolCalls.length > 0)}, content=${result.content ? result.content.length : 0}chars`;
      this.debugLogger.debug(`🤖 LLM Response: ${responseInfo}`);

      // Log response content if it's new
      if (result.success && result.content) {
        const responseHash = this.hashMessageContent(result.content);
        const cacheKey = `assistant:${responseHash}`;
        
        if (!this.messageContentCache.has(cacheKey)) {
          this.messageContentCache.set(cacheKey, {
            content: result.content,
            firstSeen: new Date().toISOString()
          });
          
          this.debugLogger.debug(`📨 Response Content (sha256:${responseHash})`);
          this.debugLogger.debug(`====== RESPONSE ======`);
          this.debugLogger.debug(result.content);
          this.debugLogger.debug(`====== END RESPONSE ======`);
        } else {
          const firstLine = this.getFirstLine(result.content);
          this.debugLogger.debug(`📨 Response (sha256:${responseHash}) [CACHED] "${firstLine}"`);
        }
      }

      if (!result.success) {
        this.debugLogger.warn(`❌ LLM Error: ${result.error}`);
      }
    }

    return result;
  }

  async planningChat(messages, options = {}) {
    // Use specialized model for planning (e.g., o3 when available)
    return await this.chat(messages, {
      ...options,
      provider:
        options.provider ||
        this.config.planningProvider ||
        this.defaultProvider,
      model:
        options.model ||
        this.config.planningModel ||
        "claude-3-5-sonnet-20241022",
      temperature: 0.1, // Lower temperature for planning
    });
  }

  async executionChat(messages, options = {}) {
    // Use efficient model for straightforward execution (e.g., Haiku)
    return await this.chat(messages, {
      ...options,
      provider:
        options.provider ||
        this.config.executionProvider ||
        this.defaultProvider,
      model:
        options.model ||
        this.config.executionModel ||
        "claude-3-5-haiku-20241022",
      temperature: 0.3,
    });
  }

  async reasoningChat(messages, options = {}) {
    // Use powerful model for complex reasoning
    return await this.chat(messages, {
      ...options,
      provider:
        options.provider ||
        this.config.reasoningProvider ||
        this.defaultProvider,
      model:
        options.model ||
        this.config.reasoningModel ||
        "claude-3-5-sonnet-20241022",
      temperature: 0.5,
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

  getContextWindow(model, providerName) {
    const provider = this.getProvider(providerName);
    if (provider.getContextWindow) {
      return provider.getContextWindow(model);
    }
    return 200000; // Default fallback
  }

  calculateCost(model, inputTokens, outputTokens, providerName) {
    const provider = this.getProvider(providerName);
    if (provider.calculateCost) {
      return provider.calculateCost(model, inputTokens, outputTokens);
    }
    return null;
  }

  getContextUsage(model, totalTokens, providerName) {
    const provider = this.getProvider(providerName);
    if (provider.getContextUsage) {
      return provider.getContextUsage(model, totalTokens);
    }

    // Fallback calculation
    const contextWindow = this.getContextWindow(model, providerName);
    return {
      used: totalTokens,
      total: contextWindow,
      percentage: (totalTokens / contextWindow) * 100,
      remaining: contextWindow - totalTokens,
    };
  }
}
