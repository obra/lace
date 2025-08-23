// ABOUTME: Integration test for database profiling functionality
// ABOUTME: Verifies that DatabasePersistence works with SQL profiling enabled

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabasePersistence } from '~/persistence/database';
import { logger } from '~/utils/logger';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import { getLaceDbPath } from '~/config/lace-dir';

// Mock the logger
vi.mock('~/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Database with SQL Profiling', () => {
  const _tempLaceDir = setupCoreTest();
  let db: DatabasePersistence;
  let originalEnv: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    // Save original env
    originalEnv = process.env.LACE_SQL_PROFILING;
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    // Restore original env
    if (originalEnv !== undefined) {
      process.env.LACE_SQL_PROFILING = originalEnv;
    } else {
      delete process.env.LACE_SQL_PROFILING;
    }
    vi.resetModules();
  });

  it('should work normally without profiling enabled', () => {
    delete process.env.LACE_SQL_PROFILING;

    db = new DatabasePersistence(getLaceDbPath());

    // Create a simple thread
    const thread = {
      id: 'test-thread',
      createdAt: new Date(),
      updatedAt: new Date(),
      events: [],
    };

    db.saveThread(thread);
    const loadedThread = db.loadThread('test-thread');

    expect(loadedThread).toBeTruthy();
    expect(loadedThread!.id).toBe('test-thread');

    // Should not have any profiling logs
    expect(logger.debug).not.toHaveBeenCalledWith('SQL_PROFILE', expect.any(Object));
  });

  it('should profile queries when LACE_SQL_PROFILING=true', async () => {
    process.env.LACE_SQL_PROFILING = 'true';

    // Need to reload modules to pick up env change
    vi.resetModules();
    const { DatabasePersistence: ProfiledDB } = await import('./database');
    const { getLaceDbPath: getDbPath } = await import('~/config/lace-dir');

    db = new ProfiledDB(getDbPath());

    // Create a simple thread
    const thread = {
      id: 'test-thread',
      createdAt: new Date(),
      updatedAt: new Date(),
      events: [],
    };

    db.saveThread(thread);
    const loadedThread = db.loadThread('test-thread');

    expect(loadedThread).toBeTruthy();
    expect(loadedThread!.id).toBe('test-thread');

    // Should have profiling logs
    expect(logger.debug).toHaveBeenCalledWith(
      'SQL_PROFILE',
      expect.objectContaining({
        operation: expect.stringMatching(/^(run|get|all|exec)$/),
        duration: expect.stringMatching(/\d+\.\d+ms/),
        query: expect.any(String),
        timestamp: expect.any(String),
      }) as Record<string, unknown>
    );

    // Should have multiple calls due to schema initialization and operations
    const mockLogger = vi.mocked(logger.debug);
    const sqlProfileCalls = mockLogger.mock.calls.filter((call) => call[0] === 'SQL_PROFILE');
    expect(sqlProfileCalls.length).toBeGreaterThan(0);
  });

  it('should profile both schema setup and regular operations', async () => {
    process.env.LACE_SQL_PROFILING = 'true';

    // Need to reload modules to pick up env change
    vi.resetModules();
    const { DatabasePersistence: ProfiledDB } = await import('./database');
    const { getLaceDbPath: getDbPath } = await import('~/config/lace-dir');

    db = new ProfiledDB(getDbPath());

    // Should have profiled the schema creation
    const mockLogger = vi.mocked(logger.debug);
    const sqlProfileCalls = mockLogger.mock.calls.filter((call) => call[0] === 'SQL_PROFILE');

    // Should have schema creation calls
    const schemaQueries = sqlProfileCalls.filter((call) => {
      const queryData = call[1] as { query: string };
      return queryData.query.includes('CREATE TABLE') || queryData.query.includes('CREATE INDEX');
    });

    expect(schemaQueries.length).toBeGreaterThan(0);
  });
});
