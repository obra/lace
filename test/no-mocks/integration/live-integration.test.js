// ABOUTME: Live integration tests with real Anthropic API calls
// ABOUTME: Tests actual LLM reasoning and tool calling (skipped if no API key)

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { LaceUI } from '@/ui/lace-ui.ts';
import { Agent } from '@/agents/agent.ts';

const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

// Conditionally describe tests based on API key availability
const describeConditional = hasApiKey ? describe : describe.skip;

describeConditional('Live Anthropic API Integration Tests', () => {
  let lace;
  
  beforeAll(async () => {
    // Increase timeout for real API calls
    jest.setTimeout(30000);
    
    lace = new LaceUI({ 
      verbose: false,
      memoryPath: ':memory:', // Use in-memory DB for tests
    });
    
    await lace.initialize();
  });
  
  afterAll(async () => {
    if (lace) {
      await lace.stop();
    }
  });

  test('should execute shell commands through real API', async () => {
    const response = await lace.handleMessage(
      'list files in current directory and tell me how many there are'
    );
    
    expect(response).toBeDefined();
    expect(response.content).toBeTruthy();
    expect(typeof response.content).toBe('string');
    expect(response.success).toBe(true);
    
    // Should have made tool calls
    expect(response.toolCalls).toBeTruthy();
    expect(response.toolCalls.length).toBeGreaterThan(0);
    
    // Should include shell tool
    const shellCall = response.toolCalls.find(tc => tc.name === 'shell_execute');
    expect(shellCall).toBeTruthy();
  }, 30000);

  test('should perform calculations through real API', async () => {
    const response = await lace.handleMessage(
      'calculate the square root of 144'
    );
    
    expect(response).toBeDefined();
    expect(response.content).toBeTruthy();
    expect(response.content.toLowerCase()).toContain('12');
    expect(response.success).toBe(true);
    
    // Should have made tool calls for calculation
    expect(response.toolCalls).toBeTruthy();
    expect(response.toolCalls.length).toBeGreaterThan(0);
  }, 30000);

  test('should handle complex reasoning tasks through real API', async () => {
    const response = await lace.handleMessage(
      'briefly explain the key components needed for user authentication in a web app'
    );
    
    expect(response).toBeDefined();
    expect(response.content).toBeTruthy();
    expect(response.content.length).toBeGreaterThan(100);
    expect(response.success).toBe(true);
    
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
    // First interaction
    const response1 = await lace.handleMessage(
      'Remember that my favorite programming language is JavaScript'
    );
    expect(response1.content).toBeTruthy();
    expect(response1.success).toBe(true);
    
    // Second interaction referencing previous context
    const response2 = await lace.handleMessage(
      'What is my favorite programming language?'
    );
    expect(response2.content).toBeTruthy();
    expect(response2.success).toBe(true);
    expect(response2.content.toLowerCase()).toContain('javascript');
  }, 45000);
});
