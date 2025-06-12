// ABOUTME: Utilities for composing and chaining tools together into workflows
// ABOUTME: Provides pipeline, parallel execution, and conditional tool orchestration capabilities

import { BaseTool, ToolResult, ToolExecutionOptions } from './base-tool.js';

/**
 * Tool execution step in a pipeline
 */
export interface ToolStep {
  tool: BaseTool;
  method: string;
  params?: Record<string, any> | ((previousResult?: any) => Record<string, any>);
  options?: ToolExecutionOptions;
  condition?: (previousResult?: any) => boolean;
  onError?: 'stop' | 'continue' | 'retry';
  retryCount?: number;
  retryDelay?: number;
}

/**
 * Pipeline execution result
 */
export interface PipelineResult<T = any> {
  success: boolean;
  results: ToolResult<any>[];
  finalResult?: T;
  error?: Error;
  stoppedAt?: number;
}

/**
 * Parallel execution result
 */
export interface ParallelResult {
  success: boolean;
  results: ToolResult<any>[];
  errors: Error[];
  completed: number;
  failed: number;
}

/**
 * Tool pipeline for sequential execution
 */
export class ToolPipeline {
  private steps: ToolStep[] = [];
  private abortController: AbortController | null = null;

  /**
   * Add a step to the pipeline
   */
  addStep(step: ToolStep): this {
    this.steps.push(step);
    return this;
  }

  /**
   * Add a simple tool call step
   */
  step(tool: BaseTool, method: string, params?: Record<string, any> | ((previousResult?: any) => Record<string, any>), options?: ToolExecutionOptions): this {
    return this.addStep({ tool, method, params, options });
  }

  /**
   * Add a conditional step
   */
  stepIf(condition: (previousResult?: any) => boolean, tool: BaseTool, method: string, params?: Record<string, any> | ((previousResult?: any) => Record<string, any>), options?: ToolExecutionOptions): this {
    return this.addStep({ tool, method, params, options, condition });
  }

  /**
   * Execute the pipeline
   */
  async execute<T = any>(initialData?: any, globalOptions?: ToolExecutionOptions): Promise<PipelineResult<T>> {
    this.abortController = globalOptions?.abortController || new AbortController();
    const results: ToolResult<any>[] = [];
    let previousResult = initialData;

    try {
      for (let i = 0; i < this.steps.length; i++) {
        const step = this.steps[i];

        // Check if pipeline should be cancelled
        if (this.abortController.signal.aborted) {
          return {
            success: false,
            results,
            error: new Error('Pipeline was cancelled'),
            stoppedAt: i
          };
        }

        // Check condition if present
        if (step.condition && !step.condition(previousResult)) {
          continue;
        }

        // Prepare parameters
        const params = typeof step.params === 'function' 
          ? step.params(previousResult) 
          : step.params || {};

        // Prepare options with abort signal
        const stepOptions: ToolExecutionOptions = {
          ...step.options,
          abortController: this.abortController
        };

        // Execute step with retry logic
        let result: ToolResult<any>;
        let attempts = 0;
        const maxAttempts = (step.retryCount || 0) + 1;

        while (attempts < maxAttempts) {
          try {
            result = await step.tool.execute(step.method, params, stepOptions);
            break;
          } catch (error) {
            attempts++;
            if (attempts >= maxAttempts) {
              result = ToolResult.error(error instanceof Error ? error : new Error(String(error)));
              break;
            }

            // Wait before retry
            if (step.retryDelay) {
              await new Promise(resolve => setTimeout(resolve, step.retryDelay));
            }
          }
        }

        results.push(result!);

        // Handle errors based on step configuration
        if (!result!.success) {
          const onError = step.onError || 'stop';
          if (onError === 'stop') {
            return {
              success: false,
              results,
              error: new Error(`Step ${i} failed: ${result!.error?.message || 'Unknown error'}`),
              stoppedAt: i
            };
          } else if (onError === 'continue') {
            // Continue to next step
            continue;
          }
        }

        // Update previous result for next step
        previousResult = result!.data;
      }

      return {
        success: true,
        results,
        finalResult: previousResult as T
      };

    } catch (error) {
      return {
        success: false,
        results,
        error: error instanceof Error ? error : new Error(String(error)),
        stoppedAt: results.length
      };
    }
  }

