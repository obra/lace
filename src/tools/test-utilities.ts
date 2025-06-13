// ABOUTME: Testing utilities for tools that reduce mocking complexity and provide consistent test patterns
// ABOUTME: Includes test tool implementations, assertion helpers, and tool behavior verification utilities

import { BaseTool, ToolSchema, ToolResult, ToolContext, ToolExecutionOptions } from './base-tool.js';

/**
 * Mock tool for testing that implements the BaseTool interface
 */
export class MockTool extends BaseTool {
  private responses: Map<string, any> = new Map();
  private calls: Array<{ method: string; params: any; context?: ToolContext }> = [];
  private delays: Map<string, number> = new Map();
  private errors: Map<string, Error> = new Map();

  constructor(options: Record<string, any> = {}) {
    super(options);
  }

  getMetadata(): ToolSchema {
    return {
      name: 'mock',
      description: 'Mock tool for testing',
      methods: {
        execute: {
          description: 'Execute mock operation',
          parameters: {
            command: {
              type: 'string',
              required: true,
              description: 'Command to execute'
            },
            data: {
              type: 'object',
              required: false,
              description: 'Optional data payload'
            }
          }
        },
        read: {
          description: 'Read mock data',
          parameters: {
            path: {
              type: 'string',
              required: true,
              description: 'Path to read from'
            }
          }
        },
        write: {
          description: 'Write mock data',
          parameters: {
            path: {
              type: 'string',
              required: true,
              description: 'Path to write to'
            },
            content: {
              type: 'string',
              required: true,
              description: 'Content to write'
            }
          }
        }
      }
    };
  }

  /**
   * Configure mock response for a method
   */
  mockResponse(method: string, response: any): this {
    this.responses.set(method, response);
    return this;
  }

  /**
   * Configure mock delay for a method
   */
  mockDelay(method: string, delayMs: number): this {
    this.delays.set(method, delayMs);
    return this;
  }

  /**
   * Configure mock error for a method
   */
  mockError(method: string, error: Error): this {
    this.errors.set(method, error);
    return this;
  }

  /**
   * Get all recorded method calls
   */
  getCalls(): Array<{ method: string; params: any; context?: ToolContext }> {
    return [...this.calls];
  }

  /**
   * Get calls for a specific method
   */
  getCallsFor(method: string): Array<{ method: string; params: any; context?: ToolContext }> {
    return this.calls.filter(call => call.method === method);
  }

  /**
   * Clear all recorded calls
   */
  clearCalls(): void {
    this.calls = [];
  }

  /**
   * Generic method handler
   */
  private async handleMethod(method: string, params: any, context?: ToolContext): Promise<any> {
    // Record the call
    this.calls.push({ method, params, context });

    // Simulate delay if configured
    const delay = this.delays.get(method);
    if (delay) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Check for cancellation
    if (context?.signal?.aborted) {
      const error = new Error('Operation was cancelled');
      error.name = 'AbortError';
      throw error;
    }

    // Throw error if configured
    const error = this.errors.get(method);
    if (error) {
      throw error;
    }

    // Return mock response
    const response = this.responses.get(method);
    if (response !== undefined) {
      return response;
    }

    // Default response
    return {
      success: true,
      method,
      params,
      timestamp: new Date().toISOString()
    };
  }

  async execute(params: any, context?: ToolContext): Promise<any> {
    return this.handleMethod('execute', params, context);
  }

  async read(params: any, context?: ToolContext): Promise<any> {
    return this.handleMethod('read', params, context);
  }

  async write(params: any, context?: ToolContext): Promise<any> {
    return this.handleMethod('write', params, context);
  }
}

/**
 * Tool test harness for comprehensive tool testing
 */
export class ToolTestHarness {
  private abortController: AbortController | null = null;

  /**
   * Execute a tool method with test infrastructure
   */
  async executeTool<T = any>(
    tool: BaseTool,
    method: string,
    params: Record<string, any> = {},
    options: Partial<ToolExecutionOptions> = {}
  ): Promise<ToolResult<T>> {
    this.abortController = new AbortController();

    const testOptions: ToolExecutionOptions = {
      abortController: this.abortController,
      ...options
    };

    return tool.execute<T>(method, params, testOptions);
  }

  /**
   * Cancel the current operation
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }


  /**
   * Assert that a tool result is successful
   */
  assertSuccess<T>(result: ToolResult<T>): void {
    if (!result.success) {
      throw new Error(`Expected success but got error: ${result.error?.message || 'Unknown error'}`);
    }
  }

  /**
   * Assert that a tool result is an error
   */
  assertError<T>(result: ToolResult<T>): void {
    if (result.success) {
      throw new Error(`Expected error but got success with data: ${JSON.stringify(result.data)}`);
    }
  }

  /**
   * Assert that a tool result has specific error code
   */
  assertErrorCode<T>(result: ToolResult<T>, expectedCode: string): void {
    this.assertError(result);
    
    const errorCode = result.error?.name === 'ToolError' 
      ? (result.error as any).code 
      : result.error?.name;
      
    if (errorCode !== expectedCode) {
      throw new Error(`Expected error code '${expectedCode}' but got '${errorCode}'`);
    }
  }

