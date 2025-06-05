// ABOUTME: Core Lace class that orchestrates the agentic coding environment
// ABOUTME: Manages agents, tools, memory, and user interaction

import { ConversationDB } from './database/conversation-db.js';
import { ToolRegistry } from './tools/tool-registry.js';
import { Agent } from './agents/agent.js';
import { Console } from './interface/console.js';
import { ModelProvider } from './models/model-provider.js';
import { ToolApprovalManager } from './safety/tool-approval.js';
import { ActivityLogger } from './logging/activity-logger.js';

export class Lace {
  constructor(options = {}) {
    this.options = options;
    this.verbose = options.verbose || false;
    this.memoryPath = options.memoryPath || './lace-memory.db';
    
    // Initialize activity logger first so it can be passed to other components
    this.activityLogger = new ActivityLogger();
    
    this.db = new ConversationDB(this.memoryPath);
    this.tools = new ToolRegistry({ activityLogger: this.activityLogger });
    this.modelProvider = new ModelProvider({
      anthropic: {
        // Default to using Anthropic models
      }
    });
    
    // Tool approval system - can be configured
    this.toolApproval = new ToolApprovalManager({
      interactive: options.interactive !== false,
      autoApproveTools: options.autoApprove || options.autoApproveTools || [],
      alwaysDenyTools: options.deny || options.alwaysDenyTools || [],
      activityLogger: this.activityLogger
    });
    
    this.console = new Console({ activityLogger: this.activityLogger });
    
    this.primaryAgent = null;
    this.memoryAgents = new Map(); // generationId -> agent
    this.currentGeneration = 0;
  }

  async start() {
    console.log('🧵 Lace - Your lightweight agentic coding environment');
    
    await this.activityLogger.initialize();
    await this.db.initialize();
    await this.tools.initialize();
    await this.modelProvider.initialize();
    
    this.primaryAgent = new Agent({
      generation: this.currentGeneration,
      tools: this.tools,
      db: this.db,
      modelProvider: this.modelProvider,
      toolApproval: this.toolApproval,
      verbose: this.verbose,
      role: 'orchestrator',
      assignedModel: 'claude-3-5-sonnet-20241022',
      assignedProvider: 'anthropic',
      capabilities: ['orchestration', 'reasoning', 'planning', 'delegation'],
      debugLogging: {
        logLevel: options.logLevel || 'off',
        logFile: options.logFile,
        logFileLevel: options.logFileLevel || 'off'
      },
      activityLogger: this.activityLogger
    });

    await this.console.start(this.primaryAgent);
  }

  async handoffContext() {
    // Move current agent to memory agents
    this.memoryAgents.set(this.currentGeneration, this.primaryAgent);
    this.currentGeneration++;
    
    // Create new primary agent with compressed context
    const compressedContext = await this.primaryAgent.compressContext();
    this.primaryAgent = new Agent({
      generation: this.currentGeneration,
      tools: this.tools,
      db: this.db,
      modelProvider: this.modelProvider,
      verbose: this.verbose,
      inheritedContext: compressedContext,
      memoryAgents: this.memoryAgents,
      debugLogging: {
        logLevel: this.options.logLevel || 'off',
        logFile: this.options.logFile,
        logFileLevel: this.options.logFileLevel || 'off'
      },
      activityLogger: this.console.activityLogger
    });
    
    return this.primaryAgent;
  }
}