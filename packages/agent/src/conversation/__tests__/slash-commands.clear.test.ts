// ABOUTME: Tests that /clear writes a system_prompt_set event into the new session so
// ABOUTME: the runner's frozenSystemPrompt invariant is satisfied for the next prompt.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Walk the transcripts/<persona>/<date>/<sessionId>.jsonl tree to find the
 * (single) on-disk transcript for this session. The /clear handler creates a
 * new session and the runner writes events under the new persona/date layout.
 */
function readSessionEventsFromDisk(laceDir: string, sessionId: string): string[] {
  const root = join(laceDir, 'transcripts');
  if (!existsSync(root)) return [];
  for (const persona of readdirSync(root)) {
    const personaDir = join(root, persona);
    for (const date of readdirSync(personaDir)) {
      const candidate = join(personaDir, date, `${sessionId}.jsonl`);
      if (existsSync(candidate)) {
        return readFileSync(candidate, 'utf8').trim().split('\n').filter(Boolean);
      }
    }
  }
  return [];
}

// Mock loadPromptConfig to avoid real persona/skill loading.
vi.mock('@lace/agent/config/prompts', () => ({
  loadPromptConfig: vi.fn().mockResolvedValue({
    systemPrompt: 'mock system prompt',
    userInstructions: '',
  }),
}));

// Mock SkillRegistry and getSkillDirectories to avoid real skill discovery.
vi.mock('@lace/agent/skills', () => ({
  SkillRegistry: vi.fn().mockImplementation(() => ({})),
  getSkillDirectories: vi.fn().mockReturnValue([]),
}));

vi.mock('@lace/agent/core/session', () => ({
  getEffectiveConfig: vi.fn(() => ({
    connectionId: 'test-conn',
    modelId: 'test-model',
    executionMode: 'execute',
    approvalMode: 'ask',
  })),
}));

import { handleSlashCommand } from '../slash-commands';
import type { AgentServerState, CreateToolExecutorFn } from '@lace/agent/server-types';
import {
  ensureSessionFiles,
  getSessionDir,
  loadSession,
  writeSessionMeta,
  writeSessionState,
} from '@lace/agent/storage/session-store';
import { randomUUID } from 'node:crypto';

function makeMockCreateToolExecutorForMode(): CreateToolExecutorFn {
  return vi.fn().mockResolvedValue({
    executor: {},
    toolsForProvider: [],
  }) as unknown as CreateToolExecutorFn;
}

describe('/clear writes system_prompt_set in the new session', () => {
  let laceDir: string;
  let originalLaceDir: string | undefined;

  beforeEach(() => {
    laceDir = mkdtempSync(join(tmpdir(), 'lace-clear-cmd-test-'));
    originalLaceDir = process.env['LACE_DIR'];
    process.env['LACE_DIR'] = laceDir;
  });

  afterEach(() => {
    if (originalLaceDir !== undefined) {
      process.env['LACE_DIR'] = originalLaceDir;
    } else {
      delete process.env['LACE_DIR'];
    }
    rmSync(laceDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('new session has system_prompt_set as first event after /clear', async () => {
    // Create a source session so /clear has something to clear from.
    const sourceSessionId = `sess_${randomUUID()}`;
    const sourceSessionDir = getSessionDir(sourceSessionId);
    writeSessionMeta(sourceSessionDir, {
      sessionId: sourceSessionId,
      workDir: laceDir,
      created: new Date().toISOString(),
    });
    writeSessionState(sourceSessionDir, {
      nextEventSeq: 1,
      nextStreamSeq: 1,
      config: {
        executionMode: 'execute',
        approvalMode: 'ask',
        connectionId: 'test-conn',
        modelId: 'test-model',
        personaName: 'lace',
      },
    });
    ensureSessionFiles(sourceSessionDir);
    const sourceSession = loadSession(sourceSessionId);

    const state: AgentServerState = {
      initialized: true,
      activeSession: sourceSession,
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
      containerMounts: {},
      containerManager: null,
    } as unknown as AgentServerState;

    let capturedNewSessionId: string | null = null;
    const emitUpdate = vi.fn().mockImplementation(async (_seq: number, update: unknown) => {
      const u = update as { type: string; newSessionId?: string };
      if (u.type === 'session_changed' && u.newSessionId) {
        capturedNewSessionId = u.newSessionId;
      }
    });

    const result = await handleSlashCommand(
      state,
      'clear',
      '',
      'turn-001',
      vi.fn().mockResolvedValue(undefined),
      emitUpdate,
      makeMockCreateToolExecutorForMode()
    );

    expect(result).not.toBeNull();
    expect(result?.stopReason).toBe('end_turn');
    expect(capturedNewSessionId).not.toBeNull();

    // Verify the new session has a system_prompt_set event as first event.
    // Events are written under the persona/date transcript layout.
    const eventLines = readSessionEventsFromDisk(laceDir, capturedNewSessionId!);
    expect(eventLines.length).toBeGreaterThan(0);

    const events = eventLines.map((line) => JSON.parse(line) as { type: string });

    expect(events[0]?.type).toBe('system_prompt_set');
  });
});
