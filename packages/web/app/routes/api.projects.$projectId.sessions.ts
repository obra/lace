// ABOUTME: Session API endpoints under projects hierarchy - GET sessions by project, POST new session
// ABOUTME: Uses Project class methods for session management with proper project-session relationships

import { Project } from '@lace/web/lib/server/lace-imports';
import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { EventStreamManager } from '@lace/web/lib/event-stream-manager';
import { z } from 'zod';
import type { Route } from './+types/api.projects.$projectId.sessions';
import { getProviderManagementAgent, getSupervisor } from '@lace/web/lib/server/supervisor-service';

const CreateSessionSchema = z.object({
  name: z.string().min(1).optional(), // Optional for both flows
  initialMessage: z.string().min(1).optional(), // Optional - new simplified flow
  description: z.string().optional(),
  providerInstanceId: z.string().min(1, 'Provider instance ID is required'),
  modelId: z.string().min(1, 'Model ID is required'),
  workspaceMode: z.enum(['container', 'local']).optional(),
  configuration: z.record(z.unknown()).optional(),
});

export async function loader({ request: _request, params }: Route.LoaderArgs) {
  try {
    const { projectId } = params as { projectId: string };
    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const supervisor = await getSupervisor();
    const sessions = (await supervisor.listWorkspaceSessions())
      .filter((s) => s.projectId === projectId)
      .map((s) => ({
        id: s.workspaceSessionId,
        name: s.name ?? 'Session',
        createdAt: new Date(s.createdAt),
        agentCount: s.agents.length,
      }));

    return createSuperjsonResponse(sessions);
  } catch (error: unknown) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to fetch sessions',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== 'POST') {
    return createErrorResponse('Method not allowed', 405, { code: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const { projectId } = params as { projectId: string };
    const body = (await request.json()) as Record<string, unknown>;
    const validatedData = CreateSessionSchema.parse(body);

    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Determine session name - either provided or generated from initialMessage
    let sessionName: string;
    if (validatedData.name) {
      sessionName = validatedData.name;
    } else if (validatedData.initialMessage) {
      // Use full initialMessage as temporary name (will be replaced by AI)
      sessionName = validatedData.initialMessage.trim();
    } else {
      sessionName = 'New Session';
    }

    const supervisor = await getSupervisor();
    const created = await supervisor.createWorkspaceSession(project.getWorkingDirectory());
    await supervisor.updateWorkspaceSession(created.workspaceSessionId, {
      projectId,
      name: sessionName,
    });
    await supervisor.upsertAgentSessionMeta(created.workspaceSessionId, {
      sessionId: created.sessionId,
      name: 'coordinator',
      connectionId: validatedData.providerInstanceId,
      modelId: validatedData.modelId,
    });

    await supervisor.agentRequest({
      workspaceSessionId: created.workspaceSessionId,
      sessionId: created.sessionId,
      method: 'ent/session/configure',
      requestParams: {
        connectionId: validatedData.providerInstanceId,
        modelId: validatedData.modelId,
        approvalMode: 'ask',
        mcpServers: Object.entries(project.getMCPServers()).map(([name, config]) => ({
          name,
          command: config.command,
          ...(config.args ? { args: config.args } : {}),
          ...(config.env ? { env: config.env } : {}),
          enabled: config.enabled,
          tools: config.tools,
        })),
      },
    });

    const sessionData = {
      id: created.workspaceSessionId,
      name: sessionName,
      createdAt: new Date(),
      // Include coordinator agent for navigation (matches AgentInfo interface)
      agents: [
        {
          threadId: created.sessionId,
          name: 'coordinator',
          providerInstanceId: validatedData.providerInstanceId,
          modelId: validatedData.modelId,
          status: 'idle' as const,
        },
      ],
    };

    // If we have initialMessage, spawn background helper to generate better name
    if (validatedData.initialMessage) {
      void spawnSessionNamingHelper(
        created.workspaceSessionId,
        projectId,
        project.getName(),
        validatedData.initialMessage,
        {
          providerInstanceId: validatedData.providerInstanceId,
          modelId: validatedData.modelId,
        }
      );
    }

    return createSuperjsonResponse(sessionData, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      // Provide detailed field-level validation errors
      const fieldErrors: Record<string, string> = {};
      error.errors.forEach((err) => {
        const field = err.path.join('.');
        fieldErrors[field] = err.message;
      });

      const errorMessage = Object.entries(fieldErrors)
        .map(([field, msg]) => `${field}: ${msg}`)
        .join(', ');

      return createErrorResponse(`Validation failed: ${errorMessage}`, 400, {
        code: 'VALIDATION_FAILED',
        details: {
          errors: error.errors,
          fieldErrors,
          summary: errorMessage,
        },
      });
    }

    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to create session',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}

/**
 * Spawn background helper to generate session name and emit SESSION_INFO event
 */
async function spawnSessionNamingHelper(
  workspaceSessionId: string,
  projectId: string,
  projectName: string,
  initialMessage: string,
  fallbackModel: { providerInstanceId: string; modelId: string }
): Promise<void> {
  try {
    const supervisor = await getSupervisor();
    const mgmt = await getProviderManagementAgent();

    await supervisor.agentRequest({
      workspaceSessionId: mgmt.workspaceSessionId,
      sessionId: mgmt.agentSessionId,
      method: 'ent/session/configure',
      requestParams: {
        connectionId: fallbackModel.providerInstanceId,
        modelId: fallbackModel.modelId,
        approvalMode: 'ask',
      },
    });

    const prompt = [
      `Project: ${projectName}`,
      ``,
      `User's first message:`,
      initialMessage.trim(),
      ``,
      `Task: Generate a short, specific session title (3–7 words).`,
      `Return ONLY the title. No quotes. No punctuation at the end.`,
    ].join('\n');

    type PromptResult = {
      content: Array<{ type: string; text?: string }>;
      structuredOutput?: unknown;
    };

    const naming = (await supervisor.agentRequest({
      workspaceSessionId: mgmt.workspaceSessionId,
      sessionId: mgmt.agentSessionId,
      method: 'session/prompt',
      requestParams: {
        content: [{ type: 'text', text: prompt }],
        maxTurns: 1,
        outputFormat: {
          type: 'json_schema',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['title'],
            properties: { title: { type: 'string' } },
          },
        },
      },
    })) as PromptResult;

    const structuredTitle = (() => {
      const so = naming.structuredOutput;
      if (!so || typeof so !== 'object') return undefined;
      const title = (so as { title?: unknown }).title;
      return typeof title === 'string' ? title : undefined;
    })();

    const contentTitle = naming.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join(' ')
      .trim();

    const generatedName =
      (typeof structuredTitle === 'string' && structuredTitle.trim()) ||
      contentTitle.split('\n')[0]?.trim() ||
      'New Session';

    await supervisor.updateWorkspaceSession(workspaceSessionId, { name: generatedName });

    // Emit SESSION_INFO event via SSE
    const eventManager = EventStreamManager.getInstance();
    eventManager.broadcast({
      id: crypto.randomUUID(),
      timestamp: new Date(),
      type: 'SESSION_INFO',
      data: {
        title: generatedName,
        updatedAt: new Date(),
      },
      workspaceSessionId,
      projectId,
      transient: true,
    });
  } catch (error) {
    // Log error but don't fail the session creation
    console.error('Failed to generate session name:', error);
  }
}
