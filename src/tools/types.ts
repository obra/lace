// ABOUTME: Tool system type definitions and interfaces
// ABOUTME: Model-agnostic tool definitions compatible with multiple AI SDKs and MCP

export interface ToolContext {
  threadId?: string;
}

export interface Tool {
  name: string;
  description: string;
  input_schema: ToolInputSchema;
  destructive?: boolean;
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
  success: boolean;
  content: ContentBlock[];
  error?: string;
}
