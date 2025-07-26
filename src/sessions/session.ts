// ABOUTME: Session class for managing collections of agents and session-level operations
// ABOUTME: Handles session creation, agent spawning, and session metadata management

import { Agent } from '~/agents/agent';
import { ThreadId, asThreadId } from '~/threads/types';
import { ThreadManager } from '~/threads/thread-manager';
import { ProviderRegistry } from '~/providers/registry';
import { ToolExecutor } from '~/tools/executor';
import { TaskManager, AgentCreationCallback } from '~/tasks/task-manager';
import { Task } from '~/tasks/types';
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
import { getEnvVar } from '~/config/env-loader';

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

  static create(options: {
    name?: string;
    description?: string;
    provider?: string;
    model?: string;
    projectId: string; // REQUIRED: All sessions must be project-based
    approvalCallback?: ApprovalCallback;
    configuration?: Record<string, unknown>;
  }): Session {
    // Use existing logic for provider/model detection with intelligent defaults
    const provider = options.provider || Session.detectDefaultProvider();
    const model = options.model || Session.getDefaultModel(provider);
    const name = options.name || Session.generateSessionName();
    // Create provider
    const registry = ProviderRegistry.createWithAutoDiscovery();
    const providerInstance = registry.createProvider(provider, { model });

    // Create thread manager
    const threadManager = new ThreadManager();

    // Create session record in sessions table
    const sessionData = {
      id: threadManager.generateThreadId(),
      projectId: options.projectId,
      name,
      description: options.description || '',
      configuration: { provider, model, ...options.configuration },
      status: 'active' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    Session._saveSessionData(sessionData);

    // Create thread for this session
    const threadId = threadManager.createThread(sessionData.id, sessionData.id, options.projectId);

    // Create TaskManager using global persistence
    // Note: We'll update this with agent creation callback after session is created
    const taskManager = new TaskManager(asThreadId(threadId), getPersistence());

    // Create tool executor with TaskManager injection (without delegate tool initially)
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
      name: 'Lace', // Always name the coordinator agent "Lace"
      provider,
      model,
    });

    const session = new Session(sessionAgent, options.projectId);
    // Update the session's task manager to use the one we created
    session._taskManager = taskManager;

    // Set up agent creation callback for task-based agent spawning
    session.setupAgentCreationCallback();

    // Now register delegate tool with the updated TaskManager that has agent creation callback
    const delegateTool = new DelegateTool();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (delegateTool as any).getTaskManager = () => session._taskManager;
    toolExecutor.registerTool('delegate', delegateTool);

    // Set up coordinator agent with approval callback if provided
    const coordinatorAgent = session.getAgent(session.getId());
    if (coordinatorAgent && options.approvalCallback) {
      coordinatorAgent.toolExecutor.setApprovalCallback(options.approvalCallback);
    }

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

    // Get provider and model - prefer thread metadata over session config
    const sessionConfig = sessionData.configuration || {};
    const tempThreadManager = new ThreadManager();
    const existingThread = tempThreadManager.getThread(sessionId);

    // Determine provider (thread metadata > session config > default)
    const provider =
      (existingThread?.metadata?.provider as string) ||
      (sessionConfig.provider as string) ||
      'anthropic';

    // Determine model (thread metadata > session config > provider default)
    let model: string;
    if (existingThread?.metadata?.model) {
      model = existingThread.metadata.model;
    } else if (sessionConfig.model) {
      model = sessionConfig.model as string;
    } else {
      // Get provider default by creating temporary instance
      const registry = ProviderRegistry.createWithAutoDiscovery();
      const tempProvider = registry.createProvider(provider);
      model = tempProvider.defaultModel;
      tempProvider.cleanup();
    }

    // Create provider and tool executor
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

    const session = new Session(sessionAgent, sessionData.projectId);

    // Load delegate threads (child agents) for this session
    const delegateThreadIds = threadManager.listThreadIdsForSession(sessionId);
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

    // Set up agent creation callback for task-based agent spawning
    session.setupAgentCreationCallback();

    // Now register delegate tool with the updated TaskManager that has agent creation callback
    const delegateTool = new DelegateTool();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (delegateTool as any).getTaskManager = () => session._taskManager;
    toolExecutor.registerTool('delegate', delegateTool);

    logger.debug(`Session reconstruction complete for ${sessionId}`);
    return session;
  }

  // ===============================
  // Session management static methods
  // ===============================

  private static _saveSessionData(session: SessionData): void {
    getPersistence().saveSession(session);
    logger.info('Session created', { sessionId: session.id, projectId: session.projectId });
  }

  static getSession(sessionId: string): SessionData | null {
    logger.debug('Session.getSession() called', {
      sessionId: sessionId,
    });

    const sessionData = getPersistence().loadSession(sessionId);

    logger.debug('Session.getSession() - database lookup result', {
      sessionId: sessionId,
      hasSessionData: !!sessionData,
      sessionData: sessionData,
    });

    // If session not found, let's see what sessions DO exist
    if (!sessionData) {
      const allSessions =
        (getPersistence()
          .database?.prepare('SELECT id, name, project_id FROM sessions')
          .all() as Array<{ id: string; name: string; project_id: string }>) || [];
      logger.debug('Session.getSession() - session not found, showing all sessions', {
        requestedSessionId: sessionId,
        allSessionIds: allSessions.map((s) => s.id),
        allSessions: allSessions,
      });
    }

    return sessionData;
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
    const sessionData = this.getSessionData();

    return {
      id: this._sessionId,
      name: sessionData?.name || 'Session ' + this._sessionId,
      createdAt: this._sessionAgent.getThreadCreatedAt() || new Date(),
      provider: this._sessionAgent.providerName,
      model: (metadata?.model as string) || 'unknown',
      agents,
    };
  }

  spawnAgent(name: string, provider?: string, model?: string): Agent {
    const agentName = name.trim() || 'Lace';
    const targetProvider = provider || this._sessionAgent.providerName;
    const targetModel = model || this._sessionAgent.providerInstance.modelName;

    // Create new provider instance if configuration differs from session
    let providerInstance = this._sessionAgent.providerInstance;
    if (
      targetProvider !== this._sessionAgent.providerName ||
      targetModel !== this._sessionAgent.providerInstance.modelName
    ) {
      const registry = ProviderRegistry.createWithAutoDiscovery();
      providerInstance = registry.createProvider(targetProvider, { model: targetModel });
    }

    // Create delegate agent with the appropriate provider instance
    const agent = this._sessionAgent.createDelegateAgent(
      this._sessionAgent.toolExecutor,
      providerInstance
    );

    // Store the agent metadata
    agent.updateThreadMetadata({
      name: agentName, // Use processed name
      isAgent: true,
      parentSessionId: this._sessionId,
      provider: targetProvider,
      model: targetModel,
    });

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

  /**
   * Set up the agent creation callback for task-based agent spawning
   */
  private setupAgentCreationCallback(): void {
    const agentCreationCallback: AgentCreationCallback = async (
      provider: string,
      model: string,
      task
    ) => {
      // Create a more descriptive agent name based on the task
      const agentName = `task-${task.id.split('_').pop()}`;

      // Use the existing spawnAgent method to create the agent
      const agent = this.spawnAgent(agentName, provider, model);

      // Send initial task notification to the new agent
      await this.sendTaskNotification(agent, task);

      return asThreadId(agent.threadId);
    };

    // Set the callback on the existing TaskManager
    this._taskManager.setAgentCreationCallback(agentCreationCallback);
  }

  /**
   * Send task assignment notification to an agent
   */
  private async sendTaskNotification(agent: Agent, task: Task): Promise<void> {
    const taskMessage = this.formatTaskAssignment(task);
    await agent.sendMessage(taskMessage);
  }

  /**
   * Format task assignment notification message
   */
  private formatTaskAssignment(task: Task): string {
    return `[LACE TASK SYSTEM] You have been assigned a new task:
Title: "${task.title}"
Created by: ${task.createdBy}
Priority: ${task.priority}

--- TASK DETAILS ---
${task.prompt}
--- END TASK DETAILS ---`;
  }

  private static detectDefaultProvider(): string {
    return getEnvVar('ANTHROPIC_KEY') || getEnvVar('ANTHROPIC_API_KEY') ? 'anthropic' : 'openai';
  }

  private static getDefaultModel(provider: string): string {
    return provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4';
  }

  private static generateSessionName(): string {
    const date = new Date();
    const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    const day = date.getDate();
    return `${weekday}, ${month} ${day}`;
  }
}
