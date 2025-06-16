// ABOUTME: AgentCoordinator handles agent lifecycle, handoffs, and configuration management
// ABOUTME: Extracted from LaceUI to separate agent orchestration from UI concerns

import { Agent } from "./agent.js";
import { ToolRegistry } from "../tools/tool-registry.js";
import { ModelProvider } from "../models/model-provider.js";
import { ApprovalEngine } from "../safety/index.js";
import { ActivityLogger } from "../logging/activity-logger.js";
import { DebugLogger } from "../logging/debug-logger.js";
import { getDefaultModelForRole } from "../config/model-defaults.ts";

interface AgentCoordinatorOptions {
  tools: ToolRegistry;
  modelProvider: ModelProvider;
  toolApproval: ApprovalEngine;
  activityLogger: ActivityLogger;
  debugLogger: DebugLogger;
  verbose?: boolean;
  model?: string;
}

interface AgentStatusInfo {
  role: string;
  model: string;
  provider: string;
  generation: number;
}

interface ContextUsage {
  current: number;
  maximum: number;
  percentage: number;
  needsHandoff: boolean;
}

interface CostInfo {
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  currency: string;
}

export class AgentCoordinator {
  private tools: ToolRegistry;
  private modelProvider: ModelProvider;
  private toolApproval: ApprovalEngine;
  private activityLogger: ActivityLogger;
  private debugLogger: DebugLogger;
  private verbose: boolean;
  private primaryAgent: Agent | null = null;
  private memoryAgents: Map<string, Agent> = new Map();
  private currentGeneration: number = 0;

  constructor(options: AgentCoordinatorOptions) {
    this.tools = options.tools;
    this.modelProvider = options.modelProvider;
    this.toolApproval = options.toolApproval;
    this.activityLogger = options.activityLogger;
    this.debugLogger = options.debugLogger;
    this.verbose = options.verbose || false;
  }

  async initialize(): Promise<void> {
    this.primaryAgent = this.createPrimaryAgent();
  }

  // Agent management
  createPrimaryAgent(): Agent {
    return new Agent({
      generation: this.currentGeneration,
      tools: this.tools,
      modelProvider: this.modelProvider,
      model: this.modelProvider.getModelSession(getDefaultModelForRole("orchestrator")),
      toolApproval: this.toolApproval,
      verbose: this.verbose,
      role: "orchestrator",
      capabilities: ["orchestration", "reasoning", "planning", "delegation"],
      activityLogger: this.activityLogger,
      debugLogger: this.debugLogger,
    });
  }

  async handoffContext(): Promise<Agent> {
    if (!this.primaryAgent) {
      throw new Error("No primary agent available for handoff");
    }

    // Move current agent to memory agents
    this.memoryAgents.set(this.currentGeneration.toString(), this.primaryAgent);
    this.currentGeneration++;

    // Create new primary agent with compressed context
    const compressedContext = await this.primaryAgent.compressContext();
    this.primaryAgent = new Agent({
      generation: this.currentGeneration,
      tools: this.tools,
      modelProvider: this.modelProvider,
      model: this.modelProvider.getModelSession(getDefaultModelForRole("orchestrator")),
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

  // Status calculations extracted from LaceUI.getStatus()
  getAgentStatus(): AgentStatusInfo | null {
    if (!this.primaryAgent) {
      return null;
    }

    return {
      role: this.primaryAgent.role,
      model: this.primaryAgent.model.definition.name,
      provider: this.primaryAgent.model.definition.provider,
      generation: this.primaryAgent.generation,
    };
  }

  calculateContextUsage(): ContextUsage | null {
    if (!this.primaryAgent) {
      return null;
    }

    return this.primaryAgent.calculateContextUsage(
      this.primaryAgent.contextSize,
    );
  }

  calculateCost(): CostInfo | null {
    if (!this.primaryAgent) {
      return null;
    }

    return this.primaryAgent.calculateCost(
      this.primaryAgent.contextSize * 0.7, // Rough estimate for input tokens
      this.primaryAgent.contextSize * 0.3, // Rough estimate for output tokens
    );
  }

  // Accessors
  get primaryAgentInstance(): Agent | null {
    return this.primaryAgent;
  }

  get memoryAgentsMap(): Map<string, Agent> {
    return this.memoryAgents;
  }

  get currentGenerationNumber(): number {
    return this.currentGeneration;
  }
}