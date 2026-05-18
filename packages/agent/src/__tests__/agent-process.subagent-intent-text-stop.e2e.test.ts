// ABOUTME: Kata #31 round 2 E2E reproduction — subagent terminates with
// ABOUTME: status='completed' after the model returns text-only intent ("I'll
// ABOUTME: add a brief note") on the turn following a successful tool result,
// ABOUTME: instead of actually calling the tool that would do the work.
// ABOUTME:
// ABOUTME: TEST-ONLY. The fix is a separate worker's job — do not modify the
// ABOUTME: runner here. The unit-level companion file
// ABOUTME: packages/agent/src/core/conversation/__tests__/runner.intent-text-stop.test.ts
// ABOUTME: pins the same behaviour deterministically; this E2E test proves the
// ABOUTME: path connects end-to-end through the subagent job pipeline.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createE2EContext,
  spawnAgentProcess,
  withTimeout,
  defaultInitializeParams,
} from './helpers';

interface JobUpdate {
  type?: string;
  jobId?: string;
  jobType?: string;
  update?: { type?: string; text?: string };
  outcome?: string;
}

describe('lace-agent subagent intent-text-stop (kata #31 round 2)', () => {
  const ctx = createE2EContext({ prefix: 'lace-agent-subagent-intent-text-stop' });

  beforeEach(() => ctx.setup());
  afterEach(() => ctx.teardown());

  /**
   * Production parallel:
   *   • Persona "therapist" has tools: [file_read, file_write].
   *   • Subagent prompt: "read file persona/persona.md" — model emits
   *     file_read tool_use on turn 1.
   *   • file_read returns content (here, an empty file).
   *   • Turn 2: the model returns text-only "I'll add a brief note at the
   *     end in Ada's voice." with stopReason='end_turn' and NO tool_use.
   *   • Production observed: subagent terminates as status='completed' with
   *     that intent text as final output. The host-side persona.md is never
   *     written; the work the model declared never happens.
   *
   * What this test pins:
   *   When the subagent's turn following a tool round-trip produces intent
   *   text with no tool call, the subagent's job must NOT report
   *   status='completed' with that intent text as its sole output. The
   *   parent should be able to distinguish "subagent did the work" from
   *   "subagent declared work and didn't do it".
   *
   * What a fix needs to change:
   *   Either the subagent's runner re-prompts more aggressively until a tool
   *   actually fires (bounded by max-turns), or the subagent job surfaces a
   *   non-'completed' status to its parent so the parent can react.
   *
   * Driving knob:
   *   The TestAgentProvider env var
   *   LACE_TEST_PROVIDER_INTENT_AFTER_TOOL_RESULT replaces the usual
   *   "Result:\n…" turn-2 summary with the configured intent string, so the
   *   subagent observes the production-shape Turn-2 response.
   */
  it(
    'FAILING — subagent with intent-only turn-2 should NOT report status=completed with intent text as final output',
    { timeout: 30_000 },
    async () => {
      // Persona declares both read and write tools so the model is *allowed*
      // to call file_write on turn 2 — it simply chooses not to (modeled by
      // the env-injected intent text). This matches the production therapist
      // case where Ada had file_read + file_write available.
      const personasDir = join(ctx.laceDir, 'agent-personas');
      mkdirSync(personasDir, { recursive: true });
      writeFileSync(
        join(personasDir, 'therapist.md'),
        '---\ntools:\n  - file_read\n  - file_write\n---\nYou are a therapist.\n'
      );

      const intentText = "I'll add a brief note at the end in Ada's voice.";

      ctx.agent = spawnAgentProcess({
        laceDir: ctx.laceDir,
        env: {
          // Faithful wire-tools mode so the subagent's TestAgentProvider only
          // emits file_read if it's actually in the wire payload (it should
          // be — persona tools are additive over builtins after the kata #31
          // round-1 fix).
          LACE_TEST_PROVIDER_RESPECT_WIRE_TOOLS: '1',
          // Inject the production-shape Turn-2 intent text. The provider
          // replaces the usual "Result:\n<tool output>" with this string on
          // any turn following a tool result.
          LACE_TEST_PROVIDER_INTENT_AFTER_TOOL_RESULT: intentText,
        },
      });

      const updates: Array<Record<string, unknown>> = [];
      let subagentJobId: string | undefined;

      ctx.agent.peer.onRequest('session/update', async (params) => {
        const p = params as Record<string, unknown>;
        updates.push(p);
        if (p.type === 'job_started' && p.jobType === 'delegate' && typeof p.jobId === 'string') {
          subagentJobId = p.jobId;
        }
        return undefined;
      });

      ctx.agent.peer.onRequest('session/request_permission', async () => ({
        decision: 'allow',
      }));

      await withTimeout(
        ctx.agent.peer.request(
          'initialize',
          defaultInitializeParams({ config: { approvalMode: 'allow' } })
        ),
        2_000,
        'initialize'
      );
      await withTimeout(
        ctx.agent.peer.request('session/new', { workDir: ctx.workDir }),
        2_000,
        'session/new'
      );

      // Seed the file the subagent will read so file_read succeeds. The
      // content is intentionally empty-ish (mirroring the production trace
      // where Ada read an "essentially empty" file).
      writeFileSync(join(ctx.workDir, 'persona.md'), '');

      // Parent's TestAgentProvider matches "subagent persona=therapist: read
      // file persona.md" and dispatches a delegate tool call. The subagent
      // then receives "read file persona.md" as its session/prompt, matches
      // the file_read pattern, and emits tool_use(file_read) on turn 1.
      // After the file_read tool returns (file is empty), turn 2 is what we
      // care about: with the intent-after-tool-result env set, the provider
      // emits the configured intent string and no tool_use.
      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'subagent persona=therapist: read file persona.md' }],
        }),
        20_000,
        'session/prompt'
      );

      await withTimeout(
        new Promise<void>((resolve) => {
          const interval = setInterval(() => {
            if (!subagentJobId) return;
            const finished = updates.find(
              (u) => u.type === 'job_finished' && u.jobId === subagentJobId
            );
            if (finished) {
              clearInterval(interval);
              resolve();
            }
          }, 10);
        }),
        20_000,
        'job_finished update'
      );

      const output = (await withTimeout(
        ctx.agent.peer.request('ent/job/output', { jobId: subagentJobId }),
        2_000,
        'ent/job/output'
      )) as { status: string; output: string };

      // Sanity: the subagent actually went through a tool round-trip — there
      // should be a file_read tool_use event in the forwarded job updates.
      const sawFileRead = updates.some((u) => {
        if (u.type !== 'job_update') return false;
        const update = (u as { update?: JobUpdate['update'] }).update;
        return (
          update?.type === 'tool_use' &&
          (u as Record<string, unknown>).jobType === 'delegate' &&
          // The job-update's update payload may carry the tool name on
          // either `name` (preferred) or in toolCallId-tagged form.
          ((update as unknown as { name?: string }).name === 'file_read' ||
            // Fall back to checking the forwarded raw update fields.
            JSON.stringify(update).includes('file_read'))
        );
      });
      // If sawFileRead is false, the kata #31 round-1 fix (persona tools
      // additive over lace builtins) has regressed and we never exercised the
      // tool round-trip the test depends on.
      expect(sawFileRead).toBe(true);

      // FAILING ASSERTION — pins the production bug:
      //
      // Today the subagent's job ends with status='completed' and output
      // containing the intent string as the model's final response. The
      // subagent declared it would write the file but never called
      // file_write; the runner accepted the text-only turn-2 response as a
      // clean termination.
      //
      // A robust fix must either:
      //   (a) drive enough additional model turns to force a file_write
      //       (bounded by max-turns), or
      //   (b) surface a non-'completed' status to the parent (e.g. 'failed',
      //       or a new 'incomplete') so the parent can react.
      //
      // Either way, the conjunction below must be falsified:
      // Failure context (visible in the assertion diff): if this conjunction
      // is truthy, the subagent terminated as 'completed' with the
      // unfulfilled intent string as its final output. That is the production
      // bug. The fix should either drive more model turns until a tool fires,
      // or change the job status away from 'completed' so the parent can
      // react.
      const finalOutputContainsIntent = output.output.includes(intentText);
      const completedWithIntentOnly = output.status === 'completed' && finalOutputContainsIntent;

      expect({
        status: output.status,
        outputContainsUnfulfilledIntent: finalOutputContainsIntent,
        completedWithIntentOnly,
      }).toMatchObject({ completedWithIntentOnly: false });
    }
  );

  /**
   * Negative companion: a subagent that responds with pure text (no prior
   * tool call) is fine — pure-text answers to non-tool-requiring prompts
   * are legitimate. The fix for the bug above must NOT cause this to
   * regress.
   *
   * This test does NOT use LACE_TEST_PROVIDER_INTENT_AFTER_TOOL_RESULT (the
   * env switch only activates when a tool result is present in the
   * conversation), so the parent agent's first turn goes straight to a
   * pure-text response.
   */
  it(
    'PASSING — subagent without any tool call (legit pure-text answer) completes cleanly',
    { timeout: 20_000 },
    async () => {
      const personasDir = join(ctx.laceDir, 'agent-personas');
      mkdirSync(personasDir, { recursive: true });
      writeFileSync(
        join(personasDir, 'philosopher.md'),
        '---\ntools:\n  - file_read\n---\nYou are a philosopher.\n'
      );

      ctx.agent = spawnAgentProcess({
        laceDir: ctx.laceDir,
        env: {
          LACE_TEST_PROVIDER_RESPECT_WIRE_TOOLS: '1',
          // No intent-text injection — provider behaves normally.
        },
      });

      const updates: Array<Record<string, unknown>> = [];
      let subagentJobId: string | undefined;

      ctx.agent.peer.onRequest('session/update', async (params) => {
        const p = params as Record<string, unknown>;
        updates.push(p);
        if (p.type === 'job_started' && p.jobType === 'delegate' && typeof p.jobId === 'string') {
          subagentJobId = p.jobId;
        }
        return undefined;
      });

      ctx.agent.peer.onRequest('session/request_permission', async () => ({
        decision: 'allow',
      }));

      await withTimeout(
        ctx.agent.peer.request(
          'initialize',
          defaultInitializeParams({ config: { approvalMode: 'allow' } })
        ),
        2_000,
        'initialize'
      );
      await withTimeout(
        ctx.agent.peer.request('session/new', { workDir: ctx.workDir }),
        2_000,
        'session/new'
      );

      // The subagent's prompt does not match any tool-emitting regex in
      // TestAgentProvider, so the subagent's provider returns pure text on
      // turn 1 with no tool_use. This is the legitimate "answer the
      // question without tools" path.
      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [
            {
              type: 'text',
              text: 'subagent persona=philosopher: please muse about software',
            },
          ],
        }),
        10_000,
        'session/prompt'
      );

      await withTimeout(
        new Promise<void>((resolve) => {
          const interval = setInterval(() => {
            if (!subagentJobId) return;
            const finished = updates.find(
              (u) => u.type === 'job_finished' && u.jobId === subagentJobId
            );
            if (finished) {
              clearInterval(interval);
              resolve();
            }
          }, 10);
        }),
        10_000,
        'job_finished update'
      );

      const output = (await withTimeout(
        ctx.agent.peer.request('ent/job/output', { jobId: subagentJobId }),
        2_000,
        'ent/job/output'
      )) as { status: string; output: string };

      // A subagent that answers a non-tool-requiring question with pure text
      // is a clean completion. The fix for the FAILING test above must not
      // regress this path.
      expect(output.status).toBe('completed');
    }
  );
});
