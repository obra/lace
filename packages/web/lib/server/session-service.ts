// ABOUTME: Server-side session management service
// ABOUTME: Provides high-level API for managing sessions and agents using the Session class

import { Agent, Session } from '@/lib/server/lace-imports';
import type { LaceEvent, ToolResult, CombinedTokenUsage } from '@/types/core';
import { ApprovalDecision } from '@/types/core';
import { asThreadId } from '@/types/core';
import type { ThreadId, SessionInfo } from '@/types/core';
import { EventStreamManager } from '@/lib/event-stream-manager';
import { logger } from '~/utils/logger';

export class SessionService {
  // Track agents that already have event handlers set up to prevent duplicates
  private registeredAgents = new WeakSet<Agent>();
  // Project ID context for events
  projectId?: string;

  constructor() {}

  async createSession(name: string, projectId: string): Promise<SessionInfo> {
    // Create project-based session
    const { Project } = await import('@/lib/server/lace-imports');
    const project = Project.getById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    // Create session using Session.create which handles both database and thread creation
    const session = Session.create({
      name,
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
    }

    // Register Session with EventStreamManager for TaskManager event forwarding
    EventStreamManager.getInstance().registerSession(session);

    // Session is automatically stored in Session._sessionRegistry via constructor
    // Return metadata for API response
    return this.sessionToMetadata(session);
  }

  async listSessions(): Promise<SessionInfo[]> {
    const sessionInfos = Session.getAll();
    const sessions: SessionInfo[] = [];

    for (const sessionInfo of sessionInfos) {
      // Try to get from registry first, then reconstruct if needed
      let session = await Session.getById(sessionInfo.id);

      if (session) {
        // Set up event handlers for all agents in the session
        const agents = session.getAgents();
        for (const agentInfo of agents) {
          const agent = session.getAgent(agentInfo.threadId);
          if (agent) {
            this.setupAgentEventHandlers(agent, sessionInfo.id);
          }
        }

        // Register Session with EventStreamManager (WeakSet prevents duplicates)
        EventStreamManager.getInstance().registerSession(session);

        sessions.push(this.sessionToMetadata(session));
      }
    }

    return sessions;
  }

  async getSession(sessionId: ThreadId): Promise<Session | null> {
    // Use Session's internal registry - this will reconstruct from database if needed
    const session = await Session.getById(sessionId);

    if (session) {
      // Set up approval callbacks and event handlers for all agents in the session
      const agents = session.getAgents();
      for (const agentInfo of agents) {
        const agent = session.getAgent(agentInfo.threadId);
        if (agent) {
          const { setupAgentApprovals } = await import('./agent-utils');
          setupAgentApprovals(agent, sessionId);
          this.setupAgentEventHandlers(agent, sessionId);
        }
      }

      // Register Session with EventStreamManager (WeakSet prevents duplicates)
      EventStreamManager.getInstance().registerSession(session);
    }

    return session;
  }

  setupAgentEventHandlers(agent: Agent, sessionId: ThreadId): void {
    // Prevent duplicate event handler registration
    if (this.registeredAgents.has(agent)) {
      return;
    }
    this.registeredAgents.add(agent);
    const sseManager = EventStreamManager.getInstance();
    const threadId = agent.threadId;

    agent.on(
      'agent_response_complete',
      ({ content, tokenUsage }: { content: string; tokenUsage?: CombinedTokenUsage }) => {
        logger.debug(
          `[SESSION_SERVICE] Agent ${threadId} response complete, broadcasting AGENT_MESSAGE`
        );
        sseManager.broadcast({
          type: 'AGENT_MESSAGE',
          threadId,
          timestamp: new Date(),
          data: { content, tokenUsage },
          context: {
            sessionId,
            projectId: undefined,
            taskId: undefined,
            agentId: undefined,
          },
        });
      }
    );

    // Handle streaming tokens
    agent.on('agent_token', ({ token }: { token: string }) => {
      // Keep console output for development
      process.stdout.write(token);

      // Broadcast token to UI for real-time display
      sseManager.broadcast({
        type: 'AGENT_TOKEN',
        threadId,
        timestamp: new Date(),
        data: { token },
        transient: true,
        context: {
          sessionId,
          projectId: undefined,
          taskId: undefined,
          agentId: undefined,
        },
      });
    });

    // Handle compaction start events
    agent.on('compaction_start', ({ auto }: { auto: boolean }) => {
      logger.debug(`[SESSION_SERVICE] Agent ${threadId} starting compaction (auto: ${auto})`);

      // Broadcast COMPACTION_START event
      sseManager.broadcast({
        type: 'COMPACTION_START' as const,
        threadId,
        timestamp: new Date(),
        data: {
          auto,
        },
        transient: true,
        context: {
          sessionId,
          projectId: this.projectId,
          taskId: undefined,
          agentId: undefined,
        },
      });
    });

    // Handle compaction complete events
    agent.on('compaction_complete', ({ success }: { success: boolean }) => {
      logger.debug(
        `[SESSION_SERVICE] Agent ${threadId} completed compaction (success: ${success})`
      );

      // Broadcast COMPACTION_COMPLETE event
      sseManager.broadcast({
        type: 'COMPACTION_COMPLETE' as const,
        threadId,
        timestamp: new Date(),
        data: {
          success,
        },
        transient: true,
        context: {
          sessionId,
          projectId: this.projectId,
          taskId: undefined,
          agentId: undefined,
        },
      });
    });

    agent.on(
      'tool_call_start',
      ({
        toolName,
        input,
        callId,
      }: {
        toolName: string;
        input: Record<string, unknown>;
        callId: string;
      }) => {
        sseManager.broadcast({
          type: 'TOOL_CALL',
          threadId,
          timestamp: new Date(),
          data: { id: callId, name: toolName, arguments: input },
          context: {
            sessionId,
            projectId: undefined,
            taskId: undefined,
            agentId: undefined,
          },
        });
      }
    );

    agent.on(
      'tool_call_complete',
      ({ result }: { toolName: string; result: unknown; callId: string }) => {
        sseManager.broadcast({
          type: 'TOOL_RESULT',
          threadId,
          timestamp: new Date(),
          data: result as ToolResult, // Cast to ToolResult for type safety
          context: {
            sessionId,
            projectId: undefined,
            taskId: undefined,
            agentId: undefined,
          },
        });
      }
    );

    // Listen for state changes and broadcast to UI
    agent.on('state_change', ({ from, to }: { from: string; to: string }) => {
      // Broadcast agent state change to UI via SSE
      sseManager.broadcast({
        type: 'AGENT_STATE_CHANGE',
        threadId,
        timestamp: new Date(),
        data: {
          agentId: threadId,
          from,
          to,
        },
        transient: true,
        context: {
          sessionId,
          projectId: undefined,
          taskId: undefined,
          agentId: undefined,
        },
      });
    });

    // Listen for any errors
    agent.on('error', ({ error }: { error: Error }) => {
      logger.error(`Agent ${threadId} error:`, error);

      // Filter out abort-related errors from UI messages to prevent duplicates
      // (These should already be filtered at the agent level, but this is defense-in-depth)
      const isAbortError =
        error.name === 'AbortError' ||
        error.message === 'Request was aborted' ||
        error.message === 'Aborted';

      if (!isAbortError) {
        sseManager.broadcast({
          type: 'LOCAL_SYSTEM_MESSAGE',
          threadId,
          timestamp: new Date(),
          data: `Agent error: ${error.message}`,
          context: {
            sessionId,
            projectId: undefined,
            taskId: undefined,
            agentId: undefined,
          },
        });
      }
    });

    // Listen for conversation complete
    agent.on('conversation_complete', () => {
      // Conversation complete - no logging needed
    });

    // Note: Tool approval is now handled by core EventApprovalCallback via ThreadManager events

    // Handle thread events (including approval events)
    agent.on(
      'thread_event_added',
      ({ event, threadId: eventThreadId }: { event: LaceEvent; threadId: string }) => {
        // Pass LaceEvents directly without conversion for approval events
        if (event.type === 'TOOL_APPROVAL_REQUEST') {
          const toolCallData = event.data as { toolCallId: string };

          // Get the related TOOL_CALL event to reconstruct approval request data
          const events = agent.threadManager.getEvents(eventThreadId);
          const toolCallEvent = events.find(
            (e) =>
              e.type === 'TOOL_CALL' &&
              e.data &&
              typeof e.data === 'object' &&
              'id' in e.data &&
              (e.data as { id: string }).id === toolCallData.toolCallId
          );

          if (toolCallEvent) {
            // Broadcast tool approval request with just the toolCallId
            // The UI will use this to look up the corresponding TOOL_CALL event
            sseManager.broadcast({
              type: 'TOOL_APPROVAL_REQUEST',
              threadId: asThreadId(eventThreadId),
              timestamp: new Date(event.timestamp || new Date()),
              data: {
                toolCallId: toolCallData.toolCallId,
              },
              context: {
                sessionId,
                projectId: undefined,
                taskId: undefined,
                agentId: undefined,
              },
            });
          }
        } else if (event.type === 'TOOL_APPROVAL_RESPONSE') {
          // Forward approval response events to UI so modal can refresh
          const responseData = event.data as { toolCallId: string; decision: string };

          sseManager.broadcast({
            type: 'TOOL_APPROVAL_RESPONSE',
            threadId: asThreadId(eventThreadId),
            timestamp: new Date(event.timestamp || new Date()),
            data: {
              toolCallId: responseData.toolCallId,
              decision: responseData.decision as ApprovalDecision,
            },
            context: {
              sessionId,
              projectId: undefined,
              taskId: undefined,
              agentId: undefined,
            },
          });
        }
      }
    );
  }

  // Service layer methods to eliminate direct business logic calls from API routes

  updateSession(sessionId: ThreadId, updates: Record<string, unknown>): void {
    Session.updateSession(sessionId, updates);
  }

  // Test helper method to stop all agents and clear sessions
  async stopAllAgents(): Promise<void> {
    const sessionInfos = Session.getAll();
    for (const sessionInfo of sessionInfos) {
      const session = await Session.getById(sessionInfo.id);
      if (session) {
        // Stop the coordinator agent
        const coordinatorAgent = session.getAgent(session.getId());
        if (coordinatorAgent) {
          coordinatorAgent.stop();
        }

        // Stop all delegate agents
        const agentMetadata = session.getAgents();
        for (const agentMeta of agentMetadata) {
          if (agentMeta.threadId !== session.getId()) {
            // Skip coordinator (already stopped)
            const agent = session.getAgent(agentMeta.threadId);
            if (agent) {
              agent.stop();
            }
          }
        }
      }
    }
  }

  // Test helper method to clear session registry
  clearActiveSessions(): void {
    Session.clearRegistry();
  }

  // Helper to convert Session instance to SessionInfo for API responses
  private sessionToMetadata(session: Session): SessionInfo {
    const sessionInfo = session.getInfo();
    if (!sessionInfo) {
      throw new Error('Failed to get session info');
    }

    const agents = session.getAgents();

    return {
      id: session.getId(),
      name: sessionInfo.name,
      createdAt: sessionInfo.createdAt,
      agents: agents,
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
