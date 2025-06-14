// ABOUTME: Mock factory for completion system providers and managers
// ABOUTME: Provides standardized mocks for tab completion, file completion, and command completion

import { jest } from "@jest/globals";

/**
 * Mock completion item structure
 */
export const COMPLETION_ITEM_TYPES = {
  FILE: "file",
  DIRECTORY: "directory", 
  COMMAND: "command",
  OPTION: "option",
  VARIABLE: "variable",
  FUNCTION: "function"
};

/**
 * Create a mock completion item
 * @param {string} label - Display label for the completion
 * @param {string} type - Type of completion item
 * @param {object} options - Additional options
 * @returns {object} Mock completion item
 */
export function createMockCompletionItem(label, type = COMPLETION_ITEM_TYPES.FILE, options = {}) {
  const {
    insertText = label,
    detail = "",
    description = "",
    sortText = label,
    filterText = label,
    priority = 0
  } = options;

  return {
    label,
    type,
    insertText,
    detail,
    description,
    sortText,
    filterText,
    priority
  };
}

/**
 * Mock file completion provider
 * @param {object} options - Configuration options
 * @returns {object} Mock file completion provider
 */
export function createMockFileCompletionProvider(options = {}) {
  const {
    availableFiles = ["package.json", "README.md", "src/index.js", "test/test.js"],
    availableDirectories = ["src/", "test/", "node_modules/"],
    shouldSucceed = true
  } = options;

  return {
    canHandle: jest.fn((context) => {
      // Can handle file path contexts
      return context.type === "file" || context.prefix.includes("/") || context.prefix.includes(".");
    }),

    getCompletions: jest.fn(async (context) => {
      if (!shouldSucceed) {
        throw new Error("File completion failed");
      }

      const { prefix = "", type } = context;
      const completions = [];

      // Add file completions
      for (const file of availableFiles) {
        if (file.toLowerCase().includes(prefix.toLowerCase())) {
          completions.push(createMockCompletionItem(
            file,
            COMPLETION_ITEM_TYPES.FILE,
            {
              detail: "File",
              description: `File: ${file}`,
              priority: 1
            }
          ));
        }
      }

      // Add directory completions
      for (const dir of availableDirectories) {
        if (dir.toLowerCase().includes(prefix.toLowerCase())) {
          completions.push(createMockCompletionItem(
            dir,
            COMPLETION_ITEM_TYPES.DIRECTORY,
            {
              detail: "Directory", 
              description: `Directory: ${dir}`,
              priority: 2
            }
          ));
        }
      }

      return completions;
    }),

    // Test helpers
    _setAvailableFiles: (files) => {
      availableFiles.length = 0;
      availableFiles.push(...files);
    },
    _setAvailableDirectories: (dirs) => {
      availableDirectories.length = 0;
      availableDirectories.push(...dirs);
    },
    _getAvailableFiles: () => [...availableFiles],
    _getAvailableDirectories: () => [...availableDirectories]
  };
}

/**
 * Mock command completion provider
 * @param {object} options - Configuration options
 * @returns {object} Mock command completion provider
 */
export function createMockCommandCompletionProvider(options = {}) {
  const {
    availableCommands = ["help", "exit", "clear", "history", "list", "run"],
    commandOptions = {
      "help": ["--verbose", "--format"],
      "list": ["--all", "--files", "--directories"],
      "run": ["--timeout", "--env"]
    },
    shouldSucceed = true
  } = options;

  return {
    canHandle: jest.fn((context) => {
      // Can handle command contexts
      return context.type === "command" || context.position === 0;
    }),

    getCompletions: jest.fn(async (context) => {
      if (!shouldSucceed) {
        throw new Error("Command completion failed");
      }

      const { prefix = "", type, tokens = [] } = context;
      const completions = [];

      if (tokens.length === 0 || context.position === 0) {
        // Complete command names
        for (const command of availableCommands) {
          if (command.toLowerCase().includes(prefix.toLowerCase())) {
            completions.push(createMockCompletionItem(
              command,
              COMPLETION_ITEM_TYPES.COMMAND,
              {
                detail: "Command",
                description: `Command: ${command}`,
                priority: 3
              }
            ));
          }
        }
      } else {
        // Complete command options
        const currentCommand = tokens[0];
        const options = commandOptions[currentCommand] || [];
        
        for (const option of options) {
          if (option.toLowerCase().includes(prefix.toLowerCase())) {
            completions.push(createMockCompletionItem(
              option,
              COMPLETION_ITEM_TYPES.OPTION,
              {
                detail: "Option",
                description: `Option for ${currentCommand}: ${option}`,
                priority: 2
              }
            ));
          }
        }
      }

      return completions;
    }),

    // Test helpers
    _setAvailableCommands: (commands) => {
      availableCommands.length = 0;
      availableCommands.push(...commands);
    },
    _setCommandOptions: (command, options) => {
      commandOptions[command] = options;
    },
    _getAvailableCommands: () => [...availableCommands],
    _getCommandOptions: () => ({ ...commandOptions })
  };
}

/**
 * Mock variable completion provider
 * @param {object} options - Configuration options
 * @returns {object} Mock variable completion provider
 */
