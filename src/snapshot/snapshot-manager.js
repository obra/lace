// ABOUTME: Coordinates snapshot creation and management for the Lace development safety net
// ABOUTME: Handles metadata management, configuration, indexing, and snapshot lifecycle operations

import { promises as fs } from 'fs'
import { join } from 'path'
import { GitOperations } from './git-operations.js'
import { ContextCapture } from './context-capture.js'

export class SnapshotManager {
  constructor (projectPath, config = null) {
    if (!projectPath || typeof projectPath !== 'string') {
      throw new Error('Invalid project path provided')
    }

    this.projectPath = projectPath
    this.laceDir = join(projectPath, '.lace')
    this.snapshotsDir = join(projectPath, '.lace', 'snapshots')
    this.metadataDir = join(projectPath, '.lace', 'snapshots', 'metadata')
    this.configPath = join(projectPath, '.lace', 'snapshot-config.json')
    this.indexPath = join(projectPath, '.lace', 'snapshots', 'index.json')

    // Default configuration
    this.defaultConfig = {
      enabled: true,
      retentionPolicy: {
        maxAge: '7 days',
        maxSnapshots: 1000,
        keepCheckpoints: true
      },
      performance: {
        excludePatterns: ['node_modules/**', '*.log', '.DS_Store'],
        compressionLevel: 6,
        backgroundPruning: true
      },
      integration: {
        autoSnapshotOnToolUse: true,
        conversationTurnsToCapture: 5,
        toolUsesToCapture: 10
      }
    }

    this.config = config || { ...this.defaultConfig }
    this.gitOps = null
    this.contextCapture = null
  }

  /**
   * Set up context capture with database connections
   */
  setupContextCapture (conversationDB, activityLogger) {
    this.contextCapture = new ContextCapture(
      conversationDB,
      activityLogger,
      this.config.integration
    )
  }

  /**
   * Initialize the snapshot manager
   */
  async initialize () {
    try {
      // Create directory structure
      await fs.mkdir(this.laceDir, { recursive: true })
      await fs.mkdir(this.snapshotsDir, { recursive: true })
      await fs.mkdir(this.metadataDir, { recursive: true })

      // Load or create configuration
      await this.loadOrCreateConfig()

      // Validate configuration
      this.validateConfig()

      // Initialize git operations (unless already set, e.g., in tests)
      if (!this.gitOps) {
        this.gitOps = new GitOperations(this.projectPath)
      }
      await this.gitOps.initialize()

      // Create or load index
      await this.initializeIndex()
    } catch (error) {
      throw new Error(`Failed to initialize snapshot manager: ${error.message}`)
    }
  }

  /**
   * Load existing config or create default
   */
  async loadOrCreateConfig () {
    try {
      const configData = await fs.readFile(this.configPath, 'utf8')
      const loadedConfig = JSON.parse(configData)

      // Merge with defaults for any missing keys
      this.config = { ...this.defaultConfig, ...loadedConfig }
    } catch (error) {
      // Config doesn't exist, use default and save it
      await this.saveConfig()
    }
  }

