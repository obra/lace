// ABOUTME: Base class for all tools with schema-based validation
// ABOUTME: Provides automatic parameter validation and JSON schema generation

import { ZodType, ZodError } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { resolve, isAbsolute } from 'path';
import type { ToolResult, ToolContext, ToolInputSchema, ToolAnnotations } from '~/tools/types';

export abstract class Tool {
  abstract name: string;
  abstract description: string;
  abstract schema: ZodType;
  annotations?: ToolAnnotations;

  // Generate JSON Schema for AI providers
  get inputSchema(): ToolInputSchema {
    const jsonSchema = zodToJsonSchema(this.schema, {
      name: this.name,
      $refStrategy: 'none',
    });

    // Handle case where zodToJsonSchema returns a $ref structure
    if ('$ref' in jsonSchema && jsonSchema.$ref && jsonSchema.definitions) {
      const refKey = jsonSchema.$ref.replace('#/definitions/', '');
      const actualSchema = jsonSchema.definitions[refKey];

      // Validate the schema structure matches ToolInputSchema
      if (actualSchema && typeof actualSchema === 'object' && 'type' in actualSchema) {
        return actualSchema as ToolInputSchema;
      }

      throw new Error(`Invalid schema structure for tool ${this.name}`);
    }

    // Validate the schema structure matches ToolInputSchema
    if (jsonSchema && typeof jsonSchema === 'object' && 'type' in jsonSchema) {
      return jsonSchema as ToolInputSchema;
    }

    throw new Error(`Invalid schema structure for tool ${this.name}`);
  }

  // Public execute method that handles validation
  async execute(args: unknown, context?: ToolContext): Promise<ToolResult> {
    try {
      const validated = this.schema.parse(args) as ReturnType<this['schema']['parse']>;
      return await this.executeValidated(validated, context);
    } catch (error) {
      if (error instanceof ZodError) {
        return this.formatValidationError(error);
      }
      throw error;
    }
  }

  // Implement this in subclasses with validated args
  protected abstract executeValidated(
    args: ReturnType<this['schema']['parse']>,
    context?: ToolContext
  ): Promise<ToolResult>;

  // Output helpers for consistent result construction

  // Public API for creating results
  protected createResult(
    content: string | Record<string, unknown>,
    metadata?: Record<string, unknown>
  ): ToolResult {
    return this._makeResult({ content, metadata, isError: false });
  }

  protected createError(
    content: string | Record<string, unknown>,
    metadata?: Record<string, unknown>
  ): ToolResult {
    return this._makeResult({ content, metadata, isError: true });
  }

  // Path resolution helper for file operations
  protected resolvePath(path: string, context?: ToolContext): string {
    if (isAbsolute(path)) {
      return path;
    }

    const workingDir = context?.workingDirectory || process.cwd();
    return resolve(workingDir, path);
  }

  /**
   * Get tool temp directory provided by ToolExecutor
   * Throws error if ToolExecutor didn't provide temp directory
   */
  protected getToolTempDir(context?: ToolContext): string {
    if (!context?.toolTempDir) {
      throw new Error('Tool temp directory not provided by ToolExecutor. This is a system error.');
    }
    return context.toolTempDir;
  }

  // Private implementation
  private _makeResult(options: {
    content: string | Record<string, unknown>;
    metadata?: Record<string, unknown>;
    isError: boolean;
  }): ToolResult {
    const text =
      typeof options.content === 'string'
        ? options.content
        : JSON.stringify(options.content, null, 2);

    return {
      content: [{ type: 'text', text }],
      isError: options.isError,
      ...(options.metadata && { metadata: options.metadata }),
    };
  }

  private formatValidationError(error: ZodError): ToolResult {
    const issues = error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
        return `${path}: ${issue.message}`;
      })
      .join('; ');

    return {
      content: [
        {
          type: 'text',
          text: `Validation failed: ${issues}. Check parameter types and values.`,
        },
      ],
      isError: true,
    };
  }
}
