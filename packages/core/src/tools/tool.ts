// ABOUTME: Base class for all tools with schema-based validation
// ABOUTME: Provides automatic parameter validation and JSON schema generation

import { ZodType, ZodError } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { resolve, isAbsolute, relative, normalize, sep } from 'path';
import type {
  ToolResult,
  ToolContext,
  ToolInputSchema,
  ToolAnnotations,
  ToolResultStatus,
} from './types';
import { logger } from '@lace/core/utils/logger';

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
  async execute(args: unknown, context: ToolContext): Promise<ToolResult> {
    try {
      const validated = this.schema.parse(args) as ReturnType<this['schema']['parse']>;
      return await this.executeValidated(validated, context);
    } catch (error) {
      if (error instanceof ZodError) {
        return this.formatValidationError(error, args);
      }
      throw error;
    }
  }

  // Implement this in subclasses with validated args
  protected abstract executeValidated(
    args: ReturnType<this['schema']['parse']>,
    context: ToolContext
  ): Promise<ToolResult>;

  // Output helpers for consistent result construction

  // Public API for creating results
  protected createResult(
    content: string | Record<string, unknown>,
    metadata?: Record<string, unknown>
  ): ToolResult {
    return this._makeResult({ content, metadata, status: 'completed' });
  }

  protected createError(
    content: string | Record<string, unknown>,
    metadata?: Record<string, unknown>
  ): ToolResult {
    return this._makeResult({ content, metadata, status: 'failed' });
  }

  protected createCancellationResult(
    partialOutput?: string,
    metadata?: Record<string, unknown>
  ): ToolResult {
    const message = partialOutput
      ? `Tool execution cancelled by user.\n\nPartial output:\n${partialOutput}`
      : 'Tool execution cancelled by user.';

    return this._makeResult({
      content: message,
      metadata,
      status: 'aborted',
    });
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
   * Resolve a path with workspace support.
   * When using workspace (container or local mode), this adjusts paths to work with the workspace.
   * File tools execute on the host, so they need to access files in the clone directory.
   */
  protected resolveWorkspacePath(path: string, context?: ToolContext): string {
    // Get workspace info from context (populated by ToolExecutor)
    const workspaceInfo = context?.workspaceInfo;

    if (!workspaceInfo) {
      // No workspace, use standard path resolution
      return this.resolvePath(path, context);
    }

    // Normalize all paths to prevent path traversal attacks
    const normalizedInput = normalize(path);
    const normalizedProjectDir = normalize(workspaceInfo.projectDir);
    const normalizedClonePath = normalize(workspaceInfo.clonePath);

    // When using a workspace, we need to resolve paths relative to the clone directory
    // because file tools execute on the host and need to access the actual files
    if (isAbsolute(normalizedInput)) {
      // For absolute paths, use path.relative to check containment and get relative position
      const relativeToProject = relative(normalizedProjectDir, normalizedInput);

      // Check if path is outside project (starts with '..' or is absolute after relative())
      if (relativeToProject.startsWith('..' + sep) || isAbsolute(relativeToProject)) {
        // Path is outside project directory - this is a security violation
        logger.warn('Attempted access to path outside workspace', {
          original: path,
          projectDir: workspaceInfo.projectDir,
          relativePath: relativeToProject,
        });
        throw new Error(
          `Access denied: Path "${path}" is outside the workspace directory "${workspaceInfo.projectDir}"`
        );
      }

      // Path is within project - map to clone directory using relative path
      const clonedPath = resolve(normalizedClonePath, relativeToProject);

      // Verify the final path is contained within the clone directory
      const relativeToClone = relative(normalizedClonePath, clonedPath);
      if (relativeToClone.startsWith('..' + sep) || isAbsolute(relativeToClone)) {
        logger.error('Path traversal detected after translation', {
          original: path,
          clonedPath,
          clonePath: workspaceInfo.clonePath,
        });
        throw new Error(`Security violation: Path traversal detected in "${path}"`);
      }

      logger.debug('Translated absolute path to clone directory', {
        original: path,
        cloned: clonedPath,
        projectDir: workspaceInfo.projectDir,
        clonePath: workspaceInfo.clonePath,
      });

      return clonedPath;
    }

    // For relative paths, resolve against the clone directory
    const resolvedPath = resolve(normalizedClonePath, normalizedInput);

    // Verify the resolved path is contained within the clone directory
    const relativeToClone = relative(normalizedClonePath, resolvedPath);
    if (relativeToClone.startsWith('..' + sep) || isAbsolute(relativeToClone)) {
      logger.warn('Relative path escaped workspace', {
        relativePath: path,
        resolvedPath,
        clonePath: workspaceInfo.clonePath,
      });
      throw new Error(
        `Access denied: Path "${path}" resolves outside the workspace directory "${workspaceInfo.clonePath}"`
      );
    }

    logger.debug('Resolved relative path in workspace', {
      relativePath: path,
      workingDir: workspaceInfo.clonePath,
      resolved: resolvedPath,
    });

    return resolvedPath;
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

  /**
   * Check if a file exists and requires read-before-write protection.
   * Returns an error result if the file exists but hasn't been read.
   * Returns null if the check passes (file doesn't exist or was read).
   */
  protected async checkFileReadProtection(
    filePath: string,
    resolvedPath: string,
    context?: ToolContext
  ): Promise<ToolResult | null> {
    // Try to check if file exists
    try {
      const { stat } = await import('fs/promises');
      await stat(resolvedPath);

      // File exists - check if it was read
      if (!context?.agent) {
        // No agent context - this is likely a test environment or direct tool call
        // Skip read protection for unit tests, but log a warning
        if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
          return this.createError(
            'Tool context missing agent reference. This is a system error - please report it.'
          );
        }
        // In test environment, skip the read protection check
        return null;
      }

      if (!context.agent.hasFileBeenRead(resolvedPath)) {
        return this.createError(
          `File ${filePath} exists but hasn't been read in this conversation. ` +
            `Use file_read to examine the current contents before modifying.`
        );
      }
    } catch {
      // File doesn't exist, safe to create/write
    }

    return null; // Check passed
  }

  // Private implementation
  private _makeResult(options: {
    content: string | Record<string, unknown>;
    metadata?: Record<string, unknown>;
    status: ToolResultStatus;
  }): ToolResult {
    const text =
      typeof options.content === 'string'
        ? options.content
        : JSON.stringify(options.content, null, 2);

    return {
      content: [{ type: 'text', text }],
      status: options.status,
      ...(options.metadata && { metadata: options.metadata }),
    };
  }

  private formatValidationError(error: ZodError, _args?: unknown): ToolResult {
    const issues: string[] = [];
    const missingParams: string[] = [];
    const typeErrors: string[] = [];
    const unexpectedParams: string[] = [];

    // Categorize errors
    for (const issue of error.issues) {
      const path = issue.path.join('.') || 'root';

      if (issue.code === 'invalid_type') {
        if (issue.received === 'undefined') {
          missingParams.push(path);
        } else {
          typeErrors.push(`${path}: Expected ${issue.expected}, got ${issue.received}`);
        }
      } else if (issue.message === 'Required') {
        missingParams.push(path);
      } else if (issue.code === 'unrecognized_keys') {
        // Handle strict mode errors - Zod provides the unexpected keys
        const zodIssue = issue as { keys: string[] };
        unexpectedParams.push(...zodIssue.keys);
      } else {
        issues.push(`${path}: ${issue.message}`);
      }
    }

    // Build concise error message
    const errorParts: string[] = [`ValidationError: ${this.name} failed`];

    if (missingParams.length > 0) {
      errorParts.push(`Missing required: ${missingParams.join(', ')}`);
    }

    if (unexpectedParams.length > 0) {
      errorParts.push(`Unexpected parameters: ${unexpectedParams.join(', ')}`);
    }

    if (typeErrors.length > 0) {
      errorParts.push(...typeErrors);
    }

    if (issues.length > 0) {
      errorParts.push(...issues);
    }

    const text = errorParts.join('\n');

    return {
      content: [{ type: 'text', text }],
      status: 'failed',
    };
  }
}
