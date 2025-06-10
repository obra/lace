// ABOUTME: Lightweight in-memory progress tracking system for agent coordination
// ABOUTME: Stores progress updates without polluting conversation context, supports aggregation and callbacks

export class ProgressTracker {
  constructor (options = {}) {
    this.progressData = new Map() // agentId -> progress data
    this.callbacks = new Set() // UI callback functions
    this.cleanupInterval = options.cleanupInterval || 300000 // 5 minutes
    this.maxAge = options.maxAge || 3600000 // 1 hour
    this.maxEntries = options.maxEntries || 1000 // Prevent memory leaks

    // Start cleanup timer
    this.cleanupTimer = setInterval(() => {
      this.cleanup()
    }, this.cleanupInterval)
  }

  /**
   * Update progress for a specific agent
   * @param {string|number} agentId - Unique identifier for the agent
   * @param {Object} progressUpdate - Progress data object
   * @param {string} progressUpdate.status - Status (in_progress, completed, failed, waiting, needs_help)
   * @param {number} [progressUpdate.progressPercent] - Progress percentage (0-100)
   * @param {string} [progressUpdate.details] - Brief progress details (<50 tokens)
   * @param {number} [progressUpdate.timestamp] - Timestamp (defaults to now)
   * @param {Object} [progressUpdate.helpRequest] - Help request data if status is needs_help
   */
  async updateProgress (agentId, progressUpdate) {
    if (agentId == null || !progressUpdate || !progressUpdate.status) {
      throw new Error('Agent ID and status are required for progress updates')
    }

    const timestamp = progressUpdate.timestamp || Date.now()
    const existingProgress = this.progressData.get(agentId) || {}

    // Create updated progress data
    const updatedProgress = {
      ...existingProgress,
      agentId,
      status: progressUpdate.status,
      progressPercent: progressUpdate.progressPercent ?? existingProgress.progressPercent,
      details: progressUpdate.details || existingProgress.details || '',
      timestamp,
      lastUpdated: timestamp,
      helpRequest: progressUpdate.helpRequest || existingProgress.helpRequest
    }

    // Ensure details stay concise (< 50 tokens ≈ 200 chars)
    if (updatedProgress.details.length > 200) {
      updatedProgress.details = `${updatedProgress.details.substring(0, 197)}...`
    }

    // Store in memory
    this.progressData.set(agentId, updatedProgress)

    // Check for memory limits
    if (this.progressData.size > this.maxEntries) {
      this.cleanupOldest()
    }

    // Notify callbacks
    await this.notifyCallbacks('progress_update', {
      agentId,
      progress: updatedProgress
    })

    return {
      success: true,
      agentId,
      timestamp
    }
  }

  /**
   * Get progress for a specific agent
   * @param {string|number} agentId - Agent identifier
   * @returns {Object|null} Progress data or null if not found
   */
  getProgress (agentId) {
    return this.progressData.get(agentId) || null
  }

  /**
   * Get all progress data
   * @returns {Array} Array of all progress entries
   */
  getAllProgress () {
    return Array.from(this.progressData.values())
  }

  /**
   * Get progress summary for multiple agents
   * @param {Array} [agentIds] - Specific agent IDs to include (optional)
   * @returns {Object} Aggregated progress summary
   */
  getProgressSummary (agentIds = null) {
    const progressEntries = agentIds
      ? agentIds.map(id => this.progressData.get(id)).filter(Boolean)
      : Array.from(this.progressData.values())

    if (progressEntries.length === 0) {
      return {
        totalAgents: 0,
        summary: 'No active agents',
        statusCounts: {},
        overallProgress: 0,
        lastUpdated: null
      }
    }

    // Aggregate status counts
    const statusCounts = {}
    let totalProgress = 0
    let agentsWithProgress = 0
    let lastUpdated = 0
    const helpRequests = []

    for (const progress of progressEntries) {
      statusCounts[progress.status] = (statusCounts[progress.status] || 0) + 1

      if (progress.progressPercent !== null && progress.progressPercent !== undefined) {
        totalProgress += progress.progressPercent
        agentsWithProgress++
      }

      if (progress.timestamp > lastUpdated) {
        lastUpdated = progress.timestamp
      }

      if (progress.status === 'needs_help' && progress.helpRequest) {
        helpRequests.push({
          agentId: progress.agentId,
          helpRequest: progress.helpRequest
        })
      }
    }

    // Calculate overall progress
    const overallProgress = agentsWithProgress > 0
      ? Math.round(totalProgress / agentsWithProgress)
      : 0

    // Generate concise summary text
    const summary = this.generateSummaryText(statusCounts, progressEntries.length)

    return {
      totalAgents: progressEntries.length,
      summary,
      statusCounts,
      overallProgress,
      lastUpdated: lastUpdated || null,
      helpRequests
    }
  }

