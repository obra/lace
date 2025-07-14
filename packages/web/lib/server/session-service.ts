// ABOUTME: Server-side session management service
// ABOUTME: Provides high-level API for managing sessions and agents using the Agent class

import { Agent, ThreadManager, ProviderRegistry, ToolExecutor, getLaceDbPath, getEnvVar, DelegateTool } from './lace-imports';
import type { ThreadId } from './lace-imports';
import { Session, Agent as AgentType, SessionEvent } from '@/types/api';
import { SSEManager } from '@/lib/sse-manager';

// Active agent instances
const activeAgents = new Map<ThreadId, Agent>();

// Session metadata storage (temporary until we have proper DB support)
const sessionMetadata = new Map<ThreadId, { name: string; createdAt: string; isSession: true }>();

// Agent metadata storage
const agentMetadata = new Map<ThreadId, { name: string; provider: string; model: string }>();

export class SessionService {
  private threadManager: ThreadManager;

  constructor() {
    this.threadManager = new ThreadManager(getLaceDbPath());
  }

  async createProvider(providerType: string, model?: string) {
    try {
      // Ensure environment variables are available
      const apiKey = process.env.ANTHROPIC_API_KEY;
      console.log(`Creating provider ${providerType} with API key:`, apiKey ? 'present' : 'missing');
      
      const registry = await ProviderRegistry.createWithAutoDiscovery();
      const provider = await registry.createProvider(providerType, { model });
      console.log(`Created provider: ${providerType} with model: ${model}`);
      return provider;
    } catch (error) {
      console.error(`Failed to create provider ${providerType}:`, error);
      throw error;
    }
  }

  async createSession(name?: string): Promise<Session> {
    // Get default provider and model from environment
    const defaultProvider = getEnvVar('ANTHROPIC_API_KEY') ? 'anthropic' : 'openai';
    const defaultModel = 'claude-3-haiku-20240307';
    
    // Generate thread ID for the session
    const threadId = this.threadManager.generateThreadId();
    this.threadManager.createThread(threadId);
    
    // Create tool executor
    const toolExecutor = new ToolExecutor();
    toolExecutor.registerAllAvailableTools();
    
    // Create provider
    const provider = await this.createProvider(defaultProvider, defaultModel);
    
    // Create a new agent for the session
    const agent = new Agent({
      provider,
      toolExecutor,
      threadManager: this.threadManager,
      threadId,
      tools: toolExecutor.getAllTools(),
    });
    
    // Set up delegate tool dependencies
    const delegateTool = toolExecutor.getTool('delegate') as DelegateTool;
    if (delegateTool) {
      delegateTool.setDependencies(agent, toolExecutor);
    }
    
    // Store session metadata
    const session: Session = {
      id: threadId,
      name: name || 'Untitled Session',
      createdAt: new Date().toISOString(),
      agents: []
    };
    
    sessionMetadata.set(threadId, {
      name: session.name,
      createdAt: session.createdAt,
      isSession: true
    });
    
    // Store the agent instance
    activeAgents.set(threadId, agent);
    
    // Start the agent
    await agent.start();
    
    // Set up event handlers for SSE broadcasting
    this.setupAgentEventHandlers(agent, threadId);
    
    return session;
  }

  async listSessions(): Promise<Session[]> {
    // Return sessions from our metadata store
    const sessions: Session[] = [];
    
    for (const [threadId, metadata] of sessionMetadata.entries()) {
      const agents = this.getSessionAgents(threadId);
      sessions.push({
        id: threadId,
        name: metadata.name,
        createdAt: metadata.createdAt,
        agents
      });
    }
    
    return sessions;
  }

  async getSession(sessionId: ThreadId): Promise<Session | null> {
    const metadata = sessionMetadata.get(sessionId);
    if (!metadata) {
      return null;
    }
    
    const agents = this.getSessionAgents(sessionId);
    
    return {
      id: sessionId,
      name: metadata.name,
      createdAt: metadata.createdAt,
      agents
    };
  }

  async spawnAgent(
    sessionId: ThreadId,
    name: string,
    provider?: string,
    model?: string
  ): Promise<AgentType> {
    // Get the parent agent to access thread manager
    const parentAgent = activeAgents.get(sessionId);
    if (!parentAgent) {
      console.error('Session not found:', sessionId);
      console.error('Active agents:', Array.from(activeAgents.keys()));
      throw new Error('Session not found');
    }
    
    // Create tool executor for delegate
    const toolExecutor = new ToolExecutor();
    toolExecutor.registerAllAvailableTools();
    
    // Create provider - default to anthropic if not specified
    const providerType = provider || 'anthropic';
    const modelName = model || 'claude-3-5-sonnet-20241022';
    const delegateProvider = await this.createProvider(providerType, modelName);
    
    // Create delegate agent
    const delegateAgent = parentAgent.createDelegateAgent(
      toolExecutor,
      delegateProvider
    );
    
    // Set up delegate tool dependencies
    const delegateTool = toolExecutor.getTool('delegate') as DelegateTool;
    if (delegateTool) {
      delegateTool.setDependencies(delegateAgent, toolExecutor);
    }
    
    // Store the agent
    activeAgents.set(delegateAgent.threadId as ThreadId, delegateAgent);
    
    // Start the delegate agent
    await delegateAgent.start();
    
    // Set up event handlers for SSE broadcasting
    this.setupAgentEventHandlers(delegateAgent, sessionId);
    
    // Store agent metadata
    agentMetadata.set(delegateAgent.threadId as ThreadId, {
      name,
      provider: providerType,
      model: modelName
    });
    
    const agentData: AgentType = {
      threadId: delegateAgent.threadId as ThreadId,
      name,
      provider: providerType,
      model: modelName,
      status: 'idle',
      createdAt: new Date().toISOString()
    };
    
    return agentData;
  }

