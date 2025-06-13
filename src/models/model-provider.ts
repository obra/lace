// ABOUTME: Flexible model provider system supporting multiple LLM APIs and model instances
// ABOUTME: Uses ModelRegistry for provider management and provides model session creation

import { createHash } from "crypto";
import { ModelRegistry, modelRegistry, BaseModelProvider } from "./model-registry.js";
import { ModelInstance, SessionOptions, ChatOptions } from "./model-instance.js";
import { ModelDefinition } from "./model-definition.js";
import { AnthropicProvider } from "./providers/anthropic-provider.js";
import { OpenAIProvider } from "./providers/openai-provider.js";
import { LocalProvider } from "./providers/local-provider.js";

export class ModelProvider {
  private registry: ModelRegistry;
  private config: any;
  private defaultProvider: string | null;
  private debugLogger: any;
  private sessionId: string | null;
  private messageContentCache: Map<string, any>;

  constructor(config: any = {}) {
    this.registry = config.registry || modelRegistry;
    this.config = config;
    this.defaultProvider = null;
    this.debugLogger = config.debugLogger || null;
    this.sessionId = null;
    this.messageContentCache = new Map();
  }

  async initialize(): Promise<void> {
    // Initialize Anthropic provider (our default for now)
    if (!this.config.skipAnthropic) {
      const anthropicProvider = new AnthropicProvider(this.config.anthropic);
      await anthropicProvider.initialize();
      this.registry.registerProvider("anthropic", anthropicProvider);
      this.defaultProvider = "anthropic";
    }

    // Initialize other providers as needed
    if (this.config.openai) {
      const openaiProvider = new OpenAIProvider(this.config.openai);
      await openaiProvider.initialize();
      this.registry.registerProvider("openai", openaiProvider);
    }

    if (this.config.local) {
      const localProvider = new LocalProvider(this.config.local);
      await localProvider.initialize();
      this.registry.registerProvider("local", localProvider);
    }

    // Register default model definitions
    this.registerDefaultModelDefinitions();
  }

  private registerDefaultModelDefinitions(): void {
    // Anthropic models
    this.registry.registerModelDefinition("claude-3-5-sonnet-20241022", {
      name: "claude-3-5-sonnet-20241022",
      provider: "anthropic",
      contextWindow: 200000,
      inputPrice: 3.0,
      outputPrice: 15.0,
      capabilities: ["chat", "tools", "vision"]
    });

    this.registry.registerModelDefinition("claude-3-5-haiku-20241022", {
      name: "claude-3-5-haiku-20241022",
      provider: "anthropic",
      contextWindow: 200000,
      inputPrice: 0.8,
      outputPrice: 4.0,
      capabilities: ["chat", "tools", "vision"]
    });

    // Add more model definitions as needed
  }

  /**
   * Get a model session instance for the specified model
   */
  getModelSession(modelName: string, options?: SessionOptions): ModelInstance {
    const definition = this.registry.getModelDefinition(modelName);
    if (!definition) {
      throw new Error(`Model definition for '${modelName}' not found`);
    }

    const provider = this.getProvider(definition.provider);
    
    return new ModelSessionWrapper(definition, provider, options, this);
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

  async chat(messages: any[], options: ChatOptions = {}) {
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

      // Log complete response if it's new (entire result object)
      if (result.success || result.error) {
        const responseHash = this.hashMessageContent(JSON.stringify(result));
        const cacheKey = `assistant:${responseHash}`;
        
        if (!this.messageContentCache.has(cacheKey)) {
          this.messageContentCache.set(cacheKey, {
            content: result,
            firstSeen: new Date().toISOString()
          });
          
          this.debugLogger.debug(`📨 Complete Response (sha256:${responseHash})`);
          this.debugLogger.debug(`====== FULL RESPONSE ======`);
          this.debugLogger.debug(JSON.stringify(result, null, 2));
          this.debugLogger.debug(`====== END FULL RESPONSE ======`);
        } else {
          const contentPreview = result.content ? this.getFirstLine(result.content) : "";
          const toolCallsInfo = result.toolCalls && result.toolCalls.length > 0 
            ? ` + ${result.toolCalls.length} tool call${result.toolCalls.length === 1 ? '' : 's'}`
            : "";
          const successInfo = result.success ? "" : " [ERROR]";
          this.debugLogger.debug(`📨 Response (sha256:${responseHash}) [CACHED] "${contentPreview}"${toolCallsInfo}${successInfo}`);
        }
      }

      if (!result.success) {
        this.debugLogger.warn(`❌ LLM Error: ${result.error}`);
      }
    }

    return result;
  }


  getProvider(providerName?: string) {
    const name = providerName || this.defaultProvider;
    if (!name) {
      throw new Error("No provider specified and no default provider set");
    }
    
    const provider = this.registry.getProvider(name);
    if (!provider) {
      throw new Error(`Provider '${name}' not found or not initialized`);
    }
    return provider;
  }

  listProviders(): string[] {
    return this.registry.listProviders();
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

/**
 * Internal wrapper class that implements ModelInstance interface
 */
class ModelSessionWrapper implements ModelInstance {
  constructor(
    public definition: ModelDefinition,
    private provider: BaseModelProvider,
    private options?: SessionOptions,
    private modelProvider?: ModelProvider
  ) {}

  async chat(messages: any[], options?: ChatOptions): Promise<any> {
    // Use the provider's chat method with the model from our definition
    return await this.provider.chat(messages, {
      ...options,
      model: this.definition.name
    });
  }
}
