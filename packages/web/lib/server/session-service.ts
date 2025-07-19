// ABOUTME: Server-side session management service
// ABOUTME: Provides high-level API for managing sessions and agents using the Session class

import { Agent, Session } from '@/lib/server/lace-imports';
import type { ThreadId, ApprovalDecision as CoreApprovalDecision } from '@/lib/server/lace-imports';
import { asThreadId } from '@/lib/server/lace-imports';
import {
  Session as SessionType,
  Agent as AgentType,
  SessionEvent,
  ApprovalDecision,
} from '@/types/api';
import { SSEManager } from '@/lib/sse-manager';
import { getApprovalManager } from '@/lib/server/approval-manager';

// Active session instances
const activeSessions = new Map<ThreadId, Session>();

export class SessionService {
  constructor() {
    // No need for direct ThreadManager access - use Agent methods instead
  }

  async createSession(
    name: string,
    provider: string,
    model: string,
    projectId: string
  ): Promise<SessionType> {
    // Create project-based session
    const { Project } = await import('@/lib/server/lace-imports');
    const project = Project.getById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    // Create session using Session.createWithDefaults which handles both database and thread creation
    const session = await Session.createWithDefaults({
      name,
      provider,
      model,
      projectId,
    });

    const sessionId = session.getId();

    // Set up approval callback and event handlers for the coordinator agent
    const coordinatorAgent = session.getAgent(sessionId);
    if (coordinatorAgent) {
      // Set up approval callback for the coordinator agent using utility
      const { setupAgentApprovals } = await import('./agent-utils');
      setupAgentApprovals(coordinatorAgent, sessionId);
      // Set up web-specific event handlers
      this.setupAgentEventHandlers(coordinatorAgent, sessionId);
    } else {
      console.warn('No coordinator agent found for session:', sessionId);
      // In test environments, this might be expected behavior
    }

    // Store the session instance
    activeSessions.set(sessionId, session);

    // Return metadata for API response
    return this.sessionToMetadata(session);
  }

  async listSessions(): Promise<SessionType[]> {
    const sessionInfos = Session.getAll();

    // Create a map of persisted sessions
    const persistedSessions = new Map<string, SessionType>();

    for (const sessionInfo of sessionInfos) {
      let session = activeSessions.get(sessionInfo.id);

      if (!session) {
        // Reconstruct session from database
        console.warn(`[DEBUG] Reconstructing session from database: ${sessionInfo.id}`);
        session = (await Session.getById(sessionInfo.id)) ?? undefined;
        if (session) {
          console.warn(`[DEBUG] Session reconstructed successfully: ${sessionInfo.id}`);
          activeSessions.set(sessionInfo.id, session);

          // Set up event handlers for all agents in the reconstructed session
          const agents = session.getAgents();
          console.warn(`[DEBUG] Setting up event handlers for ${agents.length} agents`);
          for (const agentInfo of agents) {
            const agent = session.getAgent(agentInfo.threadId);
            if (agent) {
              console.warn(`[DEBUG] Setting up event handlers for agent: ${agentInfo.threadId}`);
              this.setupAgentEventHandlers(agent, sessionInfo.id);
            }
          }
        } else {
          console.warn(`[DEBUG] Failed to reconstruct session: ${sessionInfo.id}`);
        }
      }

      if (session) {
        persistedSessions.set(sessionInfo.id, this.sessionToMetadata(session));
      }
    }

    // Add any active sessions that aren't in the persisted list
    activeSessions.forEach((session, sessionId) => {
      if (!persistedSessions.has(sessionId)) {
        try {
          persistedSessions.set(sessionId, this.sessionToMetadata(session));
        } catch (error) {
          console.error(`Failed to get metadata for session ${sessionId}:`, error);
        }
      }
    });

    return Array.from(persistedSessions.values());
  }

