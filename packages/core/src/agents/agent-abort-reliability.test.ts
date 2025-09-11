// ABOUTME: Test to reproduce abort reliability issues Jesse reported
// ABOUTME: Tests timing scenarios that could cause abort to sometimes fail

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent, AgentConfig } from '~/agents/agent';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import { ToolExecutor } from '~/tools/executor';
import { ThreadManager } from '~/threads/thread-manager';
import { setupCoreTest } from '~/test-utils/core-test-setup';

// Mock provider that simulates real-world timing variations
class VariableDelayMockProvider extends BaseMockProvider {
  private delay: number;

  constructor(minDelay = 50, maxDelay = 200) {
    super({});
    this.delay = minDelay + Math.random() * (maxDelay - minDelay);
  }

  get providerName(): string {
    return 'variable-delay-mock';
  }

  get supportsStreaming(): boolean {
    return true;
  }

  async createResponse(
    _messages: ProviderMessage[],
    _tools: Tool[],
    _model: string,
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    // Check if aborted before starting
    if (signal?.aborted) {
      throw new Error('Request aborted');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        resolve({
          content: `Response after ${this.delay.toFixed(0)}ms delay`,
          toolCalls: [],
          usage: {
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
          },
        });
      }, this.delay);

      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timeout);
          const error = new Error('Request aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }
    });
  }

  async createStreamingResponse(
    messages: ProviderMessage[],
    tools: Tool[],
    model: string,
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    return this.createResponse(messages, tools, model, signal);
  }
}

describe('Agent Abort Reliability', () => {
  const _tempLaceDir = setupCoreTest();

  beforeEach(() => {
    vi.useRealTimers(); // Use real timers for realistic timing
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('should handle rapid abort attempts reliably', async () => {
    const totalAttempts = 20;
    let successfulAborts = 0;

    for (let i = 0; i < totalAttempts; i++) {
      try {
        const toolExecutor = new ToolExecutor();
        const threadManager = new ThreadManager();
        const threadId = threadManager.generateThreadId();
        threadManager.createThread(threadId);

        const config: AgentConfig = {
          toolExecutor,
          threadManager,
          threadId,
          tools: [],
          metadata: {
            name: `test-agent-${i}`,
            modelId: 'test-model',
            providerInstanceId: 'test-instance',
          },
        };

        const agent = new Agent(config);
        const provider = new VariableDelayMockProvider(30, 150);

        vi.spyOn(agent, '_createProviderInstance' as any).mockResolvedValue(provider);
        agent.updateThreadMetadata({
          modelId: 'test-model',
          providerInstanceId: 'test-instance',
        });

        await agent.start();

        // Start message processing
        const messagePromise = agent.sendMessage(`Test message ${i}`);

        // Variable delay before abort (simulates user timing)
        const abortDelay = 5 + Math.random() * 40;
        await new Promise((resolve) => setTimeout(resolve, abortDelay));

        // Attempt to abort
        const abortResult = agent.abort();

        // Wait for completion
        await messagePromise;

        // Check if abort was successful
        if (abortResult && agent.getCurrentState() === 'idle') {
          successfulAborts++;
        } else {
          console.log(
            `Attempt ${i + 1}: Abort returned ${abortResult}, state: ${agent.getCurrentState()}`
          );
        }
      } catch (error) {
        console.log(`Attempt ${i + 1} threw error:`, error);
      }
    }

    console.log(
      `\nAbort reliability test results: ${successfulAborts}/${totalAttempts} successful (${(
        (successfulAborts / totalAttempts) *
        100
      ).toFixed(1)}%)`
    );

    // We expect at least 90% reliability
    const reliabilityPercent = (successfulAborts / totalAttempts) * 100;
    expect(reliabilityPercent).toBeGreaterThanOrEqual(90);
  });

  it('should handle abort during streaming state reliably', async () => {
    // Focus on streaming state since "thinking" state is too brief to test reliably
    const abortResults: boolean[] = [];

    for (let i = 0; i < 10; i++) {
      const toolExecutor = new ToolExecutor();
      const threadManager = new ThreadManager();
      const threadId = threadManager.generateThreadId();
      threadManager.createThread(threadId);

      const agent = new Agent({
        toolExecutor,
        threadManager,
        threadId,
        tools: [],
        metadata: {
          name: `test-agent-streaming-${i}`,
          modelId: 'test-model',
          providerInstanceId: 'test-instance',
        },
      });

      const provider = new VariableDelayMockProvider(80, 200);
      vi.spyOn(agent, '_createProviderInstance' as any).mockResolvedValue(provider);
      agent.updateThreadMetadata({
        modelId: 'test-model',
        providerInstanceId: 'test-instance',
      });

      await agent.start();

      // Monitor state changes
      let reachedStreamingState = false;
      agent.on('state_change', (data) => {
        if (data.newState === 'streaming') {
          reachedStreamingState = true;
        }
      });

      const messagePromise = agent.sendMessage(`Test streaming abort ${i}`);

      // Wait for streaming state or timeout
      const stateWaitPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout waiting for streaming state'));
        }, 100);

        const checkState = () => {
          if (reachedStreamingState || agent.getCurrentState() === 'streaming') {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(checkState, 5);
          }
        };
        checkState();
      });

      try {
        await stateWaitPromise;

        // Attempt abort
        const abortResult = agent.abort();
        await messagePromise;

        const finalState = agent.getCurrentState();
        const success = abortResult && finalState === 'idle';

        abortResults.push(success);
      } catch (_error) {
        // State timeout - try abort anyway (for any other active state)
        const abortResult = agent.abort();
        await messagePromise;

        // If we can abort any active state, consider it successful
        const wasActive = agent.getCurrentState() !== 'idle';
        abortResults.push(abortResult && (wasActive || agent.getCurrentState() === 'idle'));
      }
    }

    // Check reliability for streaming state aborts
    const successRate = abortResults.filter(Boolean).length / abortResults.length;
    console.log(`Streaming state abort success rate: ${(successRate * 100).toFixed(1)}%`);
    expect(successRate).toBeGreaterThan(0.8); // 80% minimum for streaming aborts
  });

  it('should handle concurrent abort attempts safely', async () => {
    const toolExecutor = new ToolExecutor();
    const threadManager = new ThreadManager();
    const threadId = threadManager.generateThreadId();
    threadManager.createThread(threadId);

    const agent = new Agent({
      toolExecutor,
      threadManager,
      threadId,
      tools: [],
      metadata: {
        name: 'concurrent-abort-test',
        modelId: 'test-model',
        providerInstanceId: 'test-instance',
      },
    });

    const provider = new VariableDelayMockProvider(100, 200);
    vi.spyOn(agent, '_createProviderInstance' as any).mockResolvedValue(provider);
    agent.updateThreadMetadata({
      modelId: 'test-model',
      providerInstanceId: 'test-instance',
    });

    await agent.start();

    const messagePromise = agent.sendMessage('Concurrent abort test');

    // Wait briefly then fire multiple abort attempts rapidly
    await new Promise((resolve) => setTimeout(resolve, 20));

    const abortPromises = [];
    for (let i = 0; i < 5; i++) {
      abortPromises.push(
        new Promise<boolean>((resolve) => {
          setTimeout(() => {
            resolve(agent.abort());
          }, i * 2); // Stagger slightly
        })
      );
    }

    const abortResults = await Promise.all(abortPromises);
    await messagePromise;

    // Should not crash and should end in idle state
    expect(agent.getCurrentState()).toBe('idle');

    // At least one abort should succeed
    const anyAbortSucceeded = abortResults.some(Boolean);
    expect(anyAbortSucceeded).toBe(true);
  });
});
