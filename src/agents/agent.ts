// ABOUTME: Core agent class that handles reasoning, tool calls, and context management
// ABOUTME: Implements multi-generational memory and subagent coordination

import { ActivityLogger } from "../logging/activity-logger.js";
import { DebugLogger } from "../logging/debug-logger.js";
import { SynthesisEngine } from "../utilities/synthesis-engine.js";
import { TokenEstimator } from "../utilities/token-estimator.js";
import { ToolResultExtractor } from "../utilities/tool-result-extractor.js";
import { getRole, AgentRole } from "./agent-registry.ts";
import { ModelInstance } from "../models/model-instance.js";
import { Conversation } from "../conversation/conversation.js";
import { Message } from "../conversation/message.js";
import { ToolExecutor } from "../tools/tool-executor.js";

// TypeScript interfaces for Agent
interface AgentOptions {
  generation?: number;
  tools?: any;
  modelProvider?: any;
  model?: ModelInstance;
  verbose?: boolean;
  inheritedContext?: any;
  memoryAgents?: Map<string, any>;
  role?: string;
  task?: string;
  capabilities?: string[];
  toolApproval?: any;
  maxConcurrentTools?: number;
  retryConfig?: RetryConfig;
  circuitBreakerConfig?: CircuitBreakerConfig;
  synthesisConfig?: any;
  activityLogger?: any;
  debugLogger?: DebugLogger;
  conversationConfig?: ConversationConfig;
}

interface ConversationConfig {
  historyLimit?: number;
  contextUtilization?: number;
  cachingStrategy?: 'aggressive' | 'conservative' | 'disabled';
  freshMessageCount?: number;
}

interface RetryConfig {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  enabled?: boolean;
}

interface CircuitBreakerConfig {
  failureThreshold?: number;
  openTimeout?: number;
  halfOpenMaxCalls?: number;
}

interface ToolCall {
  name: string;
  input: any;
}

interface ToolResult {
  toolCall: ToolCall;
  success?: boolean;
  error?: string;
  denied?: boolean;
  approved?: boolean;
  shouldStop?: boolean;
  result?: any;
  content?: any;
  bytesWritten?: number;
  files?: any[];
  output?: string[];
  synthesized?: boolean;
  summary?: string;
  originalResult?: any;
  [key: string]: any;
}

interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface GenerateResponseResult {
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  usage?: Usage;
  stopped?: boolean;
  iterations?: number;
  error?: string;
}

interface CircuitBreakerState {
  state: "closed" | "open" | "half-open";
  failures: number;
  lastFailure: number | null;
  nextAttempt: number;
}

interface ErrorPattern {
  frequency: number;
  lastSeen: number | null;
  pattern: string;
  examples: string[];
}


export class Agent {
  // Core properties
  public generation: number;
  public subagentCounter: number;
  public tools: any;
  public modelProvider: any;
  public verbose: boolean;
  public inheritedContext: any;
  public memoryAgents: Map<string, any>;

  // Role and assignment properties
  public roleDefinition: AgentRole;
  public role: string;
  public model: ModelInstance;
  public task: string | null;
  public capabilities: string[];

  // Tool approval and configuration
  public toolApproval: any;
  public maxConcurrentTools: number;
  public retryConfig: RetryConfig;
  public circuitBreakerConfig: CircuitBreakerConfig;

  // State management
  public circuitBreaker: Map<string, CircuitBreakerState>;
  public toolRetryConfigs: Map<string, any>;
  public errorPatterns: Map<string, ErrorPattern>;

  // Utilities
  public synthesisEngine: SynthesisEngine;
  public tokenEstimator: TokenEstimator;
  public resultExtractor: ToolResultExtractor;
  public activityLogger: any;
  public debugLogger: DebugLogger | null;
  public toolExecutor: ToolExecutor;

  // Context management
  public contextSize: number;
  public maxContextSize: number;
  public handoffThreshold: number;
  public systemPrompt: string;

  // Conversation metrics
  public conversationMetrics: {
    totalMessages: number;
    totalTokensUsed: number;
    totalCacheHits: number;
    totalCacheCreations: number;
    sessionStartTime: number;
    lastActivity: number;
  };

