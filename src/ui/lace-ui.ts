// ABOUTME: LaceUI class that integrates lace backend with Ink UI
// ABOUTME: Replaces Console interface while maintaining all lace functionality

import { render } from "ink";
import React from "react";
import { withFullScreen } from "fullscreen-ink";
import { ToolRegistry } from "../tools/tool-registry.js";
import { Agent } from "../agents/agent.js";
import { ModelProvider } from "../models/model-provider.js";
import { ApprovalEngine } from "../safety/index.js";
import { ActivityLogger } from "../logging/activity-logger.js";
import { DebugLogger } from "../logging/debug-logger.js";
import { Conversation } from "../conversation/conversation.js";
import App from "./App";

interface LaceUIOptions {
  verbose?: boolean;
  memoryPath?: string;
  activityLogPath?: string;
  logLevel?: string;
  logFile?: string;
  logFileLevel?: string;
  interactive?: boolean;
  autoApprove?: string[];
  autoApproveTools?: string[];
  deny?: string[];
  alwaysDenyTools?: string[];
}

interface AgentResponse {
  content: string;
  toolCalls?: any[];
  toolResults?: any[];
  usage?: any;
  iterations?: number;
  error?: string;
  stopped?: boolean;
}

interface UIResponse {
  success?: boolean;
  content?: string;
  toolCalls?: any[];
  toolResults?: any[];
  usage?: any;
  agentActivities?: string[];
  error?: string;
  aborted?: boolean;
}

export class LaceUI {
  private options: LaceUIOptions;
  private verbose: boolean;
  private memoryPath: string;
  private activityLogPath: string;
  private tools: any;
  private modelProvider: any;
  private toolApproval: any;
  private activityLogger: ActivityLogger;
  private debugLogger: DebugLogger;
  private primaryAgent: any;
  private memoryAgents: Map<string, any>;
  private currentGeneration: number;
  public conversation: Conversation;
  private app: any;
  private uiRef: any;
  public isProcessing: boolean;
  public abortController: AbortController | null;

  constructor(options: LaceUIOptions = {}) {
    this.options = options;
    this.verbose = options.verbose || false;
    this.memoryPath = options.memoryPath || "./lace-memory.db";
    this.activityLogPath = options.activityLogPath || ".lace/activity.db";

    // Initialize debug logger first
    this.debugLogger = new DebugLogger({
      logLevel: options.logLevel || "off",
      logFile: options.logFile,
      logFileLevel: options.logFileLevel || "debug",
    });

    // Test debug logging immediately
    this.debugLogger.info("🚀 LaceUI initializing with debug logging enabled");
    this.debugLogger.debug(
      `Debug logging configuration: level=${options.logLevel || "off"}, file=${options.logFile || "none"}, fileLevel=${options.logFileLevel || "debug"}`,
    );

    // Initialize lace backend components
    this.tools = new ToolRegistry();
    this.modelProvider = new ModelProvider({
      anthropic: {
        // Default to using Anthropic models
      },
      debugLogger: this.debugLogger,
    });

    // Initialize activity logger
    this.activityLogger = new ActivityLogger(this.activityLogPath);

    // Tool approval system - can be configured
    this.toolApproval = new ApprovalEngine({
      interactive: options.interactive !== false,
      autoApproveTools: options.autoApprove || options.autoApproveTools || [],
      alwaysDenyTools: options.deny || options.alwaysDenyTools || [],
      activityLogger: this.activityLogger,
    });

    this.primaryAgent = null;
    this.memoryAgents = new Map(); // generationId -> agent
    this.currentGeneration = 0;

    // UI state management
    this.app = null;
    this.uiRef = null;
    this.isProcessing = false;
    this.abortController = null;
  }

  async initialize() {
    await this.tools.initialize();
    await this.modelProvider.initialize();

    // Initialize conversation
    const sessionId = `session-${Date.now()}`;
    this.conversation = await Conversation.load(sessionId, this.memoryPath);

    // Initialize activity logger
    try {
      await this.activityLogger.initialize();
    } catch (error) {
      console.error("ActivityLogger initialization failed:", error);
      // Continue without activity logging
    }

    this.primaryAgent = new Agent({
      generation: this.currentGeneration,
      tools: this.tools,
      modelProvider: this.modelProvider,
      model: this.modelProvider.getModelSession("claude-3-5-sonnet-20241022"),
      toolApproval: this.toolApproval,
      verbose: this.verbose,
      role: "orchestrator",
      capabilities: ["orchestration", "reasoning", "planning", "delegation"],
      activityLogger: this.activityLogger,
      debugLogger: this.debugLogger,
    });
  }

  async start() {
    await this.initialize();

    // Start the fullscreen Ink UI with exitOnCtrlC disabled
    const fullscreenApp = withFullScreen(
      React.createElement(App, { laceUI: this, conversation: this.conversation }),
      {
        exitOnCtrlC: false,
      },
    );
    this.app = await fullscreenApp.start();

    return this.app;
  }