  async getSession(sessionId: ThreadId): Promise<Session | null> {
    console.warn(`[DEBUG] getSession called for sessionId: ${sessionId}`);

    // Try to get from active sessions first
    let session = activeSessions.get(sessionId);
    console.warn(`[DEBUG] Session found in active sessions: ${session ? 'yes' : 'no'}`);

    if (!session) {
      // Try to load from database by reconstructing the session
      console.warn(`[DEBUG] Reconstructing session from database: ${sessionId}`);
      session = (await Session.getById(sessionId)) ?? undefined;
      if (!session) {
        console.warn(`[DEBUG] Failed to reconstruct session: ${sessionId}`);
        return null;
      }
      console.warn(`[DEBUG] Session reconstructed successfully: ${sessionId}`);
      activeSessions.set(sessionId, session);

      // Set up approval callbacks and event handlers for all agents in the reconstructed session
      const agents = session.getAgents();
      console.warn(
        `[DEBUG] Setting up approval callbacks and event handlers for ${agents.length} agents`
      );
      for (const agentInfo of agents) {
        const agent = session.getAgent(agentInfo.threadId);
        if (agent) {
          console.warn(
            `[DEBUG] Setting up approval callback and event handlers for agent: ${agentInfo.threadId}`
          );
          const { setupAgentApprovals } = await import('./agent-utils');
          setupAgentApprovals(agent, sessionId);
          this.setupAgentEventHandlers(agent, sessionId);
        }
      }
    }

    return session;
  }

  private setupAgentEventHandlers(agent: Agent, sessionId: ThreadId): void {
    const sseManager = SSEManager.getInstance();
    const threadId = asThreadId(agent.threadId);

    console.warn(`Setting up SSE event handlers for agent ${threadId} in session ${sessionId}`);

    // Check if agent is started
    const isRunning = agent.getCurrentState() !== 'idle';
    console.warn(`Agent ${threadId} running state:`, isRunning);

    agent.on('agent_thinking_start', () => {
      console.warn(`Agent ${threadId} started thinking`);
      const event: SessionEvent = {
        type: 'THINKING',
        threadId,
        timestamp: new Date().toISOString(),
        data: { status: 'start' },
      };
      sseManager.broadcast(sessionId, event);
    });

    agent.on('agent_thinking_complete', () => {
      const event: SessionEvent = {
        type: 'THINKING',
        threadId,
        timestamp: new Date().toISOString(),
        data: { status: 'complete' },
      };
      sseManager.broadcast(sessionId, event);
    });

    agent.on('agent_response_complete', ({ content }: { content: string }) => {
      console.warn(`Agent ${threadId} response complete:`, content.substring(0, 100) + '...');
      const event: SessionEvent = {
        type: 'AGENT_MESSAGE',
        threadId,
        timestamp: new Date().toISOString(),
        data: { content },
      };
      sseManager.broadcast(sessionId, event);
    });

    // Handle streaming tokens
    agent.on('agent_token', ({ token }: { token: string }) => {
      // Keep console output for development
      process.stdout.write(token);

      // Broadcast token to UI for real-time display
      const event: SessionEvent = {
        type: 'AGENT_TOKEN',
        threadId,
        timestamp: new Date().toISOString(),
        data: { token },
      };
      sseManager.broadcast(sessionId, event);
    });

    agent.on('tool_call_start', ({ toolName, input }: { toolName: string; input: unknown }) => {
      const event: SessionEvent = {
        type: 'TOOL_CALL',
        threadId,
        timestamp: new Date().toISOString(),
        data: { toolName, input },
      };
      sseManager.broadcast(sessionId, event);
    });

    agent.on(
      'tool_call_complete',
      ({ toolName, result }: { toolName: string; result: unknown }) => {
        const event: SessionEvent = {
          type: 'TOOL_RESULT',
          threadId,
          timestamp: new Date().toISOString(),
          data: { toolName, result },
        };
        sseManager.broadcast(sessionId, event);
      }
    );

    // Listen for state changes to debug
    agent.on('state_change', ({ from, to }: { from: string; to: string }) => {
      console.warn(`Agent ${threadId} state changed: ${from} -> ${to}`);
    });

    // Listen for any errors
    agent.on('error', ({ error }: { error: Error }) => {
      console.error(`Agent ${threadId} error:`, error);
      const event: SessionEvent = {
        type: 'LOCAL_SYSTEM_MESSAGE',
        threadId,
        timestamp: new Date().toISOString(),
        data: { message: `Agent error: ${error.message}` },
      };
      sseManager.broadcast(sessionId, event);
    });

    // Listen for conversation complete
    agent.on('conversation_complete', () => {
      console.warn(`Agent ${threadId} conversation complete`);
    });

    // Handle tool approval requests
    agent.on(
      'approval_request',
      ({
        toolName,
        input,
        isReadOnly,
        requestId: _requestId,
        resolve,
      }: {
        toolName: string;
        input: unknown;
        isReadOnly: boolean;
        requestId: string;
        resolve: (decision: CoreApprovalDecision) => void;
      }) => {
        console.warn(
          `Tool approval requested for ${toolName} (${isReadOnly ? 'read-only' : 'destructive'})`
        );

        const approvalManager = getApprovalManager();

        // Handle async approval in a separate function
        void (async () => {
          try {
            // Get tool metadata from the tool executor
            // Use the public toolExecutor property instead of unsafe casting
            const tool = agent.toolExecutor?.getTool(toolName);
            const toolDescription = tool?.description;
            const toolAnnotations = tool?.annotations;

            // Request approval through the manager
            const decision = await approvalManager.requestApproval(
              threadId,
              sessionId,
              toolName,
              toolDescription,
              toolAnnotations,
              input,
              isReadOnly
            );

            resolve(decision);
          } catch (error) {
            // On timeout or error, deny the request
            console.error(`Approval request failed for ${toolName}:`, error);
            resolve(ApprovalDecision.DENY as CoreApprovalDecision);

            // Notify UI about the timeout/error
            const event: SessionEvent = {
              type: 'LOCAL_SYSTEM_MESSAGE',
              threadId,
              timestamp: new Date().toISOString(),
              data: {
                message: `Tool "${toolName}" was denied (${error instanceof Error ? error.message : 'approval failed'})`,
              },
            };
            sseManager.broadcast(sessionId, event);
          }
        })();
      }
    );
  }

