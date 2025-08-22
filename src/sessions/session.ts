// ABOUTME: Session class for managing collections of agents and session-level operations
// ABOUTME: Handles session creation, agent spawning, and session metadata management

import { Agent, type AgentInfo } from '~/agents/agent';
import { ThreadId, asThreadId } from '~/threads/types';
import { ThreadManager } from '~/threads/thread-manager';
import { ProviderInstanceManager } from '~/providers/instance/manager';
import { ToolExecutor } from '~/tools/executor';
import { TaskManager, AgentCreationCallback } from '~/tasks/task-manager';
import { Task } from '~/tasks/types';
import { getPersistence, SessionData } from '~/persistence/database';
import {
  TaskCreateTool,
  TaskListTool,
  TaskCompleteTool,
  TaskUpdateTool,
  TaskAddNoteTool,
  TaskViewTool,
} from '~/tools/implementations/task-manager';
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
import { mkdirSync } from 'fs';
import { join } from 'path';

export interface SessionInfo {
  id: ThreadId;
  name: string;
  description?: string;
  createdAt: Date;
  agents: AgentInfo[];
}

export class Session {
  private static _sessionRegistry = new Map<ThreadId, Session>();

  private _sessionId: ThreadId;
  private _sessionData: SessionData;
  private _agents: Map<ThreadId, Agent> = new Map(); // All agents, including coordinator
  private _taskManager: TaskManager;
  private _threadManager: ThreadManager;
  private _destroyed = false;
  private _projectId?: string;

  constructor(sessionId: ThreadId, sessionData: SessionData, threadManager: ThreadManager) {
    this._sessionId = sessionId;
    this._sessionData = sessionData;
    this._projectId = sessionData.projectId;

    this._threadManager = threadManager;

    // Initialize TaskManager for this session
    this._taskManager = new TaskManager(this._sessionId, getPersistence());

    // Register this session in the registry
    Session._sessionRegistry.set(this._sessionId, this);
  }

