// ABOUTME: Server-side session management service
// ABOUTME: Provides high-level API for managing sessions and agents using the Session class

import { Agent, Session } from '@/lib/server/lace-imports';
import type { ThreadId } from '@/lib/server/lace-imports';
import type { ThreadEvent, ToolCall } from '@/lib/server/core-types';
import { asThreadId } from '@/lib/server/lace-imports';
import { Session as SessionType, Agent as AgentType, SessionEvent } from '@/types/api';
import { SSEManager } from '@/lib/sse-manager';

// Active session instances
const activeSessions = new Map<ThreadId, Session>();

export class SessionService {
  constructor() {}

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
        session = (await Session.getById(sessionInfo.id)) ?? undefined;
        if (session) {
          activeSessions.set(sessionInfo.id, session);

          // Set up event handlers for all agents in the reconstructed session
          const agents = session.getAgents();
          for (const agentInfo of agents) {
            const agent = session.getAgent(agentInfo.threadId);
            if (agent) {
              this.setupAgentEventHandlers(agent, sessionInfo.id);
            }
          }
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
    // Try to get from active sessions first
    let session = activeSessions.get(sessionId);

    if (!session) {
      // Try to load from database by reconstructing the session
      session = (await Session.getById(sessionId)) ?? undefined;
      if (!session) {
        return null;
      }
      activeSessions.set(sessionId, session);

      // Set up approval callbacks and event handlers for all agents in the reconstructed session
      const agents = session.getAgents();
      for (const agentInfo of agents) {
        const agent = session.getAgent(agentInfo.threadId);
        if (agent) {
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
    const threadId = agent.threadId;

    agent.on('agent_response_complete', ({ content }: { content: string }) => {
      const event: SessionEvent = {
        type: 'AGENT_MESSAGE',
        threadId,
        timestamp: new Date(),
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
        timestamp: new Date(),
        data: { token },
      };
      sseManager.broadcast(sessionId, event);
    });

    agent.on('tool_call_start', ({ toolName, input }: { toolName: string; input: unknown }) => {
      const event: SessionEvent = {
        type: 'TOOL_CALL',
        threadId,
        timestamp: new Date(),
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
          timestamp: new Date(),
          data: { toolName, result },
        };
        sseManager.broadcast(sessionId, event);
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
        timestamp: new Date(),
        data: { content: `Agent error: ${error.message}` },
      };
      sseManager.broadcast(sessionId, event);
    });

    // Listen for conversation complete
    agent.on('conversation_complete', () => {
      // Conversation complete - no logging needed
    });

    // Note: Tool approval is now handled by core EventApprovalCallback via ThreadManager events

    // Handle thread events (including approval events)
    agent.on('thread_event_added', ({ event, threadId: eventThreadId }: { event: ThreadEvent; threadId: string }) => {
      // Convert thread events to session events and broadcast them
      if (event.type === 'TOOL_APPROVAL_REQUEST') {
        const toolCallData = event.data as { toolCallId: string };
        
        // Get the related TOOL_CALL event to reconstruct approval request data
        const events = agent.threadManager.getEvents(eventThreadId);
        const toolCallEvent = events.find(e => 
          e.type === 'TOOL_CALL' && 
          e.data && typeof e.data === 'object' && 'id' in e.data &&
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
            timestamp: new Date(event.timestamp),
            data: {
              requestId: toolCallData.toolCallId,
              toolName: toolCall.name,
              input: toolCall.arguments,
              isReadOnly: tool?.annotations?.readOnlyHint ?? false,
              toolDescription: tool?.description,
              toolAnnotations: tool?.annotations,
              riskLevel: tool?.annotations?.readOnlyHint ? 'safe' : 
                        tool?.annotations?.destructiveHint ? 'destructive' : 'moderate',
            },
          };
          
          sseManager.broadcast(sessionId, sessionEvent);
        }
      } else if (event.type === 'TOOL_APPROVAL_RESPONSE') {
        // Forward approval response events to UI so modal can refresh
        const responseData = event.data as { toolCallId: string; decision: string };
        
        const sessionEvent: SessionEvent = {
          type: 'TOOL_APPROVAL_RESPONSE',
          threadId: asThreadId(eventThreadId),
          timestamp: new Date(event.timestamp),
          data: {
            toolCallId: responseData.toolCallId,
            decision: responseData.decision,
          },
        };
        
        sseManager.broadcast(sessionId, sessionEvent);
      }
    );
  }

  // Service layer methods to eliminate direct business logic calls from API routes

  updateSession(sessionId: ThreadId, updates: Record<string, unknown>): void {
    Session.updateSession(sessionId, updates);
  }

  // Test helper method to stop all agents and clear active sessions
  async stopAllAgents(): Promise<void> {
    for (const session of activeSessions.values()) {
      // Stop the coordinator agent
      const coordinatorAgent = session.getAgent(session.getId());
      if (coordinatorAgent) {
        coordinatorAgent.stop();
      }
      
      // Stop all delegate agents
      const agentMetadata = session.getAgents();
      for (const agentMeta of agentMetadata) {
        if (agentMeta.threadId !== session.getId()) { // Skip coordinator (already stopped)
          const agent = session.getAgent(agentMeta.threadId);
          if (agent) {
            agent.stop();
          }
        }
      }
    }
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
