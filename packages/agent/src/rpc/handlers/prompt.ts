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
import { PROMPT_HANDLER_CAUGHT_STOP_REASON } from '@lace/agent/storage/event-types';
import { logger } from '@lace/agent/utils/logger';
import { findUserCommand } from '@lace/agent/user-commands';
import type {
  SessionUpdate,
  AgentServerState,
  CreateToolExecutorFn,
} from '@lace/agent/server-types';
import { throwInvalidParams, assertInitialized, toNonEmptyString } from '@lace/agent/rpc/utils';
import { handleSlashCommand } from '@lace/agent/conversation/slash-commands';
import { createProviderForTurn, getModelPricing } from '@lace/agent/conversation/provider-factory';
import { ConversationRunner } from '@lace/agent/core/conversation/runner';
import type { RunnerConfig, RunnerDependencies } from '@lace/agent/core/conversation/types';
import { getEffectiveConfig } from '@lace/agent/core/session';
import { SkillRegistry, getSkillDirectories } from '@lace/agent/skills';
import { composeSkillDirs } from '@lace/agent/skills/compose-skill-dirs';
import { getAgentSkillsDir } from '@lace/agent/skills/agent-skills-dir';
import { getOrCreateSessionToolExecutor } from '@lace/agent/server';
import type { RuntimeExecutionBinding } from '@lace/agent/tools/runtime/types';
import {
  classifyPromptHandoff,
  handoffError,
  rejectHandoffSourceMetadata,
  readDurableEventsForHandoff,
  withDurableHandoffStatus,
} from './handoff-idempotency';

/**
 * Schedule a follow-up internal turn if an immediate-priority `context_injected`
 * event landed during the just-ended turn (eventSeq > `watermark`) but was not
 * consumed before the turn exited.
 *
 * Under async-only delegation a job-completion `<notification>` (an immediate
 * `context_injected` durable event) is the ONLY way a parent learns a subagent
 * finished, so an inject that races the turn boundary must still wake the parent.
 * This runs on every turn-exit path (success, abort, slash, error); each passes
 * the watermark appropriate to what it consumed.
 *
 * The re-entrancy guard is load-bearing: the wake is deferred to a `setImmediate`
 * and re-checks `!state.activeTurn` inside it so we never start a second turn
 * while one is already running, and `state.activeSession` may have changed.
 */