export function createMockVariableCompletionProvider(options = {}) {
  const {
    availableVariables = ["$HOME", "$PATH", "$USER", "$PWD"],
    shouldSucceed = true
  } = options;

  return {
    canHandle: jest.fn((context) => {
      // Can handle variable contexts (starting with $)
      return context.prefix.startsWith("$");
    }),

    getCompletions: jest.fn(async (context) => {
      if (!shouldSucceed) {
        throw new Error("Variable completion failed");
      }

      const { prefix = "" } = context;
      const completions = [];

      for (const variable of availableVariables) {
        if (variable.toLowerCase().includes(prefix.toLowerCase())) {
          completions.push(createMockCompletionItem(
            variable,
            COMPLETION_ITEM_TYPES.VARIABLE,
            {
              detail: "Variable",
              description: `Environment variable: ${variable}`,
              priority: 1
            }
          ));
        }
      }

      return completions;
    }),

    // Test helpers
    _setAvailableVariables: (variables) => {
      availableVariables.length = 0;
      availableVariables.push(...variables);
    },
    _getAvailableVariables: () => [...availableVariables]
  };
}

/**
 * Mock completion manager
 * @param {object} options - Configuration options
 * @returns {object} Mock completion manager
 */
export function createMockCompletionManager(options = {}) {
  const {
    providers = [],
    shouldSucceed = true,
    defaultTimeout = 1000
  } = options;

  const registeredProviders = [...providers];

  return {
    initialize: jest.fn().mockResolvedValue(undefined),

    registerProvider: jest.fn((provider) => {
      registeredProviders.push(provider);
    }),

    unregisterProvider: jest.fn((provider) => {
      const index = registeredProviders.indexOf(provider);
      if (index > -1) {
        registeredProviders.splice(index, 1);
      }
    }),

    getCompletions: jest.fn(async (context) => {
      if (!shouldSucceed) {
        throw new Error("Completion manager failed");
      }

      const allCompletions = [];
      
      for (const provider of registeredProviders) {
        if (provider.canHandle(context)) {
          try {
            const completions = await provider.getCompletions(context);
            allCompletions.push(...completions);
          } catch (error) {
            // Provider failed, continue with others
          }
        }
      }

      // Sort by priority and label
      return allCompletions.sort((a, b) => {
        if (a.priority !== b.priority) {
          return b.priority - a.priority; // Higher priority first
        }
        return a.label.localeCompare(b.label);
      });
    }),

    createContext: jest.fn((input, position) => {
      const tokens = input.split(/\s+/).filter(Boolean);
      const currentToken = position > 0 ? tokens[Math.floor(position / input.length * tokens.length)] || "" : "";
      
      return {
        input,
        position,
        tokens,
        prefix: currentToken,
        type: position === 0 ? "command" : "argument"
      };
    }),

    // Test helpers
    _getProviders: () => [...registeredProviders],
    _clearProviders: () => registeredProviders.length = 0,
    _setProviders: (newProviders) => {
      registeredProviders.length = 0;
      registeredProviders.push(...newProviders);
    }
  };
}

/**
 * Create a complete mock completion system
 * @param {object} options - Configuration options
 * @returns {object} Complete mock completion system
 */
export function createMockCompletionSystem(options = {}) {
  const {
    includeFileProvider = true,
    includeCommandProvider = true,
    includeVariableProvider = true,
    customProviders = []
  } = options;

  const providers = [...customProviders];

  if (includeFileProvider) {
    providers.push(createMockFileCompletionProvider(options.fileProvider));
  }
  
  if (includeCommandProvider) {
    providers.push(createMockCommandCompletionProvider(options.commandProvider));
  }
  
  if (includeVariableProvider) {
    providers.push(createMockVariableCompletionProvider(options.variableProvider));
  }

  const manager = createMockCompletionManager({
    providers,
    ...options.manager
  });

  return {
    manager,
    providers: {
      file: includeFileProvider ? providers.find(p => p._getAvailableFiles) : null,
      command: includeCommandProvider ? providers.find(p => p._getAvailableCommands) : null,
      variable: includeVariableProvider ? providers.find(p => p._getAvailableVariables) : null
    },

    // Convenience methods
    complete: async (input, position = input.length) => {
      const context = manager.createContext(input, position);
      return manager.getCompletions(context);
    },

    // Test helpers
    _getAllProviders: () => [...providers],
    _getManager: () => manager
  };
}

/**
 * Mock completion context scenarios for testing
 */
export const COMPLETION_TEST_SCENARIOS = {
  fileCompletion: {
    input: "cat package",
    position: 11,
    expectedType: "file",
    expectedCompletions: ["package.json"]
  },

  commandCompletion: {
    input: "hel",
    position: 3,
    expectedType: "command", 
    expectedCompletions: ["help"]
  },

  commandOptionCompletion: {
    input: "help --ver",
    position: 10,
    expectedType: "option",
    expectedCompletions: ["--verbose"]
  },

  variableCompletion: {
    input: "echo $HO",
    position: 8,
    expectedType: "variable",
    expectedCompletions: ["$HOME"]
  },

  directoryCompletion: {
    input: "cd src",
    position: 6,
    expectedType: "directory",
    expectedCompletions: ["src/"]
  },

  noMatches: {
    input: "xyz",
    position: 3,
    expectedType: "command",
    expectedCompletions: []
  }
};

/**
 * Create test scenarios for completion testing
 * @returns {Array<object>} Test scenarios with input and expected results
 */
export function createCompletionTestScenarios() {
  return Object.entries(COMPLETION_TEST_SCENARIOS).map(([scenarioName, scenario]) => ({
    name: scenarioName,
    ...scenario
  }));
}