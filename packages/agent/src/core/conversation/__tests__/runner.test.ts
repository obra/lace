// ABOUTME: Tests for ConversationRunner - the agentic loop for executing prompts

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationRunner } from '../runner';
import type { RunnerConfig, RunnerDependencies } from '../types';
import { TestAgentProvider } from '@lace/agent/runtime/test-provider';
import { ToolExecutor } from '@lace/agent/tools/executor';
import { FileReadTool } from '@lace/agent/tools/implementations/file_read';
import { FileWriteTool } from '@lace/agent/tools/implementations/file_write';
import {
  AIProvider,
  type ProviderMessage,
  type ProviderResponse,
  type ConversationState,
  type RequestOptions,
} from '@lace/agent/providers/base-provider';
import type { Tool } from '@lace/agent/tools/tool';
import type { RuntimeExecutionBinding } from '@lace/agent/tools/runtime/types';

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

    it('tracks runtime file reads across equivalent path aliases', async () => {
      const targetFile = join(cwd, 'tracked.txt');
      writeFileSync(targetFile, 'old content');

      class RuntimeFileTrackingProvider extends AIProvider {
        callCount = 0;

        get providerName(): string {
          return 'runtime-file-tracking-test';
        }

        getProviderInfo() {
          return {
            name: 'runtime-file-tracking-test',
            displayName: 'Runtime File Tracking Test',
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

        async createStreamingResponse(): Promise<ProviderResponse> {
          this.callCount++;
          if (this.callCount === 1) {
            return {
              content: '',
              toolCalls: [{ id: 'tc_read', name: 'file_read', arguments: { path: 'tracked.txt' } }],
              stopReason: 'tool_use',
            };
          }

          return {
            content: '',
            toolCalls: [
              {
                id: 'tc_write',
                name: 'file_write',
                arguments: { path: './tracked.txt', content: 'new content' },
              },
            ],
            stopReason: 'tool_use',
          };
        }
      }

      const provider = new RuntimeFileTrackingProvider();
      const executor = new ToolExecutor();
      executor.registerTools([new FileReadTool(), new FileWriteTool()]);
      const config: RunnerConfig = {
        sessionDir,
        sessionId: 'sess_test',
        cwd,
        executionMode: 'execute',
        approvalMode: 'approve',
      };
      const deps = createMockDeps({
        createProvider: vi.fn().mockImplementation(async () => provider),
        createToolExecutor: vi.fn().mockReturnValue({
          executor,
          toolsForProvider: executor.getAllTools(),
        }),
      });
      const runner = new ConversationRunner(config, deps);

      await runner.run({
        content: [{ type: 'text', text: 'Read then update the tracked file.' }],
        abortController: new AbortController(),
        turnId: `turn_${randomUUID()}`,
        startedAt: new Date().toISOString(),
        maxTurns: 2,
      });

      expect(readFileSync(targetFile, 'utf8')).toBe('new content');
    });

    it('rehydrates file-read history against boundedHost runtime cwd', async () => {
      const runtimeCwd = join(tmpdir(), `lace-runner-runtime-cwd-${randomUUID().slice(0, 8)}`);
      mkdirSync(runtimeCwd, { recursive: true });
      const targetFile = join(runtimeCwd, 'tracked.txt');
      writeFileSync(targetFile, 'old content');
      writeFileSync(
        join(sessionDir, 'events.jsonl'),
        `${JSON.stringify({
          eventSeq: 1,
          timestamp: new Date().toISOString(),
          type: 'tool_use',
          data: {
            toolCallId: 'previous_read',
            name: 'file_read',
            input: { path: 'tracked.txt' },
            result: {
              outcome: 'completed',
              content: [{ type: 'text', text: 'old content' }],
            },
          },
        })}\n`
      );

      class RuntimeCwdWriteProvider extends AIProvider {
        get providerName(): string {
          return 'runtime-cwd-write-test';
        }

        getProviderInfo() {
          return {
            name: 'runtime-cwd-write-test',
            displayName: 'Runtime CWD Write Test',
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

        async createStreamingResponse(): Promise<ProviderResponse> {
          return {
            content: '',
            toolCalls: [
              {
                id: 'tc_write',
                name: 'file_write',
                arguments: { path: 'tracked.txt', content: 'new content' },
              },
            ],
            stopReason: 'tool_use',
          };
        }
      }

      try {
        const runtimeBinding: RuntimeExecutionBinding = {
          schemaVersion: 1,
          identity: { runtimeId: 'rt_custom_bounded_host' },
          agentPlacement: 'host',
          toolRuntime: { type: 'boundedHost', root: runtimeCwd, cwd: runtimeCwd },
        };
        const executor = new ToolExecutor();
        executor.registerTools([new FileWriteTool()]);
        const deps = createMockDeps({
          createProvider: vi.fn().mockImplementation(async () => new RuntimeCwdWriteProvider()),
          createToolExecutor: vi.fn().mockReturnValue({
            executor,
            toolsForProvider: executor.getAllTools(),
          }),
        });
        const runner = new ConversationRunner(
          {
            sessionDir,
            sessionId: 'sess_test',
            cwd,
            runtimeBinding,
            executionMode: 'execute',
            approvalMode: 'approve',
          },
          deps
        );

        await runner.run({
          content: [{ type: 'text', text: 'Update the tracked file.' }],
          abortController: new AbortController(),
          turnId: `turn_${randomUUID()}`,
          startedAt: new Date().toISOString(),
          maxTurns: 1,
        });

        expect(readFileSync(targetFile, 'utf8')).toBe('new content');
      } finally {
        rmSync(runtimeCwd, { recursive: true, force: true });
      }
    });

    it('executes tools through a boundedHost runtime binding', async () => {
      const boundedHostCwd = join(tmpdir(), `lace-runner-bounded-host-${randomUUID().slice(0, 8)}`);
      mkdirSync(boundedHostCwd, { recursive: true });

      class WorkspaceToolProvider extends AIProvider {
        get providerName(): string {
          return 'workspace-runtime-test';
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

        async createStreamingResponse(): Promise<ProviderResponse> {
          return {
            content: '',
            toolCalls: [{ id: 'tc_bounded_host', name: 'bash', arguments: { command: 'pwd' } }],
            stopReason: 'tool_use',
          };
        }
      }

      try {
        const runtimeBinding: RuntimeExecutionBinding = {
          schemaVersion: 1,
          identity: { runtimeId: 'rt_bounded_host_runner' },
          agentPlacement: 'host',
          toolRuntime: {
            type: 'boundedHost',
            root: boundedHostCwd,
            cwd: boundedHostCwd,
          },
        };
        const mockTool = { name: 'bash', description: 'mock bash', schema: {} } as unknown as Tool;
        const execute = vi.fn().mockResolvedValue({
          status: 'completed',
          content: [{ type: 'text', text: 'mock result' }],
        });
        const deps = createMockDeps({
          createProvider: vi.fn().mockImplementation(async () => new WorkspaceToolProvider()),
          createToolExecutor: vi.fn().mockReturnValue({
            executor: {
              getTool: vi.fn().mockReturnValue(mockTool),
              execute,
            },
            toolsForProvider: [mockTool],
          }),
        });
        const runner = new ConversationRunner(
          {
            sessionDir,
            sessionId: 'sess_test',
            cwd: boundedHostCwd,
            runtimeBinding,
            executionMode: 'execute',
            approvalMode: 'approve',
          },
          deps
        );

        await runner.run({
          content: [{ type: 'text', text: 'Run pwd.' }],
          abortController: new AbortController(),
          turnId: `turn_${randomUUID()}`,
          startedAt: new Date().toISOString(),
          maxTurns: 1,
        });

        expect(execute).toHaveBeenCalledOnce();
        expect(execute.mock.calls[0][1]).toMatchObject({
          runtime: {
            kind: 'boundedHost',
            id: 'rt_bounded_host_runner',
            cwd: boundedHostCwd,
          },
          runtimeBinding,
        });
      } finally {
        rmSync(boundedHostCwd, { recursive: true, force: true });
      }
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

    describe('conversation chaining', () => {
      /**
       * Provider that records conversationState on each call and returns a responseId.
       * Simulates a multi-turn conversation with tool calls.
       */
      class ChainingTrackingProvider extends AIProvider {
        callCount = 0;
        receivedStates: (ConversationState | undefined)[] = [];

        get providerName(): string {
          return 'chaining-tracking';
        }
        getProviderInfo() {
          return { name: 'chaining-tracking', displayName: 'Chaining', requiresApiKey: false };
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
          conversationState?: ConversationState,
          _options?: RequestOptions
        ): Promise<ProviderResponse> {
          this.callCount++;
          this.receivedStates.push(conversationState);

          // First call: return a tool call with responseId
          if (this.callCount === 1) {
            return {
              content: '',
              toolCalls: [{ id: 'tc_1', name: 'bash', arguments: { command: 'echo hello' } }],
              stopReason: 'tool_use',
              usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
              responseId: 'resp_first',
            };
          }

          // Second call: another tool call with a new responseId
          if (this.callCount === 2) {
            return {
              content: '',
              toolCalls: [{ id: 'tc_2', name: 'file_read', arguments: { path: '/tmp/out' } }],
              stopReason: 'tool_use',
              usage: { promptTokens: 100, completionTokens: 30, totalTokens: 130 },
              responseId: 'resp_second',
            };
          }

          // Third call: end with text (triggers bare text retry since completedTurns > 0)
          if (this.callCount === 3) {
            return {
              content: 'All done.',
              toolCalls: [],
              stopReason: 'stop',
              usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
              responseId: 'resp_third',
            };
          }

          // Fourth call (bare text retry with tool_choice=required): end for real
          return {
            content: 'Verified.',
            toolCalls: [],
            stopReason: 'stop',
            usage: { promptTokens: 100, completionTokens: 5, totalTokens: 105 },
            responseId: 'resp_fourth',
          };
        }
      }

      it('passes undefined conversationState on first call, then chains responseId', async () => {
        const provider = new ChainingTrackingProvider();
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
          content: [{ type: 'text', text: 'Do some work' }],
          abortController: new AbortController(),
          turnId: `turn_${randomUUID()}`,
          startedAt: new Date().toISOString(),
        });

        // 4 calls: tool call, tool call, bare text, bare text retry
        expect(provider.callCount).toBe(4);

        // First call: no conversation state
        expect(provider.receivedStates[0]).toBeUndefined();

        // Second call: should have the responseId from the first call
        expect(provider.receivedStates[1]).toEqual({ openaiResponseId: 'resp_first' });

        // Third call: should have the responseId from the second call
        expect(provider.receivedStates[2]).toEqual({ openaiResponseId: 'resp_second' });

        // Fourth call (bare text retry): should have the responseId from the third call
        expect(provider.receivedStates[3]).toEqual({ openaiResponseId: 'resp_third' });
      });

      it('handles provider returning no responseId gracefully', async () => {
        class NoResponseIdProvider extends AIProvider {
          callCount = 0;
          receivedStates: (ConversationState | undefined)[] = [];

          get providerName(): string {
            return 'no-response-id';
          }
          getProviderInfo() {
            return { name: 'no-response-id', displayName: 'No ID', requiresApiKey: false };
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
            conversationState?: ConversationState,
            _options?: RequestOptions
          ): Promise<ProviderResponse> {
            this.callCount++;
            this.receivedStates.push(conversationState);

            if (this.callCount === 1) {
              return {
                content: '',
                toolCalls: [{ id: 'tc_1', name: 'bash', arguments: { command: 'ls' } }],
                stopReason: 'tool_use',
                usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
                // No responseId — e.g. non-OpenAI provider
              };
            }
            // Subsequent calls: return a tool call so bare text retry doesn't interfere
            if (this.callCount === 2) {
              return {
                content: '',
                toolCalls: [{ id: 'tc_2', name: 'file_read', arguments: { path: '/tmp/x' } }],
                stopReason: 'tool_use',
                usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
              };
            }
            return {
              content: 'Done.',
              toolCalls: [],
              stopReason: 'stop',
              usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
            };
          }
        }

        const provider = new NoResponseIdProvider();
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
          content: [{ type: 'text', text: 'Do stuff' }],
          abortController: new AbortController(),
          turnId: `turn_${randomUUID()}`,
          startedAt: new Date().toISOString(),
        });

        // All calls should have undefined state (no responseId to chain)
        for (const state of provider.receivedStates) {
          expect(state).toBeUndefined();
        }
      });

      it('preserves chaining state through bare text retry', async () => {
        class ChainingRetryProvider extends AIProvider {
          callCount = 0;
          receivedStates: (ConversationState | undefined)[] = [];

          get providerName(): string {
            return 'chaining-retry';
          }
          getProviderInfo() {
            return { name: 'chaining-retry', displayName: 'Chain Retry', requiresApiKey: false };
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
            conversationState?: ConversationState,
            _options?: RequestOptions
          ): Promise<ProviderResponse> {
            this.callCount++;
            this.receivedStates.push(conversationState);

            // First call: tool call
            if (this.callCount === 1) {
              return {
                content: '',
                toolCalls: [{ id: 'tc_1', name: 'bash', arguments: { command: 'echo hi' } }],
                stopReason: 'tool_use',
                usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
                responseId: 'resp_work',
              };
            }

            // Second call: bare text (triggers retry)
            if (this.callCount === 2) {
              return {
                content: 'Done!',
                toolCalls: [],
                stopReason: 'stop',
                usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
                responseId: 'resp_bare',
              };
            }

            // Third call: retry with tool_choice=required
            if (this.callCount === 3) {
              return {
                content: '',
                toolCalls: [{ id: 'tc_2', name: 'file_read', arguments: { path: '/tmp/x' } }],
                stopReason: 'tool_use',
                usage: { promptTokens: 120, completionTokens: 30, totalTokens: 150 },
                responseId: 'resp_retry',
              };
            }

            // Fourth call: final
            return {
              content: 'Verified.',
              toolCalls: [],
              stopReason: 'stop',
              usage: { promptTokens: 100, completionTokens: 5, totalTokens: 105 },
              responseId: 'resp_final',
            };
          }
        }

        const provider = new ChainingRetryProvider();
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
          content: [{ type: 'text', text: 'Build it' }],
          abortController: new AbortController(),
          turnId: `turn_${randomUUID()}`,
          startedAt: new Date().toISOString(),
        });

        expect(provider.callCount).toBeGreaterThanOrEqual(3);

        // First call: no state
        expect(provider.receivedStates[0]).toBeUndefined();

        // Second call: chained from first
        expect(provider.receivedStates[1]).toEqual({ openaiResponseId: 'resp_work' });

        // Third call (retry): chained from second (bare text response still has responseId)
        expect(provider.receivedStates[2]).toEqual({ openaiResponseId: 'resp_bare' });
      });
    });

    describe('bash(background=true) — operator opt-in progress (PRI-1707)', () => {
      class BashBackgroundProvider extends AIProvider {
        callCount = 0;
        constructor(private readonly toolArgs: Record<string, unknown>) {
          super();
        }
        get providerName(): string {
          return 'bash-bg';
        }
        getProviderInfo() {
          return { name: 'bash-bg', displayName: 'BashBg', requiresApiKey: false };
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
        async createStreamingResponse(): Promise<ProviderResponse> {
          this.callCount++;
          // First call: emit the bash background tool call. Subsequent
          // calls: stop, so the runner doesn't loop. We don't need the
          // tool_result round-trip; this is purely about verifying the
          // runner's startShellJob args.
          if (this.callCount === 1) {
            return await Promise.resolve({
              content: '',
              toolCalls: [{ id: 'tc_bg_1', name: 'bash', arguments: this.toolArgs }],
              stopReason: 'tool_use',
              usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
            });
          }
          return await Promise.resolve({
            content: 'done',
            toolCalls: [],
            stopReason: 'stop',
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          });
        }
      }

      it('forwards operator-supplied progressIntervalMs to startShellJob', async () => {
        const startShellJob = vi.fn().mockResolvedValue({ jobId: 'job_test' });
        const provider = new BashBackgroundProvider({
          command: 'sleep 60',
          background: true,
          progressIntervalMs: 30000,
        });
        const config: RunnerConfig = {
          sessionDir,
          sessionId: 'sess_test',
          cwd,
          executionMode: 'execute',
          approvalMode: 'approve',
        };
        const deps = createToolAwareMockDeps(() => provider, { startShellJob });
        const runner = new ConversationRunner(config, deps);

        await runner.run({
          content: [{ type: 'text', text: 'Run a background job' }],
          abortController: new AbortController(),
          turnId: `turn_${randomUUID()}`,
          startedAt: new Date().toISOString(),
        });

        expect(startShellJob).toHaveBeenCalledOnce();
        expect(startShellJob.mock.calls[0][0]).toMatchObject({
          command: 'sleep 60',
          progressIntervalMs: 30000,
        });
      });

      it('omits progressIntervalMs from startShellJob when the model did not set it', async () => {
        const startShellJob = vi.fn().mockResolvedValue({ jobId: 'job_test' });
        const provider = new BashBackgroundProvider({
          command: 'sleep 60',
          background: true,
        });
        const config: RunnerConfig = {
          sessionDir,
          sessionId: 'sess_test',
          cwd,
          executionMode: 'execute',
          approvalMode: 'approve',
        };
        const deps = createToolAwareMockDeps(() => provider, { startShellJob });
        const runner = new ConversationRunner(config, deps);

        await runner.run({
          content: [{ type: 'text', text: 'Run a background job' }],
          abortController: new AbortController(),
          turnId: `turn_${randomUUID()}`,
          startedAt: new Date().toISOString(),
        });

        expect(startShellJob).toHaveBeenCalledOnce();
        const arg = startShellJob.mock.calls[0][0] as Record<string, unknown>;
        expect(arg.progressIntervalMs).toBeUndefined();
      });

      it.each([
        ['below minimum', 4999],
        ['above maximum', 600001],
        ['non-integer', 5000.5],
      ])(
        'rejects %s progressIntervalMs before starting a background job',
        async (_label, value) => {
          const startShellJob = vi.fn().mockResolvedValue({ jobId: 'job_test' });
          const onUpdate = vi.fn().mockResolvedValue(undefined);
          const provider = new BashBackgroundProvider({
            command: 'sleep 60',
            background: true,
            progressIntervalMs: value,
          });
          const config: RunnerConfig = {
            sessionDir,
            sessionId: 'sess_test',
            cwd,
            executionMode: 'execute',
            approvalMode: 'approve',
          };
          const deps = createToolAwareMockDeps(() => provider, { startShellJob, onUpdate });
          const runner = new ConversationRunner(config, deps);

          await runner.run({
            content: [{ type: 'text', text: 'Run a background job' }],
            abortController: new AbortController(),
            turnId: `turn_${randomUUID()}`,
            startedAt: new Date().toISOString(),
          });

          expect(startShellJob).not.toHaveBeenCalled();
          const failedUpdate = onUpdate.mock.calls.find(
            ([_turnSeq, update]) => update.type === 'tool_use' && update.status === 'failed'
          )?.[1];
          expect(failedUpdate).toBeDefined();
          expect(failedUpdate?.result?.content[0]?.message).toContain('progressIntervalMs');
        }
      );
    });

    describe('empty assistant turn not persisted (Fix #2)', () => {
      /**
       * Provider that returns an empty response on turn 1, then stops.
       * Simulates a model that produces no text and no tool calls on first turn.
       */
      class EmptyTurnProvider extends AIProvider {
        callCount = 0;

        get providerName(): string {
          return 'empty-turn';
        }

        getProviderInfo() {
          return { name: 'empty-turn', displayName: 'Empty Turn', requiresApiKey: false };
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

        async createStreamingResponse(): Promise<ProviderResponse> {
          this.callCount++;
          // Always return an empty response — no text, no tool calls
          return { content: '', toolCalls: [], stopReason: 'end_turn' };
        }
      }

      it('does not write a message event for an empty assistant turn', async () => {
        const provider = new EmptyTurnProvider();
        const config: RunnerConfig = {
          sessionDir,
          sessionId: 'sess_test',
          cwd,
          executionMode: 'execute',
          approvalMode: 'approve',
        };
        const deps = createMockDeps({
          createProvider: vi.fn().mockImplementation(async () => provider),
        });
        const runner = new ConversationRunner(config, deps);

        await runner.run({
          content: [{ type: 'text', text: 'Hello' }],
          abortController: new AbortController(),
          turnId: `turn_${randomUUID()}`,
          startedAt: new Date().toISOString(),
        });

        const eventsPath = join(sessionDir, 'events.jsonl');
        const eventsRaw = readFileSync(eventsPath, 'utf8');
        const events = eventsRaw
          .split('\n')
          .filter((line) => line.trim())
          .map((line) => JSON.parse(line) as { type: string; data: { content?: unknown } });

        // There must be NO message event with empty content.
        // An empty-content message event would produce a {role:'assistant', content:''}
        // when rebuilt, causing consecutive user/user messages after the format-converter
        // drops the empty assistant turn — which the Anthropic API rejects.
        const emptyMessageEvents = events.filter(
          (e) =>
            e.type === 'message' &&
            Array.isArray(e.data.content) &&
            (e.data.content as unknown[]).length === 0
        );
        expect(emptyMessageEvents).toHaveLength(0);
      });
    });
  });
});
