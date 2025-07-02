// ABOUTME: Abstract base class for all tools with shared functionality
// ABOUTME: Provides parameter validation, error handling, and file system utilities

import { access, readFile, stat } from 'fs/promises';
import {
  Tool,
  ToolCall,
  ToolResult,
  ToolContext,
  ToolInputSchema,
  ContentBlock,
  createSuccessResult,
  createErrorResult,
} from './types.js';

/**
 * Custom error class for validation errors that should be returned as ToolResults
 */
export class ValidationError extends Error {
  constructor(public toolResult: ToolResult) {
    super('Validation error');
    this.name = 'ValidationError';
  }
}

/**
 * Base class for all tools providing shared functionality and standardized error handling
 */
export abstract class BaseTool implements Tool {
  abstract name: string;
  abstract description: string;
  abstract inputSchema: ToolInputSchema;
  abstract annotations?: Record<string, unknown>;

  abstract executeTool(call: ToolCall, context?: ToolContext): Promise<ToolResult>;

  // Parameter Validation Methods

  /**
   * Validates that a parameter is a string
   */
  protected validateStringParam(value: unknown, paramName: string, callId?: string): string {
    if (value === undefined || value === null) {
      const error = this.createValidationError(
        paramName,
        'string',
        'Parameter is required',
        callId
      );
      throw new ValidationError(error);
    }
    if (typeof value !== 'string') {
      const error = this.createValidationError(
        paramName,
        'string',
        `Received ${typeof value}`,
        callId
      );
      throw new ValidationError(error);
    }
    return value;
  }

  /**
   * Validates that a parameter is a non-empty string
   */
  protected validateNonEmptyStringParam(
    value: unknown,
    paramName: string,
    callId?: string
  ): string {
    const str = this.validateStringParam(value, paramName, callId);
    if (str.trim() === '') {
      const error = this.createValidationError(
        paramName,
        'non-empty string',
        'Parameter cannot be empty',
        callId
      );
      throw new ValidationError(error);
    }
    return str;
  }

  /**
   * Validates that a parameter is a number within optional bounds
   */
  protected validateNumberParam(
    value: unknown,
    paramName: string,
    callId?: string,
    options?: { min?: number; max?: number; integer?: boolean }
  ): number {
    if (value === undefined || value === null) {
      const error = this.createValidationError(
        paramName,
        'number',
        'Parameter is required',
        callId
      );
      throw new ValidationError(error);
    }
    if (typeof value !== 'number' || isNaN(value)) {
      const error = this.createValidationError(
        paramName,
        'number',
        `Received ${typeof value}`,
        callId
      );
      throw new ValidationError(error);
    }

    if (options?.integer && !Number.isInteger(value)) {
      const error = this.createValidationError(
        paramName,
        'integer',
        `Received decimal number ${value}`,
        callId
      );
      throw new ValidationError(error);
    }

    if (options?.min !== undefined && options?.max !== undefined) {
      if (value < options.min || value > options.max) {
        const error = this.createValidationError(
          paramName,
          'valid',
          `Value outside allowed range`,
          callId,
          `Use a value between ${options.min} and ${options.max}`
        );
        throw new ValidationError(error);
      }
    } else if (options?.min !== undefined && value < options.min) {
      const error = this.createValidationError(
        paramName,
        'valid',
        `Value too small`,
        callId,
        `Use a value >= ${options.min}`
      );
      throw new ValidationError(error);
    } else if (options?.max !== undefined && value > options.max) {
      const error = this.createValidationError(
        paramName,
        'valid',
        `Value too large`,
        callId,
        `Use a value <= ${options.max}`
      );
      throw new ValidationError(error);
    }

    return value;
  }

  /**
   * Validates that a parameter is a boolean
   */
  protected validateBooleanParam(value: unknown, paramName: string, callId?: string): boolean {
    if (value === undefined || value === null) {
      const error = this.createValidationError(
        paramName,
        'boolean',
        'Parameter is required',
        callId
      );
      throw new ValidationError(error);
    }
    if (typeof value !== 'boolean') {
      const error = this.createValidationError(
        paramName,
        'boolean',
        `Received ${typeof value}`,
        callId
      );
      throw new ValidationError(error);
    }
    return value;
  }

  /**
   * Validates that a parameter is one of the allowed enum values
   */
  protected validateEnumParam<T extends string>(
    value: unknown,
    paramName: string,
    allowedValues: readonly T[],
    callId?: string
  ): T {
    if (value === undefined || value === null) {
      const error = this.createValidationError(
        paramName,
        'string',
        'Parameter is required',
        callId
      );
      throw new ValidationError(error);
    }
    if (typeof value !== 'string') {
      const error = this.createValidationError(
        paramName,
        'string',
        `Received ${typeof value}`,
        callId
      );
      throw new ValidationError(error);
    }
    if (!allowedValues.includes(value as T)) {
      const error = this.createValidationError(
        paramName,
        'valid value',
        `Received ${value}`,
        callId,
        `Must be one of: ${allowedValues.join(', ')}`
      );
      throw new ValidationError(error);
    }
    return value as T;
  }

