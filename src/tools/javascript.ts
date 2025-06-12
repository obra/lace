// ABOUTME: JavaScript evaluation tool for computational capabilities
// ABOUTME: Provides safe sandboxed execution of JavaScript code with cancellation support

import { BaseTool, ToolSchema, ToolContext } from './base-tool.js';
import vm from 'vm';

export interface JavaScriptEvalParams {
  code: string;
  context?: Record<string, any>;
}

export interface JavaScriptResult {
  result: any;
  output: Array<[string, ...any[]]>;
  type: string;
}

export class JavaScriptTool extends BaseTool {
  private output: Array<[string, ...any[]]> = [];

  getSchema(): ToolSchema {
    return {
      name: 'javascript',
      description: 'Execute JavaScript code in a secure sandboxed environment',
      methods: {
        js_eval: {
          description: 'Execute JavaScript code safely',
          parameters: {
            code: {
              type: 'string',
              required: true,
              description: 'JavaScript code to execute'
            },
            context: {
              type: 'object',
              required: false,
              description: 'Variables to make available in the execution context'
            }
          }
        }
      }
    };
  }

  async js_eval(params: JavaScriptEvalParams, context?: ToolContext): Promise<JavaScriptResult> {
    const { code, context: userContext = {} } = params;
    this.output = [];

    try {
      // Check for cancellation before execution
      if (context?.signal?.aborted) {
        throw new Error('JavaScript execution was cancelled');
      }


      const sandbox = {
        console: {
          log: (...args: any[]) => this.output.push(['log', ...args]),
          error: (...args: any[]) => this.output.push(['error', ...args]),
          warn: (...args: any[]) => this.output.push(['warn', ...args]),
          info: (...args: any[]) => this.output.push(['info', ...args]),
          debug: (...args: any[]) => this.output.push(['debug', ...args])
        },
        setTimeout: undefined, // Remove potentially unsafe globals
        setInterval: undefined,
        setImmediate: undefined,
        process: undefined,
        global: undefined,
        require: undefined,
        ...userContext
      };

      const result = vm.runInNewContext(code, sandbox, {
        timeout: 10000,
        displayErrors: true,
        breakOnSigint: true
      });


      return {
        result,
        output: this.output,
        type: typeof result
      };

    } catch (error: any) {
      if (context?.signal?.aborted) {
        throw new Error('JavaScript execution was cancelled');
      }

      if (error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
        throw new Error('JavaScript execution timed out after 10 seconds');
      }

      throw new Error(`JavaScript execution error: ${error.message}`);
    }
  }
}