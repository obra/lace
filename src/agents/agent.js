// ABOUTME: Core agent class that handles reasoning, tool calls, and context management
// ABOUTME: Implements multi-generational memory and subagent coordination

export class Agent {
  constructor(options = {}) {
    this.generation = options.generation || 0;
    this.tools = options.tools;
    this.db = options.db;
    this.modelProvider = options.modelProvider;
    this.verbose = options.verbose || false;
    this.inheritedContext = options.inheritedContext || null;
    this.memoryAgents = options.memoryAgents || new Map();
    
    // Agent assignment - told by orchestrator
    this.assignedModel = options.assignedModel || 'claude-3-5-sonnet-20241022';
    this.assignedProvider = options.assignedProvider || 'anthropic';
    this.role = options.role || 'general';
    this.task = options.task || null;
    this.capabilities = options.capabilities || ['reasoning', 'tool_calling'];
    
    // Tool approval system
    this.toolApproval = options.toolApproval || null;
    
    this.contextSize = 0;
    this.maxContextSize = 100000; // TODO: Get from model API
    this.handoffThreshold = 0.8; // Handoff at 80% capacity
    
    this.systemPrompt = this.buildSystemPrompt();
  }

  async processInput(sessionId, input) {
    try {
      // Save user message
      await this.db.saveMessage(sessionId, this.generation, 'user', input);
      
      // Check if we need to handoff context
      if (this.shouldHandoff()) {
        console.log('🔄 Context approaching limit, preparing handoff...');
        // TODO: Implement handoff logic
      }

      // Simple echo response for now - TODO: Implement actual reasoning
      const response = await this.generateResponse(input);
      
      // Save agent response
      await this.db.saveMessage(sessionId, this.generation, 'assistant', response.content, response.toolCalls, this.contextSize);
      
      return response;
    } catch (error) {
      return {
        error: error.message
      };
    }
  }

