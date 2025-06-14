// ABOUTME: Tool system type definitions and interfaces
// ABOUTME: Model-agnostic tool definitions compatible with multiple AI SDKs

export interface Tool {
  name: string;
  description: string;
  input_schema: ToolInputSchema;
  executeTool(input: Record<string, unknown>): Promise<ToolResult>;
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
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}
