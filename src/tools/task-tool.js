// ABOUTME: Task orchestration tool that enables agents to spawn sub-agents and coordinate work
// ABOUTME: Provides delegation, progress tracking, and help request capabilities for complex workflows

import { getRole } from '../agents/role-registry.ts';
export class TaskTool {
  constructor(options = {}) {
    this.agent = null; // Will be set when tool is called by an agent
    this.progressTracker = options.progressTracker || null;
    this.defaultTimeout = options.defaultTimeout || 300000; // 5 minutes
    
    // Inter-agent communication
    this.messageQueue = new Map(); // recipientId -> messages[]
    this.agentRelationships = new Map(); // agentId -> relationship info
    this.maxMessageLength = options.maxMessageLength || 1000;
    this.maxQueueSize = options.maxQueueSize || 100;
    this.messageCleanupInterval = options.messageCleanupInterval || 3600000; // 1 hour
    
    // Valid message types
    this.validMessageTypes = ['status_update', 'request_help', 'share_result', 'coordination'];
  }

  async initialize() {
    // No async initialization needed currently
  }

  setAgent(agent) {
    this.agent = agent;
  }

  setSessionId(sessionId) {
    this.currentSessionId = sessionId;
  }

  setProgressTracker(progressTracker) {
    this.progressTracker = progressTracker;
  }

  async delegateTask(params) {
    const { 
      description, 
      role = 'general',
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

    // Validate role name
    try {
      getRole(role);
    } catch (error) {
      return {
        success: false,
        error: `Invalid role '${role}': ${error.message}`
      };
    }

    if (!this.agent) {
      return {
        success: false,
        error: 'TaskTool must be called from within an agent context'
      };
    }

    let timeoutId;
    try {
      // Create timeout promise with clearable timeout
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Task timed out after ${timeout}ms`)), timeout);
      });

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
      
      // Clear timeout if task completed successfully
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

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
      // Clear timeout in case of error
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      
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

      // Register the parent-child relationship
      this.registerAgentRelationship(subagent.generation, {
        parentId: this.agent.agentId || this.agent.generation.toString(),
        role,
        status: 'active'
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

  async sendMessage(params) {
    const {
      recipientId,
      messageType,
      content,
      priority = 'medium'
    } = params;

    // Validate required parameters
    if (!recipientId || !messageType) {
      return {
        success: false,
        error: 'recipientId and messageType are required'
      };
    }

    // Validate message type
    if (!this.validMessageTypes.includes(messageType)) {
      return {
        success: false,
        error: `Invalid message type. Must be one of: ${this.validMessageTypes.join(', ')}`
      };
    }

    // Validate agent context
    if (!this.agent) {
      return {
        success: false,
        error: 'TaskTool must be called from within an agent context'
      };
    }

    try {
      // Truncate content if too long
      let messageContent = content || '';
      let contentTruncated = false;
      let originalLength = messageContent.length;

      if (messageContent.length > this.maxMessageLength) {
        messageContent = messageContent.substring(0, this.maxMessageLength);
        contentTruncated = true;
      }

      // Generate unique message ID
      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const timestamp = Date.now();

      // Create message object
      const message = {
        messageId,
        senderId: this.agent.agentId || this.agent.generation.toString(),
        senderRole: this.agent.role,
        recipientId,
        messageType,
        content: messageContent,
        priority,
        timestamp,
        read: false
      };

      // Get recipient's message queue
      if (!this.messageQueue.has(recipientId)) {
        this.messageQueue.set(recipientId, []);
      }

      const recipientQueue = this.messageQueue.get(recipientId);
      
      // Add message to queue
      recipientQueue.push(message);

      // Cleanup old messages and enforce size limits
      this.cleanupMessageQueue(recipientId);

      return {
        success: true,
        messageId,
        senderId: message.senderId,
        recipientId,
        messageType,
        content: messageContent,
        priority,
        timestamp,
        contentTruncated,
        originalLength: contentTruncated ? originalLength : messageContent.length
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async receiveMessages(params = {}) {
    const {
      messageType = null,
      limit = 50,
      markAsRead = false
    } = params;

    if (!this.agent) {
      return {
        success: false,
        error: 'TaskTool must be called from within an agent context'
      };
    }

    try {
      // Handle corrupted message queue
      if (!this.messageQueue || !(this.messageQueue instanceof Map)) {
        this.messageQueue = new Map();
        return {
          success: true,
          messages: [],
          unreadCount: 0,
          totalMessages: 0,
          error: 'Message queue corrupted, reset to empty state'
        };
      }

      const agentId = this.agent.agentId || this.agent.generation.toString();
      
      // Cleanup old messages for this agent when retrieving
      this.cleanupMessageQueue(agentId);
      
      const messages = this.messageQueue.get(agentId) || [];

      // Filter by message type if specified
      let filteredMessages = messages;
      if (messageType) {
        filteredMessages = messages.filter(msg => msg.messageType === messageType);
      }

      // Sort by timestamp (newest first)
      filteredMessages.sort((a, b) => b.timestamp - a.timestamp);

      // Apply limit
      const limitedMessages = filteredMessages.slice(0, limit);

      // Count unread messages BEFORE marking as read
      const unreadCount = markAsRead ? limitedMessages.filter(msg => !msg.read).length : filteredMessages.filter(msg => !msg.read).length;

      // Mark as read if requested
      if (markAsRead) {
        limitedMessages.forEach(msg => {
          msg.read = true;
        });
      }

      return {
        success: true,
        messages: limitedMessages,
        unreadCount,
        totalMessages: filteredMessages.length
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        messages: [],
        unreadCount: 0
      };
    }
  }

  cleanupMessageQueue(recipientId) {
    const queue = this.messageQueue.get(recipientId);
    if (!queue) return;

    const now = Date.now();
    
    // Remove old messages (older than cleanup interval)
    const filteredMessages = queue.filter(msg => 
      (now - msg.timestamp) < this.messageCleanupInterval
    );

    // Enforce size limit (keep most recent messages)
    if (filteredMessages.length > this.maxQueueSize) {
      filteredMessages.sort((a, b) => b.timestamp - a.timestamp);
      filteredMessages.splice(this.maxQueueSize);
    }

    this.messageQueue.set(recipientId, filteredMessages);
  }

  registerAgentRelationship(agentId, relationshipInfo) {
    this.agentRelationships.set(agentId, relationshipInfo);
  }

  getAgentRelationships() {
    return Object.fromEntries(this.agentRelationships);
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
        },
        sendMessage: {
          description: 'Send a message to another agent for coordination without going through coordinator',
          parameters: {
            recipientId: {
              type: 'string',
              required: true,
              description: 'ID of the agent to send the message to'
            },
            messageType: {
              type: 'string',
              required: true,
              description: 'Type of message: status_update, request_help, share_result, coordination'
            },
            content: {
              type: 'string',
              required: false,
              description: 'Message content (max 1000 characters)'
            },
            priority: {
              type: 'string',
              required: false,
              description: 'Message priority: low, medium, high (default: medium)'
            }
          }
        },
        receiveMessages: {
          description: 'Check for incoming messages from other agents',
          parameters: {
            messageType: {
              type: 'string',
              required: false,
              description: 'Filter by message type (optional)'
            },
            limit: {
              type: 'number',
              required: false,
              description: 'Maximum number of messages to return (default: 50)'
            },
            markAsRead: {
              type: 'boolean',
              required: false,
              description: 'Mark retrieved messages as read (default: false)'
            }
          }
        }
      }
    };
  }
}
