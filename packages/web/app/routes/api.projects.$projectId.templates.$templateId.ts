// ABOUTME: REST API endpoints for specific project prompt template - GET, PUT, DELETE operations
// ABOUTME: Uses Project class prompt template manager for business logic and validation

import type { Route } from './+types/api.projects.$projectId.templates.$templateId';
import { Project } from '@/lib/server/lace-imports';
import { z } from 'zod';

const RouteParamsSchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
  templateId: z.string().min(1, 'templateId is required'),
});

const RenderTemplateSchema = z.object({
  variables: z.record(z.string()),
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

    const { projectId, templateId } = validationResult.data;
    const project = Project.getById(projectId);
    if (!project) {
      return Response.json(
        { error: 'Project not found', code: 'RESOURCE_NOT_FOUND' },
        { status: 404 }
      );
    }

    const template = project.getPromptTemplate(templateId);
    if (!template) {
      return Response.json(
        { error: 'Template not found', code: 'RESOURCE_NOT_FOUND' },
        { status: 404 }
      );
    }

    return Response.json({ template: template.toJSON() });
  } catch (error: unknown) {
    const errorMessage = isError(error) ? error.message : 'Failed to fetch template';
    return Response.json({ error: errorMessage, code: 'INTERNAL_SERVER_ERROR' }, { status: 500 });
  }
}

export async function action({ request, params }: Route.ActionArgs): Promise<Response> {
  const method = request.method;

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

  const { projectId, templateId } = validationResult.data;

  if (method === 'DELETE') {
    try {
      const project = Project.getById(projectId);
      if (!project) {
        return Response.json(
          { error: 'Project not found', code: 'RESOURCE_NOT_FOUND' },
          { status: 404 }
        );
      }

      const success = project.deletePromptTemplate(templateId);
      if (!success) {
        return Response.json(
          { error: 'Template not found', code: 'RESOURCE_NOT_FOUND' },
          { status: 404 }
        );
      }

      return Response.json({ success: true });
    } catch (error: unknown) {
      const errorMessage = isError(error) ? error.message : 'Failed to delete template';
      return Response.json({ error: errorMessage, code: 'INTERNAL_SERVER_ERROR' }, { status: 500 });
    }
  } else if (method === 'POST') {
    try {
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
        return Response.json({ error: 'Invalid JSON', code: 'VALIDATION_FAILED' }, { status: 400 });
      }
      const validatedData = RenderTemplateSchema.parse(body);

      const renderedContent = project.renderPromptTemplate(templateId, validatedData.variables);

      return Response.json({ renderedContent });
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return Response.json(
          { error: 'Invalid request data', details: error.errors },
          { status: 400 }
        );
      }

      const errorMessage = isError(error) ? error.message : 'Failed to render template';
      return Response.json({ error: errorMessage, code: 'INTERNAL_SERVER_ERROR' }, { status: 500 });
    }
  } else {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }
}
