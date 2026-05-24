// ABOUTME: Tests for the /compact slash command: summarizer prompt ordering and
// ABOUTME: correct context_compacted event wire format so message-builder picks it up on rebuild.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SUMMARIZER_SYSTEM_PROMPT } from '@lace/agent/compaction/summarize-strategy';

// Mock the provider factory so we can spy on setSystemPrompt without a real provider.
vi.mock('@lace/agent/providers/turn-factory', () => ({
  createProviderForTurn: vi.fn(),
}));

// Mock buildProviderMessagesFromDurableEvents to return enough messages to trigger compaction.
vi.mock('@lace/agent/message-building/message-builder', () => ({
  buildProviderMessagesFromDurableEvents: vi.fn(),
}));

// Mock compactDroppedMessagesWithCore so we don't need a real AI call.
vi.mock('@lace/agent/compaction/compact-dropped-messages', () => ({
  compactDroppedMessagesWithCore: vi.fn(),
}));

// Mock session-store to avoid real FS reads.
vi.mock('@lace/agent/storage/session-store', () => ({
  ensureSessionFiles: vi.fn(),
  getSessionDir: vi.fn(() => '/fake/session/dir'),
  loadSession: vi.fn(),
  readSessionState: vi.fn(() => ({ nextEventSeq: 0, nextStreamSeq: 0, config: {} })),
  writeSessionMeta: vi.fn(),
  writeSessionState: vi.fn(),
}));

// Mock getEffectiveConfig.
vi.mock('@lace/agent/core/session', () => ({
  getEffectiveConfig: vi.fn(() => ({
    connectionId: 'test-conn',
    modelId: 'test-model',
    executionMode: 'execute',
    approvalMode: 'ask',
  })),
}));

import { handleSlashCommand } from '../slash-commands';
import { createProviderForTurn } from '@lace/agent/providers/turn-factory';
import { buildProviderMessagesFromDurableEvents } from '@lace/agent/message-building/message-builder';
import { compactDroppedMessagesWithCore } from '@lace/agent/compaction/compact-dropped-messages';
import type { AgentServerState, CreateToolExecutorFn } from '@lace/agent/server-types';

function makeMockCreateToolExecutorForMode(): CreateToolExecutorFn {
  return vi
    .fn()
    .mockResolvedValue({ executor: {}, toolsForProvider: [] }) as unknown as CreateToolExecutorFn;
}

function makeMinimalState(sessionDir: string): AgentServerState {
  return {
    initialized: true,
    activeSession: {
      dir: sessionDir,
      meta: { sessionId: 'sess_test', workDir: '/fake/workdir', created: new Date().toISOString() },
      state: { nextEventSeq: 0, nextStreamSeq: 0, config: {} },
    },
    config: {
      executionMode: 'execute',
      approvalMode: 'ask',
      connectionId: 'test-conn',
      modelId: 'test-model',
    },
    activeTurn: null,
    providerCatalog: {} as AgentServerState['providerCatalog'],
    providerCatalogLoaded: false,
    providerInstances: {} as AgentServerState['providerInstances'],
    mcpServerManager: {} as AgentServerState['mcpServerManager'],
    jobManager: {} as AgentServerState['jobManager'],
    pendingPermissionRequests: new Map(),
    sessionMutex: Promise.resolve(),
    toolExecutorCache: new Map(),
    personaRegistry: {} as AgentServerState['personaRegistry'],
  } as unknown as AgentServerState;
}

