// ABOUTME: Tool system type definitions and interfaces
// ABOUTME: Model-agnostic tool definitions compatible with multiple AI SDKs and MCP

export interface ToolContext {
  threadId?: string;
}

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface Tool {
  name: string;
  description: string;
  input_schema: ToolInputSchema;
  annotations?: ToolAnnotations;
  executeTool(input: Record<string, unknown>, context?: ToolContext): Promise<ToolResult>;
}

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
  content: ContentBlock[];
  isError: boolean;
}

export function createToolResult(isError: boolean, content: ContentBlock[]): ToolResult {
  return {
    content,
    isError,
  };
}

export function createSuccessResult(content: ContentBlock[]): ToolResult {
  return createToolResult(false, content);
}

export function createErrorResult(input: string | ContentBlock[]): ToolResult {
  if (typeof input === 'string') {
    return createToolResult(true, [{ type: 'text', text: input }]);
  }
  return createToolResult(true, input);
}
