// ABOUTME: Captures rich context from conversation and activity data for snapshot metadata enrichment
// ABOUTME: Integrates with ConversationDB and ActivityLogger to provide comprehensive snapshot context

import { promises as fs } from 'fs'
import { join } from 'path'
import simpleGit from 'simple-git'

export class ContextCapture {
  constructor (conversationDB, activityLogger, config = {}) {
    this.conversationDB = conversationDB
    this.activityLogger = activityLogger

    // Default configuration
    this.config = {
      conversationTurnsToCapture: 5,
      toolUsesToCapture: 10,
      searchDepth: 3,
      cacheTimeout: 60000, // 1 minute
      ...config
    }

    // Simple in-memory cache for performance
    this.cache = new Map()
  }

  /**
   * Capture conversation context for a session and generation
   */
  async captureConversationContext (sessionId, generation) {
    const cacheKey = `conv-${sessionId}-${generation}`

    try {
      // Check cache first
      if (this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey)
        if (Date.now() - cached.timestamp < this.config.cacheTimeout) {
          return cached.data
        }
      }

      const recentHistory = await this.conversationDB.getConversationHistory(
        sessionId,
        this.config.conversationTurnsToCapture
      )

      // Ensure we respect the configured limit (in case DB returns more)
      const limitedHistory = recentHistory ? recentHistory.slice(0, this.config.conversationTurnsToCapture) : []

      const context = {
        sessionId,
        currentGeneration: generation,
        recentHistory: limitedHistory,
        conversationTurns: limitedHistory.length,
        captureTimestamp: new Date().toISOString()
      }

      // Cache the result
      this.cache.set(cacheKey, {
        data: context,
        timestamp: Date.now()
      })

      return context
    } catch (error) {
      // Return degraded context on error
      return {
        sessionId,
        currentGeneration: generation,
        recentHistory: [],
        conversationTurns: 0,
        captureTimestamp: new Date().toISOString(),
        error: error.message
      }
    }
  }

  /**
   * Capture activity context for a session
   */
  async captureActivityContext (sessionId) {
    const cacheKey = `activity-${sessionId}`

    try {
      // Check cache first
      if (this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey)
        if (Date.now() - cached.timestamp < this.config.cacheTimeout) {
          return cached.data
        }
      }

      const allEvents = await this.activityLogger.getEvents({
        sessionId,
        limit: this.config.toolUsesToCapture * 2 // Get more to filter
      })

      // Filter events for this session and limit to configured amount
      const sessionEvents = allEvents
        .filter(event => event.localSessionId === sessionId)
        .slice(0, this.config.toolUsesToCapture)

      const context = {
        recentToolUses: sessionEvents,
        toolUsageCount: sessionEvents.length,
        captureTimestamp: new Date().toISOString()
      }

      // Cache the result
      this.cache.set(cacheKey, {
        data: context,
        timestamp: Date.now()
      })

      return context
    } catch (error) {
      // Return degraded context on error
      return {
        recentToolUses: [],
        toolUsageCount: 0,
        captureTimestamp: new Date().toISOString(),
        error: error.message
      }
    }
  }

  /**
   * Get real repository SHA from project directory
   */
  async getRealRepoSha (projectPath) {
    try {
      // Check if there's a .git file or directory in the project path specifically
      const gitPath = join(projectPath, '.git')

      try {
        await fs.access(gitPath)
      } catch (error) {
        // No .git in this specific directory
        return 'unknown'
      }

      const git = simpleGit(projectPath)
      const log = await git.log(['-1'])

      if (log.latest && log.latest.hash) {
        return log.latest.hash.substring(0, 7)
      }

      return 'unknown'
    } catch (error) {
      return 'unknown'
    }
  }

  /**
   * Capture comprehensive context for tool execution
   */
  async captureFullContext (sessionId, generation, toolCall, projectPath) {
    try {
      // Capture all context types in parallel for performance
      const [conversationContext, activityContext, realRepoSha, relatedContext] = await Promise.all([
        this.captureConversationContext(sessionId, generation),
        this.captureActivityContext(sessionId),
        this.getRealRepoSha(projectPath),
        this.findRelatedConversations(sessionId, toolCall)
      ])

      // Enrich with tool-specific context
      const toolEnrichment = await this.enrichContextForTool(toolCall, sessionId)

      return {
        // Conversation context
        ...conversationContext,

        // Activity context
        ...activityContext,

        // Repository context
        realRepoSha,

        // Current tool context
        currentTool: toolCall,

        // Related conversations
        relatedContext,

        // Tool-specific enrichment
        ...toolEnrichment,

        // Metadata
        captureTimestamp: new Date().toISOString(),
        contextVersion: '1.0'
      }
    } catch (error) {
      // Return minimal context on error
      return {
        sessionId,
        currentGeneration: generation,
        recentHistory: [],
        recentToolUses: [],
        currentTool: toolCall,
        realRepoSha: 'unknown',
        captureTimestamp: new Date().toISOString(),
        error: error.message
      }
    }
  }

  /**
   * Find related conversations based on tool context
   */
  async findRelatedConversations (sessionId, toolCall) {
    try {
      const searchTerms = this.generateSearchTerms(toolCall)
      const searchPromises = searchTerms.slice(0, this.config.searchDepth).map(term =>
        this.conversationDB.searchConversations(sessionId, term, 3)
      )

      const searchResults = await Promise.all(searchPromises)
      const flatResults = searchResults.flat()

      // Deduplicate by ID and take most recent
      const uniqueResults = Array.from(
        new Map(flatResults.map(item => [item.id, item])).values()
      ).slice(0, 5)

      return uniqueResults
    } catch (error) {
      return []
    }
  }

  /**
   * Enrich context with tool-specific semantic information
   */
  async enrichContextForTool (toolCall, sessionId) {
    const toolName = toolCall.toolName
    const operation = toolCall.operation
    const parameters = toolCall.parameters || {}

    // Categorize the tool
    const toolCategory = this.categorizeToolCall(toolCall)

    // Generate semantic hints
    const semanticHints = this.generateSemanticHints(toolCall)

    // Generate context keywords
    const contextKeywords = this.generateSearchTerms(toolCall)

    return {
      toolCategory,
      semanticHints,
      contextKeywords,
      enrichmentTimestamp: new Date().toISOString()
    }
  }

  /**
   * Generate search terms from tool call
   */
  generateSearchTerms (toolCall) {
    const terms = []

    // Add tool name
    if (toolCall.toolName) {
      terms.push(toolCall.toolName)
    }

    // Add operation
    if (toolCall.operation) {
      terms.push(toolCall.operation)
    }

    // Extract from parameters
    if (toolCall.parameters) {
      const params = toolCall.parameters

      // File paths
      if (params.path) {
        const pathParts = params.path.split(/[\/\\]/).filter(p => p && p !== '.')
        terms.push(...pathParts)

        // Extract filename without extension
        const filename = pathParts[pathParts.length - 1]
        if (filename && filename.includes('.')) {
          const nameWithoutExt = filename.split('.')[0]
          terms.push(nameWithoutExt)
        }
      }

      // Content keywords (extract common programming terms)
      if (params.content) {
        const contentKeywords = this.extractKeywords(params.content)
        terms.push(...contentKeywords)
      }

      // Command or query terms
      if (params.command) {
        const commandParts = params.command.split(/\s+/).filter(p => p.length > 2)
        terms.push(...commandParts.slice(0, 3)) // Limit to first 3 words
      }
    }

    // Remove duplicates and return
    return [...new Set(terms)].slice(0, 10) // Limit to 10 terms
  }

  /**
   * Categorize tool call for semantic understanding
   */
  categorizeToolCall (toolCall) {
    const toolName = toolCall.toolName?.toLowerCase() || ''
    const operation = toolCall.operation?.toLowerCase() || ''

    if (toolName.includes('file')) {
      if (operation.includes('read')) return 'file-read'
      if (operation.includes('write')) return 'file-write'
      if (operation.includes('edit')) return 'file-edit'
      return 'file-operation'
    }

    if (toolName.includes('shell') || toolName.includes('command')) {
      return 'shell-execution'
    }

    if (toolName.includes('search')) {
      return 'search-operation'
    }

    if (toolName.includes('javascript') || toolName.includes('eval')) {
      return 'code-execution'
    }

    return 'general-tool'
  }

  /**
   * Generate semantic hints for the tool operation
   */
  generateSemanticHints (toolCall) {
    const category = this.categorizeToolCall(toolCall)
    const hints = []

    switch (category) {
      case 'file-read':
        hints.push('Reading file content', 'May reference existing code or data')
        break
      case 'file-write':
        hints.push('Creating or modifying file', 'Implementing new functionality')
        break
      case 'file-edit':
        hints.push('Updating existing code', 'Refactoring or bug fixing')
        break
      case 'shell-execution':
        hints.push('Running system command', 'Environment or build operation')
        break
      case 'search-operation':
        hints.push('Looking for information', 'Exploring codebase')
        break
      case 'code-execution':
        hints.push('Running code logic', 'Testing or computation')
        break
      default:
        hints.push('General tool operation')
    }

    return hints
  }

  /**
   * Extract keywords from text content
   */
  extractKeywords (content) {
    if (!content || typeof content !== 'string') {
      return []
    }

    // Simple keyword extraction for programming content
    const keywords = []

    // Common programming patterns
    const patterns = [
      /function\s+(\w+)/g,
      /class\s+(\w+)/g,
      /const\s+(\w+)/g,
      /let\s+(\w+)/g,
      /var\s+(\w+)/g,
      /import\s+.*?from\s+['"]([^'"]+)['"]/g,
      /require\(['"]([^'"]+)['"]\)/g
    ]

    patterns.forEach(pattern => {
      let match
      while ((match = pattern.exec(content)) !== null) {
        if (match[1]) {
          keywords.push(match[1])
        }
      }
    })

    return [...new Set(keywords)].slice(0, 5) // Limit and deduplicate
  }

  /**
   * Clear cache (for memory management)
   */
  clearCache () {
    this.cache.clear()
  }

  /**
   * Get cache statistics
   */
  getCacheStats () {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys())
    }
  }
}
