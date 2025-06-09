// ABOUTME: WebServer implementation for Ink UI with Socket.IO activity streaming
// ABOUTME: Provides REST API and real-time web companion interface for activity monitoring

import express from 'express';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';

export interface WebServerOptions {
  port?: number;
  activityLogger?: any;
  db?: any;
  verbose?: boolean;
}

export interface ActivityEvent {
  timestamp: string;
  event_type: string;
  local_session_id: string;
  model_session_id?: string;
  data: string;
}

export class WebServer {
  private port: number;
  private activityLogger: any;
  private db: any;
  private verbose: boolean;
  private app: express.Application;
  private server: any;
  private io: SocketIO;
  private connectedClients: Set<string>;
  private isStarted: boolean = false;

  constructor(options: WebServerOptions = {}) {
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
    
    this.connectedClients = new Set();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'", `ws://localhost:${this.port}`, `http://localhost:${this.port}`]
        }
      }
    }));

    // CORS for local development
    this.app.use(cors({
      origin: process.env.NODE_ENV === 'production' ? false : "*",
      credentials: true
    }));

    this.app.use(express.json());
    // Static files served in production only
    if (process.env.NODE_ENV === 'production') {
      this.app.use(express.static('./web/dist'));
    }
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/api/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        connectedClients: this.connectedClients.size,
        uptime: process.uptime()
      });
    });

    // Activity endpoints
    this.app.get('/api/activity/recent', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit as string) || 50;
        const events = await this.getRecentActivity(limit);
        res.json({ events });
      } catch (error) {
        res.status(500).json({ error: 'Failed to get recent activity' });
      }
    });

    this.app.get('/api/activity/session/:sessionId', async (req, res) => {
      try {
        const { sessionId } = req.params;
        const limit = parseInt(req.query.limit as string) || 50;
        const events = await this.getSessionActivity(sessionId, limit);
        res.json({ events });
      } catch (error) {
        res.status(500).json({ error: 'Failed to get session activity' });
      }
    });

    this.app.get('/api/activity/type/:eventType', async (req, res) => {
      try {
        const { eventType } = req.params;
        const limit = parseInt(req.query.limit as string) || 50;
        const events = await this.getActivityByType(eventType, limit);
        res.json({ events });
      } catch (error) {
        res.status(500).json({ error: 'Failed to get activity by type' });
      }
    });

    // Sessions endpoints
    this.app.get('/api/sessions', async (req, res) => {
      try {
        const sessions = await this.getAllSessions();
        res.json({ sessions });
      } catch (error) {
        res.status(500).json({ error: 'Failed to get sessions' });
      }
    });

    this.app.get('/api/sessions/:sessionId/messages', async (req, res) => {
      try {
        const { sessionId } = req.params;
        const messages = await this.getSessionMessages(sessionId);
        res.json({ messages });
      } catch (error) {
        res.status(500).json({ error: 'Failed to get session messages' });
      }
    });

    // System metrics
    this.app.get('/api/system/metrics', (req, res) => {
      res.json({
        memory: process.memoryUsage(),
        uptime: process.uptime(),
        connectedClients: this.connectedClients.size,
        timestamp: new Date().toISOString()
      });
    });

    // Serve web app for root and unknown routes
    this.app.get('/', (req, res) => {
      if (process.env.NODE_ENV === 'production') {
        res.sendFile(path.resolve('./web/dist/index.html'));
      } else {
        res.json({ message: 'Web companion development mode - use vite dev server' });
      }
    });
  }

  private setupWebSocket(): void {
    this.io.on('connection', (socket) => {
      this.connectedClients.add(socket.id);
      
      if (this.verbose) {
        console.log(`Web client connected: ${socket.id} (${this.connectedClients.size} total)`);
      }

      // Initialize socket properties
      (socket as any).filters = {};

      // Send recent activity when client connects (backfill)
      this.sendRecentActivity(socket);

      // Handle activity filtering requests
      socket.on('filter-activity', (filters) => {
        (socket as any).filters = filters || {};
      });

      // Handle subscription to specific sessions
      socket.on('subscribe-session', (sessionId) => {
        socket.join(`session-${sessionId}`);
      });

      socket.on('unsubscribe-session', (sessionId) => {
        socket.leave(`session-${sessionId}`);
      });

      socket.on('disconnect', () => {
        this.connectedClients.delete(socket.id);
        if (this.verbose) {
          console.log(`Web client disconnected: ${socket.id} (${this.connectedClients.size} total)`);
        }
      });
    });
  }

  private async sendRecentActivity(socket: any): Promise<void> {
    try {
      const recentEvents = await this.getRecentActivity(50);
      socket.emit('activity-backfill', recentEvents);
    } catch (error) {
      console.error('Failed to send recent activity to client:', error);
    }
  }

  private shouldSendEventToSocket(event: ActivityEvent, socket: any): boolean {
    const filters = socket.filters || {};
    
    // Filter by session if specified
    if (filters.sessionId && event.local_session_id !== filters.sessionId) {
      return false;
    }
    
    // Filter by event type if specified
    if (filters.eventType && event.event_type !== filters.eventType) {
      return false;
    }
    
    // Filter by time range if specified
    if (filters.startTime) {
      const eventTime = new Date(event.timestamp);
      const startTime = new Date(filters.startTime);
      if (eventTime < startTime) {
        return false;
      }
    }
    
    return true;
  }

  public broadcastActivity(event: ActivityEvent): void {
    this.io.sockets.sockets.forEach((socket) => {
      if (this.shouldSendEventToSocket(event, socket)) {
        socket.emit('activity', event);
      }
    });
  }

  private async getRecentActivity(limit: number): Promise<ActivityEvent[]> {
    if (!this.activityLogger) return [];
    
    try {
      return await this.activityLogger.getRecentActivity(limit);
    } catch (error) {
      console.error('Failed to get recent activity:', error);
      return [];
    }
  }

  private async getSessionActivity(sessionId: string, limit: number): Promise<ActivityEvent[]> {
    if (!this.activityLogger) return [];
    
    try {
      return await this.activityLogger.getSessionActivity(sessionId, limit);
    } catch (error) {
      console.error('Failed to get session activity:', error);
      return [];
    }
  }

  private async getActivityByType(eventType: string, limit: number): Promise<ActivityEvent[]> {
    if (!this.activityLogger) return [];
    
    try {
      return await this.activityLogger.getActivityByType(eventType, limit);
    } catch (error) {
      console.error('Failed to get activity by type:', error);
      return [];
    }
  }

  private async getAllSessions(): Promise<any[]> {
    if (!this.db) return [];
    
    try {
      return await this.db.getSessions();
    } catch (error) {
      console.error('Failed to get sessions:', error);
      return [];
    }
  }

  private async getSessionMessages(sessionId: string): Promise<any[]> {
    if (!this.db) return [];
    
    try {
      return await this.db.getMessages(sessionId);
    } catch (error) {
      console.error('Failed to get session messages:', error);
      return [];
    }
  }

  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, (error?: Error) => {
        if (error) {
          reject(error);
        } else {
          this.isStarted = true;
          if (this.verbose) {
            console.log(`🌐 Web companion server started at http://localhost:${this.port}`);
          }
          resolve();
        }
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.isStarted = false;
          if (this.verbose) {
            console.log('🌐 Web companion server stopped');
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  public getStatus() {
    return {
      isStarted: this.isStarted,
      port: this.port,
      url: `http://localhost:${this.port}`,
      connectedClients: this.connectedClients.size
    };
  }
}