# Agent Delegation Tool Redesign

## Problem Statement

Our current agent delegation tool has a complex interface with many optional parameters, making it difficult to use effectively. After analyzing Claude Code's Task tool, we need a redesign that prioritizes simplicity and clarity over complex orchestration.

## Core Design Philosophy

### Fire-and-Forget Simplicity
Delegation should be as simple as: give task → agent works → get result. No complex lifecycle management, coordination, or resource monitoring.

### Clear Purpose Over Configuration
Users should focus on what they want accomplished, not on configuring agent parameters.

### Autonomous Execution
Once delegated, the agent should work independently and return complete results without requiring ongoing management.

## Proposed Interface Design

### Primary Method: `delegate`

```typescript
delegate: {
  description: 'Assign a focused task to a specialized sub-agent',
  parameters: {
    purpose: {
      type: 'string',
      required: true,
      description: 'What this delegation accomplishes (e.g., "security analysis", "performance review")'
    },
    specification: {
      type: 'string',
      required: true, 
      description: 'Complete task requirements including scope, deliverables, and success criteria'
    },
    role: {
      type: 'string',
      required: false,
      enum: ['orchestrator', 'execution', 'reasoning', 'planning', 'memory', 'synthesis', 'general'],
      description: 'Agent specialization (auto-selected based on task if not specified)'
    }
  }
}
```

### Smart Role Selection

The tool automatically selects appropriate roles based on task characteristics:

- **Execution role**: "implement", "fix", "run", "update" → uses Claude Haiku for efficiency
- **Reasoning role**: "analyze", "debug", "compare", "review" → uses Claude Sonnet for deep thinking  
- **Orchestrator role**: "plan", "coordinate", "organize", "migrate" → uses Claude Sonnet for coordination
- **General role**: Default fallback for ambiguous tasks

Users can override auto-selection when they know better.

### That's It - No Batch Operations

Keep it simple. If you need multiple delegations, make multiple calls. Don't try to coordinate - let each delegation be independent.

## Decision Matrix: When to Delegate

### Delegate When:
- **Complex analysis requiring deep focus** (code architecture review, security audit) → auto-selects `reasoning` role
- **Implementation tasks needing efficient execution** (fixing tests, updating configs) → auto-selects `execution` role
- **Multi-step planning requiring coordination** (migration planning, feature breakdown) → auto-selects `orchestrator` role
- **Tasks where specialized models would perform better** (Haiku for execution, Sonnet for reasoning)

### Don't Delegate When:
- **Simple data retrieval or manipulation** (reading files, basic text processing)
- **Single-action operations** (running one command, making one API call)
- **Tasks where context handoff costs exceed benefits** (small modifications to current work)
- **Operations requiring real-time interaction** (debugging, iterative refinement)

### Role Override Examples:
```typescript
// Auto-selection works
{ purpose: "analyze performance", specification: "..." } // → reasoning role

// Manual override when you know better  
{ purpose: "analyze performance", specification: "...", role: "execution" } // → execution role
```

## Error Handling Strategy

### Structured Feedback

```typescript
interface DelegationResult {
  success: boolean;
  outcome?: string;
  error?: {
    category: 'specification' | 'resource' | 'execution' | 'timeout';
    message: string;
    guidance: string[];
    context: Record<string, any>;
  };
  metadata: {
    agent_id: string;
    execution_time: number;
    resource_usage: ResourceStats;
  };
}
```

### Example Error Response

```typescript
{
  success: false,
  error: {
    category: 'specification',
    message: 'Task specification lacks clear deliverable definition',
    guidance: [
      'Define what specific output format is expected',
      'Specify measurable completion criteria', 
      'Include relevant constraints or limitations'
    ],
    context: {
      purpose: 'code review',
      specification_length: 45
    }
  }
}
```

## Keep Resource Management Simple

