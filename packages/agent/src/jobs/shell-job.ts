// ABOUTME: Shell job execution - handles spawning and managing shell command processes

import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, statSync } from 'node:fs';
import type { JobState, SessionUpdate } from '../server-types';
import { MAX_JOB_OUTPUT_BYTES } from '../server-types';
import { toolKindFromName, shouldAskPermission } from '../rpc/utils';
import { readSessionState, type LoadedSession } from '../storage/session-store';
import type { ToolResult } from '@lace/ent-protocol';
import { createToolRuntimeFromBinding } from '../tools/runtime/factory';
import type { ProjectedContainerManager } from '../tools/runtime/projected-container';
import type { RuntimeSecretResolver } from '../tools/runtime/secrets';
import { buildDefaultBoundedHostRuntimeBinding } from '../tools/runtime/validation';
import type { RuntimeProcessHandle } from '../tools/runtime/types';

export type ShellJobContext = {
  getState: () => {
    activeSession: LoadedSession | null;
    config: {
      approvalMode:
        | 'ask'
        | 'approveReads'
        | 'approveEdits'
        | 'approve'
        | 'deny'
        | 'dangerouslySkipPermissions';
    };
    jobStreaming: 'full' | 'coalesced' | 'none';
    containerManager?: ProjectedContainerManager | null;
    runtimeSecretResolver?: RuntimeSecretResolver;
  };
  runExclusive: <T>(work: () => Promise<T> | T) => Promise<T>;
  emitSessionUpdate: (
    update: SessionUpdate & { sessionId?: string; streamSeq?: number },
    context?: { turnId?: string; turnSeq?: number; jobId?: string }
  ) => Promise<void>;
  requestPermissionFromClient: (request: {
    sessionId: string;
    turnId: string;
    turnSeq: number;
    jobId: string;
    toolCallId: string;
    tool: string;
    kind: string;
    resource: string;
    options: { optionId: string; label: string }[];
    input: Record<string, unknown>;
    signal: AbortSignal;
  }) => Promise<{ decision?: string; updatedInput?: Record<string, unknown> }>;
  finalizeJob: (job: JobState, options?: { exitCode?: number }) => Promise<void>;
};

function createJobProcessAdapter(
  handle: RuntimeProcessHandle,
  options: { processGroup: boolean }
): ChildProcess {
  let exitCode: number | null = null;
  void handle.completion.then(
    ({ exitCode: code }) => {
      exitCode = code;
    },
    () => {
      exitCode = 1;
    }
  );

  // job-control only needs kill(), exitCode, and, for detached POSIX shell
  // jobs, pid so it can terminate the entire command process group.
  return {
    get pid() {
      return options.processGroup ? handle.pid : undefined;
    },
    get exitCode() {
      return exitCode;
    },
    kill(signal?: NodeJS.Signals) {
      handle.kill(signal);
      return true;
    },
  } as unknown as ChildProcess;
}