  /**
   * Create a test timeout promise
   */
  timeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Test timed out after ${ms}ms`)), ms);
    });
  }

  /**
   * Race a promise against a timeout
   */
  async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([promise, this.timeout(timeoutMs)]);
  }
}

/**
 * Tool behavior verification utilities
 */
export class ToolBehaviorVerifier {
  /**
   * Verify that a tool properly validates parameters
   */
  static async verifyParameterValidation(tool: BaseTool, method: string): Promise<void> {
    const harness = new ToolTestHarness();
    
    // Test missing required parameter
    const result = await harness.executeTool(tool, method, {});
    harness.assertErrorCode(result, 'VALIDATION_ERROR');
  }

  /**
   * Verify that a tool supports cancellation
   */
  static async verifyCancellationSupport(
    tool: BaseTool, 
    method: string, 
    params: Record<string, any>,
    expectedDuration: number = 100
  ): Promise<void> {
    const harness = new ToolTestHarness();
    
    // Start operation
    const resultPromise = harness.executeTool(tool, method, params);
    
    // Cancel after a short delay
    setTimeout(() => harness.cancel(), expectedDuration / 2);
    
    const result = await resultPromise;
    harness.assertError(result);
    
    if (!result.metadata?.cancelled) {
      throw new Error('Tool did not properly handle cancellation');
    }
  }


  /**
   * Verify that a tool handles timeouts correctly
   */
  static async verifyTimeoutHandling(
    tool: BaseTool,
    method: string,
    params: Record<string, any>,
    timeoutMs: number = 100
  ): Promise<void> {
    const harness = new ToolTestHarness();
    
    const result = await harness.executeTool(tool, method, params, { timeout: timeoutMs });
    
    // Should either complete quickly or timeout
    if (!result.success && result.error?.name !== 'TimeoutError') {
      throw new Error(`Expected timeout error or success, got: ${result.error?.name}`);
    }
  }
}

/**
 * Tool schema validation utilities
 */
export class ToolSchemaValidator {
  /**
   * Validate that a tool's schema is well-formed
   */
  static validateSchema(tool: BaseTool): string[] {
    const errors: string[] = [];
    const schema = tool.getMetadata();

    if (!schema.name) {
      errors.push('Schema must have a name');
    }

    if (!schema.description) {
      errors.push('Schema must have a description');
    }

    if (!schema.methods || Object.keys(schema.methods).length === 0) {
      errors.push('Schema must have at least one method');
    }

    for (const [methodName, methodDef] of Object.entries(schema.methods || {})) {
      if (!methodDef.description) {
        errors.push(`Method '${methodName}' must have a description`);
      }

      if (methodDef.parameters) {
        for (const [paramName, paramDef] of Object.entries(methodDef.parameters)) {
          if (!paramDef.type) {
            errors.push(`Parameter '${paramName}' in method '${methodName}' must have a type`);
          }

          if (!paramDef.description) {
            errors.push(`Parameter '${paramName}' in method '${methodName}' must have a description`);
          }
        }
      }
    }

    return errors;
  }

  /**
   * Validate that a tool implements all methods in its schema
   */
  static validateImplementation(tool: BaseTool): string[] {
    const errors: string[] = [];
    const schema = tool.getMetadata();

    for (const methodName of Object.keys(schema.methods || {})) {
      if (typeof (tool as any)[methodName] !== 'function') {
        errors.push(`Tool does not implement method '${methodName}' declared in schema`);
      }
    }

    return errors;
  }
}

/**
 * Utility functions for common test patterns
 */
export const ToolTestUtils = {
  /**
   * Create a mock tool with pre-configured responses
   */
  createMockTool(responses: Record<string, any> = {}): MockTool {
    const tool = new MockTool();
    for (const [method, response] of Object.entries(responses)) {
      tool.mockResponse(method, response);
    }
    return tool;
  },

  /**
   * Create a temporary file for testing
   */
  async createTempFile(content: string = 'test content'): Promise<string> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');
    
    const tempDir = os.tmpdir();
    const fileName = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.txt`;
    const filePath = path.join(tempDir, fileName);
    
    await fs.writeFile(filePath, content);
    return filePath;
  },

  /**
   * Clean up temporary files
   */
  async cleanupTempFile(filePath: string): Promise<void> {
    try {
      const fs = await import('fs/promises');
      await fs.unlink(filePath);
    } catch (error) {
      // Ignore cleanup errors
    }
  },

  /**
   * Wait for a condition to be true
   */
  async waitFor(condition: () => boolean, timeoutMs: number = 5000, intervalMs: number = 10): Promise<void> {
    const startTime = Date.now();
    
    while (!condition() && Date.now() - startTime < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    
    if (!condition()) {
      throw new Error(`Condition not met within ${timeoutMs}ms`);
    }
  },

  /**
   * Assert that an array contains specific items
   */
  assertContains<T>(array: T[], expectedItems: T[]): void {
    for (const item of expectedItems) {
      if (!array.includes(item)) {
        throw new Error(`Array does not contain expected item: ${JSON.stringify(item)}`);
      }
    }
  },

  /**
   * Assert that two objects are deeply equal
   */
  assertDeepEqual(actual: any, expected: any): void {
    const actualStr = JSON.stringify(actual, null, 2);
    const expectedStr = JSON.stringify(expected, null, 2);
    
    if (actualStr !== expectedStr) {
      throw new Error(`Objects are not equal:\nActual: ${actualStr}\nExpected: ${expectedStr}`);
    }
  }
};
