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

  constructor(config: ApprovalEngineConfig = {}) {
    this.autoApproveTools = new Set(config.autoApproveTools || []);
    this.alwaysDenyTools = new Set(config.alwaysDenyTools || []);
    this.interactive = config.interactive !== false; // Default to true
  }

  checkAutoApproval(request: ApprovalRequest): ApprovalResult | null {
    const toolName = request.toolCall.name;

    // Check deny list first (takes precedence)
    if (this.alwaysDenyTools.has(toolName)) {
      return {
        approved: false,
        reason: 'Tool is on deny list',
        modifiedCall: null
      };
    }

    // Check auto-approve list
    if (this.autoApproveTools.has(toolName)) {
      return {
        approved: true,
        reason: 'Tool is on auto-approve list',
        modifiedCall: request.toolCall
      };
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

  getStatus(): ApprovalStatus {
    return {
      interactive: this.interactive,
      autoApprove: Array.from(this.autoApproveTools),
      denyList: Array.from(this.alwaysDenyTools)
    };
  }
}