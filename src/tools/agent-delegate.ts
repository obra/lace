// ABOUTME: Agent delegation tool for spawning and coordinating sub-agents
// ABOUTME: Provides focused task delegation capabilities with timeout and role management

import { BaseTool, ToolSchema, ToolContext } from './base-tool.js';
import { getRole } from "../agents/agent-registry.ts";
import { Agent } from "../agents/agent.ts";
import { Conversation } from "../conversation/conversation.js";

export interface DelegateTaskParams {
  purpose: string;
  instructions: string;
  role?: string;
}

export interface DelegateTaskResult {
  success: boolean;
  result?: string;
  error?: string;
  metadata?: {
    role: string;
    taskDescription: string;
  };
}

export class AgentDelegateTool extends BaseTool {
  private defaultTimeout = 300000; // 5 minutes

  /**
   * Auto-select appropriate role based on purpose keywords
   */
  private selectRole(purpose: string, instructions: string): string {
    const purposeLower = purpose.toLowerCase();
    
    // Execution patterns → execution role for efficiency
    if (purposeLower.includes('implement') || purposeLower.includes('fix') || 
        purposeLower.includes('run') || purposeLower.includes('update')) {
      return 'execution';
    }
    
    // Reasoning patterns → reasoning role for deep thinking
    if (purposeLower.includes('analyze') || purposeLower.includes('debug') ||
        purposeLower.includes('compare') || purposeLower.includes('review')) {
      return 'reasoning';
    }
    
    // Orchestration patterns → orchestrator role for coordination
    if (purposeLower.includes('plan') || purposeLower.includes('coordinate') ||
        purposeLower.includes('organize') || purposeLower.includes('migrate')) {
      return 'orchestrator';
    }
    
    return 'general'; // Safe default
  }

  getMetadata(): ToolSchema {
    return {
      name: 'agent_delegate',
      description: 'Delegate tasks to specialized sub-agents with configurable roles and models',
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
- delegate_task({ purpose: "security analysis", instructions: "Review auth code for vulnerabilities..." })
- delegate_task({ purpose: "fix test failures", instructions: "Run tests, identify issues, implement fixes...", role: "execution" })

Auto-selects appropriate roles: 'analyze' → reasoning, 'implement' → execution, 'plan' → orchestrator`,
      methods: {
        run: {
          description: 'Delegate a focused task to a specialized sub-agent',
          parameters: {
            purpose: {
              type: 'string',
              required: true,
              description: 'What this delegation accomplishes (e.g., "security analysis", "performance review")'
            },
            instructions: {
              type: 'string',
              required: true,
              description: 'Complete task requirements including scope, deliverables, and success criteria'
            },
            role: {
              type: 'string',
              required: false,
              description: 'Agent specialization (auto-selected based on task if not specified)'
            }
          }
        },
      }
    };
  }

  async run(params: DelegateTaskParams, context?: ToolContext): Promise<DelegateTaskResult> {
    const {
      purpose,
      instructions,
      role,
    } = params;

    if (!purpose) {
      return {
        success: false,
        error: "Purpose is required",
      };
    }

    if (!instructions) {
      return {
        success: false,
        error: "Instructions are required",
      };
    }

    // Auto-select role if not provided
    const selectedRole = role || this.selectRole(purpose, instructions);
    
    const timeout = this.defaultTimeout;

    // Validate role name
    try {
      getRole(selectedRole);
    } catch (error: any) {
      return {
        success: false,
        error: `Invalid role '${selectedRole}': ${error.message}`,
      };
    }

    // Get tools and modelProvider from context to create subagent
    const { tools, modelProvider, toolApproval, debugLogger, activityLogger } = context?.context || {};
    if (!tools || !modelProvider) {
      return {
        success: false,
        error: "Tools and modelProvider are required for task delegation",
      };
    }

    let timeoutId: NodeJS.Timeout | undefined;
    try {
      // Check for cancellation before starting
      if (context?.signal?.aborted) {
        throw new Error('Task delegation was cancelled');
      }

      // Create timeout promise with clearable timeout
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Task timed out after ${timeout}ms`)),
          timeout,
        );
      });

      // Get current session ID from context
      const sessionId = context?.context?.sessionId || `task-session-${Date.now()}`;

      // Combine purpose and instructions into task description
      const taskDescription = `${purpose}: ${instructions}`;
      
      // Create and use subagent directly
      const roleDefinition = getRole(selectedRole);
      const subagent = new Agent({
        tools,
        modelProvider,
        model: modelProvider.getModelSession(roleDefinition.defaultModel),
        role: selectedRole,
        task: taskDescription,
        toolApproval,
        debugLogger,
        activityLogger,
        generation: 0.1, // Mark as subagent
      });
      
      const delegateConversation = await Conversation.load(sessionId);
      const taskPromise = subagent.generateResponse(delegateConversation, taskDescription);

      // Race timeout vs task completion
      const result = await Promise.race([taskPromise, timeoutPromise]);

      // Type guard to ensure we have a valid result
      if (result && typeof result === 'object' && 'content' in result) {
        return {
          success: true,
          result: String(result.content),
          metadata: {
            role: selectedRole,
            taskDescription,
          },
        };
      } else {
        return {
          success: false,
          error: "Invalid result from subagent",
        };
      }
    } catch (error: any) {
      if (context?.signal?.aborted) {
        return {
          success: false,
          error: 'Task delegation was cancelled',
        };
      }

      return {
        success: false,
        error: error.message,
      };
    } finally {
      // Clear timeout in all cases
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

}
