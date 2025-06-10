// ABOUTME: Tool registry that manages all available tools for agents
// ABOUTME: Provides plugin-style architecture for extensible tool ecosystem

import { ShellTool } from './shell-tool.js'
import { FileTool } from './file-tool.js'
import { JavaScriptTool } from './javascript-tool.js'
import { SearchTool } from './search-tool.js'
import { TaskTool } from './task-tool.js'

export class ToolRegistry {
  constructor (options = {}) {
    this.tools = new Map()
    this.activityLogger = options.activityLogger || null
    this.progressTracker = options.progressTracker || null
    this.snapshotManager = options.snapshotManager || null
    this.conversationDB = options.conversationDB || null

    // Snapshot configuration
    this.snapshotConfig = {
      enablePreToolSnapshots: true,
      enablePostToolSnapshots: true,
      snapshotOnErrors: true,
      ...options.snapshotConfig
    }
  }

  async initialize () {
    // Register core tools
    this.register('shell', new ShellTool())
    this.register('file', new FileTool())
    this.register('javascript', new JavaScriptTool())
    this.register('search', new SearchTool())
    this.register('task', new TaskTool())

    // Initialize all tools
    for (const tool of this.tools.values()) {
      if (tool.initialize) {
        await tool.initialize()
      }
    }
  }

  register (name, tool) {
    this.tools.set(name, tool)
  }

  get (name) {
    return this.tools.get(name)
  }

  async callTool (name, method, params, sessionId = null, agent = null) {
    const tool = this.tools.get(name)
    if (!tool) {
      throw new Error(`Tool '${name}' not found`)
    }

    if (typeof tool[method] !== 'function') {
      throw new Error(`Method '${method}' not found on tool '${name}'`)
    }

    // Set agent context for TaskTool
    if (name === 'task' && agent && typeof tool.setAgent === 'function') {
      tool.setAgent(agent)
      if (sessionId && typeof tool.setSessionId === 'function') {
        tool.setSessionId(sessionId)
      }
      if (this.progressTracker && typeof tool.setProgressTracker === 'function') {
        tool.setProgressTracker(this.progressTracker)
      }
    }

    // Log tool execution start
    if (this.activityLogger && sessionId) {
      await this.activityLogger.logEvent('tool_execution_start', sessionId, null, {
        tool: name,
        method,
        params
      })
    }

    const startTime = Date.now()
    let success = true
    let result = null
    let error = null

    try {
      result = await tool[method](params)
    } catch (err) {
      success = false
      error = err.message
      throw err
    } finally {
      // Log tool execution complete
      if (this.activityLogger && sessionId) {
        const duration = Date.now() - startTime
        await this.activityLogger.logEvent('tool_execution_complete', sessionId, null, {
          success,
          result: success ? result : null,
          error,
          duration_ms: duration
        })
      }
    }

    return result
  }

  getToolSchema (name) {
    const tool = this.tools.get(name)
    if (!tool || !tool.getSchema) {
      return null
    }
    return tool.getSchema()
  }

  getAllSchemas () {
    const schemas = {}
    for (const [name, tool] of this.tools) {
      if (tool.getSchema) {
        schemas[name] = tool.getSchema()
      }
    }
    return schemas
  }

  listTools () {
    return Array.from(this.tools.keys())
  }