describe('/compact slash command — summarizer prompt', () => {
  let tempDir: string;
  let setSystemPromptSpy: ReturnType<typeof vi.fn>;
  let mockProvider: { setSystemPrompt: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'lace-compact-cmd-test-'));

    setSystemPromptSpy = vi.fn();
    mockProvider = { setSystemPrompt: setSystemPromptSpy };

    vi.mocked(createProviderForTurn).mockResolvedValue(
      mockProvider as unknown as Awaited<ReturnType<typeof createProviderForTurn>>
    );

    // Return enough messages so we pass the "nothing to compact" guard
    vi.mocked(buildProviderMessagesFromDurableEvents).mockReturnValue({
      messages: [
        { role: 'user', content: 'Hello there' },
        { role: 'assistant', content: 'Hi back' },
        { role: 'user', content: 'Tell me more' },
      ],
      systemPrompt: 'some system prompt',
    });

    vi.mocked(compactDroppedMessagesWithCore).mockResolvedValue({
      messages: [],
      summary: 'A compact summary.',
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('calls setSystemPrompt(SUMMARIZER_SYSTEM_PROMPT) on the throwaway provider', async () => {
    const state = makeMinimalState(tempDir);

    await handleSlashCommand(
      state,
      'compact',
      '',
      'turn-001',
      vi.fn().mockResolvedValue(undefined),
      vi.fn().mockResolvedValue(undefined),
      makeMockCreateToolExecutorForMode()
    );

    expect(setSystemPromptSpy).toHaveBeenCalledWith(SUMMARIZER_SYSTEM_PROMPT);
  });

  it('calls setSystemPrompt before compactDroppedMessagesWithCore', async () => {
    const state = makeMinimalState(tempDir);
    const callOrder: string[] = [];

    setSystemPromptSpy.mockImplementation(() => {
      callOrder.push('setSystemPrompt');
    });
    vi.mocked(compactDroppedMessagesWithCore).mockImplementation(async () => {
      callOrder.push('compact');
      return { messages: [], summary: 'summary' };
    });

    await handleSlashCommand(
      state,
      'compact',
      '',
      'turn-001',
      vi.fn().mockResolvedValue(undefined),
      vi.fn().mockResolvedValue(undefined),
      makeMockCreateToolExecutorForMode()
    );

    expect(callOrder).toEqual(['setSystemPrompt', 'compact']);
  });
});

describe('/compact writes context_compacted event that message-builder recognises', () => {
  let tempDir: string;
  let mockProvider: { setSystemPrompt: ReturnType<typeof vi.fn> };

  // Three messages: first two are "dropped", last one is preserved as the most recent.
  const mockMessages = [
    { role: 'user' as const, content: 'Hello there' },
    { role: 'assistant' as const, content: 'Hi back' },
    { role: 'user' as const, content: 'Tell me more' },
  ];

  // The summarize strategy returns a single synthetic message containing the summary.
  const summaryMessage = { role: 'assistant' as const, content: 'SUMMARY: previous talk' };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'lace-compact-event-test-'));

    mockProvider = { setSystemPrompt: vi.fn() };
    vi.mocked(createProviderForTurn).mockResolvedValue(
      mockProvider as unknown as Awaited<ReturnType<typeof createProviderForTurn>>
    );

    vi.mocked(buildProviderMessagesFromDurableEvents).mockReturnValue({
      messages: mockMessages,
      systemPrompt: 'some system prompt',
    });

    vi.mocked(compactDroppedMessagesWithCore).mockResolvedValue({
      messages: [summaryMessage],
      summary: 'SUMMARY: previous talk',
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('written event has type "context_compacted" with required fields', async () => {
    const state = makeMinimalState(tempDir);
    const writtenEvents: Array<{ type: string; data: Record<string, unknown> }> = [];

    await handleSlashCommand(
      state,
      'compact',
      '',
      'turn-001',
      vi.fn().mockImplementation(async (event: { type: string; data: Record<string, unknown> }) => {
        writtenEvents.push(event);
      }),
      vi.fn().mockResolvedValue(undefined),
      makeMockCreateToolExecutorForMode()
    );

    const compactionEvents = writtenEvents.filter((e) => e.type === 'context_compacted');
    expect(compactionEvents).toHaveLength(1);

    const eventData = compactionEvents[0].data;
    expect(eventData.strategy).toBe('summarize');
    expect(Array.isArray(eventData.preserved)).toBe(true);
    expect(typeof eventData.summary).toBe('string');
    expect((eventData.summary as string).length).toBeGreaterThan(0);

    // No legacy 'compaction'-typed events — those are silently ignored by message-builder.
    expect(writtenEvents.find((e) => e.type === 'compaction')).toBeUndefined();
  });

  it('preserved array contains the compacted messages plus the last original message', async () => {
    const state = makeMinimalState(tempDir);
    const writtenEvents: Array<{ type: string; data: Record<string, unknown> }> = [];

    await handleSlashCommand(
      state,
      'compact',
      '',
      'turn-001',
      vi.fn().mockImplementation(async (event: { type: string; data: Record<string, unknown> }) => {
        writtenEvents.push(event);
      }),
      vi.fn().mockResolvedValue(undefined),
      makeMockCreateToolExecutorForMode()
    );

    const eventData = writtenEvents.find((e) => e.type === 'context_compacted')!.data;
    const preserved = eventData.preserved as Array<{ role: string; content: string }>;

    // Should be: [summaryMessage, lastOriginalMessage]
    expect(preserved).toHaveLength(2);
    expect(preserved[0].role).toBe(summaryMessage.role);
    expect(preserved[0].content).toBe(summaryMessage.content);
    // Last original message (the one NOT passed to `dropped`)
    expect(preserved[1].role).toBe(mockMessages[2].role);
    expect(preserved[1].content).toBe(mockMessages[2].content);
  });
});
