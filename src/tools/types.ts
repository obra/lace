// ABOUTME: Tool system type definitions and interfaces
// ABOUTME: Model-agnostic tool definitions compatible with multiple AI SDKs and MCP

import { ThreadId } from '~/threads/types';

export interface ToolContext {
  threadId?: ThreadId;
  // Add for multi-agent support:
  parentThreadId?: ThreadId; // Parent thread (session)
  // Working directory for file operations
  workingDirectory?: string;
  // Session information for policy enforcement
  sessionId?: string;
  projectId?: string;
  session?: import('~/sessions/session').Session;
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

export interface ToolResult {
  id?: string; // Optional - set by tools if they have it
  content: ContentBlock[];
  isError: boolean; // Keep required (clearer than MCP's optional)
  isPending?: boolean; // New field - indicates approval is pending
  metadata?: Record<string, unknown>; // For delegation threadId, etc.
}

export function createToolResult(
  isError: boolean,
  content: ContentBlock[],
  id?: string,
  metadata?: Record<string, unknown>
): ToolResult {
  return {
    content,
    isError,
    ...(id && { id }),
    ...(metadata && { metadata }),
  };
}

export function createSuccessResult(
  content: ContentBlock[],
  id?: string,
  metadata?: Record<string, unknown>
): ToolResult {
  return createToolResult(false, content, id, metadata);
}

export function createErrorResult(
  input: string | ContentBlock[],
  id?: string,
  metadata?: Record<string, unknown>
): ToolResult {
  if (typeof input === 'string') {
    return createToolResult(true, [{ type: 'text', text: input }], id, metadata);
  }
  return createToolResult(true, input, id, metadata);
}

export function createPendingResult(
  message: string,
  toolCallId?: string,
  metadata?: Record<string, unknown>
): ToolResult {
  return {
    id: toolCallId,
    isError: false,
    isPending: true,
    content: [{ type: 'text', text: message }],
    metadata,
  };
}
