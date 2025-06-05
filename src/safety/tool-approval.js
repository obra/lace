// ABOUTME: Interactive tool execution approval system for user safety
// ABOUTME: Provides allow/deny/modify workflow for tool calls before execution

import prompts from 'prompts';
import chalk from 'chalk';

export class ToolApprovalManager {
  constructor(options = {}) {
    this.autoApproveTools = new Set(options.autoApproveTools || []);
    this.alwaysDenyTools = new Set(options.alwaysDenyTools || []);
    this.interactive = options.interactive !== false; // Default to interactive
    this.activityLogger = options.activityLogger || null;
  }


  async requestApproval(toolCall, context = {}) {
    // Parse tool name and method from LLM response
    const [toolName, methodName] = toolCall.name.split('_');
    const riskLevel = this.assessRisk(toolCall);
    
    // Log tool approval request
    if (this.activityLogger && context.sessionId) {
      await this.activityLogger.logEvent('tool_approval_request', context.sessionId, null, {
        tool: toolName,
        method: methodName,
        params: toolCall.input,
        risk_level: riskLevel
      });
    }

    // Check if tool is always denied
    if (this.alwaysDenyTools.has(toolCall.name)) {
      const decision = {
        approved: false,
        reason: 'Tool is on deny list',
        modifiedCall: null
      };
      
      // Log approval decision
      if (this.activityLogger && context.sessionId) {
        await this.activityLogger.logEvent('tool_approval_decision', context.sessionId, null, {
          approved: false,
          modified_params: null,
          user_decision: 'denied_by_policy'
        });
      }
      
      return decision;
    }

    // Check if tool is auto-approved
    if (this.autoApproveTools.has(toolCall.name)) {
      const decision = {
        approved: true,
        reason: 'Tool is on auto-approve list',
        modifiedCall: toolCall
      };
      
      // Log approval decision
      if (this.activityLogger && context.sessionId) {
        await this.activityLogger.logEvent('tool_approval_decision', context.sessionId, null, {
          approved: true,
          modified_params: toolCall.input,
          user_decision: 'auto_approved'
        });
      }
      
      return decision;
    }

    // Interactive approval if enabled
    if (this.interactive) {
      return await this.interactiveApproval(toolCall, context);
    }

    // Default to deny if no interactive mode
    const decision = {
      approved: false,
      reason: 'Interactive mode disabled and tool not auto-approved',
      modifiedCall: null
    };
    
    // Log approval decision
    if (this.activityLogger && context.sessionId) {
      await this.activityLogger.logEvent('tool_approval_decision', context.sessionId, null, {
        approved: false,
        modified_params: null,
        user_decision: 'denied_non_interactive'
      });
    }
    
    return decision;
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

    const { action } = await prompts({
      type: 'select',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { title: '✅ Yes, execute as-is', value: 'approve' },
        { title: '✏️  Yes, but let me modify the arguments first', value: 'modify' },
        { title: '💬 Yes, and add a comment after execution', value: 'approve_with_comment' },
        { title: '❌ No, skip this tool call', value: 'deny' },
        { title: '🛑 No, stop and let me give instructions', value: 'stop' }
      ]
    });

    switch (action) {
      case 'approve':
        const approveDecision = {
          approved: true,
          reason: 'User approved',
          modifiedCall: toolCall
        };
        
        // Log approval decision
        if (this.activityLogger && context.sessionId) {
          await this.activityLogger.logEvent('tool_approval_decision', context.sessionId, null, {
            approved: true,
            modified_params: toolCall.input,
            user_decision: 'approved'
          });
        }
        
        return approveDecision;

      case 'modify':
        return await this.modifyToolCall(toolCall, context);

      case 'approve_with_comment':
        const result = await this.approveWithComment(toolCall);
        const commentDecision = {
          approved: true,
          reason: 'User approved with comment',
          modifiedCall: toolCall,
          postExecutionComment: result.comment
        };
        
        // Log approval decision
        if (this.activityLogger && context.sessionId) {
          await this.activityLogger.logEvent('tool_approval_decision', context.sessionId, null, {
            approved: true,
            modified_params: toolCall.input,
            user_decision: 'approved_with_comment'
          });
        }
        
        return commentDecision;

      case 'deny':
        const denyDecision = {
          approved: false,
          reason: 'User denied',
          modifiedCall: null
        };
        
        // Log approval decision
        if (this.activityLogger && context.sessionId) {
          await this.activityLogger.logEvent('tool_approval_decision', context.sessionId, null, {
            approved: false,
            modified_params: null,
            user_decision: 'denied'
          });
        }
        
        return denyDecision;

      case 'stop':
        const stopDecision = {
          approved: false,
          reason: 'User requested stop',
          modifiedCall: null,
          shouldStop: true
        };
        
        // Log approval decision
        if (this.activityLogger && context.sessionId) {
          await this.activityLogger.logEvent('tool_approval_decision', context.sessionId, null, {
            approved: false,
            modified_params: null,
            user_decision: 'stopped'
          });
        }
        
        return stopDecision;

      default:
        const unknownDecision = {
          approved: false,
          reason: 'Unknown action',
          modifiedCall: null
        };
        
        // Log approval decision
        if (this.activityLogger && context.sessionId) {
          await this.activityLogger.logEvent('tool_approval_decision', context.sessionId, null, {
            approved: false,
            modified_params: null,
            user_decision: 'unknown'
          });
        }
        
        return unknownDecision;
    }
  }

  async modifyToolCall(toolCall, context = {}) {
    console.log(chalk.cyan('\nModify tool arguments:'));
    
    const modifiedInput = {};
    
    for (const [key, value] of Object.entries(toolCall.input)) {
      const { newValue } = await prompts({
        type: 'text',
        name: 'newValue',
        message: `${key}:`,
        initial: JSON.stringify(value)
      });

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

    const { confirm } = await prompts({
      type: 'confirm',
      name: 'confirm',
      message: 'Execute with these modifications?',
      initial: true
    });

    if (confirm) {
      const modifiedDecision = {
        approved: true,
        reason: 'User approved with modifications',
        modifiedCall
      };
      
      // Log approval decision
      if (this.activityLogger && context.sessionId) {
        await this.activityLogger.logEvent('tool_approval_decision', context.sessionId, null, {
          approved: true,
          modified_params: modifiedCall.input,
          user_decision: 'approved_with_modifications'
        });
      }
      
      return modifiedDecision;
    } else {
      const cancelledDecision = {
        approved: false,
        reason: 'User cancelled after modifications',
        modifiedCall: null
      };
      
      // Log approval decision
      if (this.activityLogger && context.sessionId) {
        await this.activityLogger.logEvent('tool_approval_decision', context.sessionId, null, {
          approved: false,
          modified_params: null,
          user_decision: 'cancelled_after_modifications'
        });
      }
      
      return cancelledDecision;
    }
  }

  async approveWithComment(toolCall) {
    const { comment } = await prompts({
      type: 'text',
      name: 'comment',
      message: 'Enter comment to add after execution:',
      validate: input => input.trim().length > 0 || 'Comment cannot be empty'
    });

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