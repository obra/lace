// ABOUTME: Server-side session management service
// ABOUTME: Provides high-level API for managing sessions and agents using the Session class

import { Agent, Session } from '@/lib/server/lace-imports';
import type { ThreadEvent, ToolCall, ToolResult } from '@/types/core';
import { asThreadId } from '@/lib/server/lace-imports';
import type { ThreadId, SessionInfo } from '@/types/core';
import type { SessionEvent } from '@/types/web-sse';
import { EventStreamManager } from '@/lib/event-stream-manager';

export class SessionService {
  // Track agents that already have event handlers set up to prevent duplicates
  private registeredAgents = new WeakSet<Agent>();

  constructor() {}

  async createSession(
    name: string,
    provider: string,
    model: string,
    projectId: string
  ): Promise<SessionInfo> {
    // Create project-based session
    const { Project } = await import('@/lib/server/lace-imports');
    const project = Project.getById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    // Create session using Session.create which handles both database and thread creation
    const session = Session.create({
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

    agent.on('agent_response_complete', ({ content }: { content: string }) => {
      console.warn(
        `[SESSION_SERVICE] Agent ${threadId} response complete, broadcasting AGENT_MESSAGE`
      );
      const event: SessionEvent = {
        type: 'AGENT_MESSAGE',
        threadId,
        timestamp: new Date().toISOString(),
        data: { content },
      };
      sseManager.broadcast({
        eventType: 'session',
        scope: { sessionId },
        data: event,
      });
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
      sseManager.broadcast({
        eventType: 'session',
        scope: { sessionId },
        data: event,
      });
    });

    agent.on(
      'tool_call_start',
      ({ toolName, input, callId }: { toolName: string; input: unknown; callId: string }) => {
        const event: SessionEvent = {
          type: 'TOOL_CALL',
          threadId,
          timestamp: new Date().toISOString(),
          data: { id: callId, name: toolName, arguments: input },
        };
        sseManager.broadcast({
          eventType: 'session',
          scope: { sessionId },
          data: event,
        });
      }
    );

    agent.on(
      'tool_call_complete',
      ({ result }: { toolName: string; result: unknown; callId: string }) => {
        const event: SessionEvent = {
          type: 'TOOL_RESULT',
          threadId,
          timestamp: new Date().toISOString(),
          data: result as ToolResult, // Cast to ToolResult for type safety
        };
        sseManager.broadcast({
          eventType: 'session',
          scope: { sessionId },
          data: event,
        });
      }
    );

    // Listen for state changes
    agent.on('state_change', ({ from: _from, to: _to }: { from: string; to: string }) => {
      // State change logging can be enabled for debugging if needed
    });

    // Listen for any errors
    agent.on('error', ({ error }: { error: Error }) => {
      console.error(`Agent ${threadId} error:`, error);
      const event: SessionEvent = {
        type: 'LOCAL_SYSTEM_MESSAGE',
        threadId,
        timestamp: new Date().toISOString(),
        data: { content: `Agent error: ${error.message}` },
      };
      sseManager.broadcast({
        eventType: 'session',
        scope: { sessionId },
        data: event,
      });
    });

    // Listen for conversation complete
    agent.on('conversation_complete', () => {
      // Conversation complete - no logging needed
    });

    // Note: Tool approval is now handled by core EventApprovalCallback via ThreadManager events

    // Handle thread events (including approval events)
    agent.on(
      'thread_event_added',
      ({ event, threadId: eventThreadId }: { event: ThreadEvent; threadId: string }) => {
        // Convert thread events to session events and broadcast them
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
            const toolCall = toolCallEvent.data as ToolCall;

            // Try to get tool metadata
            let tool;
            try {
              tool = agent.toolExecutor?.getTool(toolCall.name);
            } catch {
              tool = null;
            }

            const sessionEvent: SessionEvent = {
              type: 'TOOL_APPROVAL_REQUEST',
              threadId: asThreadId(eventThreadId),
              timestamp: new Date(event.timestamp).toISOString(),
              data: {
                requestId: toolCallData.toolCallId,
                toolName: toolCall.name,
                input: toolCall.arguments,
                isReadOnly: tool?.annotations?.readOnlyHint ?? false,
                toolDescription: tool?.description,
                toolAnnotations: tool?.annotations,
                riskLevel: tool?.annotations?.readOnlyHint
                  ? 'safe'
                  : tool?.annotations?.destructiveHint
                    ? 'destructive'
                    : 'moderate',
              },
            };

            sseManager.broadcast({
              eventType: 'session',
              scope: { sessionId },
              data: sessionEvent,
            });
          }
        } else if (event.type === 'TOOL_APPROVAL_RESPONSE') {
          // Forward approval response events to UI so modal can refresh
          const responseData = event.data as { toolCallId: string; decision: string };

          const sessionEvent: SessionEvent = {
            type: 'TOOL_APPROVAL_RESPONSE',
            threadId: asThreadId(eventThreadId),
            timestamp: new Date(event.timestamp).toISOString(),
            data: {
              toolCallId: responseData.toolCallId,
              decision: responseData.decision,
            },
          };

          sseManager.broadcast({
            eventType: 'session',
            scope: { sessionId },
            data: sessionEvent,
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
      provider: sessionInfo.provider,
      model: sessionInfo.model,
      agents: agents.map((agent) => ({
        threadId: agent.threadId,
        name: agent.name,
        provider: agent.provider,
        model: agent.model,
        status: agent.status,
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
