// ABOUTME: Handles all tool execution, retry, and result processing logic
// ABOUTME: Extracted from Agent class to reduce complexity and improve testability

import { SynthesisEngine } from "../utilities/synthesis-engine.js";
import { ToolResultExtractor } from "../utilities/tool-result-extractor.js";
import { TokenEstimator } from "../utilities/token-estimator.js";
import { Conversation } from "../conversation/conversation.js";

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

interface ToolExecutorConfig {
  maxConcurrentTools?: number;
  retryConfig?: any;
  circuitBreakerConfig?: any;
  toolApproval?: any;
  activityLogger?: any;
  debugLogger?: any;
  verbose?: boolean;
  tools?: any;
  modelProvider?: any;
}

// Simple semaphore for concurrency control
class Semaphore {
  private maxConcurrent: number;
  private current: number;
  private queue: (() => void)[];

  constructor(maxConcurrent: number) {
    this.maxConcurrent = maxConcurrent;
    this.current = 0;
    this.queue = [];
  }

  async acquire(): Promise<void> {
    if (this.current < this.maxConcurrent) {
      this.current++;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    this.current--;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      this.current++;
      if (next) next();
    }
  }
}

export class ToolExecutor {
  private tools: any;
  private synthesisEngine: SynthesisEngine;
  private resultExtractor: ToolResultExtractor;
  private tokenEstimator: TokenEstimator;
  private config: ToolExecutorConfig;

  constructor(
    tools: any,
    synthesisEngine: SynthesisEngine,
    resultExtractor: ToolResultExtractor,
    config: ToolExecutorConfig
  ) {
    this.tools = tools;
    this.synthesisEngine = synthesisEngine;
    this.resultExtractor = resultExtractor;
    this.tokenEstimator = new TokenEstimator();
    this.config = config;
  }

  async executeToolsInParallel(
    toolCalls: ToolCall[],
    sessionId: string,
    reasoning: string,
  ): Promise<ToolResult[]> {
    if (!toolCalls || toolCalls.length === 0) {
      return [];
    }

    // Create semaphore for concurrency limiting
    const semaphore = new Semaphore(this.config.maxConcurrentTools || 10);

    // Create promise for each tool call with concurrency control
    const toolPromises = toolCalls.map(async (toolCall) => {
      await semaphore.acquire();

      try {
        const result = await this.executeToolWithApproval(
          toolCall,
          sessionId,
          reasoning,
        );
        return result;
      } catch (error: any) {
        // Return error result instead of throwing
        return {
          toolCall,
          error: error.message,
          success: false,
          denied: false,
          approved: false,
        };
      } finally {
        semaphore.release();
      }
    });

    // Execute all tools in parallel and collect results
    const results = await Promise.all(toolPromises);

    if (this.config.debugLogger) {
      this.config.debugLogger.debug(
        `⚡ Executed ${toolCalls.length} tools in parallel (limit: ${this.config.maxConcurrentTools || 10})`,
      );
    }

    return results;
  }

  async executeToolWithApproval(
    toolCall: ToolCall,
    sessionId: string,
    reasoning: string,
  ): Promise<ToolResult> {
    // Request approval if approval system is available
    let approvedCall = toolCall;
    let postExecutionComment = null;

    if (this.config.toolApproval) {
      const approval = await this.config.toolApproval.requestApproval({
        toolCall,
        context: {
          reasoning: reasoning,
          sessionId: sessionId,
        },
      });

      if (!approval.approved) {
        return {
          toolCall,
          error: `Tool execution denied: ${approval.reason}`,
          success: false,
          denied: true,
          approved: false,
          shouldStop: approval.shouldStop,
        };
      }

      approvedCall = approval.modifiedCall || toolCall;
      postExecutionComment = approval.postExecutionComment;
    }

    // Execute the tool
    const result = await this.executeTool(approvedCall, sessionId);

    // Check if tool response needs synthesis (over 200 tokens)
    const synthesisPrompt = `Summarize this ${approvedCall.name} result for continued reasoning. Focus on key findings and next steps.`;
    const synthesizedResult = await this.synthesizeToolResponse(
      result,
      approvedCall,
      sessionId,
      synthesisPrompt,
    );

    return {
      toolCall: approvedCall,
      ...synthesizedResult, // Flatten the result into the response
      approved: true,
      denied: false,
      postExecutionComment,
    };
  }

