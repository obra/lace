// ABOUTME: REST API endpoints for individual agent management - GET, PUT for agent updates
// ABOUTME: Handles agent configuration updates including provider and model changes

import { NextRequest } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';
import { asThreadId } from '@/types/core';
import { isValidThreadId } from '@/lib/validation/thread-id-validation';
import { createSuperjsonResponse } from '@/lib/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { z } from 'zod';
import { ProviderRegistry } from '@/lib/server/lace-imports';

const AgentUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    providerInstanceId: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
  })
  .refine(
    (data) => {
      // If either providerInstanceId or modelId is provided, both must be provided
      if (data.providerInstanceId || data.modelId) {
        return data.providerInstanceId && data.modelId;
      }
      return true;
    },
    {
      message: 'Both providerInstanceId and modelId must be provided together',
    }
  );

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params;

    if (!isValidThreadId(agentId)) {
      return createErrorResponse('Invalid agent ID', 400, { code: 'VALIDATION_FAILED' });
    }

    const agentThreadId = asThreadId(agentId);

    // Extract sessionId from agentId (agents are child threads like sessionId.1)
    const sessionId = asThreadId(agentThreadId.split('.')[0]);

    const sessionService = getSessionService();
    const session = await sessionService.getSession(sessionId);

    if (!session) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const agent = session.getAgent(agentThreadId);

    if (!agent) {
      return createErrorResponse('Agent not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const metadata = agent.getThreadMetadata();

    const agentResponse = {
      threadId: agent.threadId,
      name: (metadata?.name as string) || 'Agent ' + agent.threadId,
      provider: (metadata?.provider as string) || agent.providerName,
      model: (metadata?.model as string) || 'unknown',
      status: agent.getCurrentState(),
      createdAt: new Date(), // TODO: Get actual creation time
    };

    return createSuperjsonResponse({ agent: agentResponse });
  } catch (error: unknown) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to fetch agent',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params;

    if (!isValidThreadId(agentId)) {
      return createErrorResponse('Invalid agent ID', 400, { code: 'VALIDATION_FAILED' });
    }

    const body = (await request.json()) as Record<string, unknown>;

    let validatedData;
    try {
      validatedData = AgentUpdateSchema.parse(body);
    } catch (zodError) {
      if (zodError instanceof z.ZodError) {
        const details = zodError.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
          received: body[e.path[0] as keyof typeof body],
        }));
        return createErrorResponse(
          `Validation failed: ${details.map((d) => `${d.path}: ${d.message}`).join(', ')}`,
          400,
          {
            code: 'VALIDATION_FAILED',
            details,
            receivedData: body,
          }
        );
      }
      throw zodError;
    }

    const agentThreadId = asThreadId(agentId);

    // Extract sessionId from agentId (agents are child threads like sessionId.1)
    const sessionId = asThreadId(agentThreadId.split('.')[0]);

    const sessionService = getSessionService();
    const session = await sessionService.getSession(sessionId);

    if (!session) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const agent = session.getAgent(agentThreadId);

    if (!agent) {
      return createErrorResponse('Agent not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Validate provider instance if provided
    if (validatedData.providerInstanceId) {
      const registry = ProviderRegistry.getInstance();

      const configuredInstances = await registry.getConfiguredInstances();
      const instance = configuredInstances.find(
        (inst) => inst.id === validatedData.providerInstanceId
      );

      if (!instance) {
        return createErrorResponse('Provider instance not found', 400, {
          code: 'VALIDATION_FAILED',
          availableInstances: configuredInstances.map((i) => ({
            id: i.id,
            name: (i as { name?: string; displayName: string }).name || i.displayName,
          })),
        });
      }
    }

    // Update agent properties via thread metadata
    const updates: Record<string, unknown> = {};

    if (validatedData.name !== undefined) {
      updates.name = validatedData.name;
    }

    // Update provider instance and model if provided
    if (validatedData.providerInstanceId !== undefined) {
      updates.providerInstanceId = validatedData.providerInstanceId;
    }
    if (validatedData.modelId !== undefined) {
      updates.modelId = validatedData.modelId;
    }

    if (Object.keys(updates).length > 0) {
      agent.updateThreadMetadata(updates);
    }

    const metadata = agent.getThreadMetadata();

    const agentResponse = {
      threadId: agent.threadId,
      name: (metadata?.name as string) || 'Agent ' + agent.threadId,
      provider: (metadata?.provider as string) || agent.providerName,
      model: (metadata?.model as string) || 'unknown',
      status: agent.getCurrentState(),
      createdAt: new Date(), // TODO: Get actual creation time
    };

    return createSuperjsonResponse({ agent: agentResponse });
  } catch (error: unknown) {
    // Zod errors are now handled above with better messages

    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to update agent',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}
