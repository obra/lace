// ABOUTME: Task orchestration tool that enables agents to spawn sub-agents and coordinate work
// ABOUTME: Provides delegation, progress tracking, and help request capabilities for complex workflows

export class TaskTool {
  constructor(options = {}) {
    this.agent = null; // Will be set when tool is called by an agent
    this.progressTracker = options.progressTracker || null;
    this.defaultTimeout = options.defaultTimeout || 300000; // 5 minutes
  }

  async initialize() {
    // No async initialization needed currently
  }

  async delegateTask(params) {
    const { 
      description, 
      role = 'specialist',
      model = 'claude-3-5-sonnet-20241022',
      provider = 'anthropic',
      capabilities = ['reasoning', 'tool_calling'],
      timeout = this.defaultTimeout
    } = params;

    if (!description) {
      return {
        success: false,
        error: 'Task description is required'
      };
    }

    if (!this.agent) {
      return {
        success: false,
        error: 'TaskTool must be called from within an agent context'
      };
    }

    try {
      // Create timeout promise
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Task timed out after ${timeout}ms`)), timeout)
      );

      // Get current session ID - we'll need to pass this from the agent context
      // For now, we'll use a temporary session ID approach
      const sessionId = this.currentSessionId || `task-session-${Date.now()}`;
      
      // Delegate to sub-agent using existing infrastructure
      const taskPromise = this.agent.delegateTask(
        sessionId,
        description,
        {
          role,
          assignedModel: model,
          assignedProvider: provider,
          capabilities
        }
      );

      // Race timeout vs task completion
      const result = await Promise.race([taskPromise, timeoutPromise]);

      // Report progress if tracker available
      if (this.progressTracker) {
        await this.progressTracker.updateProgress(this.agent.generation, {
          status: 'completed',
          progressPercent: 100,
          details: `Task delegation completed: ${description.substring(0, 50)}...`
        });
      }

      return {
        success: true,
        result: result.content,
        metadata: {
          role,
          model,
          provider,
          taskDescription: description
        }
      };

    } catch (error) {
      // Report failure if tracker available
      if (this.progressTracker) {
        await this.progressTracker.updateProgress(this.agent.generation, {
          status: 'failed',
          progressPercent: 0,
          details: `Task delegation failed: ${error.message}`
        });
      }

      return {
        success: false,
        error: error.message,
        taskDescription: description
      };
    }
  }

  async spawnAgent(params) {
    const {
      role,
      model = 'claude-3-5-sonnet-20241022', 
      capabilities = ['reasoning', 'tool_calling'],
      task,
      provider = 'anthropic'
    } = params;

    if (!role || !task) {
      return {
        success: false,
        error: 'Role and task are required parameters'
      };
    }

    if (!this.agent) {
      return {
        success: false,
        error: 'TaskTool must be called from within an agent context'
      };
    }

    try {
      // Use existing spawnSubagent infrastructure
      const subagent = await this.agent.spawnSubagent({
        role,
        assignedModel: model,
        assignedProvider: provider,
        capabilities,
        task
      });

      // Execute the task  
      const sessionId = this.currentSessionId || `task-session-${Date.now()}`;
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
          task: task.substring(0, 100) + (task.length > 100 ? '...' : '')
        }
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        role,
        task: task.substring(0, 100) + (task.length > 100 ? '...' : '')
      };
    }
  }

  async reportProgress(params) {
    const {
      status,
      progressPercent = null,
      details = ''
    } = params;

    if (!status) {
      return {
        success: false,
        error: 'Status is required for progress reporting'
      };
    }

    if (!this.agent) {
      return {
        success: false,
        error: 'TaskTool must be called from within an agent context'
      };
    }

    try {
      if (this.progressTracker) {
        await this.progressTracker.updateProgress(this.agent.generation, {
          status,
          progressPercent,
          details: details.substring(0, 200), // Keep details concise
          timestamp: Date.now()
        });
      }

      return {
        success: true,
        agentId: this.agent.generation,
        status,
        progressPercent,
        details
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async requestHelp(params) {
    const {
      errorDescription,
      attemptedSolutions = [],
      helpNeeded
    } = params;

    if (!errorDescription || !helpNeeded) {
      return {
        success: false,
        error: 'Error description and help needed are required'
      };
    }

    if (!this.agent) {
      return {
        success: false,
        error: 'TaskTool must be called from within an agent context'
      };
    }

    try {
      // Report help request via progress tracker
      if (this.progressTracker) {
        await this.progressTracker.updateProgress(this.agent.generation, {
          status: 'needs_help',
          progressPercent: null,
          details: `Help needed: ${helpNeeded}`,
          timestamp: Date.now(),
          helpRequest: {
            errorDescription: errorDescription.substring(0, 500),
            attemptedSolutions: attemptedSolutions.map(s => s.substring(0, 100)),
            helpNeeded: helpNeeded.substring(0, 200)
          }
        });
      }

      return {
        success: true,
        agentId: this.agent.generation,
        helpRequestId: `help_${this.agent.generation}_${Date.now()}`,
        errorDescription,
        attemptedSolutions,
        helpNeeded
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Set the agent context when tool is used
  setAgent(agent) {
    this.agent = agent;
  }

  // Set current session ID
  setSessionId(sessionId) {
    this.currentSessionId = sessionId;
  }

  // Set progress tracker
  setProgressTracker(progressTracker) {
    this.progressTracker = progressTracker;
  }

  getSchema() {
    return {
      name: 'task',
      description: 'Agent orchestration tool for delegating tasks, spawning sub-agents, and coordinating complex workflows',
      methods: {
        delegateTask: {
          description: 'Delegate a task to a specialized sub-agent with optional role and model specification',
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
        spawnAgent: {
          description: 'Create a specialized sub-agent for complex workflows',
          parameters: {
            role: {
              type: 'string',
              required: true,
              description: 'Specific role for the sub-agent'
            },
            model: {
              type: 'string',
              required: false,
              description: 'Model to use for the sub-agent'
            },
            capabilities: {
              type: 'array',
              required: false,
              description: 'Array of capabilities for the sub-agent'
            },
            task: {
              type: 'string',
              required: true,
              description: 'Initial task for the spawned agent'
            },
            provider: {
              type: 'string',
              required: false,
              description: 'Model provider for the sub-agent'
            }
          }
        },
        reportProgress: {
          description: 'Send lightweight progress updates that are stored in memory (not conversation history)',
          parameters: {
            status: {
              type: 'string',
              required: true,
              description: 'Current status (e.g., "in_progress", "completed", "failed", "waiting")'
            },
            progressPercent: {
              type: 'number',
              required: false,
              description: 'Progress percentage (0-100) if applicable'
            },
            details: {
              type: 'string',
              required: false,
              description: 'Brief details about current progress (keep under 50 tokens)'
            }
          }
        },
        requestHelp: {
          description: 'Signal that the agent needs assistance with an error or problem',
          parameters: {
            errorDescription: {
              type: 'string',
              required: true,
              description: 'Description of the error or problem encountered'
            },
            attemptedSolutions: {
              type: 'array',
              required: false,
              description: 'Array of solutions that have been attempted'
            },
            helpNeeded: {
              type: 'string',
              required: true,
              description: 'Specific type of help or guidance needed'
            }
          }
        }
      }
    };
  }
}