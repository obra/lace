// ABOUTME: REST API endpoints for project token budget management - GET, PUT operations
// ABOUTME: Uses Project class token budget manager for business logic and monitoring

import { NextRequest, NextResponse } from 'next/server';
import { Project } from '@/lib/server/lace-imports';
import { createSuperjsonResponse } from '@/lib/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { z } from 'zod';

const TokenBudgetConfigSchema = z.object({
  maxTokens: z.number().positive(),
  warningThreshold: z.number().min(0).max(1).optional(),
  reserveTokens: z.number().min(0).optional(),
});

function isError(error: unknown): error is Error {
  return error instanceof Error;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<NextResponse> {
  try {
    const { projectId } = await params;
    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const tokenBudgetManager = project.getTokenBudgetManager();
    if (!tokenBudgetManager) {
      return createSuperjsonResponse(
        { error: 'Token budget not configured for this project' },
        { status: 404 }
      );
    }

    const budgetStatus = tokenBudgetManager.getBudgetStatus();
    const recommendations = tokenBudgetManager.getRecommendations();

    return createSuperjsonResponse({
      budgetStatus,
      recommendations,
    });
  } catch (error: unknown) {
    const errorMessage = isError(error) ? error.message : 'Failed to fetch token budget';
    return createErrorResponse(errorMessage, 500, { code: 'INTERNAL_SERVER_ERROR' });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<NextResponse> {
  try {
    const { projectId } = await params;
    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const body: unknown = await request.json();
    const validatedData = TokenBudgetConfigSchema.parse(body);

    const tokenBudgetManager = project.createTokenBudgetManager({
      maxTokens: validatedData.maxTokens,
      warningThreshold: validatedData.warningThreshold,
      reserveTokens: validatedData.reserveTokens,
    });

    const budgetStatus = tokenBudgetManager.getBudgetStatus();

    return createSuperjsonResponse({ budgetStatus });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid request data', 400, {
        code: 'VALIDATION_FAILED',
        details: error.errors,
      });
    }

    const errorMessage = isError(error) ? error.message : 'Failed to update token budget';
    return createErrorResponse(errorMessage, 500, { code: 'INTERNAL_SERVER_ERROR' });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<NextResponse> {
  try {
    const { projectId } = await params;
    const project = Project.getById(projectId);
    if (!project) {
      return createErrorResponse('Project not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    project.setTokenBudgetManager(null);

    return createSuperjsonResponse({ success: true });
  } catch (error: unknown) {
    const errorMessage = isError(error) ? error.message : 'Failed to remove token budget';
    return createErrorResponse(errorMessage, 500, { code: 'INTERNAL_SERVER_ERROR' });
  }
}
