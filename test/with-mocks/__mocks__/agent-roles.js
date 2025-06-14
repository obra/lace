// ABOUTME: Mock factory for agent role configurations and capabilities
// ABOUTME: Provides standardized role definitions, model mappings, and capability sets

import { jest } from "@jest/globals";

/**
 * Standard agent role definitions with capabilities and model preferences
 */
export const AGENT_ROLES = {
  general: {
    role: "general",
    defaultModel: "claude-3-5-sonnet-20241022",
    fallbackModel: "claude-3-5-haiku-20241022",
    capabilities: ["reasoning", "tool_calling", "analysis", "execution", "planning", "problem_solving"],
    description: "General-purpose agent capable of handling diverse tasks",
    contextPreference: "balanced"
  },

  orchestrator: {
    role: "orchestrator", 
    defaultModel: "claude-3-5-sonnet-20241022",
    fallbackModel: "claude-3-5-haiku-20241022",
    capabilities: ["reasoning", "task_delegation", "agent_coordination", "planning", "analysis"],
    description: "Primary coordination agent that delegates tasks to specialized agents",
    contextPreference: "high"
  },

  execution: {
    role: "execution",
    defaultModel: "claude-3-5-haiku-20241022",
    fallbackModel: "claude-3-5-sonnet-20241022", 
    capabilities: ["execution", "tool_calling", "command_execution"],
    description: "Fast execution agent optimized for simple tool operations",
    contextPreference: "low"
  },

  reasoning: {
    role: "reasoning",
    defaultModel: "claude-3-5-sonnet-20241022",
    fallbackModel: "claude-3-5-haiku-20241022",
    capabilities: ["reasoning", "analysis", "debugging", "problem_solving"],
    description: "Deep analysis agent for complex reasoning tasks",
    contextPreference: "high"
  },

  planning: {
    role: "planning", 
    defaultModel: "claude-3-5-sonnet-20241022",
    fallbackModel: "claude-3-5-haiku-20241022",
    capabilities: ["planning", "reasoning", "analysis", "architecture", "design"],
    description: "Strategic planning agent for complex multi-step tasks",
    contextPreference: "high"
  },

  memory: {
    role: "memory",
    defaultModel: "claude-3-5-haiku-20241022",
    fallbackModel: "claude-3-5-sonnet-20241022",
    capabilities: ["memory_management", "context_compression", "historical_analysis"],
    description: "Memory oracle for querying conversation history",
    contextPreference: "variable"
  }
};

/**
 * Task-to-role mapping patterns
 */
export const TASK_PATTERNS = {
  planning: [
    "plan", "design", "architect", "strategy", "roadmap", "structure",
    "organize", "layout", "blueprint", "framework"
  ],
  execution: [
    "run", "execute", "list", "show", "display", "get", "fetch",
    "create file", "write file", "delete", "move", "copy"
  ],
  reasoning: [
    "analyze", "explain", "debug", "fix", "investigate", "diagnose",
    "understand", "interpret", "evaluate", "assess", "review"
  ],
  memory: [
    "remember", "recall", "search history", "find previous", "what did",
    "when did", "lookup", "retrieve"
  ]
};

/**
 * Create a mock role configuration
 * @param {string} roleName - Name of the role
 * @param {object} overrides - Properties to override
 * @returns {object} Role configuration object
 */
export function createMockRoleConfig(roleName = "general", overrides = {}) {
  const baseRole = AGENT_ROLES[roleName] || AGENT_ROLES.general;
  
  return {
    ...baseRole,
    ...overrides
  };
}

/**
 * Create a mock agent role registry
 * @param {Array<string>} roleNames - Roles to include in registry
 * @returns {object} Mock agent role registry
 */
export function createMockAgentRegistry(roleNames = Object.keys(AGENT_ROLES)) {
  const roles = {};
  
  for (const roleName of roleNames) {
    roles[roleName] = createMockRoleConfig(roleName);
  }

  return {
    initialize: jest.fn().mockResolvedValue(undefined),
    registerRole: jest.fn(),
    getRole: jest.fn((name) => roles[name] || null),
    listRoles: jest.fn().mockReturnValue(Object.keys(roles)),
    validateRole: jest.fn().mockReturnValue(true),
    chooseRoleForTask: jest.fn((task) => {
      const taskLower = task.toLowerCase();
      
      // Check each pattern category
      for (const [role, patterns] of Object.entries(TASK_PATTERNS)) {
        if (patterns.some(pattern => taskLower.includes(pattern))) {
          return roles[role] || roles.general;
        }
      }
      
      return roles.general;
    }),
    roles
  };
}

