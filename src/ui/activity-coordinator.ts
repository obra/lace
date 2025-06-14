// ABOUTME: ActivityCoordinator consolidates all activity logging functionality from LaceUI
// ABOUTME: Handles user input, agent responses, streaming tokens, and tool execution logging

import { ActivityLogger } from "../logging/activity-logger.js";
import { Conversation } from "../conversation/conversation.js";

interface AgentResponse {
  content: string;
  toolCalls?: any[];
  toolResults?: any[];
  usage?: any;
  iterations?: number;
  error?: string;
  stopped?: boolean;
}

export class ActivityCoordinator {
  private activityLogger: ActivityLogger;
  private verbose: boolean;
  private conversation: Conversation;

  constructor(activityLogger: ActivityLogger, verbose: boolean, conversation: Conversation) {
    this.activityLogger = activityLogger;
    this.verbose = verbose;
    this.conversation = conversation;
  }

  // Consolidate 4 private logging methods from LaceUI
  async logUserInput(input: string): Promise<void> {
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

  async logAgentResponse(
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

  async logStreamingToken(
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

  async logToolExecutions(
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

  // Consolidate 3 retrieval methods + command handler from LaceUI
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

  async getSessionActivity(sessionId?: string): Promise<any[]> {
    try {
      const targetSessionId = sessionId || this.conversation.getSessionId();
      return await this.activityLogger.getEvents({ sessionId: targetSessionId });
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
}