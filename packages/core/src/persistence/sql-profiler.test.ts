// ABOUTME: Tests for SQLite profiling functionality
// ABOUTME: Verifies profiler captures timing data and logs correctly

/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SQLProfiler } from '~/persistence/sql-profiler';
import { logger } from '~/utils/logger';

// Mock the logger
vi.mock('~/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

describe('SQLProfiler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment for each test
    delete process.env.LACE_SQL_PROFILING;
  });

  it('should be disabled by default', () => {
    expect(SQLProfiler.isEnabled()).toBe(false);
  });

  it('should be enabled when LACE_SQL_PROFILING=true', async () => {
    process.env.LACE_SQL_PROFILING = 'true';
    // Need to reload the module to pick up env change
    vi.resetModules();
    const { SQLProfiler: ReloadedProfiler } = await import('./sql-profiler');
    expect(ReloadedProfiler.isEnabled()).toBe(true);
  });

  it('should not profile when disabled', () => {
    const mockExecute = vi.fn().mockReturnValue('result');

    const result = SQLProfiler.profile('get', 'SELECT * FROM table', [], mockExecute);

    expect(result).toBe('result');
    expect(mockExecute).toHaveBeenCalled();
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('should profile when enabled', () => {
    // Temporarily enable profiling
    SQLProfiler.setEnabled(true);

    const mockExecute = vi.fn().mockReturnValue({ changes: 1 });

    const result = SQLProfiler.profile(
      'run',
      'INSERT INTO table VALUES (?)',
      ['value'],
      mockExecute
    );

    expect(result).toEqual({ changes: 1 });
    expect(mockExecute).toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      'SQL_PROFILE',
      expect.objectContaining({
        operation: 'run',
        duration: expect.stringMatching(/\d+\.\d+ms/),
        query: 'INSERT INTO table VALUES (?)',
        params: ['value'],
        rowsAffected: 1,
        timestamp: expect.any(String),
      }) as Record<string, unknown>
    );

    // Reset
    SQLProfiler.setEnabled(false);
  });

  it('should log slow queries at info level', () => {
    // Temporarily enable profiling
    SQLProfiler.setEnabled(true);

    // Mock process.hrtime.bigint to simulate slow query
    const originalHrtime = process.hrtime.bigint;
    const startTime = BigInt(1000000000); // 1 second in nanoseconds
    let callCount = 0;

    process.hrtime.bigint = vi.fn(() => {
      callCount++;
      if (callCount === 1) return startTime;
      // Return time that represents 150ms later (150 * 1_000_000 nanoseconds)
      return startTime + BigInt(150 * 1_000_000);
    });

    const mockExecute = vi.fn().mockReturnValue('result');

    SQLProfiler.profile('get', 'SELECT * FROM slow_table', [], mockExecute);

    expect(logger.info).toHaveBeenCalledWith(
      'SLOW_SQL_QUERY',
      expect.objectContaining({
        operation: 'get',
        duration: expect.stringMatching(/\d+\.\d+ms/),
        query: 'SELECT * FROM slow_table',
      }) as Record<string, unknown>
    );

    // Restore original hrtime and reset profiler
    process.hrtime.bigint = originalHrtime;
    SQLProfiler.setEnabled(false);
  });

  it('should normalize query whitespace', () => {
    // Temporarily enable profiling
    SQLProfiler.setEnabled(true);

    const mockExecute = vi.fn().mockReturnValue('result');
    const multilineQuery = `SELECT *
                           FROM   table
                           WHERE  id = ?`;

    SQLProfiler.profile('get', multilineQuery, [1], mockExecute);

    expect(logger.debug).toHaveBeenCalledWith(
      'SQL_PROFILE',
      expect.objectContaining({
        query: 'SELECT * FROM table WHERE id = ?',
      }) as Record<string, unknown>
    );

    // Reset
    SQLProfiler.setEnabled(false);
  });

  it('should track rows returned for get operations', () => {
    // Temporarily enable profiling
    SQLProfiler.setEnabled(true);

    const mockExecute = vi.fn().mockReturnValue({ id: 1, name: 'test' });

    SQLProfiler.profile('get', 'SELECT * FROM table WHERE id = ?', [1], mockExecute);

    expect(logger.debug).toHaveBeenCalledWith(
      'SQL_PROFILE',
      expect.objectContaining({
        rowsReturned: 1,
      }) as Record<string, unknown>
    );

    // Reset
    SQLProfiler.setEnabled(false);
  });

  it('should track rows returned for all operations', () => {
    // Temporarily enable profiling
    SQLProfiler.setEnabled(true);

    const mockExecute = vi.fn().mockReturnValue([{ id: 1 }, { id: 2 }, { id: 3 }]);

    SQLProfiler.profile('all', 'SELECT * FROM table', [], mockExecute);

    expect(logger.debug).toHaveBeenCalledWith(
      'SQL_PROFILE',
      expect.objectContaining({
        rowsReturned: 3,
      }) as Record<string, unknown>
    );

    // Reset
    SQLProfiler.setEnabled(false);
  });

  it('should track zero rows for empty get result', () => {
    // Temporarily enable profiling
    SQLProfiler.setEnabled(true);

    const mockExecute = vi.fn().mockReturnValue(null);

    SQLProfiler.profile('get', 'SELECT * FROM table WHERE id = ?', [999], mockExecute);

    expect(logger.debug).toHaveBeenCalledWith(
      'SQL_PROFILE',
      expect.objectContaining({
        rowsReturned: 0,
      }) as Record<string, unknown>
    );

    // Reset
    SQLProfiler.setEnabled(false);
  });
});
