// ABOUTME: Mock ActivityLogger for tests to avoid database initialization issues
// ABOUTME: Provides silent no-op implementation of all ActivityLogger methods

export class ActivityLogger {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = true; // Mock that db exists to prevent console errors
  }

  async initialize() {
    // No-op for tests
  }

  async logEvent(eventType, localSessionId, modelSessionId, data) {
    // No-op for tests - silently succeed
  }

  async getRecentEvents(limit) {
    return []; // Return empty array for tests
  }

  async getEvents(filter) {
    return []; // Return empty array for tests
  }

  close() {
    // No-op for tests
  }
}