  // Conversation configuration
  public conversationConfig: ConversationConfig;

  constructor(options: AgentOptions) {
    this.generation = options.generation || 0;
    this.subagentCounter = 0; // Track number of spawned subagents
    this.tools = options.tools;
    this.modelProvider = options.modelProvider;
    this.verbose = options.verbose || false;
    this.inheritedContext = options.inheritedContext || null;
    this.memoryAgents = options.memoryAgents || new Map();

    // Agent assignment - told by orchestrator
    this.roleDefinition = getRole(options.role || "general");
    this.role = this.roleDefinition.name;
    this.model = options.model || options.modelProvider?.getModelSession(this.roleDefinition.defaultModel);
    this.task = options.task || null;
    this.capabilities =
      options.capabilities || this.roleDefinition.capabilities;

    // Tool approval system
    this.toolApproval = options.toolApproval || null;

    // Parallel execution configuration
    this.maxConcurrentTools =
      options.maxConcurrentTools ||
      this.roleDefinition.maxConcurrentTools ||
      10;

    // Error recovery and retry configuration
    this.retryConfig = {
      maxRetries: 3,
      baseDelay: 100, // milliseconds
      maxDelay: 5000,
      backoffMultiplier: 2,
      ...options.retryConfig,
    };

    // Circuit breaker state
    this.circuitBreaker = new Map(); // toolName -> { state, failures, lastFailure, nextAttempt }
    this.circuitBreakerConfig = {
      failureThreshold: 5,
      openTimeout: 30000, // 30 seconds
      halfOpenMaxCalls: 1,
      ...options.circuitBreakerConfig,
    };

    // Tool-specific retry configurations
    this.toolRetryConfigs = new Map();

    // Error tracking
    this.errorPatterns = new Map(); // toolName -> error pattern stats

    // Initialize synthesis utilities
    this.synthesisEngine = new SynthesisEngine(options.synthesisConfig);
    this.tokenEstimator = new TokenEstimator();
    this.resultExtractor = new ToolResultExtractor();

    // Activity logging
    this.activityLogger = options.activityLogger || null;

    // Debug logging
    this.debugLogger = options.debugLogger || null;

    // Initialize tool executor
    this.toolExecutor = new ToolExecutor(
      this.tools,
      this.synthesisEngine,
      this.resultExtractor,
      {
        maxConcurrentTools: this.maxConcurrentTools,
        retryConfig: this.retryConfig,
        circuitBreakerConfig: this.circuitBreakerConfig,
        toolApproval: this.toolApproval,
        activityLogger: this.activityLogger,
        debugLogger: this.debugLogger,
        verbose: this.verbose,
        tools: this.tools,
        modelProvider: this.modelProvider,
      }
    );

    this.contextSize = 0;
    this.maxContextSize =
      this.roleDefinition.contextPreferences?.maxContextSize ||
      this.getModelContextWindow();
    this.handoffThreshold =
      this.roleDefinition.contextPreferences?.handoffThreshold || 0.8;

    this.systemPrompt = this.buildSystemPrompt();

    // Initialize conversation metrics
    this.conversationMetrics = {
      totalMessages: 0,
      totalTokensUsed: 0,
      totalCacheHits: 0,
      totalCacheCreations: 0,
      sessionStartTime: Date.now(),
      lastActivity: Date.now(),
    };

    // Initialize conversation configuration
    this.conversationConfig = {
      historyLimit: 10,
      contextUtilization: 0.7, // Use 70% of context for input
      cachingStrategy: 'aggressive',
      freshMessageCount: 2,
      ...options.conversationConfig,
    };
  }

  async processInput(
    conversation: Conversation,
    input: string,
    options: any = {},
  ): Promise<GenerateResponseResult> {
    try {
      // Update conversation metrics
      this.conversationMetrics.totalMessages++;
      this.conversationMetrics.lastActivity = Date.now();

      // Save user message
      await conversation.addUserMessage(input);

      // Check if we need to handoff context
      if (this.shouldHandoff()) {
        if (this.debugLogger) {
          this.debugLogger.info(
            "🔄 Context approaching limit, preparing handoff...",
          );
        }
        // TODO: Implement handoff logic
      }

      // Generate response using conversation
      const response = await this.generateResponse(conversation, input, options);

      // Save final agent response (generateResponse only saves thinking + tools, not final response)
      await conversation.addAssistantMessage(
        response.content,
        response.toolCalls
      );

      return response;
    } catch (error: any) {
      return {
        content: `Error: ${error.message}`,
        error: error.message,
      };
    }
  }

