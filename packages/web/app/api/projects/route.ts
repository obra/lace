// ABOUTME: REST API endpoints for project management - GET all projects, POST new project
// ABOUTME: Uses Project class for business logic and validation with proper error handling

import { NextRequest, NextResponse } from 'next/server';
import { Project } from '@/lib/server/lace-imports';
import { z } from 'zod';

const CreateProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required'),
  description: z.string().optional(),
  workingDirectory: z.string().min(1, 'Working directory is required'),
  configuration: z.record(z.unknown()).optional(),
});

export async function GET() {
  try {
    const projects = Project.getAll();

    return NextResponse.json({ projects });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const validatedData = CreateProjectSchema.parse(body);

    const project = Project.create(
      validatedData.name,
      validatedData.workingDirectory,
      validatedData.description || '',
      validatedData.configuration || {}
    );

    const projectInfo = project.getInfo();

    return NextResponse.json({ project: projectInfo }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create project' },
      { status: 500 }
    );
  }
}