  /**
   * Cancel the pipeline execution
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * Clear all steps
   */
  clear(): this {
    this.steps = [];
    return this;
  }
}

/**
 * Parallel tool execution orchestrator
 */
export class ParallelExecutor {
  private abortController: AbortController | null = null;

  /**
   * Execute multiple tools in parallel
   */
  async executeAll(
    executions: Array<{
      tool: BaseTool;
      method: string;
      params?: Record<string, any>;
      options?: ToolExecutionOptions;
    }>,
    options?: {
      abortController?: AbortController;
      failFast?: boolean;
      maxConcurrency?: number;
    }
  ): Promise<ParallelResult> {
    this.abortController = options?.abortController || new AbortController();
    const results: ToolResult<any>[] = [];
    const errors: Error[] = [];

    try {
      const maxConcurrency = options?.maxConcurrency || executions.length;
      const semaphore = new Semaphore(maxConcurrency);

      const promises = executions.map(async (execution, index) => {
        await semaphore.acquire();

        try {
          if (this.abortController!.signal.aborted) {
            throw new Error('Execution was cancelled');
          }

          const executionOptions: ToolExecutionOptions = {
            ...execution.options,
            abortController: this.abortController!
          };

          const result = await execution.tool.execute(
            execution.method,
            execution.params || {},
            executionOptions
          );

          results[index] = result;

          if (!result.success && options?.failFast) {
            this.abortController!.abort();
          }

          return result;
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          errors.push(err);
          results[index] = ToolResult.error(err);

          if (options?.failFast) {
            this.abortController!.abort();
          }

          throw err;
        } finally {
          semaphore.release();
        }
      });

      await Promise.allSettled(promises);

      const completed = results.filter(r => r && r.success).length;
      const failed = results.filter(r => r && !r.success).length;

      return {
        success: errors.length === 0,
        results: results.filter(r => r), // Remove undefined entries
        errors,
        completed,
        failed
      };

    } catch (error) {
      return {
        success: false,
        results: results.filter(r => r),
        errors: [error instanceof Error ? error : new Error(String(error))],
        completed: results.filter(r => r && r.success).length,
        failed: results.filter(r => r && !r.success).length
      };
    }
  }

  /**
   * Cancel all parallel executions
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }
}

/**
 * Simple semaphore for controlling concurrency
 */
class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise(resolve => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift();
      resolve?.();
    } else {
      this.permits++;
    }
  }
}

/**
 * Tool composition utilities
 */
export class ToolComposer {
  /**
   * Create a new pipeline
   */
  static pipeline(): ToolPipeline {
    return new ToolPipeline();
  }

  /**
   * Create a parallel executor
   */
  static parallel(): ParallelExecutor {
    return new ParallelExecutor();
  }

  /**
   * Chain two tools together
   */
  static chain<T1, T2>(
    tool1: BaseTool,
    method1: string,
    tool2: BaseTool,
    method2: string,
    mapper?: (result1: T1) => Record<string, any>
  ): ToolPipeline {
    const pipeline = new ToolPipeline();
    pipeline.step(tool1, method1);
    pipeline.step(tool2, method2, mapper);
    return pipeline;
  }

  /**
   * Create a conditional tool execution
   */
  static conditional<T>(
    condition: (data: T) => boolean,
    trueTool: BaseTool,
    trueMethod: string,
    falseTool?: BaseTool,
    falseMethod?: string
  ): ToolPipeline {
    const pipeline = new ToolPipeline();
    pipeline.stepIf(condition, trueTool, trueMethod);
    
    if (falseTool && falseMethod) {
      pipeline.stepIf((data: T) => !condition(data), falseTool, falseMethod);
    }
    
    return pipeline;
  }

