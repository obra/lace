// ABOUTME: Interactive tool execution approval system for user safety
// ABOUTME: Provides allow/deny/modify workflow for tool calls before execution

import inquirer from 'inquirer';
import chalk from 'chalk';

export class ToolApprovalManager {
  constructor(options = {}) {
    this.autoApproveTools = new Set(options.autoApproveTools || []);
    this.alwaysDenyTools = new Set(options.alwaysDenyTools || []);
    this.interactive = options.interactive !== false; // Default to interactive
  }

  async requestApproval(toolCall, context = {}) {
    // Check if tool is always denied
    if (this.alwaysDenyTools.has(toolCall.name)) {
      return {
        approved: false,
        reason: 'Tool is on deny list',
        modifiedCall: null
      };
    }

    // Check if tool is auto-approved
    if (this.autoApproveTools.has(toolCall.name)) {
      return {
        approved: true,
        reason: 'Tool is on auto-approve list',
        modifiedCall: toolCall
      };
    }

    // Interactive approval if enabled
    if (this.interactive) {
      return await this.interactiveApproval(toolCall, context);
    }

    // Default to deny if no interactive mode
    return {
      approved: false,
      reason: 'Interactive mode disabled and tool not auto-approved',
      modifiedCall: null
    };
  }

  async interactiveApproval(toolCall, context = {}) {
    console.log(chalk.yellow('\n🔧 Tool Execution Request'));
    console.log(chalk.blue(`Tool: ${toolCall.name}`));
    console.log(chalk.gray(`Arguments: ${JSON.stringify(toolCall.input, null, 2)}`));
    
    if (context.reasoning) {
      console.log(chalk.gray(`Agent reasoning: ${context.reasoning}`));
    }

    // Risk assessment
    const riskLevel = this.assessRisk(toolCall);
    const riskColor = riskLevel === 'high' ? chalk.red : riskLevel === 'medium' ? chalk.yellow : chalk.green;
    console.log(riskColor(`Risk level: ${riskLevel}`));

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: '✅ Yes, execute as-is', value: 'approve' },
          { name: '✏️  Yes, but let me modify the arguments first', value: 'modify' },
          { name: '💬 Yes, and add a comment after execution', value: 'approve_with_comment' },
          { name: '❌ No, skip this tool call', value: 'deny' },
          { name: '🛑 No, stop and let me give instructions', value: 'stop' }
        ]
      }
    ]);

    switch (action) {
      case 'approve':
        return {
          approved: true,
          reason: 'User approved',
          modifiedCall: toolCall
        };

      case 'modify':
        return await this.modifyToolCall(toolCall);

      case 'approve_with_comment':
        const result = await this.approveWithComment(toolCall);
        return {
          approved: true,
          reason: 'User approved with comment',
          modifiedCall: toolCall,
          postExecutionComment: result.comment
        };

      case 'deny':
        return {
          approved: false,
          reason: 'User denied',
          modifiedCall: null
        };

      case 'stop':
        return {
          approved: false,
          reason: 'User requested stop',
          modifiedCall: null,
          shouldStop: true
        };

      default:
        return {
          approved: false,
          reason: 'Unknown action',
          modifiedCall: null
        };
    }
  }

  async modifyToolCall(toolCall) {
    console.log(chalk.cyan('\nModify tool arguments:'));
    
    const modifiedInput = {};
    
    for (const [key, value] of Object.entries(toolCall.input)) {
      const { newValue } = await inquirer.prompt([
        {
          type: 'input',
          name: 'newValue',
          message: `${key}:`,
          default: JSON.stringify(value)
        }
      ]);

      try {
        modifiedInput[key] = JSON.parse(newValue);
      } catch {
        // If JSON parsing fails, treat as string
        modifiedInput[key] = newValue;
      }
    }

    const modifiedCall = {
      ...toolCall,
      input: modifiedInput
    };

    console.log(chalk.green('\nModified tool call:'));
    console.log(chalk.gray(JSON.stringify(modifiedCall, null, 2)));

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Execute with these modifications?',
        default: true
      }
    ]);

    if (confirm) {
      return {
        approved: true,
        reason: 'User approved with modifications',
        modifiedCall
      };
    } else {
      return {
        approved: false,
        reason: 'User cancelled after modifications',
        modifiedCall: null
      };
    }
  }

  async approveWithComment(toolCall) {
    const { comment } = await inquirer.prompt([
      {
        type: 'input',
        name: 'comment',
        message: 'Enter comment to add after execution:',
        validate: input => input.trim().length > 0 || 'Comment cannot be empty'
      }
    ]);

    return { comment };
  }

  assessRisk(toolCall) {
    const toolName = toolCall.name.toLowerCase();
    const input = toolCall.input || {};

    // High risk operations
    if (toolName.includes('shell') || toolName.includes('execute')) {
      const command = input.command || '';
      if (command.includes('rm ') || command.includes('delete') || 
          command.includes('sudo') || command.includes('chmod') ||
          command.includes('curl') || command.includes('wget')) {
        return 'high';
      }
      return 'medium';
    }

    // File operations
    if (toolName.includes('file')) {
      if (toolName.includes('write') || toolName.includes('edit')) {
        const path = input.path || '';
        if (path.includes('/etc/') || path.includes('config') || 
            path.includes('.env') || path.includes('package.json')) {
          return 'high';
        }
        return 'medium';
      }
      return 'low'; // Read operations are generally safe
    }

    // JavaScript execution
    if (toolName.includes('javascript')) {
      const code = input.code || input.expression || '';
      if (code.includes('require') || code.includes('import') || 
          code.includes('process') || code.includes('eval')) {
        return 'high';
      }
      return 'low'; // Simple calculations are safe
    }

    // Default to low risk
    return 'low';
  }

  // Configuration methods
  addAutoApprove(toolName) {
    this.autoApproveTools.add(toolName);
  }

  removeAutoApprove(toolName) {
    this.autoApproveTools.delete(toolName);
  }

  addDenyList(toolName) {
    this.alwaysDenyTools.add(toolName);
  }

  removeDenyList(toolName) {
    this.alwaysDenyTools.delete(toolName);
  }

  setInteractive(enabled) {
    this.interactive = enabled;
  }

  getStatus() {
    return {
      interactive: this.interactive,
      autoApprove: Array.from(this.autoApproveTools),
      denyList: Array.from(this.alwaysDenyTools)
    };
  }
}