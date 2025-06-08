// ABOUTME: LaceUI class that integrates lace backend with Ink UI
// ABOUTME: Replaces Console interface while maintaining all lace functionality

import { render } from 'ink';
import React from 'react';
import { withFullScreen } from 'fullscreen-ink';
import { ConversationDB } from '../database/conversation-db.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { Agent } from '../agents/agent.js';
import { ModelProvider } from '../models/model-provider.js';
import { ToolApprovalManager } from '../safety/tool-approval.js';
import App from './App';

interface LaceUIOptions {
  verbose?: boolean;
  memoryPath?: string;
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
  private db: any;
  private tools: any;
  private modelProvider: any;
  private toolApproval: any;
  private primaryAgent: any;
  private memoryAgents: Map<number, any>;
  private currentGeneration: number;
  public sessionId: string;
  private app: any;
  private uiRef: any;
  public isProcessing: boolean;
  public abortController: AbortController | null;

  constructor(options: LaceUIOptions = {}) {
    this.options = options;
    this.verbose = options.verbose || false;
    this.memoryPath = options.memoryPath || './lace-memory.db';
    
    // Initialize lace backend components
    this.db = new ConversationDB(this.memoryPath);
    this.tools = new ToolRegistry();
    this.modelProvider = new ModelProvider({
      anthropic: {
        // Default to using Anthropic models
      }
    });
    
    // Tool approval system - can be configured
    this.toolApproval = new ToolApprovalManager({
      interactive: options.interactive !== false,
      autoApproveTools: options.autoApprove || options.autoApproveTools || [],
      alwaysDenyTools: options.deny || options.alwaysDenyTools || []
    });
    
    this.primaryAgent = null;
    this.memoryAgents = new Map(); // generationId -> agent
    this.currentGeneration = 0;
    this.sessionId = `session-${Date.now()}`;
    
    // UI state management
    this.app = null;
    this.uiRef = null;
    this.isProcessing = false;
    this.abortController = null;
  }

  async start() {
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
      capabilities: ['orchestration', 'reasoning', 'planning', 'delegation']
    });

    // Start the fullscreen Ink UI with exitOnCtrlC disabled  
    const fullscreenApp = withFullScreen(React.createElement(App, { laceUI: this }), {
      exitOnCtrlC: false
    });
    this.app = await fullscreenApp.start();

    return this.app;
  }

  async handleMessage(input: string): Promise<UIResponse> {
    if (this.isProcessing) {
      return {
        error: 'Already processing a message. Please wait or press Ctrl+C to abort.'
      };
    }

    this.isProcessing = true;
    this.abortController = new AbortController();

    try {
      // Setup streaming callback that sends tokens to UI
      const onToken = (token) => {
        if (this.uiRef && this.uiRef.handleStreamingToken) {
          this.uiRef.handleStreamingToken(token);
        }
      };

      const response = await this.primaryAgent.processInput(
        this.sessionId,
        input,
        {
          signal: this.abortController.signal,
          onToken: onToken
        }
      );

      return {
        success: true,
        content: response.content,
        toolCalls: response.toolCalls || [],
        toolResults: response.toolResults || [],
        usage: response.usage,
        agentActivities: this.formatAgentActivities(response)
      };
    } catch (error) {
      if (error.name === 'AbortError') {
        return {
          error: 'Operation was aborted.',
          aborted: true
        };
      } else {
        return {
          error: error.message,
          success: false
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
        let status = 'pending';
        let icon = '🔨';
        
        if (toolResult) {
          if (toolResult.denied) {
            status = 'denied';
            icon = '🚫';
          } else if (toolResult.error) {
            status = 'failed';
            icon = '❌';
          } else {
            status = 'completed';
            icon = '✅';
          }
        }
        
        activities.push(`${icon} ${toolCall.name} → ${status}`);
      });
    }
    
    // Add agent reasoning activity
    if (response.iterations && response.iterations > 1) {
      activities.push(`🤖 orchestrator → completed in ${response.iterations} iterations`);
    } else {
      activities.push('🤖 orchestrator → reasoning complete');
    }
    
    return activities;
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
      memoryAgents: this.memoryAgents
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

    const contextUsage = this.primaryAgent.calculateContextUsage(this.primaryAgent.contextSize);
    const cost = this.primaryAgent.calculateCost(
      this.primaryAgent.contextSize * 0.7, // Rough estimate for input tokens
      this.primaryAgent.contextSize * 0.3  // Rough estimate for output tokens
    );

    return {
      agent: {
        role: this.primaryAgent.role,
        model: this.primaryAgent.assignedModel,
        provider: this.primaryAgent.assignedProvider,
        generation: this.primaryAgent.generation
      },
      context: contextUsage,
      cost: cost,
      tools: this.tools.listTools(),
      session: this.sessionId
    };
  }

  // Command completion using console command registry
  getCommandCompletions(prefix: string) {
    // Import Console to use its command registry
    const { Console } = require('../interface/console.js');
    const console = new Console();
    console.currentAgent = this.primaryAgent; // Set agent for completions
    
    return console.getCommandCompletions(prefix);
  }

  // File completion using the file tool
  async getFileCompletions(prefix: string) {
    try {
      const fileTool = this.tools.get('file');
      if (!fileTool) {
        return [];
      }

      // Determine directory and base name
      const lastSlash = prefix.lastIndexOf('/');
      const dir = lastSlash === -1 ? '.' : prefix.substring(0, lastSlash + 1);
      const base = lastSlash === -1 ? prefix : prefix.substring(lastSlash + 1);

      // List directory contents
      const result = await fileTool.list({ path: dir === './' ? '.' : dir.replace(/\/$/, '') });
      
      if (!result.success) {
        return [];
      }

      // Filter and format results
      return result.files
        .filter(file => file.name.startsWith(base))
        .map(file => {
          const fullPath = dir === '.' ? file.name : dir + file.name;
          return {
            value: file.isDirectory ? fullPath + '/' : fullPath,
            description: file.isDirectory ? 'Directory' : 'File',
            type: file.isDirectory ? 'directory' as const : 'file' as const
          };
        });
    } catch (error) {
      return [];
    }
  }


  stop() {
    if (this.app) {
      this.app.unmount();
    }
  }
}