  static create(options: {
    name?: string;
    description?: string;
    projectId: string;
    approvalCallback?: ApprovalCallback;
    configuration?: Record<string, unknown>;
  }): Session {
    const name = options.name || Session.generateSessionName();

    // Create thread manager
    const threadManager = new ThreadManager();

    // Create session record in sessions table
    const sessionData = {
      id: threadManager.generateThreadId(),
      projectId: options.projectId,
      name,
      description: options.description || '',
      configuration: {
        ...options.configuration,
      },
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

    // Create tool executor
    const toolExecutor = new ToolExecutor();
    Session.initializeTools(toolExecutor);

    // Get effective configuration by merging project and session configs
    const effectiveConfig = Session.getEffectiveConfiguration(
      options.projectId,
      options.configuration
    );

    // Extract provider instance and model from effective configuration
    let providerInstanceId = effectiveConfig.providerInstanceId;
    const modelId = effectiveConfig.modelId;

    logger.debug('Session.create() provider configuration check', {
      sessionId: sessionData.id,
      providerInstanceId,
      modelId,
      effectiveConfig,
      needsDefaults: !providerInstanceId || !modelId,
    });

    // Provide reasonable defaults when no provider configuration is available
    if (!providerInstanceId || !modelId) {
      const instanceManager = new ProviderInstanceManager();

      // Load existing provider instances first (including any created by tests)
      const existingConfig = instanceManager.loadInstancesSync();
      const existingInstanceIds = Object.keys(existingConfig.instances);

      logger.debug('Checking for existing provider instances', {
        sessionId: sessionData.id,
        existingInstanceIds,
        existingConfig: existingConfig,
        configPath: instanceManager.constructor.name,
      });

      if (existingInstanceIds.length > 0) {
        // Use existing configured instances
        const defaultInstanceId = existingInstanceIds.includes('anthropic-default')
          ? 'anthropic-default'
          : existingInstanceIds[0];

        providerInstanceId = providerInstanceId || defaultInstanceId;

        // No hardcoded defaults - use what was explicitly configured
        if (!modelId) {
          throw new Error(
            `No model configured for provider instance ${providerInstanceId}. Please specify a model in the session or project configuration.`
          );
        }

        logger.debug('Using existing provider configuration for session', {
          sessionId: sessionData.id,
          providerInstanceId,
          modelId,
        });
      } else {
        // No existing instances, try to auto-create defaults from environment
        const defaultConfig = instanceManager.getDefaultConfig();
        const autoInstanceIds = Object.keys(defaultConfig.instances);

        if (autoInstanceIds.length > 0) {
          // Auto-created defaults are available
          const defaultInstanceId = autoInstanceIds.includes('anthropic-default')
            ? 'anthropic-default'
            : autoInstanceIds[0];

          providerInstanceId = providerInstanceId || defaultInstanceId;

          // No hardcoded defaults - use what was explicitly configured
          if (!modelId) {
            throw new Error(
              `No model configured for provider instance ${providerInstanceId}. Please specify a model in the session or project configuration.`
            );
          }

          logger.debug('Using auto-created default provider configuration for session', {
            sessionId: sessionData.id,
            providerInstanceId,
            modelId,
          });
        } else {
          throw new Error(
            'No provider instances configured and no environment variables found. Please set ANTHROPIC_KEY or OPENAI_API_KEY, or configure provider instances in Lace settings.'
          );
        }
      }
    }

    logger.info('🏗️ SESSION CREATE - Agent will create own provider', {
      sessionId: sessionData.id,
      providerInstanceId,
      modelId,
      projectId: options.projectId,
      effectiveConfig,
    });

    // Agent will auto-initialize token budget based on model

    // Create coordinator agent (not initialized yet - will be lazy initialized)
    const sessionAgent = Session.createAgentSync({
      sessionData,
      toolExecutor,
      threadManager,
      threadId,
      providerInstanceId,
      modelId,
      isCoordinator: true,
    });

    // Mark the agent's thread as a session thread
    sessionAgent.updateThreadMetadata({
      isSession: true,
    });

    // Create session instance and add coordinator
    const session = new Session(asThreadId(threadId), sessionData, threadManager);
    session._agents.set(asThreadId(threadId), sessionAgent);
    // Update the session's task manager to use the one we created
    session._taskManager = taskManager;

    // Set up agent creation callback for task-based agent spawning
    session.setupAgentCreationCallback();

    // Register delegate tool (TaskManager accessed via context)
    const delegateTool = new DelegateTool();
    toolExecutor.registerTool('delegate', delegateTool);

    // Set up coordinator agent with approval callback if provided
    const coordinatorAgent = session.getCoordinatorAgent();
    if (coordinatorAgent && options.approvalCallback) {
      coordinatorAgent.toolExecutor.setApprovalCallback(options.approvalCallback);
    }

    return session;
  }

  /**
   * Synchronous session lookup from registry only (no database)
   * Used by ToolExecutor for temp directory creation during tool execution
   */
  static getByIdSync(sessionId: ThreadId): Session | null {
    const existingSession = Session._sessionRegistry.get(sessionId);
    if (existingSession && !existingSession._destroyed) {
      return existingSession;
    }

    if (existingSession && existingSession._destroyed) {
      Session._sessionRegistry.delete(sessionId);
    }

    return null;
  }

  /**
   * Static method for backward compatibility with existing tests
   * Creates session temp directory using project temp directory as base
   */
  static getSessionTempDir(sessionId: string, projectId: string): string {
    const projectTempDir = Project.getProjectTempDir(projectId);
    const sessionTempPath = join(projectTempDir, `session-${sessionId}`);
    mkdirSync(sessionTempPath, { recursive: true });
    return sessionTempPath;
  }

  /**
   * Get a Session instance by ID, using registry cache when possible.
   *
   * This method implements a two-tier lookup strategy:
   * 1. Check in-memory session registry first (fastest)
   * 2. Fall back to database query if not in registry
   *
   * The returned Session object caches its SessionData internally,
   * eliminating the need for repeated database queries.
   *
   * @param sessionId - The unique session identifier
   * @returns Session instance or null if not found
   */
  static async getById(sessionId: ThreadId): Promise<Session | null> {
    // Check if session already exists in registry
    const existingSession = Session._sessionRegistry.get(sessionId);
    if (existingSession && !existingSession._destroyed) {
      return existingSession;
    }

    if (existingSession && existingSession._destroyed) {
      Session._sessionRegistry.delete(sessionId);
    }

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
    const tempThreadManager = new ThreadManager();
    const existingThread = tempThreadManager.getThread(sessionId);

    // Get provider instance ID and model ID from thread metadata or session config
    const providerInstanceId =
      (existingThread?.metadata?.providerInstanceId as string) ||
      (sessionConfig.providerInstanceId as string);

    const modelId =
      (existingThread?.metadata?.modelId as string) ||
      (existingThread?.metadata?.model as string) || // backwards compatibility
      (sessionConfig.modelId as string) ||
      (sessionConfig.model as string); // backwards compatibility

    logger.info('🔍 SESSION AGENT MODEL RESOLUTION', {
      sessionId,
      threadMetadataModelId: existingThread?.metadata?.modelId,
      threadMetadataModel: existingThread?.metadata?.model,
      sessionConfigModelId: sessionConfig.modelId,
      sessionConfigModel: sessionConfig.model,
      resolvedModelId: modelId,
      fullThreadMetadata: existingThread?.metadata,
    });

    if (!providerInstanceId || !modelId) {
      logger.error('Session missing provider configuration', {
        sessionId,
        hasProviderInstanceId: !!providerInstanceId,
        hasModelId: !!modelId,
        metadata: existingThread?.metadata,
        sessionConfig,
      });
      throw new Error(`Session ${sessionId} is missing provider configuration`);
    }

    logger.info('🔄 SESSION.GETBYID - Agent will create own provider', {
      sessionId,
      providerInstanceId,
      modelId,
      threadMetadata: existingThread?.metadata,
      sessionConfig,
    });

    // Create TaskManager using global persistence
    const taskManager = new TaskManager(sessionId, getPersistence());

    // Create tool executor
    const toolExecutor = new ToolExecutor();
    Session.initializeTools(toolExecutor);

    logger.debug(`Creating session for ${sessionId}`);

    // Create session instance
    const session = new Session(sessionId, sessionData, threadManager);

    // Create and initialize coordinator agent
    const coordinatorAgent = await session.createAgent({
      sessionData,
      toolExecutor,
      threadManager,
      threadId: sessionId,
      providerInstanceId,
      modelId,
      isCoordinator: true,
    });

    logger.debug(`Coordinator agent created and initialized for ${sessionId}`);

    // Add coordinator to agents map
    session._agents.set(sessionId, coordinatorAgent);

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

        // Get the delegate's provider configuration from its own thread metadata
        const delegateProviderInstanceId = delegateThread.metadata?.providerInstanceId as string;
        const delegateModelId =
          (delegateThread.metadata?.modelId as string) ||
          (delegateThread.metadata?.model as string);

        if (!delegateProviderInstanceId || !delegateModelId) {
          logger.error('Delegate agent missing provider configuration', {
            delegateThreadId,
            hasProviderInstanceId: !!delegateProviderInstanceId,
            hasModelId: !!delegateModelId,
            metadata: delegateThread.metadata,
          });
          // Skip this agent if it doesn't have proper configuration
          return;
        }

        logger.info('🔄 SESSION.GETBYID - Delegate will create own provider', {
          sessionId,
          delegateThreadId,
          delegateProviderInstanceId,
          delegateModelId,
          delegateMetadata: delegateThread.metadata,
        });

        // Create and initialize delegate agent
        const delegateAgent = await session.createAgent({
          sessionData,
          toolExecutor,
          threadManager,
          threadId: delegateThreadId,
          providerInstanceId: delegateProviderInstanceId,
          modelId: delegateModelId,
          isCoordinator: false,
        });

        logger.debug(
          `Delegate agent created and initialized, state: ${delegateAgent.getCurrentState()}`
        );

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

    // Register delegate tool (TaskManager accessed via context)
    const delegateTool = new DelegateTool();
    toolExecutor.registerTool('delegate', delegateTool);

    logger.debug(`Session reconstruction complete for ${sessionId}`);

    // Session is automatically registered in the registry via constructor
    return session;
  }

  // ===============================
  // Session management static methods
  // ===============================

  private static _saveSessionData(session: SessionData): void {
    getPersistence().saveSession(session);
    logger.info('Session created', { sessionId: session.id, projectId: session.projectId });
  }

  /**
   * Get SessionData for a session, checking registry before database.
   *
   * This method is optimized to avoid database queries when the session
   * is already loaded in memory. Use this instead of direct database
   * queries for better performance.
   *
   * @param sessionId - The unique session identifier
   * @returns SessionData or null if not found
   */
  static getSession(sessionId: string): SessionData | null {
    // 👈 NEW: Check registry first to avoid database query for active sessions
    const existingSession = Session._sessionRegistry.get(sessionId as ThreadId);
    if (existingSession && !existingSession._destroyed) {
      // Return cached SessionData from the existing session
      return existingSession._sessionData;
    }

    // Fall back to database query for sessions not in memory
    const sessionData = getPersistence().loadSession(sessionId);

    // Log warning for missing sessions (avoid expensive debug queries)
    if (!sessionData) {
      logger.warn('Session not found in database', { sessionId });
    }

    return sessionData;
  }

  static getSessionsByProject(projectId: string): SessionData[] {
    return getPersistence().loadSessionsByProject(projectId);
  }

  static updateSession(sessionId: string, updates: Partial<SessionData>): void {
    getPersistence().updateSession(sessionId, updates);

    // Update cached Session instance if it exists in registry
    const existingSession = Session._sessionRegistry.get(sessionId as ThreadId);
    if (existingSession && !existingSession._destroyed) {
      // Reload the fresh data from database into the cached instance
      const freshData = getPersistence().loadSession(sessionId);
      if (freshData) {
        existingSession._sessionData = freshData;
      }
    }

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

  // Made public for testing - should be private in production
  // Replace the existing getSessionData method with this:
  private getSessionData(): SessionData {
    return this._sessionData; // 👈 NEW: Return cached data instead of database query
  }

  /**
   * Force refresh of cached SessionData from database.
   *
   * Use this method when you know the session data has been modified
   * externally and you need to update the cache. Normal operations
   * that modify data through this Session instance will automatically
   * update the cache.
   */
  refreshFromDatabase(): void {
    // Force database query, bypassing the registry cache
    const freshData = getPersistence().loadSession(this._sessionId);
    if (!freshData) {
      throw new Error(`Session not found: ${this._sessionId}`);
    }
    this._sessionData = freshData;
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

    logger.debug('getEffectiveConfiguration', {
      sessionId: this._sessionId,
      projectConfig,
      sessionConfig,
      sessionData,
    });

    // Merge configurations with session overriding project
    const merged = ConfigurationValidator.mergeConfigurations(
      projectConfig as SessionConfiguration,
      sessionConfig as Partial<SessionConfiguration>
    );

    logger.debug('Merged configuration', {
      sessionId: this._sessionId,
      merged,
    });

    return merged;
  }

  updateConfiguration(updates: Partial<SessionConfiguration>): void {
    // Validate configuration
    const validatedConfig = Session.validateConfiguration(updates);

    const currentConfig = this._sessionData.configuration || {};
    const newConfig = { ...currentConfig, ...validatedConfig };

    // Update database and cache
    Session.updateSession(this._sessionId, { configuration: newConfig });
  }

  getToolPolicy(toolName: string): 'allow' | 'require-approval' | 'deny' {
    const config = this.getEffectiveConfiguration();
    return config.toolPolicies?.[toolName] || 'require-approval';
  }

  getInfo(): SessionInfo | null {
    const agents = this.getAgents();
    const sessionData = this.getSessionData();

    return {
      id: this._sessionId,
      name: sessionData?.name || 'Session ' + this._sessionId,
      description: sessionData?.description,
      createdAt: this.getCoordinatorAgent()?.getThreadCreatedAt() || new Date(),
      agents,
    };
  }

  spawnAgent(config: {
    threadId?: string;
    name?: string;
    providerInstanceId?: string;
    modelId?: string;
  }): Agent {
    // Generate thread ID first to create proper agent name
    const targetThreadId =
      config.threadId || this._threadManager.createDelegateThreadFor(this._sessionId).id;

    // Generate agent name - use provided name or thread-based name for delegates (not 'Lace')
    const agentName = config.name?.trim() || `Agent-${targetThreadId.split('.').pop()}`;

    // If no provider instance specified, inherit from session
    let targetProviderInstanceId = config.providerInstanceId;
    let targetModelId = config.modelId;

    if (!targetProviderInstanceId || !targetModelId) {
      // Get effective configuration (merges project and session configs)
      const effectiveConfig = this.getEffectiveConfiguration();

      targetProviderInstanceId =
        targetProviderInstanceId || (effectiveConfig.providerInstanceId as string);
      targetModelId = targetModelId || (effectiveConfig.modelId as string);

      if (!targetProviderInstanceId || !targetModelId) {
        throw new Error(
          'No provider instance configuration available - specify providerInstanceId and modelId or ensure session has provider instance configuration'
        );
      }
    }

    logger.info('🚀 SPAWN AGENT - Agent will create own provider', {
      sessionId: this._sessionId,
      agentName,
      targetProviderInstanceId,
      targetModelId,
      configProviderInstanceId: config.providerInstanceId,
      configModelId: config.modelId,
      effectiveProviderInstanceId: targetProviderInstanceId,
      effectiveModelId: targetModelId,
    });

    // Create new toolExecutor for this agent
    const agentToolExecutor = new ToolExecutor();
    Session.initializeTools(agentToolExecutor);

    // Register delegate tool (TaskManager accessed via context)
    const delegateTool = new DelegateTool();
    agentToolExecutor.registerTool('delegate', delegateTool);

    // Thread ID already generated above for agent naming

    // Create agent with metadata
    const agent = new Agent({
      toolExecutor: agentToolExecutor,
      threadManager: this._threadManager,
      threadId: targetThreadId,
      tools: agentToolExecutor.getAllTools(),
      metadata: {
        // Set metadata in constructor
        name: agentName,
        modelId: targetModelId,
        providerInstanceId: targetProviderInstanceId,
      },
    });

    // Set up approval callback for spawned agent (inherit from coordinator)
    const coordinatorAgent = this.getCoordinatorAgent();
    const coordinatorApprovalCallback = coordinatorAgent?.toolExecutor.getApprovalCallback();
    if (coordinatorApprovalCallback) {
      agent.toolExecutor.setApprovalCallback(coordinatorApprovalCallback);
    }

    this._agents.set(agent.threadId, agent);
    return agent;
  }

  getAgents(): AgentInfo[] {
    const agents = [];

    // Add the coordinator agent first (if it exists)
    const coordinator = this.getCoordinatorAgent();
    if (coordinator) {
      agents.push(coordinator.getInfo());
    }

    // Add all other agents
    Array.from(this._agents.entries()).forEach(([threadId, agent]) => {
      if (threadId !== this._sessionId) {
        agents.push(agent.getInfo());
      }
    });

    return agents;
  }

  // Get coordinator agent (agent with session ID as thread ID)
  getCoordinatorAgent(): Agent | null {
    return this._agents.get(this._sessionId) || null;
  }

  getAgent(threadId: ThreadId): Agent | null {
    return this._agents.get(threadId) || null;
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

  private static initializeTools(toolExecutor: ToolExecutor): void {
    // Register all tools - TaskManager is now provided via context
    const tools = [
      new BashTool(),
      new FileReadTool(),
      new FileWriteTool(),
      new FileEditTool(),
      new FileInsertTool(),
      new FileListTool(),
      new RipgrepSearchTool(),
      new FileFindTool(),
      new UrlFetchTool(),
      // Task tools no longer need injection
      new TaskCreateTool(),
      new TaskListTool(),
      new TaskCompleteTool(),
      new TaskUpdateTool(),
      new TaskAddNoteTool(),
      new TaskViewTool(),
    ];

    toolExecutor.registerTools(tools);
  }

  destroy(): void {
    if (this._destroyed) {
      return;
    }

    this._destroyed = true;

    // Remove from registry
    Session._sessionRegistry.delete(this._sessionId);

    // Stop and cleanup all agents (including coordinator) immediately
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
      // The 'provider' parameter should now be a provider instance ID (e.g., 'pi_abc123')
      // Note: Agent will validate and create provider during initialization

      // Create a more descriptive agent name based on the task
      const agentName = `task-${task.id.split('_').pop()}`;

      // Spawn agent with the specified provider instance and model
      const agent = this.spawnAgent({
        name: agentName,
        providerInstanceId: provider, // Use the provider instance ID directly
        modelId: model, // Pass the model from the task assignment
      });

      // Start the agent to ensure token budget is initialized
      await agent.start();

      // Add error handler to prevent unhandled errors
      agent.on('error', (error) => {
        logger.error('Spawned agent error', {
          threadId: agent.threadId,
          task: task.id,
          error: error.error || error,
        });
      });

      // Send initial task notification to the new agent
      try {
        await this.sendTaskNotification(agent, task);
      } catch (error) {
        logger.error('Failed to send task notification to spawned agent', {
          threadId: agent.threadId,
          task: task.id,
          error: error instanceof Error ? error.message : String(error),
        });
        // Don't fail task creation if agent fails - the task is still created
      }

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
    return `[LACE TASK SYSTEM] You have been assigned task '${task.id}':
Title: "${task.title}"
Created by: ${task.createdBy}
Priority: ${task.priority}

--- TASK DETAILS ---
${task.prompt}
--- END TASK DETAILS ---

Use your task_add_note tool to record important notes as you work and your task_complete tool when you are done.`;
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

  /**
   * Clear the session registry - primarily for testing
   */

  static clearRegistry(): void {
    Session._sessionRegistry.clear();
  }

  static clearProviderCache(): void {
    // No-op: Provider caching removed in agent-owned provider architecture
    // Kept for backward compatibility during test migration
  }

  /**
   * Get temporary directory for this session
   * Creates: /tmp/lace-runtime-{pid}-{timestamp}/project-{projectId}/session-{sessionId}/
   */
  getSessionTempDir(): string {
    if (!this._projectId) {
      throw new Error('Session must have a projectId to create temp directories');
    }
    const projectTempDir = Project.getProjectTempDir(this._projectId);
    const sessionTempPath = join(projectTempDir, `session-${this._sessionId}`);
    mkdirSync(sessionTempPath, { recursive: true });
    return sessionTempPath;
  }

  /**
   * Create an agent with consistent configuration (synchronous, lazy initialization)
   */
  private static createAgentSync(params: {
    sessionData: SessionData;
    toolExecutor: ToolExecutor;
    threadManager: ThreadManager;
    threadId: string;
    providerInstanceId: string;
    modelId: string;
    isCoordinator?: boolean;
  }): Agent {
    const {
      toolExecutor,
      threadManager,
      threadId,
      providerInstanceId,
      modelId,
      isCoordinator = false,
    } = params;

    // Use appropriate name - always "Lace" for coordinator, or thread-based name for delegates
    const agentName = isCoordinator ? 'Lace' : `Agent-${threadId.split('.').pop()}`;

    return new Agent({
      toolExecutor,
      threadManager,
      threadId,
      tools: toolExecutor.getAllTools(),
      metadata: {
        name: agentName,
        providerInstanceId,
        modelId,
      },
    });
  }

  /**
   * Create and initialize an agent with consistent configuration (async version for getById)
   */
  private async createAgent(params: {
    sessionData: SessionData;
    toolExecutor: ToolExecutor;
    threadManager: ThreadManager;
    threadId: string;
    providerInstanceId: string;
    modelId: string;
    isCoordinator?: boolean;
  }): Promise<Agent> {
    const agent = Session.createAgentSync(params);
    // Initialize the agent (loads prompts, records events)
    await agent.initialize();
    return agent;
  }

  /**
   * Get registry size - primarily for testing
   */
  static getRegistrySize(): number {
    return Session._sessionRegistry.size;
  }
}