  /**
   * Remove progress data for completed or failed agents
   * @param {string|number} agentId - Agent identifier
   */
  removeProgress (agentId) {
    const removed = this.progressData.delete(agentId)
    if (removed) {
      this.notifyCallbacks('progress_removed', { agentId })
    }
    return removed
  }

  /**
   * Clear all progress data
   */
  clearAll () {
    this.progressData.clear()
    this.notifyCallbacks('progress_cleared', {})
  }

  /**
   * Register a callback for progress updates
   * @param {Function} callback - Callback function (eventType, data) => void
   */
  addCallback (callback) {
    if (typeof callback === 'function') {
      this.callbacks.add(callback)
    }
  }

  /**
   * Remove a progress callback
   * @param {Function} callback - Callback function to remove
   */
  removeCallback (callback) {
    this.callbacks.delete(callback)
  }

  /**
   * Get agents that need help
   * @returns {Array} Array of agents with status 'needs_help'
   */
  getAgentsNeedingHelp () {
    return Array.from(this.progressData.values())
      .filter(progress => progress.status === 'needs_help')
      .map(progress => ({
        agentId: progress.agentId,
        details: progress.details,
        helpRequest: progress.helpRequest,
        timestamp: progress.timestamp
      }))
  }

  /**
   * Get active (non-completed, non-failed) agents
   * @returns {Array} Array of active agent progress
   */
  getActiveAgents () {
    return Array.from(this.progressData.values())
      .filter(progress => !['completed', 'failed'].includes(progress.status))
  }

  /**
   * Generate concise summary text from status counts
   * @private
   */
  generateSummaryText (statusCounts, totalAgents) {
    const parts = []

    if (statusCounts.in_progress) {
      parts.push(`${statusCounts.in_progress} active`)
    }
    if (statusCounts.completed) {
      parts.push(`${statusCounts.completed} done`)
    }
    if (statusCounts.failed) {
      parts.push(`${statusCounts.failed} failed`)
    }
    if (statusCounts.waiting) {
      parts.push(`${statusCounts.waiting} waiting`)
    }
    if (statusCounts.needs_help) {
      parts.push(`${statusCounts.needs_help} need help`)
    }

    if (parts.length === 0) {
      return `${totalAgents} agent${totalAgents === 1 ? '' : 's'}`
    }

    return parts.join(', ')
  }

  /**
   * Notify all registered callbacks
   * @private
   */
  async notifyCallbacks (eventType, data) {
    const promises = Array.from(this.callbacks).map(async callback => {
      try {
        await callback(eventType, data)
      } catch (error) {
        // Silently ignore callback errors to prevent breaking progress tracking
        console.warn('Progress tracker callback error:', error.message)
      }
    })

    // Don't wait for all callbacks to complete
    Promise.allSettled(promises)
  }

  /**
   * Clean up old progress entries
   * @private
   */
  cleanup () {
    const now = Date.now()
    const cutoff = now - this.maxAge

    for (const [agentId, progress] of this.progressData.entries()) {
      // Remove old entries or completed/failed entries older than 1 minute
      const isOld = progress.lastUpdated < cutoff
      const isFinishedAndStale =
        ['completed', 'failed'].includes(progress.status) &&
        (now - progress.lastUpdated) > 60000 // 1 minute

      if (isOld || isFinishedAndStale) {
        this.progressData.delete(agentId)
      }
    }
  }

  /**
   * Remove oldest entries when hitting memory limits
   * @private
   */
  cleanupOldest () {
    const entries = Array.from(this.progressData.entries())
      .sort((a, b) => a[1].lastUpdated - b[1].lastUpdated)

    // Remove oldest 10% of entries
    const toRemove = Math.max(1, Math.floor(entries.length * 0.1))
    for (let i = 0; i < toRemove; i++) {
      this.progressData.delete(entries[i][0])
    }
  }

  /**
   * Destroy the progress tracker and clean up resources
   */
  destroy () {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    this.clearAll()
    this.callbacks.clear()
  }
}