  async generateResponse(
    conversation: Conversation,
    input: string,
    options: any = {},
  ): Promise<GenerateResponseResult> {
    try {
      // Extract sessionId for internal methods that still need it
      const sessionId = conversation.getSessionId();
      
      // Build initial messages for token counting
      let messages = [
        { role: "system", content: this.systemPrompt },
        ...await conversation.getFormattedMessages(this.conversationConfig.historyLimit),
        { role: "user", content: input },
      ];

      // Optimize messages using model provider (truncation + caching)
      const availableTools = this.toolExecutor.buildToolsForLLM();
      if (this.modelProvider && this.modelProvider.optimizeMessages) {
        messages = await this.modelProvider.optimizeMessages(messages, {
          model: this.model.definition.name,
          tools: availableTools,
          contextUtilization: this.conversationConfig.contextUtilization
        });
      }

      // Count tokens accurately after optimization
      let initialTokenCount = 0;
      if (this.modelProvider && this.modelProvider.countTokens) {
        const tokenCountResult = await this.modelProvider.countTokens(messages, {
          model: this.model.definition.name,
          tools: availableTools,
          enableCaching: true,
        });
        if (tokenCountResult.success) {
          initialTokenCount = tokenCountResult.inputTokens;
          if (this.debugLogger) {
            this.debugLogger.debug(
              `📊 Accurate token count: ${initialTokenCount} input tokens (max: ${this.model.definition.contextWindow})`,
            );
          }
        }
      } else if (this.debugLogger) {
        this.debugLogger.debug("⚠️ Using token estimation - no accurate counting available");
      }

      // Update context size with accurate count
      this.contextSize = initialTokenCount;
      
      // Agentic loop with circuit breaker
      const maxIterations = 25;
      let iteration = 0;

      let allToolCalls = [];
      let allToolResults = [];
      let finalContent = "";
      let shouldStop = false;
      let totalUsage = {
        prompt_tokens: initialTokenCount,
        completion_tokens: 0,
        total_tokens: initialTokenCount,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      };

      while (iteration < maxIterations && !shouldStop) {
        iteration++;

        if (this.debugLogger) {
          this.debugLogger.debug(
            `🔄 Agentic iteration ${iteration}/${maxIterations}`,
          );
        }

        // Get available tools for the LLM
        const availableTools = this.toolExecutor.buildToolsForLLM();

        // Track token usage during streaming
        const onTokenUpdate = (tokenData: any) => {
          // Forward streaming tokens to user interface if callback provided
          if (options.onToken && tokenData.token) {
            options.onToken(tokenData.token);
          }
          
          // Forward thinking tokens separately if callback provided
          if (options.onThinkingToken && tokenData.thinkingToken) {
            options.onThinkingToken(tokenData.thinkingToken);
          }
          
          // Forward thinking state changes
          if (options.onThinkingState) {
            if (tokenData.thinkingStart) {
              options.onThinkingState({ state: 'start' });
            } else if (tokenData.contentBlockStop && tokenData.thinkingToken !== undefined) {
              options.onThinkingState({ state: 'stop' });
            }
          }
          
          // Forward tool use events
          if (options.onToolEvent) {
            if (tokenData.toolUseStart) {
              options.onToolEvent({ type: 'start', ...tokenData.toolUseStart });
            } else if (tokenData.toolUseComplete) {
              options.onToolEvent({ type: 'complete', ...tokenData.toolUseComplete });
            } else if (tokenData.toolUseError) {
              options.onToolEvent({ type: 'error', ...tokenData.toolUseError });
            } else if (tokenData.toolInputDelta) {
              options.onToolEvent({ type: 'input_delta', ...tokenData.toolInputDelta });
            }
          }

          if (this.verbose && tokenData.streaming) {
            let statusLine = `\r📊 Tokens: ${tokenData.inputTokens} in, ${tokenData.outputTokens} out`;
            
            // Add thinking indicator
            if (tokenData.thinkingToken) {
              statusLine += " 🤔";
            }
            
            // Add tool indicator
            if (tokenData.toolUseStart) {
              statusLine += ` 🔧 ${tokenData.toolUseStart.name}`;
            }
            
            process.stdout.write(statusLine);
          } else if (this.verbose && !tokenData.streaming) {
            process.stdout.write(
              `\r📊 Final: ${tokenData.inputTokens} in, ${tokenData.outputTokens} out\n`,
            );
          }
        };

        // Check for abort signal before making request
        if (options.signal?.aborted) {
          throw new Error("Operation was aborted");
        }

        // Log model request event
        if (this.activityLogger) {
          await this.activityLogger.logEvent("model_request", sessionId, null, {
            provider: this.model.definition.provider,
            model: this.model.definition.name,
            prompt: JSON.stringify(messages),
            timestamp: new Date().toISOString(),
          });
        }

        // Use model instance
        const startTime = Date.now();
        const response = await this.model.chat(messages, {
          tools: availableTools,
          maxTokens: 4096,
          onTokenUpdate: onTokenUpdate,
          signal: options.signal,
          enableCaching: true,
        });

        // Log model response event
        if (this.activityLogger && response.success) {
          const duration = Date.now() - startTime;
          const cost = this.calculateCost(
            response.usage?.input_tokens || response.usage?.prompt_tokens || 0,
            response.usage?.output_tokens ||
              response.usage?.completion_tokens ||
              0,
          );

          // Use model provider session ID if available
          const modelSessionId = response.sessionId || null;

          await this.activityLogger.logEvent(
            "model_response",
            sessionId,
            modelSessionId,
            {
              content: response.content || "",
              tokens_in:
                response.usage?.input_tokens ||
                response.usage?.prompt_tokens ||
                0,
              tokens_out:
                response.usage?.output_tokens ||
                response.usage?.completion_tokens ||
                0,
              cost: cost ? cost.totalCost : 0,
              duration_ms: duration,
            },
          );
        }

        if (!response.success) {
          return {
            content: `Error: ${response.error}`,
            error: response.error,
          };
        }

        // Accumulate usage stats and update context size
        if (response.usage) {
          totalUsage.prompt_tokens +=
            response.usage.input_tokens || response.usage.prompt_tokens || 0;
          totalUsage.completion_tokens +=
            response.usage.output_tokens ||
            response.usage.completion_tokens ||
            0;
          totalUsage.total_tokens += response.usage.total_tokens || 0;
          
          // Accumulate cache metrics if available
          totalUsage.cache_creation_input_tokens +=
            response.usage.cache_creation_input_tokens || 0;
          totalUsage.cache_read_input_tokens +=
            response.usage.cache_read_input_tokens || 0;
            
          // Update conversation metrics
          this.conversationMetrics.totalTokensUsed += response.usage.total_tokens || 0;
          this.conversationMetrics.totalCacheHits += response.usage.cache_read_input_tokens || 0;
          this.conversationMetrics.totalCacheCreations += response.usage.cache_creation_input_tokens || 0;
            
          this.contextSize = totalUsage.total_tokens;
        }

        // Add agent response to conversation
        messages.push({
          role: "assistant",
          content: response.content,
          ...(response.toolCalls && { tool_calls: response.toolCalls }),
        });

        finalContent = response.content;

        // Save the assistant's thinking/reasoning message before tool execution (only if there are tools)
        if (response.content && response.content.trim() && response.toolCalls && response.toolCalls.length > 0) {
          await conversation.addAssistantMessage(response.content);
        }

        // Execute tool calls if any
        const iterationToolResults = [];
        if (response.toolCalls && response.toolCalls.length > 0) {
          // Execute tools in parallel with concurrency limiting
          const rawToolResults = await this.toolExecutor.executeToolsInParallel(
            response.toolCalls,
            sessionId,
            response.content,
          );

          // Save tool executions to conversation
          for (let i = 0; i < response.toolCalls.length; i++) {
            const toolCall = response.toolCalls[i];
            const toolResult = rawToolResults[i];
            
            if (toolResult) {
              // Extract the actual result data - tool results have various possible fields
              const resultData = toolResult.result || toolResult.output || toolResult.data || toolResult.content || toolResult.stdout || 'No output available';
              
              await conversation.addToolExecution(
                toolCall,
                resultData,
                toolResult.error,
                toolResult.duration
              );
            }
          }

          // Apply batch synthesis for large results
          const toolResults = await this.toolExecutor.synthesizeToolResultsBatch(
            rawToolResults,
            response.toolCalls,
            sessionId,
            "Synthesize and summarize the tool output to preserve essential information while reducing token usage.",
          );

          iterationToolResults.push(...toolResults);
          allToolResults.push(...toolResults);

          // Check if any tool was denied with shouldStop
          const stopResult = toolResults.find(
            (result) => result.denied && result.shouldStop,
          );
          if (stopResult) {
            shouldStop = true;
            finalContent +=
              "\n\n⏸️ Execution stopped by user. Please provide further instructions.";
          }

          allToolCalls.push(...response.toolCalls);

          // Add tool results to conversation for next iteration
          if (iterationToolResults.length > 0) {
            const toolResultsMessage =
              this.toolExecutor.formatToolResultsForLLM(iterationToolResults);
            messages.push({
              role: "user",
              content: toolResultsMessage,
            });
          }
        } else {
          // No tool calls in this iteration, agent is done
          break;
        }
      }

      if (iteration >= maxIterations) {
        finalContent += `\n\n⚠️ Circuit breaker triggered after ${maxIterations} iterations.`;
      }

      // Display final token usage if verbose
      if (this.verbose && totalUsage.total_tokens > 0) {
        const contextUsage = this.calculateContextUsage(
          totalUsage.total_tokens,
        );
        const cost = this.calculateCost(
          totalUsage.prompt_tokens,
          totalUsage.completion_tokens,
        );

        if (this.debugLogger) {
          this.debugLogger.info(
            `\n📈 Session totals: ${totalUsage.prompt_tokens} in, ${totalUsage.completion_tokens} out, ${totalUsage.total_tokens} total tokens`,
          );
          this.debugLogger.info(
            `📊 Context usage: ${contextUsage.used}/${contextUsage.total} tokens (${contextUsage.percentage.toFixed(1)}%)`,
          );
          
          // Log cache performance if cache metrics are available
          if (totalUsage.cache_creation_input_tokens > 0 || totalUsage.cache_read_input_tokens > 0) {
            const totalCacheTokens = totalUsage.cache_creation_input_tokens + totalUsage.cache_read_input_tokens;
            const cacheHitRate = totalCacheTokens > 0 ? 
              (totalUsage.cache_read_input_tokens / totalCacheTokens * 100).toFixed(1) : '0.0';
            
            this.debugLogger.info(
              `💾 Cache performance: ${totalUsage.cache_read_input_tokens} hits, ${totalUsage.cache_creation_input_tokens} creations (${cacheHitRate}% hit rate)`,
            );
          }
          
          if (cost) {
            this.debugLogger.info(
              `💰 Cost: $${cost.totalCost.toFixed(4)} (in: $${cost.inputCost.toFixed(4)}, out: $${cost.outputCost.toFixed(4)})`,
            );
          }
        }
      }

      return {
        content: finalContent,
        toolCalls: allToolCalls,
        toolResults: allToolResults,
        usage: totalUsage,
        stopped: shouldStop,
        iterations: iteration,
      };
    } catch (error: any) {
      return {
        content: `Error generating response: ${error.message}`,
        error: error.message,
      };
    }
  }

