// ABOUTME: Core agent class that handles reasoning, tool calls, and context management
// ABOUTME: Implements multi-generational memory and subagent coordination

import { ActivityLogger } from '../logging/activity-logger.js';
import { DebugLogger } from '../logging/debug-logger.js';
import { SynthesisEngine } from '../tools/synthesis-engine.js';
import { TokenEstimator } from '../tools/token-estimator.js';
import { ToolResultExtractor } from '../tools/tool-result-extractor.js';

// Simple semaphore for concurrency control
class Semaphore {
  constructor(maxConcurrent) {
    this.maxConcurrent = maxConcurrent;
    this.current = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.current < this.maxConcurrent) {
      this.current++;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release() {
    this.current--;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      this.current++;
      next();
    }
  }
}

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
    
    // Parallel execution configuration
    this.maxConcurrentTools = options.maxConcurrentTools || 10;
    
    // Error recovery and retry configuration
    this.retryConfig = {
      maxRetries: 3,
      baseDelay: 100, // milliseconds
      maxDelay: 5000,
      backoffMultiplier: 2,
      ...options.retryConfig
    };
    
    // Circuit breaker state
    this.circuitBreaker = new Map(); // toolName -> { state, failures, lastFailure, nextAttempt }
    this.circuitBreakerConfig = {
      failureThreshold: 5,
      openTimeout: 30000, // 30 seconds
      halfOpenMaxCalls: 1,
      ...options.circuitBreakerConfig
    };
    
    // Tool-specific retry configurations
    this.toolRetryConfigs = new Map();
    
    // Error tracking
    this.errorPatterns = new Map(); // toolName -> error pattern stats
    
    // Initialize synthesis utilities
    this.synthesisEngine = new SynthesisEngine(options.synthesisConfig);
    this.tokenEstimator = new TokenEstimator();
    this.resultExtractor = new ToolResultExtractor();
    
    // Activity logging
    this.activityLogger = options.activityLogger || null;
    
    // Debug logging
    this.debugLogger = null;
    if (options.debugLogging) {
      this.debugLogger = new DebugLogger({
        logLevel: options.debugLogging.logLevel || 'off',
        logFile: options.debugLogging.logFile,
        logFileLevel: options.debugLogging.logFileLevel || 'off'
      });
    }
    
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
        if (this.debugLogger) {
          this.debugLogger.info('🔄 Context approaching limit, preparing handoff...');
        }
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
          if (this.debugLogger) {
            this.debugLogger.debug(`🔄 Agentic iteration ${iteration}/${maxIterations}`);
          }
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

        // Log model request event
        if (this.activityLogger) {
          await this.activityLogger.logEvent('model_request', sessionId, null, {
            provider: this.assignedProvider,
            model: this.assignedModel,
            prompt: JSON.stringify(messages),
            timestamp: new Date().toISOString()
          });
        }

        // Use assigned model and provider with streaming
        const startTime = Date.now();
        const response = await this.modelProvider.chat(messages, {
          provider: this.assignedProvider,
          model: this.assignedModel,
          tools: availableTools,
          maxTokens: 4096,
          onTokenUpdate: onTokenUpdate,
          signal: options.signal
        });

        // Log model response event
        if (this.activityLogger && response.success) {
          const duration = Date.now() - startTime;
          const cost = this.calculateCost(
            response.usage?.input_tokens || response.usage?.prompt_tokens || 0,
            response.usage?.output_tokens || response.usage?.completion_tokens || 0
          );
          
          // Use model provider session ID if available
          const modelSessionId = response.sessionId || null;
          
          await this.activityLogger.logEvent('model_response', sessionId, modelSessionId, {
            content: response.content || '',
            tokens_in: response.usage?.input_tokens || response.usage?.prompt_tokens || 0,
            tokens_out: response.usage?.output_tokens || response.usage?.completion_tokens || 0,
            cost: cost ? cost.totalCost : 0,
            duration_ms: duration
          });
        }

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
          // Execute tools in parallel with concurrency limiting
          const rawToolResults = await this.executeToolsInParallel(response.toolCalls, sessionId, response.content);
          
          // Apply batch synthesis for large results
          const toolResults = await this.synthesizeToolResultsBatch(rawToolResults, response.toolCalls, sessionId, 'Synthesize and summarize the tool output to preserve essential information while reducing token usage.');
          
          iterationToolResults.push(...toolResults);
          allToolResults.push(...toolResults);
          
          // Check if any tool was denied with shouldStop
          const stopResult = toolResults.find(result => result.denied && result.shouldStop);
          if (stopResult) {
            shouldStop = true;
            finalContent += '\n\n⏸️ Execution stopped by user. Please provide further instructions.';
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
        
        if (this.debugLogger) {
          this.debugLogger.info(`\n📈 Session totals: ${totalUsage.prompt_tokens} in, ${totalUsage.completion_tokens} out, ${totalUsage.total_tokens} total tokens`);
          this.debugLogger.info(`📊 Context usage: ${contextUsage.used}/${contextUsage.total} tokens (${contextUsage.percentage.toFixed(1)}%)`);
          if (cost) {
            this.debugLogger.info(`💰 Cost: $${cost.totalCost.toFixed(4)} (in: $${cost.inputCost.toFixed(4)}, out: $${cost.outputCost.toFixed(4)})`);
          }
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
          success: false,
          denied: true,
          approved: false,
          shouldStop: approval.shouldStop
        };
      }

      approvedCall = approval.modifiedCall || toolCall;
      postExecutionComment = approval.postExecutionComment;
    }

    // Execute the tool
    const result = await this.executeTool(approvedCall, sessionId);
    
    // Check if tool response needs synthesis (over 200 tokens)
    const synthesisPrompt = `Summarize this ${approvedCall.name} result for continued reasoning. Focus on key findings and next steps.`;
    const synthesizedResult = await this.synthesizeToolResponse(result, approvedCall, sessionId, synthesisPrompt);
    
    return {
      toolCall: approvedCall,
      ...synthesizedResult,  // Flatten the result into the response
      approved: true,
      denied: false,
      postExecutionComment
    };
  }

  async executeTool(toolCall, sessionId) {
    // Parse tool name and method from LLM response
    // Try multiple parsing strategies to handle different naming conventions
    let toolName, methodName;
    
    // First try: split by last underscore (preferred for new format)
    const parts = toolCall.name.split('_');
    if (parts.length >= 2) {
      methodName = parts.pop(); // Last part is method
      toolName = parts.join('_'); // Rest is tool name
    } else {
      toolName = toolCall.name;
      methodName = 'execute'; // Default method
    }
    
    // Fallback: try original parsing if tool not found
    if (!this.tools.get(toolName) && parts.length > 1) {
      toolName = parts[0];
      methodName = parts.slice(1).join('_');
    }
    
    if (!this.tools.get(toolName)) {
      throw new Error(`Tool '${toolName}' not found`);
    }

    return await this.tools.callTool(toolName, methodName, toolCall.input, sessionId, this);
  }

  async executeToolsInParallel(toolCalls, sessionId, reasoning) {
    if (!toolCalls || toolCalls.length === 0) {
      return [];
    }

    // Create semaphore for concurrency limiting
    const semaphore = new Semaphore(this.maxConcurrentTools);

    // Create promise for each tool call with concurrency control
    const toolPromises = toolCalls.map(async (toolCall) => {
      await semaphore.acquire();
      
      try {
        const result = await this.executeToolWithApproval(toolCall, sessionId, reasoning);
        return result;
      } catch (error) {
        // Return error result instead of throwing
        return {
          toolCall,
          error: error.message,
          success: false,
          denied: false,
          approved: false
        };
      } finally {
        semaphore.release();
      }
    });

    // Execute all tools in parallel and collect results
    const results = await Promise.all(toolPromises);
    
    if (this.verbose && this.debugLogger) {
      this.debugLogger.debug(`⚡ Executed ${toolCalls.length} tools in parallel (limit: ${this.maxConcurrentTools})`);
    }

    return results;
  }

  async executeToolsInParallelWithRetry(toolCalls, sessionId, reasoning) {
    if (!toolCalls || toolCalls.length === 0) {
      return [];
    }

    const results = [];
    const hasFailures = [];

    try {
      // First attempt: parallel execution with retry logic
      const parallelResults = await this.executeToolsWithRetryLogic(toolCalls, sessionId, reasoning);
      results.push(...parallelResults);

      // Check for systemic failures that might require fallback
      const failedResults = parallelResults.filter(r => !r.success && !r.circuitBroken);
      const failureRate = failedResults.length / parallelResults.length;

      // If failure rate is high, consider sequential fallback
      if (failureRate > 0.5 && failedResults.length > 1) {
        const sequentialCandidates = failedResults.filter(r => 
          r.error && (r.error.includes('overload') || r.error.includes('timeout') || r.error.includes('concurrent'))
        );

        if (sequentialCandidates.length > 0) {
          const retryToolCalls = sequentialCandidates.map(r => r.toolCall);
          const sequentialResults = await this.executeToolsSequentiallyWithRetry(retryToolCalls, sessionId, reasoning);
          
          // Replace failed results with sequential results
          sequentialResults.forEach((seqResult, index) => {
            const originalIndex = results.findIndex(r => r.toolCall === retryToolCalls[index]);
            if (originalIndex !== -1) {
              results[originalIndex] = { ...seqResult, sequentialFallback: true };
            }
          });
        }
      }


      // Mark graceful degradation if some tools succeeded
      const successCount = results.filter(r => r.success).length;
      if (successCount > 0 && successCount < results.length) {
        results.forEach(r => {
          if (!r.success) r.degradedExecution = true;
          r.gracefulDegradation = true;
        });
      }

      return results;

    } catch (error) {
      // Catastrophic failure - return error results for all tools
      return toolCalls.map(toolCall => ({
        toolCall,
        success: false,
        error: error.message,
        catastrophicFailure: true,
        approved: false,
        denied: false
      }));
    }
  }

  async executeToolsWithRetryLogic(toolCalls, sessionId, reasoning) {
    const semaphore = new Semaphore(this.maxConcurrentTools);
    
    const toolPromises = toolCalls.map(async (toolCall) => {
      await semaphore.acquire();
      
      try {
        return await this.executeToolWithRetry(toolCall, sessionId, reasoning);
      } finally {
        semaphore.release();
      }
    });

    return await Promise.all(toolPromises);
  }

  async executeToolsSequentiallyWithRetry(toolCalls, sessionId, reasoning) {
    const results = [];
    
    for (const toolCall of toolCalls) {
      const result = await this.executeToolWithRetry(toolCall, sessionId, reasoning);
      results.push(result);
    }
    
    return results;
  }

  async executeToolWithRetry(toolCall, sessionId, reasoning) {
    // Parse tool name consistently with executeTool
    const parts = toolCall.name.split('_');
    let toolName;
    if (parts.length >= 2) {
      toolName = parts.slice(0, -1).join('_'); // All but last part
    } else {
      toolName = parts[0];
    }
    
    const retryConfig = this.getToolRetryConfig(toolName);
    
    // Check if retry is disabled for this tool
    if (retryConfig.enabled === false) {
      try {
        const result = await this.executeToolWithApproval(toolCall, sessionId, reasoning);
        return { ...result, retryAttempts: 0, retryDisabled: true };
      } catch (error) {
        return {
          toolCall,
          success: false,
          error: error.message,
          retryAttempts: 0,
          retryDisabled: true,
          approved: false,
          denied: false
        };
      }
    }

    // Check circuit breaker
    const circuitState = this.checkCircuitBreaker(toolName);
    if (circuitState.blocked) {
      return {
        toolCall,
        success: false,
        error: `Circuit breaker open for ${toolName}`,
        circuitBroken: true,
        approved: false,
        denied: false
      };
    }

    let lastError;
    let retryAttempts = 0;
    let totalRetryDelay = 0;

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = this.calculateBackoffDelay(attempt - 1, retryConfig);
          totalRetryDelay += delay;
          await this.sleep(delay);
        }

        const result = await this.executeToolWithApproval(toolCall, sessionId, reasoning);
        
        // Check if the result indicates an error that should be retried
        if (result.error && !result.denied) {
          // Treat tool result errors as exceptions for retry logic
          throw new Error(result.error);
        }
        
        // Success - reset circuit breaker
        this.recordToolSuccess(toolName);
        
        return {
          ...result,
          success: true,
          retryAttempts: attempt, // Current attempt number is the retry count
          totalRetryDelay,
          circuitRecovered: circuitState.recovered,
          // Track if this was recovered from a parallel overload
          sequentialFallback: lastError && lastError.message.includes('Parallel overload')
        };

      } catch (error) {
        lastError = error;

        // Check if error is retriable
        if (!this.isRetriableError(error)) {
          this.recordToolFailure(toolName, error);
          return {
            toolCall,
            success: false,
            error: error.message,
            nonRetriable: true,
            retryAttempts: 0,
            approved: false,
            denied: false,
            actionableError: this.categorizeError(error)
          };
        }

        this.recordToolFailure(toolName, error);
      }
    }

    // All retries exhausted - return the max retry count
    return {
      toolCall,
      success: false,
      error: lastError.message,
      finalFailure: true,
      retryAttempts: retryConfig.maxRetries,
      totalRetryDelay,
      approved: false,
      denied: false,
      actionableError: this.categorizeError(lastError)
    };
  }

  async synthesizeToolResponse(toolResult, toolCall, sessionId, synthesisPrompt) {
    const responseText = this.resultExtractor.extract(toolResult);
    const estimatedTokens = this.tokenEstimator.estimate(responseText);
    
    // Get tool-specific threshold
    const toolName = toolCall.name.split('_')[0];
    const threshold = this.synthesisEngine.config.toolThresholds[toolName] || this.synthesisEngine.config.defaultThreshold;
    
    if (estimatedTokens <= threshold) {
      return toolResult; // Return as-is for short responses
    }

    if (this.verbose && this.debugLogger) {
      this.debugLogger.debug(`🔬 Synthesizing tool response (${estimatedTokens} estimated tokens)`);
    }

    // Create synthesis agent
    const synthesisAgent = await this.spawnSubagent({
      role: 'synthesis',
      assignedModel: 'claude-3-5-haiku-20241022',
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
      
      return {
        ...toolResult,
        synthesized: true,
        originalResult: toolResult,
        summary: synthesisResponse.content
      };
    } catch (error) {
      if (this.verbose && this.debugLogger) {
        this.debugLogger.warn(`⚠️ Tool synthesis failed: ${error.message}, using original result`);
      }
      return toolResult;
    }
  }

  async synthesizeToolResultsBatch(toolResults, toolCalls, sessionId, synthesisPrompt) {
    return await this.synthesisEngine.processSynthesis(toolResults, toolCalls, {
      individual: (result, call) => this.synthesizeToolResponse(result, call, sessionId, synthesisPrompt),
      batch: (batch) => this.synthesizeMultipleToolResults(batch, sessionId, synthesisPrompt)
    });
  }

  async synthesizeMultipleToolResults(toolBatch, sessionId, synthesisPrompt) {
    if (toolBatch.length === 0) return [];

    // Create synthesis agent for batch processing
    const synthesisAgent = await this.spawnSubagent({
      role: 'batch_synthesis',
      assignedModel: 'claude-3-5-haiku-20241022',
      assignedProvider: 'anthropic', 
      capabilities: ['synthesis', 'summarization', 'analysis'],
      task: `Batch synthesize ${toolBatch.length} parallel tool results`
    });

    // Use synthesis engine to create enhanced batch prompt
    const batchPrompt = this.synthesisEngine.createBatchPrompt(toolBatch, synthesisPrompt);

    try {
      const synthesisResponse = await synthesisAgent.generateResponse(sessionId, batchPrompt);
      
      // Parse response using synthesis engine
      const summaries = this.synthesisEngine.parseBatchSynthesis(synthesisResponse.content, toolBatch.length);
      const totalTokens = toolBatch.reduce((sum, item) => sum + item.tokens, 0);

      // Return synthesized results with enhanced metadata
      return toolBatch.map((item, index) => ({
        ...item.result,
        synthesized: true,
        batchSynthesized: true,
        originalResult: item.result,
        summary: summaries[index] || 'Synthesis failed',
        batchContext: {
          batchSize: toolBatch.length,
          toolIndex: index,
          totalTokens,
          relationships: this.synthesisEngine.analyzeRelationships(toolBatch)
        }
      }));

    } catch (error) {
      if (this.verbose && this.debugLogger) {
        this.debugLogger.warn(`⚠️ Batch synthesis failed: ${error.message}, falling back to individual synthesis`);
      }
      
      // Fallback to individual synthesis
      const individualResults = [];
      for (const item of toolBatch) {
        const synthesized = await this.synthesizeToolResponse(item.result, item.call, sessionId, synthesisPrompt);
        individualResults.push(synthesized);
      }
      return individualResults;
    }
  }

  extractTextFromToolResult(toolResult) {
    // Delegate to utility class
    return this.resultExtractor.extract(toolResult);
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
      verbose: this.verbose,
      toolApproval: this.toolApproval,
      activityLogger: this.activityLogger,
      debugLogging: options.debugLogging || (this.debugLogger ? {
        logLevel: this.debugLogger.stderrLevel,
        logFile: this.debugLogger.filePath,
        logFileLevel: this.debugLogger.fileLevel
      } : null)
    });

    if (this.verbose) {
      if (this.debugLogger) {
        this.debugLogger.debug(`🤖 Spawned ${options.role} agent with ${options.assignedModel}`);
      }
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
      if (this.debugLogger) {
        this.debugLogger.info(`✅ Task completed by ${agentConfig.role} agent`);
      }
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

  // ERROR RECOVERY AND RETRY UTILITY METHODS

  getToolRetryConfig(toolName) {
    const toolConfig = this.toolRetryConfigs.get(toolName) || {};
    return {
      ...this.retryConfig,
      ...toolConfig
    };
  }

  setToolRetryConfig(toolName, config) {
    this.toolRetryConfigs.set(toolName, config);
  }

  calculateBackoffDelay(attemptNumber, config) {
    const delay = Math.min(
      config.baseDelay * Math.pow(config.backoffMultiplier, attemptNumber),
      config.maxDelay
    );
    // Add jitter to prevent thundering herd
    return delay + Math.random() * (delay * 0.1);
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  isRetriableError(error) {
    const message = error.message.toLowerCase();
    
    // Non-retriable errors
    const nonRetriablePatterns = [
      'authentication',
      'authorization',
      'permission denied',
      'access denied',
      'invalid credentials',
      'forbidden',
      'not found',
      'bad request',
      'invalid input',
      'validation failed'
    ];

    for (const pattern of nonRetriablePatterns) {
      if (message.includes(pattern)) {
        return false;
      }
    }

    // Retriable errors
    const retriablePatterns = [
      'timeout',
      'network',
      'connection',
      'temporary',
      'unavailable',
      'overload',
      'rate limit',
      'too many requests',
      'service degraded',
      'concurrent'
    ];

    for (const pattern of retriablePatterns) {
      if (message.includes(pattern)) {
        return true;
      }
    }

    // Default: retry unknown errors
    return true;
  }

  categorizeError(error) {
    const message = error.message.toLowerCase();
    
    if (message.includes('rate limit') || message.includes('too many requests')) {
      return {
        category: 'rate_limit',
        suggestion: 'Reduce request frequency and wait before retrying',
        retryAfter: 60000 // 1 minute
      };
    }
    
    if (message.includes('timeout') || message.includes('network')) {
      return {
        category: 'network',
        suggestion: 'Check network connectivity and retry',
        retryAfter: 5000 // 5 seconds
      };
    }
    
    if (message.includes('overload') || message.includes('concurrent')) {
      return {
        category: 'overload',
        suggestion: 'Reduce concurrent operations and retry sequentially',
        retryAfter: 10000 // 10 seconds
      };
    }
    
    if (message.includes('unavailable') || message.includes('service')) {
      return {
        category: 'service_unavailable',
        suggestion: 'Service may be down, retry after delay',
        retryAfter: 30000 // 30 seconds
      };
    }
    
    return {
      category: 'unknown',
      suggestion: 'Retry with exponential backoff',
      retryAfter: 1000 // 1 second
    };
  }

  // CIRCUIT BREAKER METHODS

  checkCircuitBreaker(toolName) {
    const breaker = this.circuitBreaker.get(toolName);
    
    if (!breaker) {
      // Initialize circuit breaker for this tool
      this.circuitBreaker.set(toolName, {
        state: 'closed',
        failures: 0,
        lastFailure: null,
        nextAttempt: 0
      });
      return { blocked: false, recovered: false };
    }

    const now = Date.now();
    
    switch (breaker.state) {
      case 'closed':
        return { blocked: false, recovered: false };
        
      case 'open':
        if (now >= breaker.nextAttempt) {
          // Transition to half-open
          breaker.state = 'half-open';
          return { blocked: false, recovered: true }; // This is recovery attempt
        }
        return { blocked: true, recovered: false };
        
      case 'half-open':
        return { blocked: false, recovered: true };
        
      default:
        return { blocked: false, recovered: false };
    }
  }

  recordToolSuccess(toolName) {
    const breaker = this.circuitBreaker.get(toolName);
    
    if (breaker) {
      if (breaker.state === 'half-open') {
        // Success in half-open state - close the circuit
        breaker.state = 'closed';
        breaker.failures = 0;
        breaker.lastFailure = null;
      }
    }
  }

  recordToolFailure(toolName, error) {
    let breaker = this.circuitBreaker.get(toolName);
    
    if (!breaker) {
      breaker = {
        state: 'closed',
        failures: 0,
        lastFailure: null,
        nextAttempt: 0
      };
      this.circuitBreaker.set(toolName, breaker);
    }

    breaker.failures++;
    breaker.lastFailure = Date.now();

    // Update error patterns
    this.updateErrorPattern(toolName, error);

    // Check if we should open the circuit
    if (breaker.failures >= this.circuitBreakerConfig.failureThreshold) {
      breaker.state = 'open';
      breaker.nextAttempt = Date.now() + this.circuitBreakerConfig.openTimeout;
    }
  }

  updateErrorPattern(toolName, error) {
    let pattern = this.errorPatterns.get(toolName);
    
    if (!pattern) {
      pattern = {
        frequency: 0,
        lastSeen: null,
        pattern: 'unknown',
        examples: []
      };
      this.errorPatterns.set(toolName, pattern);
    }

    pattern.frequency++;
    pattern.lastSeen = Date.now();
    pattern.examples.push(error.message);
    
    // Keep only recent examples
    if (pattern.examples.length > 10) {
      pattern.examples = pattern.examples.slice(-10);
    }

    // Detect patterns
    const message = error.message.toLowerCase();
    if (message.includes('degraded') || message.includes('slow')) {
      pattern.pattern = 'degraded_service';
    } else if (message.includes('rate') || message.includes('limit')) {
      pattern.pattern = 'rate_limiting';
    } else if (message.includes('timeout') || message.includes('network')) {
      pattern.pattern = 'connectivity_issues';
    }
  }

  getCircuitBreakerStats() {
    const stats = {};
    
    for (const [toolName, breaker] of this.circuitBreaker.entries()) {
      stats[toolName] = {
        state: breaker.state,
        failures: breaker.failures,
        lastFailure: breaker.lastFailure,
        nextAttempt: breaker.nextAttempt
      };
    }
    
    return stats;
  }

  getErrorPatterns() {
    return Object.fromEntries(this.errorPatterns);
  }

  analyzeExecutionErrors(results) {
    const toolSpecificErrors = [];
    const systemicErrors = [];
    const recommendations = [];

    for (const result of results) {
      if (!result.success && result.error) {
        const error = result.error.toLowerCase();
        const toolName = result.toolCall?.name?.split('_')[0];
        
        if (error.includes('validation') || error.includes('input') || error.includes('parameter')) {
          toolSpecificErrors.push({
            tool: toolName,
            error: result.error,
            type: 'validation'
          });
        } else if (error.includes('network') || error.includes('timeout') || error.includes('infrastructure')) {
          systemicErrors.push({
            tool: toolName,
            error: result.error,
            type: 'infrastructure'
          });
        }
      }
    }

    if (toolSpecificErrors.length > 0) {
      recommendations.push('tool-specific input validation and parameters');
    }
    
    if (systemicErrors.length > 0) {
      recommendations.push('infrastructure connectivity and service health');
    }

    return {
      toolSpecificErrors,
      systemicErrors,
      recommendations
    };
  }
}