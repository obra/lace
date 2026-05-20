// ABOUTME: Session operation RPC handlers for configuration, compaction, checkpoints, and event management

import { randomUUID } from 'node:crypto';
import {
  AcpErrorCodes,
  EntErrorCodes,
  type JsonRpcPeer,
  type ContextBreakdown,
  type ThreadTokenUsage,
} from '@lace/ent-protocol';
import {
  readSessionState,
  writeSessionState,
  loadSession,
  type SessionState,
} from '../../storage/session-store';
import { appendDurableEvent, readDurableEvents } from '../../storage/event-log';
import {
  writeCheckpoint,
  findCheckpointByEventSeq,
  restoreCheckpointFiles,
} from '../../storage/checkpoint-store';
import { deriveCheckpointFilesFromDurableEvents } from '../../storage/files-from-events';
import type { ProviderMessage, ContentBlock } from '../../providers/base-provider';
import { estimateTokens } from '@lace/agent/utils/token-estimation';
import type { AgentServerState, CreateToolExecutorFn } from '../../server-types';
import type { Tool } from '../../tools/tool';
import {
  assertInitialized,
  throwInvalidParams,
  toNonEmptyString,
  recordsShallowEqual,
} from '../utils';
import { assertActiveSession, assertSessionReady } from '../helpers/session-guards';
import {
  buildProviderMessagesFromDurableEvents,
  estimateProviderTokens,
} from '../../message-building/message-builder';
import { compactDroppedMessagesWithCore } from '../../compaction/compact-dropped-messages';
import { createProviderForTurn } from '../../providers/turn-factory';
import { getEffectiveConfig } from '@lace/agent/core/session';
import { buildSessionConfigOptions, isApprovalMode } from '../session-config';

/**
 * Compute context breakdown for the active session
 */
async function computeContextBreakdownForActiveSession(
  state: AgentServerState,
  createToolExecutorForMode: CreateToolExecutorFn
): Promise<{
  breakdown: ContextBreakdown;
  tokenUsage: ThreadTokenUsage;
}> {
  const DEFAULT_CONTEXT_LIMIT = 200_000;
  const RESERVED_FOR_RESPONSE_TOKENS = 4096;

  const effectiveConfig = getEffectiveConfig(state.config, state.activeSession?.state.config);

  const _connectionId = effectiveConfig.connectionId;
  const modelId = effectiveConfig.modelId ?? 'unknown-model';

  const providerMessages = buildProviderMessagesFromDurableEvents(state.activeSession!.dir);

  let systemPromptTokens = 0;
  let userTokens = 0;
  let assistantTokens = 0;
  let toolCallTokens = 0;
  let toolResultTokens = 0;

  for (const message of providerMessages) {
    const contentText =
      typeof message.content === 'string'
        ? message.content
        : message.content
            .filter((b: unknown): b is ContentBlock & { type: 'text' } => {
              return (b as ContentBlock).type === 'text';
            })
            .map((b: ContentBlock & { type: 'text' }) => b.text)
            .join('\n');
    if (message.role === 'system') systemPromptTokens += estimateTokens(contentText);
    if (message.role === 'user') userTokens += estimateTokens(contentText);
    if (message.role === 'assistant') assistantTokens += estimateTokens(contentText);

    if (message.toolCalls) {
      toolCallTokens += estimateTokens(JSON.stringify(message.toolCalls));
    }
    if (message.toolResults) {
      toolResultTokens += estimateTokens(JSON.stringify(message.toolResults));
    }
  }

  const { executor: coreExecutor } = await createToolExecutorForMode('execute');
  const { executor: allExecutor } = await createToolExecutorForMode(
    'execute',
    state.mcpServerManager
  );

  const coreTools = coreExecutor.getAllTools();
  const coreToolNames = new Set(coreTools.map((t: Tool) => t.name));
  const allTools = allExecutor.getAllTools();

  const coreToolItems: Array<{ name: string; tokens: number }> = [];
  const mcpToolItems: Array<{ name: string; tokens: number }> = [];
  let coreToolsTokens = 0;
  let mcpToolsTokens = 0;

  for (const tool of coreTools) {
    const schema = {
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    };
    const tokens = estimateTokens(JSON.stringify(schema));
    coreToolItems.push({ name: tool.name, tokens });
    coreToolsTokens += tokens;
  }

  for (const tool of allTools) {
    if (coreToolNames.has(tool.name)) continue;
    const schema = {
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    };
    const tokens = estimateTokens(JSON.stringify(schema));
    mcpToolItems.push({ name: tool.name, tokens });
    mcpToolsTokens += tokens;
  }

  const messagesTokens = userTokens + assistantTokens + toolCallTokens + toolResultTokens;
  const totalUsedTokens = systemPromptTokens + coreToolsTokens + mcpToolsTokens + messagesTokens;

  const contextLimit = DEFAULT_CONTEXT_LIMIT;

  const percentUsed = contextLimit > 0 ? totalUsedTokens / contextLimit : 0;
  const freeTokens = contextLimit - totalUsedTokens - RESERVED_FOR_RESPONSE_TOKENS;

  const breakdown: ContextBreakdown = {
    timestamp: new Date().toISOString(),
    modelId,
    contextLimit,
    totalUsedTokens,
    percentUsed,
    categories: {
      systemPrompt: { tokens: systemPromptTokens },
      coreTools: {
        tokens: coreToolsTokens,
        ...(coreToolItems.length > 0 ? { items: coreToolItems } : {}),
      },
      mcpTools: {
        tokens: mcpToolsTokens,
        ...(mcpToolItems.length > 0 ? { items: mcpToolItems } : {}),
      },
      messages: {
        tokens: messagesTokens,
        subcategories: {
          userMessages: { tokens: userTokens },
          agentMessages: { tokens: assistantTokens },
          toolCalls: { tokens: toolCallTokens },
          toolResults: { tokens: toolResultTokens },
        },
      },
      reservedForResponse: { tokens: RESERVED_FOR_RESPONSE_TOKENS },
      freeSpace: { tokens: Math.max(0, freeTokens) },
    },
  };

  const tokenUsage: ThreadTokenUsage = {
    totalPromptTokens:
      systemPromptTokens +
      coreToolsTokens +
      mcpToolsTokens +
      userTokens +
      toolCallTokens +
      toolResultTokens,
    totalCompletionTokens: assistantTokens,
    totalTokens: totalUsedTokens,
    contextLimit,
    percentUsed,
    nearLimit: percentUsed >= 0.8,
  };

  return { breakdown, tokenUsage };
}

