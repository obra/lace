// ABOUTME: Tests for agent context helper functions
// ABOUTME: Ensures type-safe extraction of Agent from Next.js request context

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { getAgentFromRequest, setSharedAgent } from '~/interfaces/web/lib/agent-context';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ToolExecutor } from '~/tools/executor';
import { TestProvider } from '~/__tests__/utils/test-provider';

describe('getAgentFromRequest', () => {
  let testDir: string;
  let agent: Agent;
  let threadManager: ThreadManager;

  beforeEach(async () => {
    // Create isolated test environment
    testDir = await mkdtemp(join(tmpdir(), 'agent-context-test-'));

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
  });

  afterEach(async () => {
    // Clean up to prevent memory leaks
    threadManager.close();
    await rm(testDir, { recursive: true, force: true });

    // Reset shared agent to prevent test interference
    setSharedAgent(null as any);
  });

  it('should return agent when available in request context', () => {
    const request = new NextRequest('http://localhost:3000/api/test');

    // Simulate what WebInterface does in request handler
    (request as any).laceAgent = agent;

    const result = getAgentFromRequest(request);

    expect(result).toBe(agent);
    expect(result.getCurrentThreadId()).toMatch(/^lace_\d{8}_[a-z0-9]{6}$/);
  });

  it('should throw descriptive error when agent not available', () => {
    const request = new NextRequest('http://localhost:3000/api/test');

    expect(() => getAgentFromRequest(request)).toThrow(
      'Agent not available in request context. WebInterface must be running in integrated mode.'
    );
  });

  it('should throw when agent is null', () => {
    const request = new NextRequest('http://localhost:3000/api/test');
    (request as any).laceAgent = null;

    expect(() => getAgentFromRequest(request)).toThrow('Agent not available in request context');
  });

  it('should throw when agent is undefined', () => {
    const request = new NextRequest('http://localhost:3000/api/test');
    (request as any).laceAgent = undefined;

    expect(() => getAgentFromRequest(request)).toThrow('Agent not available in request context');
  });

  it('should work with started agent that has proper methods', () => {
    const request = new NextRequest('http://localhost:3000/api/test');
    (request as any).laceAgent = agent;

    const result = getAgentFromRequest(request);

    // Verify Agent has the methods API routes expect
    expect(typeof result.resumeOrCreateThread).toBe('function');
    expect(typeof result.generateThreadId).toBe('function');
    expect(typeof result.createThread).toBe('function');
    expect(typeof result.getThreadEvents).toBe('function');
    expect(result.toolExecutor).toBeDefined();
  });

  it('should fall back to shared agent when request does not have agent', () => {
    const request = new NextRequest('http://localhost:3000/api/test');

    // Set shared agent but don't attach to request
    setSharedAgent(agent);

    const result = getAgentFromRequest(request);

    expect(result).toBe(agent);
    expect(result.getCurrentThreadId()).toMatch(/^lace_\d{8}_[a-z0-9]{6}$/);
  });

  it('should prefer request agent over shared agent', () => {
    const request = new NextRequest('http://localhost:3000/api/test');

    // Create a different agent for shared context
    const sharedAgent = new Agent({
      provider: new TestProvider(),
      toolExecutor: new ToolExecutor(),
      threadManager,
      threadId: threadManager.generateThreadId(),
      tools: [],
    });

    setSharedAgent(sharedAgent);
    (request as any).laceAgent = agent;

    const result = getAgentFromRequest(request);

    // Should get the request agent, not the shared one
    expect(result).toBe(agent);
    expect(result).not.toBe(sharedAgent);
  });
});
