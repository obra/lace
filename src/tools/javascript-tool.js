// ABOUTME: JavaScript evaluation tool for computational capabilities
// ABOUTME: Provides safe sandboxed execution of JavaScript code

import vm from 'vm';

export class JavaScriptTool {
  constructor() {
    this.output = [];
  }

  async evaluate(params) {
    const { code, context = {} } = params;
    this.output = [];
    
    try {
      const sandbox = {
        console: {
          log: (...args) => this.output.push(['log', ...args]),
          error: (...args) => this.output.push(['error', ...args]),
          warn: (...args) => this.output.push(['warn', ...args])
        },
        ...context
      };

      const result = vm.runInNewContext(code, sandbox, { 
        timeout: 10000,
        displayErrors: true
      });
      
      return {
        success: true,
        result,
        output: this.output,
        type: typeof result
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        output: this.output
      };
    }
  }

  async calculate(params) {
    const { expression } = params;
    return this.evaluate({ code: `(${expression})` });
  }

  async processData(params) {
    const { data, operation } = params;
    const code = `
      const data = ${JSON.stringify(data)};
      ${operation}
    `;
    return this.evaluate({ code });
  }

  getSchema() {
    return {
      name: 'javascript',
      description: 'Execute JavaScript code in a sandboxed environment',
      methods: {
        evaluate: {
          description: 'Execute arbitrary JavaScript code',
          parameters: {
            code: { type: 'string', required: true, description: 'JavaScript code to execute' },
            context: { type: 'object', required: false, description: 'Variables to make available in the execution context' }
          }
        },
        calculate: {
          description: 'Evaluate a mathematical expression',
          parameters: {
            expression: { type: 'string', required: true, description: 'Mathematical expression to calculate' }
          }
        },
        processData: {
          description: 'Process data with JavaScript operations',
          parameters: {
            data: { type: 'any', required: true, description: 'Data to process' },
            operation: { type: 'string', required: true, description: 'JavaScript operation to perform on the data' }
          }
        }
      }
    };
  }
}