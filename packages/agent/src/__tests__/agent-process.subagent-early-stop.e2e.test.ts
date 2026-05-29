// ABOUTME: Reproduces kata #31 — subagents terminating after a single assistant
// ABOUTME: turn when the persona declares a tool scope. The subagent should run
// ABOUTME: the turn loop until the model returns a non-tool response, even when
// ABOUTME: spawned with a persona that filters its available tools.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createE2EContext,
  spawnAgentProcess,
  withTimeout,
  defaultInitializeParams,
} from './helpers';

describe('lace-agent subagent early-stop bug (kata #31)', () => {
  const ctx = createE2EContext({ prefix: 'lace-agent-subagent-early-stop' });

  beforeEach(() => ctx.setup());
  afterEach(() => ctx.teardown());

  it(
    'subagent with persona toolScope completes ≥2 model turns when the prompt requires a tool call',
    { timeout: 20_000 },
    async () => {
      // Write a user persona whose toolScope includes file_read but has a
      // narrow scope overall. With verbatim-allowlist semantics (PRI-1900),
      // tools: is the complete set — personas must explicitly list every tool
      // they need, including builtins. The kata-#31 regression is that
      // subagents stop after a single turn when a toolScope is present; the
      // fix is tested by confirming the subagent completes ≥2 model turns
      // (one to call file_read, one to summarise the result).
      const personasDir = join(ctx.laceDir, 'agent-personas');
      mkdirSync(personasDir, { recursive: true });
      writeFileSync(
        join(personasDir, 'librarian.md'),
        '---\ntools:\n  - bash\n  - file_read\n---\nYou are a librarian.\n'
      );

      // Opt the TestAgentProvider into faithful wire-tools mode so it only
      // emits tool_use for tools actually present in the wire payload. This
      // is required to reproduce kata #31, which arises specifically when
      // the model has no in-scope tool to call.
      ctx.agent = spawnAgentProcess({
        laceDir: ctx.laceDir,
        env: { LACE_TEST_PROVIDER_RESPECT_WIRE_TOOLS: '1' },
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

      ctx.agent.peer.onRequest('session/request_permission', async () => ({ decision: 'allow' }));

      await withTimeout(
        ctx.agent.peer.request(
          'initialize',
          defaultInitializeParams({ config: { approvalMode: 'allow' } })
        ),
        2_000,
        'initialize'
      );
      await withTimeout(
        ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
        2_000,
        'session/new'
      );

      // The parent's TestAgentProvider recognizes "subagent persona=<name>: <prompt>"
      // and issues a delegate tool call with prompt=<prompt> and persona=<name>.
      // The subagent then receives "read file foo.txt" as its session/prompt,
      // which its own TestAgentProvider matches → tool_use(file_read).
      // After tool execution, a second model call should occur, returning
      // "Result:\n<tool output>" (success or error text). If the subagent
      // stops early (kata #31), the output will not contain "Result:".
      await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'subagent persona=librarian: read file foo.txt' }],
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

      // The subagent should have completed and produced "Result:" output,
      // proving the second provider call occurred after tool execution.
      // Kata #31 manifests when the subagent's persona toolScope excludes
      // tools its prompt would need: the model returns text-only intent on
      // the first turn (no tool_use), so the runner immediately ends the
      // turn loop and output contains only the intent string.
      expect(output.status).toBe('completed');
      expect(output.output).toContain('Result:');
    }
  );
});