  async handleMessage(input: string): Promise<UIResponse> {
    if (this.isProcessing) {
      return {
        error:
          "Already processing a message. Please wait or press Ctrl+C to abort.",
      };
    }

    this.isProcessing = true;
    this.abortController = new AbortController();
    const startTime = Date.now();

    // Log user input
    await this.logUserInput(input);

    try {
      // Setup streaming callback that sends tokens to UI and logs tokens
      let tokenPosition = 0;
      const onToken = (token: string) => {
        // Log streaming token
        this.logStreamingToken(token, tokenPosition++);

        // Send to UI
        if (this.uiRef && this.uiRef.handleStreamingToken) {
          this.uiRef.handleStreamingToken(token);
        }
      };

      const response = await this.primaryAgent.processInput(
        this.conversation,
        input,
        {
          signal: this.abortController.signal,
          onToken: onToken,
        },
      );

      // Log agent response
      const duration = Date.now() - startTime;
      await this.logAgentResponse(response, duration);

      // Log tool executions
      if (response.toolCalls && response.toolResults) {
        await this.logToolExecutions(response.toolCalls, response.toolResults);
      }

      return {
        success: true,
        content: response.content,
        toolCalls: response.toolCalls || [],
        toolResults: response.toolResults || [],
        usage: response.usage,
        agentActivities: this.formatAgentActivities(response),
      };
    } catch (error) {
      if (error.name === "AbortError") {
        return {
          error: "Operation was aborted.",
          aborted: true,
        };
      } else {
        return {
          error: error.message,
          success: false,
        };
      }
    } finally {
      this.isProcessing = false;
      this.abortController = null;
    }
  }

  handleAbort(): boolean {
    if (this.isProcessing && this.abortController) {
      this.abortController.abort();
      return true;
    }
    return false;
  }

  formatAgentActivities(response: AgentResponse): string[] {
    const activities = [];

    // Add tool calls as activities
    if (response.toolCalls && response.toolCalls.length > 0) {
      response.toolCalls.forEach((toolCall, index) => {
        const toolResult = response.toolResults?.[index];
        let status = "pending";
        let icon = "🔨";

        if (toolResult) {
          if (toolResult.denied) {
            status = "denied";
            icon = "🚫";
          } else if (toolResult.error) {
            status = "failed";
            icon = "❌";
          } else {
            status = "completed";
            icon = "✅";
          }
        }

        activities.push(`${icon} ${toolCall.name} → ${status}`);
      });
    }

    // Add agent reasoning activity
    if (response.iterations && response.iterations > 1) {
      activities.push(
        `🤖 orchestrator → completed in ${response.iterations} iterations`,
      );
    } else {
      activities.push("🤖 orchestrator → reasoning complete");
    }

    return activities;
  }

  async handoffContext() {
    // Move current agent to memory agents
    this.memoryAgents.set(this.currentGeneration.toString(), this.primaryAgent);
    this.currentGeneration++;

    // Create new primary agent with compressed context
    const compressedContext = await this.primaryAgent.compressContext();
    this.primaryAgent = new Agent({
      generation: this.currentGeneration,
      tools: this.tools,
      modelProvider: this.modelProvider,
      model: this.modelProvider.getModelSession("claude-3-5-sonnet-20241022"),
      verbose: this.verbose,
      role: "orchestrator",
      capabilities: ["orchestration", "reasoning", "planning", "delegation"],
      toolApproval: this.toolApproval,
      activityLogger: this.activityLogger,
      debugLogger: this.debugLogger,
      inheritedContext: compressedContext,
      memoryAgents: this.memoryAgents,
    });

    return this.primaryAgent;
  }

  setToolApprovalUICallback(callback) {
    if (this.toolApproval && this.toolApproval.setUICallback) {
      this.toolApproval.setUICallback(callback);
    }
  }

  getStatus() {
    if (!this.primaryAgent) {
      return null;
    }

    const contextUsage = this.primaryAgent.calculateContextUsage(
      this.primaryAgent.contextSize,
    );
    const cost = this.primaryAgent.calculateCost(
      this.primaryAgent.contextSize * 0.7, // Rough estimate for input tokens
      this.primaryAgent.contextSize * 0.3, // Rough estimate for output tokens
    );

    return {
      agent: {
        role: this.primaryAgent.role,
        model: this.primaryAgent.model.definition.name,
        provider: this.primaryAgent.model.definition.provider,
        generation: this.primaryAgent.generation,
      },
      context: contextUsage,
      cost: cost,
      tools: this.tools.listTools(),
      session: this.conversation.getSessionId(),
      conversation: this.primaryAgent.getConversationMetrics(),
    };
  }


