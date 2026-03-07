// ABOUTME: Tests for ConversationRunner - the agentic loop for executing prompts

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationRunner } from '../runner';
import type { RunnerConfig, RunnerDependencies } from '../types';
import { TestAgentProvider } from '@lace/agent/runtime/test-provider';
import {
  AIProvider,
  type ProviderMessage,
  type ProviderResponse,
  type ConversationState,
  type RequestOptions,
} from '@lace/agent/providers/base-provider';
import type { Tool } from '@lace/agent/tools/tool';

/**
 * Create mock dependencies for testing ConversationRunner
 */
function createMockDeps(overrides: Partial<RunnerDependencies> = {}): RunnerDependencies {
  const mockToolExecutor = {
    getTool: vi.fn().mockReturnValue(null),
    execute: vi
      .fn()
      .mockResolvedValue({ status: 'completed', content: [{ type: 'text', text: 'mock result' }] }),
  };

  const mockJobManager = {
    getJob: vi.fn().mockReturnValue(undefined),
    listJobs: vi.fn().mockReturnValue([]),
    getJobOutput: vi.fn().mockReturnValue(''),
    createJob: vi
      .fn()
      .mockResolvedValue({ jobId: 'job_test', job: { completion: Promise.resolve() } }),
    cancelJob: vi.fn().mockResolvedValue(undefined),
    finalizeJob: vi.fn().mockResolvedValue(undefined),
    getStreamingMode: vi.fn().mockReturnValue('full'),
    setStreamingMode: vi.fn(),
    queueNotification: vi.fn(),
    flushNotifications: vi.fn().mockReturnValue([]),
    getNotificationQueue: vi.fn().mockReturnValue([]),
    getRunningJobs: vi.fn().mockReturnValue([]),
  };

  return {
    onUpdate: vi.fn().mockResolvedValue(undefined),
    runExclusive: vi
      .fn()
      .mockImplementation(<T>(fn: () => T | Promise<T>) => Promise.resolve(fn())),
    requestPermission: vi.fn().mockResolvedValue({ decision: 'allow' }),
    createToolExecutor: vi.fn().mockReturnValue({
      executor: mockToolExecutor,
      toolsForProvider: [],
    }),
    createProvider: vi.fn().mockImplementation(async () => new TestAgentProvider()),
    getModelPricing: vi.fn().mockResolvedValue(null),
    startShellJob: vi.fn().mockResolvedValue({ jobId: 'job_test' }),
    startSubagentJob: vi.fn().mockResolvedValue({ jobId: 'job_test' }),
    deriveJobs: vi.fn().mockReturnValue([]),
    finalizeJob: vi.fn().mockResolvedValue(undefined),
    getJob: vi.fn().mockReturnValue(undefined),
    jobManager: mockJobManager as unknown as RunnerDependencies['jobManager'],
    mcpServerManager: undefined,
    setActiveTurnStatus: vi.fn(),
    getSessionCostUsd: vi.fn().mockReturnValue(0),
    updateSessionUsage: vi.fn(),
    ...overrides,
  };
}