  getAgent(threadId: ThreadId): Agent | null {
    return activeAgents.get(threadId) || null;
  }

  private setupAgentEventHandlers(agent: Agent, sessionId: ThreadId): void {
    const sseManager = SSEManager.getInstance();
    const threadId = agent.threadId as ThreadId;
    
    console.log(`Setting up SSE event handlers for agent ${threadId} in session ${sessionId}`);
    
    // Check if agent is started
    const isRunning = (agent as any)._isRunning;
    console.log(`Agent ${threadId} running state:`, isRunning);
    
    agent.on('agent_thinking_start', () => {
      console.log(`Agent ${threadId} started thinking`);
      const event: SessionEvent = {
        type: 'THINKING',
        threadId,
        timestamp: new Date().toISOString(),
        data: { status: 'start' }
      };
      sseManager.broadcast(sessionId, event);
    });

    agent.on('agent_thinking_complete', () => {
      const event: SessionEvent = {
        type: 'THINKING',
        threadId,
        timestamp: new Date().toISOString(),
        data: { status: 'complete' }
      };
      sseManager.broadcast(sessionId, event);
    });

    agent.on('agent_response_complete', ({ content }: { content: string }) => {
      console.log(`Agent ${threadId} response complete:`, content.substring(0, 100) + '...');
      const event: SessionEvent = {
        type: 'AGENT_MESSAGE',
        threadId,
        timestamp: new Date().toISOString(),
        data: { content }
      };
      sseManager.broadcast(sessionId, event);
    });
    
    // Also listen for streaming tokens if needed
    agent.on('agent_token', ({ token }: { token: string }) => {
      // For now, we'll just log this to see if tokens are being emitted
      // Later we could stream these to the UI for real-time display
      process.stdout.write(token);
    });

    agent.on('tool_call_start', ({ toolName, input }: { toolName: string; input: any }) => {
      const event: SessionEvent = {
        type: 'TOOL_CALL',
        threadId,
        timestamp: new Date().toISOString(),
        data: { toolName, input }
      };
      sseManager.broadcast(sessionId, event);
    });

    agent.on('tool_call_complete', ({ toolName, result }: { toolName: string; result: any }) => {
      const event: SessionEvent = {
        type: 'TOOL_RESULT',
        threadId,
        timestamp: new Date().toISOString(),
        data: { toolName, result }
      };
      sseManager.broadcast(sessionId, event);
    });
    
    // Listen for state changes to debug
    agent.on('state_change', ({ from, to }: { from: string; to: string }) => {
      console.log(`Agent ${threadId} state changed: ${from} -> ${to}`);
    });
    
    // Listen for any errors
    agent.on('error', ({ error }: { error: Error }) => {
      console.error(`Agent ${threadId} error:`, error);
      const event: SessionEvent = {
        type: 'LOCAL_SYSTEM_MESSAGE',
        threadId,
        timestamp: new Date().toISOString(),
        data: { message: `Agent error: ${error.message}` }
      };
      sseManager.broadcast(sessionId, event);
    });
    
    // Listen for conversation complete
    agent.on('conversation_complete', () => {
      console.log(`Agent ${threadId} conversation complete`);
    });
    
    // Handle tool approval requests
    agent.on('approval_request', ({ toolName, input, isReadOnly, requestId, resolve }) => {
      console.log(`Tool approval requested for ${toolName} (${isReadOnly ? 'read-only' : 'destructive'})`);
      
      // For now, auto-approve read-only tools and deny destructive ones
      // TODO: Implement UI-based approval flow
      if (isReadOnly) {
        console.log(`Auto-approving read-only tool: ${toolName}`);
        resolve('allow_once');
      } else {
        console.log(`Auto-denying destructive tool: ${toolName}`);
        resolve('deny');
        
        // Notify UI about the denial
        const event: SessionEvent = {
          type: 'LOCAL_SYSTEM_MESSAGE',
          threadId,
          timestamp: new Date().toISOString(),
          data: { 
            message: `Tool "${toolName}" was denied (destructive operations not yet supported in web UI)`
          }
        };
        sseManager.broadcast(sessionId, event);
      }
    });
  }

  private getAgentStatus(agent: Agent): 'idle' | 'thinking' | 'streaming' | 'tool_execution' {
    // Access the agent's internal state
    const state = (agent as any)._state;
    return state || 'idle';
  }

  private getSessionAgents(sessionId: ThreadId): AgentType[] {
    const agents: AgentType[] = [];
    
    // Find all agents that are children of this session
    for (const [threadId, metadata] of agentMetadata.entries()) {
      if (threadId.startsWith(`${sessionId}.`)) {
        const agent = activeAgents.get(threadId);
        agents.push({
          threadId,
          name: metadata.name,
          provider: metadata.provider,
          model: metadata.model,
          status: agent ? this.getAgentStatus(agent) : 'inactive',
          createdAt: new Date().toISOString() // Would need to track this properly
        });
      }
    }
    
    return agents;
  }
}

// Use global to persist across HMR in development
declare global {
  // eslint-disable-next-line no-var
  var sessionService: SessionService | undefined;
}

export function getSessionService(): SessionService {
  if (!global.sessionService) {
    global.sessionService = new SessionService();
  }
  return global.sessionService;
}