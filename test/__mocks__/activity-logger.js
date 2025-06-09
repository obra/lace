// ABOUTME: Mock ActivityLogger for UI tests to avoid SQLite dependencies
// ABOUTME: Provides simplified interface matching real ActivityLogger for testing

import { jest } from '@jest/globals';
import { EventEmitter } from 'events';

export class ActivityLogger extends EventEmitter {
  constructor(dbPath = '.lace/activity.db') {
    super();
    this.dbPath = dbPath;
    this.db = null;
    this.events = [];
  }

  async initialize() {
    this.db = { 
      initialized: true,
      run: jest.fn(),
      get: jest.fn(),
      all: jest.fn()
    };
  }

  async logEvent(eventType, localSessionId, modelSessionId, data) {
    const event = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      event_type: eventType,
      local_session_id: localSessionId,
      model_session_id: modelSessionId,
      data: typeof data === 'string' ? data : JSON.stringify(data)
    };
    
    this.events.push(event);
    this.emit('activity', event);
  }

  async getEvents(options = {}) {
    let filtered = [...this.events];
    
    if (options.sessionId) {
      filtered = filtered.filter(e => e.local_session_id === options.sessionId);
    }
    
    if (options.eventType) {
      filtered = filtered.filter(e => e.event_type === options.eventType);
    }
    
    if (options.since) {
      filtered = filtered.filter(e => e.timestamp >= options.since);
    }
    
    if (options.limit) {
      filtered = filtered.slice(0, options.limit);
    }
    
    return filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  async getRecentEvents(limit = 50) {
    return this.getEvents({ limit });
  }

  async close() {
    this.db = null;
    this.events = [];
  }
}

export default ActivityLogger;