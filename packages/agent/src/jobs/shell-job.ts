// ABOUTME: Shell job execution - handles spawning and managing shell command processes

import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, statSync } from 'node:fs';
import type { JobState, SessionUpdate } from '../server-types';
import { MAX_JOB_OUTPUT_BYTES } from '../server-types';
import { toolKindFromName, shouldAskPermission } from '../rpc/utils';
import { readSessionState, type LoadedSession } from '../storage/session-store';
import type { ToolResult } from '@lace/ent-protocol';

export type ShellJobContext = {
  state: {
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
    jobStreaming: 'none' | 'all' | string;
  };
  runExclusive: <T>(work: () => Promise<T> | T) => Promise<T>;
  emitSessionUpdate: (
    update: SessionUpdate & { sessionId?: string; streamSeq?: number }
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

export const createRunShellJobProcess = (context: ShellJobContext) => {
  return (job: JobState) => {
    void (async () => {
      if (!context.state.activeSession) return;
      if (job.proc || job.finished) return;

      const sessionState = readSessionState(context.state.activeSession.dir);
      const effectiveConfig = sessionState.config
        ? { ...context.state.config, ...sessionState.config }
        : context.state.config;

      const toolName = 'bash';
      const kind = toolKindFromName(toolName);
      const requiresPermission = shouldAskPermission(effectiveConfig.approvalMode, kind);

      if (effectiveConfig.approvalMode === 'deny') {
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

        await context.emitSessionUpdate({
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
        });

        let decision: { decision?: string; updatedInput?: Record<string, unknown> };
        try {
          decision = await context.requestPermissionFromClient({
            sessionId: context.state.activeSession.meta.sessionId,
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

          await context.emitSessionUpdate({
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
          });

          job.status = 'cancelled';
          await context.finalizeJob(job);
          return;
        }
      }

      const proc = spawn(job.command ?? '', {
        cwd: context.state.activeSession!.meta.workDir,
        shell: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      job.proc = proc;

      proc.stdout!.setEncoding('utf8');
      proc.stderr!.setEncoding('utf8');

      const appendOutput = async (chunk: string) => {
        if (!context.state.activeSession) return;
        await context.runExclusive(() => {
          // Check output size limit
          const currentSize = existsSync(job.outputPath) ? statSync(job.outputPath).size : 0;
          if (currentSize >= MAX_JOB_OUTPUT_BYTES) return; // Already at limit
          const remaining = MAX_JOB_OUTPUT_BYTES - currentSize;
          const toWrite = chunk.length <= remaining ? chunk : chunk.slice(0, remaining);
          appendFileSync(job.outputPath, toWrite, { encoding: 'utf8' });
        });
      };

      const onStdout = async (chunk: string) => {
        await appendOutput(chunk);
        if (context.state.jobStreaming === 'none') return;
        await context.emitSessionUpdate({
          type: 'job_update',
          jobId: job.jobId,
          parentJobId: job.parentJobId,
          jobType: 'bash' as const,
          channel: 'stdout',
          update: { type: 'text_delta', text: chunk },
        });
      };

      const onStderr = async (chunk: string) => {
        await appendOutput(chunk);
        if (context.state.jobStreaming === 'none') return;
        await context.emitSessionUpdate({
          type: 'job_update',
          jobId: job.jobId,
          parentJobId: job.parentJobId,
          jobType: 'bash' as const,
          channel: 'stderr',
          update: { type: 'text_delta', text: chunk },
        });
      };

      proc.stdout!.on('data', (chunk) => void onStdout(chunk as string));
      proc.stderr!.on('data', (chunk) => void onStderr(chunk as string));

      proc.on('close', (code) => {
        void (async () => {
          if (job.finished) {
            job.resolveCompletion();
            return;
          }

          const exitCode = code ?? 0;
          if (job.status !== 'cancelled') {
            job.status = exitCode === 0 ? 'completed' : 'failed';
          }

          await context.finalizeJob(job, { exitCode });
        })();
      });
    })();
  };
};