  // Service layer methods to eliminate direct business logic calls from API routes

  async updateSessionConfiguration(
    sessionId: ThreadId,
    config: Record<string, unknown>
  ): Promise<void> {
    const sessionData = Session.getSession(sessionId);
    if (!sessionData) {
      throw new Error('Session not found');
    }

    const currentConfig =
      (sessionData as { getConfiguration(): Record<string, unknown> }).getConfiguration() || {};
    const newConfig: Record<string, unknown> = { ...currentConfig, ...config };

    // Merge toolPolicies separately to avoid overriding all policies
    if (currentConfig.toolPolicies || config.toolPolicies) {
      newConfig.toolPolicies = {
        ...((currentConfig.toolPolicies as Record<string, string>) || {}),
        ...((config.toolPolicies as Record<string, string>) || {}),
      };
    }

    const { getPersistence } = await import('~/persistence/database');
    const persistence = getPersistence();

    persistence.updateSession(sessionId, {
      configuration: newConfig,
      updatedAt: new Date(),
    });
  }

  updateSession(sessionId: ThreadId, updates: Record<string, unknown>): void {
    Session.updateSession(sessionId, updates);
  }

  async getSessionData(sessionId: ThreadId): Promise<Record<string, unknown> | null> {
    return Session.getSession(sessionId);
  }

  // Test helper method to clear active sessions
  clearActiveSessions(): void {
    activeSessions.clear();
  }

  // Helper to convert Session instance to SessionType for API responses
  private sessionToMetadata(session: Session): SessionType {
    const sessionInfo = session.getInfo();
    if (!sessionInfo) {
      throw new Error('Failed to get session info');
    }

    const agents = session.getAgents();

    return {
      id: session.getId(),
      name: sessionInfo.name,
      createdAt: sessionInfo.createdAt.toISOString(),
      agents: agents.map((agent) => ({
        threadId: agent.threadId,
        name: agent.name,
        provider: agent.provider,
        model: agent.model,
        status: agent.status as AgentType['status'],
        createdAt: (agent as { createdAt?: string }).createdAt ?? new Date().toISOString(),
      })),
    };
  }
}

// Use global to persist across HMR in development
declare global {
  var sessionService: SessionService | undefined;
}

export function getSessionService(): SessionService {
  if (!global.sessionService) {
    global.sessionService = new SessionService();
  }
  return global.sessionService;
}
