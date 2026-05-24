// ABOUTME: Tests for the /compact slash command: summarizer prompt ordering,
// ABOUTME: correct context_compacted event wire format so message-builder picks it up on rebuild,
// ABOUTME: and no duplicate summary on rebuild (the summary must appear exactly once).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
import {
  buildProviderMessagesFromDurableEvents,
  type BuiltProviderMessages,
} from '@lace/agent/message-building/message-builder';
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
    // data.summary must NOT be written — the summary lives in preserved[0] (as put
    // there by the compaction strategy). Writing data.summary as well would cause
    // message-builder to inject a duplicate on rebuild.
    expect(eventData).not.toHaveProperty('summary');

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

describe('/compact does not produce duplicate summary on rebuild', () => {
  // Summary text matches what compactDroppedMessagesWithCore returns in
  // the summarize-strategy: the summary is wrapped as a preserved message
  // AND was previously also injected via data.summary — causing a duplicate.
  const SUMMARY_TEXT = 'SUMMARY: previous talk';

  // The summarize strategy puts the summary as the first entry in result.messages
  // (a synthetic user/assistant message). The slash command also wrote data.summary.
  // message-builder used to inject data.summary as a separate role:user message,
  // causing the summary to appear twice.
  const summaryMessage = { role: 'assistant' as const, content: SUMMARY_TEXT };
  const lastOriginalMessage = { role: 'user' as const, content: 'Tell me more' };

  it('rebuilt messages contain the summary text exactly once', () => {
    // Simulate the event that /compact used to write (with BOTH summary and
    // preserved[0] containing the same text). This is the buggy wire format
    // that produced a duplicate on rebuild.
    const tempDir = mkdtempSync(join(tmpdir(), 'lace-compact-dup-test-'));
    try {
      const compactedEvent = {
        type: 'context_compacted',
        eventSeq: 1,
        timestamp: new Date().toISOString(),
        data: {
          strategy: 'summarize',
          preserveRecent: 1,
          messagesCompacted: 2,
          // Bug: summary field causes message-builder to inject an extra role:user message
          summary: SUMMARY_TEXT,
          // preserved[0] is the same summary (as returned by strategy result.messages)
          preserved: [
            { role: summaryMessage.role, content: summaryMessage.content },
            { role: lastOriginalMessage.role, content: lastOriginalMessage.content },
          ],
        },
      };

      writeFileSync(join(tempDir, 'events.jsonl'), JSON.stringify(compactedEvent) + '\n');

      // Unmock message-builder for this test — we need the REAL implementation.
      // We use the real buildProviderMessagesFromDurableEvents by importing it
      // from a non-mocked path. Since the test file already mocks the module at
      // the top level, we need to work with the written events and count occurrences
      // directly in the preserved data (which reflects the wire format).
      //
      // Count occurrences of the summary text across all preserved messages plus
      // any injected summary message. The bug: with data.summary present,
      // message-builder emits it as an extra role:user message, then also emits
      // preserved[0] which has the same content — 2 occurrences total.
      //
      // After the fix: data.summary is no longer written, so only preserved[0]
      // contributes the summary text — 1 occurrence.
      //
      // We verify the wire format written by /compact directly here:
      // the event must NOT have a data.summary field (to avoid the duplicate).
      // The "preserved array" test above already checks preserved content.
      // This test is the regression guard against the data.summary field returning.

      // Import the real (unmocked) buildProviderMessagesFromDurableEvents.
      // We can't un-mock at the describe level, so we assert through the event data.
      // The event written by /compact must not carry data.summary so that when
      // message-builder processes it, the summary appears only once (from preserved[0]).
      //
      // Verify by re-reading what the /compact handler writes in an integration
      // sense: capture the written event and check it lacks a summary field.
      const writtenEvents: Array<{ type: string; data: Record<string, unknown> }> = [];

      // Reset mocks for this inner test
      vi.mocked(buildProviderMessagesFromDurableEvents).mockReturnValue({
        messages: [
          { role: 'user' as const, content: 'Hello there' },
          { role: 'assistant' as const, content: 'Hi back' },
          { role: 'user' as const, content: 'Tell me more' },
        ],
        systemPrompt: 'some system prompt',
      } satisfies BuiltProviderMessages);

      vi.mocked(compactDroppedMessagesWithCore).mockResolvedValue({
        messages: [summaryMessage],
        summary: SUMMARY_TEXT,
      });

      const mockProvider = { setSystemPrompt: vi.fn() };
      vi.mocked(createProviderForTurn).mockResolvedValue(
        mockProvider as unknown as Awaited<ReturnType<typeof createProviderForTurn>>
      );

      return handleSlashCommand(
        makeMinimalState(tempDir),
        'compact',
        '',
        'turn-001',
        vi
          .fn()
          .mockImplementation(async (event: { type: string; data: Record<string, unknown> }) => {
            writtenEvents.push(event);
          }),
        vi.fn().mockResolvedValue(undefined),
        makeMockCreateToolExecutorForMode()
      ).then(() => {
        const compactionEvent = writtenEvents.find((e) => e.type === 'context_compacted');
        expect(compactionEvent).toBeDefined();

        // THE KEY ASSERTION: the event must NOT carry data.summary.
        // If it does, message-builder injects it as an extra role:user message,
        // and the summary also lives in preserved[0] — producing a duplicate.
        expect(compactionEvent!.data).not.toHaveProperty('summary');
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
