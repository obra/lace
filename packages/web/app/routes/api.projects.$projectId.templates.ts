// ABOUTME: REST API endpoints for project prompt templates - GET all templates, POST new template
// ABOUTME: Uses Project class prompt template manager for business logic and validation

import type { Route } from './+types/api.projects.$projectId.templates';
import { Project } from '@/lib/server/lace-imports';
import { z } from 'zod';

const RouteParamsSchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
});

const CreateTemplateSchema = z.object({
  id: z.string().min(1, 'Template ID is required'),
  name: z.string().min(1, 'Template name is required'),
  description: z.string().optional(),
  content: z.string().min(1, 'Template content is required'),
  variables: z.array(z.string()).optional(),
  parentTemplateId: z.string().optional(),
  isDefault: z.boolean().optional(),
});

function isError(error: unknown): error is Error {
  return error instanceof Error;
}

export async function loader({ params }: Route.LoaderArgs): Promise<Response> {
  try {
    // Validate params
    const validationResult = RouteParamsSchema.safeParse(params);
    if (!validationResult.success) {
      return Response.json(
        {
          error: 'Invalid route parameters',
          code: 'VALIDATION_FAILED',
          details: validationResult.error.errors,
        },
        { status: 400 }
      );
    }

    const { projectId } = validationResult.data;
    const project = Project.getById(projectId);
    if (!project) {
      return Response.json(
        { error: 'Project not found', code: 'RESOURCE_NOT_FOUND' },
        { status: 404 }
      );
    }

    const templates = project.getAllPromptTemplates();

    return Response.json({ templates });
  } catch (error: unknown) {
    const errorMessage = isError(error) ? error.message : 'Failed to fetch templates';
    return Response.json({ error: errorMessage, code: 'INTERNAL_SERVER_ERROR' }, { status: 500 });
  }
}

export async function action({ request, params }: Route.ActionArgs): Promise<Response> {
  // Add method guard
  if (request.method !== 'POST') {
    return Response.json(
      { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' },
      { status: 405 }
    );
  }

  try {
    // Validate params
    const validationResult = RouteParamsSchema.safeParse(params);
    if (!validationResult.success) {
      return Response.json(
        {
          error: 'Invalid route parameters',
          code: 'VALIDATION_FAILED',
          details: validationResult.error.errors,
        },
        { status: 400 }
      );
    }

    const { projectId } = validationResult.data;
    const project = Project.getById(projectId);
    if (!project) {
      return Response.json(
        { error: 'Project not found', code: 'RESOURCE_NOT_FOUND' },
        { status: 404 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: 'Invalid JSON body', code: 'VALIDATION_FAILED' },
        { status: 400 }
      );
    }
    const validatedData = CreateTemplateSchema.parse(body);

    const template = project.createPromptTemplate({
      id: validatedData.id,
      name: validatedData.name,
      description: validatedData.description,
      content: validatedData.content,
      variables: validatedData.variables,
      parentTemplateId: validatedData.parentTemplateId,
      isDefault: validatedData.isDefault,
    });

    return Response.json({ template: template.toJSON() }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return Response.json(
        {
          error: 'Invalid request data',
          code: 'VALIDATION_FAILED',
          details: error.errors,
        },
        { status: 400 }
      );
    }

    const errorMessage = isError(error) ? error.message : 'Failed to create template';
    return Response.json({ error: errorMessage, code: 'INTERNAL_SERVER_ERROR' }, { status: 500 });
  }
}
