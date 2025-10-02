// ABOUTME: Session class for managing collections of agents and session-level operations
// ABOUTME: Handles session creation, agent spawning, and session metadata management

import { Agent, type AgentInfo } from '~/agents/agent';
import { ThreadId, asThreadId } from '~/threads/types';
import { ThreadManager } from '~/threads/thread-manager';
import { ProviderInstanceManager } from '~/providers/instance/manager';
import { ToolExecutor } from '~/tools/executor';
import { TaskManager, AgentCreationCallback } from '~/tasks/task-manager';
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
import { FileReadTool } from '~/tools/implementations/file_read';
import { FileWriteTool } from '~/tools/implementations/file_write';
import { Project } from '~/projects/project';
import { FileEditTool } from '~/tools/implementations/file_edit';
import { RipgrepSearchTool } from '~/tools/implementations/ripgrep_search';
import { FileFindTool } from '~/tools/implementations/file_find';
import { DelegateTool } from '~/tools/implementations/delegate';
import { UrlFetchTool } from '~/tools/implementations/url_fetch';
import { logger } from '~/utils/logger';
import { ApprovalDecision, type ToolPolicy, type PermissionOverrideMode } from '~/tools/types';
import { SessionConfiguration, ConfigurationValidator } from '~/sessions/session-config';
import { MCPServerManager } from '~/mcp/server-manager';
import type { MCPServerConnection, MCPServerConfig } from '~/config/mcp-types';
import { mkdirSync } from 'fs';
import { join } from 'path';
import type { TaskManagerEvent } from '~/utils/task-notifications';
import { routeTaskNotifications } from '~/utils/task-notifications';
import {
  WorkspaceManagerFactory,
  DEFAULT_WORKSPACE_MODE,
  type IWorkspaceManager,
  type WorkspaceMode,
} from '~/workspace/workspace-manager';
import type { WorkspaceInfo } from '~/workspace/workspace-container-manager';

export interface SessionInfo {
  id: ThreadId;
  name: string;
  description?: string;
  createdAt: Date;
  agents: AgentInfo[];
}

export class Session {
  private static _sessionRegistry = new Map<ThreadId, Session>();
  private static _reconstructionPromises = new Map<ThreadId, Promise<Session | null>>();

  private _sessionId: ThreadId;
  private _sessionData: SessionData;
  private _agents: Map<ThreadId, Agent> = new Map(); // All agents, including coordinator
  private _taskManager: TaskManager;
  private _threadManager: ThreadManager;
  private _mcpServerManager: MCPServerManager;
  private _projectId?: string;
  private _workspaceManager?: IWorkspaceManager;
  private _workspaceInfo?: WorkspaceInfo;
  private _workspaceInitPromise?: Promise<void>;
  private _permissionOverrideMode: PermissionOverrideMode = 'normal';

  // Task notification event handlers for proper cleanup
  private _onTaskUpdated?: (event: TaskManagerEvent) => Promise<void>;
  private _onTaskCreated?: (event: TaskManagerEvent) => Promise<void>;
  private _onTaskNoteAdded?: (event: TaskManagerEvent) => Promise<void>;
  private _taskUpdatedWrapper?: (event: TaskManagerEvent) => void;
  private _taskCreatedWrapper?: (event: TaskManagerEvent) => void;
  private _taskNoteAddedWrapper?: (event: TaskManagerEvent) => void;

  constructor(
    sessionId: ThreadId,
    sessionData: SessionData,
    threadManager: ThreadManager,
    taskManager?: TaskManager,
    workspaceManager?: IWorkspaceManager,
    workspaceInfo?: WorkspaceInfo
  ) {
    this._sessionId = sessionId;
    this._sessionData = sessionData;
    this._projectId = sessionData.projectId;

    this._threadManager = threadManager;

    // Use provided TaskManager or create a new one
    this._taskManager = taskManager || new TaskManager(this._sessionId, getPersistence());

    // Store workspace manager and info if provided
    this._workspaceManager = workspaceManager;
    this._workspaceInfo = workspaceInfo;

    // Create session-scoped MCP server manager
    this._mcpServerManager = new MCPServerManager();

    // Set up task notification routing
    this.setupTaskNotificationRouting();
  }

