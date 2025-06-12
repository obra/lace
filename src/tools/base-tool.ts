// ABOUTME: Abstract base class providing standardized interfaces and utilities for all tools
// ABOUTME: Includes parameter validation, error handling, and cancellation support

/**
 * Tool execution context passed to tool methods
 */
export interface ToolContext {
  signal?: AbortSignal;
  [key: string]: any;
}

/**
 * Tool execution options
 */
export interface ToolExecutionOptions {
  abortController?: AbortController;
  context?: Record<string, any>;
  timeout?: number;
}


/**
 * Parameter definition in tool schema
 */
export interface ParameterDefinition {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required?: boolean;
  default?: any;
  description?: string;
  min?: number;
  max?: number;
  pattern?: string;
  enum?: any[];
}

/**
 * Method definition in tool schema
 */
export interface MethodDefinition {
  description: string;
  parameters?: Record<string, ParameterDefinition>;
}

/**
 * Tool schema interface
 */
export interface ToolSchema {
  name: string;
  description: string;
  usage_guidance?: string;
  methods: Record<string, MethodDefinition>;
}

/**
 * Standardized tool result interface
 */
export class ToolResult<T = any> {
  readonly success: boolean;
  readonly data: T | null;
  readonly error: ToolErrorData | null;
  readonly metadata: Record<string, any>;

  constructor(success: boolean, data: T | null = null, error: ToolErrorData | null = null, metadata: Record<string, any> = {}) {
    this.success = success;
    this.data = data;
    this.error = error;
    this.metadata = {
      timestamp: new Date().toISOString(),
      ...metadata,
    };
  }

  static success<T>(data: T, metadata: Record<string, any> = {}): ToolResult<T> {
    return new ToolResult(true, data, null, metadata);
  }

  static error<T = any>(error: Error | string, metadata: Record<string, any> = {}): ToolResult<T> {
    const errorObj: ToolErrorData = error instanceof Error ? {
      message: error.message,
      name: error.name,
      stack: error.stack,
    } : { message: String(error), name: 'Error' };
    
    return new ToolResult<T>(false, null, errorObj, metadata);
  }

  static fromLegacy<T>(legacyResult: any): ToolResult<T> {
    if (legacyResult instanceof ToolResult) {
      return legacyResult;
    }
    
    if (typeof legacyResult === 'object' && legacyResult !== null) {
      if ('success' in legacyResult) {
        return legacyResult.success 
          ? ToolResult.success<T>(legacyResult)
          : ToolResult.error<T>(legacyResult.error || 'Unknown error');
      }
    }
    
    return ToolResult.success<T>(legacyResult);
  }
}

/**
 * Tool error data interface
 */
export interface ToolErrorData {
  message: string;
  name: string;
  stack?: string;
  code?: string;
  context?: Record<string, any>;
}

/**
 * Standard tool error with context
 */
export class ToolError extends Error {
  readonly code: string;
  readonly context: Record<string, any>;
  readonly timestamp: string;

  constructor(message: string, code: string = 'TOOL_ERROR', context: Record<string, any> = {}) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.context = context;
    this.timestamp = new Date().toISOString();
  }
}


/**
 * Parameter validation result
 */
interface ValidationResult {
  valid: boolean;
  value?: any;
  error?: string;
}

/**
 * Parameter validation utility
 */
class ParameterValidator {
  validate(params: Record<string, any>, schema: Record<string, ParameterDefinition>): Record<string, any> {
    const validated: Record<string, any> = {};
    const errors: string[] = [];

    // Check required parameters
    for (const [paramName, paramDef] of Object.entries(schema)) {
      const value = params[paramName];
      const isRequired = paramDef.required === true;

      if (isRequired && (value === undefined || value === null)) {
        errors.push(`Required parameter '${paramName}' is missing`);
        continue;
      }

      if (value !== undefined && value !== null) {
        // Type validation
        const validationResult = this.validateType(value, paramDef, paramName);
        if (validationResult.valid) {
          validated[paramName] = validationResult.value;
        } else {
          errors.push(validationResult.error!);
        }
      } else if (paramDef.default !== undefined) {
        validated[paramName] = paramDef.default;
      }
    }

    // Check for unexpected parameters
    for (const paramName of Object.keys(params)) {
      if (!(paramName in schema)) {
        errors.push(`Unexpected parameter '${paramName}'`);
      }
    }

    if (errors.length > 0) {
      throw new ToolError(
        `Parameter validation failed: ${errors.join(', ')}`,
        'VALIDATION_ERROR',
        { errors, schema }
      );
    }

    return validated;
  }

