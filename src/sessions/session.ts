// ABOUTME: Session class for managing collections of agents and session-level operations
// ABOUTME: Handles session creation, agent spawning, and session metadata management

import { Agent, type AgentInfo } from '~/agents/agent';
import type { AIProvider, ProviderConfig } from '~/providers/base-provider';
import { ThreadId, asThreadId } from '~/threads/types';
import { ThreadManager } from '~/threads/thread-manager';
import { ProviderRegistry } from '~/providers/registry';
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
import { getLaceDir } from '~/config/lace-dir';
import * as fs from 'fs';
import * as path from 'path';

export interface SessionInfo {
  id: ThreadId;
  name: string;
  createdAt: Date;
  agents: AgentInfo[];
}

export class Session {
  private static _sessionRegistry = new Map<ThreadId, Session>();

  private _sessionAgent: Agent;
  private _sessionId: ThreadId;
  private _agents: Map<ThreadId, Agent> = new Map();
  private _taskManager: TaskManager;
  private _destroyed = false;
  private _projectId?: string;
  private _providerCache?: unknown; // Cached provider instance

  constructor(sessionAgent: Agent, projectId?: string) {
    this._sessionAgent = sessionAgent;
    this._sessionId = asThreadId(sessionAgent.threadId);
    this._projectId = projectId;

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

    // Resolve provider instance for the session agent
    const providerInstance = Session.resolveProviderInstance(providerInstanceId, modelId);

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
      providerInstanceId: providerInstanceId,
      modelId: modelId,
    });

    const session = new Session(sessionAgent, options.projectId);
    // Update the session's task manager to use the one we created
    session._taskManager = taskManager;

    // Set up agent creation callback for task-based agent spawning
    session.setupAgentCreationCallback();

    // Register delegate tool (TaskManager accessed via context)
    const delegateTool = new DelegateTool();
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
      agents: [], // Will be populated later if needed
    }));
  }

  static async getById(sessionId: ThreadId): Promise<Session | null> {
    logger.debug(`Session.getById called for sessionId: ${sessionId}`);

    // Check if session already exists in registry
    const existingSession = Session._sessionRegistry.get(sessionId);
    if (existingSession && !existingSession._destroyed) {
      logger.debug(`Session.getById: Found existing session in registry for ${sessionId}`);
      return existingSession;
    }

    if (existingSession && existingSession._destroyed) {
      logger.debug(`Session.getById: Removing destroyed session from registry for ${sessionId}`);
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
      const registry = ProviderRegistry.getInstance();
      const tempProvider = registry.createProvider(provider);
      model = tempProvider.defaultModel;
      tempProvider.cleanup();
    }

    // Create provider and tool executor
    const registry = ProviderRegistry.getInstance();
    const providerInstance = registry.createProvider(provider, { model });

    // Create TaskManager using global persistence
    const taskManager = new TaskManager(sessionId, getPersistence());

    // Create tool executor
    const toolExecutor = new ToolExecutor();
    Session.initializeTools(toolExecutor);

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

    // If session not found, let's see what sessions DO exist (only if database is still available)
    if (!sessionData) {
      try {
        const persistence = getPersistence();
        // Only query if database is available and not closed
        if (persistence.database && !persistence['_closed'] && !persistence['_disabled']) {
          const allSessions = persistence.database
            .prepare('SELECT id, name, project_id FROM sessions')
            .all() as Array<{ id: string; name: string; project_id: string }>;
          logger.debug('Session.getSession() - session not found, showing all sessions', {
            requestedSessionId: sessionId,
            allSessionIds: allSessions.map((s) => s.id),
            allSessions: allSessions,
          });
        } else {
          logger.debug(
            'Session.getSession() - session not found, database unavailable for debugging',
            {
              requestedSessionId: sessionId,
            }
          );
        }
      } catch (error) {
        logger.debug(
          'Session.getSession() - session not found, error querying sessions for debug',
          {
            requestedSessionId: sessionId,
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }
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

  // Made public for testing - should be private in production
  public getSessionData() {
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
    const sessionData = this.getSessionData();

    return {
      id: this._sessionId,
      name: sessionData?.name || 'Session ' + this._sessionId,
      createdAt: this._sessionAgent.getThreadCreatedAt() || new Date(),
      agents,
    };
  }

  spawnAgent(config: { name?: string; providerInstanceId?: string; modelId?: string }): Agent {
    const agentName = config.name?.trim() || 'Lace';

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

    // Resolve provider instance lazily
    const providerInstance = Session.resolveProviderInstance(
      targetProviderInstanceId,
      targetModelId
    );

    // Create new toolExecutor for this agent
    const agentToolExecutor = new ToolExecutor();
    Session.initializeTools(agentToolExecutor);

    // Register delegate tool (TaskManager accessed via context)
    const delegateTool = new DelegateTool();
    agentToolExecutor.registerTool('delegate', delegateTool);

    // Create delegate agent with the appropriate provider instance and its own toolExecutor
    const agent = this._sessionAgent.createDelegateAgent(agentToolExecutor, providerInstance);

    // Store the agent metadata
    agent.updateThreadMetadata({
      name: agentName, // Use processed name
      isAgent: true,
      parentSessionId: this._sessionId,
      providerInstanceId: targetProviderInstanceId,
      modelId: targetModelId,
    });

    // Set up approval callback for spawned agent (inherit from session agent)
    const sessionApprovalCallback = this._sessionAgent.toolExecutor.getApprovalCallback();
    if (sessionApprovalCallback) {
      agent.toolExecutor.setApprovalCallback(sessionApprovalCallback);
    }

    this._agents.set(agent.threadId, agent);
    return agent;
  }

  getAgents(): AgentInfo[] {
    const agents = [];

    // Add the coordinator agent first
    agents.push(this._sessionAgent.getInfo());

    // Add delegate agents
    Array.from(this._agents.values()).forEach((agent) => {
      agents.push(agent.getInfo());
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

      // Use the new spawnAgent method - convert old provider/model strings to provider instance
      // TODO: Update TaskManager to use provider instances directly
      const agent = this.spawnAgent({
        name: agentName,
        // For now, inherit from session since task system doesn't have provider instances yet
      });

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
  /**
   * Resolve provider instance configuration to actual provider instance (with caching)
   */
  private static _providerCache = new Map<string, AIProvider>();

  static resolveProviderInstance(providerInstanceId: string, modelId: string): AIProvider {
    const cacheKey = `${providerInstanceId}:${modelId}`;

    // Check cache first
    const cached = Session._providerCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Use new provider instance system with synchronous credential loading
    try {
      const instanceManager = new ProviderInstanceManager();
      const config = instanceManager.loadInstancesSync();
      const instance = config.instances[providerInstanceId];

      if (!instance) {
        throw new Error(`Provider instance not found: ${providerInstanceId}`);
      }

      // Load credentials synchronously by reading the credential file directly
      interface ProviderCredentials {
        apiKey: string;
        additionalAuth?: Record<string, unknown>;
      }

      const credentialsDir = path.join(getLaceDir(), 'credentials');
      const credentialPath = path.join(credentialsDir, `${providerInstanceId}.json`);
      let credentials: ProviderCredentials;

      try {
        const credentialContent = fs.readFileSync(credentialPath, 'utf-8');
        const parsedCredentials = JSON.parse(credentialContent) as unknown;

        // Type guard to ensure we have valid credentials
        if (
          !parsedCredentials ||
          typeof parsedCredentials !== 'object' ||
          !('apiKey' in parsedCredentials) ||
          typeof parsedCredentials.apiKey !== 'string'
        ) {
          throw new Error('Invalid credential format');
        }

        credentials = parsedCredentials as ProviderCredentials;
      } catch (_credentialError) {
        throw new Error(`No credentials found for instance: ${providerInstanceId}`);
      }

      // Map catalog provider ID to actual provider type
      const providerType = instance.catalogProviderId; // anthropic, openai, etc.

      // Build provider config from instance and credentials
      const providerConfig: ProviderConfig = {
        model: modelId,
        apiKey: credentials.apiKey,
        ...(credentials.additionalAuth || {}),
        ...(instance.endpoint && { baseURL: instance.endpoint }),
        ...(instance.timeout && { timeout: instance.timeout }),
      };

      // Create provider using the new registry system
      const providerRegistry = ProviderRegistry.getInstance();
      const providerInstance = providerRegistry.createProvider(providerType, providerConfig);

      // Cache the result
      Session._providerCache.set(cacheKey, providerInstance);

      return providerInstance;
    } catch (error) {
      throw new Error(
        `Failed to resolve provider instance ${providerInstanceId} with model ${modelId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  static clearRegistry(): void {
    Session._sessionRegistry.clear();
  }

  static clearProviderCache(): void {
    Session._providerCache.clear();
  }

  /**
   * Get registry size - primarily for testing
   */
  static getRegistrySize(): number {
    return Session._sessionRegistry.size;
  }
}
