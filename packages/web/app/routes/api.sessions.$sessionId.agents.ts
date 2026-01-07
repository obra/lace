// ABOUTME: Agent spawning API endpoints for creating and listing agents within a session
// ABOUTME: Agents are independent agent sessions within a workspace session

import { CreateAgentRequest } from '@lace/web/types/api';
import { getSupervisor } from '@lace/web/lib/server/supervisor-service';
import { isWorkspaceSessionId } from '@lace/web/lib/validation/session-id-validation';
import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { EventStreamManager } from '@lace/web/lib/event-stream-manager';
import { personaRegistry } from '@lace/web/lib/server/lace-imports';
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

    if (!isWorkspaceSessionId(sessionIdParam)) {
      return createErrorResponse('Invalid session ID', 400, { code: 'VALIDATION_FAILED' });
    }
    const workspaceSessionId = sessionIdParam;

    const supervisor = await getSupervisor();
    const record = await supervisor.getWorkspaceSession(workspaceSessionId);
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

    if (!isWorkspaceSessionId(sessionIdParam)) {
      return createErrorResponse('Invalid session ID', 400, { code: 'VALIDATION_FAILED' });
    }
    const workspaceSessionId = sessionIdParam;

    // Parse and validate request body
    const bodyData: unknown = await request.json();

    if (!isCreateAgentRequest(bodyData)) {
      return createErrorResponse('Invalid request body', 400, { code: 'VALIDATION_FAILED' });
    }

    const body: CreateAgentRequest = bodyData;

    const supervisor = await getSupervisor();

    const ws = await supervisor.getWorkspaceSession(workspaceSessionId);
    if (!ws) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const nextAgentIndex = ws.agents.length;
    const requestedName = typeof body.name === 'string' ? body.name.trim() : '';
    const agentName = requestedName || `Agent-${nextAgentIndex}`;

    const requestedPersona = typeof body.persona === 'string' ? body.persona.trim() : '';
    const persona = requestedPersona || 'lace';

    try {
      personaRegistry.validatePersona(persona);
    } catch (error) {
      return createErrorResponse(error instanceof Error ? error.message : 'Invalid persona', 400, {
        code: 'VALIDATION_FAILED',
      });
    }

    // Spawn agent process (agent protocol session) and configure it
    let created;
    try {
      created = await supervisor.createAgentSession(workspaceSessionId, { persona });
    } catch (error) {
      // Log full error for server debugging while keeping client response sanitized
      console.error('Failed to spawn agent:', error);
      return createErrorResponse(
        `Failed to spawn agent: ${isError(error) ? error.message : 'Unknown error'}`,
        400,
        { code: 'VALIDATION_FAILED' }
      );
    }

    await supervisor.upsertAgentSessionMeta(workspaceSessionId, {
      sessionId: created.sessionId,
      name: agentName,
      connectionId: body.providerInstanceId,
      modelId: body.modelId,
    });

    await supervisor.agentRequest({
      workspaceSessionId,
      sessionId: created.sessionId,
      method: 'ent/session/configure',
      requestParams: {
        connectionId: body.providerInstanceId,
        modelId: body.modelId,
        approvalMode: 'ask',
      },
    });

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
      id: crypto.randomUUID(),
      timestamp: new Date(),
      type: 'AGENT_SPAWNED',
      data: {
        agentSessionId: agentResponse.threadId,
        providerInstanceId: body.providerInstanceId,
        modelId: body.modelId,
        context: {
          actor: 'human',
          isHuman: true,
        },
      },
      workspaceSessionId,
      agentSessionId: agentResponse.threadId,
      transient: true,
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