  /**
   * Execute a tool with automatic snapshot creation
   */
  async callToolWithSnapshots (name, method, params, sessionId = null, generation = null, agent = null) {
    // If no snapshot manager configured, fall back to regular tool execution
    if (!this.snapshotManager) {
      return this.callTool(name, method, params, sessionId, agent)
    }

    const tool = this.tools.get(name)
    if (!tool) {
      throw new Error(`Tool '${name}' not found`)
    }

    if (typeof tool[method] !== 'function') {
      throw new Error(`Method '${method}' not found on tool '${name}'`)
    }

    // Set agent context for TaskTool
    if (name === 'task' && agent && typeof tool.setAgent === 'function') {
      tool.setAgent(agent)
      if (sessionId && typeof tool.setSessionId === 'function') {
        tool.setSessionId(sessionId)
      }
      if (this.progressTracker && typeof tool.setProgressTracker === 'function') {
        tool.setProgressTracker(this.progressTracker)
      }
    }

    // Create tool call metadata
    const toolCall = {
      toolName: name,
      operation: method,
      parameters: params,
      executionId: this.generateExecutionId(),
      timestamp: new Date().toISOString()
    }

    // Create pre-tool snapshot
    let preSnapshot = null
    if (this.snapshotConfig.enablePreToolSnapshots) {
      try {
        preSnapshot = await this.snapshotManager.createPreToolSnapshot(
          toolCall,
          await this.gatherLegacyContext(sessionId),
          sessionId,
          generation
        )

        // Log snapshot creation
        if (this.activityLogger && sessionId) {
          await this.activityLogger.logEvent('snapshot_created', sessionId, null, {
            snapshotId: preSnapshot.snapshotId,
            type: 'pre-tool',
            toolCall
          })
        }
      } catch (error) {
        // Log snapshot error but don't fail tool execution
        if (this.activityLogger && sessionId) {
          await this.activityLogger.logEvent('snapshot_error', sessionId, null, {
            error: error.message,
            type: 'pre-tool',
            toolCall
          })
        }
      }
    }

    // Execute the tool
    const startTime = Date.now()
    let success = true
    let result = null
    let error = null

    // Log tool execution start
    if (this.activityLogger && sessionId) {
      await this.activityLogger.logEvent('tool_execution_start', sessionId, null, {
        tool: name,
        method,
        params,
        executionId: toolCall.executionId,
        preSnapshotId: preSnapshot?.snapshotId
      })
    }

    try {
      result = await tool[method](params)
    } catch (err) {
      success = false
      error = err.message
      // Don't re-throw yet, create post-snapshot first
    }

    const duration = Date.now() - startTime

    // Create execution result metadata
    const executionResult = {
      success,
      result: success ? result : null,
      error,
      duration,
      timestamp: new Date().toISOString()
    }

    // Create post-tool snapshot
    let postSnapshot = null
    if (this.snapshotConfig.enablePostToolSnapshots ||
        (!success && this.snapshotConfig.snapshotOnErrors)) {
      try {
        postSnapshot = await this.snapshotManager.createPostToolSnapshot(
          toolCall,
          await this.gatherLegacyContext(sessionId),
          executionResult,
          sessionId,
          generation
        )

        // Log snapshot creation
        if (this.activityLogger && sessionId) {
          await this.activityLogger.logEvent('snapshot_created', sessionId, null, {
            snapshotId: postSnapshot.snapshotId,
            type: 'post-tool',
            toolCall,
            executionResult
          })
        }
      } catch (snapshotError) {
        // Log snapshot error but don't fail tool execution
        if (this.activityLogger && sessionId) {
          await this.activityLogger.logEvent('snapshot_error', sessionId, null, {
            error: snapshotError.message,
            type: 'post-tool',
            toolCall
          })
        }
      }
    }

    // Log tool execution complete
    if (this.activityLogger && sessionId) {
      await this.activityLogger.logEvent('tool_execution_complete', sessionId, null, {
        success,
        result: success ? result : null,
        error,
        duration_ms: duration,
        executionId: toolCall.executionId,
        preSnapshotId: preSnapshot?.snapshotId,
        postSnapshotId: postSnapshot?.snapshotId
      })
    }

    // Now throw the error if tool execution failed
    if (!success) {
      throw new Error(error)
    }

    return result
  }

  /**
   * Generate unique execution ID for tool calls
   */
  generateExecutionId () {
    return `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Gather legacy context format for backward compatibility
   */
  async gatherLegacyContext (sessionId) {
    const context = {
      sessionId,
      timestamp: new Date().toISOString()
    }

    // Add basic conversation context if available
    if (this.conversationDB && sessionId) {
      try {
        const recentHistory = await this.conversationDB.getConversationHistory(sessionId, 3)
        context.conversationTurns = recentHistory ? recentHistory.length : 0
        context.recentHistory = recentHistory || []
      } catch (error) {
        // Ignore errors in legacy context gathering
        context.conversationTurns = 0
        context.recentHistory = []
      }
    }

    return context
  }
}