  async generateResponse(input) {
    try {
      // Build conversation history for context
      const messages = [
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: input }
      ];

      // Get available tools for the LLM
      const availableTools = this.buildToolsForLLM();

      // Use assigned model and provider
      const response = await this.modelProvider.chat(messages, {
        provider: this.assignedProvider,
        model: this.assignedModel,
        tools: availableTools,
        maxTokens: 4096
      });

      if (!response.success) {
        return {
          content: `Error: ${response.error}`,
          error: response.error
        };
      }

      // Execute any tool calls with approval
      const toolResults = [];
      let finalContent = response.content;
      let shouldStop = false;

      if (response.toolCalls && response.toolCalls.length > 0) {
        for (const toolCall of response.toolCalls) {
          try {
            // Request approval if approval system is available
            let approvedCall = toolCall;
            let postExecutionComment = null;
            
            if (this.toolApproval) {
              const approval = await this.toolApproval.requestApproval(toolCall, {
                reasoning: response.content,
                agent: this.role,
                sessionId: sessionId
              });

              if (!approval.approved) {
                toolResults.push({
                  toolCall,
                  error: `Tool execution denied: ${approval.reason}`,
                  denied: true
                });

                if (approval.shouldStop) {
                  shouldStop = true;
                  finalContent += '\n\n⏸️ Execution stopped by user. Please provide further instructions.';
                  break;
                }
                continue;
              }

              approvedCall = approval.modifiedCall || toolCall;
              postExecutionComment = approval.postExecutionComment;
            }

            const result = await this.executeTool(approvedCall);
            toolResults.push({
              toolCall: approvedCall,
              result,
              approved: true
            });

            // If this was a calculation, append the result to the content
            if (approvedCall.name.includes('calculate') && result.success) {
              finalContent += `\n\nResult: ${result.result}`;
            }

            // Add post-execution comment if provided
            if (postExecutionComment) {
              finalContent += `\n\n💭 User note: ${postExecutionComment}`;
            }

          } catch (error) {
            toolResults.push({
              toolCall,
              error: error.message
            });
          }
        }
      }

      return {
        content: finalContent,
        toolCalls: response.toolCalls,
        toolResults,
        usage: response.usage,
        stopped: shouldStop
      };
    } catch (error) {
      return {
        content: `Error generating response: ${error.message}`,
        error: error.message
      };
    }
  }

  buildSystemPrompt() {
    const basePrompt = `You are a specialized agent in the Lace agentic coding environment.

AGENT CONFIGURATION:
- Role: ${this.role}
- Model: ${this.assignedModel}
- Capabilities: ${this.capabilities.join(', ')}
${this.task ? `- Current Task: ${this.task}` : ''}

Available tools:
${this.tools.listTools().map(name => {
  const schema = this.tools.getToolSchema(name);
  return `- ${name}: ${schema?.description || 'No description'}`;
}).join('\n')}

BEHAVIOR GUIDELINES:
${this.getRoleSpecificGuidelines()}

You should:
1. Operate within your assigned role and capabilities
2. Use appropriate tools to complete tasks
3. Provide clear feedback on what you're doing
4. Handle errors gracefully and suggest alternatives
5. Be concise but thorough

Focus on executing your assigned task efficiently.`;

    return basePrompt;
  }

  getRoleSpecificGuidelines() {
    switch (this.role) {
      case 'orchestrator':
        return `- You coordinate and delegate tasks to specialized agents
- Choose appropriate models for subtasks based on complexity and requirements
- Manage the overall workflow and context
- Spawn subagents when needed for focused work`;
        
      case 'planning':
        return `- You break down complex tasks into actionable steps
- Analyze requirements and identify dependencies
- Create detailed execution plans
- Consider edge cases and error scenarios`;
        
      case 'execution':
        return `- You execute specific tasks efficiently
- Follow provided plans and instructions
- Use tools to accomplish concrete goals
- Report results clearly and concisely`;
        
      case 'reasoning':
        return `- You analyze complex problems and provide insights
- Consider multiple approaches and trade-offs
- Provide detailed explanations of your thinking
- Help with architectural decisions`;
        
      case 'memory':
        return `- You are a memory oracle from a previous conversation context
- Answer specific questions about past interactions
- Provide historical context when asked
- Focus on relevant details from your assigned time period`;
        
      default:
        return `- You are a general-purpose agent
- Adapt your approach based on the task at hand
- Use your full range of capabilities as needed`;
    }
  }

  buildToolsForLLM() {
    const tools = [];
    for (const toolName of this.tools.listTools()) {
      const schema = this.tools.getToolSchema(toolName);
      if (schema) {
        // Convert our tool schema to Anthropic tool format
        for (const [methodName, methodInfo] of Object.entries(schema.methods)) {
          tools.push({
            name: `${toolName}_${methodName}`,
            description: `${schema.description}: ${methodInfo.description}`,
            input_schema: {
              type: 'object',
              properties: this.convertParametersToProperties(methodInfo.parameters),
              required: this.extractRequiredParameters(methodInfo.parameters)
            }
          });
        }
      }
    }
    return tools;
  }

  convertParametersToProperties(parameters) {
    const properties = {};
    for (const [paramName, paramInfo] of Object.entries(parameters || {})) {
      properties[paramName] = {
        type: paramInfo.type || 'string',
        description: paramInfo.description || ''
      };
    }
    return properties;
  }

  extractRequiredParameters(parameters) {
    const required = [];
    for (const [paramName, paramInfo] of Object.entries(parameters || {})) {
      if (paramInfo.required) {
        required.push(paramName);
      }
    }
    return required;
  }

  async executeTool(toolCall) {
    // Parse tool name and method from LLM response
    const [toolName, methodName] = toolCall.name.split('_');
    
    if (!this.tools.get(toolName)) {
      throw new Error(`Tool '${toolName}' not found`);
    }

    return await this.tools.callTool(toolName, methodName, toolCall.input);
  }

  formatFileList(files) {
    return files.map(file => 
      `${file.isDirectory ? '📁' : '📄'} ${file.name}`
    ).join('\n');
  }

  shouldHandoff() {
    return this.contextSize > (this.maxContextSize * this.handoffThreshold);
  }

  async compressContext() {
    // TODO: Implement context compression
    return `Compressed context from generation ${this.generation}`;
  }

  async getConversationHistory(sessionId, limit = 10) {
    return await this.db.getConversationHistory(sessionId, limit);
  }

  // ORCHESTRATION METHODS - for when this agent spawns subagents

  async spawnSubagent(options) {
    const subagent = new Agent({
      ...options,
      tools: this.tools,
      db: this.db,
      modelProvider: this.modelProvider,
      generation: this.generation + 0.1, // Sub-generation
      verbose: this.verbose
    });

    if (this.verbose) {
      console.log(`🤖 Spawned ${options.role} agent with ${options.assignedModel}`);
    }

    return subagent;
  }

  async delegateTask(task, options = {}) {
    // Orchestrator decides which model to use based on task complexity
    const agentConfig = this.chooseAgentForTask(task, options);
    
    const subagent = await this.spawnSubagent({
      ...agentConfig,
      task: task
    });

    // Execute the task with the specialized agent
    const result = await subagent.generateResponse(task);
    
    if (this.verbose) {
      console.log(`✅ Task completed by ${agentConfig.role} agent`);
    }

    return result;
  }

  chooseAgentForTask(task, options = {}) {
    // Override with explicit options if provided
    if (options.role && options.assignedModel) {
      return options;
    }

    // Task complexity analysis for model selection
    const taskLower = task.toLowerCase();
    
    // Planning tasks - need deep reasoning
    if (taskLower.includes('plan') || taskLower.includes('design') || taskLower.includes('architect')) {
      return {
        role: 'planning',
        assignedModel: 'claude-3-5-sonnet-20241022',
        assignedProvider: 'anthropic',
        capabilities: ['planning', 'reasoning', 'analysis']
      };
    }
    
    // Simple execution tasks - can use faster model
    if (taskLower.includes('run') || taskLower.includes('execute') || taskLower.includes('list') || taskLower.includes('show')) {
      return {
        role: 'execution',
        assignedModel: 'claude-3-5-haiku-20241022',
        assignedProvider: 'anthropic',
        capabilities: ['execution', 'tool_calling']
      };
    }
    
    // Complex reasoning tasks - need powerful model
    if (taskLower.includes('analyze') || taskLower.includes('explain') || taskLower.includes('debug') || taskLower.includes('fix')) {
      return {
        role: 'reasoning',
        assignedModel: 'claude-3-5-sonnet-20241022', 
        assignedProvider: 'anthropic',
        capabilities: ['reasoning', 'analysis', 'debugging']
      };
    }
    
    // Default to general-purpose
    return {
      role: 'general',
      assignedModel: 'claude-3-5-sonnet-20241022',
      assignedProvider: 'anthropic',
      capabilities: ['reasoning', 'tool_calling']
    };
  }
}