// ABOUTME: Server-side session management service
// ABOUTME: Provides high-level API for managing sessions and agents using the Session class

import { Agent, Session } from '@/lib/server/lace-imports';
import type { ThreadId, _ToolAnnotations } from '@/lib/server/lace-imports';
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

  async createSession(name?: string): Promise<SessionType> {
    // Get default provider and model from environment
    const defaultProvider =
      process.env.ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai';
    const defaultModel = 'claude-3-haiku-20240307';

    const sessionName = name || 'Untitled Session';
    const dbPath = process.env.LACE_DB_PATH || './lace.db';

    // Create session using Session class
    const session = Session.create(sessionName, defaultProvider, defaultModel, dbPath);
    const sessionId = session.getId();

    // Start the coordinator agent (this was missing!)
    const coordinatorAgent = session.getAgent(sessionId);
    if (!coordinatorAgent) {
      throw new Error('Failed to get coordinator agent');
    }

    // Start the coordinator agent
    await coordinatorAgent.start();

    // Set up event handlers for the coordinator agent
    this.setupAgentEventHandlers(coordinatorAgent, sessionId);

    // Store the session instance
    activeSessions.set(sessionId, session);

    // Get the full session info including coordinator agent
    const sessionInfo = session.getInfo();
    if (!sessionInfo) {
      throw new Error('Failed to get session info');
    }

    return {
      id: sessionId,
      name: sessionName,
      createdAt: new Date().toISOString(),
      agents: sessionInfo.agents.map((agent) => ({
        threadId: agent.threadId,
        name: agent.name,
        provider: agent.provider,
        model: agent.model,
        status: agent.status,
        createdAt: new Date().toISOString(),
      })),
    };
  }

  async listSessions(): Promise<SessionType[]> {
    const dbPath = process.env.LACE_DB_PATH || './lace.db';
    const sessionInfos = Session.getAll(dbPath);

    // Create a map of persisted sessions
    const persistedSessions = new Map<string, SessionType>();

    for (const sessionInfo of sessionInfos) {
      let session = activeSessions.get(sessionInfo.id);

      if (!session) {
        // Reconstruct session from database
        console.warn(`[DEBUG] Reconstructing session from database: ${sessionInfo.id}`);
        session = await Session.getById(sessionInfo.id, dbPath);
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

      const agents = session ? session.getAgents() : [];

      persistedSessions.set(sessionInfo.id, {
        id: sessionInfo.id,
        name: sessionInfo.name,
        createdAt: sessionInfo.createdAt.toISOString(),
        agents: agents.map((agent) => ({
          threadId: agent.threadId,
          name: agent.name,
          provider: agent.provider,
          model: agent.model,
          status: agent.status,
        })),
      });
    }

    // Add any active sessions that aren't in the persisted list
    activeSessions.forEach((session, sessionId) => {
      if (!persistedSessions.has(sessionId)) {
        const sessionInfo = session.getInfo();
        if (sessionInfo) {
          const agents = session.getAgents();
          persistedSessions.set(sessionId, {
            id: sessionId,
            name: sessionInfo.name,
            createdAt: sessionInfo.createdAt.toISOString(),
            agents: agents.map((agent) => ({
              threadId: agent.threadId,
              name: agent.name,
              provider: agent.provider,
              model: agent.model,
              status: agent.status,
            })),
          });
        }
      }
    });

    return Array.from(persistedSessions.values());
  }

  async getSession(sessionId: ThreadId): Promise<SessionType | null> {
    console.warn(`[DEBUG] getSession called for sessionId: ${sessionId}`);

    const dbPath = process.env.LACE_DB_PATH || './lace.db';

    // Try to get from active sessions first
    let session = activeSessions.get(sessionId);
    console.warn(`[DEBUG] Session found in active sessions: ${session ? 'yes' : 'no'}`);

    if (!session) {
      // Try to load from database by reconstructing the session
      console.warn(`[DEBUG] Reconstructing session from database: ${sessionId}`);
      session = await Session.getById(sessionId, dbPath);
      if (!session) {
        console.warn(`[DEBUG] Failed to reconstruct session: ${sessionId}`);
        return null;
      }
      console.warn(`[DEBUG] Session reconstructed successfully: ${sessionId}`);
      activeSessions.set(sessionId, session);

      // Set up event handlers for all agents in the reconstructed session
      const agents = session.getAgents();
      console.warn(`[DEBUG] Setting up event handlers for ${agents.length} agents`);
      for (const agentInfo of agents) {
        const agent = session.getAgent(agentInfo.threadId);
        if (agent) {
          console.warn(`[DEBUG] Setting up event handlers for agent: ${agentInfo.threadId}`);
          this.setupAgentEventHandlers(agent, sessionId);
        }
      }
    }

    const sessionInfo = session.getInfo();
    if (!sessionInfo) {
      return null;
    }

    const agents = session.getAgents();

    return {
      id: sessionId,
      name: sessionInfo.name,
      createdAt: sessionInfo.createdAt.toISOString(),
      agents: agents.map((agent) => ({
        threadId: agent.threadId,
        name: agent.name,
        provider: agent.provider,
        model: agent.model,
        status: agent.status,
      })),
    };
  }

  async spawnAgent(
    sessionId: ThreadId,
    name: string,
    provider?: string,
    model?: string
  ): Promise<AgentType> {
    // Get the session
    const session = activeSessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    // Spawn agent using Session class
    const agent = session.spawnAgent(name, provider, model);

    // Set up tool approval callback
    const approvalManager = getApprovalManager();
    const agentThreadId = asThreadId(agent.threadId);

    agent.toolExecutor.setApprovalCallback({
      requestApproval: async (toolName: string, input: unknown): Promise<ApprovalDecision> => {
        // Get tool metadata
        const tool = agent.toolExecutor.getTool(toolName);
        const toolDescription = tool?.description;
        const toolAnnotations = tool?.annotations;
        const isReadOnly = toolAnnotations?.readOnlyHint === true;

        // Request approval through the manager
        return await approvalManager.requestApproval(
          agentThreadId,
          sessionId, // Use sessionId for approval context
          toolName,
          toolDescription,
          toolAnnotations,
          input,
          isReadOnly
        );
      },
    });

    // Start the agent
    await agent.start();

    // Set up event handlers for SSE broadcasting
    this.setupAgentEventHandlers(agent, sessionId);

    const agentData: AgentType = {
      threadId: agentThreadId,
      name,
      provider: agent.providerName,
      model: model || 'claude-3-haiku-20240307',
      status: 'idle',
      createdAt: new Date().toISOString(),
    };

    return agentData;
  }

  getAgent(threadId: ThreadId): Agent | null {
    console.warn(`[DEBUG] getAgent called for threadId: ${threadId}`);
    console.warn(`[DEBUG] Active sessions count: ${activeSessions.size}`);
    console.warn(`[DEBUG] Active session IDs: ${Array.from(activeSessions.keys()).join(', ')}`);

    // Find session that contains this agent
    for (const session of activeSessions.values()) {
      console.warn(`[DEBUG] Checking session ${session.getId()} for agent ${threadId}`);
      const agent = session.getAgent(threadId);
      if (agent) {
        console.warn(`[DEBUG] Found agent in session ${session.getId()}`);
        console.warn(`[DEBUG] Agent state: ${agent.getCurrentState()}`);
        console.warn(`[DEBUG] Agent started: ${agent.getCurrentState() !== 'idle'}`);
        return agent;
      }
    }

    // If not found in active sessions, try to load the session from database
    // First check if this looks like a coordinator agent (session thread ID)
    if (threadId.match(/^lace_\d{8}_[a-z0-9]+$/)) {
      // This is a coordinator agent, load its session
      const dbPath = process.env.LACE_DB_PATH || './lace.db';
      Session.getById(threadId, dbPath)
        .then((session) => {
          if (session) {
            activeSessions.set(threadId, session);
            // Set up event handlers for the coordinator agent
            const coordinatorAgent = session.getAgent(threadId);
            if (coordinatorAgent) {
              this.setupAgentEventHandlers(coordinatorAgent, threadId);
            }
          }
        })
        .catch((error) => {
          console.error(`Failed to load session ${threadId}:`, error);
        });

      // Return null for now, the session will be loaded asynchronously
      return null;
    }

    return null;
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
        resolve: (decision: ApprovalDecision) => void;
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
            resolve(ApprovalDecision.DENY);

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

  // These methods are now handled by the Session class

  // Test helper method to clear active sessions
  clearActiveSessions(): void {
    activeSessions.clear();
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
