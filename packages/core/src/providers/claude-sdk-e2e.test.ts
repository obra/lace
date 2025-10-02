// ABOUTME: End-to-end tests for Claude Agent SDK provider with real SDK calls
// ABOUTME: Skipped by default - requires CLAUDE_SDK_SESSION_TOKEN environment variable

import { describe, it, expect, beforeEach } from 'vitest';
import { ClaudeSDKProvider } from '~/providers/claude-sdk-provider';
import { ToolExecutor } from '~/tools/executor';
import type { ProviderRequestContext } from '~/providers/base-provider';

// Skip by default - requires real credentials
describe.skip('ClaudeSDKProvider - E2E', () => {
  let provider: ClaudeSDKProvider;
  let toolExecutor: ToolExecutor;
  let context: ProviderRequestContext;

  beforeEach(() => {
    const sessionToken = process.env.CLAUDE_SDK_SESSION_TOKEN;
    if (!sessionToken) {
      throw new Error('CLAUDE_SDK_SESSION_TOKEN environment variable not set');
    }

    provider = new ClaudeSDKProvider({ sessionToken });
    toolExecutor = new ToolExecutor();

    context = {
      toolExecutor,
      workingDirectory: process.cwd(),
      processEnv: process.env,
    };
  });

  describe('Basic Request-Response', () => {
    it(
      'should make real SDK request and get response',
      async () => {
        const messages = [{ role: 'user' as const, content: 'What is 2+2? Answer with just the number.' }];

        const response = await provider.createResponse(messages, [], 'claude-sonnet-4', undefined, context);

        expect(response.content).toBeTruthy();
        expect(response.content).toContain('4');
        expect(response.usage).toBeDefined();
        expect(response.usage?.totalTokens).toBeGreaterThan(0);
      },
      30000
    ); // 30 second timeout

    it(
      'should handle follow-up messages',
      async () => {
        const messages1 = [{ role: 'user' as const, content: 'My name is Alice.' }];

        const response1 = await provider.createResponse(messages1, [], 'claude-sonnet-4', undefined, context);
        expect(response1.content).toBeTruthy();

        // Follow-up message
        const messages2 = [
          { role: 'user' as const, content: 'My name is Alice.' },
          { role: 'assistant' as const, content: response1.content },
          { role: 'user' as const, content: 'What is my name?' },
        ];

        const response2 = await provider.createResponse(messages2, [], 'claude-sonnet-4', undefined, context);
        expect(response2.content.toLowerCase()).toContain('alice');
      },
      60000
    );
  });

  describe('Streaming', () => {
    it(
      'should stream tokens in real-time',
      async () => {
        const tokens: string[] = [];
        provider.on('token', ({ token }) => tokens.push(token));

        const messages = [{ role: 'user' as const, content: 'Count from 1 to 5, one number per line.' }];

        const response = await provider.createStreamingResponse(
          messages,
          [],
          'claude-sonnet-4',
          undefined,
          context
        );

        expect(tokens.length).toBeGreaterThan(0);
        expect(response.content).toBeTruthy();
        expect(response.usage).toBeDefined();

        // Clean up event listener
        provider.removeAllListeners('token');
      },
      30000
    );

    it(
      'should emit token usage updates during streaming',
      async () => {
        const usageUpdates: any[] = [];
        provider.on('token_usage_update', ({ usage }) => usageUpdates.push(usage));

        const messages = [{ role: 'user' as const, content: 'Say hello' }];

        await provider.createStreamingResponse(messages, [], 'claude-sonnet-4', undefined, context);

        expect(usageUpdates.length).toBeGreaterThan(0);
        expect(usageUpdates[usageUpdates.length - 1].totalTokens).toBeGreaterThan(0);

        // Clean up event listener
        provider.removeAllListeners('token_usage_update');
      },
      30000
    );
  });

  describe('Session Resumption', () => {
    it(
      'should resume session across multiple turns',
      async () => {
        // First turn
        const messages1 = [{ role: 'user' as const, content: 'Remember: my favorite color is blue.' }];

        const response1 = await provider.createResponse(messages1, [], 'claude-sonnet-4', undefined, context);
        expect(response1.content).toBeTruthy();

        const sessionId1 = (provider as any).sessionId;
        expect(sessionId1).toBeDefined();

        // Second turn - should resume
        const messages2 = [
          { role: 'user' as const, content: 'Remember: my favorite color is blue.' },
          { role: 'assistant' as const, content: response1.content },
          { role: 'user' as const, content: 'What is my favorite color?' },
        ];

        const response2 = await provider.createResponse(messages2, [], 'claude-sonnet-4', undefined, context);
        expect(response2.content.toLowerCase()).toContain('blue');

        const sessionId2 = (provider as any).sessionId;
        expect(sessionId2).toBe(sessionId1); // Same session
      },
      60000
    );
  });

  describe('Model Support', () => {
    it(
      'should work with Claude Sonnet 4',
      async () => {
        const messages = [{ role: 'user' as const, content: 'Say "Sonnet works"' }];

        const response = await provider.createResponse(messages, [], 'claude-sonnet-4', undefined, context);

        expect(response.content).toContain('Sonnet works');
      },
      30000
    );

    it(
      'should work with Claude Opus 4',
      async () => {
        const messages = [{ role: 'user' as const, content: 'Say "Opus works"' }];

        const response = await provider.createResponse(messages, [], 'claude-opus-4', undefined, context);

        expect(response.content).toContain('Opus works');
      },
      30000
    );

    it(
      'should work with Claude Haiku 4',
      async () => {
        const messages = [{ role: 'user' as const, content: 'Say "Haiku works"' }];

        const response = await provider.createResponse(messages, [], 'claude-haiku-4', undefined, context);

        expect(response.content).toContain('Haiku works');
      },
      30000
    );
  });

  describe('Error Handling', () => {
    it(
      'should handle invalid model gracefully',
      async () => {
        const messages = [{ role: 'user' as const, content: 'Hello' }];

        await expect(
          provider.createResponse(messages, [], 'invalid-model', undefined, context)
        ).rejects.toThrow();
      },
      30000
    );
  });
});