  async executeTool(toolCall: ToolCall, sessionId: string): Promise<any> {
    // Simplified tool parsing - tools use simple names
    // Support for both simple names (preferred) and compound names (legacy)
    let toolName;

    // Check if this is a simple tool name first
    if (this.tools.getTool(toolCall.name)) {
      toolName = toolCall.name;
    } else {
      // Legacy compound name parsing for backward compatibility
      const parts = toolCall.name.split("_");
      if (parts.length >= 2) {
        parts.pop(); // Remove method part
        toolName = parts.join("_"); // Rest is tool name
      } else {
        toolName = toolCall.name;
      }

      // Final fallback
      if (!this.tools.getTool(toolName) && parts.length > 1) {
        toolName = parts[0];
      }
    }

    if (!this.tools.getTool(toolName)) {
      throw new Error(`Tool '${toolName}' not found`);
    }

    try {
      const result = await this.tools.callTool(
        toolName,
        toolCall.input,
        sessionId,
        { 
          tools: this.tools,
          modelProvider: this.config.modelProvider,
          toolApproval: this.config.toolApproval,
          debugLogger: this.config.debugLogger,
          activityLogger: this.config.activityLogger
        }
      );
      
      // Return standardized format with success flag and direct access to result properties
      return {
        success: true,
        ...result
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async synthesizeToolResponse(
    toolResult: any,
    toolCall: ToolCall,
    sessionId: string,
    synthesisPrompt: string,
  ): Promise<any> {
    const responseText = this.resultExtractor.extract(toolResult);
    const estimatedTokens = this.tokenEstimator.estimate(responseText);

    // Get tool-specific threshold
    const toolName = toolCall.name.split("_")[0];
    const threshold =
      (this.synthesisEngine.config as any).toolThresholds[toolName] ||
      (this.synthesisEngine.config as any).defaultThreshold;

    if (estimatedTokens <= threshold) {
      return toolResult; // Return as-is for short responses
    }

    if (this.config.debugLogger) {
      this.config.debugLogger.debug(
        `🔬 Synthesizing tool response (${estimatedTokens} estimated tokens)`,
      );
    }

    // For now, return original result - synthesis would require agent spawning
    // which creates circular dependency. This can be improved later.
    return toolResult;
  }

  async synthesizeToolResultsBatch(
    toolResults: any[],
    toolCalls: ToolCall[],
    sessionId: string,
    synthesisPrompt: string,
  ): Promise<any[]> {
    return await this.synthesisEngine.processSynthesis(toolResults, toolCalls, {
      individual: (result: any, call: any) =>
        this.synthesizeToolResponse(result, call, sessionId, synthesisPrompt),
      batch: (batch: any) =>
        this.synthesizeMultipleToolResults(batch, sessionId, synthesisPrompt),
    } as any);
  }

  async synthesizeMultipleToolResults(
    toolBatch: any[],
    sessionId: string,
    synthesisPrompt: string,
  ): Promise<any[]> {
    if (toolBatch.length === 0) return [];

    // For now, fall back to individual synthesis
    // Batch synthesis would require agent spawning which creates circular dependency
    const individualResults = [];
    for (const item of toolBatch) {
      const synthesized = await this.synthesizeToolResponse(
        item.result,
        item.call,
        sessionId,
        synthesisPrompt,
      );
      individualResults.push(synthesized);
    }
    return individualResults;
  }

  formatToolResultsForLLM(toolResults: ToolResult[]): string {
    const formattedResults = toolResults.map((tr) => {
      if (tr.denied) {
        return `Tool ${tr.toolCall.name} was denied: ${tr.error}`;
      }

      if (tr.error) {
        return `Tool ${tr.toolCall.name} failed: ${tr.error}`;
      }

      // Use flat structure - tool result properties are at top level
      if (tr.synthesized) {
        return `Tool ${tr.toolCall.name} executed successfully. Summary: ${tr.summary}`;
      }

      if (tr.success) {
        let resultText = "";

        // Handle different result formats
        if (tr.result !== undefined) {
          resultText =
            typeof tr.result === "object"
              ? JSON.stringify(tr.result)
              : String(tr.result);
        } else if (tr.content !== undefined) {
          resultText = `Content: ${tr.content.substring(0, 100)}${tr.content.length > 100 ? "..." : ""}`;
        } else if (tr.bytesWritten !== undefined) {
          resultText = `File written successfully (${tr.bytesWritten} bytes)`;
        } else if (tr.files !== undefined) {
          resultText = `Found ${tr.files.length} files`;
        } else {
          // Show relevant non-result fields
          const details = Object.keys(tr)
            .filter(
              (key) =>
                !["success", "toolCall", "approved", "denied"].includes(key),
            )
            .map((key) => `${key}: ${tr[key]}`)
            .join(", ");
          resultText = details || "Completed successfully";
        }

        if (tr.output && tr.output.length > 0) {
          resultText += tr.output.join("\n");
        }
        return `Tool ${tr.toolCall.name} executed successfully. ${resultText}`;
      } else {
        return `Tool ${tr.toolCall.name} failed: ${tr.error || "Unknown error"}`;
      }
    });

    return `Tool execution results:\n${formattedResults.join("\n")}`;
  }

  buildToolsForLLM(): any[] {
    const tools = [];
    for (const toolName of this.tools.listTools()) {
      const schema = this.tools.getToolSchema(toolName);
      if (schema && schema.methods) {
        // Convert our tool schema to Anthropic tool format
        for (const [methodName, methodInfo] of Object.entries(schema.methods)) {
          const method = methodInfo as any;
          tools.push({
            name: `${toolName}_${methodName}`,
            description: `${schema.description}: ${method.description}`,
            input_schema: {
              type: "object",
              properties: this.convertParametersToProperties(method.parameters),
              required: this.extractRequiredParameters(method.parameters),
            },
          });
        }
      }
    }
    return tools;
  }

  convertParametersToProperties(parameters: any): any {
    const properties: any = {};
    for (const [paramName, paramInfo] of Object.entries(parameters || {})) {
      const param = paramInfo as any;
      properties[paramName] = {
        type: param.type || "string",
        description: param.description || "",
      };
    }
    return properties;
  }

  extractRequiredParameters(parameters: any): string[] {
    const required: string[] = [];
    for (const [paramName, paramInfo] of Object.entries(parameters || {})) {
      const param = paramInfo as any;
      if (param.required) {
        required.push(paramName);
      }
    }
    return required;
  }
}