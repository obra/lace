// ABOUTME: Tests for HAR recorder utility
// ABOUTME: Validates HAR format compliance and file operations

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, unlinkSync, rmSync } from 'fs';
import {
  HARRecorder,
  initializeHARRecording,
  getHARRecorder,
  disableHARRecording,
  HARFile,
} from '~/utils/har-recorder.js';

const TEST_HAR_FILE = '/tmp/test-har-recording.har';
const TEST_HAR_DIR = '/tmp/har-test-dir';

describe('HARRecorder', () => {
  beforeEach(() => {
    // Clean up any existing test files
    if (existsSync(TEST_HAR_FILE)) {
      unlinkSync(TEST_HAR_FILE);
    }
    if (existsSync(TEST_HAR_DIR)) {
      rmSync(TEST_HAR_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test files
    if (existsSync(TEST_HAR_FILE)) {
      unlinkSync(TEST_HAR_FILE);
    }
    if (existsSync(TEST_HAR_DIR)) {
      rmSync(TEST_HAR_DIR, { recursive: true });
    }
    disableHARRecording();
  });

  describe('initialization', () => {
    it('should create HAR file with proper structure', () => {
      const recorder = new HARRecorder(TEST_HAR_FILE);

      // Trigger initialization by recording an entry
      recorder.recordEntry({
        startedDateTime: new Date().toISOString(),
        time: 100,
        request: {
          method: 'GET',
          url: 'https://test.com',
          httpVersion: 'HTTP/1.1',
          cookies: [],
          headers: [],
          queryString: [],
          headersSize: -1,
          bodySize: 0,
        },
        response: {
          status: 200,
          statusText: 'OK',
          httpVersion: 'HTTP/1.1',
          cookies: [],
          headers: [],
          content: { size: 0, mimeType: 'text/plain' },
          redirectURL: '',
          headersSize: -1,
          bodySize: 0,
        },
        cache: {},
        timings: { send: 1, wait: 98, receive: 1 },
      });

      // Force flush for testing
      recorder.flush();

      expect(existsSync(TEST_HAR_FILE)).toBe(true);

      const content = JSON.parse(readFileSync(TEST_HAR_FILE, 'utf8')) as HARFile;
      expect(content).toMatchObject({
        log: {
          version: '1.2',
          creator: {
            name: 'Lace AI Coding Assistant',
            version: '1.0.0',
          },
          entries: expect.arrayContaining([
            expect.objectContaining({
              request: expect.objectContaining({
                method: 'GET',
                url: 'https://test.com',
              }) as object,
              response: expect.objectContaining({
                status: 200,
                statusText: 'OK',
              }) as object,
            }),
          ]) as unknown[],
        },
      });
    });

    it('should create directory if it does not exist', () => {
      const harFile = `${TEST_HAR_DIR}/nested/recording.har`;
      const recorder = new HARRecorder(harFile);

      recorder.recordEntry({
        startedDateTime: new Date().toISOString(),
        time: 100,
        request: {
          method: 'GET',
          url: 'https://test.com',
          httpVersion: 'HTTP/1.1',
          cookies: [],
          headers: [],
          queryString: [],
          headersSize: -1,
          bodySize: 0,
        },
        response: {
          status: 200,
          statusText: 'OK',
          httpVersion: 'HTTP/1.1',
          cookies: [],
          headers: [],
          content: { size: 0, mimeType: 'text/plain' },
          redirectURL: '',
          headersSize: -1,
          bodySize: 0,
        },
        cache: {},
        timings: { send: 1, wait: 98, receive: 1 },
      });

      expect(existsSync(harFile)).toBe(true);
    });
  });

  describe('recordFetchRequest', () => {
    it('should record fetch request with headers and body', async () => {
      const recorder = new HARRecorder(TEST_HAR_FILE);

      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: new Map([
          ['content-type', 'application/json'],
          ['x-custom-header', 'test-value'],
        ]),
        clone: () => ({
          text: () => Promise.resolve('{"result": "success"}'),
        }),
      } as unknown as Response;

      const init: Record<string, unknown> = {
        method: 'POST',
        headers: {
          authorization: 'Bearer token123',
          'content-type': 'application/json',
        },
        body: '{"query": "test"}',
      };

      await recorder.recordFetchRequest(
        'https://api.example.com/chat',
        init,
        Date.now() - 100,
        mockResponse,
        Date.now()
      );

      // Force flush for testing
      recorder.flush();

      const content = JSON.parse(readFileSync(TEST_HAR_FILE, 'utf8')) as HARFile;
      const entry = content.log.entries[0];

      expect(entry.request).toMatchObject({
        method: 'POST',
        url: 'https://api.example.com/chat',
        headers: expect.arrayContaining([
          { name: 'authorization', value: 'Bearer token123' },
          { name: 'content-type', value: 'application/json' },
        ]) as unknown[],
        postData: {
          mimeType: 'application/json',
          text: '{"query": "test"}',
        },
      });

      expect(entry.response).toMatchObject({
        status: 200,
        statusText: 'OK',
        headers: expect.arrayContaining([
          { name: 'content-type', value: 'application/json' },
          { name: 'x-custom-header', value: 'test-value' },
        ]) as unknown[],
        content: {
          mimeType: 'application/json',
          text: '{"result": "success"}',
        },
      });
    });

    it('should handle URL with query parameters', async () => {
      const recorder = new HARRecorder(TEST_HAR_FILE);

      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: new Map(),
        clone: () => ({ text: () => Promise.resolve('') }),
      } as unknown as Response;

      await recorder.recordFetchRequest(
        'https://api.example.com/search?q=test&limit=10',
        {},
        Date.now() - 50,
        mockResponse,
        Date.now()
      );

      // Force flush for testing
      recorder.flush();

      const content = JSON.parse(readFileSync(TEST_HAR_FILE, 'utf8')) as HARFile;
      const entry = content.log.entries[0];

      expect(entry.request.queryString).toEqual([
        { name: 'q', value: 'test' },
        { name: 'limit', value: '10' },
      ]);
    });
  });

  describe('recordHTTPRequest', () => {
    it('should record HTTP request with all details', () => {
      const recorder = new HARRecorder(TEST_HAR_FILE);

      recorder.recordHTTPRequest(
        'POST',
        'https://api.openai.com/v1/chat/completions',
        {
          authorization: 'Bearer sk-test',
          'content-type': 'application/json',
        },
        '{"model": "gpt-4", "messages": []}',
        Date.now() - 200,
        200,
        'OK',
        {
          'content-type': 'application/json',
          'x-ratelimit-remaining': '99',
        },
        '{"choices": [{"message": {"content": "Hello"}}]}',
        Date.now()
      );

      // Force flush for testing
      recorder.flush();

      const content = JSON.parse(readFileSync(TEST_HAR_FILE, 'utf8')) as HARFile;
      const entry = content.log.entries[0];

      expect(entry.request).toMatchObject({
        method: 'POST',
        url: 'https://api.openai.com/v1/chat/completions',
        postData: {
          text: '{"model": "gpt-4", "messages": []}',
        },
      });

      expect(entry.response).toMatchObject({
        status: 200,
        content: {
          text: '{"choices": [{"message": {"content": "Hello"}}]}',
        },
      });

      expect(entry.time).toBeGreaterThan(0);
    });
  });

  describe('recordWebSocketConnection', () => {
    it('should record WebSocket handshake and messages', () => {
      const recorder = new HARRecorder(TEST_HAR_FILE);

      const messages = [
        { timestamp: Date.now(), direction: 'sent' as const, data: '{"type": "connect"}' },
        {
          timestamp: Date.now() + 10,
          direction: 'received' as const,
          data: '{"type": "connected"}',
        },
        {
          timestamp: Date.now() + 20,
          direction: 'sent' as const,
          data: '{"type": "message", "content": "hello"}',
        },
      ];

      recorder.recordWebSocketConnection(
        'wss://api.lmstudio.ai/v1/chat',
        { authorization: 'Bearer token' },
        Date.now() - 100,
        Date.now(),
        messages
      );

      // Force flush for testing
      recorder.flush();

      const content = JSON.parse(readFileSync(TEST_HAR_FILE, 'utf8')) as HARFile;
      const entry = content.log.entries[0];

      expect(entry.request).toMatchObject({
        method: 'GET',
        url: 'wss://api.lmstudio.ai/v1/chat',
        headers: expect.arrayContaining([
          { name: 'Upgrade', value: 'websocket' },
          { name: 'Connection', value: 'Upgrade' },
        ]) as unknown[],
      });

      expect(entry.response).toMatchObject({
        status: 101,
        statusText: 'Switching Protocols',
        content: {
          mimeType: 'application/x-websocket-frames',
          text: JSON.stringify(messages, null, 2),
        },
      });

      expect(entry.comment).toContain('WebSocket connection with 3 messages');
    });
  });

  describe('global recorder management', () => {
    it('should initialize global recorder', () => {
      expect(getHARRecorder()).toBeNull();

      const recorder = initializeHARRecording(TEST_HAR_FILE);

      expect(getHARRecorder()).toBe(recorder);
      expect(getHARRecorder()).toBeInstanceOf(HARRecorder);
    });

    it('should disable global recorder', () => {
      initializeHARRecording(TEST_HAR_FILE);
      expect(getHARRecorder()).not.toBeNull();

      disableHARRecording();
      expect(getHARRecorder()).toBeNull();
    });
  });
});