  /**
   * Create a retry wrapper for a tool
   */
  static retry(
    tool: BaseTool,
    method: string,
    params: Record<string, any>,
    options: {
      maxAttempts?: number;
      delay?: number;
      backoff?: boolean;
    } = {}
  ): ToolPipeline {
    const pipeline = new ToolPipeline();
    pipeline.addStep({
      tool,
      method,
      params,
      retryCount: (options.maxAttempts || 3) - 1,
      retryDelay: options.delay || 1000,
      onError: 'retry'
    });
    return pipeline;
  }

  /**
   * Create a tool that transforms results
   */
  static transform<TInput, TOutput>(
    tool: BaseTool,
    method: string,
    transformer: (input: TInput) => TOutput
  ): ToolPipeline {
    const pipeline = new ToolPipeline();
    
    // Add a custom transform step - we'd need a TransformTool for this
    // For now, this is a placeholder for the concept
    pipeline.step(tool, method);
    
    return pipeline;
  }

  /**
   * Create a fanout pattern - execute one tool, then multiple tools with the result
   */
  static fanout(
    sourceTool: BaseTool,
    sourceMethod: string,
    targetExecutions: Array<{
      tool: BaseTool;
      method: string;
      paramMapper?: (sourceResult: any) => Record<string, any>;
    }>
  ): {
    execute: (initialParams?: Record<string, any>) => Promise<{
      sourceResult: ToolResult<any>;
      targetResults: ToolResult<any>[];
    }>;
  } {
    return {
      async execute(initialParams = {}) {
        // Execute source tool first
        const sourceResult = await sourceTool.execute(sourceMethod, initialParams);
        
        if (!sourceResult.success) {
          return {
            sourceResult,
            targetResults: []
          };
        }

        // Execute target tools in parallel
        const parallel = new ParallelExecutor();
        const executions = targetExecutions.map(target => ({
          tool: target.tool,
          method: target.method,
          params: target.paramMapper 
            ? target.paramMapper(sourceResult.data)
            : { input: sourceResult.data }
        }));

        const parallelResult = await parallel.executeAll(executions);

        return {
          sourceResult,
          targetResults: parallelResult.results
        };
      }
    };
  }
}

/**
 * Utility for creating tool workflows with a fluent interface
 */
export class WorkflowBuilder {
  private pipeline: ToolPipeline;

  constructor() {
    this.pipeline = new ToolPipeline();
  }

  /**
   * Add a tool step
   */
  then(tool: BaseTool, method: string, params?: Record<string, any> | ((prev: any) => Record<string, any>)): this {
    this.pipeline.step(tool, method, params);
    return this;
  }

  /**
   * Add a conditional step
   */
  when(condition: (prev: any) => boolean, tool: BaseTool, method: string, params?: Record<string, any> | ((prev: any) => Record<string, any>)): this {
    this.pipeline.stepIf(condition, tool, method, params);
    return this;
  }

  /**
   * Execute the workflow
   */
  async run<T = any>(initialData?: any, options?: ToolExecutionOptions): Promise<PipelineResult<T>> {
    return this.pipeline.execute<T>(initialData, options);
  }

  /**
   * Get the underlying pipeline
   */
  getPipeline(): ToolPipeline {
    return this.pipeline;
  }
}

/**
 * Factory for common workflow patterns
 */
export const Workflows = {
  /**
   * Create a new workflow builder
   */
  create(): WorkflowBuilder {
    return new WorkflowBuilder();
  },

  /**
   * Create a simple sequential workflow
   */
  sequential(...steps: Array<{ tool: BaseTool; method: string; params?: Record<string, any> }>): WorkflowBuilder {
    const builder = new WorkflowBuilder();
    for (const step of steps) {
      builder.then(step.tool, step.method, step.params);
    }
    return builder;
  },

  /**
   * Create a pipeline with error handling
   */
  withErrorHandling(
    steps: Array<{ tool: BaseTool; method: string; params?: Record<string, any> }>,
    onError: 'stop' | 'continue' = 'stop'
  ): ToolPipeline {
    const pipeline = new ToolPipeline();
    for (const step of steps) {
      pipeline.addStep({
        tool: step.tool,
        method: step.method,
        params: step.params,
        onError
      });
    }
    return pipeline;
  }
};