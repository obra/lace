// ABOUTME: Prompt RPC handler - thin adapter over core/conversation/runner

import { randomUUID } from 'node:crypto';
import { AcpErrorCodes, type JsonRpcPeer } from '@lace/ent-protocol';
import {
  loadSession,
  readSessionState,
  writeSessionState,
  type SessionState,
} from '@lace/agent/storage/session-store';
import {
  appendDurableEvent,
  findLastTurnEndEventSeq,
  hasPendingImmediateInjects,
} from '@lace/agent/storage/event-log';
import { findUserCommand } from '@lace/agent/user-commands';
import type {
  SessionUpdate,
  AgentServerState,
  CreateToolExecutorFn,
} from '@lace/agent/server-types';
import { throwInvalidParams, assertInitialized } from '@lace/agent/rpc/utils';
import { handleSlashCommand } from '@lace/agent/conversation/slash-commands';
import { createProviderForTurn, getModelPricing } from '@lace/agent/conversation/provider-factory';
import { ConversationRunner } from '@lace/agent/core/conversation/runner';
import type { RunnerConfig, RunnerDependencies } from '@lace/agent/core/conversation/types';
import { getEffectiveConfig } from '@lace/agent/core/session';
import { SkillRegistry, getSkillDirectories } from '@lace/agent/skills';
import { getOrCreateSessionToolExecutor } from '@lace/agent/server';
import type { RuntimeExecutionBinding } from '@lace/agent/tools/runtime/types';

/**
 * Register the session/prompt RPC handler.
 */
