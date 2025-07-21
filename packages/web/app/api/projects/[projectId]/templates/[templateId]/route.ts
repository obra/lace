// ABOUTME: REST API endpoints for specific project prompt template - GET, PUT, DELETE operations
// ABOUTME: Uses Project class prompt template manager for business logic and validation

import { NextRequest, NextResponse } from 'next/server';
import { Project } from '@/lib/server/lace-imports';
import { z } from 'zod';

const RenderTemplateSchema = z.object({
  variables: z.record(z.string()),
});

function isError(error: unknown): error is Error {
  return error instanceof Error;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; templateId: string }> }
): Promise<NextResponse> {
  try {
    const { projectId, templateId } = await params;
    const project = Project.getById(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const template = project.getPromptTemplate(templateId);
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    return NextResponse.json({ template: template.toJSON() });
  } catch (error: unknown) {
    const errorMessage = isError(error) ? error.message : 'Failed to fetch template';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; templateId: string }> }
): Promise<NextResponse> {
  try {
    const { projectId, templateId } = await params;
    const project = Project.getById(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const success = project.deletePromptTemplate(templateId);
    if (!success) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const errorMessage = isError(error) ? error.message : 'Failed to delete template';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; templateId: string }> }
): Promise<NextResponse> {
  try {
    const { projectId, templateId } = await params;
    const project = Project.getById(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const body: unknown = await request.json();
    const validatedData = RenderTemplateSchema.parse(body);

    const renderedContent = project.renderPromptTemplate(templateId, validatedData.variables);

    return NextResponse.json({ renderedContent });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }

    const errorMessage = isError(error) ? error.message : 'Failed to render template';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}