  buildSystemPrompt(): string {
    const basePrompt = `You are a specialized agent in the Lace agentic coding environment.

AGENT CONFIGURATION:
- Role: ${this.role}
- Model: ${this.model.definition.name}
- Capabilities: ${this.capabilities.join(", ")}
${this.task ? `- Current Task: ${this.task}` : ""}

Available tools:
${this.tools
  .listTools()
  .map((name: string) => {
    const schema = this.tools.getToolSchema(name);
    return `- ${name}: ${schema?.description || "No description"}`;
  })
  .join("\n")}

ROLE GUIDELINES:
${this.roleDefinition.systemPrompt.split("\n").slice(2).join("\n")}

You should:
1. Operate within your assigned role and capabilities
2. Use appropriate tools to complete tasks
3. Provide clear feedback on what you're doing
4. Handle errors gracefully and suggest alternatives
5. Be concise but thorough

Focus on executing your assigned task efficiently.`;

    return basePrompt;
  }

  getToolRestrictions(): any {
    return this.roleDefinition.toolRestrictions || {};
  }
















  getModelContextWindow(): number {
    return this.model.definition.contextWindow;
  }

  calculateContextUsage(totalTokens: number): any {
    const contextWindow = this.getModelContextWindow();
    return {
      used: totalTokens,
      total: contextWindow,
      percentage: (totalTokens / contextWindow) * 100,
      remaining: contextWindow - totalTokens,
    };
  }

