// ABOUTME: Session class for managing collections of agents and session-level operations
// ABOUTME: Handles session creation, agent spawning, and session metadata management

import { Agent } from '~/agents/agent';
import { ThreadId, asThreadId } from '~/threads/types';
import { getLaceDbPath } from '~/config/lace-dir';
import { ThreadManager } from '~/threads/thread-manager';
import { ProviderRegistry } from '~/providers/registry';
import { ToolExecutor } from '~/tools/executor';

export interface SessionInfo {
  id: ThreadId;
  name: string;
  createdAt: Date;
  provider: string;
  model: string;
  agents: Array<{
    threadId: ThreadId;
    name: string;
    provider: string;
    model: string;
    status: string;
  }>;
}

export class Session {
  private _sessionAgent: Agent;
  private _sessionId: ThreadId;
  private _agents: Map<ThreadId, Agent> = new Map();
  private _dbPath: string;

  constructor(sessionAgent: Agent) {
    this._sessionAgent = sessionAgent;
    this._sessionId = asThreadId(sessionAgent.threadId);
    this._dbPath = getLaceDbPath();
  }

  static create(
    name: string,
    provider = 'anthropic',
    model = 'claude-3-haiku-20240307',
    dbPath?: string
  ): Session {
    const actualDbPath = dbPath || getLaceDbPath();

    // Create session agent using the regular Agent.createSession method
    const sessionAgent = Agent.createSession({
      providerType: provider,
      model,
      name,
      dbPath: actualDbPath,
    });

    // Mark the agent's thread as a session thread
    sessionAgent.updateThreadMetadata({
      isSession: true,
      name,
      provider,
      model,
    });

    return new Session(sessionAgent);
  }

  static getAll(dbPath?: string): SessionInfo[] {
    const threadManager = new ThreadManager(dbPath || getLaceDbPath());
    const allThreads = threadManager.getAllThreadsWithMetadata();

    // Filter for session threads
    const sessionThreads = allThreads.filter((thread) => thread.metadata?.isSession === true);

    return sessionThreads.map((thread) => ({
      id: asThreadId(thread.id),
      name: thread.metadata?.name || 'Unnamed Session',
      createdAt: thread.createdAt,
      provider: thread.metadata?.provider || 'unknown',
      model: thread.metadata?.model || 'unknown',
      agents: [], // Will be populated later if needed
    }));
  }

  static async getById(sessionId: ThreadId, dbPath?: string): Promise<Session | null> {
    const actualDbPath = dbPath || getLaceDbPath();
    const threadManager = new ThreadManager(actualDbPath);
    const thread = threadManager.getThread(sessionId);

    if (!thread || !thread.metadata?.isSession) {
      return null;
    }

    // Reconstruct the session agent from the existing thread
    const provider = (thread.metadata.provider as string) || 'anthropic';
    const model = (thread.metadata.model as string) || 'claude-3-haiku-20240307';

    // Create provider and tool executor (same as Agent.createSession)
    const registry = ProviderRegistry.createWithAutoDiscovery();
    const providerInstance = registry.createProvider(provider, { model });

    const toolExecutor = new ToolExecutor();
    toolExecutor.registerAllAvailableTools();

    // Create agent with existing thread
    const sessionAgent = new Agent({
      provider: providerInstance,
      toolExecutor,
      threadManager,
      threadId: sessionId,
      tools: toolExecutor.getAllTools(),
    });

    // Set this as the current thread for delegate creation
    threadManager.setCurrentThread(sessionId);

    const session = new Session(sessionAgent);

    // Load delegate threads (child agents) for this session
    const delegateThreadIds = threadManager.getThreadsForSession(sessionId);

    for (const delegateThreadId of delegateThreadIds) {
      const delegateThread = threadManager.getThread(delegateThreadId);
      if (delegateThread) {
        // Create agent for this delegate thread
        const delegateAgent = new Agent({
          provider: providerInstance,
          toolExecutor,
          threadManager,
          threadId: delegateThreadId,
          tools: toolExecutor.getAllTools(),
        });

        // Add to session's agents map
        (session as any)._agents.set(asThreadId(delegateThreadId), delegateAgent);
      }
    }

    return session;
  }

  getId(): ThreadId {
    return this._sessionId;
  }

  getInfo(): SessionInfo | null {
    const agents = this.getAgents();
    const metadata = this._sessionAgent.getThreadMetadata();

    return {
      id: this._sessionId,
      name: (metadata?.name as string) || 'Session ' + this._sessionId,
      createdAt: new Date(), // TODO: Store creation date properly
      provider: this._sessionAgent.providerName,
      model: (metadata?.model as string) || 'unknown',
      agents,
    };
  }

  spawnAgent(name: string, _provider?: string, _model?: string): Agent {
    // Create delegate agent using the session agent
    // This uses the same provider as the session agent
    const agent = this._sessionAgent.createDelegateAgent(this._sessionAgent.toolExecutor);

    // Store the agent name in the thread metadata
    agent.updateThreadMetadata({
      name,
      isAgent: true,
      parentSessionId: this._sessionId,
    });

    // Store agent
    this._agents.set(asThreadId(agent.threadId), agent);

    return agent;
  }

  getAgents(): Array<{
    threadId: ThreadId;
    name: string;
    provider: string;
    model: string;
    status: string;
  }> {
    return Array.from(this._agents.values()).map((agent) => {
      const metadata = agent.getThreadMetadata();
      return {
        threadId: asThreadId(agent.threadId),
        name: (metadata?.name as string) || 'Agent ' + agent.threadId,
        provider: agent.providerName,
        model: (metadata?.model as string) || 'unknown',
        status: agent.getCurrentState(),
      };
    });
  }

  getAgent(threadId: ThreadId): Agent | null {
    return this._agents.get(threadId) || null;
  }

  async startAgent(threadId: ThreadId): Promise<void> {
    const agent = this._agents.get(threadId);
    if (!agent) {
      throw new Error(`Agent not found: ${threadId}`);
    }
    await agent.start();
  }

  stopAgent(threadId: ThreadId): void {
    const agent = this._agents.get(threadId);
    if (!agent) {
      throw new Error(`Agent not found: ${threadId}`);
    }
    agent.stop();
  }

  async sendMessage(threadId: ThreadId, message: string): Promise<void> {
    const agent = this._agents.get(threadId);
    if (!agent) {
      throw new Error(`Agent not found: ${threadId}`);
    }
    await agent.sendMessage(message);
  }

  destroy(): void {
    // Stop all agents
    for (const agent of this._agents.values()) {
      agent.stop();
    }
    this._agents.clear();
  }
}
