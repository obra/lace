// ABOUTME: Registry of all available commands for the Ink UI
// ABOUTME: Centralizes command definitions and creates default command set

import type { Command } from './types';

/**
 * Basic commands that don't require an agent
 */
export const basicCommands: Command[] = [
  {
    name: 'help',
    description: 'Show help information',
    aliases: ['h'],
    handler: (args, context) => {
      if (!context.laceUI?.commandManager) {
        return {
          success: false,
          message: 'Command manager not available'
        };
      }
      
      const helpText = context.laceUI.commandManager.getHelpText();
      return {
        success: true,
        shouldShowModal: {
          type: 'help',
          data: { helpText }
        }
      };
    }
  },
  
  {
    name: 'quit',
    description: 'Exit lace',
    aliases: ['exit', 'q'],
    handler: () => {
      return {
        success: true,
        message: 'Goodbye!',
        shouldExit: true
      };
    }
  },
  
];

/**
 * Commands that require an active agent
 */
export const agentCommands: Command[] = [
  {
    name: 'status',
    description: 'Show agent status and context usage',
    requiresAgent: true,
    handler: (args, context) => {
      if (!context.laceUI) {
        return {
          success: false,
          message: 'LaceUI not available'
        };
      }

      const status = context.laceUI.getStatus();
      if (!status) {
        return {
          success: false,
          message: 'No agent available'
        };
      }

      return {
        success: true,
        shouldShowModal: {
          type: 'status',
          data: status
        }
      };
    }
  },
  
  {
    name: 'tools',
    description: 'List available tools',
    requiresAgent: true,
    handler: (args, context) => {
      if (!context.agent?.tools) {
        return {
          success: false,
          message: 'No tool registry available'
        };
      }
      
      const tools = context.agent.tools.listTools();
      const toolDetails = tools.map(toolName => {
        const schema = context.agent.tools.getToolSchema(toolName);
        return {
          name: toolName,
          description: schema?.description || 'No description'
        };
      });
      
      return {
        success: true,
        shouldShowModal: {
          type: 'tools',
          data: { tools: toolDetails }
        }
      };
    }
  },
  
  {
    name: 'memory',
    description: 'Show conversation history',
    requiresAgent: true,
    handler: async (args, context) => {
      if (!context.agent?.getConversationHistory) {
        return {
          success: false,
          message: 'Conversation history not available'
        };
      }
      
      try {
        const sessionId = context.laceUI?.sessionId || 'current';
        const history = await context.agent.getConversationHistory(sessionId, 10);
        
        return {
          success: true,
          shouldShowModal: {
            type: 'memory',
            data: { history }
          }
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to get conversation history: ${error instanceof Error ? error.message : String(error)}`
        };
      }
    }
  },
  
  {
    name: 'approval',
    description: 'Show tool approval settings',
    requiresAgent: true,
    handler: (args, context) => {
      if (!context.agent?.toolApproval) {
        return {
          success: false,
          message: 'Tool approval system not available'
        };
      }
      
      const status = context.agent.toolApproval.getStatus();
      return {
        success: true,
        shouldShowModal: {
          type: 'approval',
          data: status
        }
      };
    }
  },
  
  {
    name: 'activity',
    description: 'Show recent activity logs',
    parameterDescription: '[recent|session|type=<event_type>] [limit=<number>]',
    requiresAgent: true,
    handler: async (args, context) => {
      if (!context.laceUI?.getRecentActivity) {
        return {
          success: false,
          message: 'Activity logging not available'
        };
      }
      
      try {
        let result;
        const limit = 50; // Default limit
        
        if (args.length === 0 || args[0] === 'recent') {
          // Show recent activity across all types
          result = await context.laceUI.getRecentActivity(limit);
        } else if (args[0] === 'session') {
          // Show activity for current session
          const sessionId = context.laceUI.sessionId || 'current';
          result = await context.laceUI.getSessionActivity(sessionId, limit);
        } else if (args[0].startsWith('type=')) {
          // Filter by specific event type
          const eventType = args[0].substring(5);
          result = await context.laceUI.getActivityByType(eventType, limit);
        } else {
          return {
            success: false,
            message: 'Usage: /activity [recent|session|type=<event_type>]'
          };
        }
        
        return {
          success: true,
          shouldShowModal: {
            type: 'activity',
            data: { activities: result }
          }
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to get activity logs: ${error instanceof Error ? error.message : String(error)}`
        };
      }
    }
  }
];

/**
 * Parameterized commands for tool management
 */
export const toolManagementCommands: Command[] = [
  {
    name: 'auto-approve',
    description: 'Add tool to auto-approve list',
    parameterDescription: '<tool_name>',
    requiresAgent: true,
    handler: (args, context) => {
      if (args.length === 0) {
        return {
          success: false,
          message: 'Usage: /auto-approve <tool_name>'
        };
      }
      
      if (!context.agent?.toolApproval) {
        return {
          success: false,
          message: 'Tool approval system not available'
        };
      }
      
      const toolName = args[0];
      context.agent.toolApproval.addAutoApprove(toolName);
      
      return {
        success: true,
        message: `✅ Added '${toolName}' to auto-approve list`
      };
    }
  },
  
  {
    name: 'deny',
    description: 'Add tool to deny list',
    parameterDescription: '<tool_name>',
    requiresAgent: true,
    handler: (args, context) => {
      if (args.length === 0) {
        return {
          success: false,
          message: 'Usage: /deny <tool_name>'
        };
      }
      
      if (!context.agent?.toolApproval) {
        return {
          success: false,
          message: 'Tool approval system not available'
        };
      }
      
      const toolName = args[0];
      context.agent.toolApproval.addDenyList(toolName);
      
      return {
        success: true,
        message: `🚫 Added '${toolName}' to deny list`
      };
    }
  }
];

/**
 * Get all default commands
 */
export function getAllCommands(): Command[] {
  return [
    ...basicCommands,
    ...agentCommands,
    ...toolManagementCommands
  ];
}