  static create(options: {
    name?: string;
    description?: string;
    projectId: string;
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

    // Note: ToolExecutor will be created after session is created

    // Get effective configuration by merging project and session configs
    const effectiveConfig = Session.getEffectiveConfiguration(
      options.projectId,
      options.configuration
    );

    // Get singleton workspace manager based on configuration
    const workspaceMode =
      (effectiveConfig.workspaceMode as WorkspaceMode) || DEFAULT_WORKSPACE_MODE;
    const workspaceManager = WorkspaceManagerFactory.get(workspaceMode);

    // Get project to access working directory
    const project = Project.getById(options.projectId);
    if (!project) {
      throw new Error(`Project ${options.projectId} not found`);
    }

    // Create TaskManager using global persistence
    // Note: We'll update this with agent creation callback after session is created
    const taskManager = new TaskManager(asThreadId(threadId), getPersistence());

    // Set session config on TaskManager immediately
    if (effectiveConfig.providerInstanceId && effectiveConfig.modelId) {
      taskManager.setSessionConfig({
        providerInstanceId: effectiveConfig.providerInstanceId,
        modelId: effectiveConfig.modelId,
      });
    }

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

    // Create session instance first, passing the TaskManager we already created
    const session = new Session(
      asThreadId(threadId),
      sessionData,
      threadManager,
      taskManager,
      workspaceManager
    );

    // Start workspace creation in background (don't await)
    session._workspaceInitPromise = session.initializeWorkspace(
      workspaceManager,
      project.getWorkingDirectory(),
      sessionData.id
    );

    // Create configured tool executor
    const toolExecutor = session.createConfiguredToolExecutor();

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

    // Add coordinator to session
    session._agents.set(asThreadId(threadId), sessionAgent);

    // Set up agent creation callback for task-based agent spawning
    session.setupAgentCreationCallback();

    // Agent owns approval flow - no callback setup needed

    // Register session in registry after creation is complete
    Session._sessionRegistry.set(asThreadId(sessionData.id), session);
    logger.debug(`Session registered in registry after creation: ${sessionData.id}`);

    return session;
  }

  /**
   * Synchronous session lookup from registry only (no database)
   * Used by ToolExecutor for temp directory creation during tool execution
   */
  static getByIdSync(sessionId: ThreadId): Session | null {
    const existingSession = Session._sessionRegistry.get(sessionId);
    if (existingSession) {
      return existingSession;
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
    if (existingSession) {
      return existingSession;
    }

    // Check if reconstruction is already in progress for this session
    const existingPromise = Session._reconstructionPromises.get(sessionId);
    if (existingPromise) {
      logger.debug(`Waiting for existing reconstruction of session ${sessionId}`);
      return await existingPromise;
    }

    // Start new reconstruction and cache the promise
    const reconstructionPromise = Session._performReconstruction(sessionId);
    Session._reconstructionPromises.set(sessionId, reconstructionPromise);

    try {
      const result = await reconstructionPromise;
      return result;
    } finally {
      // Always clean up the promise from cache when done
      Session._reconstructionPromises.delete(sessionId);
    }
  }

  /**
   * Internal method that performs the actual session reconstruction
   * Separated for better testing and cleaner deduplication logic
   */
  private static async _performReconstruction(sessionId: ThreadId): Promise<Session | null> {
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
    const existingThread = thread;

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

    logger.debug(`Creating session for ${sessionId}`);

    // Get singleton workspace manager for loaded session
    const workspaceMode =
      (sessionConfig.workspaceMode as 'container' | 'worktree' | 'local') || DEFAULT_WORKSPACE_MODE;
    const workspaceManager = WorkspaceManagerFactory.get(workspaceMode);

    // Create session instance, passing the TaskManager we already created
    const session = new Session(
      sessionId,
      sessionData,
      threadManager,
      taskManager,
      workspaceManager
    );

    // Initialize workspace in background for reconstructed session
    const project = Project.getById(sessionData.projectId);
    if (project && workspaceManager) {
      session._workspaceInitPromise = session.initializeWorkspaceForReconstruction(
        workspaceManager,
        project.getWorkingDirectory(),
        sessionId
      );
    } else {
      logger.warn('Project not found for loaded session, skipping workspace creation', {
        sessionId,
        projectId: sessionData.projectId,
      });
    }

    // Create and initialize coordinator agent
    let coordinatorAgent: Agent;
    try {
      // Each agent gets its own ToolExecutor (no sharing)
      const toolExecutor = session.createConfiguredToolExecutor();

      coordinatorAgent = await session.createAgent({
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

      // Verify agent was added successfully
      const verifyAgent = session.getCoordinatorAgent();
      if (!verifyAgent) {
        logger.error(
          `CRITICAL: Coordinator agent not found in registry after adding for ${sessionId}`
        );
      } else {
        logger.debug(`Coordinator agent successfully registered for ${sessionId}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      logger.error(`Failed to create coordinator agent for ${sessionId}:`, {
        error: errorMessage,
        stack: errorStack,
        providerInstanceId,
        modelId,
      });
      throw error; // Re-throw to fail reconstruction
    }

    // Register MCP tools for this specific agent's ToolExecutor
    coordinatorAgent.toolExecutor.registerMCPTools(session._mcpServerManager);

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

        // Each agent gets its own ToolExecutor (no sharing)
        const toolExecutor = session.createConfiguredToolExecutor();

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

    // Set session configuration for model resolution
    const sessionEffectiveConfig = session.getEffectiveConfiguration();
    if (sessionEffectiveConfig.providerInstanceId && sessionEffectiveConfig.modelId) {
      taskManager.setSessionConfig({
        providerInstanceId: sessionEffectiveConfig.providerInstanceId,
        modelId: sessionEffectiveConfig.modelId,
      });
    }

    // Set up agent creation callback for task-based agent spawning
    session.setupAgentCreationCallback();

    // Final verification before completing reconstruction
    const finalAgents = session.getAgents();
    const coordinatorExists = session.getCoordinatorAgent() !== null;

    logger.debug(`Session reconstruction complete for ${sessionId}`, {
      agentCount: finalAgents.length,
      hasCoordinator: coordinatorExists,
      agentIds: finalAgents.map((a) => a.threadId),
    });

    if (!coordinatorExists) {
      logger.error(
        `CRITICAL: Session reconstruction completed but coordinator agent is missing for ${sessionId}`
      );
    }

    // Restore permission override mode from configuration
    const overrideMode = (sessionConfig as Partial<SessionConfiguration>).runtimeOverrides
      ?.permissionMode as PermissionOverrideMode | undefined;
    if (overrideMode && overrideMode !== 'normal') {
      session.setPermissionOverrideMode(overrideMode);
      logger.debug(`Restored permission override mode for ${sessionId}`, { mode: overrideMode });
    }

    // Register session in registry ONLY after full reconstruction is complete
    Session._sessionRegistry.set(sessionId, session);
    logger.debug(`Session registered in registry after full reconstruction: ${sessionId}`);

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
    if (existingSession) {
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

  /**
   * Remove a session from the registry (for test cleanup)
   * @internal
   */
  static removeFromRegistry(sessionId: ThreadId): void {
    Session._sessionRegistry.delete(sessionId);
  }

  static updateSession(sessionId: string, updates: Partial<SessionData>): void {
    getPersistence().updateSession(sessionId, updates);

    // Update cached Session instance if it exists in registry
    const existingSession = Session._sessionRegistry.get(sessionId as ThreadId);
    if (existingSession) {
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

  getWorkspaceManager(): IWorkspaceManager | undefined {
    return this._workspaceManager;
  }

  getWorkspaceInfo(): WorkspaceInfo | undefined {
    return this._workspaceInfo;
  }

  /**
   * Initialize workspace in the background
   * Called after Session.create() to avoid blocking session creation
   */
  private async initializeWorkspace(
    workspaceManager: IWorkspaceManager,
    projectDir: string,
    sessionId: string
  ): Promise<void> {
    try {
      this._workspaceInfo = await workspaceManager.createWorkspace(projectDir, sessionId);
      this._workspaceManager = workspaceManager;

      logger.info('Workspace initialized for session', {
        sessionId,
        workspaceInfo: this._workspaceInfo,
      });
    } catch (error) {
      logger.error('Failed to initialize workspace', { sessionId, error });
      // Don't throw - session can still work without workspace
    }
  }

  /**
   * Initialize workspace for reconstructed session
   * Checks if workspace already exists before creating a new one
   */
  private async initializeWorkspaceForReconstruction(
    workspaceManager: IWorkspaceManager,
    projectDir: string,
    sessionId: string
  ): Promise<void> {
    try {
      // Check if workspace already exists (from previous session)
      let workspaceInfo = (await workspaceManager.inspectWorkspace(sessionId)) || undefined;

      if (!workspaceInfo) {
        // Create new workspace for this session
        workspaceInfo = await workspaceManager.createWorkspace(projectDir, sessionId);
        logger.info('Workspace recreated for loaded session', {
          sessionId,
          workspaceInfo,
        });
      } else {
        logger.info('Using existing workspace for loaded session', {
          sessionId,
          workspaceInfo,
        });
      }

      this._workspaceInfo = workspaceInfo;
      this._workspaceManager = workspaceManager;
    } catch (error) {
      logger.warn('Failed to recreate workspace for loaded session', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue without workspace - will fall back to local execution
    }
  }

  /**
   * Wait for workspace initialization to complete
   * Used by tools that need workspace access
   */
  async waitForWorkspace(): Promise<{ manager?: IWorkspaceManager; info?: WorkspaceInfo }> {
    if (this._workspaceInitPromise) {
      await this._workspaceInitPromise;
    }
    return {
      manager: this._workspaceManager,
      info: this._workspaceInfo,
    };
  }

  getWorkingDirectory(): string {
    // If we have a workspace with a clone, use the clone directory
    // This ensures MCP servers write to the same location as file tools
    const workspaceInfo = this.getWorkspaceInfo();
    if (workspaceInfo?.clonePath) {
      return workspaceInfo.clonePath;
    }

    // Fall back to configured or project directory
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

  getPermissionOverrideMode(): PermissionOverrideMode {
    return this._permissionOverrideMode;
  }

  setPermissionOverrideMode(mode: PermissionOverrideMode): void {
    this._permissionOverrideMode = mode;

    // Update all agents' tool executors
    for (const agent of this._agents.values()) {
      agent.toolExecutor.setPermissionOverrideMode(mode);
    }

    // Auto-resolve pending approvals based on new mode
    if (mode === 'yolo') {
      // In yolo mode, auto-approve all pending approvals
      for (const agent of this._agents.values()) {
        const pendingApprovals = agent.getPendingApprovals();
        for (const approval of pendingApprovals) {
          agent.handleApprovalResponse(approval.toolCallId, ApprovalDecision.ALLOW_ONCE);
          logger.info('Auto-approved pending tool call in yolo mode', {
            sessionId: this._sessionId,
            agentId: agent.threadId,
            toolCallId: approval.toolCallId,
          });
        }
      }
    } else if (mode === 'read-only') {
      // In read-only mode, check each pending approval
      for (const agent of this._agents.values()) {
        const pendingApprovals = agent.getPendingApprovals();
        for (const approval of pendingApprovals) {
          // Check if the tool is read-only safe
          const toolCall = approval.toolCall as { name?: string };
          const toolName = toolCall?.name || 'unknown';
          const tool = agent.toolExecutor.getTool(toolName);
          if (tool?.annotations?.readOnlySafe) {
            // Auto-approve read-only safe tools
            agent.handleApprovalResponse(approval.toolCallId, ApprovalDecision.ALLOW_ONCE);
            logger.info('Auto-approved read-only safe tool in read-only mode', {
              sessionId: this._sessionId,
              agentId: agent.threadId,
              toolCallId: approval.toolCallId,
              toolName,
            });
          } else {
            // Auto-deny non-read-only safe tools
            agent.handleApprovalResponse(approval.toolCallId, ApprovalDecision.DENY);
            logger.info('Auto-denied non-read-only tool in read-only mode', {
              sessionId: this._sessionId,
              agentId: agent.threadId,
              toolCallId: approval.toolCallId,
              toolName,
            });
          }
        }
      }
    }
    // In normal mode, leave pending approvals as-is

    // Persist to database
    const currentConfig = this._sessionData.configuration || {};
    const newConfig = {
      ...currentConfig,
      runtimeOverrides: {
        ...(currentConfig.runtimeOverrides as Record<string, unknown> | undefined),
        permissionMode: mode,
      },
    };
    Session.updateSession(this._sessionId, { configuration: newConfig });

    logger.info('Permission override mode updated', {
      sessionId: this._sessionId,
      mode,
    });
  }

  // Cached session data accessor (private)
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

    // If permission mode changed, update all agent tool executors
    if (validatedConfig.runtimeOverrides?.permissionMode) {
      this.setPermissionOverrideMode(validatedConfig.runtimeOverrides.permissionMode);
    }
  }

  getToolPolicy(toolName: string): ToolPolicy {
    const config = this.getEffectiveConfiguration();
    return config.toolPolicies?.[toolName] || 'ask';
  }

  getInfo(): SessionInfo | null {
    const agents = this.getAgents(); // Returns Agent[] now
    const sessionData = this.getSessionData();

    return {
      id: this._sessionId,
      name: sessionData?.name || 'Session ' + this._sessionId,
      description: sessionData?.description,
      createdAt: this.getCoordinatorAgent()?.getThreadCreatedAt() || new Date(),
      agents: agents.map((agent) => agent.getInfo()), // Transform to AgentInfo[] at API boundary
    };
  }

  spawnAgent(config: {
    threadId?: string;
    name?: string;
    providerInstanceId?: string;
    modelId?: string;
    persona?: string;
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
      persona: config.persona,
    });

    // Create configured tool executor for this agent
    const agentToolExecutor = this.createConfiguredToolExecutor();

    // Thread ID already generated above for agent naming

    // Create agent with metadata
    const agent = new Agent({
      toolExecutor: agentToolExecutor,
      threadManager: this._threadManager,
      threadId: targetThreadId,
      tools: agentToolExecutor.getAllTools(),
      persona: config.persona,
      metadata: {
        // Set metadata in constructor
        name: agentName,
        modelId: targetModelId,
        providerInstanceId: targetProviderInstanceId,
      },
    });

    // Inherit tool policies from main session so delegate can execute tools
    const mainSessionPolicies = this.getEffectiveConfiguration()?.toolPolicies || {};
    if (Object.keys(mainSessionPolicies).length > 0) {
      // Create delegate thread with inherited policies
      const delegateThread = this._threadManager.getThread(targetThreadId);
      if (delegateThread) {
        // Update thread metadata with inherited tool policies
        const updatedMetadata = {
          ...delegateThread.metadata,
          inheritedToolPolicies: mainSessionPolicies,
        };
        this._threadManager.updateThreadMetadata(targetThreadId, updatedMetadata);
      }
    }

    // No approval callback setup needed - Agent owns approval flow

    this._agents.set(agent.threadId, agent);

    // Emit agent:spawned event for EventStreamManager integration
    this._taskManager.emit('agent:spawned', {
      type: 'agent:spawned',
      agentThreadId: targetThreadId,
      providerInstanceId: targetProviderInstanceId,
      modelId: targetModelId,
      timestamp: new Date(),
      context: {
        sessionId: this._sessionId,
        projectId: this._projectId,
        spawnMethod: 'manual', // vs 'task-based'
      },
    });

    // Agent initialization will happen lazily when first used

    return agent;
  }

  getAgents(): Agent[] {
    const agents = [];

    // Add the coordinator agent first (if it exists)
    const coordinator = this.getCoordinatorAgent();
    if (coordinator) {
      agents.push(coordinator);
    }

    // Add all other agents
    Array.from(this._agents.entries()).forEach(([threadId, agent]) => {
      if (threadId !== this._sessionId) {
        agents.push(agent);
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

  getPendingApprovals(): Array<{
    toolCallId: string;
    toolCall: unknown;
    requestedAt: Date;
    threadId: string;
  }> {
    // Get all pending approvals for the entire session with a single database query
    const db = getPersistence();
    return db.getPendingApprovals(this._sessionId);
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

  /**
   * Create fully configured ToolExecutor for this session's agents
   */
  createConfiguredToolExecutor(): ToolExecutor {
    const toolExecutor = new ToolExecutor();
    Session.initializeTools(toolExecutor);

    // Add delegate tool
    const delegateTool = new DelegateTool();
    toolExecutor.registerTool('delegate', delegateTool);

    // Bind current Session to ToolExecutor for MCP policy lookups
    toolExecutor.setSession(this);

    // Kick off MCP tool discovery (non-blocking)
    toolExecutor.registerMCPTools(this._mcpServerManager);

    // Start MCP servers if not already started
    void this.initializeMCPServers();

    return toolExecutor;
  }

  /**
   * Set up the agent creation callback for task-based agent spawning
   */
  private setupAgentCreationCallback(): void {
    const agentCreationCallback: AgentCreationCallback = async (
      persona: string,
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
        persona: persona, // Pass the persona from the NewAgentSpec
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

      // Task notification will be sent automatically via TaskManager events

      return asThreadId(agent.threadId);
    };

    // Set the callback on the existing TaskManager
    this._taskManager.setAgentCreationCallback(agentCreationCallback);
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

  private mcpInitializationPromise?: Promise<void>;

  /**
   * Initialize MCP servers for this session
   */
  private async initializeMCPServers(): Promise<void> {
    if (!this.mcpInitializationPromise) {
      this.mcpInitializationPromise = this.doInitializeMCPServers();
    }
    return this.mcpInitializationPromise;
  }

  private async doInitializeMCPServers(): Promise<void> {
    try {
      const projectId = this.getProjectId();
      if (!projectId) {
        logger.warn(`Session ${this.getId()} has no project ID, skipping MCP initialization`);
        return;
      }

      const project = Project.getById(projectId);
      if (!project) {
        logger.warn(`Project ${this.getProjectId()} not found during MCP initialization`);
        return;
      }

      const mcpServers = project.getMCPServers();

      // Start all enabled servers for tool discovery
      const startPromises = Object.entries(mcpServers)
        .filter(([_, config]) => config.enabled)
        .map(([serverId, config]) =>
          this._mcpServerManager
            .startServer(serverId, {
              ...config,
              cwd: this.getWorkingDirectory(), // Always use session's working directory
            })
            .catch((error) => {
              // Continue with server disabled on failure (graceful degradation)
              logger.warn(`MCP server ${serverId} failed to start, continuing disabled:`, error);
            })
        );

      await Promise.allSettled(startPromises);
      logger.info(`Initialized MCP servers for session ${this.getId()}`);

      // Fire-and-forget refresh of MCP tools in any existing executors
      // Refresh MCP tools in existing executors (synchronous)
      this.refreshMCPToolsInExecutors();
    } catch (error) {
      logger.warn(`Failed to initialize MCP servers for session ${this.getId()}:`, error);
    }
  }

  /**
   * Refresh MCP tools in all ToolExecutors for this session
   */
  private refreshMCPToolsInExecutors(): void {
    // Update MCP tools in all agents' ToolExecutors
    // Only register for fully initialized agents to avoid timing issues
    for (const agent of this._agents.values()) {
      if (agent.isRunning) {
        // Only update initialized agents
        const toolExecutor = agent.toolExecutor;
        if (toolExecutor?.registerMCPTools) {
          // registerMCPTools is synchronous - just call it
          toolExecutor.registerMCPTools(this._mcpServerManager);
        }
      }
    }
  }

  /**
   * Handle MCP configuration changes from project (auto-restart changed servers)
   */
  private async handleMCPConfigChange(data: {
    serverId: string;
    action: 'created' | 'updated' | 'deleted';
    serverConfig?: MCPServerConfig;
  }): Promise<void> {
    const { serverId, action, serverConfig } = data;

    try {
      // Auto-restart only the specific server that changed
      switch (action) {
        case 'created':
        case 'updated':
          await this._mcpServerManager.stopServer(serverId);
          if (serverConfig?.enabled) {
            await this._mcpServerManager.startServer(serverId, {
              ...serverConfig,
              cwd: this.getWorkingDirectory(), // Always use session's working directory
            });
            logger.info(`Restarted MCP server ${serverId} with new configuration`);
          }
          // Refresh tools in all ToolExecutors
          this.refreshMCPToolsInExecutors();
          break;

        case 'deleted':
          await this._mcpServerManager.stopServer(serverId);
          logger.info(`Stopped and removed MCP server ${serverId}`);
          // Refresh tools in all ToolExecutors
          this.refreshMCPToolsInExecutors();
          break;
      }
    } catch (error) {
      logger.warn(`Failed to handle MCP config change for server ${serverId}:`, error);
    }
  }

  /**
   * Server control methods (delegate to MCPServerManager)
   */
  async startMCPServer(serverId: string): Promise<void> {
    const projectId = this.getProjectId();
    if (!projectId) {
      throw new Error(`Session ${this.getId()} has no project ID`);
    }

    const project = Project.getById(projectId);
    if (!project) {
      throw new Error(`Project ${this.getProjectId()} not found`);
    }

    const serverConfig = project.getMCPServers()[serverId];
    if (!serverConfig) {
      throw new Error(`MCP server '${serverId}' not found in project configuration`);
    }
    await this._mcpServerManager.startServer(serverId, {
      ...serverConfig,
      cwd: this.getWorkingDirectory(), // Always use session's working directory
    });
    this.refreshMCPToolsInExecutors();
  }

  async stopMCPServer(serverId: string): Promise<void> {
    await this._mcpServerManager.stopServer(serverId);
    this.refreshMCPToolsInExecutors();
  }

  async restartMCPServer(serverId: string): Promise<void> {
    await this.stopMCPServer(serverId);
    await this.startMCPServer(serverId);
    // Note: refreshMCPToolsInExecutors() called by startMCPServer()
  }

  getMCPServerStatus(serverId: string): MCPServerConnection | undefined {
    return this._mcpServerManager.getServer(serverId);
  }

  /**
   * Provide MCPServerManager access for ToolExecutor to query directly
   */
  getMCPServerManager(): MCPServerManager {
    return this._mcpServerManager;
  }

  /**
   * Wait for MCP server initialization to complete (for testing)
   */
  async waitForMCPInitialization(): Promise<void> {
    if (this.mcpInitializationPromise) {
      await this.mcpInitializationPromise;
    }
  }

  /**
   * Announce MCP configuration change to this session's thread
   */
  announceMCPConfigChange(
    serverId: string,
    action: 'created' | 'updated' | 'deleted',
    serverConfig?: MCPServerConfig
  ): void {
    this._threadManager.addEvent({
      type: 'MCP_CONFIG_CHANGED',
      data: { serverId, action, serverConfig },
      context: {
        sessionId: this.getId(),
        projectId: this.getProjectId(),
      },
      transient: true,
    });
  }

  /**
   * Get registry size - primarily for testing
   */
  static getRegistrySize(): number {
    return Session._sessionRegistry.size;
  }

  /**
   * Sets up task notification routing system to automatically notify agents about task changes.
   *
   * When agents create tasks and other agents work on them, this system ensures the creator
   * receives notifications about completion, status changes, and significant progress updates.
   *
   * Notifications are delivered via agent.sendMessage() and include:
   * - Task completion when status changes to 'completed'
   * - Status changes (pending → in_progress, * → blocked)
   * - Task assignments and reassignments
   * - All notes added by other agents
   */
  private setupTaskNotificationRouting(): void {
    // Store bound handlers for proper cleanup
    this._onTaskUpdated = async (event: TaskManagerEvent) => {
      try {
        await this.handleTaskUpdate(event);
      } catch (error) {
        logger.error('Failed to handle task update notification', {
          sessionId: this._sessionId,
          taskId: event.task.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    this._onTaskCreated = async (event: TaskManagerEvent) => {
      try {
        await this.handleTaskCreated(event);
      } catch (error) {
        logger.error('Failed to handle task creation notification', {
          sessionId: this._sessionId,
          taskId: event.task.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    this._onTaskNoteAdded = async (event: TaskManagerEvent) => {
      try {
        await this.handleTaskNoteAdded(event);
      } catch (error) {
        logger.error('Failed to handle task note notification', {
          sessionId: this._sessionId,
          taskId: event.task.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    // Create wrapper functions for proper cleanup
    this._taskUpdatedWrapper = (event: TaskManagerEvent) => {
      void this._onTaskUpdated!(event);
    };
    this._taskCreatedWrapper = (event: TaskManagerEvent) => {
      void this._onTaskCreated!(event);
    };
    this._taskNoteAddedWrapper = (event: TaskManagerEvent) => {
      void this._onTaskNoteAdded!(event);
    };

    // Register the handlers
    this._taskManager.on('task:updated', this._taskUpdatedWrapper);
    this._taskManager.on('task:created', this._taskCreatedWrapper);
    this._taskManager.on('task:note_added', this._taskNoteAddedWrapper);
  }

  /** Handles task update events and routes notifications to relevant agents */
  private async handleTaskUpdate(event: TaskManagerEvent): Promise<void> {
    await routeTaskNotifications(event, {
      getAgent: (id: ThreadId) => this._agents.get(id) || null,
      sessionId: this._sessionId,
    });
  }

  /** Handles task creation events and notifies assignees about new assignments */
  private async handleTaskCreated(event: TaskManagerEvent): Promise<void> {
    await routeTaskNotifications(event, {
      getAgent: (id: ThreadId) => this._agents.get(id) || null,
      sessionId: this._sessionId,
    });
  }

  /** Handles note addition events and notifies creators about all notes from other agents */
  private async handleTaskNoteAdded(event: TaskManagerEvent): Promise<void> {
    await routeTaskNotifications(event, {
      getAgent: (id: ThreadId) => this._agents.get(id) || null,
      sessionId: this._sessionId,
    });
  }

  /**
   * Cleanup method to remove task notification event listeners.
   *
   * This should be called when the session is being destroyed to prevent memory leaks
   * from accumulated event listeners. Only removes listeners added by this session.
   */
  cleanup(): void {
    if (this._taskUpdatedWrapper) {
      this._taskManager.removeListener('task:updated', this._taskUpdatedWrapper);
    }
    if (this._taskCreatedWrapper) {
      this._taskManager.removeListener('task:created', this._taskCreatedWrapper);
    }
    if (this._taskNoteAddedWrapper) {
      this._taskManager.removeListener('task:note_added', this._taskNoteAddedWrapper);
    }
  }
}
