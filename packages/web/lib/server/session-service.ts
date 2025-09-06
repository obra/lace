// ABOUTME: Server-side session management service
// ABOUTME: Provides high-level API for managing sessions and agents using the Session class

import { Agent, Session } from '@/lib/server/lace-imports';
import type { LaceEvent, ToolResult, CombinedTokenUsage } from '@/types/core';
import { ApprovalDecision } from '@/types/core';
import { asThreadId } from '@/types/core';
import type { ThreadId } from '@/types/core';
import { EventStreamManager } from '@/lib/event-stream-manager';
import { setupAgentApprovals } from './agent-utils';
import { logger } from '~/utils/logger';

export class SessionService {
  // Track agents that already have event handlers set up to prevent duplicates across HMR
  private static registeredAgents = new WeakSet<Agent>();

  constructor() {}

  async getSession(sessionId: ThreadId): Promise<Session | null> {
    // Use Session's internal registry - this will reconstruct from database if needed
    const session = await Session.getById(sessionId);

    if (session) {
      // Set up approval callbacks and event handlers for all agents in the session
      const agents = session.getAgents();

      for (const agentInfo of agents) {
        const agent = session.getAgent(agentInfo.threadId);
        if (agent) {
          setupAgentApprovals(agent, sessionId);
          await this.setupAgentEventHandlers(agent);
        }
      }

      // Register Session with EventStreamManager (WeakSet prevents duplicates)
      EventStreamManager.getInstance().registerSession(session);
    }

    return session;
  }

  async setupAgentEventHandlers(agent: Agent): Promise<void> {
    // Prevent duplicate event handler registration
    if (SessionService.registeredAgents.has(agent)) {
      return;
    }
    SessionService.registeredAgents.add(agent);

    // Get session from agent
    const session = await agent.getFullSession();
    if (!session) {
      logger.warn(
        `[SESSION_SERVICE] No session found for agent ${agent.threadId}, skipping event handler setup`
      );
      return;
    }

    const sseManager = EventStreamManager.getInstance();
    const threadId = agent.threadId;
    const sessionId = session.getId();
    const projectId = session.getProjectId();

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
            projectId,
            taskId: undefined,
            agentId: undefined,
          },
        });
      }
    );

    // Handle streaming tokens
    agent.on('agent_token', ({ token }: { token: string }) => {
      // Broadcast token to UI for real-time display
      sseManager.broadcast({
        type: 'AGENT_TOKEN',
        threadId,
        timestamp: new Date(),
        data: { token },
        transient: true,
        context: {
          sessionId,
          projectId, // Use actual projectId from session instead of undefined
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
          projectId,
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
          projectId,
          taskId: undefined,
          agentId: undefined,
        },
      });
    });

    agent.on(
      'tool_call_start',
      ({
        toolName,
        arguments: args,
        callId,
      }: {
        toolName: string;
        arguments: Record<string, unknown>;
        callId: string;
      }) => {
        sseManager.broadcast({
          type: 'TOOL_CALL',
          threadId,
          timestamp: new Date(),
          data: { id: callId, name: toolName, arguments: args },
          context: {
            sessionId,
            projectId,
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
            projectId,
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
          projectId,
          taskId: undefined,
          agentId: undefined,
        },
      });
    });

    // Listen for any errors
    agent.on('error', ({ error }: { error: Error }) => {
      logger.error(`Agent ${threadId} error:`, error);
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
                projectId,
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
              projectId,
              taskId: undefined,
              agentId: undefined,
            },
          });
        } else if (event.type === 'USER_MESSAGE') {
          // Broadcast user messages to UI (agent messages handled via agent_response_complete)
          sseManager.broadcast({
            type: 'USER_MESSAGE',
            threadId: asThreadId(eventThreadId),
            timestamp: new Date(event.timestamp || new Date()),
            data: event.data,
            context: {
              sessionId,
              projectId,
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

  // Test helper method to clear session registry (replaced stopAllAgents)
  clearActiveSessions(): void {
    Session.clearRegistry();
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
