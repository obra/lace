// ABOUTME: Delegate tool - spawns subagent jobs using JobManager
// Uses JobManager from ToolContext for all job operations

import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Tool } from '../tool';
import { NonEmptyString } from '../schemas/common';
import {
  PersonaRegistry,
  personaRegistry as defaultPersonaRegistry,
  PersonaNotFoundError,
  PersonaParseError,
} from '@lace/agent/config/persona-registry';
import {
  assertNoMountConflict,
  PersonaSharingViolationError,
} from '@lace/agent/config/persona-mount-conflict';
import { buildPerInvocationSpecName } from '@lace/agent/jobs/persona-container-spec';
import { buildPersonaProjectedRuntimeBinding } from '@lace/agent/jobs/persona-projected-binding';
import type { RuntimeExecutionBinding } from '@lace/agent/tools/runtime/types';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const delegateSchema = z
  .object({
    prompt: NonEmptyString,
    description: z.string().optional(),
    background: z.boolean().default(false),
    resume: z.string().optional(),
    progressIntervalMs: z.number().int().min(5000).max(600000).optional(),
    connectionId: z.string().optional(),
    modelId: z.string().optional(),
    persona: z.string().optional(),
  })
  .strict();

export interface DelegateToolOptions {
  personaRegistry?: PersonaRegistry;
}

export class DelegateTool extends Tool {
  name = 'delegate';
  description = `Spawn or continue a subagent conversation. **Read the mental model below before using.**

**Job vs. session — the load-bearing distinction.**
A delegate **job** is one round (one \`delegate(prompt=...)\` call → one assistant turn from the subagent → terminal state).
A delegate **session** is the whole conversation, persisted on disk, surviving across rounds and restarts.
Every \`delegate(prompt=...)\` creates a NEW job. With \`resume=<prior jobId>\`, that new job runs under the prior job's session (the subagent sees its full history); without \`resume\`, a fresh session is created. There is no "the delegate job" — each round has its own jobId.

**The async pattern (canonical usage).**
1. \`delegate(prompt=..., background=true)\` → returns \`{ jobId, status: "started" }\` immediately.
2. \`job_notify(jobId)\` → subscribe so lace wakes you when this job finishes.
3. **Return to the user.** Don't poll. Don't sit in \`job_output(block=true)\`. Do something else, answer the user, take another tool call. When this job transitions to \`completed\`/\`failed\`/\`cancelled\`, a \`<notification kind="job-completed"|"job-failed"|"job-cancelled" job-id="...">\` block is injected into your next-turn prompt.
4. Inspect the result (\`job_output(jobId)\` for full text, or read the notification's preview). **You** decide what's next: act on the output, \`delegate(resume=jobId, prompt=...)\` to continue the conversation in another round, or move on.

**Sync mode** (\`background=false\`, the default): the tool call blocks until the subagent finishes and returns its output prefixed with \`delegate jobId=<id>\`. Convenient for cheap, fast subagents. Brings the parent to a halt for the duration — DON'T use sync mode for anything that might take more than a few seconds; use background + \`job_notify\` instead.

Parameters:
- \`prompt\` (required): the task or follow-up message for the subagent.
- \`description\`: label shown in job listings.
- \`background\` (default false): return immediately with \`{ jobId, status: "started" }\` and run async. Strongly preferred for anything non-trivial; pair with \`job_notify(jobId)\`.
- \`resume\`: jobId of a previous delegate job. The new job binds to that job's session and the subagent sees its full conversation history. \`resume\` works whether the prior job was sync or background, completed or cancelled — sessions persist.
- \`progressIntervalMs\`: 5000–600000 ms. Operator-controlled cadence for periodic \`progress\` notifications on this job. **Default is off** — leave unset unless you specifically want this job to emit progress on a fixed cadence regardless of who's listening. Subscribing via \`job_notify(on=['progress'], ...)\` arms the timer on its own at the default cadence; you only need this parameter to override that or to opt in without a subscriber.
- \`connectionId\`, \`modelId\`: provider/model overrides for the subagent. Default to the parent session's values (or the persona's defaults if a \`persona\` is set).
- \`persona\`: a persona bundle name (e.g. \`"librarian"\`). Frontmatter sets defaults; body is the subagent's system prompt template.

**Common anti-pattern: do not** call \`delegate(background=true)\` and then immediately \`job_output(block=true)\` — that's polling. Use \`job_notify\` and return to the user.`;
  schema = delegateSchema;
  annotations: ToolAnnotations = {
    title: 'Delegate',
    // Delegation itself is safe internal control flow - the subagent
    // handles its own permissions for any destructive operations
    safeInternal: true,
  };

  private readonly personaRegistry: PersonaRegistry;

