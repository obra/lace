// ABOUTME: Tool system type definitions and interfaces
// ABOUTME: Model-agnostic tool definitions compatible with multiple AI SDKs and MCP

import type { Agent } from '~/agents/agent';
import type { CombinedTokenUsage } from '~/token-management/types';

export interface ToolContext {
  // Execution control - required for cancellation
  signal: AbortSignal;

  // Working directory for file operations
  workingDirectory?: string;

  // Temp directory management - provided by ToolExecutor
  toolTempDir?: string; // Tool-specific temp directory for bash output

  // Agent reference - provides access to threadId, session, and other context
  agent?: Agent;

  // Environment variables for subprocess execution
  processEnv?: NodeJS.ProcessEnv;
}

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  safeInternal?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>; // MCP uses "arguments"
}

// Note: Tool class is now defined in ./tool.ts
// This ensures all tools use schema-based validation

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, ToolProperty>;
  required: string[];
  [k: string]: unknown;
}

export interface ToolProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: ToolProperty;
}

export interface ContentBlock {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  uri?: string;
}

export type ToolResultStatus = 'completed' | 'failed' | 'aborted' | 'denied';

export interface ToolResult {
  id?: string; // Optional - set by tools if they have it
  content: ContentBlock[];
  status: ToolResultStatus;
  metadata?: Record<string, unknown>; // For delegation threadId, etc.
  tokenUsage?: CombinedTokenUsage;
}

// Helper to check if a result indicates an error
export function isToolError(result: ToolResult): boolean {
  return result.status !== 'completed';
}

export function createToolResult(
  status: ToolResultStatus,
  content: ContentBlock[],
  id?: string,
  metadata?: Record<string, unknown>
): ToolResult {
  return {
    content,
    status,
    ...(id && { id }),
    ...(metadata && { metadata }),
  };
}

export function createSuccessResult(
  content: ContentBlock[],
  id?: string,
  metadata?: Record<string, unknown>
): ToolResult {
  return createToolResult('completed', content, id, metadata);
}

export function createErrorResult(
  input: string | ContentBlock[],
  id?: string,
  metadata?: Record<string, unknown>
): ToolResult {
  if (typeof input === 'string') {
    return createToolResult('failed', [{ type: 'text', text: input }], id, metadata);
  }
  return createToolResult('failed', input, id, metadata);
}
