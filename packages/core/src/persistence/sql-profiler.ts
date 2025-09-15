// ABOUTME: Zero-overhead SQL query profiler for SQLite operations
// ABOUTME: Logs query performance data only when LACE_SQL_PROFILING=true

import { logger } from '~/utils/logger';

interface QueryProfile {
  query: string;
  params?: unknown[];
  duration: number;
  timestamp: Date;
  operation: 'run' | 'get' | 'all' | 'exec';
  rowsAffected?: number;
  rowsReturned?: number;
}

class SQLProfiler {
  private static _enabled: boolean = process.env.LACE_SQL_PROFILING === 'true';

  static isEnabled(): boolean {
    return this._enabled;
  }

  // Test helper method to enable/disable profiling
  static setEnabled(enabled: boolean): void {
    this._enabled = enabled;
  }

  static profile<T>(
    operation: 'run' | 'get' | 'all' | 'exec',
    query: string,
    params: unknown[] = [],
    execute: () => T
  ): T {
    if (!this._enabled) {
      return execute();
    }

    const startTime = process.hrtime.bigint();
    const result = execute();
    const endTime = process.hrtime.bigint();

    const duration = Number(endTime - startTime) / 1_000_000; // Convert to milliseconds

    let rowsAffected: number | undefined;
    let rowsReturned: number | undefined;

    // Extract metrics based on operation and result type
    if (operation === 'run' && result && typeof result === 'object') {
      const runResult = result as { changes?: number };
      rowsAffected = runResult.changes;
    } else if (operation === 'all' && Array.isArray(result)) {
      rowsReturned = result.length;
    } else if (operation === 'get' && result) {
      rowsReturned = 1;
    } else if (operation === 'get' && !result) {
      rowsReturned = 0;
    }

    const profile: QueryProfile = {
      query: query.trim().replace(/\s+/g, ' '), // Normalize whitespace
      params: params.length > 0 ? params : undefined,
      duration,
      timestamp: new Date(),
      operation,
      rowsAffected,
      rowsReturned,
    };

    // Log with structured data for easy parsing
    logger.debug('SQL_PROFILE', {
      operation: profile.operation,
      duration: `${profile.duration.toFixed(2)}ms`,
      query: profile.query,
      params: profile.params,
      rowsAffected: profile.rowsAffected,
      rowsReturned: profile.rowsReturned,
      timestamp: profile.timestamp.toISOString(),
    });

    // Also log slow queries at info level (>100ms)
    if (profile.duration > 100) {
      logger.info('SLOW_SQL_QUERY', {
        operation: profile.operation,
        duration: `${profile.duration.toFixed(2)}ms`,
        query: profile.query,
        params: profile.params,
      });
    }

    return result;
  }

  // Convenience methods for each operation type
  static profileRun<T>(query: string, params: unknown[], execute: () => T): T {
    return this.profile('run', query, params, execute);
  }

  static profileGet<T>(query: string, params: unknown[], execute: () => T): T {
    return this.profile('get', query, params, execute);
  }

  static profileAll<T>(query: string, params: unknown[], execute: () => T): T {
    return this.profile('all', query, params, execute);
  }

  static profileExec<T>(query: string, execute: () => T): T {
    return this.profile('exec', query, [], execute);
  }
}

export { SQLProfiler };