  calculateCost(inputTokens: number, outputTokens: number): any {
    const inputCost = (inputTokens / 1000000) * this.model.definition.inputPrice;
    const outputCost = (outputTokens / 1000000) * this.model.definition.outputPrice;

    return {
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      inputTokens,
      outputTokens,
    };
  }

  shouldHandoff() {
    return this.contextSize > this.maxContextSize * this.handoffThreshold;
  }

  async compressContext() {
    // TODO: Implement context compression
    return `Compressed context from generation ${this.generation}`;
  }


  getConversationMetrics(): any {
    const uptime = Date.now() - this.conversationMetrics.sessionStartTime;
    const cacheHitRate = this.conversationMetrics.totalCacheHits + this.conversationMetrics.totalCacheCreations > 0 ?
      (this.conversationMetrics.totalCacheHits / (this.conversationMetrics.totalCacheHits + this.conversationMetrics.totalCacheCreations) * 100).toFixed(1) : 
      '0.0';

    return {
      totalMessages: this.conversationMetrics.totalMessages,
      totalTokensUsed: this.conversationMetrics.totalTokensUsed,
      cacheHits: this.conversationMetrics.totalCacheHits,
      cacheCreations: this.conversationMetrics.totalCacheCreations,
      cacheHitRate: `${cacheHitRate}%`,
      sessionUptime: uptime,
      lastActivity: this.conversationMetrics.lastActivity,
    };
  }

