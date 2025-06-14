# LaceUI Refactoring Plan

## Analysis Summary

After analyzing `src/ui/lace-ui.ts`, several opportunities were identified to improve the code following YAGNI principles, reducing duplication, and making it cleaner and simpler.

### Key Issues Found

1. **God Class Pattern**: LaceUI tries to do everything - UI management, agent orchestration, activity logging, tool approval, file completion, conversation config, etc.

2. **YAGNI Violations**: 
   - `updateConversationConfig()` - Never called from production code (test-only)
   - `getConversationConfig()` - Only used to populate unused `config` field in status display (the `/status` command modal doesn't even show configuration data)

3. **Excessive Activity Logging Duplication**: 4 separate private methods (`logUserInput`, `logAgentResponse`, `logStreamingToken`, `logToolExecutions`) with repetitive error handling + 3 public retrieval methods + 1 command handler

4. **Mixed Responsibilities**: Backend agent management mixed with UI concerns and logging

5. **Configuration Complexity**: Options interface has too many fields, some with duplicate meanings

## Refactoring Strategy

### 1. Extract Activity Coordination (Priority: High)
**File**: `src/ui/activity-coordinator.ts`

Consolidate all activity logging methods from LaceUI:

```typescript
export class ActivityCoordinator {
  constructor(activityLogger: ActivityLogger, verbose: boolean, conversation: Conversation)
  
  // Consolidate 4 private logging methods
  async logUserInput(input: string): Promise<void>
  async logAgentResponse(response: AgentResponse, duration: number): Promise<void>  
  async logStreamingToken(token: string, position: number): Promise<void>
  async logToolExecutions(toolCalls: any[], toolResults: any[]): Promise<void>
  
  // Consolidate 3 retrieval methods + command handler
  async getRecentActivity(limit?: number): Promise<any[]>
  async getSessionActivity(sessionId?: string): Promise<any[]>
  async getActivityByType(eventType: string): Promise<any[]>
  async handleActivityCommand(subcommand: string, options?: any): Promise<any[]>
}
```

**What moves here:**
- Lines 388-482: All 4 private logging methods 
- Lines 485-516: All 3 activity retrieval methods
- Lines 519-534: `handleActivityCommand` method

### 2. Extract Agent Coordination (Priority: High)  
**File**: `src/agents/agent-coordinator.ts`

Handle agent lifecycle, handoffs, and configuration management:

```typescript
export class AgentCoordinator {
  constructor(options: AgentCoordinatorOptions)
  
  async initialize(): Promise<void>
  
  // Agent management
  createPrimaryAgent(): Agent
  async handoffContext(): Promise<Agent>
  
  // Status calculations extracted from LaceUI.getStatus()
  getAgentStatus(): AgentStatusInfo
  calculateContextUsage(): ContextUsage
  calculateCost(): CostInfo
  
  // Accessors
  get primaryAgent(): Agent
  get memoryAgents(): Map<string, Agent>
  get currentGeneration(): number
}
```

**What moves here:**
- Agent creation logic from constructor (lines 136-147)
- Lines 284-307: `handoffContext` method
- Status calculation logic from `getStatus` (lines 315-342)

### 3. Extract Tool Approval Coordination (Priority: Medium)
**File**: `src/ui/tool-approval-coordinator.ts`

Bridge tool approval between backend and UI:

```typescript
export class ToolApprovalCoordinator {
  constructor(approvalEngine: ApprovalEngine)
  
  setUICallback(callback: ToolApprovalCallback): void
  async requestApproval(toolCall: any, riskLevel: string, context?: any): Promise<ApprovalResult>
  getApprovalSettings(): ApprovalSettings
}
```

**What moves here:**
- Lines 309-313: `setToolApprovalUICallback` method
- Approval request coordination logic

### 4. Simplified LaceUI Class (Priority: High)
**File**: `src/ui/lace-ui.ts`

Focus on UI lifecycle and message coordination only:

```typescript
export class LaceUI {
  private activityCoordinator: ActivityCoordinator
  private agentCoordinator: AgentCoordinator  
  private toolApprovalCoordinator: ToolApprovalCoordinator
  
  constructor(options: LaceUIOptions)
  async initialize(): Promise<void>
  async start(): Promise<any>
  
  // Core message handling (simplified)
  async handleMessage(input: string): Promise<UIResponse>
  handleAbort(): boolean
  
  // Status delegation
  getStatus() {
    return {
      agent: this.agentCoordinator.getAgentStatus(),
      context: this.agentCoordinator.calculateContextUsage(),
      cost: this.agentCoordinator.calculateCost(),
      tools: this.tools.listTools(),
      session: this.conversation.getSessionId(),
      conversation: this.agentCoordinator.primaryAgent.getConversationMetrics(),
      // config: REMOVED - not displayed in UI
    }
  }
  
  // File completion (kept in LaceUI since it's UI-specific)
  async getFileCompletions(prefix: string): Promise<any[]>
  
  // Activity delegation  
  async handleActivityCommand(subcommand: string, options?: any) {
    return this.activityCoordinator.handleActivityCommand(subcommand, options)
  }
}
```

## Code Elimination

**Remove entirely from LaceUI** (YAGNI violations):
- Lines 344-350: `updateConversationConfig` method - never called from production
- Line 340: `config: this.primaryAgent.getConversationConfig(),` - unused in status display

**Move to dedicated coordinators:**
- Lines 388-482: All private activity logging methods → ActivityCoordinator
- Lines 485-534: All activity retrieval and command methods → ActivityCoordinator  
- Lines 284-307: `handoffContext` method → AgentCoordinator
- Lines 309-313: `setToolApprovalUICallback` method → ToolApprovalCoordinator
- Agent creation logic from constructor → AgentCoordinator
- Status calculation logic → AgentCoordinator

**Total reduction**: ~200 lines of code removed from LaceUI

## Benefits

- **YAGNI Compliance**: Remove unused configuration methods entirely
- **Single Responsibility**: Each class has one clear purpose  
- **Reduced Duplication**: Eliminate repetitive logging and error handling
- **Testability**: Smaller, focused classes are easier to test
- **Maintainability**: Clear separation of UI vs backend concerns
- **Simplified Status**: Remove unused config field from status display

## Implementation Approach

1. **Progressive refactoring**: Move code in logical chunks to maintain functionality
2. **Follow existing patterns**: ESM modules, TypeScript migration strategy
3. **Maintain existing public interface**: During transition period
4. **Add proper TypeScript interfaces**: For new classes

## Files to Create/Modify

1. **NEW**: `src/ui/activity-coordinator.ts` - Activity logging consolidation
2. **NEW**: `src/agents/agent-coordinator.ts` - Agent lifecycle management  
3. **NEW**: `src/ui/tool-approval-coordinator.ts` - Tool approval UI integration
4. **MODIFY**: `src/ui/lace-ui.ts` - Simplified to core UI concerns only

## Validation

- All existing tests should continue to pass
- UI functionality should remain unchanged
- Performance should improve due to better separation of concerns
- Code should be more maintainable and testable