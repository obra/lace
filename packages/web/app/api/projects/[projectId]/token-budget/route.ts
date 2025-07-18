// ABOUTME: REST API endpoints for project token budget management - GET, PUT operations
// ABOUTME: Uses Project class token budget manager for business logic and monitoring

import { NextRequest, NextResponse } from 'next/server';
import { Project } from '@/lib/server/lace-imports';
import { z } from 'zod';

const TokenBudgetConfigSchema = z.object({
  maxTokens: z.number().positive(),
  warningThreshold: z.number().min(0).max(1).optional(),
  reserveTokens: z.number().min(0).optional(),
});

function isError(error: unknown): error is Error {
  return error instanceof Error;
}

export function GET(
  _request: NextRequest,
  { params }: { params: { projectId: string } }
): NextResponse {
  try {
    const project = Project.getById(params.projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const tokenBudgetManager = project.getTokenBudgetManager();
    if (!tokenBudgetManager) {
      return NextResponse.json(
        { error: 'Token budget not configured for this project' },
        { status: 404 }
      );
    }

    const budgetStatus = tokenBudgetManager.getBudgetStatus();
    const recommendations = tokenBudgetManager.getRecommendations();

    return NextResponse.json({
      budgetStatus,
      recommendations,
    });
  } catch (error: unknown) {
    const errorMessage = isError(error) ? error.message : 'Failed to fetch token budget';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { projectId: string } }
): Promise<NextResponse> {
  try {
    const project = Project.getById(params.projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const body: unknown = await request.json();
    const validatedData = TokenBudgetConfigSchema.parse(body);

    const tokenBudgetManager = project.createTokenBudgetManager({
      maxTokens: validatedData.maxTokens,
      warningThreshold: validatedData.warningThreshold,
      reserveTokens: validatedData.reserveTokens,
    });

    const budgetStatus = tokenBudgetManager.getBudgetStatus();

    return NextResponse.json({ budgetStatus });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }

    const errorMessage = isError(error) ? error.message : 'Failed to update token budget';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export function DELETE(
  _request: NextRequest,
  { params }: { params: { projectId: string } }
): NextResponse {
  try {
    const project = Project.getById(params.projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    project.setTokenBudgetManager(null);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const errorMessage = isError(error) ? error.message : 'Failed to remove token budget';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
