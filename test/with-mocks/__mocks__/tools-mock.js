// ABOUTME: Reusable mock tools object for testing parallel execution and tool orchestration
// ABOUTME: Provides timing simulation, execution tracking, and configurable error scenarios

export function createMockTools() {
  let callOrder = [];
  let callTimestamps = [];

  const mockTools = {
    callTool: async (toolName, method, params, sessionId, agent) => {
      const startTime = Date.now();
      callTimestamps.push({ tool: `${toolName}_${method}`, startTime });
      callOrder.push(`${toolName}_${method}_start`);

      // Simulate different execution times
      const delay =
        {
          tool1_method1: 100,
          tool2_method2: 150,
          tool3_method3: 50,
          slow_method: 300,
          fast_method: 25,
          error_method: 75,
        }[`${toolName}_${method}`] || 100;

      await new Promise((resolve) => setTimeout(resolve, delay));

      callOrder.push(`${toolName}_${method}_end`);

      if (toolName === "error" && method === "method") {
        throw new Error(`${toolName}_${method} failed`);
      }

      return {
        success: true,
        result: `${toolName}_${method} completed`,
        executionTime: delay,
      };
    },
    getTool: (name) => {
      const validTools = ["tool1", "tool2", "tool3", "slow", "fast", "error"];
      return validTools.includes(name) ? { name } : null;
    },
    get: (name) => ({ name }),
    listTools: () => ["tool1", "tool2", "tool3", "slow", "fast", "error"],
    getToolSchema: (name) => ({ name, methods: {} }),
    getAllSchemas: () => ({}),

    // Helper methods for testing
    getCallOrder: () => [...callOrder],
    getCallTimestamps: () => [...callTimestamps],
    resetCallTracking: () => {
      callOrder = [];
      callTimestamps = [];
    },
    setDelay: (toolMethod, delayMs) => {
      // Allow dynamic configuration of delays for testing
      mockTools._delays = mockTools._delays || {};
      mockTools._delays[toolMethod] = delayMs;
    },
    _delays: {},
  };

  return mockTools;
}