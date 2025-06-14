// ABOUTME: Comprehensive mock tools for testing tool orchestration and execution
// ABOUTME: Provides timing simulation, execution tracking, error scenarios, and realistic tool mocks

import { jest } from "@jest/globals";

/**
 * Standard tool definitions used in the system
 */
export const TOOL_DEFINITIONS = {
  file: {
    name: "file",
    description: "File system operations",
    methods: {
      read: {
        description: "Read file contents",
        parameters: {
          path: { type: "string", required: true, description: "File path" }
        }
      },
      write: {
        description: "Write file contents", 
        parameters: {
          path: { type: "string", required: true, description: "File path" },
          content: { type: "string", required: true, description: "File content" }
        }
      },
      execute: {
        description: "Execute file operations",
        parameters: {
          operation: { type: "string", required: true, description: "Operation type" },
          path: { type: "string", required: false, description: "File path" }
        }
      }
    }
  },
  
  shell: {
    name: "shell",
    description: "Shell command execution",
    methods: {
      run: {
        description: "Run shell command",
        parameters: {
          command: { type: "string", required: true, description: "Command to execute" },
          timeout: { type: "number", required: false, description: "Timeout in seconds" }
        }
      },
      execute: {
        description: "Execute shell operations",
        parameters: {
          input: { type: "string", required: false, description: "Input parameter" }
        }
      }
    }
  },
  
  javascript: {
    name: "javascript",
    description: "JavaScript code execution",
    methods: {
      execute: {
        description: "Execute JavaScript code",
        parameters: {
          code: { type: "string", required: true, description: "JavaScript code" },
          timeout: { type: "number", required: false, description: "Timeout in seconds" }
        }
      },
      run: {
        description: "Run JavaScript",
        parameters: {
          input: { type: "string", required: false, description: "Input parameter" }
        }
      }
    }
  },
  
  search: {
    name: "search",
    description: "Search operations",
    methods: {
      execute: {
        description: "Execute search",
        parameters: {
          query: { type: "string", required: true, description: "Search query" },
          scope: { type: "string", required: false, description: "Search scope" }
        }
      }
    }
  },
  
  task: {
    name: "task",
    description: "Task management operations",
    methods: {
      execute: {
        description: "Execute task operations",
        parameters: {
          action: { type: "string", required: true, description: "Task action" },
          target: { type: "string", required: false, description: "Task target" }
        }
      }
    }
  }
};

/**
 * Mock tool classes for individual tools
 */
export class MockShellTool {
  async initialize() {}
  
  getMetadata() {
    return TOOL_DEFINITIONS.shell;
  }
  
  async run(params) {
    const { command, timeout = 30 } = params;
    
    // Simulate command execution
    await new Promise(resolve => setTimeout(resolve, 50));
    
    if (command.includes("error")) {
      throw new Error(`Shell command failed: ${command}`);
    }
    
    return {
      success: true,
      stdout: `Mock output for: ${command}`,
      stderr: "",
      exitCode: 0,
      executionTime: 50
    };
  }
  
  async execute(params) {
    return this.run(params);
  }
}

export class MockReadFileTool {
  async initialize() {}
  
  getMetadata() {
    return {
      ...TOOL_DEFINITIONS.file,
      name: "read_file",
      description: "Read file contents"
    };
  }
  
  async read(params) {
    const { path } = params;
    
    if (path.includes("nonexistent")) {
      throw new Error(`File not found: ${path}`);
    }
    
    return {
      success: true,
      content: `Mock content of ${path}`,
      size: 1024,
      lastModified: new Date().toISOString()
    };
  }
  
  async execute(params) {
    return this.read(params);
  }
}

export class MockWriteFileTool {
  async initialize() {}
  
  getMetadata() {
    return {
      ...TOOL_DEFINITIONS.file,
      name: "write_file",
      description: "Write file contents"
    };
  }
  
  async write(params) {
    const { path, content } = params;
    
    if (path.includes("readonly")) {
      throw new Error(`Permission denied: ${path}`);
    }
    
    return {
      success: true,
      bytesWritten: content.length,
      path: path
    };
  }
  
  async execute(params) {
    return this.write(params);
  }
}

export class MockJavaScriptTool {
  async initialize() {}
  
  getMetadata() {
    return TOOL_DEFINITIONS.javascript;
  }
  
  async execute(params) {
    const { code, timeout = 30 } = params;
    
    if (code.includes("throw")) {
      throw new Error("JavaScript execution error");
    }
    
    return {
      success: true,
      result: "Mock JavaScript result",
      output: `Executed: ${code}`,
      executionTime: 25
    };
  }
}

/**
 * Create comprehensive mock tools for parallel execution testing
 * @param {object} options - Configuration options
 * @returns {object} Mock tools object with execution tracking
 */
