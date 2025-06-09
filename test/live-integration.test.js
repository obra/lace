// ABOUTME: Live integration tests with real Anthropic API calls
// ABOUTME: Tests actual LLM reasoning and tool calling (skipped if no API key)

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { Lace } from '../src/lace.js';
import { Agent } from '../src/agents/agent.ts';

const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

// Conditionally describe tests based on API key availability
const describeConditional = hasApiKey ? describe : describe.skip;

describeConditional('Live Anthropic API Integration Tests', () => {
  let lace;
  
  beforeAll(async () => {
    // Increase timeout for real API calls
    jest.setTimeout(30000);
    
    lace = new Lace({ 
      verbose: false,
      memoryPath: ':memory:' // Use in-memory DB for tests
    });
    
    await lace.db.initialize();
    await lace.tools.initialize();
    await lace.modelProvider.initialize();
    
    lace.primaryAgent = new Agent({
      generation: 0,
      tools: lace.tools,
      db: lace.db,
      modelProvider: lace.modelProvider,
      verbose: false,
      role: 'orchestrator',
      assignedModel: 'claude-3-5-sonnet-20241022',
      assignedProvider: 'anthropic',
      capabilities: ['orchestration', 'reasoning', 'planning', 'delegation']
    });
  });
  
  afterAll(async () => {
    if (lace) {
      await lace.shutdown();
    }
  });

  test('should execute shell commands through real API', async () => {
    const response = await lace.primaryAgent.processInput(
      'live-test-session', 
      'list files in current directory and tell me how many there are'
    );
    
    expect(response).toBeDefined();
    expect(response.content).toBeTruthy();
    expect(typeof response.content).toBe('string');
    
    // Should have made tool calls
    expect(response.toolCalls).toBeTruthy();
    expect(response.toolCalls.length).toBeGreaterThan(0);
    
    // Should include shell tool
    const shellCall = response.toolCalls.find(tc => tc.name === 'shell_execute');
    expect(shellCall).toBeTruthy();
  }, 30000);

  test('should perform calculations through real API', async () => {
    const response = await lace.primaryAgent.processInput(
      'live-test-session',
      'calculate the square root of 144'
    );
    
    expect(response).toBeDefined();
    expect(response.content).toBeTruthy();
    expect(response.content.toLowerCase()).toContain('12');
    
    // Should have made tool calls for calculation
    expect(response.toolCalls).toBeTruthy();
    expect(response.toolCalls.length).toBeGreaterThan(0);
  }, 30000);

  test('should handle complex reasoning tasks through real API', async () => {
    const response = await lace.primaryAgent.processInput(
      'live-test-session',
      'briefly explain the key components needed for user authentication in a web app'
    );
    
    expect(response).toBeDefined();
    expect(response.content).toBeTruthy();
    expect(response.content.length).toBeGreaterThan(100);
    
    // Response should mention authentication concepts
    const content = response.content.toLowerCase();
    expect(
      content.includes('password') || 
      content.includes('authentication') || 
      content.includes('login') ||
      content.includes('session')
    ).toBe(true);
  }, 30000);

  test('should maintain conversation context across multiple interactions', async () => {
    const sessionId = 'context-test-session';
    
    // First interaction
    const response1 = await lace.primaryAgent.processInput(
      sessionId,
      'Remember that my favorite programming language is JavaScript'
    );
    expect(response1.content).toBeTruthy();
    
    // Second interaction referencing previous context
    const response2 = await lace.primaryAgent.processInput(
      sessionId,
      'What is my favorite programming language?'
    );
    expect(response2.content).toBeTruthy();
    expect(response2.content.toLowerCase()).toContain('javascript');
  }, 45000);
});