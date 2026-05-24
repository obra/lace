// ABOUTME: Tests that /compact calls setSystemPrompt(SUMMARIZER_SYSTEM_PROMPT) on the
// ABOUTME: throwaway provider, preventing getEffectiveSystemPrompt warn-fallback noise.

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
import type { AgentServerState } from '@lace/agent/server-types';

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
      vi.fn().mockResolvedValue(undefined)
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
      vi.fn().mockResolvedValue(undefined)
    );

    expect(callOrder).toEqual(['setSystemPrompt', 'compact']);
  });
});
