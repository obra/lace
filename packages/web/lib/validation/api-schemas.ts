// ABOUTME: Zod schemas for transforming core types to API response types
// ABOUTME: Handles Date to string conversion for JSON serialization

import { z } from 'zod';
import type { SessionInfo, ProjectInfo, ThreadId } from '@/types/core';
import type { ApiSession, ApiProject } from '@/types/api';

// Transform Date to ISO string for API responses
const dateToString = z.date().transform((date) => date.toISOString());

// Schema to transform core SessionInfo to API Session type
export const sessionTransformSchema = z.object({
  id: z.custom<ThreadId>().transform((id) => id as string),
  name: z.string(),
  createdAt: dateToString,
  // Skip provider and model at session level - they're on the agents
  agents: z
    .array(
      z.object({
        threadId: z.custom<ThreadId>().transform((id) => id as string),
        name: z.string(),
        provider: z.string(),
        model: z.string(),
        status: z.custom<AgentState>(),
      })
    )
    .transform((agents) =>
      agents.map((agent) => ({
        ...agent,
        createdAt: new Date().toISOString(), // Agent createdAt not in core type
      }))
    ),
});

// Schema to transform core ProjectInfo to API ProjectInfo type
export const projectTransformSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  workingDirectory: z.string(),
  isArchived: z.boolean(),
  createdAt: z.union([dateToString, z.string()]),
  lastUsedAt: z.union([dateToString, z.string()]),
});

// Helper functions to transform and validate
export function transformSessionInfo(sessionInfo: SessionInfo): ApiSession {
  const base = sessionTransformSchema.parse(sessionInfo);
  return {
    ...base,
    agentCount: base.agents?.length,
  };
}

export function transformProjectInfo(projectInfo: ProjectInfo): ApiProject {
  const base = projectTransformSchema.parse(projectInfo);
  return {
    ...base,
    sessionCount: undefined, // This would come from a separate query
  };
}