export function registerPromptHandler(
  peer: JsonRpcPeer,
  state: AgentServerState,
  runExclusive: <T>(fn: () => T | Promise<T>) => Promise<T>,
  emitSessionUpdate: (
    update: SessionUpdate,
    context: { turnId?: string; turnSeq?: number }
  ) => Promise<void>,
  requestPermissionFromClient: (request: {
    sessionId: string;
    turnId: string;
    turnSeq: number;
    toolCallId: string;
    tool: string;
    kind: string;
    resource: string;
    options: Array<{ optionId: string; label: string }>;
    input: Record<string, unknown>;
    signal: AbortSignal;
  }) => Promise<{ decision?: string; updatedInput?: Record<string, unknown> } | undefined>,
  createToolExecutorForMode: CreateToolExecutorFn,
  startShellJob: (options: {
    command: string;
    description?: string;
    turnContext: { turnId: string; turnSeq: number };
    runtimeBinding?: RuntimeExecutionBinding;
  }) => Promise<{ jobId: string }>,
  runPromptInternalRef: { current: ((content: unknown[]) => Promise<void>) | null }
) {
  const handlePrompt = async (params: { content: unknown[]; outputFormat?: unknown }) => {
    assertInitialized(state);
    if (!state.activeSession) {
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: { category: 'session' },
      };
    }
    if (state.activeTurn) {
      throw {
        code: AcpErrorCodes.SessionBusy,
        message: 'SessionBusy',
        data: { category: 'session' },
      };
    }

    const effectiveConfig = getEffectiveConfig(state.config, state.activeSession.state.config);

    const parsed = params;
    const turnId = `turn_${randomUUID()}`;
    const startedAt = new Date().toISOString();
    const abortController = new AbortController();

    state.activeTurn = { turnId, startedAt, status: 'running', abortController };

    try {
      let durableTurnSeq = 0;
      const writeAndAdvance = async (event: { type: string; data: Record<string, unknown> }) => {
        await runExclusive(() => {
          if (!state.activeSession) return;
          let sessionState: SessionState = readSessionState(state.activeSession.dir);
          const { nextState } = appendDurableEvent(state.activeSession.dir, sessionState, {
            type: event.type,
            data: event.data,
            turnId,
            turnSeq: durableTurnSeq++,
          });
          sessionState = nextState;
          writeSessionState(state.activeSession.dir, sessionState);
          state.activeSession = { ...state.activeSession, state: sessionState };
        });
      };

      const promptContent = parsed.content as unknown[];

      await writeAndAdvance({ type: 'prompt', data: { content: promptContent } });
      await writeAndAdvance({ type: 'turn_start', data: {} });
      await emitSessionUpdate({ type: 'turn_start' }, { turnId, turnSeq: 0 });

      const emitUpdate = async (turnSeq: number, update: SessionUpdate) => {
        await emitSessionUpdate(update, { turnId, turnSeq });
      };

      if (abortController.signal.aborted) {
        await writeAndAdvance({ type: 'turn_end', data: { stopReason: 'cancelled' } });
        const result = {
          turnId,
          stopReason: 'cancelled' as const,
          content: [] as { type: 'text'; text: string }[],
          usage: { inputTokens: 0, outputTokens: 0 },
        };
        await emitSessionUpdate(
          {
            type: 'turn_end',
            stopReason: result.stopReason,
            content: result.content,
            usage: result.usage,
          },
          { turnId, turnSeq: 1 }
        );
        state.activeSession = loadSession(state.activeSession.meta.sessionId);
        state.activeTurn = null;
        return result;
      }

      const promptText = (parsed.content as { type?: string; text?: string }[])
        .filter((b) => b?.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\n');

      // Handle slash commands (e.g., /compact, /mode approve, /help)
      let effectivePromptText = promptText;
      const slashMatch = promptText.match(/^\/(\w+)(?:\s+(.*))?$/);
      if (slashMatch) {
        const slashCmd = slashMatch[1];
        const slashArgs = slashMatch[2]?.trim() ?? '';
        const workDir = state.activeSession.meta.workDir;

        // First check built-in commands
        const slashResult = await handleSlashCommand(
          state,
          slashCmd,
          slashArgs,
          turnId,
          writeAndAdvance,
          emitUpdate
        );
        if (slashResult) {
          state.activeTurn = null;
          return slashResult;
        }

        // Check for user-defined command
        const userCmd = findUserCommand(slashCmd, workDir);
        if (userCmd) {
          effectivePromptText = slashArgs ? `${userCmd.body}\n\n${slashArgs}` : userCmd.body;

          if (userCmd.mode) {
            const currentState = readSessionState(state.activeSession.dir);
            const nextConfig = {
              ...currentState.config,
              approvalMode: userCmd.mode,
            };
            const nextState = { ...currentState, config: nextConfig };
            writeSessionState(state.activeSession.dir, nextState);
            state.activeSession = loadSession(state.activeSession.meta.sessionId);
          }

          (parsed.content as unknown[]) = [{ type: 'text', text: effectivePromptText }];
        }
      }

      if (parsed.outputFormat !== undefined) {
        const of = parsed.outputFormat as { type?: string; schema?: object };
        if (
          !of ||
          typeof of !== 'object' ||
          of.type !== 'json_schema' ||
          typeof of.schema !== 'object' ||
          of.schema === null
        ) {
          throwInvalidParams('outputFormat must be { type: "json_schema", schema: object }');
        }
      }

      const maxTurns =
        typeof (params as { maxTurns?: number })?.maxTurns === 'number' &&
        Number.isFinite((params as { maxTurns?: number }).maxTurns)
          ? Math.max(1, Math.trunc((params as { maxTurns?: number }).maxTurns!))
          : ConversationRunner.DEFAULT_MAX_TURNS;

      // Create skill registry for this session. Embedder-supplied skillDirs
      // (set during initialize) override the default workDir-based discovery.
      const skillDirs = state.skillDirs ?? getSkillDirectories(state.activeSession.meta.workDir);
      const skillRegistry = new SkillRegistry({ skillDirs });

      // Build runner config
      const config: RunnerConfig = {
        sessionDir: state.activeSession.dir,
        sessionId: state.activeSession.meta.sessionId,
        cwd: state.activeSession.meta.workDir,
        executionMode: effectiveConfig.executionMode ?? 'execute',
        approvalMode: effectiveConfig.approvalMode ?? 'ask',
        connectionId: effectiveConfig.connectionId,
        modelId: effectiveConfig.modelId,
        environment: effectiveConfig.environment as Record<string, string> | undefined,
        runtimeBinding: state.activeSession.state.config?.runtimeBinding,
        maxBudgetUsd: effectiveConfig.maxBudgetUsd,
      };

      const sessionIdForCache = state.activeSession.meta.sessionId;
      const sessionToolScope = state.activeSession.state.config?.toolScope;
      // Forwards personaRegistry through explicitly so the data flow from
      // state.personaRegistry → DelegateTool is auditable (no closure capture
      // hiding the wiring). Per-session toolScope is captured because it is
      // not part of the runner's interface.
      const cachedCreateToolExecutor = ((
        executionMode: 'plan' | 'execute',
        mcpServerManager,
        jobManager,
        skillReg,
        personaReg
      ) =>
        getOrCreateSessionToolExecutor(
          state.toolExecutorCache,
          sessionIdForCache,
          executionMode,
          () =>
            createToolExecutorForMode(
              executionMode,
              mcpServerManager,
              jobManager,
              skillReg,
              sessionToolScope,
              personaReg
            ),
          sessionToolScope
        )) as RunnerDependencies['createToolExecutor'];

      // Build runner dependencies
      const deps: RunnerDependencies = {
        onUpdate: emitUpdate,
        runExclusive,
        requestPermission: requestPermissionFromClient,
        createToolExecutor: cachedCreateToolExecutor,
        createProvider: () =>
          createProviderForTurn({
            connectionId: effectiveConfig.connectionId,
            modelId: effectiveConfig.modelId,
          }),
        getModelPricing: () =>
          getModelPricing(state, effectiveConfig.connectionId, effectiveConfig.modelId),
        startShellJob,
        jobManager: state.jobManager,
        containerManager: state.containerManager,
        containerMounts: state.containerMounts,
        runtimeSecretResolver: state.runtimeSecretResolver,
        mcpServerManager: state.mcpServerManager,
        skillRegistry,
        personaRegistry: state.personaRegistry,
        ...(state.reminderScheduler ? { reminderScheduler: state.reminderScheduler } : {}),
        ...(state.activeSession ? { activeSessionId: state.activeSession.meta.sessionId } : {}),
        setActiveTurnStatus: (status, ac) => {
          if (status === null) {
            state.activeTurn = null;
          } else if (state.activeTurn) {
            state.activeTurn = {
              ...state.activeTurn,
              status,
              abortController: ac ?? state.activeTurn.abortController,
            };
          }
        },
        getSessionCostUsd: () => {
          const sessionState = readSessionState(state.activeSession!.dir);
          return sessionState.sessionCostUsd ?? 0;
        },
        updateSessionUsage: ({ costDelta, inputTokens, outputTokens }) => {
          runExclusive(() => {
            if (!state.activeSession) return;
            const sessionState = readSessionState(state.activeSession.dir);
            const updatedState: SessionState = {
              ...sessionState,
              sessionCostUsd: (sessionState.sessionCostUsd ?? 0) + costDelta,
              tokenUsage: {
                totalInputTokens: (sessionState.tokenUsage?.totalInputTokens ?? 0) + inputTokens,
                totalOutputTokens: (sessionState.tokenUsage?.totalOutputTokens ?? 0) + outputTokens,
              },
            };
            writeSessionState(state.activeSession.dir, updatedState);
            state.activeSession = { ...state.activeSession, state: updatedState };
          });
        },
      };

      const runner = new ConversationRunner(config, deps);
      const result = await runner.run({
        content: promptContent as RunnerDependencies extends { content: infer C }
          ? C
          : { type: 'text'; text: string }[],
        maxTurns,
        abortController,
        turnId,
        startedAt,
      });

      await emitSessionUpdate(
        {
          type: 'turn_end',
          stopReason: result.stopReason,
          content: result.content,
          usage: result.usage,
        },
        { turnId, turnSeq: result.usage.inputTokens + result.usage.outputTokens }
      );

      state.activeSession = loadSession(state.activeSession.meta.sessionId);
      state.activeTurn = null;

      // Bug 3 fix: catch immediate-inject events that landed in the closing
      // microseconds of the turn (after the runner's last iteration but before
      // turn_end). The setImmediate-based wake in injectNotification's
      // triggerInternalTurn callback can no-op if it observes state.activeTurn=true
      // before the turn ends, then the turn ends with the event unprocessed.
      // We re-scan here, after activeTurn is cleared, and fire a synthetic
      // internal turn if anything is waiting.
      if (state.activeSession) {
        const lastTurnEnd = findLastTurnEndEventSeq(state.activeSession.dir) ?? 0;
        if (
          hasPendingImmediateInjects(state.activeSession.dir, lastTurnEnd) &&
          runPromptInternalRef.current
        ) {
          setImmediate(() => {
            if (!state.activeTurn && state.activeSession && runPromptInternalRef.current) {
              void runPromptInternalRef.current([]);
            }
          });
        }
      }

      return result;
    } finally {
      state.activeTurn = null;
    }
  };

  // Assign the internal prompt runner for use by queueJobNotification
  runPromptInternalRef.current = async (content: unknown[]) => {
    try {
      await handlePrompt({ content });
    } catch {
      // Silently ignore errors from internally-triggered turns
    }
  };

  // Register the RPC handler
  peer.onRequest('session/prompt', async (params: unknown) => {
    return handlePrompt(params as { content: unknown[]; outputFormat?: unknown });
  });
}