  /**
   * Validates an optional parameter using a custom validator
   */
  protected validateOptionalParam<T>(
    value: unknown,
    paramName: string,
    validator: (v: unknown) => T,
    callId?: string
  ): T | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    try {
      return validator(value);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Validation failed';
      const error = this.createValidationError(paramName, 'valid value', message, callId);
      throw new ValidationError(error);
    }
  }

  // File System Utilities

  /**
   * Validates that a file exists and is accessible
   */
  protected async validateFileExists(filePath: string, callId?: string): Promise<void> {
    try {
      await access(filePath);
      const stats = await stat(filePath);
      if (!stats.isFile()) {
        const error = this.createFileSystemError(
          'file_not_found',
          filePath,
          'Path exists but is not a file',
          'Specify a valid file path',
          callId
        );
        throw new ValidationError(error);
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        const fsError = this.createFileSystemError(
          'file_not_found',
          filePath,
          'File does not exist',
          'Check the file path and ensure the file exists',
          callId
        );
        throw new ValidationError(fsError);
      }
      throw error;
    }
  }

  /**
   * Validates that a directory exists and is accessible
   */
  protected async validateDirectoryExists(dirPath: string, callId?: string): Promise<void> {
    try {
      await access(dirPath);
      const stats = await stat(dirPath);
      if (!stats.isDirectory()) {
        throw this.createFileSystemError(
          'not_directory',
          dirPath,
          'Path exists but is not a directory',
          'Specify a valid directory path',
          callId
        );
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw this.createFileSystemError(
          'directory_not_found',
          dirPath,
          'Directory does not exist',
          'Check the directory path and ensure it exists',
          callId
        );
      }
      throw error;
    }
  }

  /**
   * Counts the number of lines in text content
   */
  protected countLines(content: string): number {
    if (content === '') return 0;
    return content.split('\n').length;
  }

  /**
   * Formats file size in human-readable format
   */
  protected formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 bytes';
    const k = 1024;
    const sizes = ['bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }

  /**
   * Reads a file and provides helpful error context
   */
  protected async readFileWithContext(filePath: string, callId?: string): Promise<string> {
    try {
      await this.validateFileExists(filePath, callId);
      return await readFile(filePath, 'utf-8');
    } catch (error) {
      if (error instanceof Error && 'isError' in error) {
        throw error; // Re-throw ToolResult errors
      }
      throw this.createFileSystemError(
        'read_error',
        filePath,
        error instanceof Error ? error.message : 'Unknown error reading file',
        'Check file permissions and try again',
        callId
      );
    }
  }

  // Error Creation Methods

  /**
   * Creates a standardized validation error
   */
  protected createValidationError(
    paramName: string,
    expectedType: string,
    context: string,
    callId?: string,
    customSolution?: string
  ): ToolResult {
    const solution = customSolution || `Provide a valid ${expectedType} value`;
    const message = `Parameter '${paramName}' must be ${expectedType}. ${solution}. ${context}`;
    return createErrorResult(message, callId);
  }

  /**
   * Creates a standardized file system error
   */
  protected createFileSystemError(
    errorType: string,
    path: string,
    problem: string,
    solution: string,
    callId?: string
  ): ToolResult {
    const message = `${problem} at path '${path}'. ${solution}. File system operation '${errorType}' failed`;
    return createErrorResult(message, callId);
  }

  /**
   * Creates a generic error with structured format
   */
  protected createStructuredError(
    problem: string,
    solution: string,
    context: string,
    callId?: string
  ): ToolResult {
    const message = `${problem}. ${solution}. ${context}`;
    return createErrorResult(message, callId);
  }

  // Error Handling Utilities

  /**
   * Wraps an async operation with standardized error handling
   */
  protected async wrapAsync<T>(
    operation: () => Promise<T>,
    callId?: string,
    errorContext?: string
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error.toolResult; // Return the ToolResult directly
      }
      if (error instanceof Error && 'isError' in error) {
        throw error; // Re-throw ToolResult errors
      }

      const context = errorContext || 'Operation failed';
      const message = error instanceof Error ? error.message : 'Unknown error occurred';

      throw this.createStructuredError(
        message,
        'Check the input parameters and try again',
        context,
        callId
      );
    }
  }

  /**
   * Wraps a synchronous operation with standardized error handling
   */
  protected wrapSync<T>(operation: () => T, callId?: string, errorContext?: string): T {
    try {
      return operation();
    } catch (error) {
      if (error instanceof Error && 'isError' in error) {
        throw error; // Re-throw ToolResult errors
      }

      const context = errorContext || 'Operation failed';
      const message = error instanceof Error ? error.message : 'Unknown error occurred';

      throw this.createStructuredError(
        message,
        'Check the input parameters and try again',
        context,
        callId
      );
    }
  }

  // Common Patterns

  /**
   * Validates file line number against file content
   */
  protected validateLineNumber(
    lineNumber: number,
    content: string,
    paramName: string = 'line',
    callId?: string
  ): void {
    const totalLines = this.countLines(content);
    if (lineNumber < 1) {
      throw this.createValidationError(
        paramName,
        'positive number',
        'Line numbers start at 1',
        callId
      );
    }
    if (lineNumber > totalLines) {
      throw this.createStructuredError(
        `Line ${lineNumber} exceeds file length (${totalLines} lines)`,
        `Use a line number between 1 and ${totalLines}`,
        'Line number validation failed',
        callId
      );
    }
  }

  /**
   * Creates a success result with helpful metadata
   */
  protected createSuccessWithMetadata(
    content: ContentBlock[],
    metadata: Record<string, unknown>,
    callId?: string
  ): ToolResult {
    return createSuccessResult(content, callId, metadata);
  }
}
