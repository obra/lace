// ABOUTME: Web server interface that provides HTTP and WebSocket endpoints for the Lace web companion
// ABOUTME: Serves static React UI and streams real-time activity data alongside the console interface

import express from 'express';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execAsync = promisify(exec);

export class WebServer {
  constructor(options = {}) {
    this.port = options.port || 3000;
    this.activityLogger = options.activityLogger;
    this.db = options.db;
    this.verbose = options.verbose || false;
    
    this.app = express();
    this.server = createServer(this.app);
    this.io = new SocketIO(this.server, {
      cors: {
        origin: process.env.NODE_ENV === 'production' ? false : "*",
        methods: ["GET", "POST"]
      }
    });
    
    this.isStarted = false;
    this.connectedClients = new Set();
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupFileApiRoutes();
    this.setupWebSocket();
  }

  setupMiddleware() {
    // Security headers for local development
    this.app.use(helmet({
      frameguard: { action: 'deny' }, // Explicitly set X-Frame-Options to DENY
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'", `ws://localhost:${this.port}`, `http://localhost:${this.port}`],
        },
      },
    }));

    // CORS for local development
    this.app.use(cors({
      origin: process.env.NODE_ENV === 'production' ? false : true,
      credentials: true
    }));

    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
  }

  setupRoutes() {
    // Serve static files from built web directory (or fallback to dev)
    const webDistDir = path.join(__dirname, '../../web/dist');
    const webDir = path.join(__dirname, '../../web');
    
    // Try to serve from dist first (production), fallback to source (development)
    try {
      if (require('fs').existsSync(webDistDir)) {
        if (this.verbose) {
          console.log(`📁 Serving web assets from: ${webDistDir}`);
        }
        this.app.use(express.static(webDistDir));
      } else {
        if (this.verbose) {
          console.log(`📁 Serving web assets from: ${webDir} (dist not found)`);
        }
        this.app.use(express.static(webDir));
      }
    } catch (error) {
      if (this.verbose) {
        console.log(`📁 Serving web assets from: ${webDir} (error: ${error.message})`);
      }
      this.app.use(express.static(webDir));
    }

    // Request validation middleware
    const validateSessionId = (req, res, next) => {
      const { sessionId } = req.params;
      if (!sessionId || typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 100 || sessionId.includes('\x00')) {
        return res.status(400).json({ error: 'Invalid session ID' });
      }
      next();
    };

    const validatePagination = (req, res, next) => {
      const limit = parseInt(req.query.limit);
      if (req.query.limit && (isNaN(limit) || limit < 1 || limit > 1000)) {
        return res.status(400).json({ error: 'Invalid limit parameter (1-1000)' });
      }
      next();
    };

    // Health check endpoint
    this.app.get('/api/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        connectedClients: this.connectedClients.size
      });
    });

    // Conversation API endpoints
    this.app.get('/api/sessions', async (req, res) => {
      try {
        if (!this.db) {
          return res.status(503).json({ error: 'Database not available' });
        }
        
        const sessions = await this.db.all('SELECT * FROM sessions ORDER BY last_active DESC');
        res.json(sessions);
      } catch (error) {
        console.error('Error fetching sessions:', error);
        // Check if it's a database connection error
        if (error.message && (error.message.includes('SQLITE_MISUSE') || error.message.includes('Database is closed'))) {
          res.status(503).json({ error: 'Database not available' });
        } else {
          res.status(500).json({ error: 'Failed to fetch sessions' });
        }
      }
    });

    this.app.get('/api/sessions/:sessionId/messages', validateSessionId, validatePagination, async (req, res) => {
      try {
        if (!this.db) {
          return res.status(503).json({ error: 'Database not available' });
        }

        const { sessionId } = req.params;
        const limit = parseInt(req.query.limit) || 100;
        
        const messages = await this.db.getConversationHistory(sessionId, limit);
        res.json(messages.reverse()); // Return in chronological order
      } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
      }
    });

    this.app.get('/api/sessions/:sessionId/stats', validateSessionId, async (req, res) => {
      try {
        if (!this.db) {
          return res.status(503).json({ error: 'Database not available' });
        }

        const { sessionId } = req.params;
        
        // Get message count and token usage
        const messageCount = await this.db.get(
          'SELECT COUNT(*) as count FROM conversations WHERE session_id = ?',
          [sessionId]
        );

        const tokenStats = await this.db.get(`
          SELECT 
            SUM(context_size) as total_tokens,
            AVG(context_size) as avg_tokens,
            MAX(context_size) as max_tokens
          FROM conversations 
          WHERE session_id = ? AND context_size IS NOT NULL
        `, [sessionId]);

        res.json({
          messageCount: messageCount.count,
          tokenStats: tokenStats || { total_tokens: 0, avg_tokens: 0, max_tokens: 0 }
        });
      } catch (error) {
        console.error('Error fetching session stats:', error);
        res.status(500).json({ error: 'Failed to fetch session stats' });
      }
    });

    // Tool execution API endpoints
    this.app.get('/api/sessions/:sessionId/tools', validateSessionId, validatePagination, async (req, res) => {
      try {
        if (!this.activityLogger) {
          return res.status(503).json({ error: 'Activity logger not available' });
        }

        const { sessionId } = req.params;
        const limit = parseInt(req.query.limit) || 100;
        
        // Get tool-related events for the session
        const toolEvents = await this.activityLogger.getEvents({
          sessionId: sessionId,
          limit: limit
        });
        
        // Filter for tool-related events
        const filteredEvents = toolEvents.filter(event => 
          event.event_type.startsWith('tool_')
        );
        
        res.json(filteredEvents.reverse()); // Return in chronological order
      } catch (error) {
        console.error('Error fetching tool events:', error);
        res.status(500).json({ error: 'Failed to fetch tool events' });
      }
    });

    this.app.get('/api/tools/summary', async (req, res) => {
      try {
        if (!this.activityLogger) {
          return res.status(503).json({ error: 'Activity logger not available' });
        }

        const hours = parseInt(req.query.hours) || 24;
        const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
        
        // Get recent tool events
        const toolEvents = await this.activityLogger.getEvents({
          since: since,
          limit: 1000
        });
        
        // Filter and summarize tool events
        const toolSummary = toolEvents
          .filter(event => event.event_type.startsWith('tool_'))
          .reduce((acc, event) => {
            const eventData = JSON.parse(event.data);
            const toolName = eventData.tool || 'unknown';
            
            if (!acc[toolName]) {
              acc[toolName] = {
                total: 0,
                completed: 0,
                failed: 0,
                running: 0,
                avgDuration: 0,
                totalDuration: 0,
                durations: []
              };
            }
            
            if (event.event_type === 'tool_execution_start') {
              acc[toolName].total++;
              acc[toolName].running++;
            } else if (event.event_type === 'tool_execution_complete') {
              acc[toolName].running = Math.max(0, acc[toolName].running - 1);
              if (eventData.success) {
                acc[toolName].completed++;
              } else {
                acc[toolName].failed++;
              }
              
              if (eventData.duration_ms) {
                acc[toolName].durations.push(eventData.duration_ms);
                acc[toolName].totalDuration += eventData.duration_ms;
                acc[toolName].avgDuration = acc[toolName].totalDuration / acc[toolName].durations.length;
              }
            }
            
            return acc;
          }, {});

        res.json(toolSummary);
      } catch (error) {
        console.error('Error fetching tool summary:', error);
        res.status(500).json({ error: 'Failed to fetch tool summary' });
      }
    });

    // Agent orchestration API endpoints
    this.app.get('/api/sessions/:sessionId/agents', validateSessionId, async (req, res) => {
      try {
        if (!this.db) {
          return res.status(503).json({ error: 'Database not available' });
        }

        const { sessionId } = req.params;
        
        // Get agent generation data from conversations
        const generations = await this.db.all(`
          SELECT 
            generation,
            COUNT(*) as message_count,
            MAX(timestamp) as last_activity,
            SUM(context_size) as total_tokens
          FROM conversations 
          WHERE session_id = ? 
          GROUP BY generation
          ORDER BY generation ASC
        `, [sessionId]);

        // Get handoff data if available
        const handoffs = await this.db.all(`
          SELECT * FROM agent_generations 
          WHERE session_id = ? 
          ORDER BY generation ASC
        `, [sessionId]);

        // Combine generation and handoff data
        const agents = generations.map(gen => {
          const handoff = handoffs.find(h => h.generation === gen.generation);
          
          return {
            generation: gen.generation,
            messageCount: gen.message_count,
            lastActivity: gen.last_activity,
            totalTokens: gen.total_tokens || 0,
            handoffReason: handoff ? handoff.handoff_reason : null,
            compressedContext: handoff ? handoff.compressed_context : null,
            role: gen.generation === 0 ? 'orchestrator' : 'specialist',
            status: determineAgentStatus(gen.last_activity, gen.message_count)
          };
        });

        res.json(agents);
      } catch (error) {
        console.error('Error fetching agents:', error);
        res.status(500).json({ error: 'Failed to fetch agents' });
      }
    });

    function determineAgentStatus(lastActivity, messageCount) {
      if (!lastActivity) return 'spawned';
      
      const now = new Date();
      const last = new Date(lastActivity);
      const hoursSince = (now - last) / (1000 * 60 * 60);
      
      if (hoursSince < 0.1) return 'active'; // Active within 6 minutes
      if (hoursSince > 24) return 'archived';
      if (messageCount === 0) return 'spawned';
      return 'idle';
    }

    // System metrics API endpoint
    this.app.get('/api/system/metrics', async (req, res) => {
      try {
        const hours = parseInt(req.query.hours) || 24;
        const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
        
        // Get activity metrics
        let totalEvents = 0;
        let sessionCount = 0;
        let avgEventsPerSession = 0;
        
        if (this.activityLogger && this.db) {
          try {
            const eventCount = await this.activityLogger.getEvents({ since, limit: 10000 });
            totalEvents = eventCount.length;
            
            const sessions = await this.db.all(
              'SELECT DISTINCT session_id FROM conversations WHERE timestamp > ?',
              [since]
            );
            sessionCount = sessions.length;
            avgEventsPerSession = sessionCount > 0 ? totalEvents / sessionCount : 0;
          } catch (metricsError) {
            // Non-critical error, continue with default values
          }
        }

        res.json({
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
          nodeVersion: process.version,
          platform: process.platform,
          connectedClients: this.connectedClients.size,
          metrics: {
            totalEvents,
            sessionCount,
            avgEventsPerSession: Math.round(avgEventsPerSession * 100) / 100,
            timeRange: `${hours} hours`
          }
        });
      } catch (error) {
        console.error('Error fetching system metrics:', error);
        res.status(500).json({ error: 'Failed to fetch system metrics' });
      }
    });

    // Activity events API endpoint for advanced filtering
    this.app.get('/api/activity/events', async (req, res) => {
      try {
        if (!this.activityLogger) {
          return res.status(503).json({ error: 'Activity logger not available' });
        }

        const limit = parseInt(req.query.limit) || 100;
        const sessionId = req.query.sessionId;
        const eventType = req.query.eventType;
        const since = req.query.since;
        
        const filters = { limit };
        if (sessionId) filters.sessionId = sessionId;
        if (eventType) filters.eventType = eventType;
        if (since) filters.since = since;
        
        const events = await this.activityLogger.getEvents(filters);
        res.json(events.reverse()); // Return in chronological order
      } catch (error) {
        console.error('Error fetching activity events:', error);
        // Check if it's an activity logger error
        if (error.message && error.message.includes('Database not initialized')) {
          res.status(503).json({ error: 'Activity logger not available' });
        } else {
          res.status(500).json({ error: 'Failed to fetch activity events' });
        }
      }
    });

    // Session analytics endpoint
    this.app.get('/api/sessions/:sessionId/analytics', validateSessionId, async (req, res) => {
      try {
        if (!this.db || !this.activityLogger) {
          return res.status(503).json({ error: 'Database or activity logger not available' });
        }

        const { sessionId } = req.params;
        
        // Get conversation analytics
        const conversations = await this.db.all(
          'SELECT role, COUNT(*) as count, AVG(context_size) as avg_tokens, SUM(context_size) as total_tokens FROM conversations WHERE session_id = ? GROUP BY role',
          [sessionId]
        );

        // Get activity timeline
        const activities = await this.activityLogger.getEvents({ 
          sessionId: sessionId, 
          limit: 1000 
        });

        // Process activity data
        const eventsByType = {};
        const hourlyActivity = {};
        
        activities.forEach(event => {
          // Count by event type
          eventsByType[event.event_type] = (eventsByType[event.event_type] || 0) + 1;
          
          // Count by hour
          const hour = new Date(event.timestamp).toISOString().slice(0, 13);
          hourlyActivity[hour] = (hourlyActivity[hour] || 0) + 1;
        });

        // Calculate session duration
        const sortedActivities = activities.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        const sessionStart = sortedActivities[0]?.timestamp;
        const sessionEnd = sortedActivities[sortedActivities.length - 1]?.timestamp;
        const duration = sessionStart && sessionEnd ? 
          new Date(sessionEnd) - new Date(sessionStart) : 0;

        res.json({
          sessionId,
          duration: Math.round(duration / 1000), // seconds
          conversations: conversations.reduce((acc, conv) => {
            acc[conv.role] = {
              count: conv.count,
              avgTokens: Math.round(conv.avg_tokens || 0),
              totalTokens: conv.total_tokens || 0
            };
            return acc;
          }, {}),
          activitySummary: {
            totalEvents: activities.length,
            eventsByType,
            hourlyActivity
          },
          timeline: {
            start: sessionStart,
            end: sessionEnd
          }
        });
      } catch (error) {
        console.error('Error fetching session analytics:', error);
        res.status(500).json({ error: 'Failed to fetch session analytics' });
      }
    });

    // Default route serves the React app (use regex instead of wildcard for Express 5.x compatibility)
    this.app.get(/^(?!\/api).*/, (req, res) => {
      res.sendFile(path.join(webDir, 'index.html'));
    });
  }

  setupFileApiRoutes() {
    // File system API endpoints for the file browser
    this.app.get('/api/files/tree', async (req, res) => {
      try {
        const rootPath = req.query.path || process.cwd();
        const tree = await this.buildDirectoryTree(rootPath);
        res.json(tree);
      } catch (error) {
        console.error('Error building directory tree:', error);
        res.status(500).json({ error: 'Failed to build directory tree' });
      }
    });

    this.app.get('/api/files/content', async (req, res) => {
      try {
        const filePath = req.query.path;
        if (!filePath) {
          return res.status(400).json({ error: 'File path is required' });
        }

        // Security check - ensure path is within working directory
        const fullPath = path.resolve(filePath);
        const cwd = process.cwd();
        if (!fullPath.startsWith(cwd)) {
          return res.status(403).json({ error: 'Access denied - path outside working directory' });
        }

        const stats = await fs.stat(fullPath);
        if (stats.isDirectory()) {
          return res.status(400).json({ error: 'Path is a directory, not a file' });
        }

        // Check file size - limit to 1MB for web display
        if (stats.size > 1024 * 1024) {
          return res.status(413).json({ 
            error: 'File too large for display',
            size: stats.size,
            maxSize: 1024 * 1024
          });
        }

        // Detect if file is binary
        const buffer = await fs.readFile(fullPath);
        const isBinary = this.isBinaryFile(buffer);
        
        if (isBinary) {
          return res.json({
            path: filePath,
            size: stats.size,
            modified: stats.mtime.toISOString(),
            isBinary: true,
            content: '[Binary file - cannot display]'
          });
        }

        const content = buffer.toString('utf8');
        res.json({
          path: filePath,
          size: stats.size,
          modified: stats.mtime.toISOString(),
          isBinary: false,
          content: content
        });
      } catch (error) {
        console.error('Error reading file:', error);
        res.status(500).json({ error: 'Failed to read file' });
      }
    });

    this.app.get('/api/git/status', async (req, res) => {
      try {
        const { stdout: statusOutput } = await execAsync('git status --porcelain', { 
          cwd: process.cwd() 
        });
        
        const { stdout: branchOutput } = await execAsync('git branch --show-current', { 
          cwd: process.cwd() 
        });

        // Parse git status output
        const files = {};
        if (statusOutput.trim()) {
          statusOutput.trim().split('\n').forEach(line => {
            const status = line.substring(0, 2);
            const filePath = line.substring(3);
            
            let fileStatus = 'unknown';
            if (status === '??') fileStatus = 'untracked';
            else if (status.includes('M')) fileStatus = 'modified';
            else if (status.includes('A')) fileStatus = 'added';
            else if (status.includes('D')) fileStatus = 'deleted';
            else if (status.includes(' M')) fileStatus = 'modified';
            else if (status.includes('A ')) fileStatus = 'staged';
            
            files[filePath] = fileStatus;
          });
        }

        res.json({
          branch: branchOutput.trim() || 'main',
          files: files
        });
      } catch (error) {
        // Not a git repository or git not available
        res.json({
          branch: null,
          files: {},
          error: error.message
        });
      }
    });

    this.app.get('/api/git/diff', async (req, res) => {
      try {
        const filePath = req.query.file;
        if (!filePath) {
          return res.status(400).json({ error: 'File path is required' });
        }

        const { stdout: diffOutput } = await execAsync(`git diff HEAD -- "${filePath}"`, { 
          cwd: process.cwd() 
        });

        res.json({
          filePath: filePath,
          diff: diffOutput || 'No changes detected'
        });
      } catch (error) {
        console.error('Error getting git diff:', error);
        res.status(500).json({ error: 'Failed to get git diff' });
      }
    });

    this.app.post('/api/search', async (req, res) => {
      try {
        const { query, type = 'files' } = req.body;
        if (!query || !query.trim()) {
          return res.status(400).json({ error: 'Search query is required' });
        }

        const results = [];
        
        if (type === 'files') {
          // Search for files by name using find command
          try {
            const { stdout } = await execAsync(
              `find . -type f -name "*${query}*" | head -50`, 
              { cwd: process.cwd() }
            );
            
            if (stdout.trim()) {
              const files = stdout.trim().split('\n');
              for (const filePath of files) {
                const cleanPath = filePath.replace(/^\.\//, '');
                const stats = await fs.stat(filePath);
                
                results.push({
                  path: cleanPath,
                  name: path.basename(cleanPath),
                  type: 'file',
                  size: stats.size,
                  modified: stats.mtime.toISOString(),
                  context: `File name matches "${query}"`
                });
              }
            }
          } catch (findError) {
            // If find fails, fall back to simple directory listing
            console.warn('Find command failed, using fallback search');
          }
          
          // Also search file contents using grep if query is substantial
          if (query.length > 2) {
            try {
              const { stdout: grepOutput } = await execAsync(
                `grep -r -l --include="*.js" --include="*.json" --include="*.md" --include="*.txt" "${query}" . | head -20`,
                { cwd: process.cwd() }
              );
              
              if (grepOutput.trim()) {
                const contentFiles = grepOutput.trim().split('\n');
                for (const filePath of contentFiles) {
                  const cleanPath = filePath.replace(/^\.\//, '');
                  
                  // Skip if already added by filename search
                  if (results.some(r => r.path === cleanPath)) continue;
                  
                  try {
                    const stats = await fs.stat(filePath);
                    results.push({
                      path: cleanPath,
                      name: path.basename(cleanPath),
                      type: 'file',
                      size: stats.size,
                      modified: stats.mtime.toISOString(),
                      context: `Contains "${query}"`
                    });
                  } catch (statError) {
                    // Skip files that can't be stat'd
                  }
                }
              }
            } catch (grepError) {
              // Grep failed - that's okay, we have filename results
            }
          }
        }

        res.json({
          query: query,
          type: type,
          results: results.slice(0, 50) // Limit results
        });
      } catch (error) {
        console.error('Error performing search:', error);
        res.status(500).json({ error: 'Search failed' });
      }
    });
  }

  async buildDirectoryTree(rootPath, maxDepth = 3, currentDepth = 0) {
    if (currentDepth >= maxDepth) {
      return null;
    }

    try {
      const stats = await fs.stat(rootPath);
      const name = path.basename(rootPath) || rootPath;
      
      if (stats.isFile()) {
        return {
          name: name,
          path: rootPath,
          isDirectory: false,
          size: stats.size,
          modified: stats.mtime.toISOString()
        };
      }

      if (stats.isDirectory()) {
        const entries = await fs.readdir(rootPath);
        
        // Filter out hidden files and common build/dependency directories
        const filteredEntries = entries.filter(entry => 
          !entry.startsWith('.') && 
          !['node_modules', 'dist', 'build', '__pycache__'].includes(entry)
        );

        const children = [];
        for (const entry of filteredEntries.slice(0, 50)) { // Limit to 50 entries per directory
          try {
            const childPath = path.join(rootPath, entry);
            const child = await this.buildDirectoryTree(childPath, maxDepth, currentDepth + 1);
            if (child) {
              children.push(child);
            }
          } catch (childError) {
            // Skip entries that cause errors (permissions, etc.)
          }
        }

        // Sort children: directories first, then files
        children.sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name);
        });

        return {
          name: name,
          path: rootPath,
          isDirectory: true,
          children: children,
          modified: stats.mtime.toISOString()
        };
      }
    } catch (error) {
      console.error(`Error building tree for ${rootPath}:`, error);
      return null;
    }
  }

  isBinaryFile(buffer) {
    // Simple binary file detection - check for null bytes in first 1KB
    const sample = buffer.slice(0, 1024);
    for (let i = 0; i < sample.length; i++) {
      if (sample[i] === 0) {
        return true;
      }
    }
    return false;
  }

  setupWebSocket() {
    this.io.on('connection', (socket) => {
      this.connectedClients.add(socket.id);
      
      // Initialize client state
      socket.filters = {};
      socket.lastEventTime = Date.now();
      socket.eventCount = 0;
      
      if (this.verbose) {
        console.log(`WebSocket client connected: ${socket.id}`);
      }

      // Send recent activity when client connects (backfill last 50 events)
      this.sendRecentActivity(socket);

      socket.on('disconnect', () => {
        this.connectedClients.delete(socket.id);
        if (this.verbose) {
          console.log(`WebSocket client disconnected: ${socket.id}`);
        }
      });

      // Handle activity filtering requests
      socket.on('filter-activity', (filters) => {
        socket.filters = filters || {};
        if (this.verbose) {
          console.log(`Client ${socket.id} set filters:`, filters);
        }
      });

      // Handle subscription to specific sessions
      socket.on('subscribe-session', (sessionId) => {
        if (socket.currentSession) {
          socket.leave(socket.currentSession);
        }
        socket.currentSession = sessionId;
        socket.join(`session-${sessionId}`);
        
        if (this.verbose) {
          console.log(`Client ${socket.id} subscribed to session: ${sessionId}`);
        }
      });

      // Handle unsubscribe
      socket.on('unsubscribe-session', () => {
        if (socket.currentSession) {
          socket.leave(`session-${socket.currentSession}`);
          socket.currentSession = null;
        }
      });
    });
  }

  async sendRecentActivity(socket) {
    if (!this.activityLogger) return;

    try {
      // Get last 50 activity events from the database
      const recentEvents = await this.activityLogger.getRecentEvents(50);
      
      for (const event of recentEvents) {
        socket.emit('activity', event);
      }
    } catch (error) {
      console.error('Failed to send recent activity:', error);
    }
  }

  broadcastActivity(activityEvent) {
    if (!this.isStarted || this.connectedClients.size === 0) return;

    const now = Date.now();

    // Send to all connected clients with filtering and rate limiting
    this.io.sockets.sockets.forEach((socket) => {
      // Rate limiting: max 10 events per second per client
      if (now - socket.lastEventTime < 100) {
        socket.eventCount++;
        if (socket.eventCount > 10) {
          return; // Skip this event for rate-limited client
        }
      } else {
        socket.lastEventTime = now;
        socket.eventCount = 0;
      }

      // Apply filters
      if (this.shouldSendEventToSocket(activityEvent, socket)) {
        socket.emit('activity', activityEvent);
      }
    });

    // Also send to session-specific rooms
    if (activityEvent.local_session_id) {
      this.io.to(`session-${activityEvent.local_session_id}`).emit('activity', activityEvent);
    }
  }

  shouldSendEventToSocket(event, socket) {
    const filters = socket.filters || {};

    // Session ID filter
    if (filters.sessionId && filters.sessionId !== event.local_session_id) {
      return false;
    }

    // Event type filter
    if (filters.eventType && filters.eventType !== event.event_type) {
      return false;
    }

    // Agent type filter (extract from event data if present)
    if (filters.agentType) {
      try {
        const eventData = JSON.parse(event.data);
        if (eventData.agentType && eventData.agentType !== filters.agentType) {
          return false;
        }
      } catch (e) {
        // If we can't parse event data, allow the event through
      }
    }

    // Time range filter
    if (filters.since) {
      const eventTime = new Date(event.timestamp);
      const sinceTime = new Date(filters.since);
      if (eventTime < sinceTime) {
        return false;
      }
    }

    return true;
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, (err) => {
        if (err) {
          reject(err);
          return;
        }

        this.isStarted = true;
        
        if (this.verbose) {
          console.log(`🌐 Web companion available at http://localhost:${this.port}`);
        }

        // Connect to activity logger events for real-time streaming
        if (this.activityLogger) {
          this.activityLogger.on('activity', (event) => {
            this.broadcastActivity(event);
          });
        }

        resolve();
      });
    });
  }

  async stop() {
    if (!this.isStarted) return;

    return new Promise((resolve) => {
      this.server.close(() => {
        this.isStarted = false;
        this.connectedClients.clear();
        
        if (this.verbose) {
          console.log('🌐 Web server stopped');
        }
        
        resolve();
      });
    });
  }

  getStatus() {
    return {
      isStarted: this.isStarted,
      port: this.port,
      connectedClients: this.connectedClients.size,
      url: this.isStarted ? `http://localhost:${this.port}` : null
    };
  }
}