  constructor(opts: DelegateToolOptions = {}) {
    super();
    this.personaRegistry = opts.personaRegistry ?? defaultPersonaRegistry;
  }

  protected async executeValidated(
    args: z.infer<typeof delegateSchema>,
    context: ToolContext
  ): Promise<ToolResult> {
    const { jobManager, runtimeBinding, perInvocationReaper } = context;

    if (!jobManager) {
      return {
        status: 'failed',
        content: [{ type: 'text', text: 'delegate requires jobManager in context' }],
      };
    }

    const {
      prompt,
      description,
      background,
      resume,
      progressIntervalMs,
      connectionId,
      modelId,
      persona,
    } = args;

    // --- Step 1: Resolve childSessionId BEFORE building the persona binding ---
    //
    // For per_invocation personas we need the child session id to compose a
    // unique container name. Resolve it here so it's available to the binding
    // builder and to createJob.
    //
    // Resume case: the prior job's subagentSessionId becomes the childSessionId.
    // Fresh case:  mint a new one (cheap, deterministic format).
    //
    // For persistent personas and non-persona delegates we compute it
    // unconditionally (cheap) but never use it — the host doesn't preallocate
    // for those cases.
    let resumeSessionId: string | undefined;
    let childSessionId: string | undefined;

    if (resume) {
      const jobs = jobManager.listJobs();
      const previousJob = jobs.find((j) => j.jobId === resume);
      if (!previousJob?.subagentSessionId) {
        const jobIds = jobs.map((j) => j.jobId).join(', ');
        const withSession = jobs
          .filter((j) => j.subagentSessionId)
          .map((j) => `${j.jobId}=${j.subagentSessionId}`)
          .join(', ');
        return {
          status: 'failed',
          content: [
            {
              type: 'text',
              text:
                `Cannot resume job ${resume}: no subagentSessionId found.\n` +
                `Available jobs: [${jobIds}]\n` +
                `Jobs with sessionId: [${withSession || 'none'}]`,
            },
          ],
        };
      }
      resumeSessionId = previousJob.subagentSessionId;
      // For per_invocation resume, the child session id is the prior one (same
      // session, same container name prefix). The host reuses the pre-existing
      // scratch directory idempotently via mkdirSync({ recursive: true }).
      childSessionId = resumeSessionId;
    } else {
      // Fresh spawn — mint a new session id. Used only when the persona is
      // per_invocation; ignored for all other paths.
      childSessionId = `sess_${randomUUID()}`;
    }

    // --- Step 2: Resolve persona bundle (if any) before any job creation ---
    let personaModelDefault: string | undefined;
    // Set for container personas: the host-side lace-agent reaches into the
    // container for tool exec via this projected binding.
    let projectedRuntimeBinding: RuntimeExecutionBinding | undefined;
    // Scratch dir host path; set for per_invocation personas.
    let scratchDirHostPath: string | undefined;
    // Container sharing mode from the resolved persona runtime.
    let containerSharing: 'per_invocation' | 'persistent' | undefined;
    // Per-invocation container spec name; set for per_invocation personas.
    // Used by the reaper to identify the container to destroy after idle TTL.
    let containerSpecName: string | undefined;

    if (persona) {
      try {
        const parsed = this.personaRegistry.parsePersona(persona);
        // R6 security invariant: per_invocation personas must not share
        // mount-registry names with persistent personas.
        // Readonly mounts are excluded — they carry no write path so they are
        // not an adversarial-write threat.
        assertNoMountConflict(persona, parsed, this.personaRegistry, context.containerMounts ?? {});
        personaModelDefault = parsed.config.model;
        if (parsed.config.runtime.type === 'container') {
          const runtime = parsed.config.runtime;
          containerSharing = runtime.containerSharing;

          // Per-invocation setup is shared by every projected container persona.
          if (runtime.containerSharing === 'per_invocation') {
            // Compute and mkdir the per-invocation scratch directory on the
            // host. Idempotent: the resume path finds an existing dir; the
            // fresh path creates a new one. mode 0o700 applies only to
            // newly created dirs — existing dirs keep their mode.
            const scratchBase = process.env.LACE_WORK_DIR ?? '/var/sen/instance/work';
            scratchDirHostPath = path.join(scratchBase, childSessionId!);
            fs.mkdirSync(scratchDirHostPath, { recursive: true, mode: 0o700 });

            containerSpecName = buildPerInvocationSpecName({
              parentSessionId: context.activeSessionId ?? 'delegate',
              personaName: persona,
              childSessionId: childSessionId!,
            });
          }

          // Project the persona container into a host-side RuntimeExecutionBinding.
          // The session runner threads the embedder-supplied named-mount registry
          // into ToolContext; when absent (e.g. unit-test fixtures), fall back to
          // {} so personas with `mounts: {}` still resolve and personas that do
          // declare mounts fail with a clear "unknown mount" error.
          //
          // The persona-declared image string (tag or digest) flows through
          // verbatim — no pre-resolution. The projected runtime captures the
          // daemon's `.Image` field post-create for audit (see projected-container.ts).
          projectedRuntimeBinding = buildPersonaProjectedRuntimeBinding({
            parentSessionId: context.activeSessionId ?? 'delegate',
            personaName: persona,
            runtime,
            containerMounts: context.containerMounts ?? {},
            ...(runtime.containerSharing === 'per_invocation'
              ? { childSessionId: childSessionId!, scratchDirHostPath }
              : {}),
          });
        }
      } catch (err) {
        if (
          err instanceof PersonaNotFoundError ||
          err instanceof PersonaParseError ||
          err instanceof PersonaSharingViolationError
        ) {
          return {
            status: 'failed',
            content: [{ type: 'text', text: err.message }],
          };
        }
        throw err;
      }
    }

    // Cancel any pending idle-TTL reap for this per_invocation container.
    // Fresh delegates call cancelReap idempotently (no timer exists — safe no-op).
    // Resume delegates cancel the timer that was set when the prior invocation's
    // subagent exited, preserving the container for this new invocation window.
    if (containerSharing === 'per_invocation' && childSessionId && perInvocationReaper) {
      perInvocationReaper.cancelReap(childSessionId);
    }

    // Per-call modelId wins; otherwise fall back to persona default (if any).
    const effectiveModelId = modelId ?? personaModelDefault;
    // Inherit the parent's binding only when the persona doesn't impose its own runtime.
    const inheritedRuntimeBinding = !projectedRuntimeBinding ? runtimeBinding : undefined;
    const effectiveRuntimeBinding = projectedRuntimeBinding ?? inheritedRuntimeBinding;

    // Create the job
    const { jobId, job } = await jobManager.createJob('delegate', {
      prompt,
      description,
      progressIntervalMs,
      connectionId,
      modelId: effectiveModelId,
      turnContext:
        context.turnId && context.turnSeq !== undefined
          ? { turnId: context.turnId, turnSeq: context.turnSeq }
          : undefined,
      ...(persona ? { persona } : {}),
      ...(effectiveRuntimeBinding ? { runtimeBinding: effectiveRuntimeBinding } : {}),
      // Resume: pass prior session id via resumeSessionId (mutually exclusive
      // with newSubagentSessionId — enforced by JobManager).
      ...(resumeSessionId ? { resumeSessionId } : {}),
      // Fresh per_invocation spawn: preallocate the child session id so the
      // container name can be resolved at job-creation time.
      ...(containerSharing === 'per_invocation' && !resume
        ? { newSubagentSessionId: childSessionId }
        : {}),
      ...(containerSharing === 'per_invocation' && scratchDirHostPath
        ? { scratchDirHostPath, containerSharing: 'per_invocation' }
        : {}),
      ...(containerSharing === 'persistent' ? { containerSharing: 'persistent' } : {}),
      ...(containerSpecName ? { containerSpecName } : {}),
      ...(context.containerExecutionIdentity
        ? { containerExecutionIdentity: context.containerExecutionIdentity }
        : {}),
    });

    // Background mode - return immediately
    if (background) {
      const responseObj: Record<string, unknown> = { jobId, status: 'started' };
      if (containerSharing === 'per_invocation') {
        responseObj.subagentSessionId = childSessionId;
        responseObj.scratchDir = scratchDirHostPath;
      }
      return {
        status: 'completed',
        content: [{ type: 'text', text: JSON.stringify(responseObj) }],
      };
    }

    // Sync mode - wait for completion
    const abortPromise = new Promise<never>((_, reject) => {
      context.signal.addEventListener('abort', () => reject(new Error('cancelled')), {
        once: true,
      });
    });

    try {
      await Promise.race([job.completion, abortPromise]);
    } catch {
      job.status = 'cancelled';
      await jobManager.finalizeJob(job);
    }

    // Read output
    const output = jobManager.getJobOutput(jobId);

    const preamble =
      containerSharing === 'per_invocation'
        ? `delegate jobId=${jobId} scratchDir=${scratchDirHostPath ?? ''}\n\n`
        : `delegate jobId=${jobId}\n\n`;

    const status = job.status ?? 'failed';
    return {
      status: status === 'completed' ? 'completed' : status === 'cancelled' ? 'aborted' : 'failed',
      content: [
        {
          type: 'text',
          text: preamble + (output.trim().length > 0 ? output.trim() : '(no output)'),
        },
      ],
    };
  }
}