/**
 * Mock implementation of chooseAgentForTask function
 * @param {string} task - Task description
 * @returns {object} Agent configuration for the task
 */
export function mockChooseAgentForTask(task) {
  const taskLower = task.toLowerCase();
  
  // Planning tasks
  if (TASK_PATTERNS.planning.some(pattern => taskLower.includes(pattern))) {
    return createMockRoleConfig("planning");
  }
  
  // Execution tasks  
  if (TASK_PATTERNS.execution.some(pattern => taskLower.includes(pattern))) {
    return createMockRoleConfig("execution");
  }
  
  // Reasoning tasks
  if (TASK_PATTERNS.reasoning.some(pattern => taskLower.includes(pattern))) {
    return createMockRoleConfig("reasoning");
  }
  
  // Memory tasks
  if (TASK_PATTERNS.memory.some(pattern => taskLower.includes(pattern))) {
    return createMockRoleConfig("memory");
  }
  
  // Default to general
  return createMockRoleConfig("general");
}

/**
 * Create a mock agent with role-specific configuration
 * @param {string} role - Agent role
 * @param {object} options - Additional configuration options
 * @returns {object} Mock agent with role configuration
 */
export function createMockAgentWithRole(role = "general", options = {}) {
  const roleConfig = createMockRoleConfig(role, options.roleOverrides);
  
  return {
    role: roleConfig.role,
    capabilities: roleConfig.capabilities,
    defaultModel: roleConfig.defaultModel,
    contextPreference: roleConfig.contextPreference,
    
    // Mock methods
    processInput: jest.fn().mockResolvedValue({
      content: `${role} agent response`,
      usage: { total_tokens: 100 }
    }),
    
    getConversationHistory: jest.fn(() => Promise.resolve([])),
    
    chooseAgentForTask: jest.fn(mockChooseAgentForTask),
    
    spawnSubagent: jest.fn((subOptions) => {
      const subRole = subOptions.role || "general";
      return Promise.resolve(createMockAgentWithRole(subRole, subOptions));
    }),
    
    shouldHandoff: jest.fn(() => false),
    
    buildSystemPrompt: jest.fn(() => 
      `Role: ${roleConfig.role}\nCapabilities: ${roleConfig.capabilities.join(", ")}`
    ),
    
    ...options.methodOverrides
  };
}

/**
 * Create capability-based role filters
 * @param {Array<string>} requiredCapabilities - Required capabilities
 * @returns {Array<string>} Role names that have all required capabilities
 */
export function getRolesWithCapabilities(requiredCapabilities) {
  return Object.entries(AGENT_ROLES)
    .filter(([_, roleConfig]) => 
      requiredCapabilities.every(cap => roleConfig.capabilities.includes(cap))
    )
    .map(([roleName, _]) => roleName);
}

/**
 * Get roles suitable for specific context preferences
 * @param {string} contextPreference - Context preference (low, balanced, high, variable)
 * @returns {Array<string>} Role names matching the preference
 */
export function getRolesByContextPreference(contextPreference) {
  return Object.entries(AGENT_ROLES)
    .filter(([_, roleConfig]) => roleConfig.contextPreference === contextPreference)
    .map(([roleName, _]) => roleName);
}

/**
 * Mock role delegation scenarios for testing
 */
export const DELEGATION_SCENARIOS = {
  simpleExecution: {
    task: "list files in current directory",
    expectedRole: "execution",
    expectedModel: "claude-3-5-haiku-20241022"
  },
  
  complexAnalysis: {
    task: "analyze this code for potential security vulnerabilities", 
    expectedRole: "reasoning",
    expectedModel: "claude-3-5-sonnet-20241022"
  },
  
  architecturalPlanning: {
    task: "design the database schema for a new feature",
    expectedRole: "planning", 
    expectedModel: "claude-3-5-sonnet-20241022"
  },
  
  memoryLookup: {
    task: "what did we discuss about authentication yesterday",
    expectedRole: "memory",
    expectedModel: "claude-3-5-haiku-20241022"
  }
};

/**
 * Create test scenarios for role delegation
 * @returns {Array<object>} Test scenarios with task and expected role
 */
export function createDelegationTestScenarios() {
  return Object.entries(DELEGATION_SCENARIOS).map(([scenarioName, scenario]) => ({
    name: scenarioName,
    ...scenario
  }));
}