  /**
   * Save configuration to file
   */
  async saveConfig () {
    await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2))
  }

  /**
   * Validate configuration
   */
  validateConfig () {
    if (this.config.retentionPolicy.maxSnapshots < 0) {
      throw new Error('Invalid configuration: maxSnapshots cannot be negative')
    }
    // Add more validation as needed
  }

  /**
   * Initialize snapshot index
   */
  async initializeIndex () {
    try {
      await fs.access(this.indexPath)
      // Index exists, load it
    } catch (error) {
      // Index doesn't exist, create it
      const initialIndex = {
        snapshots: [],
        lastUpdated: new Date().toISOString(),
        version: '1.0'
      }
      await fs.writeFile(this.indexPath, JSON.stringify(initialIndex, null, 2))
    }
  }

  /**
   * Create a pre-tool snapshot
   */
  async createPreToolSnapshot (toolCall, legacyContext = {}, sessionId = null, generation = null) {
    if (!this.config.enabled) return null

    const snapshotId = this.generateSnapshotId('pre-tool', toolCall.executionId)
    const timestamp = new Date().toISOString()

    try {
      const startTime = Date.now()

      // Create git commit
      const gitCommitSha = await this.gitOps.addAndCommit(
        `Pre-tool snapshot: ${toolCall.toolName} ${snapshotId}`
      )

      const processingTime = Date.now() - startTime

      // Capture rich context if available
      let enrichedContext = legacyContext
      if (this.contextCapture && sessionId !== null && generation !== null) {
        try {
          enrichedContext = await this.contextCapture.captureFullContext(
            sessionId,
            generation,
            toolCall,
            this.projectPath
          )
        } catch (error) {
          // Fall back to legacy context on error
          enrichedContext = { ...legacyContext, contextCaptureError: error.message }
        }
      }

      // Create metadata
      const metadata = {
        snapshotId,
        timestamp,
        type: 'pre-tool',
        gitCommitSha,
        realRepoSha: enrichedContext.realRepoSha || await this.getRealRepoSha(),
        toolCall,
        context: enrichedContext,
        performance: {
          filesChanged: await this.getChangedFilesCount(),
          snapshotSizeBytes: await this.estimateSnapshotSize(),
          processingTimeMs: processingTime
        }
      }

      // Save metadata
      await this.saveSnapshotMetadata(metadata)

      // Update index
      await this.updateIndex(metadata)

      return metadata
    } catch (error) {
      throw new Error(`Failed to create pre-tool snapshot: ${error.message}`)
    }
  }

  /**
   * Create a post-tool snapshot
   */
  async createPostToolSnapshot (toolCall, legacyContext = {}, executionResult, sessionId = null, generation = null) {
    if (!this.config.enabled) return null

    const snapshotId = this.generateSnapshotId('post-tool', toolCall.executionId)
    const timestamp = new Date().toISOString()

    try {
      const startTime = Date.now()

      // Create git commit
      const gitCommitSha = await this.gitOps.addAndCommit(
        `Post-tool snapshot: ${toolCall.toolName} ${snapshotId}`
      )

      const processingTime = Date.now() - startTime

      // Capture rich context if available
      let enrichedContext = legacyContext
      if (this.contextCapture && sessionId !== null && generation !== null) {
        try {
          enrichedContext = await this.contextCapture.captureFullContext(
            sessionId,
            generation,
            toolCall,
            this.projectPath
          )
        } catch (error) {
          // Fall back to legacy context on error
          enrichedContext = { ...legacyContext, contextCaptureError: error.message }
        }
      }

      // Create metadata
      const metadata = {
        snapshotId,
        timestamp,
        type: 'post-tool',
        gitCommitSha,
        realRepoSha: enrichedContext.realRepoSha || await this.getRealRepoSha(),
        toolCall,
        context: enrichedContext,
        executionResult,
        performance: {
          filesChanged: await this.getChangedFilesCount(),
          snapshotSizeBytes: await this.estimateSnapshotSize(),
          processingTimeMs: processingTime
        }
      }

      // Save metadata
      await this.saveSnapshotMetadata(metadata)

      // Update index
      await this.updateIndex(metadata)

      return metadata
    } catch (error) {
      throw new Error(`Failed to create post-tool snapshot: ${error.message}`)
    }
  }

  /**
   * Create a manual checkpoint
   */
  async createCheckpoint (description) {
    if (!this.config.enabled) return null

    const snapshotId = this.generateSnapshotId('checkpoint')
    const timestamp = new Date().toISOString()

    try {
      const startTime = Date.now()

      // Create git commit
      const gitCommitSha = await this.gitOps.addAndCommit(
        `Checkpoint: ${description} ${snapshotId}`
      )

      const processingTime = Date.now() - startTime

      // Create metadata
      const metadata = {
        snapshotId,
        timestamp,
        type: 'checkpoint',
        description,
        gitCommitSha,
        realRepoSha: await this.getRealRepoSha(),
        performance: {
          filesChanged: await this.getChangedFilesCount(),
          snapshotSizeBytes: await this.estimateSnapshotSize(),
          processingTimeMs: processingTime
        }
      }

      // Save metadata
      await this.saveSnapshotMetadata(metadata)

      // Update index
      await this.updateIndex(metadata)

      return metadata
    } catch (error) {
      throw new Error(`Failed to create checkpoint: ${error.message}`)
    }
  }

  /**
   * Generate unique snapshot ID
   */
  generateSnapshotId (type, executionId = null) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const suffix = executionId ? `-${executionId.slice(-6)}` : ''
    return `${timestamp}-${type}${suffix}`
  }

  /**
   * Save snapshot metadata
   */
  async saveSnapshotMetadata (metadata) {
    const metadataPath = join(this.metadataDir, `${metadata.snapshotId}.json`)
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2))
  }

  /**
   * Load snapshot metadata
   */
  async loadSnapshotMetadata (snapshotId) {
    try {
      const metadataPath = join(this.metadataDir, `${snapshotId}.json`)
      const data = await fs.readFile(metadataPath, 'utf8')
      return JSON.parse(data)
    } catch (error) {
      throw new Error(`Snapshot metadata not found: ${snapshotId}`)
    }
  }

  /**
   * Update snapshot index
   */
  async updateIndex (metadata) {
    const index = await this.getSnapshotIndex()

    index.snapshots.unshift({
      snapshotId: metadata.snapshotId,
      timestamp: metadata.timestamp,
      type: metadata.type,
      description: metadata.description || null
    })

    index.lastUpdated = new Date().toISOString()

    await fs.writeFile(this.indexPath, JSON.stringify(index, null, 2))
  }

  /**
   * Get snapshot index
   */
  async getSnapshotIndex () {
    try {
      const data = await fs.readFile(this.indexPath, 'utf8')
      return JSON.parse(data)
    } catch (error) {
      // Return empty index if file doesn't exist
      return {
        snapshots: [],
        lastUpdated: new Date().toISOString(),
        version: '1.0'
      }
    }
  }

  /**
   * List snapshots with optional filtering
   */
  async listSnapshots (filters = {}) {
    const index = await this.getSnapshotIndex()
    let snapshots = index.snapshots

    // Apply filters
    if (filters.type) {
      snapshots = snapshots.filter(s => s.type === filters.type)
    }

    if (filters.tool) {
      // Load metadata for tool filtering
      const filtered = []
      for (const snapshot of snapshots) {
        try {
          const metadata = await this.loadSnapshotMetadata(snapshot.snapshotId)
          if (metadata.toolCall && metadata.toolCall.toolName === filters.tool) {
            filtered.push(snapshot)
          }
        } catch (error) {
          // Skip snapshots with missing metadata
        }
      }
      snapshots = filtered
    }

    if (filters.since) {
      const sinceTime = new Date(filters.since)
      snapshots = snapshots.filter(s => new Date(s.timestamp) >= sinceTime)
    }

    return snapshots
  }

  /**
   * Apply retention policy
   */
  async applyRetentionPolicy () {
    const index = await this.getSnapshotIndex()
    const { maxSnapshots, maxAge, keepCheckpoints } = this.config.retentionPolicy

    let toDelete = []

    // Apply snapshot count limit
    if (index.snapshots.length > maxSnapshots) {
      const excess = index.snapshots.slice(maxSnapshots)
      toDelete.push(...excess.filter(s => !keepCheckpoints || s.type !== 'checkpoint'))
    }

    // Apply age limit if specified
    if (maxAge) {
      const maxAgeMs = this.parseTimeString(maxAge)
      const cutoffTime = new Date(Date.now() - maxAgeMs)

      const expired = index.snapshots.filter(s => {
        const snapshotTime = new Date(s.timestamp)
        return snapshotTime < cutoffTime && (!keepCheckpoints || s.type !== 'checkpoint')
      })

      toDelete.push(...expired)
    }

    // Remove duplicates
    toDelete = [...new Set(toDelete.map(s => s.snapshotId))]

    // Delete snapshots
    for (const snapshotId of toDelete) {
      await this.deleteSnapshot(snapshotId)
    }

    return toDelete.length
  }

  /**
   * Check if file should be excluded
   */
  shouldExcludeFile (filePath) {
    const patterns = this.config.performance.excludePatterns

    for (const pattern of patterns) {
      // Simple glob matching - could be enhanced with a proper glob library
      if (pattern.includes('**')) {
        const regex = new RegExp(pattern.replace('**', '.*').replace('*', '[^/]*'))
        if (regex.test(filePath)) return true
      } else if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace('*', '.*'))
        if (regex.test(filePath)) return true
      } else if (filePath.includes(pattern)) {
        return true
      }
    }

    return false
  }

  /**
   * Get system statistics
   */
  async getSystemStats () {
    const index = await this.getSnapshotIndex()
    const snapshots = index.snapshots

    if (snapshots.length === 0) {
      return {
        totalSnapshots: 0,
        totalSize: 0,
        averageSnapshotSize: 0,
        oldestSnapshot: null,
        newestSnapshot: null
      }
    }

    let totalSize = 0
    for (const snapshot of snapshots) {
      try {
        const metadata = await this.loadSnapshotMetadata(snapshot.snapshotId)
        totalSize += metadata.performance?.snapshotSizeBytes || 0
      } catch (error) {
        // Skip snapshots with missing metadata
      }
    }

    return {
      totalSnapshots: snapshots.length,
      totalSize,
      averageSnapshotSize: Math.round(totalSize / snapshots.length),
      oldestSnapshot: snapshots[snapshots.length - 1]?.timestamp || null,
      newestSnapshot: snapshots[0]?.timestamp || null
    }
  }

  // Helper methods

  async getRealRepoSha () {
    // TODO: Get SHA from the real project repository if it exists
    return 'unknown'
  }

  async getChangedFilesCount () {
    try {
      const changes = await this.gitOps.getChangedFiles()
      return changes.modified.length + changes.untracked.length + changes.deleted.length
    } catch (error) {
      return 0
    }
  }

  async estimateSnapshotSize () {
    // Rough estimation - in production would calculate actual git object sizes
    try {
      const stats = await this.gitOps.getRepositoryStats()
      return stats.repositorySize || 0
    } catch (error) {
      return 0
    }
  }

  parseTimeString (timeStr) {
    const match = timeStr.match(/(\d+)\s*(day|hour|minute)s?/)
    if (!match) return 0

    const value = parseInt(match[1])
    const unit = match[2]

    switch (unit) {
      case 'day': return value * 24 * 60 * 60 * 1000
      case 'hour': return value * 60 * 60 * 1000
      case 'minute': return value * 60 * 1000
      default: return 0
    }
  }

  async deleteSnapshot (snapshotId) {
    try {
      // Delete metadata file
      const metadataPath = join(this.metadataDir, `${snapshotId}.json`)
      await fs.unlink(metadataPath)

      // Remove from index
      const index = await this.getSnapshotIndex()
      index.snapshots = index.snapshots.filter(s => s.snapshotId !== snapshotId)
      index.lastUpdated = new Date().toISOString()
      await fs.writeFile(this.indexPath, JSON.stringify(index, null, 2))
    } catch (error) {
      // Non-critical error, log and continue
      console.warn(`Failed to delete snapshot ${snapshotId}: ${error.message}`)
    }
  }
}