  // File completion using the list_files tool
  async getFileCompletions(prefix: string) {
    try {
      const listFilesTool = this.tools.getTool("list_files");
      if (!listFilesTool) {
        return [];
      }

      // Determine directory and base name
      const lastSlash = prefix.lastIndexOf("/");
      const dir = lastSlash === -1 ? "." : prefix.substring(0, lastSlash + 1);
      const base = lastSlash === -1 ? prefix : prefix.substring(lastSlash + 1);

      // List directory contents
      const result = await listFilesTool.run({
        path: dir === "./" ? "." : dir.replace(/\/$/, ""),
      });

      // Filter and format results
      return result.entries
        .filter((entry) => entry.name.startsWith(base))
        .map((entry) => {
          const fullPath = dir === "." ? entry.name : dir + entry.name;
          return {
            value: entry.type === "directory" ? fullPath + "/" : fullPath,
            description: entry.type === "directory" ? "Directory" : "File",
            type: entry.type,
          };
        });
    } catch (error) {
      return [];
    }
  }

  // Activity logging methods
  private async logUserInput(input: string): Promise<void> {
    try {
      await this.activityLogger.logEvent("user_input", this.conversation.getSessionId(), null, {
        content: input,
        timestamp: new Date().toISOString(),
        input_length: input.length,
        session_id: this.conversation.getSessionId(),
      });
    } catch (error) {
      // Activity logging errors should not break the application
      if (this.verbose) {
        console.error("Failed to log user input:", error);
      }
    }
  }

  private async logAgentResponse(
    response: AgentResponse,
    duration: number,
  ): Promise<void> {
    try {
      const tokens =
        response.usage?.total_tokens || response.usage?.output_tokens || 0;
      const inputTokens = response.usage?.input_tokens || 0;
      const outputTokens = response.usage?.output_tokens || 0;

      await this.activityLogger.logEvent(
        "agent_response",
        this.conversation.getSessionId(),
        null,
        {
          content: response.content || "",
          tokens: tokens,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          duration_ms: duration,
          iterations: response.iterations || 1,
          error: response.error || null,
        },
      );
    } catch (error) {
      if (this.verbose) {
        console.error("Failed to log agent response:", error);
      }
    }
  }

  private async logStreamingToken(
    token: string,
    position: number,
  ): Promise<void> {
    try {
      await this.activityLogger.logEvent(
        "streaming_token",
        this.conversation.getSessionId(),
        null,
        {
          token: token,
          timestamp: new Date().toISOString(),
          position: position,
        },
      );
    } catch (error) {
      // Silent fail for streaming tokens to avoid spam
    }
  }

  private async logToolExecutions(
    toolCalls: any[],
    toolResults: any[],
  ): Promise<void> {
    try {
      for (let i = 0; i < toolCalls.length; i++) {
        const toolCall = toolCalls[i];
        const toolResult = toolResults[i];

        await this.activityLogger.logEvent(
          "tool_execution",
          this.conversation.getSessionId(),
          null,
          {
            tool_name: toolCall.name,
            input: toolCall.input || {},
            result: toolResult || {},
            duration_ms: Date.now(), // This would be more accurate with start/end timing
          },
        );
      }
    } catch (error) {
      if (this.verbose) {
        console.error("Failed to log tool executions:", error);
      }
    }
  }

  // Activity retrieval methods
  async getRecentActivity(limit: number = 20): Promise<any[]> {
    try {
      return await this.activityLogger.getRecentEvents(limit);
    } catch (error) {
      if (this.verbose) {
        console.error("Failed to retrieve recent activity:", error);
      }
      return [];
    }
  }

  async getSessionActivity(sessionId: string): Promise<any[]> {
    try {
      return await this.activityLogger.getEvents({ sessionId });
    } catch (error) {
      if (this.verbose) {
        console.error("Failed to retrieve session activity:", error);
      }
      return [];
    }
  }

  async getActivityByType(eventType: string): Promise<any[]> {
    try {
      return await this.activityLogger.getEvents({ eventType });
    } catch (error) {
      if (this.verbose) {
        console.error("Failed to retrieve activity by type:", error);
      }
      return [];
    }
  }

  // Activity command handler for UI commands
  async handleActivityCommand(
    subcommand: string,
    options: any = {},
  ): Promise<any[]> {
    switch (subcommand) {
      case "recent":
        return await this.getRecentActivity(options.limit || 20);
      case "session":
        const sessionId = options.sessionId || this.conversation.getSessionId();
        return await this.getSessionActivity(sessionId);
      case "type":
        return await this.getActivityByType(options.eventType);
      default:
        return await this.getRecentActivity(options.limit || 20);
    }
  }

  async stop() {
    // Close activity logger
    try {
      this.activityLogger.close();
    } catch (error) {
      console.error("ActivityLogger close failed:", error);
    }

    if (this.app) {
      this.app.unmount();
    }
  }
}
