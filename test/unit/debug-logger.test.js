// ABOUTME: Unit tests for debug logger functionality
// ABOUTME: Tests log levels, dual output, and thread-safe file writing

import { test, describe, beforeEach, afterEach } from '../test-harness.js';
import { TestHarness, assert, utils } from '../test-harness.js';
import { DebugLogger } from '../../src/logging/debug-logger.js';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('DebugLogger', () => {
  let harness;
  let testLogFile;

  beforeEach(async () => {
    harness = new TestHarness();
    testLogFile = join(tmpdir(), `debug-test-${Date.now()}.log`);
  });

  afterEach(async () => {
    await harness.cleanup();
    try {
      await fs.unlink(testLogFile);
    } catch (error) {
      // File might not exist, ignore
    }
  });

  describe('Log Level Parsing', () => {
    test('should parse valid log levels', () => {
      const logger = new DebugLogger();
      assert.equal(logger.parseLevel('debug'), 'debug');
      assert.equal(logger.parseLevel('info'), 'info');
      assert.equal(logger.parseLevel('warn'), 'warn');
      assert.equal(logger.parseLevel('error'), 'error');
      assert.equal(logger.parseLevel('off'), 'off');
    });

    test('should handle case insensitive levels', () => {
      const logger = new DebugLogger();
      assert.equal(logger.parseLevel('DEBUG'), 'debug');
      assert.equal(logger.parseLevel('Info'), 'info');
      assert.equal(logger.parseLevel('WARN'), 'warn');
    });

    test('should default to off for invalid levels', () => {
      const logger = new DebugLogger();
      assert.equal(logger.parseLevel('invalid'), 'off');
      assert.equal(logger.parseLevel(''), 'off');
      assert.equal(logger.parseLevel(null), 'off');
    });
  });

  describe('Log Level Filtering', () => {
    test('should respect stderr log level', () => {
      const logger = new DebugLogger({ logLevel: 'warn' });
      
      assert.equal(logger.shouldLog('debug', 'stderr'), false);
      assert.equal(logger.shouldLog('info', 'stderr'), false);
      assert.equal(logger.shouldLog('warn', 'stderr'), true);
      assert.equal(logger.shouldLog('error', 'stderr'), true);
    });

    test('should respect file log level', () => {
      const logger = new DebugLogger({ 
        logFile: testLogFile,
        logFileLevel: 'info' 
      });
      
      assert.equal(logger.shouldLog('debug', 'file'), false);
      assert.equal(logger.shouldLog('info', 'file'), true);
      assert.equal(logger.shouldLog('warn', 'file'), true);
      assert.equal(logger.shouldLog('error', 'file'), true);
    });

    test('should not log to file if no file path provided', () => {
      const logger = new DebugLogger({ logFileLevel: 'debug' });
      assert.strictEqual(logger.shouldLog('debug', 'file'), false);
    });
  });

  describe('Message Formatting', () => {
    test('should format messages with timestamp and level', () => {
      const logger = new DebugLogger();
      const timestamp = new Date('2025-01-01T12:00:00.000Z');
      const formatted = logger.formatMessage('info', 'Test message', timestamp);
      
      assert.equal(formatted, '2025-01-01T12:00:00.000Z [INFO ] Test message');
    });

    test('should pad level strings to 5 characters', () => {
      const logger = new DebugLogger();
      const timestamp = new Date('2025-01-01T12:00:00.000Z');
      
      assert.ok(logger.formatMessage('debug', 'msg', timestamp).includes('[DEBUG]'));
      assert.ok(logger.formatMessage('info', 'msg', timestamp).includes('[INFO ]'));
      assert.ok(logger.formatMessage('warn', 'msg', timestamp).includes('[WARN ]'));
      assert.ok(logger.formatMessage('error', 'msg', timestamp).includes('[ERROR]'));
    });
  });

  describe('File Writing', () => {
    test('should write to file when configured', async () => {
      const logger = new DebugLogger({
        logLevel: 'off',
        logFile: testLogFile,
        logFileLevel: 'info'
      });

      logger.info('Test message');
      
      // Wait for async write
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const content = await fs.readFile(testLogFile, 'utf8');
      assert.ok(content.includes('Test message'));
      assert.ok(content.includes('[INFO ]'));
    });

    test('should create directory if it does not exist', async () => {
      const nestedPath = join(tmpdir(), 'nested', 'path', 'test.log');
      const logger = new DebugLogger({
        logFile: nestedPath,
        logFileLevel: 'info'
      });

      logger.info('Test message');
      
      // Wait for async write
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const content = await fs.readFile(nestedPath, 'utf8');
      assert.ok(content.includes('Test message'));
      
      // Clean up
      await fs.unlink(nestedPath);
      await fs.rmdir(join(tmpdir(), 'nested', 'path'));
      await fs.rmdir(join(tmpdir(), 'nested'));
    });
  });

  describe('Log Methods', () => {
    test('should have debug, info, warn, error methods', () => {
      const logger = new DebugLogger();
      
      assert.equal(typeof logger.debug, 'function');
      assert.equal(typeof logger.info, 'function');
      assert.equal(typeof logger.warn, 'function');
      assert.equal(typeof logger.error, 'function');
    });

    test('should call log method with correct level', async () => {
      const logger = new DebugLogger({
        logFile: testLogFile,
        logFileLevel: 'debug'
      });

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');
      
      // Wait for async writes
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const content = await fs.readFile(testLogFile, 'utf8');
      assert.ok(content.includes('[DEBUG]'));
      assert.ok(content.includes('[INFO ]'));
      assert.ok(content.includes('[WARN ]'));
      assert.ok(content.includes('[ERROR]'));
    });
  });
});