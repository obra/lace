// ABOUTME: Unit tests for conversation API route
// ABOUTME: Tests synchronous conversation handling with Agent integration

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { POST, GET } from '../route';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ToolExecutor } from '~/tools/executor';
import { TestProvider } from '~/__tests__/utils/test-provider';
import { setSharedAgent } from '~/interfaces/web/lib/agent-context';

describe('POST /api/conversations', () => {
  let testDir: string;
  let agent: Agent;
  let threadManager: ThreadManager;

  beforeEach(async () => {
    // Create isolated test environment
    testDir = await mkdtemp(join(tmpdir(), 'conversation-api-test-'));

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
    const request = new NextRequest('http://localhost:3000/api/conversations', {
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
    const request = new NextRequest('http://localhost:3000/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Message is required');
  });

  it('should process valid message and return response', async () => {
    const request = new NextRequest('http://localhost:3000/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello world' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.threadId).toMatch(/^lace_\d{8}_[a-z0-9]{6}$/);
    expect(data.content).toBeDefined();
    expect(data.isNew).toBe(true);
    expect(typeof data.content).toBe('string');
  });

  it('should handle existing threadId in request', async () => {
    // Create a thread first
    const existingThreadId = threadManager.generateThreadId();
    threadManager.createThread(existingThreadId);

    const request = new NextRequest('http://localhost:3000/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        message: 'Hello world',
        threadId: existingThreadId 
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.threadId).toBe(existingThreadId);
    expect(data.isNew).toBe(false);
  });

  it('should return 500 when agent context is missing', async () => {
    // Clear shared agent to simulate missing context
    setSharedAgent(null as any);

    const request = new NextRequest('http://localhost:3000/api/conversations', {
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
    const request = new NextRequest('http://localhost:3000/api/conversations', {
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

describe('GET /api/conversations', () => {
  let testDir: string;
  let agent: Agent;
  let threadManager: ThreadManager;

  beforeEach(async () => {
    // Create isolated test environment
    testDir = await mkdtemp(join(tmpdir(), 'conversation-get-test-'));

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

  it('should return 400 when threadId is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/conversations');

    const response = await GET(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('threadId parameter is required');
  });

  it('should return 404 when thread does not exist', async () => {
    const request = new NextRequest('http://localhost:3000/api/conversations?threadId=nonexistent');

    const response = await GET(request);

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe('Thread not found');
  });

  it('should return thread history when thread exists', async () => {
    // Use the agent's current thread which already has events
    const threadId = agent.getCurrentThreadId();
    
    // Add some sample events to the thread
    threadManager.addEvent(threadId!, 'USER_MESSAGE', 'Hello');
    threadManager.addEvent(threadId!, 'AGENT_MESSAGE', 'Hi there!');

    const request = new NextRequest(`http://localhost:3000/api/conversations?threadId=${threadId}`);

    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.threadId).toBe(threadId);
    expect(data.messages).toBeDefined();
    expect(Array.isArray(data.messages)).toBe(true);
    expect(data.totalEvents).toBe(2);
  });

  it('should return 500 when agent context is missing', async () => {
    // Clear shared agent to simulate missing context
    setSharedAgent(null as any);

    const request = new NextRequest('http://localhost:3000/api/conversations?threadId=any');

    const response = await GET(request);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBeDefined();
    expect(data.error).toContain('Agent not available');
  });
});