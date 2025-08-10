// ABOUTME: Individual session API endpoints - GET/PATCH/DELETE specific session in project
// ABOUTME: Uses Project class methods for session management with proper validation

import { NextRequest, NextResponse } from 'next/server';
import { Project } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { z } from 'zod';
import { asThreadId } from '@/types/core';

const UpdateSessionSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  configuration: z.record(z.unknown()).optional(),
  status: z.enum(['active', 'archived', 'completed']).optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; sessionId: string }> }
): Promise<NextResponse> {
  try {
    const { projectId, sessionId } = await params;
    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const session = project.getSession(sessionId);
    if (!session) {
      return createErrorResponse('Session not found in this project', 404, {
        code: 'RESOURCE_NOT_FOUND',
      });
    }

    // Get token usage information if available
    let tokenUsage = undefined;
    try {
      // Get the session instance to access agents and thread manager
      const { Session } = await import('@/lib/server/lace-imports');
      const sessionInstance = await Session.getById(asThreadId(sessionId));
      if (sessionInstance) {
        // Get the main agent's thread manager to access events
        const mainAgent = sessionInstance.getAgent(sessionInstance.getId());
        if (mainAgent && mainAgent.tokenBudgetManager) {
          // Get token usage directly from the TokenBudgetManager (single source of truth)
          const budgetStatus = mainAgent.tokenBudgetManager.getBudgetStatus();
          const contextLimit = mainAgent.tokenBudgetManager.config.maxTokens;

          tokenUsage = {
            promptTokens: budgetStatus.promptTokens,
            completionTokens: budgetStatus.completionTokens,
            totalTokens: budgetStatus.totalUsed,
            contextLimit,
            percentUsed: budgetStatus.usagePercentage * 100,
            nearLimit: budgetStatus.warningTriggered,
          };
        }
      }
    } catch (tokenError) {
      // Log but don't fail the request if token calculation fails
      console.warn('Failed to calculate token usage:', tokenError);
    }

    return createSuperjsonResponse({ session, tokenUsage });
  } catch (error: unknown) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to fetch session',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; sessionId: string }> }
): Promise<NextResponse> {
  try {
    const { projectId, sessionId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const validatedData = UpdateSessionSchema.parse(body);

    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const session = project.updateSession(sessionId, validatedData);
    if (!session) {
      return createErrorResponse('Session not found in this project', 404, {
        code: 'RESOURCE_NOT_FOUND',
      });
    }

    return createSuperjsonResponse({ session });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid request data', 400, {
        code: 'VALIDATION_FAILED',
        details: error.errors,
      });
    }

    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to update session',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; sessionId: string }> }
): Promise<NextResponse> {
  try {
    const { projectId, sessionId } = await params;
    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const success = project.deleteSession(sessionId);
    if (!success) {
      return createErrorResponse('Session not found in this project', 404, {
        code: 'RESOURCE_NOT_FOUND',
      });
    }

    return createSuperjsonResponse({ success: true });
  } catch (error: unknown) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to delete session',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}
