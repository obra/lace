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
    console.warn(`[DEBUG] Session.getById called for sessionId: ${sessionId}`);

    const actualDbPath = dbPath || getLaceDbPath();
    const threadManager = new ThreadManager(actualDbPath);
    const thread = threadManager.getThread(sessionId);

    if (!thread || !thread.metadata?.isSession) {
      console.warn(`[DEBUG] Thread not found or not a session: ${sessionId}`);
      return null;
    }

    console.warn(`[DEBUG] Reconstructing session agent for ${sessionId}`);

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

    console.warn(`[DEBUG] Starting session agent for ${sessionId}`);
    // Start the session agent
    await sessionAgent.start();
    console.warn(`[DEBUG] Session agent started, state: ${sessionAgent.getCurrentState()}`);

    // Set this as the current thread for delegate creation
    threadManager.setCurrentThread(sessionId);

    const session = new Session(sessionAgent);

    // Load delegate threads (child agents) for this session
    const delegateThreadIds = threadManager.getThreadsForSession(sessionId);
    console.warn(
      `[DEBUG] Found ${delegateThreadIds.length} delegate threads: ${delegateThreadIds.join(', ')}`
    );

    for (const delegateThreadId of delegateThreadIds) {
      const delegateThread = threadManager.getThread(delegateThreadId);
      if (delegateThread) {
        console.warn(`[DEBUG] Creating delegate agent for ${delegateThreadId}`);

        // Create agent for this delegate thread
        const delegateAgent = new Agent({
          provider: providerInstance,
          toolExecutor,
          threadManager,
          threadId: delegateThreadId,
          tools: toolExecutor.getAllTools(),
        });

        // Start the delegate agent
        await delegateAgent.start();
        console.warn(`[DEBUG] Delegate agent started, state: ${delegateAgent.getCurrentState()}`);

        // Add to session's agents map
        session._agents.set(asThreadId(delegateThreadId), delegateAgent);
      }
    }

    console.warn(`[DEBUG] Session reconstruction complete for ${sessionId}`);
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
    const agents = [];

    // Add the coordinator agent first
    const coordinatorMetadata = this._sessionAgent.getThreadMetadata();
    agents.push({
      threadId: asThreadId(this._sessionAgent.threadId),
      name: (coordinatorMetadata?.name as string) || 'Coordinator',
      provider: this._sessionAgent.providerName,
      model: (coordinatorMetadata?.model as string) || 'unknown',
      status: this._sessionAgent.getCurrentState(),
    });

    // Add delegate agents
    Array.from(this._agents.values()).forEach((agent) => {
      const metadata = agent.getThreadMetadata();
      agents.push({
        threadId: asThreadId(agent.threadId),
        name: (metadata?.name as string) || 'Agent ' + agent.threadId,
        provider: agent.providerName,
        model: (metadata?.model as string) || 'unknown',
        status: agent.getCurrentState(),
      });
    });

    return agents;
  }

  getAgent(threadId: ThreadId): Agent | null {
    // Check if it's the coordinator agent
    if (threadId === this._sessionId) {
      return this._sessionAgent;
    }

    // Check delegate agents
    const delegateAgent = this._agents.get(threadId);
    return delegateAgent || null;
  }

  async startAgent(threadId: ThreadId): Promise<void> {
    const agent = this.getAgent(threadId);
    if (!agent) {
      throw new Error(`Agent not found: ${threadId}`);
    }
    await agent.start();
  }

  stopAgent(threadId: ThreadId): void {
    const agent = this.getAgent(threadId);
    if (!agent) {
      throw new Error(`Agent not found: ${threadId}`);
    }
    agent.stop();
  }

  async sendMessage(threadId: ThreadId, message: string): Promise<void> {
    const agent = this.getAgent(threadId);
    if (!agent) {
      throw new Error(`Agent not found: ${threadId}`);
    }
    await agent.sendMessage(message);
  }

  destroy(): void {
    // Stop the coordinator agent
    this._sessionAgent.stop();

    // Stop all delegate agents
    for (const agent of this._agents.values()) {
      agent.stop();
    }
    this._agents.clear();
  }
}
