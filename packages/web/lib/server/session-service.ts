// ABOUTME: Server-side session management service
// ABOUTME: Provides high-level API for managing sessions and agents using the Agent class

import { Agent, ThreadManager, ProviderRegistry, ToolExecutor, getLaceDbPath, getEnvVar, DelegateTool } from './lace-imports';
import type { ThreadId } from './lace-imports';
import { Session, Agent as AgentType } from '@/types/api';

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

// Singleton instance
let sessionService: SessionService | null = null;

export function getSessionService(): SessionService {
  if (!sessionService) {
    sessionService = new SessionService();
  }
  return sessionService;
}