  private validateType(value: any, paramDef: ParameterDefinition, paramName: string): ValidationResult {
    const { type, min, max, pattern, enum: enumValues } = paramDef;

    try {
      switch (type) {
        case 'string':
          if (typeof value !== 'string') {
            return { valid: false, error: `Parameter '${paramName}' must be a string` };
          }
          if (min && value.length < min) {
            return { valid: false, error: `Parameter '${paramName}' must be at least ${min} characters` };
          }
          if (max && value.length > max) {
            return { valid: false, error: `Parameter '${paramName}' must be at most ${max} characters` };
          }
          if (pattern && !new RegExp(pattern).test(value)) {
            return { valid: false, error: `Parameter '${paramName}' does not match required pattern` };
          }
          if (enumValues && !enumValues.includes(value)) {
            return { valid: false, error: `Parameter '${paramName}' must be one of: ${enumValues.join(', ')}` };
          }
          break;

        case 'number':
          const num = typeof value === 'string' ? parseFloat(value) : value;
          if (typeof num !== 'number' || isNaN(num)) {
            return { valid: false, error: `Parameter '${paramName}' must be a number` };
          }
          if (min !== undefined && num < min) {
            return { valid: false, error: `Parameter '${paramName}' must be at least ${min}` };
          }
          if (max !== undefined && num > max) {
            return { valid: false, error: `Parameter '${paramName}' must be at most ${max}` };
          }
          return { valid: true, value: num };

        case 'boolean':
          if (typeof value === 'string') {
            const lowerValue = value.toLowerCase();
            if (lowerValue === 'true') return { valid: true, value: true };
            if (lowerValue === 'false') return { valid: true, value: false };
            return { valid: false, error: `Parameter '${paramName}' must be a boolean` };
          }
          if (typeof value !== 'boolean') {
            return { valid: false, error: `Parameter '${paramName}' must be a boolean` };
          }
          break;

        case 'array':
          if (!Array.isArray(value)) {
            return { valid: false, error: `Parameter '${paramName}' must be an array` };
          }
          if (min && value.length < min) {
            return { valid: false, error: `Parameter '${paramName}' must have at least ${min} items` };
          }
          if (max && value.length > max) {
            return { valid: false, error: `Parameter '${paramName}' must have at most ${max} items` };
          }
          break;

        case 'object':
          if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            return { valid: false, error: `Parameter '${paramName}' must be an object` };
          }
          break;

        default:
          // Unknown type - accept any value
          break;
      }

      return { valid: true, value };
    } catch (error) {
      return { valid: false, error: `Parameter '${paramName}' validation error: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
}

/**
 * Abstract base class for all tools
 */
export abstract class BaseTool {
  protected readonly options: Record<string, any>;
  protected readonly name: string;
  protected initialized: boolean = false;
  private readonly validator: ParameterValidator;

  constructor(options: Record<string, any> = {}) {
    this.options = options;
    this.name = this.constructor.name.replace('Tool', '').toLowerCase();
    this.validator = new ParameterValidator();
  }

  /**
   * Initialize the tool (override if needed)
   */
  async initialize(): Promise<void> {
    this.initialized = true;
  }

  /**
   * Get tool metadata (must be implemented by subclasses)
   */
  abstract getMetadata(): ToolSchema;

  /**
   * Validate parameters against schema
   */
  protected validateParameters(methodName: string, params: Record<string, any>): Record<string, any> {
    const schema = this.getMetadata();
    const methodSchema = schema.methods?.[methodName];
    
    if (!methodSchema) {
      throw new ToolError(
        `Method '${methodName}' not found in tool '${this.name}'`,
        'METHOD_NOT_FOUND'
      );
    }

    return this.validator.validate(params, methodSchema.parameters || {});
  }

  /**
   * Execute a tool method with full infrastructure support
   */
  async execute<T = any>(methodName: string, params: Record<string, any> = {}, options: ToolExecutionOptions = {}): Promise<ToolResult<T>> {
    try {
      // Ensure tool is initialized
      if (!this.initialized) {
        await this.initialize();
      }

      // Set up cancellation support
      const abortController = options.abortController || new AbortController();
      const signal = abortController.signal;


      // Validate parameters
      const validatedParams = this.validateParameters(methodName, params);

      // Check if method exists
      const method = (this as any)[methodName];
      if (typeof method !== 'function') {
        throw new ToolError(
          `Method '${methodName}' not implemented in tool '${this.name}'`,
          'METHOD_NOT_IMPLEMENTED'
        );
      }

      // Execute with context
      const context: ToolContext = {
        signal,
        ...options.context,
      };

      // Handle timeout if specified
      const executeMethod = () => method.call(this, validatedParams, context);
      const operation = options.timeout 
        ? this.withTimeout(executeMethod, options.timeout, signal)
        : this.withCancellation(executeMethod, signal);

      const result = await operation;
      
      // Normalize result
      return ToolResult.fromLegacy<T>(result);

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return ToolResult.error<T>('Operation was cancelled', { cancelled: true });
      }
      
      if (error instanceof ToolError) {
        return ToolResult.error<T>(error);
      }
      
      return ToolResult.error<T>(error instanceof Error ? error : new Error(String(error)), { method: methodName, params });
    }
  }

  /**
   * Create a cancellable operation wrapper
   */
  protected withCancellation<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        const error = new Error('Operation was cancelled');
        error.name = 'AbortError';
        return reject(error);
      }

      const abortHandler = () => {
        const error = new Error('Operation was cancelled');
        error.name = 'AbortError';
        reject(error);
      };

      signal?.addEventListener('abort', abortHandler);

      Promise.resolve(operation())
        .then(resolve)
        .catch(reject)
        .finally(() => {
          signal?.removeEventListener('abort', abortHandler);
        });
    });
  }

  /**
   * Utility method for handling timeouts
   */
  protected withTimeout<T>(operation: () => Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const error = new Error(`Operation timed out after ${timeoutMs}ms`);
        error.name = 'TimeoutError';
        reject(error);
      }, timeoutMs);

      const cleanup = () => clearTimeout(timeoutId);

      this.withCancellation(operation, signal)
        .then(resolve)
        .catch(reject)
        .finally(cleanup);
    });
  }

  /**
   * Stream results for large outputs
   */
  async *streamResults<T = any>(methodName: string, params: Record<string, any> = {}, options: ToolExecutionOptions = {}): AsyncGenerator<ToolResult<T>, void, unknown> {
    // Default implementation - subclasses can override for true streaming
    const result = await this.execute<T>(methodName, params, options);
    yield result;
  }
}