The current system probably already handles basic resource management. Don't over-engineer it:
- Use reasonable default timeouts
- Let the system handle agent cleanup automatically
- Trust that one-at-a-time delegation won't overwhelm resources

## Simple Implementation Changes

### Just Add Usage Guidance to Schema

```typescript
export interface ToolSchema {
  name: string;
  description: string;
  methods: Record<string, MethodDefinition>;
  // Add this:
  usage_guidance?: string;  // Simple, flexible guidance text
}
```

### Example Usage Guidance

```typescript
usage_guidance: `Use this tool when you need focused work on complex tasks:

DELEGATE WHEN:
- Complex analysis requiring deep focus (security audits, architecture reviews)  
- Implementation tasks needing efficient execution (fixing tests, updating configs)
- Multi-step planning requiring coordination (migrations, feature breakdown)

DON'T DELEGATE WHEN:
- Simple file operations (reading, basic text processing)
- Single commands or API calls
- Small modifications to current work

EXAMPLES:
- delegate({ purpose: "security analysis", specification: "Review auth code for vulnerabilities..." })
- delegate({ purpose: "fix test failures", specification: "Run tests, identify issues, implement fixes...", role: "execution" })

Auto-selects appropriate roles: 'analyze' → reasoning, 'implement' → execution, 'plan' → orchestrator`

### Auto-Role Selection Logic

```typescript
function selectRole(purpose: string, specification: string): string {
  const purposeLower = purpose.toLowerCase();
  
  // Execution patterns → Claude Haiku for efficiency
  if (purposeLower.includes('implement') || purposeLower.includes('fix') || 
      purposeLower.includes('run') || purposeLower.includes('update')) {
    return 'execution';
  }
  
  // Reasoning patterns → Claude Sonnet for deep thinking
  if (purposeLower.includes('analyze') || purposeLower.includes('debug') ||
      purposeLower.includes('compare') || purposeLower.includes('review')) {
    return 'reasoning';
  }
  
  // Orchestration patterns → Claude Sonnet for coordination
  if (purposeLower.includes('plan') || purposeLower.includes('coordinate') ||
      purposeLower.includes('organize') || purposeLower.includes('migrate')) {
    return 'orchestrator';
  }
  
  return 'general'; // Safe default
}
```

### Use Existing Agent Infrastructure

Don't build new lifecycle management. Use what's already there:
- Current agent spawning works fine
- Existing timeout handling is probably sufficient  
- Current error handling just needs better messages

## Simple Implementation Plan

### Just Do This
1. **Add usage_guidance field** to ToolSchema interface (one optional string)
2. **Simplify parameters**: purpose + specification + optional role
3. **Add auto-role selection**: smart defaults based on task keywords  
4. **Add comprehensive guidance**: when to delegate, examples, role auto-selection info
5. **Improve error messages**: specific suggestions instead of generic failures
6. **Keep everything else the same**: use existing agent spawning, timeouts, cleanup

### Don't Do This
- Complex resource management
- Batch coordination 
- Agent lifecycle monitoring
- Inter-agent communication
- Advanced orchestration

The current system probably works fine. Just make it easier to use correctly.

## Success Metrics

### The Only Things That Matter
- **Easier to use**: People can figure out when to delegate without reading docs
- **Better results**: Delegations succeed more often because the interface is clearer
- **Less confusion**: Error messages help people fix problems instead of giving up

### Don't Measure
- Resource utilization efficiency
- Concurrent execution throughput  
- System resource contention
- Setup overhead optimization

Those are probably fine already.

## Conclusion

The real lesson from Claude Code's Task tool isn't complex orchestration - it's **radical simplicity**:

- Two parameters instead of many
- Clear guidance on when to use it  
- Fire-and-forget execution
- Let the existing system handle the complexity

Your current agent delegation tool probably already does the hard parts correctly. The improvement is making it obvious **when** and **how** to use it, not adding more features.

Keep it simple. Make it clear. Trust that the underlying system works.