  getConversationConfig(): ConversationConfig {
    return { ...this.conversationConfig };
  }

  updateConversationConfig(updates: Partial<ConversationConfig>): void {
    this.conversationConfig = {
      ...this.conversationConfig,
      ...updates,
    };
    
    if (this.debugLogger) {
      this.debugLogger.debug(
        `⚙️ Updated conversation config: ${JSON.stringify(updates)}`,
      );
    }
  }




  // ORCHESTRATION METHODS - for when this agent spawns subagents

  async spawnSubagent(options: AgentOptions): Promise<Agent> {
    // Increment counter and create unique generation ID
    this.subagentCounter++;
    const subgeneration = this.generation + this.subagentCounter * 0.1;

    // Use role's default model if no explicit model provided
    let model = options.model;
    if (!model && options.role) {
      const roleDefinition = getRole(options.role);
      model = this.modelProvider.getModelSession(roleDefinition.defaultModel);
    }

    const subagent = new Agent({
      ...options,
      model: model || this.model, // Fallback to parent model if still no model
      tools: this.tools,
      modelProvider: this.modelProvider,
      generation: subgeneration,
      verbose: this.verbose,
      toolApproval: this.toolApproval,
      activityLogger: this.activityLogger,
      debugLogger: this.debugLogger,
    });

    if (this.debugLogger) {
      this.debugLogger.debug(
        `🤖 Spawned ${options.role || "general"} agent with ${(model || this.model).definition.name}`,
      );
    }

    return subagent;
  }

  async delegateTask(
    sessionId: string,
    task: string,
    options: any = {},
  ): Promise<GenerateResponseResult> {
    // Orchestrator decides which model to use based on task complexity
    const agentConfig = this.chooseAgentForTask(task, options);

    const subagent = await this.spawnSubagent({
      ...agentConfig,
      task: task,
    });

    // Execute the task with the specialized agent
    // Create Conversation object for subagent call
    const delegateConversation = await Conversation.load(sessionId);
    const result = await subagent.generateResponse(delegateConversation, task);

    if (this.debugLogger) {
      this.debugLogger.info(`✅ Task completed by ${agentConfig.role} agent`);
    }

    return result;
  }

