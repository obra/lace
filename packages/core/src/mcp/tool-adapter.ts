// ABOUTME: Adapter that wraps MCP tools to integrate with Lace's Tool base class
// ABOUTME: Uses MCP SDK client for tool execution, converts schemas from JSON to Zod

import { z, ZodType } from 'zod';
import { Tool } from '~/tools/tool';
import type { ToolResult, ToolContext, ContentBlock } from '~/tools/types';
import type { Client } from '../../../vendor/typescript-sdk/src/client/index.js';
import type { MCPTool } from './types';

/**
 * Converts MCP JSON Schema to Zod schema
 * Simplified converter - handles basic types needed for MCP tools
 */
function jsonSchemaToZod(schema: any): ZodType {
  if (schema.type === 'object') {
    const shape: Record<string, ZodType> = {};

    for (const [key, prop] of Object.entries(schema.properties || {})) {
      const propSchema = prop as any;

      let zodType: ZodType;

      if (propSchema.type === 'string') {
        zodType = z.string();
      } else if (propSchema.type === 'number') {
        zodType = z.number();
      } else if (propSchema.type === 'integer') {
        zodType = z.number().int();
      } else if (propSchema.type === 'boolean') {
        zodType = z.boolean();
      } else if (propSchema.type === 'array') {
        const itemType = propSchema.items ? jsonSchemaToZod(propSchema.items) : z.unknown();
        zodType = z.array(itemType);
      } else {
        // Fallback for complex types
        zodType = z.unknown();
      }

      // Add description if present
      if (propSchema.description) {
        zodType = zodType.describe(propSchema.description);
      }

      // Handle required fields
      if (!schema.required?.includes(key)) {
        zodType = zodType.optional();
      }

      shape[key] = zodType;
    }

    return z.object(shape);
  }

  // Fallback for non-object schemas
  return z.unknown();
}

export class MCPToolAdapter extends Tool {
  name: string;
  description: string;
  schema: ZodType;

  constructor(
    private mcpTool: MCPTool,
    private serverId: string,
    private client: Client
  ) {
    super();
    this.name = `${serverId}/${mcpTool.name}`;
    this.description = mcpTool.description || `MCP tool: ${mcpTool.name}`;
    this.schema = jsonSchemaToZod(mcpTool.inputSchema);
  }

  protected async executeValidated(
    args: Record<string, unknown>,
    context?: ToolContext
  ): Promise<ToolResult> {
    try {
      // Use MCP SDK's high-level callTool method
      const result = await this.client.callTool({
        name: this.mcpTool.name,
        arguments: args,
      });

      // Convert MCP result to Lace ToolResult format
      if (result.isError) {
        return this.createError(
          `MCP tool error: ${result.content.map((c) => c.text || '').join(' ')}`,
          { toolName: this.mcpTool.name }
        );
      }

      // Convert MCP content blocks to Lace format
      const content: ContentBlock[] = result.content.map((block) => {
        if (block.type === 'text') {
          return { type: 'text' as const, text: block.text || '' };
        } else if (block.type === 'image') {
          return {
            type: 'image' as const,
            data: block.data,
          };
        } else if (block.type === 'resource') {
          return {
            type: 'resource' as const,
            uri: block.resource?.uri,
          };
        } else {
          // Fallback for unknown content types
          return {
            type: 'text' as const,
            text: JSON.stringify(block),
          };
        }
      });

      return {
        content,
        status: 'completed',
        metadata: {
          toolName: this.mcpTool.name,
          serverId: this.serverId,
        },
      };
    } catch (error) {
      return this.createError(
        `Failed to execute MCP tool: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { toolName: this.mcpTool.name, serverId: this.serverId }
      );
    }
  }
}
