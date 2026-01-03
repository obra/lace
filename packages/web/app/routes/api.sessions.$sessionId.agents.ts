// ABOUTME: Agent spawning API endpoints for creating and listing agents within a session
// ABOUTME: Agents are independent agent sessions within a workspace session

import { CreateAgentRequest } from '@lace/web/types/api';
import { getSupervisor } from '@lace/web/lib/server/supervisor-service';
import { WorkspaceSessionIdSchema } from '@lace/web/lib/validation/workspace-session-id-validation';
import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { EventStreamManager } from '@lace/web/lib/event-stream-manager';
import { PromptManager, personaRegistry } from '@lace/web/lib/server/lace-imports';
import type { Route } from './+types/api.sessions.$sessionId.agents';

// Type guard for unknown error values
function isError(error: unknown): error is Error {
  return error instanceof Error;
}

// Type guard for CreateAgentRequest
function isCreateAgentRequest(body: unknown): body is CreateAgentRequest {
  return (
    typeof body === 'object' &&
    body !== null &&
    (!('name' in body) || typeof (body as { name: unknown }).name === 'string') &&
    (!('persona' in body) || typeof (body as { persona: unknown }).persona === 'string') &&
    (!('initialMessage' in body) ||
      typeof (body as { initialMessage: unknown }).initialMessage === 'string') &&
    'providerInstanceId' in body &&
    typeof (body as { providerInstanceId: unknown }).providerInstanceId === 'string' &&
    'modelId' in body &&
    typeof (body as { modelId: unknown }).modelId === 'string'
  );
}

export async function loader({ request: _request, params }: Route.LoaderArgs) {
  try {
    const { sessionId: sessionIdParam } = params as { sessionId: string };

    const parsed = WorkspaceSessionIdSchema.safeParse(sessionIdParam);
    if (!parsed.success) {
      return createErrorResponse('Invalid session ID', 400, { code: 'VALIDATION_FAILED' });
    }

    const supervisor = getSupervisor();
    const record = supervisor.getWorkspaceSession(parsed.data);
    if (!record) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    return createSuperjsonResponse(
      record.agents.map((a) => ({
        threadId: a.sessionId,
        name: a.name ?? '',
        providerInstanceId: a.connectionId,
        modelId: a.modelId,
        status: 'idle',
        createdAt: new Date(a.createdAt),
      }))
    );
  } catch (_error: unknown) {
    return createErrorResponse('Internal server error', 500, { code: 'INTERNAL_SERVER_ERROR' });
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  switch (request.method) {
    case 'POST':
      break;
    default:
      return createErrorResponse('Method not allowed', 405, { code: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const { sessionId: sessionIdParam } = params as { sessionId: string };

    const parsed = WorkspaceSessionIdSchema.safeParse(sessionIdParam);
    if (!parsed.success) {
      return createErrorResponse('Invalid session ID', 400, { code: 'VALIDATION_FAILED' });
    }
    const workspaceSessionId = parsed.data;

    // Parse and validate request body
    const bodyData: unknown = await request.json();

    if (!isCreateAgentRequest(bodyData)) {
      return createErrorResponse('Invalid request body', 400, { code: 'VALIDATION_FAILED' });
    }

    const body: CreateAgentRequest = bodyData;

    const supervisor = getSupervisor();

    const ws = supervisor.getWorkspaceSession(workspaceSessionId);
    if (!ws) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const nextAgentIndex = ws.agents.length;
    const requestedName = typeof body.name === 'string' ? body.name.trim() : '';
    const agentName = requestedName || `Agent-${nextAgentIndex}`;

    // Spawn agent process (agent protocol session) and configure it
    let created;
    try {
      created = await supervisor.createAgentSession(workspaceSessionId);
    } catch (error) {
      // Log full error for server debugging while keeping client response sanitized
      console.error('Failed to spawn agent:', error);
      return createErrorResponse(
        `Failed to spawn agent: ${isError(error) ? error.message : 'Unknown error'}`,
        400,
        { code: 'VALIDATION_FAILED' }
      );
    }

    supervisor.upsertAgentSessionMeta(workspaceSessionId, {
      sessionId: created.sessionId,
      name: agentName,
      connectionId: body.providerInstanceId,
      modelId: body.modelId,
    });

    const peer = supervisor.getPeer(workspaceSessionId, created.sessionId);

    await peer.request('ent/session/configure', {
      connectionId: body.providerInstanceId,
      modelId: body.modelId,
      approvalMode: 'ask',
    });

    const requestedPersona = typeof body.persona === 'string' ? body.persona.trim() : '';
    const persona = requestedPersona || 'lace';

    try {
      personaRegistry.validatePersona(persona);
    } catch (error) {
      return createErrorResponse(error instanceof Error ? error.message : 'Invalid persona', 400, {
        code: 'VALIDATION_FAILED',
      });
    }

    const promptManager = new PromptManager({
      session: { getWorkingDirectory: () => ws.workDir },
      project: { getWorkingDirectory: () => ws.workDir },
    });

    const systemPrompt = await promptManager.generateSystemPrompt(persona);
    if (systemPrompt.trim()) {
      try {
        await peer.request('ent/session/inject', {
          content: [{ type: 'text', text: systemPrompt }],
          priority: 'immediate',
        });
      } catch (error) {
        console.error('Failed to inject persona prompt:', error);
      }
    }

    const initialMessage =
      typeof body.initialMessage === 'string' ? body.initialMessage.trim() : '';
    if (initialMessage) {
      void supervisor
        .promptSession(workspaceSessionId, created.sessionId, [
          { type: 'text', text: initialMessage },
        ])
        .catch((error) => {
          console.error('Failed to send initial message:', error);
        });
    }

    const agentResponse = {
      threadId: created.sessionId,
      name: agentName,
      providerInstanceId: body.providerInstanceId,
      modelId: body.modelId,
      status: 'idle',
      createdAt: new Date(),
      tokenUsage: undefined,
    };

    const sseManager = EventStreamManager.getInstance();
    sseManager.broadcast({
      type: 'AGENT_SPAWNED',
      timestamp: new Date(),
      data: {
        type: 'agent:spawned',
        agentThreadId: agentResponse.threadId,
        providerInstanceId: body.providerInstanceId,
        modelId: body.modelId,
        context: {
          actor: 'human',
          isHuman: true,
        },
        timestamp: new Date(),
      },
      transient: true,
      context: {
        sessionId: workspaceSessionId,
        projectId: undefined,
        taskId: undefined,
        threadId: agentResponse.threadId,
      },
    });

    return createSuperjsonResponse(agentResponse, {
      status: 201,
      headers: {
        Location: `/api/agents/${agentResponse.threadId}`,
      },
    });
  } catch (error: unknown) {
    if (isError(error) && error.message === 'Session not found') {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    return createErrorResponse('Internal server error', 500, { code: 'INTERNAL_SERVER_ERROR' });
  }
}