/**
 * Register session operation handlers with the peer.
 * - ent/session/configure: Configure Ent-owned session settings (connection, runtime limits, etc.)
 * - ent/session/compact: Compact conversation history using various strategies
 * - ent/session/checkpoint: Create a checkpoint of the current session state
 * - ent/session/rewind: Rewind to a previous checkpoint
 * - ent/session/inject: Inject context into the session
 * - ent/session/events: Get session events
 * - ent/session/token_usage: Get token usage statistics
 * - ent/session/context_breakdown: Get detailed context breakdown
 */
export function registerSessionOperationHandlers(
  peer: JsonRpcPeer,
  state: AgentServerState,
  runExclusive: <T>(work: () => Promise<T> | T) => Promise<T>,
  createToolExecutorForMode: CreateToolExecutorFn
): void {
  peer.onRequest('ent/session/configure', async (params: unknown) => {
    assertActiveSession(state);

    if (params !== undefined && (!params || typeof params !== 'object' || Array.isArray(params))) {
      throwInvalidParams('params must be an object');
    }
    const rawParams = (params ?? {}) as Record<string, unknown>;
    if (rawParams.cwd !== undefined) {
      throwInvalidParams('cwd must be provided via session/new, session/load, or session/resume');
    }
    if (rawParams.mcpServers !== undefined) {
      throwInvalidParams(
        'mcpServers must be provided via session/new, session/load, or session/resume'
      );
    }
    if (rawParams.modelId !== undefined) {
      throwInvalidParams('modelId must be provided via session/set_config_option');
    }
    if (rawParams.approvalMode !== undefined) {
      throwInvalidParams('approvalMode must be provided via session/set_config_option');
    }

    const parsed = rawParams as Partial<{
      connectionId: string;
      maxThinkingTokens: number;
      maxBudgetUsd: number;
      environment: Record<string, string>;
    }>;

    return await runExclusive(() => {
      assertActiveSession(state);

      const currentState = readSessionState(state.activeSession!.dir);
      const currentConfig = currentState.config || {};
      const effectiveBefore = getEffectiveConfig(state.config, currentConfig);
      const nextConfig = { ...currentConfig };
      const applied: string[] = [];

      if (
        typeof parsed.connectionId === 'string' &&
        parsed.connectionId !== effectiveBefore.connectionId
      ) {
        nextConfig.connectionId = parsed.connectionId;
        applied.push('connectionId');
      }

      if (
        typeof parsed.maxThinkingTokens === 'number' &&
        parsed.maxThinkingTokens !== effectiveBefore.maxThinkingTokens
      ) {
        nextConfig.maxThinkingTokens = parsed.maxThinkingTokens;
        applied.push('maxThinkingTokens');
      }

      if (
        typeof parsed.maxBudgetUsd === 'number' &&
        parsed.maxBudgetUsd !== effectiveBefore.maxBudgetUsd
      ) {
        nextConfig.maxBudgetUsd = parsed.maxBudgetUsd;
        applied.push('maxBudgetUsd');
      }

      if (parsed.environment !== undefined) {
        if (
          !parsed.environment ||
          typeof parsed.environment !== 'object' ||
          Array.isArray(parsed.environment)
        ) {
          throwInvalidParams('environment must be an object of string:string');
        }
        const envObj: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed.environment as Record<string, unknown>)) {
          if (typeof v !== 'string') throwInvalidParams('environment values must be strings');
          envObj[k] = v;
        }

        const currentEnv =
          (currentConfig as { environment?: Record<string, string> })?.environment || undefined;
        if (!recordsShallowEqual(envObj, currentEnv)) {
          nextConfig.environment = envObj;
          applied.push('environment');
        }
      }

      const nextState: SessionState = { ...currentState, config: nextConfig };
      writeSessionState(state.activeSession!.dir, nextState);
      state.activeSession = { ...state.activeSession!, state: nextState };

      const effectiveAfter = getEffectiveConfig(state.config, state.activeSession.state.config);

      return {
        applied,
        config: {
          executionMode: effectiveAfter.executionMode,
          connectionId: effectiveAfter.connectionId,
          modelId: effectiveAfter.modelId,
          maxThinkingTokens: effectiveAfter.maxThinkingTokens,
          maxBudgetUsd: effectiveAfter.maxBudgetUsd,
          approvalMode: effectiveAfter.approvalMode,
          environment: state.activeSession.state.config?.environment,
        },
      };
    });
  });

  peer.onRequest('session/set_config_option', async (params: unknown) => {
    assertSessionReady(state);

    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      throwInvalidParams('params must be an object');
    }
    const parsed = params as Partial<{ sessionId: string; configId: string; value: string }>;
    if (!parsed.sessionId) throwInvalidParams('sessionId is required');
    if (!parsed.configId) throwInvalidParams('configId is required');
    if (typeof parsed.value !== 'string' || parsed.value.length === 0) {
      throwInvalidParams('value is required');
    }

    return await runExclusive(() => {
      assertSessionReady(state);
      if (parsed.sessionId !== state.activeSession!.meta.sessionId) {
        throw {
          code: AcpErrorCodes.SessionNotFound,
          message: 'SessionNotFound',
          data: { category: 'session' },
        };
      }

      const currentState = readSessionState(state.activeSession!.dir);
      const currentConfig = currentState.config || {};
      const nextConfig = { ...currentConfig };

      if (parsed.configId === 'model') {
        nextConfig.modelId = parsed.value;
      } else if (parsed.configId === 'approvalMode') {
        if (!isApprovalMode(parsed.value)) {
          throwInvalidParams(
            'approvalMode must be one of ask|approveReads|approveEdits|approve|deny|dangerouslySkipPermissions'
          );
        }
        nextConfig.approvalMode = parsed.value;
      } else {
        throwInvalidParams(`Unknown configId: ${parsed.configId}`);
      }

      const nextState: SessionState = { ...currentState, config: nextConfig };
      writeSessionState(state.activeSession!.dir, nextState);
      state.activeSession = { ...state.activeSession!, state: nextState };

      return {
        configOptions: buildSessionConfigOptions(state.config, nextState.config),
      };
    });
  });

  peer.onRequest('ent/session/compact', async (params: unknown) => {
    assertSessionReady(state);

    const parsed = params as
      | {
          strategy?: 'summarize' | 'truncate' | 'selective';
          targetTokens?: number;
          preserveRecent?: number;
        }
      | undefined;

    if (
      parsed?.strategy &&
      parsed.strategy !== 'summarize' &&
      parsed.strategy !== 'truncate' &&
      parsed.strategy !== 'selective'
    ) {
      throwInvalidParams('strategy must be summarize|truncate|selective');
    }

    const strategy =
      parsed?.strategy === 'summarize' ||
      parsed?.strategy === 'truncate' ||
      parsed?.strategy === 'selective'
        ? parsed.strategy
        : 'truncate';

    const targetTokens =
      typeof parsed?.targetTokens === 'number' &&
      Number.isFinite(parsed.targetTokens) &&
      parsed.targetTokens > 0
        ? Math.trunc(parsed.targetTokens)
        : undefined;

    let preserveRecent =
      typeof parsed?.preserveRecent === 'number' &&
      Number.isFinite(parsed.preserveRecent) &&
      parsed.preserveRecent >= 0
        ? Math.trunc(parsed.preserveRecent)
        : 10;

    return await runExclusive(async () => {
      const beforeMessages = buildProviderMessagesFromDurableEvents(state.activeSession!.dir);
      const previousTokens = estimateProviderTokens(beforeMessages);

      const sessionStateForConfig = readSessionState(state.activeSession!.dir);
      const effectiveConfig = getEffectiveConfig(state.config, sessionStateForConfig.config);

      if (targetTokens !== undefined) {
        while (
          preserveRecent > 0 &&
          estimateProviderTokens(beforeMessages.slice(-preserveRecent)) > targetTokens
        ) {
          preserveRecent -= 1;
        }
      }

      const preservedRecentMessages =
        preserveRecent > 0 ? beforeMessages.slice(-preserveRecent) : [];
      const dropped = beforeMessages.slice(
        0,
        beforeMessages.length - preservedRecentMessages.length
      );

      let compactedDroppedMessages: ProviderMessage[] = [];
      let summary: string | undefined;

      if (dropped.length > 0) {
        if (strategy === 'truncate') {
          const result = await compactDroppedMessagesWithCore({
            strategyId: 'trim-tool-results',
            dropped,
            threadId: state.activeSession!.meta.sessionId,
          });
          compactedDroppedMessages = result.messages;
        } else {
          const provider = await createProviderForTurn({
            connectionId: effectiveConfig.connectionId,
            modelId: effectiveConfig.modelId,
          });

          const result = await compactDroppedMessagesWithCore({
            strategyId: 'summarize',
            dropped,
            provider,
            modelId: effectiveConfig.modelId || 'unknown-model',
            threadId: state.activeSession!.meta.sessionId,
          });
          compactedDroppedMessages = result.messages;
          summary = result.summary;
        }
      }

      const nextProviderMessages: ProviderMessage[] = [
        ...compactedDroppedMessages,
        ...preservedRecentMessages,
      ];

      let _removedForBudget = 0;
      let currentTokens = estimateProviderTokens(nextProviderMessages);
      if (targetTokens !== undefined) {
        while (nextProviderMessages.length > 0 && currentTokens > targetTokens) {
          nextProviderMessages.shift();
          _removedForBudget += 1;
          currentTokens = estimateProviderTokens(nextProviderMessages);
        }
      }

      const messagesCompacted = dropped.length;

      const serializedPreserved = nextProviderMessages.map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : '',
        ...(Array.isArray(m.toolCalls) ? { toolCalls: m.toolCalls } : {}),
        ...(Array.isArray(m.toolResults) ? { toolResults: m.toolResults } : {}),
      }));

      let sessionState = readSessionState(state.activeSession!.dir);
      const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, {
        type: 'context_compacted',
        data: {
          strategy,
          ...(targetTokens !== undefined ? { targetTokens } : {}),
          preserveRecent,
          messagesCompacted,
          preserved: serializedPreserved,
        },
      });
      sessionState = nextState;
      writeSessionState(state.activeSession!.dir, sessionState);
      state.activeSession = loadSession(state.activeSession!.meta.sessionId);

      return {
        previousTokens,
        currentTokens,
        messagesCompacted,
        ...(strategy === 'summarize' && typeof summary === 'string' && summary.trim().length > 0
          ? { summary }
          : {}),
      };
    });
  });

  peer.onRequest('ent/session/checkpoint', async (params: unknown) => {
    assertInitialized(state);
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };
    if (state.activeTurn)
      throw {
        code: AcpErrorCodes.SessionBusy,
        message: 'SessionBusy',
        data: { category: 'session' },
      };

    const parsed = params as { label?: string } | undefined;
    const label = toNonEmptyString(parsed?.label) ?? undefined;

    return await runExclusive(() => {
      const checkpointId = `chk_${randomUUID()}`;

      let sessionState = readSessionState(state.activeSession!.dir);
      const { nextState, written } = appendDurableEvent(state.activeSession!.dir, sessionState, {
        type: 'checkpoint_created',
        data: { checkpointId, ...(label ? { label } : {}) },
      });
      sessionState = nextState;
      writeSessionState(state.activeSession!.dir, sessionState);
      state.activeSession = loadSession(state.activeSession!.meta.sessionId);

      const workDir = state.activeSession.meta.workDir;
      const files = deriveCheckpointFilesFromDurableEvents(state.activeSession.dir, workDir);
      const meta = writeCheckpoint(state.activeSession.dir, {
        workDir,
        checkpointId,
        eventSeq: written.eventSeq,
        label,
        files,
      });

      return { checkpointId: meta.checkpointId, eventSeq: meta.eventSeq, files: meta.files };
    });
  });

  peer.onRequest('ent/session/rewind', async (params: unknown) => {
    assertInitialized(state);
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };
    if (state.activeTurn)
      throw {
        code: AcpErrorCodes.SessionBusy,
        message: 'SessionBusy',
        data: { category: 'session' },
      };

    const parsed = params as { toEventSeq: number };
    const toEventSeq =
      typeof parsed?.toEventSeq === 'number' && Number.isFinite(parsed.toEventSeq)
        ? Math.trunc(parsed.toEventSeq)
        : null;
    if (toEventSeq === null || toEventSeq < 0)
      throw { code: -32602, message: 'InvalidParams', data: { category: 'protocol' } };

    return await runExclusive(() => {
      const sessionState = readSessionState(state.activeSession!.dir);
      const currentEventSeq = sessionState.nextEventSeq - 1;
      if (toEventSeq > currentEventSeq)
        throw { code: -32602, message: 'InvalidParams', data: { category: 'protocol' } };

      const checkpoint = findCheckpointByEventSeq(state.activeSession!.dir, toEventSeq);
      if (!checkpoint) {
        throw {
          code: EntErrorCodes.CheckpointNotFound,
          message: 'CheckpointNotFound',
          data: { category: 'session' },
        };
      }

      const workDir = state.activeSession!.meta.workDir;
      const { filesRestored } = restoreCheckpointFiles(state.activeSession!.dir, {
        workDir,
        checkpointId: checkpoint.checkpointId,
      });

      const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, {
        type: 'files_rewound',
        data: { checkpointId: checkpoint.checkpointId, toEventSeq, filesRestored },
      });
      writeSessionState(state.activeSession!.dir, nextState);
      state.activeSession = loadSession(state.activeSession!.meta.sessionId);

      return { filesRestored, eventSeq: toEventSeq };
    });
  });

  peer.onRequest('ent/session/inject', async (params: unknown) => {
    assertInitialized(state);
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };

    const parsed = params as { content: unknown[]; priority: 'immediate' | 'normal' | 'deferred' };
    const priority =
      parsed?.priority === 'immediate' ||
      parsed?.priority === 'normal' ||
      parsed?.priority === 'deferred'
        ? parsed.priority
        : 'normal';

    let sessionState: SessionState = readSessionState(state.activeSession.dir);
    const { nextState } = appendDurableEvent(state.activeSession.dir, sessionState, {
      type: 'context_injected',
      data: { content: Array.isArray(parsed?.content) ? parsed.content : [], priority },
    });
    sessionState = nextState;
    writeSessionState(state.activeSession.dir, sessionState);
    state.activeSession = { ...state.activeSession!, state: sessionState };

    peer.notify('session/update', {
      sessionId: state.activeSession.meta.sessionId,
      streamSeq: sessionState.nextStreamSeq,
      turnId: state.activeTurn?.turnId,
      turnSeq: state.activeTurn ? 0 : undefined,
      type: 'context_injected',
      priority,
      messageCount: 0,
    });

    writeSessionState(state.activeSession.dir, {
      ...sessionState,
      nextStreamSeq: sessionState.nextStreamSeq + 1,
    });

    state.activeSession = {
      ...state.activeSession,
      state: readSessionState(state.activeSession.dir),
    };
    return undefined;
  });

  peer.onRequest('ent/session/events', async (params: unknown) => {
    assertInitialized(state);
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };

    const parsed = params as
      | { afterEventSeq?: number; limit?: number; types?: string[] }
      | undefined;
    const result = readDurableEvents(state.activeSession.dir, {
      afterEventSeq: parsed?.afterEventSeq,
      limit: parsed?.limit,
      types: parsed?.types,
    });

    return result;
  });

  peer.onRequest('ent/session/token_usage', async (_params: unknown) => {
    assertInitialized(state);
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };

    const { tokenUsage } = await computeContextBreakdownForActiveSession(
      state,
      createToolExecutorForMode
    );
    return tokenUsage;
  });

  peer.onRequest('ent/session/context_breakdown', async (_params: unknown) => {
    assertInitialized(state);
    if (!state.activeSession)
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };

    const { breakdown } = await computeContextBreakdownForActiveSession(
      state,
      createToolExecutorForMode
    );
    return breakdown;
  });
}
