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
import { ActivityCoordinator } from "./activity-coordinator.js";
import { AgentCoordinator } from "../agents/agent-coordinator.js";
import { ToolApprovalCoordinator } from "./tool-approval-coordinator.js";
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
  private activityCoordinator: ActivityCoordinator;
  private agentCoordinator: AgentCoordinator;
  private toolApprovalCoordinator: ToolApprovalCoordinator;
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

    // Initialize activity coordinator
    this.activityCoordinator = new ActivityCoordinator(
      this.activityLogger,
      this.verbose,
      this.conversation
    );

    // Initialize agent coordinator
    this.agentCoordinator = new AgentCoordinator({
      tools: this.tools,
      modelProvider: this.modelProvider,
      toolApproval: this.toolApproval,
      activityLogger: this.activityLogger,
      debugLogger: this.debugLogger,
      verbose: this.verbose,
    });

    await this.agentCoordinator.initialize();

    // Initialize tool approval coordinator
    this.toolApprovalCoordinator = new ToolApprovalCoordinator(this.toolApproval);
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
    await this.activityCoordinator.logUserInput(input);

    try {
      // Setup streaming callback that sends tokens to UI and logs tokens
      let tokenPosition = 0;
      const onToken = (token: string) => {
        // Log streaming token
        this.activityCoordinator.logStreamingToken(token, tokenPosition++);

        // Send to UI
        if (this.uiRef && this.uiRef.handleStreamingToken) {
          this.uiRef.handleStreamingToken(token);
        }
      };

      const response = await this.agentCoordinator.primaryAgentInstance!.processInput(
        this.conversation,
        input,
        {
          signal: this.abortController.signal,
          onToken: onToken,
        },
      );

      // Log agent response
      const duration = Date.now() - startTime;
      await this.activityCoordinator.logAgentResponse(response, duration);

      // Log tool executions
      if (response.toolCalls && response.toolResults) {
        await this.activityCoordinator.logToolExecutions(response.toolCalls, response.toolResults);
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
    return this.agentCoordinator.handoffContext();
  }

  setToolApprovalUICallback(callback) {
    this.toolApprovalCoordinator.setUICallback(callback);
  }

  getStatus() {
    const agentStatus = this.agentCoordinator.getAgentStatus();
    if (!agentStatus) {
      return null;
    }

    const contextUsage = this.agentCoordinator.calculateContextUsage();
    const cost = this.agentCoordinator.calculateCost();
    const primaryAgent = this.agentCoordinator.primaryAgentInstance;

    return {
      agent: agentStatus,
      context: contextUsage,
      cost: cost,
      tools: this.tools.listTools(),
      session: this.conversation.getSessionId(),
      conversation: primaryAgent.getConversationMetrics(),
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

  // Activity delegation
  async handleActivityCommand(
    subcommand: string,
    options: any = {},
  ): Promise<any[]> {
    return this.activityCoordinator.handleActivityCommand(subcommand, options);
  }

  // Re-expose activity methods for backward compatibility
  async getRecentActivity(limit: number = 20): Promise<any[]> {
    return this.activityCoordinator.getRecentActivity(limit);
  }

  async getSessionActivity(sessionId?: string): Promise<any[]> {
    return this.activityCoordinator.getSessionActivity(sessionId);
  }

  async getActivityByType(eventType: string): Promise<any[]> {
    return this.activityCoordinator.getActivityByType(eventType);
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
