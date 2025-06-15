// ABOUTME: Tests for the file logger functionality
// ABOUTME: Verifies log levels, file writing, and configuration behavior

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, unlinkSync, rmSync } from 'fs';
import { logger } from '../logger.js';
import { join } from 'path';

describe('Logger', () => {
  const testLogFile = join(process.cwd(), 'test-logs', 'test.log');
  const testLogDir = join(process.cwd(), 'test-logs');

  beforeEach(() => {
    // Clean up any existing test files
    if (existsSync(testLogFile)) {
      unlinkSync(testLogFile);
    }
    if (existsSync(testLogDir)) {
      rmSync(testLogDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test files
    if (existsSync(testLogFile)) {
      unlinkSync(testLogFile);
    }
    if (existsSync(testLogDir)) {
      rmSync(testLogDir, { recursive: true });
    }
  });

  describe('configure', () => {
    it('should create log directory if it does not exist', () => {
      expect(existsSync(testLogDir)).toBe(false);
      
      logger.configure('info', testLogFile);
      logger.info('test message');
      
      expect(existsSync(testLogDir)).toBe(true);
      expect(existsSync(testLogFile)).toBe(true);
    });

    it('should not write to file when no logFile is configured', () => {
      logger.configure('info');
      logger.info('test message');
      
      expect(existsSync(testLogFile)).toBe(false);
    });
  });

  describe('log levels', () => {
    beforeEach(() => {
      logger.configure('debug', testLogFile);
    });

    it('should write all levels when level is debug', () => {
      logger.error('error message');
      logger.warn('warn message');
      logger.info('info message');
      logger.debug('debug message');
      
      const logContent = readFileSync(testLogFile, 'utf-8');
      expect(logContent).toContain('[ERROR] error message');
      expect(logContent).toContain('[WARN] warn message');
      expect(logContent).toContain('[INFO] info message');
      expect(logContent).toContain('[DEBUG] debug message');
    });

    it('should only write error when level is error', () => {
      logger.configure('error', testLogFile);
      
      logger.error('error message');
      logger.warn('warn message');
      logger.info('info message');
      logger.debug('debug message');
      
      const logContent = readFileSync(testLogFile, 'utf-8');
      expect(logContent).toContain('[ERROR] error message');
      expect(logContent).not.toContain('[WARN] warn message');
      expect(logContent).not.toContain('[INFO] info message');
      expect(logContent).not.toContain('[DEBUG] debug message');
    });

    it('should write error and warn when level is warn', () => {
      logger.configure('warn', testLogFile);
      
      logger.error('error message');
      logger.warn('warn message');
      logger.info('info message');
      logger.debug('debug message');
      
      const logContent = readFileSync(testLogFile, 'utf-8');
      expect(logContent).toContain('[ERROR] error message');
      expect(logContent).toContain('[WARN] warn message');
      expect(logContent).not.toContain('[INFO] info message');
      expect(logContent).not.toContain('[DEBUG] debug message');
    });

    it('should write error, warn, and info when level is info', () => {
      logger.configure('info', testLogFile);
      
      logger.error('error message');
      logger.warn('warn message');
      logger.info('info message');
      logger.debug('debug message');
      
      const logContent = readFileSync(testLogFile, 'utf-8');
      expect(logContent).toContain('[ERROR] error message');
      expect(logContent).toContain('[WARN] warn message');
      expect(logContent).toContain('[INFO] info message');
      expect(logContent).not.toContain('[DEBUG] debug message');
    });
  });

  describe('log format', () => {
    beforeEach(() => {
      logger.configure('info', testLogFile);
    });

    it('should include timestamp in ISO format', () => {
      logger.info('test message');
      
      const logContent = readFileSync(testLogFile, 'utf-8');
      const isoTimestampRegex = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/;
      expect(logContent).toMatch(isoTimestampRegex);
    });

    it('should format log entry correctly', () => {
      logger.info('test message');
      
      const logContent = readFileSync(testLogFile, 'utf-8');
      expect(logContent).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[INFO\] test message\n/);
    });

    it('should include JSON data when provided', () => {
      const testData = { key: 'value', number: 42 };
      logger.info('test message', testData);
      
      const logContent = readFileSync(testLogFile, 'utf-8');
      expect(logContent).toContain('test message {"key":"value","number":42}');
    });

    it('should handle complex nested data', () => {
      logger.configure('debug', testLogFile);
      
      const complexData = {
        user: { id: 1, name: 'test' },
        items: [1, 2, 3],
        meta: { timestamp: '2024-01-01' }
      };
      logger.debug('complex data', complexData);
      
      const logContent = readFileSync(testLogFile, 'utf-8');
      expect(logContent).toContain('"user":{"id":1,"name":"test"}');
      expect(logContent).toContain('"items":[1,2,3]');
    });
  });

  describe('error handling', () => {
    it('should not throw when writing to invalid path', () => {
      // Configure with invalid path (readonly filesystem)
      logger.configure('info', '/invalid/readonly/path/test.log');
      
      // Should not throw during configure or logging
      expect(() => {
        logger.info('test message');
      }).not.toThrow();
    });

    it('should disable logging when directory creation fails', () => {
      // Configure with invalid path  
      logger.configure('info', '/invalid/readonly/path/test.log');
      
      // Log file should be cleared when directory creation fails
      logger.info('test message');
      
      // No file should be created
      expect(existsSync('/invalid/readonly/path/test.log')).toBe(false);
    });
  });

  describe('multiple log calls', () => {
    beforeEach(() => {
      logger.configure('info', testLogFile);
    });

    it('should append multiple log entries', () => {
      logger.info('first message');
      logger.warn('second message');
      logger.error('third message');
      
      const logContent = readFileSync(testLogFile, 'utf-8');
      const lines = logContent.trim().split('\n');
      expect(lines).toHaveLength(3);
      expect(lines[0]).toContain('[INFO] first message');
      expect(lines[1]).toContain('[WARN] second message');
      expect(lines[2]).toContain('[ERROR] third message');
    });
  });
});