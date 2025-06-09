// ABOUTME: Core approval engine for tool execution safety decisions
// ABOUTME: Manages auto-approve/deny rules and processes user decisions into approval results

import type { 
  ApprovalRequest, 
  ApprovalResult, 
  UserDecision, 
  ApprovalEngineConfig,
  ApprovalStatus 
} from './types.js';

export class ApprovalEngine {
  private autoApproveTools: Set<string>;
  private alwaysDenyTools: Set<string>;
  private interactive: boolean;
  private activityLogger: any; // ActivityLogger from main

  constructor(config: ApprovalEngineConfig = {}) {
    this.autoApproveTools = new Set(config.autoApproveTools || []);
    this.alwaysDenyTools = new Set(config.alwaysDenyTools || []);
    this.interactive = config.interactive !== false; // Default to true
    this.activityLogger = config.activityLogger || null;
  }

  async checkAutoApproval(request: ApprovalRequest): Promise<ApprovalResult | null> {
    const toolCall = request.toolCall;
    // Parse tool name and method from LLM response
    const [toolName, methodName] = toolCall.name.split('_');
    const riskLevel = this.assessRisk(toolCall);
    
    // Log tool approval request
    if (this.activityLogger && request.context?.sessionId) {
      await this.activityLogger.logEvent('tool_approval_request', request.context.sessionId, null, {
        tool: toolName,
        method: methodName,
        params: toolCall.input,
        risk_level: riskLevel
      });
    }

    // Check deny list first (takes precedence)
    if (this.alwaysDenyTools.has(toolCall.name)) {
      const decision = {
        approved: false,
        reason: 'Tool is on deny list',
        modifiedCall: null
      };
      
      // Log approval decision
      if (this.activityLogger && request.context?.sessionId) {
        await this.activityLogger.logEvent('tool_approval_decision', request.context.sessionId, null, {
          approved: false,
          modified_params: null,
          user_decision: 'denied_by_policy'
        });
      }
      
      return decision;
    }

    // Check auto-approve list
    if (this.autoApproveTools.has(toolCall.name)) {
      const decision = {
        approved: true,
        reason: 'Tool is on auto-approve list',
        modifiedCall: toolCall
      };
      
      // Log approval decision
      if (this.activityLogger && request.context?.sessionId) {
        await this.activityLogger.logEvent('tool_approval_decision', request.context.sessionId, null, {
          approved: true,
          modified_params: toolCall.input,
          user_decision: 'auto_approved'
        });
      }
      
      return decision;
    }

    // No automatic decision - requires manual approval
    return null;
  }

  finalizeApproval(decision: UserDecision): ApprovalResult {
    switch (decision.action) {
      case 'approve':
        return this.handleApprove(decision);
      
      case 'deny':
        return {
          approved: false,
          reason: decision.reason || 'User denied',
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

  private handleApprove(decision: UserDecision): ApprovalResult {
    const hasModifications = decision.modifiedCall && 
      JSON.stringify(decision.modifiedCall.input) !== JSON.stringify(decision.toolCall.input);
    
    const hasComment = decision.comment && decision.comment.trim().length > 0;

    let reason = 'User approved';
    if (hasModifications && hasComment) {
      reason = 'User approved with modifications and comment';
    } else if (hasModifications) {
      reason = 'User approved with modifications';
    } else if (hasComment) {
      reason = 'User approved with comment';
    }

    const result: ApprovalResult = {
      approved: true,
      reason,
      modifiedCall: decision.modifiedCall || decision.toolCall
    };

    if (hasComment) {
      result.postExecutionComment = decision.comment;
    }

    return result;
  }

  // Configuration methods
  addAutoApprove(toolName: string): void {
    this.autoApproveTools.add(toolName);
  }

  removeAutoApprove(toolName: string): void {
    this.autoApproveTools.delete(toolName);
  }

  addDenyList(toolName: string): void {
    this.alwaysDenyTools.add(toolName);
  }

  removeDenyList(toolName: string): void {
    this.alwaysDenyTools.delete(toolName);
  }

  setInteractive(enabled: boolean): void {
    this.interactive = enabled;
  }

  assessRisk(toolCall: any): string {
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

  getStatus(): ApprovalStatus {
    return {
      interactive: this.interactive,
      autoApprove: Array.from(this.autoApproveTools),
      denyList: Array.from(this.alwaysDenyTools)
    };
  }
}