  chooseAgentForTask(task: string, options: any = {}): any {
    // Override with explicit options if provided
    if (options.role && options.model) {
      return options;
    }

    // Task complexity analysis for model selection
    const taskLower = task.toLowerCase();

    // Planning tasks - need deep reasoning
    if (
      taskLower.includes("plan") ||
      taskLower.includes("design") ||
      taskLower.includes("architect")
    ) {
      return {
        role: "planning",
      };
    }

    // Simple execution tasks - can use faster model
    if (
      taskLower.includes("run") ||
      taskLower.includes("execute") ||
      taskLower.includes("list") ||
      taskLower.includes("show")
    ) {
      return {
        role: "execution",
      };
    }

    // Complex reasoning tasks - need powerful model
    if (
      taskLower.includes("analyze") ||
      taskLower.includes("explain") ||
      taskLower.includes("debug") ||
      taskLower.includes("fix")
    ) {
      return {
        role: "reasoning",
      };
    }

    // Default to general-purpose
    return {
      role: "general",
    };
  }

  // ERROR RECOVERY AND RETRY UTILITY METHODS

  getToolRetryConfig(toolName: string): RetryConfig {
    const toolConfig = this.toolRetryConfigs.get(toolName) || {};
    return {
      ...this.retryConfig,
      ...toolConfig,
    };
  }

  setToolRetryConfig(toolName: string, config: any): void {
    this.toolRetryConfigs.set(toolName, config);
  }

  calculateBackoffDelay(attemptNumber: number, config: RetryConfig): number {
    const delay = Math.min(
      config.baseDelay! * Math.pow(config.backoffMultiplier!, attemptNumber),
      config.maxDelay!,
    );
    // Add jitter to prevent thundering herd
    return delay + Math.random() * (delay * 0.1);
  }

  async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  isRetriableError(error: any): boolean {
    const message = error.message.toLowerCase();

    // Non-retriable errors
    const nonRetriablePatterns = [
      "authentication",
      "authorization",
      "permission denied",
      "access denied",
      "invalid credentials",
      "forbidden",
      "not found",
      "bad request",
      "invalid input",
      "validation failed",
    ];

    for (const pattern of nonRetriablePatterns) {
      if (message.includes(pattern)) {
        return false;
      }
    }

    // Retriable errors
    const retriablePatterns = [
      "timeout",
      "network",
      "connection",
      "temporary",
      "unavailable",
      "overload",
      "rate limit",
      "too many requests",
      "service degraded",
      "concurrent",
    ];

    for (const pattern of retriablePatterns) {
      if (message.includes(pattern)) {
        return true;
      }
    }

    // Default: retry unknown errors
    return true;
  }

  categorizeError(error: any): any {
    const message = error.message.toLowerCase();

    if (
      message.includes("rate limit") ||
      message.includes("too many requests")
    ) {
      return {
        category: "rate_limit",
        suggestion: "Reduce request frequency and wait before retrying",
        retryAfter: 60000, // 1 minute
      };
    }

    if (message.includes("timeout") || message.includes("network")) {
      return {
        category: "network",
        suggestion: "Check network connectivity and retry",
        retryAfter: 5000, // 5 seconds
      };
    }

    if (message.includes("overload") || message.includes("concurrent")) {
      return {
        category: "overload",
        suggestion: "Reduce concurrent operations and retry sequentially",
        retryAfter: 10000, // 10 seconds
      };
    }

    if (message.includes("unavailable") || message.includes("service")) {
      return {
        category: "service_unavailable",
        suggestion: "Service may be down, retry after delay",
        retryAfter: 30000, // 30 seconds
      };
    }

    return {
      category: "unknown",
      suggestion: "Retry with exponential backoff",
      retryAfter: 1000, // 1 second
    };
  }

  // CIRCUIT BREAKER METHODS

