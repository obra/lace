// ABOUTME: SQLite-based conversation database for persistent memory storage
// ABOUTME: Handles full conversation history, context summaries, and queryable interactions

import Database from 'sqlite3'
import { promisify } from 'util'

export class ConversationDB {
  constructor (path) {
    this.path = path
    this.db = null
  }

  async initialize () {
    await new Promise((resolve, reject) => {
      this.db = new Database.Database(this.path, (err) => {
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
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        generation INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        context_size INTEGER
      )
    `)

    await this.run(`
      CREATE TABLE IF NOT EXISTS agent_generations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        generation INTEGER NOT NULL,
        compressed_context TEXT,
        handoff_reason TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    await this.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
        current_generation INTEGER DEFAULT 0
      )
    `)

    // Indexes for fast querying
    await this.run('CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id)')
    await this.run('CREATE INDEX IF NOT EXISTS idx_conversations_generation ON conversations(generation)')
    await this.run('CREATE INDEX IF NOT EXISTS idx_conversations_timestamp ON conversations(timestamp)')
  }

  async saveMessage (sessionId, generation, role, content, toolCalls = null, contextSize = null) {
    await this.run(`
      INSERT INTO conversations (session_id, generation, role, content, tool_calls, context_size)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [sessionId, generation, role, content, JSON.stringify(toolCalls), contextSize])
  }

  async saveHandoff (sessionId, generation, compressedContext, reason) {
    await this.run(`
      INSERT INTO agent_generations (session_id, generation, compressed_context, handoff_reason)
      VALUES (?, ?, ?, ?)
    `, [sessionId, generation, compressedContext, reason])
  }

  async getConversationHistory (sessionId, limit = 100) {
    return await this.all(`
      SELECT * FROM conversations 
      WHERE session_id = ? 
      ORDER BY id DESC 
      LIMIT ?
    `, [sessionId, limit])
  }

  async searchConversations (sessionId, query, limit = 20) {
    return await this.all(`
      SELECT * FROM conversations 
      WHERE session_id = ? AND content LIKE ? 
      ORDER BY timestamp DESC 
      LIMIT ?
    `, [sessionId, `%${query}%`, limit])
  }

  async getGenerationHistory (sessionId, generation) {
    return await this.all(`
      SELECT * FROM conversations 
      WHERE session_id = ? AND generation = ? 
      ORDER BY timestamp ASC
    `, [sessionId, generation])
  }

  async close () {
    if (this.db) {
      return new Promise((resolve) => {
        this.db.close(resolve)
      })
    }
  }
}
