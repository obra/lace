// ABOUTME: Session class for managing collections of agents and session-level operations
// ABOUTME: Handles session creation, agent spawning, and session metadata management

import { Agent } from '~/agents/agent';
import { ThreadId, asThreadId } from '~/threads/types';
import { getLaceDbPath } from '~/config/lace-dir';
import { ThreadManager } from '~/threads/thread-manager';
import { ProviderRegistry } from '~/providers/registry';
import { ToolExecutor } from '~/tools/executor';
import { TaskManager } from '~/tasks/task-manager';
import { DatabasePersistence } from '~/persistence/database';
import { createTaskManagerTools } from '~/tools/implementations/task-manager';
import { BashTool } from '~/tools/implementations/bash';
import { FileReadTool } from '~/tools/implementations/file-read';
import { FileWriteTool } from '~/tools/implementations/file-write';
import { FileEditTool } from '~/tools/implementations/file-edit';
import { FileInsertTool } from '~/tools/implementations/file-insert';
import { FileListTool } from '~/tools/implementations/file-list';
import { RipgrepSearchTool } from '~/tools/implementations/ripgrep-search';
import { FileFindTool } from '~/tools/implementations/file-find';
import { DelegateTool } from '~/tools/implementations/delegate';
import { UrlFetchTool } from '~/tools/implementations/url-fetch';
import { logger } from '~/utils/logger';
import type { ApprovalCallback } from '~/tools/approval-types';

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
  private _taskManager: TaskManager;
  private _destroyed = false;

  constructor(sessionAgent: Agent) {
    this._sessionAgent = sessionAgent;
    this._sessionId = asThreadId(sessionAgent.threadId);
    this._dbPath = getLaceDbPath();

    // Initialize TaskManager for this session
    const persistence = new DatabasePersistence(this._dbPath);
    this._taskManager = new TaskManager(this._sessionId, persistence);
  }

  static create(
    name: string,
    provider = 'anthropic',
    model = 'claude-3-haiku-20240307',
    dbPath?: string
  ): Session {
    const actualDbPath = dbPath || getLaceDbPath();

    // Create provider
    const registry = ProviderRegistry.createWithAutoDiscovery();
    const providerInstance = registry.createProvider(provider, { model });

    // Create thread manager
    const threadManager = new ThreadManager(actualDbPath);
    const sessionInfo = threadManager.resumeOrCreate();
    const threadId = sessionInfo.threadId;

    // Create a temporary session to get TaskManager
    const tempPersistence = new DatabasePersistence(actualDbPath);
    const taskManager = new TaskManager(asThreadId(threadId), tempPersistence);

    // Create tool executor with TaskManager injection
    const toolExecutor = new ToolExecutor();
    Session.initializeTools(toolExecutor, taskManager);

    // Create agent
    const sessionAgent = new Agent({
      provider: providerInstance,
      toolExecutor,
      threadManager,
      threadId,
      tools: toolExecutor.getAllTools(),
    });

    // Mark the agent's thread as a session thread
    sessionAgent.updateThreadMetadata({
      isSession: true,
      name,
      provider,
      model,
    });

    const session = new Session(sessionAgent);
    // Update the session's task manager to use the one we created
    session._taskManager = taskManager;

    return session;
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
    logger.debug(`Session.getById called for sessionId: ${sessionId}`);

    const actualDbPath = dbPath || getLaceDbPath();
    const threadManager = new ThreadManager(actualDbPath);
    const thread = threadManager.getThread(sessionId);

    if (!thread || !thread.metadata?.isSession) {
      logger.warn(`Thread not found or not a session: ${sessionId}`);
      return null;
    }

    logger.debug(`Reconstructing session agent for ${sessionId}`);

    // Reconstruct the session agent from the existing thread
    const provider = (thread.metadata.provider as string) || 'anthropic';
    const model = (thread.metadata.model as string) || 'claude-3-haiku-20240307';

    // Create provider and tool executor (same as Agent.createSession)
    const registry = ProviderRegistry.createWithAutoDiscovery();
    const providerInstance = registry.createProvider(provider, { model });

    // Create TaskManager first
    const persistence = new DatabasePersistence(actualDbPath);
    const taskManager = new TaskManager(sessionId, persistence);

    // Create tool executor with TaskManager injection
    const toolExecutor = new ToolExecutor();
    Session.initializeTools(toolExecutor, taskManager);

    // Create agent with existing thread
    const sessionAgent = new Agent({
      provider: providerInstance,
      toolExecutor,
      threadManager,
      threadId: sessionId,
      tools: toolExecutor.getAllTools(),
    });

    logger.debug(`Starting session agent for ${sessionId}`);
    // Start the session agent
    await sessionAgent.start();
    logger.debug(`Session agent started, state: ${sessionAgent.getCurrentState()}`);

    // Set this as the current thread for delegate creation
    threadManager.setCurrentThread(sessionId);

    const session = new Session(sessionAgent);

    // Load delegate threads (child agents) for this session
    const delegateThreadIds = threadManager.getThreadsForSession(sessionId);
    logger.debug(
      `Found ${delegateThreadIds.length} delegate threads: ${delegateThreadIds.join(', ')}`
    );

    // Load delegate agents with proper error handling
    const delegateStartPromises = delegateThreadIds.map(async (delegateThreadId) => {
      try {
        const delegateThread = threadManager.getThread(delegateThreadId);
        if (!delegateThread) {
          logger.warn(`Delegate thread not found: ${delegateThreadId}`);
          return;
        }

        logger.debug(`Creating delegate agent for ${delegateThreadId}`);

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
        logger.debug(`Delegate agent started, state: ${delegateAgent.getCurrentState()}`);

        // Add to session's agents map
        session._agents.set(asThreadId(delegateThreadId), delegateAgent);
      } catch (error) {
        logger.error(`Failed to start delegate agent ${delegateThreadId}:`, error);
        // Continue loading other agents even if one fails
      }
    });

    // Wait for all delegate agents to start (with error handling)
    await Promise.all(delegateStartPromises);

    // Update the session's task manager to use the one we created
    session._taskManager = taskManager;

    logger.debug(`Session reconstruction complete for ${sessionId}`);
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
      createdAt: this._sessionAgent.getThreadCreatedAt() || new Date(),
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

  getTaskManager(): TaskManager {
    return this._taskManager;
  }

  private static initializeTools(toolExecutor: ToolExecutor, taskManager: TaskManager): void {
    // Register non-task tools
    const nonTaskTools = [
      new BashTool(),
      new FileReadTool(),
      new FileWriteTool(),
      new FileEditTool(),
      new FileInsertTool(),
      new FileListTool(),
      new RipgrepSearchTool(),
      new FileFindTool(),
      new DelegateTool(),
      new UrlFetchTool(),
    ];

    toolExecutor.registerTools(nonTaskTools);

    // Register task tools with TaskManager injection
    const taskTools = createTaskManagerTools(() => taskManager);
    toolExecutor.registerTools(taskTools);
  }

  destroy(): void {
    if (this._destroyed) {
      return;
    }

    this._destroyed = true;

    // Stop and cleanup the coordinator agent
    this._sessionAgent.stop();
    this._sessionAgent.removeAllListeners();

    // Stop and cleanup all delegate agents
    for (const agent of this._agents.values()) {
      agent.stop();
      agent.removeAllListeners();
    }
    this._agents.clear();
  }

  static async createWithDefaults(
    options: {
      name?: string;
      provider?: string;
      model?: string;
      approvalCallback?: ApprovalCallback;
      dbPath?: string;
    } = {}
  ): Promise<Session> {
    // Use existing logic for provider/model detection
    const provider = options.provider || Session.detectDefaultProvider();
    const model = options.model || Session.getDefaultModel(provider);
    const dbPath = options.dbPath || getLaceDbPath();
    const name = options.name || Session.generateSessionName();

    // Create session using existing create method
    const session = Session.create(name, provider, model, dbPath);

    // Set up coordinator agent with approval callback if provided
    const coordinatorAgent = session.getAgent(session.getId());
    if (coordinatorAgent && options.approvalCallback) {
      coordinatorAgent.toolExecutor.setApprovalCallback(options.approvalCallback);
    }

    // Start coordinator agent
    if (coordinatorAgent) {
      await coordinatorAgent.start();
    }

    return session;
  }

  private static detectDefaultProvider(): string {
    return process.env.ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai';
  }

  private static getDefaultModel(provider: string): string {
    return provider === 'anthropic' ? 'claude-3-haiku-20240307' : 'gpt-4';
  }

  private static generateSessionName(): string {
    return `Session ${new Date().toLocaleString()}`;
  }
}