describe('ConversationRunner', () => {
  it('creates a runner instance with required config and deps', () => {
    const config: RunnerConfig = {
      sessionDir: '/tmp/test-session',
      sessionId: 'sess_test',
      cwd: '/tmp/test-cwd',
      executionMode: 'execute',
      approvalMode: 'approve',
    };
    const deps = createMockDeps();

    const runner = new ConversationRunner(config, deps);
    expect(runner).toBeDefined();
    expect(runner).toBeInstanceOf(ConversationRunner);
  });

  it('accepts optional config parameters', () => {
    const config: RunnerConfig = {
      sessionDir: '/tmp/test-session',
      sessionId: 'sess_test',
      cwd: '/tmp/test-cwd',
      executionMode: 'plan',
      approvalMode: 'approveReads',
      connectionId: 'test-connection',
      modelId: 'test-model',
      environment: { NODE_ENV: 'test' },
      maxBudgetUsd: 10.0,
    };
    const deps = createMockDeps();

    const runner = new ConversationRunner(config, deps);
    expect(runner).toBeDefined();
  });

  it('exposes sessionDir from config', () => {
    const config: RunnerConfig = {
      sessionDir: '/tmp/my-session',
      sessionId: 'sess_test',
      cwd: '/tmp/test-cwd',
      executionMode: 'execute',
      approvalMode: 'approve',
    };
    const deps = createMockDeps();

    const runner = new ConversationRunner(config, deps);
    expect(runner.sessionDir).toBe('/tmp/my-session');
  });

  describe('run()', () => {
    let sessionDir: string;
    let cwd: string;

    beforeEach(() => {
      // Create unique temp directories for each test
      const testId = randomUUID().substring(0, 8);
      sessionDir = join(tmpdir(), `lace-runner-test-session-${testId}`);
      cwd = join(tmpdir(), `lace-runner-test-cwd-${testId}`);
      mkdirSync(sessionDir, { recursive: true });
      mkdirSync(cwd, { recursive: true });

      // Initialize session files (state.json and events.jsonl)
      writeFileSync(
        join(sessionDir, 'state.json'),
        JSON.stringify({
          nextEventSeq: 1,
          nextStreamSeq: 1,
        })
      );
      writeFileSync(join(sessionDir, 'events.jsonl'), '');
    });

    afterEach(() => {
      // Clean up temp directories
      if (existsSync(sessionDir)) {
        rmSync(sessionDir, { recursive: true, force: true });
      }
      if (existsSync(cwd)) {
        rmSync(cwd, { recursive: true, force: true });
      }
    });

    it('returns a result with turnId and content when provider responds', async () => {
      const onUpdate = vi.fn().mockResolvedValue(undefined);
      const config: RunnerConfig = {
        sessionDir,
        sessionId: 'sess_test',
        cwd,
        executionMode: 'execute',
        approvalMode: 'approve',
      };
      const deps = createMockDeps({ onUpdate });
      const runner = new ConversationRunner(config, deps);

      const result = await runner.run({
        content: [{ type: 'text', text: 'Hello, world!' }],
        abortController: new AbortController(),
        turnId: `turn_${randomUUID()}`,
        startedAt: new Date().toISOString(),
      });

      expect(result).toBeDefined();
      expect(result.turnId).toMatch(/^turn_/);
      expect(result.stopReason).toBe('end_turn');
      expect(result.usage).toBeDefined();
      expect(result.usage.inputTokens).toBeGreaterThanOrEqual(0);
      expect(result.usage.outputTokens).toBeGreaterThanOrEqual(0);
    });

    it('writes turn_end event to events.jsonl', async () => {
      const onUpdate = vi.fn().mockResolvedValue(undefined);
      const config: RunnerConfig = {
        sessionDir,
        sessionId: 'sess_test',
        cwd,
        executionMode: 'execute',
        approvalMode: 'approve',
      };
      const deps = createMockDeps({ onUpdate });
      const runner = new ConversationRunner(config, deps);

      await runner.run({
        content: [{ type: 'text', text: 'Test prompt' }],
        abortController: new AbortController(),
        turnId: `turn_${randomUUID()}`,
        startedAt: new Date().toISOString(),
      });

      const eventsPath = join(sessionDir, 'events.jsonl');
      const eventsRaw = readFileSync(eventsPath, 'utf8');
      const events = eventsRaw
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));

      // Should have at least message and turn_end events (prompt/turn_start are written by the RPC layer)
      expect(events.length).toBeGreaterThanOrEqual(2);

      const eventTypes = events.map((e: { type: string }) => e.type);
      expect(eventTypes).toContain('message');
      expect(eventTypes).toContain('turn_end');
    });

    it('emits session updates via onUpdate callback', async () => {
      const onUpdate = vi.fn().mockResolvedValue(undefined);
      const config: RunnerConfig = {
        sessionDir,
        sessionId: 'sess_test',
        cwd,
        executionMode: 'execute',
        approvalMode: 'approve',
      };
      const deps = createMockDeps({ onUpdate });
      const runner = new ConversationRunner(config, deps);

      await runner.run({
        content: [{ type: 'text', text: 'Hello' }],
        abortController: new AbortController(),
        turnId: `turn_${randomUUID()}`,
        startedAt: new Date().toISOString(),
      });

      // Should have received text_delta updates for non-streaming responses
      expect(onUpdate).toHaveBeenCalled();
    });

    it('updates session state after run completes', async () => {
      const onUpdate = vi.fn().mockResolvedValue(undefined);
      const updateSessionUsage = vi.fn();
      const config: RunnerConfig = {
        sessionDir,
        sessionId: 'sess_test',
        cwd,
        executionMode: 'execute',
        approvalMode: 'approve',
      };
      const deps = createMockDeps({ onUpdate, updateSessionUsage });
      const runner = new ConversationRunner(config, deps);

      await runner.run({
        content: [{ type: 'text', text: 'Test' }],
        abortController: new AbortController(),
        turnId: `turn_${randomUUID()}`,
        startedAt: new Date().toISOString(),
      });

      // updateSessionUsage should have been called
      expect(updateSessionUsage).toHaveBeenCalled();
    });

    describe('thinking events', () => {
      /**
       * A test provider that emits thinking events before the response.
       */
      class ThinkingTestProvider extends AIProvider {
        get providerName(): string {
          return 'thinking-test';
        }

        getProviderInfo() {
          return {
            name: 'thinking-test',
            displayName: 'Thinking Test Provider',
            requiresApiKey: false,
          };
        }

        isConfigured(): boolean {
          return true;
        }

        get supportsStreaming(): boolean {
          return true;
        }

        async createResponse(
          messages: ProviderMessage[],
          tools: Tool[],
          model: string,
          signal?: AbortSignal
        ): Promise<ProviderResponse> {
          return this.createStreamingResponse(messages, tools, model, signal);
        }

        async createStreamingResponse(
          _messages: ProviderMessage[],
          _tools: Tool[],
          _model: string,
          _signal?: AbortSignal
        ): Promise<ProviderResponse> {
          // Emit thinking events
          this.emit('thinking_start', {});
          this.emit('thinking_delta', { text: 'Let me think about this...' });
          this.emit('thinking_delta', { text: ' Considering the options...' });
          this.emit('thinking_end', { tokens: 42 });

          // Then emit the response
          const content = 'Here is my response after thinking.';
          this.emit('token', { token: content });
          this.emit('complete', { response: { content, toolCalls: [], stopReason: 'stop' } });

          return {
            content,
            toolCalls: [],
            stopReason: 'stop',
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          };
        }
      }

      it('forwards thinking_start events via onUpdate', async () => {
        const onUpdate = vi.fn().mockResolvedValue(undefined);
        const config: RunnerConfig = {
          sessionDir,
          sessionId: 'sess_test',
          cwd,
          executionMode: 'execute',
          approvalMode: 'approve',
        };
        const deps = createMockDeps({
          onUpdate,
          createProvider: vi.fn().mockImplementation(async () => new ThinkingTestProvider()),
        });
        const runner = new ConversationRunner(config, deps);
        const turnId = `turn_${randomUUID()}`;

        await runner.run({
          content: [{ type: 'text', text: 'Hello' }],
          abortController: new AbortController(),
          turnId,
          startedAt: new Date().toISOString(),
        });

        // Find the thinking_start update
        const thinkingStartCalls = onUpdate.mock.calls.filter(
          (call) => call[1]?.type === 'thinking_start'
        );
        expect(thinkingStartCalls.length).toBe(1);
        expect(thinkingStartCalls[0][1]).toEqual(
          expect.objectContaining({
            type: 'thinking_start',
            turnId,
          })
        );
      });

      it('forwards thinking_delta events via onUpdate (throttled)', async () => {
        const onUpdate = vi.fn().mockResolvedValue(undefined);
        const config: RunnerConfig = {
          sessionDir,
          sessionId: 'sess_test',
          cwd,
          executionMode: 'execute',
          approvalMode: 'approve',
        };
        const deps = createMockDeps({
          onUpdate,
          createProvider: vi.fn().mockImplementation(async () => new ThinkingTestProvider()),
        });
        const runner = new ConversationRunner(config, deps);
        const turnId = `turn_${randomUUID()}`;

        await runner.run({
          content: [{ type: 'text', text: 'Hello' }],
          abortController: new AbortController(),
          turnId,
          startedAt: new Date().toISOString(),
        });

        // Find thinking_delta updates - with throttling, rapid deltas get batched
        const thinkingDeltaCalls = onUpdate.mock.calls.filter(
          (call) => call[1]?.type === 'thinking_delta'
        );
        // Throttling batches rapid deltas together, so we get 1 combined event
        // (flushed when thinking_end is called)
        expect(thinkingDeltaCalls.length).toBeGreaterThanOrEqual(1);

        // Verify the combined text includes both parts
        const allDeltaText = thinkingDeltaCalls.map((call) => call[1]?.text).join('');
        expect(allDeltaText).toContain('Let me think about this...');
        expect(allDeltaText).toContain(' Considering the options...');

        // Verify turnId is included
        expect(thinkingDeltaCalls[0][1]).toEqual(
          expect.objectContaining({
            type: 'thinking_delta',
            turnId,
          })
        );
      });

      it('forwards thinking_end events via onUpdate with token count', async () => {
        const onUpdate = vi.fn().mockResolvedValue(undefined);
        const config: RunnerConfig = {
          sessionDir,
          sessionId: 'sess_test',
          cwd,
          executionMode: 'execute',
          approvalMode: 'approve',
        };
        const deps = createMockDeps({
          onUpdate,
          createProvider: vi.fn().mockImplementation(async () => new ThinkingTestProvider()),
        });
        const runner = new ConversationRunner(config, deps);
        const turnId = `turn_${randomUUID()}`;

        await runner.run({
          content: [{ type: 'text', text: 'Hello' }],
          abortController: new AbortController(),
          turnId,
          startedAt: new Date().toISOString(),
        });

        // Find the thinking_end update
        const thinkingEndCalls = onUpdate.mock.calls.filter(
          (call) => call[1]?.type === 'thinking_end'
        );
        expect(thinkingEndCalls.length).toBe(1);
        expect(thinkingEndCalls[0][1]).toEqual(
          expect.objectContaining({
            type: 'thinking_end',
            tokens: 42,
            turnId,
          })
        );
      });

      it('does not forward thinking events when aborted', async () => {
        const onUpdate = vi.fn().mockResolvedValue(undefined);
        const config: RunnerConfig = {
          sessionDir,
          sessionId: 'sess_test',
          cwd,
          executionMode: 'execute',
          approvalMode: 'approve',
        };

        // Create a provider that emits thinking events after abort
        class AbortedThinkingProvider extends AIProvider {
          get providerName(): string {
            return 'aborted-thinking-test';
          }

          getProviderInfo() {
            return {
              name: 'aborted-thinking-test',
              displayName: 'Aborted Thinking Test Provider',
              requiresApiKey: false,
            };
          }

          isConfigured(): boolean {
            return true;
          }

          get supportsStreaming(): boolean {
            return true;
          }

          async createResponse(
            messages: ProviderMessage[],
            tools: Tool[],
            model: string,
            signal?: AbortSignal
          ): Promise<ProviderResponse> {
            return this.createStreamingResponse(messages, tools, model, signal);
          }

          async createStreamingResponse(
            _messages: ProviderMessage[],
            _tools: Tool[],
            _model: string,
            signal?: AbortSignal
          ): Promise<ProviderResponse> {
            // Abort signal is already aborted, but emit events anyway
            // The runner should ignore them
            this.emit('thinking_start', {});
            this.emit('thinking_delta', { text: 'Should not see this' });
            this.emit('thinking_end', { tokens: 100 });

            if (signal?.aborted) {
              return { content: '', toolCalls: [], stopReason: 'error' };
            }

            return {
              content: 'response',
              toolCalls: [],
              stopReason: 'stop',
              usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
            };
          }
        }

        const abortController = new AbortController();
        abortController.abort(); // Abort before running

        const deps = createMockDeps({
          onUpdate,
          createProvider: vi.fn().mockImplementation(async () => new AbortedThinkingProvider()),
        });
        const runner = new ConversationRunner(config, deps);

        await runner.run({
          content: [{ type: 'text', text: 'Hello' }],
          abortController,
          turnId: `turn_${randomUUID()}`,
          startedAt: new Date().toISOString(),
        });

        // Should not have any thinking events since we were aborted
        const thinkingCalls = onUpdate.mock.calls.filter((call) =>
          ['thinking_start', 'thinking_delta', 'thinking_end'].includes(call[1]?.type)
        );
        expect(thinkingCalls.length).toBe(0);
      });
    });

    // Mock tool executor that recognizes bash and file_read tools
    function createToolAwareMockDeps(
      providerFactory: () => AIProvider,
      extraOverrides: Partial<RunnerDependencies> = {}
    ): RunnerDependencies {
      const mockTool = { name: 'mock', description: 'mock', schema: {} } as unknown as Tool;
      const mockToolExecutor = {
        getTool: vi.fn().mockImplementation((name: string) => {
          if (['bash', 'file_read', 'file_write'].includes(name)) return mockTool;
          return null;
        }),
        execute: vi.fn().mockResolvedValue({
          status: 'completed',
          content: [{ type: 'text', text: 'mock result' }],
        }),
      };
      return createMockDeps({
        createProvider: vi.fn().mockImplementation(async () => providerFactory()),
        createToolExecutor: vi.fn().mockReturnValue({
          executor: mockToolExecutor,
          toolsForProvider: [],
        }),
        ...extraOverrides,
      });
    }

    describe('bare text retry with tool_choice=required', () => {
      /**
       * Provider that returns bare text on first call, then a tool call when
       * tool_choice=required is set. Tracks whether options were passed.
       */
      class BareTextRetryProvider extends AIProvider {
        callCount = 0;
        lastOptions: RequestOptions | undefined;

        get providerName(): string {
          return 'bare-text-retry-test';
        }

        getProviderInfo() {
          return {
            name: 'bare-text-retry-test',
            displayName: 'Bare Text Retry Test',
            requiresApiKey: false,
          };
        }

        isConfigured(): boolean {
          return true;
        }

        get supportsStreaming(): boolean {
          return true;
        }

        async createResponse(
          messages: ProviderMessage[],
          tools: Tool[],
          model: string,
          signal?: AbortSignal,
          conversationState?: ConversationState,
          options?: RequestOptions
        ): Promise<ProviderResponse> {
          return this.createStreamingResponse(
            messages,
            tools,
            model,
            signal,
            conversationState,
            options
          );
        }

        async createStreamingResponse(
          _messages: ProviderMessage[],
          _tools: Tool[],
          _model: string,
          _signal?: AbortSignal,
          _conversationState?: ConversationState,
          options?: RequestOptions
        ): Promise<ProviderResponse> {
          this.callCount++;
          this.lastOptions = options;

          // First call: return a tool call (agent does some work)
          if (this.callCount === 1) {
            return {
              content: '',
              toolCalls: [{ id: 'tc_1', name: 'bash', arguments: { command: 'echo hello' } }],
              stopReason: 'tool_use',
              usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
            };
          }

          // Second call: bare text "Done" — triggers retry
          if (this.callCount === 2) {
            return {
              content: 'Done. Task complete.',
              toolCalls: [],
              stopReason: 'stop',
              usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
            };
          }

          // Third call (retry with tool_choice=required): return verification tool call
          if (this.callCount === 3) {
            return {
              content: '',
              toolCalls: [
                { id: 'tc_2', name: 'file_read', arguments: { path: '/app/output.txt' } },
              ],
              stopReason: 'tool_use',
              usage: { promptTokens: 120, completionTokens: 30, totalTokens: 150 },
            };
          }

          // Fourth call: done for real
          return {
            content: 'Verified.',
            toolCalls: [],
            stopReason: 'stop',
            usage: { promptTokens: 100, completionTokens: 5, totalTokens: 105 },
          };
        }
      }

      it('retries with tool_choice=required when model returns bare text', async () => {
        const provider = new BareTextRetryProvider();
        const onUpdate = vi.fn().mockResolvedValue(undefined);
        const config: RunnerConfig = {
          sessionDir,
          sessionId: 'sess_test',
          cwd,
          executionMode: 'execute',
          approvalMode: 'approve',
        };
        const deps = createToolAwareMockDeps(() => provider, { onUpdate });
        const runner = new ConversationRunner(config, deps);

        await runner.run({
          content: [{ type: 'text', text: 'Build the project' }],
          abortController: new AbortController(),
          turnId: `turn_${randomUUID()}`,
          startedAt: new Date().toISOString(),
        });

        // Should have made at least 3 calls:
        // 1. Initial tool call (bash echo hello)
        // 2. Bare text "Done" — triggers retry
        // 3. Retry with tool_choice=required → file_read
        expect(provider.callCount).toBeGreaterThanOrEqual(3);

        // The retry call should have had tool_choice=required
        // (callCount 3 is the retry — lastOptions captured there)
        // After call 3 returns a tool call, call 4 happens without tool_choice
        expect(provider.lastOptions).toBeUndefined(); // call 4 has no options
      });

      it('does not retry on max_tokens stop reason', async () => {
        let callCount = 0;
        class MaxTokensProvider extends AIProvider {
          get providerName(): string {
            return 'max-tokens-test';
          }
          getProviderInfo() {
            return { name: 'max-tokens-test', displayName: 'Max Tokens', requiresApiKey: false };
          }
          isConfigured(): boolean {
            return true;
          }
          get supportsStreaming(): boolean {
            return true;
          }
          async createResponse(
            messages: ProviderMessage[],
            tools: Tool[],
            model: string,
            signal?: AbortSignal,
            conversationState?: ConversationState,
            options?: RequestOptions
          ): Promise<ProviderResponse> {
            return this.createStreamingResponse(
              messages,
              tools,
              model,
              signal,
              conversationState,
              options
            );
          }
          async createStreamingResponse(
            _messages: ProviderMessage[],
            _tools: Tool[],
            _model: string,
            _signal?: AbortSignal,
            _conversationState?: ConversationState,
            _options?: RequestOptions
          ): Promise<ProviderResponse> {
            callCount++;
            if (callCount === 1) {
              return {
                content: '',
                toolCalls: [{ id: 'tc_1', name: 'bash', arguments: { command: 'ls' } }],
                stopReason: 'tool_use',
                usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
              };
            }
            // max_tokens stop — should NOT trigger retry
            return {
              content: 'partial output...',
              toolCalls: [],
              stopReason: 'max_tokens',
              usage: { promptTokens: 100, completionTokens: 4096, totalTokens: 4196 },
            };
          }
        }

        const onUpdate = vi.fn().mockResolvedValue(undefined);
        const config: RunnerConfig = {
          sessionDir,
          sessionId: 'sess_test',
          cwd,
          executionMode: 'execute',
          approvalMode: 'approve',
        };
        const deps = createToolAwareMockDeps(() => new MaxTokensProvider(), { onUpdate });
        const runner = new ConversationRunner(config, deps);

        const result = await runner.run({
          content: [{ type: 'text', text: 'Do something' }],
          abortController: new AbortController(),
          turnId: `turn_${randomUUID()}`,
          startedAt: new Date().toISOString(),
        });

        expect(result.stopReason).toBe('max_tokens');
        expect(callCount).toBe(2); // No retry
      });

      it('does not retry bare text on first turn (completedTurns === 0)', async () => {
        let callCount = 0;
        class FirstTurnBareTextProvider extends AIProvider {
          get providerName(): string {
            return 'first-turn-bare-text';
          }
          getProviderInfo() {
            return {
              name: 'first-turn-bare-text',
              displayName: 'First Turn',
              requiresApiKey: false,
            };
          }
          isConfigured(): boolean {
            return true;
          }
          get supportsStreaming(): boolean {
            return true;
          }
          async createResponse(
            messages: ProviderMessage[],
            tools: Tool[],
            model: string,
            signal?: AbortSignal,
            conversationState?: ConversationState,
            options?: RequestOptions
          ): Promise<ProviderResponse> {
            return this.createStreamingResponse(
              messages,
              tools,
              model,
              signal,
              conversationState,
              options
            );
          }
          async createStreamingResponse(
            _messages: ProviderMessage[],
            _tools: Tool[],
            _model: string,
            _signal?: AbortSignal,
            _conversationState?: ConversationState,
            _options?: RequestOptions
          ): Promise<ProviderResponse> {
            callCount++;
            // First turn bare text — should NOT retry (no work done yet)
            return {
              content: 'I can help with that!',
              toolCalls: [],
              stopReason: 'stop',
              usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
            };
          }
        }

        const onUpdate = vi.fn().mockResolvedValue(undefined);
        const config: RunnerConfig = {
          sessionDir,
          sessionId: 'sess_test',
          cwd,
          executionMode: 'execute',
          approvalMode: 'approve',
        };
        const deps = createToolAwareMockDeps(() => new FirstTurnBareTextProvider(), { onUpdate });
        const runner = new ConversationRunner(config, deps);

        const result = await runner.run({
          content: [{ type: 'text', text: 'Hello' }],
          abortController: new AbortController(),
          turnId: `turn_${randomUUID()}`,
          startedAt: new Date().toISOString(),
        });

        expect(result.stopReason).toBe('end_turn');
        expect(callCount).toBe(1); // No retry on first turn
      });
    });
  });
});
