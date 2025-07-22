// ABOUTME: Session class for managing collections of agents and session-level operations
// ABOUTME: Handles session creation, agent spawning, and session metadata management

import { Agent } from '~/agents/agent';
import { ThreadId, asThreadId } from '~/threads/types';
import { ThreadManager } from '~/threads/thread-manager';
import { ProviderRegistry } from '~/providers/registry';
import { ToolExecutor } from '~/tools/executor';
import { TaskManager } from '~/tasks/task-manager';
import { getPersistence, SessionData } from '~/persistence/database';
import { createTaskManagerTools } from '~/tools/implementations/task-manager';
import { BashTool } from '~/tools/implementations/bash';
import { FileReadTool } from '~/tools/implementations/file-read';
import { FileWriteTool } from '~/tools/implementations/file-write';
import { Project } from '~/projects/project';
import { FileEditTool } from '~/tools/implementations/file-edit';
import { FileInsertTool } from '~/tools/implementations/file-insert';
import { FileListTool } from '~/tools/implementations/file-list';
import { RipgrepSearchTool } from '~/tools/implementations/ripgrep-search';
import { FileFindTool } from '~/tools/implementations/file-find';
import { DelegateTool } from '~/tools/implementations/delegate';
import { UrlFetchTool } from '~/tools/implementations/url-fetch';
import { logger } from '~/utils/logger';
import type { ApprovalCallback } from '~/tools/approval-types';
import { SessionConfiguration, ConfigurationValidator } from '~/sessions/session-config';

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
  private _taskManager: TaskManager;
  private _destroyed = false;
  private _projectId?: string;

  constructor(sessionAgent: Agent, projectId?: string) {
    this._sessionAgent = sessionAgent;
    this._sessionId = asThreadId(sessionAgent.threadId);
    this._projectId = projectId;

    // Initialize TaskManager for this session
    this._taskManager = new TaskManager(this._sessionId, getPersistence());
  }

  static create(
    name: string,
    provider = 'anthropic',
    model = 'claude-3-haiku-20240307',
    projectId: string // REQUIRED: All sessions must be project-based
  ): Session {
    // Create provider
    const registry = ProviderRegistry.createWithAutoDiscovery();
    const providerInstance = registry.createProvider(provider, { model });

    // Create thread manager
    const threadManager = new ThreadManager();

    // Create session record in sessions table
    const sessionData = {
      id: threadManager.generateThreadId(),
      projectId,
      name,
      description: '',
      configuration: { provider, model },
      status: 'active' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    Session.createSession(sessionData);

    // Create thread for this session
    const threadId = threadManager.createThread(sessionData.id, projectId);

    // Create TaskManager using global persistence
    const taskManager = new TaskManager(asThreadId(threadId), getPersistence());

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

    const session = new Session(sessionAgent, projectId);
    // Update the session's task manager to use the one we created
    session._taskManager = taskManager;

    return session;
  }

  static getAll(): SessionInfo[] {
    // NEW: Get sessions from sessions table
    const sessions = Session.getAllSessionData();
    return sessions.map((session) => ({
      id: asThreadId(session.id),
      name: session.name,
      createdAt: session.createdAt,
      provider: (session.configuration?.provider as string) || 'unknown',
      model: (session.configuration?.model as string) || 'unknown',
      agents: [], // Will be populated later if needed
    }));
  }

  static async getById(sessionId: ThreadId): Promise<Session | null> {
    logger.debug(`Session.getById called for sessionId: ${sessionId}`);

    // Get session from the sessions table
    const sessionData = Session.getSession(sessionId);
    if (!sessionData) {
      logger.warn(`Session not found in database: ${sessionId}`);
      return null;
    }

    // Get the thread (which should exist since we created it)
    const threadManager = new ThreadManager();
    const thread = threadManager.getThread(sessionId);

    if (!thread) {
      logger.warn(`Thread not found for session: ${sessionId}`);
      return null;
    }

    logger.debug(`Reconstructing session agent for ${sessionId}`);

    // Get provider and model from session configuration
    const sessionConfig = sessionData.configuration || {};
    const provider = (sessionConfig.provider as string) || 'anthropic';
    const model = (sessionConfig.model as string) || 'claude-3-haiku-20240307';

    // Create provider and tool executor (same as Agent.createSession)
    const registry = ProviderRegistry.createWithAutoDiscovery();
    const providerInstance = registry.createProvider(provider, { model });

    // Create TaskManager using global persistence
    const taskManager = new TaskManager(sessionId, getPersistence());

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

    const session = new Session(sessionAgent, sessionData.projectId);

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

  // ===============================
  // Session management static methods
  // ===============================

  static createSession(session: SessionData): void {
    getPersistence().saveSession(session);
    logger.info('Session created', { sessionId: session.id, projectId: session.projectId });
  }

  static getSession(sessionId: string): SessionData | null {
    return getPersistence().loadSession(sessionId);
  }

  static getSessionsByProject(projectId: string): SessionData[] {
    return getPersistence().loadSessionsByProject(projectId);
  }

  static getAllSessionData(): SessionData[] {
    // Get all sessions from the database
    const persistence = getPersistence();
    if (!persistence.database) return [];

    const stmt = persistence.database.prepare(`
      SELECT * FROM sessions ORDER BY updated_at DESC
    `);

    const rows = stmt.all() as Array<{
      id: string;
      project_id: string;
      name: string;
      description: string;
      configuration: string;
      status: string;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description,
      configuration: JSON.parse(row.configuration) as Record<string, unknown>,
      status: row.status as 'active' | 'archived' | 'completed',
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  }

  static updateSession(sessionId: string, updates: Partial<SessionData>): void {
    getPersistence().updateSession(sessionId, updates);
    logger.info('Session updated', { sessionId, updates });
  }

  static deleteSession(sessionId: string): void {
    // First delete all threads in this session
    const threadManager = new ThreadManager();
    const threads = threadManager.getThreadsBySession(sessionId);
    for (const thread of threads) {
      threadManager.deleteThread(thread.id);
    }

    // Then delete the session
    getPersistence().deleteSession(sessionId);
    logger.info('Session deleted', { sessionId });
  }

  // ===============================
  // Configuration management static methods
  // ===============================

  static validateConfiguration(config: Record<string, unknown>): SessionConfiguration {
    return ConfigurationValidator.validateSessionConfiguration(config);
  }

  static getEffectiveConfiguration(
    projectId: string,
    sessionConfig: Record<string, unknown> = {}
  ): SessionConfiguration {
    // Get project configuration
    const project = Project.getById(projectId);
    const projectConfig = project?.getConfiguration() || {};

    // Merge configurations with session overriding project
    return ConfigurationValidator.mergeConfigurations(
      projectConfig as SessionConfiguration,
      sessionConfig as Partial<SessionConfiguration>
    );
  }

  getId(): ThreadId {
    return this._sessionId;
  }

  getProjectId(): string | undefined {
    const sessionData = this.getSessionData();
    return sessionData?.projectId;
  }

  getWorkingDirectory(): string {
    const sessionData = this.getSessionData();
    if (sessionData?.configuration?.workingDirectory) {
      return sessionData.configuration.workingDirectory as string;
    }

    if (sessionData?.projectId) {
      const project = Project.getById(sessionData.projectId);
      if (project) {
        return project.getWorkingDirectory();
      }
    }

    return process.cwd();
  }

  private getSessionData() {
    return Session.getSession(this._sessionId);
  }

  // ===============================
  // Configuration instance methods
  // ===============================

  getEffectiveConfiguration(): SessionConfiguration {
    const sessionData = this.getSessionData();
    if (!sessionData) {
      return {};
    }

    const projectConfig = sessionData.projectId
      ? Project.getById(sessionData.projectId)?.getConfiguration() || {}
      : {};
    const sessionConfig = sessionData.configuration || {};

    // Merge configurations with session overriding project
    return ConfigurationValidator.mergeConfigurations(
      projectConfig as SessionConfiguration,
      sessionConfig as Partial<SessionConfiguration>
    );
  }

  updateConfiguration(updates: Partial<SessionConfiguration>): void {
    // Validate configuration
    const validatedConfig = Session.validateConfiguration(updates);

    const sessionData = this.getSessionData();
    const currentConfig = sessionData?.configuration || {};
    const newConfig = { ...currentConfig, ...validatedConfig };

    Session.updateSession(this._sessionId, { configuration: newConfig });
  }

  getToolPolicy(toolName: string): 'allow' | 'require-approval' | 'deny' {
    const config = this.getEffectiveConfiguration();
    return config.toolPolicies?.[toolName] || 'require-approval';
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

  spawnAgent(name: string, provider?: string, model?: string): Agent {
    // Create delegate agent using the session agent
    // This uses the same provider as the session agent
    const agent = this._sessionAgent.createDelegateAgent(this._sessionAgent.toolExecutor);

    // Store the agent metadata including provider and model
    agent.updateThreadMetadata({
      name,
      isAgent: true,
      parentSessionId: this._sessionId,
      provider: provider || this._sessionAgent.providerName,
      model: model || this._sessionAgent.providerInstance.modelName,
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
        provider: (metadata?.provider as string) || agent.providerName,
        model: (metadata?.model as string) || agent.providerInstance.modelName,
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

  static async createWithDefaults(options: {
    name?: string;
    provider?: string;
    model?: string;
    projectId: string; // REQUIRED: All sessions must be project-based
    approvalCallback?: ApprovalCallback;
  }): Promise<Session> {
    // Use existing logic for provider/model detection
    const provider = options.provider || Session.detectDefaultProvider();
    const model = options.model || Session.getDefaultModel(provider);
    const name = options.name || Session.generateSessionName();

    // Create session using existing create method
    const session = Session.create(name, provider, model, options.projectId);

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
