// ABOUTME: Unit tests for streaming conversation API route
// ABOUTME: Tests Server-Sent Events streaming functionality with Agent integration

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { POST } from '../route';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ToolExecutor } from '~/tools/executor';
import { TestProvider } from '~/__tests__/utils/test-provider';
import { setSharedAgent } from '~/interfaces/web/lib/agent-context';

describe('POST /api/conversations/stream', () => {
  let testDir: string;
  let agent: Agent;
  let threadManager: ThreadManager;

  beforeEach(async () => {
    // Create isolated test environment
    testDir = await mkdtemp(join(tmpdir(), 'stream-api-test-'));

    // Create ThreadManager with test database
    threadManager = new ThreadManager(join(testDir, 'test.db'));

    // Create dependencies
    const provider = new TestProvider();
    const toolExecutor = new ToolExecutor();

    // Generate thread ID through ThreadManager
    const threadId = threadManager.generateThreadId();
    threadManager.createThread(threadId);

    // Initialize Agent
    agent = new Agent({
      provider,
      toolExecutor,
      threadManager,
      threadId,
      tools: [],
    });

    await agent.start();
    setSharedAgent(agent);
  });

  afterEach(async () => {
    // Clean up to prevent memory leaks
    agent.stop();
    threadManager.close();
    await rm(testDir, { recursive: true, force: true });
    setSharedAgent(null as any);
  });

  it('should return 400 when message is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/conversations/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Message is required');
  });

  it('should return 400 when message is empty string', async () => {
    const request = new NextRequest('http://localhost:3000/api/conversations/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Message is required');
  });

  it('should return streaming response for valid message', async () => {
    const request = new NextRequest('http://localhost:3000/api/conversations/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello world' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('Connection')).toBe('keep-alive');
    expect(response.body).toBeDefined();
  });

  it('should stream connection event first', async () => {
    const request = new NextRequest('http://localhost:3000/api/conversations/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello world' }),
    });

    const response = await POST(request);
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error('No response body reader');
    }

    const { done, value } = await reader.read();
    expect(done).toBe(false);

    const chunk = decoder.decode(value);
    expect(chunk).toContain('data: {');
    
    const lines = chunk.split('\n');
    const dataLine = lines.find(line => line.startsWith('data: '));
    expect(dataLine).toBeDefined();
    
    const eventData = JSON.parse(dataLine!.substring(6));
    expect(eventData.type).toBe('connection');
    expect(eventData.threadId).toMatch(/^lace_\d{8}_[a-z0-9]{6}$/);
    expect(eventData.isNew).toBe(true);
    expect(eventData.provider).toBe('anthropic');

    reader.releaseLock();
  });

  it('should handle custom provider and model in connection event', async () => {
    const request = new NextRequest('http://localhost:3000/api/conversations/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        message: 'Hello world',
        provider: 'openai',
        model: 'gpt-4' 
      }),
    });

    const response = await POST(request);
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error('No response body reader');
    }

    const { done, value } = await reader.read();
    expect(done).toBe(false);

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');
    const dataLine = lines.find(line => line.startsWith('data: '));
    const eventData = JSON.parse(dataLine!.substring(6));
    
    expect(eventData.provider).toBe('openai');
    expect(eventData.model).toBe('gpt-4');

    reader.releaseLock();
  });

  it('should handle existing threadId in request', async () => {
    // Create a thread first
    const existingThreadId = threadManager.generateThreadId();
    threadManager.createThread(existingThreadId);

    const request = new NextRequest('http://localhost:3000/api/conversations/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        message: 'Hello world',
        threadId: existingThreadId 
      }),
    });

    const response = await POST(request);
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error('No response body reader');
    }

    const { done: _done, value } = await reader.read();
    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');
    const dataLine = lines.find(line => line.startsWith('data: '));
    const eventData = JSON.parse(dataLine!.substring(6));
    
    expect(eventData.threadId).toBe(existingThreadId);
    expect(eventData.isNew).toBe(false);

    reader.releaseLock();
  });

  it('should return 500 when agent context is missing', async () => {
    // Clear shared agent to simulate missing context
    setSharedAgent(null as any);

    const request = new NextRequest('http://localhost:3000/api/conversations/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello world' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBeDefined();
    expect(data.error).toContain('Agent not available');
  });

  it('should handle malformed JSON in request', async () => {
    const request = new NextRequest('http://localhost:3000/api/conversations/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid json',
    });

    const response = await POST(request);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBeDefined();
  });
});