  checkCircuitBreaker(toolName: string): any {
    const breaker = this.circuitBreaker.get(toolName);

    if (!breaker) {
      // Initialize circuit breaker for this tool
      this.circuitBreaker.set(toolName, {
        state: "closed",
        failures: 0,
        lastFailure: null,
        nextAttempt: 0,
      });
      return { blocked: false, recovered: false };
    }

    const now = Date.now();

    switch (breaker.state) {
      case "closed":
        return { blocked: false, recovered: false };

      case "open":
        if (now >= breaker.nextAttempt) {
          // Transition to half-open
          breaker.state = "half-open";
          return { blocked: false, recovered: true }; // This is recovery attempt
        }
        return { blocked: true, recovered: false };

      case "half-open":
        return { blocked: false, recovered: true };

      default:
        return { blocked: false, recovered: false };
    }
  }

  recordToolSuccess(toolName: string): void {
    const breaker = this.circuitBreaker.get(toolName);

    if (breaker) {
      if (breaker.state === "half-open") {
        // Success in half-open state - close the circuit
        breaker.state = "closed";
        breaker.failures = 0;
        breaker.lastFailure = null;
      }
    }
  }

  recordToolFailure(toolName: string, error: any): void {
    let breaker = this.circuitBreaker.get(toolName);

    if (!breaker) {
      breaker = {
        state: "closed",
        failures: 0,
        lastFailure: null,
        nextAttempt: 0,
      };
      this.circuitBreaker.set(toolName, breaker);
    }

    breaker.failures++;
    breaker.lastFailure = Date.now();

    // Update error patterns
    this.updateErrorPattern(toolName, error);

    // Check if we should open the circuit
    if (breaker.failures >= this.circuitBreakerConfig.failureThreshold!) {
      breaker.state = "open";
      breaker.nextAttempt = Date.now() + this.circuitBreakerConfig.openTimeout!;
    }
  }

  updateErrorPattern(toolName: string, error: any): void {
    let pattern = this.errorPatterns.get(toolName);

    if (!pattern) {
      pattern = {
        frequency: 0,
        lastSeen: null,
        pattern: "unknown",
        examples: [],
      };
      this.errorPatterns.set(toolName, pattern);
    }

    pattern.frequency++;
    pattern.lastSeen = Date.now();
    pattern.examples.push(error.message);

    // Keep only recent examples
    if (pattern.examples.length > 10) {
      pattern.examples = pattern.examples.slice(-10);
    }

    // Detect patterns
    const message = error.message.toLowerCase();
    if (message.includes("degraded") || message.includes("slow")) {
      pattern.pattern = "degraded_service";
    } else if (message.includes("rate") || message.includes("limit")) {
      pattern.pattern = "rate_limiting";
    } else if (message.includes("timeout") || message.includes("network")) {
      pattern.pattern = "connectivity_issues";
    }
  }

  getCircuitBreakerStats(): any {
    const stats: any = {};

    this.circuitBreaker.forEach((breaker, toolName) => {
      stats[toolName] = {
        state: breaker.state,
        failures: breaker.failures,
        lastFailure: breaker.lastFailure,
        nextAttempt: breaker.nextAttempt,
      };
    });

    return stats;
  }

  getErrorPatterns() {
    return Object.fromEntries(this.errorPatterns);
  }

  analyzeExecutionErrors(results: any[]): any {
    const toolSpecificErrors = [];
    const systemicErrors = [];
    const recommendations = [];

    for (const result of results) {
      if (!result.success && result.error) {
        const error = result.error.toLowerCase();
        const toolName = result.toolCall?.name?.split("_")[0];

        if (
          error.includes("validation") ||
          error.includes("input") ||
          error.includes("parameter")
        ) {
          toolSpecificErrors.push({
            tool: toolName,
            error: result.error,
            type: "validation",
          });
        } else if (
          error.includes("network") ||
          error.includes("timeout") ||
          error.includes("infrastructure")
        ) {
          systemicErrors.push({
            tool: toolName,
            error: result.error,
            type: "infrastructure",
          });
        }
      }
    }

    if (toolSpecificErrors.length > 0) {
      recommendations.push("tool-specific input validation and parameters");
    }

    if (systemicErrors.length > 0) {
      recommendations.push("infrastructure connectivity and service health");
    }

    return {
      toolSpecificErrors,
      systemicErrors,
      recommendations,
    };
  }
}