export function createMockTools(options = {}) {
  const {
    availableTools = ["tool1", "tool2", "tool3", "slow", "fast", "error"],
    enableTracking = true,
    customDelays = {}
  } = options;
  
  let callOrder = [];
  let callTimestamps = [];

  const defaultDelays = {
    tool1_run: 100,
    tool2_run: 150, 
    tool3_run: 50,
    slow_run: 300,
    fast_run: 25,
    error_run: 75,
    file_read: 80,
    file_write: 120,
    shell_run: 200,
    javascript_execute: 90
  };

  const delays = { ...defaultDelays, ...customDelays };

  const mockTools = {
    initialize: jest.fn().mockResolvedValue(undefined),
    
    callTool: jest.fn().mockImplementation(async (toolName, method, params, sessionId, agent) => {
      const toolMethod = `${toolName}_${method || 'run'}`;
      const startTime = Date.now();
      
      if (enableTracking) {
        callTimestamps.push({ tool: toolMethod, startTime });
        callOrder.push(`${toolMethod}_start`);
      }

      // Simulate execution time
      const delay = delays[toolMethod] || delays[`${toolName}_run`] || 100;
      await new Promise((resolve) => setTimeout(resolve, delay));

      if (enableTracking) {
        callOrder.push(`${toolMethod}_end`);
      }

      // Error simulation
      if (toolName === "error" || toolMethod.includes("error")) {
        throw new Error(`${toolMethod} failed`);
      }

      return {
        success: true,
        result: `${toolMethod} completed`,
        output: `Mock output from ${toolMethod}`,
        executionTime: delay,
      };
    }),
    
    getTool: jest.fn().mockImplementation((name) => {
      return availableTools.includes(name) ? { name } : null;
    }),
    
    get: jest.fn().mockImplementation((name) => {
      if (availableTools.includes(name)) {
        return { name, metadata: TOOL_DEFINITIONS[name] };
      }
      return null;
    }),
    
    listTools: jest.fn().mockReturnValue(availableTools),
    
    getToolSchema: jest.fn().mockImplementation((name) => {
      if (TOOL_DEFINITIONS[name]) {
        return TOOL_DEFINITIONS[name];
      }
      
      return {
        name,
        description: `Mock ${name} tool description`,
        methods: {
          execute: {
            description: `Execute ${name}`,
            parameters: {
              input: { type: "string", required: false, description: "Input parameter" }
            }
          },
          run: {
            description: `Run ${name}`,
            parameters: {
              command: { type: "string", required: true, description: "Command to run" }
            }
          }
        }
      };
    }),
    
    getAllSchemas: jest.fn().mockImplementation(() => {
      const schemas = {};
      for (const tool of availableTools) {
        if (TOOL_DEFINITIONS[tool]) {
          schemas[tool] = TOOL_DEFINITIONS[tool];
        } else {
          schemas[tool] = {
            name: tool,
            description: `Mock ${tool} tool`,
            methods: { execute: { description: `Execute ${tool}`, parameters: {} } }
          };
        }
      }
      return schemas;
    }),

    // Execution tracking helpers
    getCallOrder: () => [...callOrder],
    getCallTimestamps: () => [...callTimestamps],
    resetCallTracking: () => {
      callOrder = [];
      callTimestamps = [];
    },
    
    // Configuration helpers
    setDelay: (toolMethod, delayMs) => {
      delays[toolMethod] = delayMs;
    },
    
    setAvailableTools: (tools) => {
      availableTools.length = 0;
      availableTools.push(...tools);
    },
    
    // Error simulation
    simulateError: (toolName, shouldError = true) => {
      if (shouldError) {
        if (!availableTools.includes("error")) {
          availableTools.push("error");
        }
        delays[`${toolName}_run`] = 75;
      }
    },
    
    // State access for testing
    _getDelays: () => ({ ...delays }),
    _getAvailableTools: () => [...availableTools],
    _getTrackingState: () => ({ callOrder: [...callOrder], callTimestamps: [...callTimestamps] })
  };

  return mockTools;
}

/**
 * Create realistic mock tools registry with individual tool classes
 * @param {object} options - Configuration options
 * @returns {object} Mock tools registry
 */
export function createMockToolRegistry(options = {}) {
  const {
    includeTools = ["shell", "read_file", "write_file", "javascript"],
    shouldSucceed = true
  } = options;
  
  const tools = new Map();
  
  // Register individual tool mocks
  if (includeTools.includes("shell")) {
    tools.set("shell", new MockShellTool());
  }
  if (includeTools.includes("read_file")) {
    tools.set("read_file", new MockReadFileTool());
  }
  if (includeTools.includes("write_file")) {
    tools.set("write_file", new MockWriteFileTool());
  }
  if (includeTools.includes("javascript")) {
    tools.set("javascript", new MockJavaScriptTool());
  }
  
  return {
    initialize: jest.fn().mockResolvedValue(undefined),
    
    register: jest.fn().mockImplementation((name, toolInstance) => {
      tools.set(name, toolInstance);
    }),
    
    get: jest.fn().mockImplementation((name) => {
      return tools.get(name) || null;
    }),
    
    listTools: jest.fn().mockImplementation(() => {
      return Array.from(tools.keys());
    }),
    
    getToolSchema: jest.fn().mockImplementation((name) => {
      const tool = tools.get(name);
      return tool ? tool.getMetadata() : null;
    }),
    
    callTool: jest.fn().mockImplementation(async (toolName, method, params) => {
      const tool = tools.get(toolName);
      
      if (!tool) {
        throw new Error(`Tool ${toolName} not found`);
      }
      
      if (!shouldSucceed) {
        throw new Error(`Tool ${toolName} execution failed`);
      }
      
      const methodName = method || 'execute';
      if (typeof tool[methodName] === 'function') {
        return await tool[methodName](params);
      }
      
      throw new Error(`Method ${methodName} not found on tool ${toolName}`);
    }),
    
    // Test helpers
    _getRegisteredTools: () => new Map(tools),
    _clearTools: () => tools.clear()
  };
}