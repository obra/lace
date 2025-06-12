// ABOUTME: Agent delegation tool for spawning and coordinating sub-agents
// ABOUTME: Provides focused task delegation capabilities with timeout and role management

import { BaseTool, ToolSchema, ToolContext } from './base-tool.js';
import { getRole } from "../agents/role-registry.ts";

export interface DelegateTaskParams {
  description: string;
  role?: string;
  model?: string;
  provider?: string;
  capabilities?: string[];
  timeout?: number;
}

export interface DelegateTaskResult {
  success: boolean;
  result?: string;
  error?: string;
  metadata?: {
    role: string;
    model: string;
    provider: string;
    taskDescription: string;
  };
}

export interface SpawnAgentParams {
  role: string;
  task: string;
  model?: string;
  provider?: string;
  capabilities?: string[];
}

export interface SpawnAgentResult {
  success: boolean;
  agentId?: string;
  result?: string;
  error?: string;
  metadata?: {
    role: string;
    model: string;
    provider: string;
    capabilities: string[];
    task: string;
  };
}

export class AgentDelegateTool extends BaseTool {
  private defaultTimeout = 300000; // 5 minutes

  getSchema(): ToolSchema {
    return {
      name: 'agent_delegate',
      description: 'Delegate tasks to specialized sub-agents with configurable roles and models',
      methods: {
        delegate_task: {
          description: 'Delegate a task to a specialized sub-agent',
          parameters: {
            description: {
              type: 'string',
              required: true,
              description: 'Clear description of the task to be delegated'
            },
            role: {
              type: 'string',
              required: false,
              description: 'Role for the sub-agent (e.g., "specialist", "researcher", "coder")'
            },
            model: {
              type: 'string',
              required: false,
              description: 'Model to use for the sub-agent (e.g., "claude-3-5-sonnet-20241022")'
            },
            provider: {
              type: 'string',
              required: false,
              description: 'Model provider (e.g., "anthropic", "openai")'
            },
            capabilities: {
              type: 'array',
              required: false,
              description: 'Array of capabilities for the sub-agent'
            },
            timeout: {
              type: 'number',
              required: false,
              description: 'Timeout in milliseconds for task completion'
            }
          }
        },
        spawn_agent: {
          description: 'Create a specialized sub-agent for complex workflows',
          parameters: {
            role: {
              type: 'string',
              required: true,
              description: 'Specific role for the sub-agent'
            },
            task: {
              type: 'string',
              required: true,
              description: 'Initial task for the spawned agent'
            },
            model: {
              type: 'string',
              required: false,
              description: 'Model to use for the sub-agent'
            },
            provider: {
              type: 'string',
              required: false,
              description: 'Model provider for the sub-agent'
            },
            capabilities: {
              type: 'array',
              required: false,
              description: 'Array of capabilities for the sub-agent'
            }
          }
        }
      }
    };
  }

  async delegate_task(params: DelegateTaskParams, context?: ToolContext): Promise<DelegateTaskResult> {
    const {
      description,
      role = "general",
      model = "claude-3-5-sonnet-20241022",
      provider = "anthropic",
      capabilities = ["reasoning", "tool_calling"],
      timeout = this.defaultTimeout,
    } = params;

    if (!description) {
      return {
        success: false,
        error: "Task description is required",
      };
    }

    // Validate role name
    try {
      getRole(role);
    } catch (error: any) {
      return {
        success: false,
        error: `Invalid role '${role}': ${error.message}`,
      };
    }

    // Get agent from context - required for delegation
    const agent = context?.context?.agent;
    if (!agent) {
      return {
        success: false,
        error: "Agent context is required for task delegation",
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

      // Delegate to sub-agent using existing infrastructure
      const taskPromise = agent.delegateTask(sessionId, description, {
        role,
        assignedModel: model,
        assignedProvider: provider,
        capabilities,
      });

      // Race timeout vs task completion
      const result = await Promise.race([taskPromise, timeoutPromise]);

      return {
        success: true,
        result: result.content,
        metadata: {
          role,
          model,
          provider,
          taskDescription: description,
        },
      };
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

  async spawn_agent(params: SpawnAgentParams, context?: ToolContext): Promise<SpawnAgentResult> {
    const {
      role,
      task,
      model = "claude-3-5-sonnet-20241022",
      provider = "anthropic",
      capabilities = ["reasoning", "tool_calling"],
    } = params;

    if (!role || !task) {
      return {
        success: false,
        error: "Role and task are required parameters",
      };
    }

    // Get agent from context - required for spawning
    const agent = context?.context?.agent;
    if (!agent) {
      return {
        success: false,
        error: "Agent context is required for spawning sub-agents",
      };
    }

    try {
      // Check for cancellation before starting
      if (context?.signal?.aborted) {
        throw new Error('Agent spawning was cancelled');
      }

      // Use existing spawnSubagent infrastructure
      const subagent = await agent.spawnSubagent({
        role,
        assignedModel: model,
        assignedProvider: provider,
        capabilities,
        task,
      });

      // Execute the task
      const sessionId = context?.context?.sessionId || `task-session-${Date.now()}`;
      const result = await subagent.generateResponse(sessionId, task);

      return {
        success: true,
        agentId: subagent.generation,
        result: result.content,
        metadata: {
          role,
          model,
          provider,
          capabilities,
          task: task.length > 100 ? task.substring(0, 100) + "..." : task,
        },
      };
    } catch (error: any) {
      if (context?.signal?.aborted) {
        return {
          success: false,
          error: 'Agent spawning was cancelled',
        };
      }

      return {
        success: false,
        error: error.message,
      };
    }
  }
}