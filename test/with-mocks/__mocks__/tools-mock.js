// ABOUTME: Reusable mock tools object for testing parallel execution and tool orchestration
// ABOUTME: Provides timing simulation, execution tracking, and configurable error scenarios

export function createMockTools() {
  let callOrder = [];
  let callTimestamps = [];

  const mockTools = {
    callTool: async (toolName, params, sessionId, agent) => {
      const startTime = Date.now();
      callTimestamps.push({ tool: `${toolName}_run`, startTime });
      callOrder.push(`${toolName}_run_start`);

      // Simulate different execution times
      const delay =
        {
          tool1_run: 100,
          tool2_run: 150,
          tool3_run: 50,
          slow_run: 300,
          fast_run: 25,
          error_run: 75,
        }[`${toolName}_run`] || 100;

      await new Promise((resolve) => setTimeout(resolve, delay));

      callOrder.push(`${toolName}_run_end`);

      if (toolName === "error") {
        throw new Error(`${toolName}_run failed`);
      }

      return {
        success: true,
        result: `${toolName}_run completed`,
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