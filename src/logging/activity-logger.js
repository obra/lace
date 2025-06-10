// ABOUTME: SQLite-based activity logger for forensic audit trail of all lace operations
// ABOUTME: Always-on logging of user inputs, agent responses, model calls, and tool executions

import Database from 'sqlite3'
import { promisify } from 'util'
import { promises as fs } from 'fs'
import { dirname } from 'path'
import { EventEmitter } from 'events'

export class ActivityLogger extends EventEmitter {
  constructor (dbPath = '.lace/activity.db') {
    super()
    this.dbPath = dbPath
    this.db = null
  }

  async initialize () {
    // Create .lace directory if it doesn't exist
    const dbDir = dirname(this.dbPath)
    await fs.mkdir(dbDir, { recursive: true })

    await new Promise((resolve, reject) => {
      this.db = new Database.Database(this.dbPath, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })

    // Promisify database methods
    this.run = promisify(this.db.run.bind(this.db))
    this.get = promisify(this.db.get.bind(this.db))
    this.all = promisify(this.db.all.bind(this.db))

    await this.createTables()
  }

  async createTables () {
    await this.run(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        event_type TEXT NOT NULL,
        local_session_id TEXT NOT NULL,
        model_session_id TEXT,
        data TEXT NOT NULL
      )
    `)

    // Create indexes for performance
    await this.run(`
      CREATE INDEX IF NOT EXISTS idx_session ON events(local_session_id)
    `)

    await this.run(`
      CREATE INDEX IF NOT EXISTS idx_timestamp ON events(timestamp)
    `)

    await this.run(`
      CREATE INDEX IF NOT EXISTS idx_event_type ON events(event_type)
    `)
  }

  async logEvent (eventType, localSessionId, modelSessionId, data) {
    if (!this.db) {
      console.error('ActivityLogger: Database not initialized')
      return
    }

    try {
      const timestamp = new Date().toISOString()
      const dataJson = typeof data === 'string' ? data : JSON.stringify(data)

      await this.run(
        `INSERT INTO events (timestamp, event_type, local_session_id, model_session_id, data) 
         VALUES (?, ?, ?, ?, ?)`,
        [timestamp, eventType, localSessionId, modelSessionId, dataJson]
      )

      // Emit event for real-time streaming
      const event = {
        id: Date.now(), // Temporary ID for real-time events
        timestamp,
        event_type: eventType,
        local_session_id: localSessionId,
        model_session_id: modelSessionId,
        data: dataJson
      }

      this.emit('activity', event)
    } catch (error) {
      // Activity logging failures should not break normal operation
      console.error('ActivityLogger: Failed to log event:', error.message)
    }
  }

  async getEvents (options = {}) {
    if (!this.db) {
      throw new Error('ActivityLogger: Database not initialized')
    }

    let query = 'SELECT * FROM events'
    const params = []
    const conditions = []

    if (options.sessionId) {
      conditions.push('local_session_id = ?')
      params.push(options.sessionId)
    }

    if (options.eventType) {
      conditions.push('event_type = ?')
      params.push(options.eventType)
    }

    if (options.since) {
      conditions.push('timestamp >= ?')
      params.push(options.since)
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`
    }

    query += ' ORDER BY timestamp DESC'

    if (options.limit) {
      query += ' LIMIT ?'
      params.push(options.limit)
    }

    return await this.all(query, params)
  }

  async getRecentEvents (limit = 50) {
    if (!this.db) {
      throw new Error('ActivityLogger: Database not initialized')
    }

    return await this.all(
      'SELECT * FROM events ORDER BY timestamp DESC LIMIT ?',
      [limit]
    )
  }

  async close () {
    if (this.db) {
      await new Promise((resolve, reject) => {
        this.db.close((err) => {
          if (err) reject(err)
          else resolve()
        })
      })
      this.db = null
    }
  }
}