export const createRunShellJobProcess = (context: ShellJobContext) => {
  return (job: JobState) => {
    void (async () => {
      // Get current state each time job runs (not captured at creation time)
      const state = context.getState();
      if (!state.activeSession) return;
      if (job.proc || job.finished) return;

      const sessionState = readSessionState(state.activeSession.dir);
      // Merge server and session approval modes (session takes precedence)
      const approvalMode = sessionState.config?.approvalMode ?? state.config.approvalMode;

      const toolName = 'bash';
      const kind = toolKindFromName(toolName);
      const requiresPermission = shouldAskPermission(approvalMode, kind);

      if (approvalMode === 'deny') {
        job.status = 'cancelled';
        await context.finalizeJob(job);
        return;
      }

      if (requiresPermission) {
        const toolCallId = `tool_${randomUUID()}`;
        const toolInput = { command: job.command ?? '' } as Record<string, unknown>;
        const permissionTurnId = job.originTurnId ?? `turn_${randomUUID()}`;
        const permissionTurnSeq = job.originTurnSeq ?? 0;
        job.permissionAbortController = new AbortController();

        await context.emitSessionUpdate(
          {
            type: 'job_update',
            jobId: job.jobId,
            parentJobId: job.parentJobId,
            jobType: 'bash' as const,
            channel: 'internal',
            update: {
              type: 'tool_use',
              toolCallId,
              name: toolName,
              kind,
              input: toolInput,
              status: 'awaiting_permission',
            },
          },
          { turnId: job.originTurnId, turnSeq: job.originTurnSeq }
        );

        let decision: { decision?: string; updatedInput?: Record<string, unknown> };
        try {
          decision = await context.requestPermissionFromClient({
            sessionId: state.activeSession.meta.sessionId,
            turnId: permissionTurnId,
            turnSeq: permissionTurnSeq,
            jobId: job.jobId,
            toolCallId,
            tool: toolName,
            kind,
            resource: String(job.command ?? ''),
            options: [
              { optionId: 'allow', label: 'Allow' },
              { optionId: 'deny', label: 'Deny' },
            ],
            input: toolInput,
            signal: job.permissionAbortController.signal,
          });
        } catch {
          job.permissionAbortController = undefined;
          job.status = 'cancelled';
          await context.finalizeJob(job);
          return;
        }
        job.permissionAbortController = undefined;

        if (job.finished || job.status === 'cancelled') {
          return;
        }

        if (decision?.decision !== 'allow') {
          const denied: ToolResult = {
            outcome: 'denied',
            content: [{ type: 'error', message: 'Denied by user' }],
          };

          await context.emitSessionUpdate(
            {
              type: 'job_update',
              jobId: job.jobId,
              parentJobId: job.parentJobId,
              jobType: 'bash' as const,
              channel: 'internal',
              update: {
                type: 'tool_use',
                toolCallId,
                name: toolName,
                kind,
                input: toolInput,
                status: 'denied',
                result: denied,
              },
            },
            { turnId: job.originTurnId, turnSeq: job.originTurnSeq }
          );

          job.status = 'cancelled';
          await context.finalizeJob(job);
          return;
        }
      }

      const appendOutput = async (chunk: string) => {
        if (!state.activeSession) return;
        await context.runExclusive(() => {
          // Check output size limit
          const currentSize = existsSync(job.outputPath) ? statSync(job.outputPath).size : 0;
          if (currentSize >= MAX_JOB_OUTPUT_BYTES) return; // Already at limit
          const remaining = MAX_JOB_OUTPUT_BYTES - currentSize;
          const toWrite = chunk.length <= remaining ? chunk : chunk.slice(0, remaining);
          appendFileSync(job.outputPath, toWrite, { encoding: 'utf8' });
        });
      };

      let proc: RuntimeProcessHandle;
      try {
        const runtimeBinding =
          job.runtimeBinding ??
          buildDefaultBoundedHostRuntimeBinding({
            sessionId: state.activeSession.meta.sessionId,
            cwd: state.activeSession.meta.workDir,
          });
        const runtime = createToolRuntimeFromBinding({
          binding: runtimeBinding,
          containerManager: state.containerManager,
          sessionId: state.activeSession.meta.sessionId,
          secretResolver: state.runtimeSecretResolver,
        });
        const detached = process.platform !== 'win32';
        proc = await runtime.process.start(['/bin/bash', '-c', job.command ?? ''], {
          detached,
        });
        job.proc = createJobProcessAdapter(proc, { processGroup: detached });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await appendOutput(`[BASH ERROR]\nMessage: ${message}\n`);
        job.status = 'failed';
        await context.finalizeJob(job, { exitCode: 1 });
        return;
      }

      proc.stdin?.end();

      proc.stdout?.setEncoding('utf8');
      proc.stderr?.setEncoding('utf8');

      const onStdout = async (chunk: string) => {
        await appendOutput(chunk);
        if (state.jobStreaming === 'none') return;
        await context.emitSessionUpdate(
          {
            type: 'job_update',
            jobId: job.jobId,
            parentJobId: job.parentJobId,
            jobType: 'bash' as const,
            channel: 'stdout',
            update: { type: 'text_delta', text: chunk },
          },
          { turnId: job.originTurnId, turnSeq: job.originTurnSeq }
        );
      };

      const onStderr = async (chunk: string) => {
        await appendOutput(chunk);
        if (state.jobStreaming === 'none') return;
        await context.emitSessionUpdate(
          {
            type: 'job_update',
            jobId: job.jobId,
            parentJobId: job.parentJobId,
            jobType: 'bash' as const,
            channel: 'stderr',
            update: { type: 'text_delta', text: chunk },
          },
          { turnId: job.originTurnId, turnSeq: job.originTurnSeq }
        );
      };

      proc.stdout?.on('data', (chunk) => void onStdout(String(chunk)));
      proc.stderr?.on('data', (chunk) => void onStderr(String(chunk)));

      void proc.completion.then(
        ({ exitCode }) => {
          void (async () => {
            if (job.finished) {
              job.resolveCompletion();
              return;
            }

            if (job.status !== 'cancelled') {
              job.status = exitCode === 0 ? 'completed' : 'failed';
            }

            await context.finalizeJob(job, { exitCode: exitCode ?? 0 });
          })();
        },
        (error) => {
          void (async () => {
            const message = error instanceof Error ? error.message : String(error);
            await appendOutput(`[BASH ERROR]\nMessage: ${message}\n`);
            job.status = 'failed';
            await context.finalizeJob(job, { exitCode: 1 });
          })();
        }
      );
    })();
  };
};
