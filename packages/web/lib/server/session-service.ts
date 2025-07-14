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
    const registry = await ProviderRegistry.createWithAutoDiscovery();
    return await registry.createProvider(providerType, { model });
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
    
    agent.on('agent_thinking_start', () => {
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
      const event: SessionEvent = {
        type: 'AGENT_MESSAGE',
        threadId,
        timestamp: new Date().toISOString(),
        data: { content }
      };
      sseManager.broadcast(sessionId, event);
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
          status: agent ? 'idle' : 'inactive',
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