function scheduleImmediateInjectDrain(
  state: AgentServerState,
  runPromptInternalRef: { current: ((content: unknown[]) => Promise<void>) | null },
  watermark: number
): void {
  if (!state.activeSession) return;
  if (
    hasPendingImmediateInjects(state.activeSession.dir, watermark) &&
    runPromptInternalRef.current
  ) {
    setImmediate(() => {
      if (!state.activeTurn && state.activeSession && runPromptInternalRef.current) {
        void runPromptInternalRef.current([]);
      }
    });
  }
}

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
  const handlePrompt = async (params: {
    content: unknown[];
    outputFormat?: unknown;
    maxTurns?: number;
    idempotencyKey?: unknown;
    track?: unknown;
  }) => {
    assertInitialized(state);
    rejectHandoffSourceMetadata(params);
    const idempotencyKey = toNonEmptyString(params.idempotencyKey);
    const promptContent = Array.isArray(params.content) ? params.content : [];
    if (!state.activeSession) {
      throw {
        code: AcpErrorCodes.SessionNotFound,
        message: 'SessionNotFound',
        data: {
          category: 'session',
          ...(idempotencyKey ? { durableHandoffStatus: 'not-persisted' } : {}),
        },
      };
    }
    if (idempotencyKey) {
      const status = await runExclusive(() => {
        if (!state.activeSession) return 'not-persisted';
        const readResult = readDurableEventsForHandoff(state.activeSession.dir);
        if (!readResult.ok) return 'duplicate-unsafe-retry';
        return classifyPromptHandoff(
          readResult.events,
          idempotencyKey,
          promptContent,
          state.activeTurn?.turnId
        );
      });
      if (status === 'duplicate-already-handled') {
        return { durableHandoffStatus: status };
      }
      if (status === 'duplicate-in-progress') {
        throw {
          code: AcpErrorCodes.SessionBusy,
          message: 'SessionBusy',
          data: { category: 'session', durableHandoffStatus: status },
        };
      }
      if (status !== 'persisted-new') {
        throw handoffError('DuplicateUnsafeRetry', status);
      }
    }
    if (state.activeTurn) {
      throw {
        code: AcpErrorCodes.SessionBusy,
        message: 'SessionBusy',
        data: {
          category: 'session',
          ...(idempotencyKey ? { durableHandoffStatus: 'not-persisted' } : {}),
        },
      };
    }

    if (params.outputFormat !== undefined) {
      const of = params.outputFormat as { type?: string; schema?: object };
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

    const effectiveConfig = getEffectiveConfig(state.config, state.activeSession.state.config);

    const parsed = params;
    const turnId = `turn_${randomUUID()}`;
    const startedAt = new Date().toISOString();
    const abortController = new AbortController();

    state.activeTurn = { turnId, startedAt, status: 'running', abortController };
    let ownsActiveTurn = true;

    // Immediate-inject drain watermark for the NON-success exit paths (abort,
    // slash, error). These paths consume no injects of their own — the abort
    // and slash early-returns never run the conversation loop, and an error can
    // throw before the runner consumes anything. So the correct watermark for
    // them is the one this turn STARTED from: the last turn_end that existed
    // before this turn_start. Any immediate inject newer than that is unconsumed
    // and must wake a follow-up turn. (The success path uses a different, higher
    // watermark — the turn_end the runner just wrote — because the runner
    // already folded in every inject up to that point.) Captured before
    // turn_start is written so the about-to-be-written turn_end of THIS turn
    // does not raise the watermark and strand an inject that landed during the
    // turn.
    const preTurnInjectWatermark = state.activeSession
      ? (findLastTurnEndEventSeq(state.activeSession.dir) ?? 0)
      : 0;

    // Hoisted outside the try so the catch handler (fallback turn_end) can
    // reuse the same write path to synthesize a turn_end. The turnSeq counter
    // is intentionally local to this handler invocation; the runner has its
    // own counter and the storage layer dedups any duplicate turn_end on this
    // turnId, so fallback writes don't conflict with the runner's writes.
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

    // Tracks whether turn_start was actually written, so the catch handler
    // only synthesizes turn_end when there is a turn to close. If we throw
    // before turn_start (e.g. param-validation failure inside the try), no
    // fallback turn_end is needed.
    let turnStartWritten = false;
    let promptWritten = false;

    try {
      const track =
        typeof params.track === 'string' && params.track.length > 0 ? params.track : undefined;
      await writeAndAdvance({
        type: 'prompt',
        data: {
          content: promptContent,
          ...(idempotencyKey ? { idempotencyKey } : {}),
          ...(track !== undefined ? { track } : {}),
        },
      });
      promptWritten = true;
      await writeAndAdvance({ type: 'turn_start', data: {} });
      turnStartWritten = true;
      await emitSessionUpdate({ type: 'turn_start' }, { turnId, turnSeq: 0 });

      const emitUpdate = async (turnSeq: number, update: SessionUpdate) => {
        await emitSessionUpdate(update, { turnId, turnSeq });
      };

      if (abortController.signal.aborted) {
        await writeAndAdvance({ type: 'turn_end', data: { stopReason: 'cancelled' } });
        const result = {
          turnId,
          stopReason: 'cancelled' as const,
          stopDetails: null,
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
        ownsActiveTurn = false;
        // The aborted turn consumed no injects, so drain anything newer than the
        // watermark this turn started from (NOT the cancelled turn_end we just
        // wrote, which would strand an inject that landed during the turn).
        scheduleImmediateInjectDrain(state, runPromptInternalRef, preTurnInjectWatermark);
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
          emitUpdate,
          createToolExecutorForMode
        );
        if (slashResult) {
          state.activeTurn = null;
          ownsActiveTurn = false;
          // A slash command does not run the conversation loop, so it consumes
          // no injects. Drain anything newer than the watermark this turn
          // started from. (For /clear, state.activeSession is now the NEW
          // session whose fresh transcript has no pending injects, so this
          // correctly no-ops there.)
          scheduleImmediateInjectDrain(state, runPromptInternalRef, preTurnInjectWatermark);
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

      const maxTurns =
        typeof (params as { maxTurns?: number })?.maxTurns === 'number' &&
        Number.isFinite((params as { maxTurns?: number }).maxTurns)
          ? Math.max(1, Math.trunc((params as { maxTurns?: number }).maxTurns!))
          : ConversationRunner.DEFAULT_MAX_TURNS;

      // Create skill registry for this session. Persona skills layer first,
      // then plugin dirs, then core, then embedder/workDir (first-wins).
      const skillDirs = composeSkillDirs(
        { skillDirs: state.skillDirs ?? getSkillDirectories(state.activeSession.meta.workDir) },
        state.personaRegistry.personaSkillsDir(state.activeSession.meta.persona ?? 'lace'),
        { coreDir: getAgentSkillsDir() }
      );
      const skillRegistry = new SkillRegistry({ skillDirs });

      // Resolve the session role's spawn environment (Part A) so the credential
      // exec-tool can bind a minted placeholder to it (Part B). A container role
      // declares `runtime: { type: container, environment }`; a root persona
      // declares no environment. Best-effort — a parse failure must not block a
      // prompt, so we leave roleEnvironment unset (the broker defaults to '').
      let roleEnvironment: string | undefined;
      const sessionPersona = state.activeSession.meta.persona;
      if (sessionPersona !== undefined) {
        try {
          const runtime = state.personaRegistry.parsePersona(sessionPersona).config.runtime;
          if (runtime.type === 'container') roleEnvironment = runtime.environment;
        } catch {
          // Unknown/invalid persona — leave roleEnvironment unset.
        }
      }

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
        ...(state.activeSession.meta.persona ? { persona: state.activeSession.meta.persona } : {}),
        ...(roleEnvironment ? { roleEnvironment } : {}),
        ...(effectiveConfig.credentialBrokerSocket
          ? { credentialBrokerSocket: effectiveConfig.credentialBrokerSocket }
          : {}),
      };

      const sessionIdForCache = state.activeSession.meta.sessionId;
      const sessionToolScope = state.activeSession.state.config?.toolScope;
      // Capture the session's active persona at executor-build time so
      // fork and /clear always use the persona of the session being built,
      // not whatever state.activeSession holds at call time.
      const sessionActivePersona = state.activeSession.meta.persona ?? 'lace';
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
              personaReg,
              sessionActivePersona,
              state.environmentRegistry
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
        workspaceReaper: state.workspaceReaper,
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
          // Only base input/output flow into session-level tokenUsage (existing
          // SessionState shape doesn't carry cache categories). Per-turn cache
          // breakdown lives in turn_end events — anything wanting cumulative
          // cache totals reads events.jsonl.
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
        ...(params.outputFormat !== undefined ? { outputFormat: params.outputFormat } : {}),
        maxTurns,
        abortController,
        turnId,
        startedAt,
      });

      // Translate runner cache field names to the ent-protocol UsageInfoSchema
      // names. Runner uses the Anthropic SDK's category names; the wire protocol
      // pre-dated cache pricing and uses cacheRead/cacheWrite. Strict schema
      // rejects unknowns, so we cannot just spread `result.usage`. Used for both
      // the session/update SSE notification and the session/prompt RPC result.
      const protocolUsage = {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        ...(result.usage.cacheReadInputTokens !== undefined
          ? { cacheReadTokens: result.usage.cacheReadInputTokens }
          : {}),
        ...(result.usage.cacheCreationInputTokens !== undefined
          ? { cacheWriteTokens: result.usage.cacheCreationInputTokens }
          : {}),
        ...(result.usage.costUsd !== undefined ? { costUsd: result.usage.costUsd } : {}),
      };

      await emitSessionUpdate(
        {
          type: 'turn_end',
          stopReason: result.stopReason,
          content: result.content,
          usage: protocolUsage,
        },
        { turnId, turnSeq: result.usage.inputTokens + result.usage.outputTokens }
      );

      state.activeSession = loadSession(state.activeSession.meta.sessionId);
      state.activeTurn = null;
      ownsActiveTurn = false;

      // Bug 3 fix: catch immediate-inject events that landed in the closing
      // microseconds of the turn (after the runner's last iteration but before
      // turn_end). The setImmediate-based wake in injectNotification's
      // triggerInternalTurn callback can no-op if it observes state.activeTurn=true
      // before the turn ends, then the turn ends with the event unprocessed.
      // We re-scan here, after activeTurn is cleared, and fire a synthetic
      // internal turn if anything is waiting. The runner already consumed every
      // inject up to the turn_end it just wrote, so the watermark is that
      // turn_end's eventSeq.
      scheduleImmediateInjectDrain(
        state,
        runPromptInternalRef,
        state.activeSession ? (findLastTurnEndEventSeq(state.activeSession.dir) ?? 0) : 0
      );

      // RPC response uses the protocol-shaped usage.
      return {
        turnId: result.turnId,
        stopReason: result.stopReason,
        content: result.content,
        usage: protocolUsage,
        ...(result.structuredOutput !== undefined
          ? { structuredOutput: result.structuredOutput }
          : {}),
        ...(idempotencyKey ? { durableHandoffStatus: 'persisted-new' as const } : {}),
      };
    } catch (err) {
      // Defense-in-depth fallback turn_end. The runner is supposed to always
      // write turn_end before throwing, but this catch backstops any path the
      // runner can't cover — throws between turn_start and runner.run() starting,
      // throws from runner construction, or future bugs in the error classifier.
      // The storage layer dedups by turnId, so if the runner already wrote
      // its own turn_end this write is a silent no-op.
      if (turnStartWritten) {
        try {
          await writeAndAdvance({
            type: 'turn_end',
            data: { stopReason: PROMPT_HANDLER_CAUGHT_STOP_REASON },
          });
        } catch (writeErr) {
          logger.error('prompt handler: failed to write fallback turn_end', {
            turnId,
            writeErr: writeErr instanceof Error ? writeErr.message : String(writeErr),
          });
        }
      }
      if (idempotencyKey && promptWritten) {
        throw withDurableHandoffStatus(err, 'persisted-new');
      }
      throw err;
    } finally {
      // Only the error/throw exit still owns the active turn here: the success,
      // abort, and slash paths each cleared it and set ownsActiveTurn=false
      // before returning. We clear it and run the inject drain so an immediate
      // inject that landed as the turn threw still wakes a follow-up turn. The
      // erroring turn may have thrown before the runner consumed anything, so we
      // use the watermark this turn started from (never strands; over-firing on a
      // turn that did consume is bounded and self-corrects on the next turn).
      if (ownsActiveTurn) {
        if (state.activeTurn?.turnId === turnId) {
          state.activeTurn = null;
        }
        scheduleImmediateInjectDrain(state, runPromptInternalRef, preTurnInjectWatermark);
      }
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
    return handlePrompt(
      params as {
        content: unknown[];
        outputFormat?: unknown;
        maxTurns?: number;
        idempotencyKey?: unknown;
        track?: unknown;
      }
    );
  });
}
