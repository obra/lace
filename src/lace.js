// ABOUTME: Core Lace class that orchestrates the agentic coding environment
// ABOUTME: Manages agents, tools, memory, and user interaction

import { ConversationDB } from './database/conversation-db.js';
import { ToolRegistry } from './tools/tool-registry.js';
import { Agent } from './agents/agent.ts';
import { Console } from './interface/console.js';
import { WebServer } from './interface/web-server.js';
import { ModelProvider } from './models/model-provider.js';
import { ToolApprovalManager } from './safety/tool-approval.js';
import { ActivityLogger } from './logging/activity-logger.js';
import { ProgressTracker } from './tools/progress-tracker.js';

export class Lace {
  constructor(options = {}) {
    this.options = options;
    this.verbose = options.verbose || false;
    this.memoryPath = options.memoryPath || './lace-memory.db';
    
    // Initialize activity logger first so it can be passed to other components
    this.activityLogger = new ActivityLogger();
    
    // Initialize progress tracker for agent coordination
    this.progressTracker = new ProgressTracker();
    
    this.db = new ConversationDB(this.memoryPath);
    this.tools = new ToolRegistry({ 
      activityLogger: this.activityLogger,
      progressTracker: this.progressTracker 
    });
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
    
    // Web server for companion UI (optional)
    this.webServer = new WebServer({
      port: parseInt(options.webPort) || 3000,
      activityLogger: this.activityLogger,
      db: this.db,
      verbose: this.verbose
    });
    
    this.console = new Console({ 
      activityLogger: this.activityLogger,
      webServer: this.webServer
    });
    
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
    
    // Start web server (optional - don't fail if it can't start)
    try {
      await this.webServer.start();
    } catch (error) {
      if (this.verbose) {
        console.error('Failed to start web companion:', error.message);
        console.log('Continuing with console-only mode...');
      }
    }
    
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
      maxConcurrentTools: this.options.maxConcurrentTools || 10,
      debugLogging: {
        logLevel: this.options.logLevel || 'off',
        logFile: this.options.logFile,
        logFileLevel: this.options.logFileLevel || 'off'
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
      activityLogger: this.activityLogger
    });
    
    return this.primaryAgent;
  }

  async shutdown() {
    if (this.verbose) {
      console.log('🧵 Shutting down Lace...');
    }

    // Stop web server if running
    try {
      await this.webServer.stop();
    } catch (error) {
      if (this.verbose) {
        console.error('Error stopping web server:', error.message);
      }
    }

    // Close database connections
    if (this.db) {
      await this.db.close();
    }

    if (this.activityLogger) {
      await this.activityLogger.close();
    }

    // Cleanup progress tracker
    if (this.progressTracker) {
      this.progressTracker.destroy();
    }
  }
}