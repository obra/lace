// ABOUTME: Special tool dispatcher - routes special tools to their handlers
// Special tools bypass normal tool execution and need runtime state access

import { executeDelegate, type DelegateInput } from './delegate';
import { executeJobOutput, executeJobsList, executeJobKill } from './job-tools';
import type { SpecialToolContext, SpecialToolResult } from './types';

export type { SpecialToolContext, SpecialToolResult, JobState, JobRecord } from './types';

const SPECIAL_TOOLS = new Set(['delegate', 'job_output', 'jobs_list', 'job_kill']);

/**
 * Check if a tool name is a special tool that needs runtime handling
 */
export function isSpecialTool(toolName: string): boolean {
  return SPECIAL_TOOLS.has(toolName);
}

/**
 * Execute a special tool with the given context
 */
export async function executeSpecialTool(
  toolName: string,
  input: Record<string, unknown>,
  context: SpecialToolContext
): Promise<SpecialToolResult> {
  switch (toolName) {
    case 'delegate':
      return executeDelegate(input as DelegateInput, context);

    case 'job_output':
      return executeJobOutput(
        input as { jobId?: string; block?: boolean; timeoutMs?: number; byteOffset?: number },
        context
      );

    case 'jobs_list':
      return executeJobsList(
        input as { status?: string[]; type?: string[]; limit?: number },
        context
      );

    case 'job_kill':
      return executeJobKill(input as { jobId?: string }, context);

    default:
      return {
        status: 'failed',
        content: [{ type: 'text', text: `Unknown special tool: ${toolName}` }],
      };
  }
}
