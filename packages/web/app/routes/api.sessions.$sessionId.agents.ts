// ABOUTME: Agent spawning API endpoints for creating and listing agents within a session
// ABOUTME: Agents are independent agent sessions within a workspace session

import { CreateAgentRequest } from '@lace/web/types/api';
import { getSupervisor } from '@lace/web/lib/server/supervisor-service';
import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import {
  requireSessionId,
  throwNotFound,
  throwMethodNotAllowed,
  errorToResponse,
} from '@lace/web/lib/server/route-helpers';
import { EventStreamManager } from '@lace/web/lib/event-stream-manager';
import { getProviderManagementAgent } from '@lace/web/lib/server/supervisor-service';
import { Project } from '@lace/web/lib/server/projects/project';
import { mcpServersForProject } from '@lace/web/lib/server/projects/project-mcp-servers';
import type { Route } from './+types/api.sessions.$sessionId.agents';
import type { PersonaInfo } from '@lace/ent-protocol';

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
    const workspaceSessionId = requireSessionId(params);

    const supervisor = await getSupervisor();
    const record = await supervisor.getWorkspaceSession(workspaceSessionId);
    if (!record) {
      throwNotFound('Session');
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
  } catch (error: unknown) {
    return errorToResponse(error);
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  try {
    if (request.method !== 'POST') {
      throwMethodNotAllowed();
    }

    const workspaceSessionId = requireSessionId(params);

    // Parse and validate request body
    const bodyData: unknown = await request.json();

    if (!isCreateAgentRequest(bodyData)) {
      return createErrorResponse('Invalid request body', 400, { code: 'VALIDATION_FAILED' });
    }

    const body: CreateAgentRequest = bodyData;

    const supervisor = await getSupervisor();

    const ws = await supervisor.getWorkspaceSession(workspaceSessionId);
    if (!ws) {
      throwNotFound('Session');
    }

    const nextAgentIndex = ws.agents.length;
    const requestedName = typeof body.name === 'string' ? body.name.trim() : '';
    const agentName = requestedName || `Agent-${nextAgentIndex}`;

    const requestedPersona = typeof body.persona === 'string' ? body.persona.trim() : '';
    const persona = requestedPersona || 'lace';

    // Validate persona against agent-advertised list (ENT-only; no web reach-in to agent registries).
    {
      const mgmt = await getProviderManagementAgent();
      const personaRes = await supervisor.agentRequest({
        workspaceSessionId: mgmt.workspaceSessionId,
        sessionId: mgmt.agentSessionId,
        method: 'ent/personas/list',
        requestParams: {},
      });
      const personas = (personaRes as { personas?: PersonaInfo[] }).personas ?? [];
      const ok = personas.some((p) => p.name === persona);
      if (!ok) {
        return createErrorResponse('Invalid persona', 400, { code: 'VALIDATION_FAILED' });
      }
    }

    // Spawn agent process (agent protocol session) and configure it
    let created;
    try {
      const project = ws.projectId ? Project.getById(ws.projectId) : undefined;
      created = await supervisor.createAgentSession(workspaceSessionId, {
        persona,
        ...(project ? { mcpServers: mcpServersForProject(project) } : {}),
      });
    } catch (error) {
      // Log full error for server debugging while keeping client response sanitized
      console.error('Failed to spawn agent:', error);
      return createErrorResponse(
        `Failed to spawn agent: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
    return errorToResponse(error);
  }
}
