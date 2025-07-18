// ABOUTME: REST API endpoints for session configuration - GET, PUT for configuration management
// ABOUTME: Handles session configuration retrieval and updates with validation and inheritance

import { NextRequest, NextResponse } from 'next/server';
import { Session, Project } from '@/lib/server/lace-imports';
import { z } from 'zod';

const ConfigurationSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  maxTokens: z.number().positive().optional(),
  tools: z.array(z.string()).optional(),
  toolPolicies: z.record(z.enum(['allow', 'require-approval', 'deny'])).optional(),
  workingDirectory: z.string().optional(),
  environmentVariables: z.record(z.string()).optional(),
});

export function GET(request: NextRequest, { params }: { params: { sessionId: string } }) {
  try {
    const sessionData = Session.getSession(params.sessionId);

    if (!sessionData) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Calculate effective configuration (project + session overrides)
    const projectConfig = sessionData.projectId
      ? Project.getById(sessionData.projectId)?.getConfiguration() || {}
      : {};

    const sessionConfig = sessionData.configuration || {};

    // Merge configurations with session taking precedence
    const configuration = {
      ...projectConfig,
      ...sessionConfig,
    };

    // Merge toolPolicies separately to avoid overriding all policies
    if (projectConfig.toolPolicies || sessionConfig.toolPolicies) {
      configuration.toolPolicies = {
        ...((projectConfig.toolPolicies as Record<string, 'allow' | 'require-approval' | 'deny'>) || {}),
        ...((sessionConfig.toolPolicies as Record<string, 'allow' | 'require-approval' | 'deny'>) || {}),
      };
    }

    return NextResponse.json({ configuration });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch configuration' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: { params: { sessionId: string } }) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const validatedData = ConfigurationSchema.parse(body);

    const sessionData = Session.getSession(params.sessionId);

    if (!sessionData) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Update session configuration by merging with existing
    const currentConfig = sessionData.configuration || {};
    const newConfig = { ...currentConfig, ...validatedData };

    // Merge toolPolicies separately to avoid overriding all policies
    if (currentConfig.toolPolicies || validatedData.toolPolicies) {
      newConfig.toolPolicies = {
        ...((currentConfig.toolPolicies as Record<string, 'allow' | 'require-approval' | 'deny'>) || {}),
        ...((validatedData.toolPolicies as Record<string, 'allow' | 'require-approval' | 'deny'>) || {}),
      };
    }

    // Use static method to update session configuration
    // We'll need to use the database persistence directly
    const { getPersistence } = await import('~/persistence/database');
    const persistence = getPersistence();

    persistence.updateSession(params.sessionId, {
      configuration: newConfig,
      updatedAt: new Date(),
    });

    // Calculate effective configuration for response
    const projectConfig = sessionData.projectId
      ? Project.getById(sessionData.projectId)?.getConfiguration() || {}
      : {};

    const configuration = {
      ...projectConfig,
      ...newConfig,
    };

    // Merge toolPolicies for response
    if (projectConfig.toolPolicies || newConfig.toolPolicies) {
      configuration.toolPolicies = {
        ...((projectConfig.toolPolicies as Record<string, 'allow' | 'require-approval' | 'deny'>) || {}),
        ...((newConfig.toolPolicies as Record<string, 'allow' | 'require-approval' | 'deny'>) || {}),
      };
    }

    return NextResponse.json({ configuration });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update configuration' },
      { status: 500 }
    );
  }
}
