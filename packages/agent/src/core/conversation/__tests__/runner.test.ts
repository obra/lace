// ABOUTME: Tests for ConversationRunner - the agentic loop for executing prompts

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationRunner } from '../runner';
import type { RunnerConfig, RunnerDependencies } from '../types';
import { TestAgentProvider } from '@lace/agent/runtime/test-provider';
import { AIProvider, type ProviderMessage, type ProviderResponse } from '@lace/agent/providers/base-provider';
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

      it('forwards thinking_delta events via onUpdate', async () => {
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

        // Find thinking_delta updates
        const thinkingDeltaCalls = onUpdate.mock.calls.filter(
          (call) => call[1]?.type === 'thinking_delta'
        );
        expect(thinkingDeltaCalls.length).toBe(2);
        expect(thinkingDeltaCalls[0][1]).toEqual(
          expect.objectContaining({
            type: 'thinking_delta',
            text: 'Let me think about this...',
            turnId,
          })
        );
        expect(thinkingDeltaCalls[1][1]).toEqual(
          expect.objectContaining({
            type: 'thinking_delta',
            text: ' Considering the options...',
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
  });
});
