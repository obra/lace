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
    this.maxContextSize = this.getModelContextWindow();
    this.handoffThreshold = 0.8; // Handoff at 80% capacity
    
    this.systemPrompt = this.buildSystemPrompt();
  }

  async processInput(sessionId, input, options = {}) {
    try {
      // Save user message
      await this.db.saveMessage(sessionId, this.generation, 'user', input);
      
      // Check if we need to handoff context
      if (this.shouldHandoff()) {
        console.log('🔄 Context approaching limit, preparing handoff...');
        // TODO: Implement handoff logic
      }

      // Simple echo response for now - TODO: Implement actual reasoning
      const response = await this.generateResponse(sessionId, input, options);
      
      // Save agent response
      await this.db.saveMessage(sessionId, this.generation, 'assistant', response.content, response.toolCalls, this.contextSize);
      
      return response;
    } catch (error) {
      return {
        error: error.message
      };
    }
  }

  async generateResponse(sessionId, input, options = {}) {
    try {
      // Agentic loop with circuit breaker
      const maxIterations = 25;
      let iteration = 0;
      let messages = [
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: input }
      ];
      
      let allToolCalls = [];
      let allToolResults = [];
      let finalContent = '';
      let shouldStop = false;
      let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

      while (iteration < maxIterations && !shouldStop) {
        iteration++;
        
        if (this.verbose) {
          console.log(`🔄 Agentic iteration ${iteration}/${maxIterations}`);
        }

        // Get available tools for the LLM
        const availableTools = this.buildToolsForLLM();

        // Track token usage during streaming
        const onTokenUpdate = (tokenData) => {
          // Forward streaming tokens to user interface if callback provided
          if (options.onToken && tokenData.token) {
            options.onToken(tokenData.token);
          }
          
          if (this.verbose && tokenData.streaming) {
            process.stdout.write(`\r📊 Tokens: ${tokenData.inputTokens} in, ${tokenData.outputTokens} out`);
          } else if (this.verbose && !tokenData.streaming) {
            process.stdout.write(`\r📊 Final: ${tokenData.inputTokens} in, ${tokenData.outputTokens} out\n`);
          }
        };

        // Check for abort signal before making request
        if (options.signal?.aborted) {
          throw new Error('Operation was aborted');
        }

        // Use assigned model and provider with streaming
        const response = await this.modelProvider.chat(messages, {
          provider: this.assignedProvider,
          model: this.assignedModel,
          tools: availableTools,
          maxTokens: 4096,
          onTokenUpdate: onTokenUpdate,
          signal: options.signal
        });

        if (!response.success) {
          return {
            content: `Error: ${response.error}`,
            error: response.error
          };
        }

        // Accumulate usage stats and update context size
        if (response.usage) {
          totalUsage.prompt_tokens += response.usage.input_tokens || response.usage.prompt_tokens || 0;
          totalUsage.completion_tokens += response.usage.output_tokens || response.usage.completion_tokens || 0;
          totalUsage.total_tokens += response.usage.total_tokens || 0;
          this.contextSize = totalUsage.total_tokens;
        }

        // Add agent response to conversation
        messages.push({
          role: 'assistant',
          content: response.content,
          tool_calls: response.toolCalls
        });

        finalContent = response.content;

        // Execute tool calls if any
        const iterationToolResults = [];
        if (response.toolCalls && response.toolCalls.length > 0) {
          for (const toolCall of response.toolCalls) {
            try {
              const toolResult = await this.executeToolWithApproval(toolCall, sessionId, response.content);
              iterationToolResults.push(toolResult);
              allToolResults.push(toolResult);
              
              if (toolResult.denied && toolResult.shouldStop) {
                shouldStop = true;
                finalContent += '\n\n⏸️ Execution stopped by user. Please provide further instructions.';
                break;
              }
            } catch (error) {
              const errorResult = {
                toolCall,
                error: error.message,
                denied: false,
                approved: false
              };
              iterationToolResults.push(errorResult);
              allToolResults.push(errorResult);
            }
          }

          allToolCalls.push(...response.toolCalls);

          // Add tool results to conversation for next iteration
          if (iterationToolResults.length > 0) {
            const toolResultsMessage = this.formatToolResultsForLLM(iterationToolResults);
            messages.push({
              role: 'user',
              content: toolResultsMessage
            });
          }
        } else {
          // No tool calls in this iteration, agent is done
          break;
        }
      }

      if (iteration >= maxIterations) {
        finalContent += `\n\n⚠️ Circuit breaker triggered after ${maxIterations} iterations.`;
      }

      // Display final token usage if verbose
      if (this.verbose && totalUsage.total_tokens > 0) {
        const contextUsage = this.calculateContextUsage(totalUsage.total_tokens);
        const cost = this.calculateCost(totalUsage.prompt_tokens, totalUsage.completion_tokens);
        
        console.log(`\n📈 Session totals: ${totalUsage.prompt_tokens} in, ${totalUsage.completion_tokens} out, ${totalUsage.total_tokens} total tokens`);
        console.log(`📊 Context usage: ${contextUsage.used}/${contextUsage.total} tokens (${contextUsage.percentage.toFixed(1)}%)`);
        if (cost) {
          console.log(`💰 Cost: $${cost.totalCost.toFixed(4)} (in: $${cost.inputCost.toFixed(4)}, out: $${cost.outputCost.toFixed(4)})`);
        }
      }

      return {
        content: finalContent,
        toolCalls: allToolCalls,
        toolResults: allToolResults,
        usage: totalUsage,
        stopped: shouldStop,
        iterations: iteration
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
        
      case 'synthesis':
        return `- You process and synthesize information as requested
- Follow the specific synthesis instructions provided in the user prompt
- Be concise and focus on what the requesting agent needs to know
- Preserve essential information while reducing verbosity`;
        
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

  async executeToolWithApproval(toolCall, sessionId, reasoning) {
    // Request approval if approval system is available
    let approvedCall = toolCall;
    let postExecutionComment = null;
    
    if (this.toolApproval) {
      const approval = await this.toolApproval.requestApproval(toolCall, {
        reasoning: reasoning,
        agent: this.role,
        sessionId: sessionId
      });

      if (!approval.approved) {
        return {
          toolCall,
          error: `Tool execution denied: ${approval.reason}`,
          denied: true,
          approved: false,
          shouldStop: approval.shouldStop
        };
      }

      approvedCall = approval.modifiedCall || toolCall;
      postExecutionComment = approval.postExecutionComment;
    }

    // Execute the tool
    const result = await this.executeTool(approvedCall);
    
    // Check if tool response needs synthesis (over 200 tokens)
    const synthesisPrompt = `Summarize this ${approvedCall.name} result for continued reasoning. Focus on key findings and next steps.`;
    const synthesizedResult = await this.synthesizeToolResponse(result, approvedCall, sessionId, synthesisPrompt);
    
    return {
      toolCall: approvedCall,
      result: synthesizedResult,
      approved: true,
      denied: false,
      postExecutionComment
    };
  }

  async executeTool(toolCall) {
    // Parse tool name and method from LLM response
    const [toolName, methodName] = toolCall.name.split('_');
    
    if (!this.tools.get(toolName)) {
      throw new Error(`Tool '${toolName}' not found`);
    }

    return await this.tools.callTool(toolName, methodName, toolCall.input);
  }

  async synthesizeToolResponse(toolResult, toolCall, sessionId, synthesisPrompt) {
    // Check if response needs synthesis (over 200 tokens approximately)
    const responseText = this.extractTextFromToolResult(toolResult);
    const estimatedTokens = Math.ceil(responseText.length / 4); // Rough token estimation
    
    if (estimatedTokens <= 200) {
      return toolResult; // Return as-is for short responses
    }

    if (this.verbose) {
      console.log(`🔬 Synthesizing tool response (${estimatedTokens} estimated tokens)`);
    }

    // Create synthesis agent
    const synthesisAgent = await this.spawnSubagent({
      role: 'synthesis',
      assignedModel: 'claude-3-5-haiku-20241022', // Use faster model for synthesis
      assignedProvider: 'anthropic',
      capabilities: ['synthesis', 'summarization'],
      task: `Synthesize tool response for ${toolCall.name}`
    });

    const fullPrompt = `${synthesisPrompt}

Tool: ${toolCall.name}
Arguments: ${JSON.stringify(toolCall.input, null, 2)}

Tool Result:
${responseText}`;

    try {
      const synthesisResponse = await synthesisAgent.generateResponse(sessionId, fullPrompt);
      
      // Return synthesized result with original data preserved
      return {
        ...toolResult,
        synthesized: true,
        originalResult: toolResult,
        summary: synthesisResponse.content
      };
    } catch (error) {
      if (this.verbose) {
        console.log(`⚠️ Tool synthesis failed: ${error.message}, using original result`);
      }
      return toolResult; // Fallback to original result
    }
  }

  extractTextFromToolResult(toolResult) {
    if (typeof toolResult === 'string') {
      return toolResult;
    }
    
    if (toolResult.result && typeof toolResult.result === 'string') {
      return toolResult.result;
    }
    
    if (toolResult.output) {
      return Array.isArray(toolResult.output) ? toolResult.output.join('\n') : toolResult.output;
    }
    
    // Fallback to JSON stringification
    return JSON.stringify(toolResult, null, 2);
  }

  formatToolResultsForLLM(toolResults) {
    const formattedResults = toolResults.map(tr => {
      if (tr.denied) {
        return `Tool ${tr.toolCall.name} was denied: ${tr.error}`;
      }
      
      if (tr.error) {
        return `Tool ${tr.toolCall.name} failed: ${tr.error}`;
      }
      
      const result = tr.result;
      if (result.synthesized) {
        return `Tool ${tr.toolCall.name} executed successfully. Summary: ${result.summary}`;
      }
      
      if (result.success) {
        let resultText = '';
        
        // Handle different result formats
        if (result.result !== undefined) {
          resultText = typeof result.result === 'object' ? JSON.stringify(result.result) : String(result.result);
        } else if (result.content !== undefined) {
          resultText = `Content: ${result.content.substring(0, 100)}${result.content.length > 100 ? '...' : ''}`;
        } else if (result.bytesWritten !== undefined) {
          resultText = `File written successfully (${result.bytesWritten} bytes)`;
        } else if (result.files !== undefined) {
          resultText = `Found ${result.files.length} files`;
        } else {
          // Show relevant non-result fields
          const details = Object.keys(result)
            .filter(key => key !== 'success')
            .map(key => `${key}: ${result[key]}`)
            .join(', ');
          resultText = details || 'Completed successfully';
        }
        
        if (result.output && result.output.length > 0) {
          resultText += result.output.join('\n');
        }
        return `Tool ${tr.toolCall.name} executed successfully. ${resultText}`;
      } else {
        return `Tool ${tr.toolCall.name} failed: ${result.error || 'Unknown error'}`;
      }
    });

    return `Tool execution results:\n${formattedResults.join('\n')}`;
  }

  formatFileList(files) {
    return files.map(file => 
      `${file.isDirectory ? '📁' : '📄'} ${file.name}`
    ).join('\n');
  }

  getModelContextWindow() {
    if (this.modelProvider && this.modelProvider.getContextWindow) {
      return this.modelProvider.getContextWindow(this.assignedModel, this.assignedProvider);
    }
    return 200000; // Default fallback
  }

  calculateContextUsage(totalTokens) {
    if (this.modelProvider && this.modelProvider.getContextUsage) {
      return this.modelProvider.getContextUsage(this.assignedModel, totalTokens, this.assignedProvider);
    }
    
    // Fallback calculation
    return {
      used: totalTokens,
      total: this.maxContextSize,
      percentage: (totalTokens / this.maxContextSize) * 100,
      remaining: this.maxContextSize - totalTokens
    };
  }

  calculateCost(inputTokens, outputTokens) {
    if (this.modelProvider && this.modelProvider.calculateCost) {
      return this.modelProvider.calculateCost(this.assignedModel, inputTokens, outputTokens, this.assignedProvider);
    }
    return null;
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

  async delegateTask(sessionId, task, options = {}) {
    // Orchestrator decides which model to use based on task complexity
    const agentConfig = this.chooseAgentForTask(task, options);
    
    const subagent = await this.spawnSubagent({
      ...agentConfig,
      task: task
    });

    // Execute the task with the specialized agent
    const result = await subagent.generateResponse(sessionId, task);
    
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