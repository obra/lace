// ABOUTME: W5b/W5c deploy-gate test — Part B lace credential wiring with REAL components.
// ABOUTME: Persona advertise gating, untrusted-provenance non-forwarding, the main-agent
// ABOUTME: envelope (socket + role), and the subagent child path (the W5c gap) over a spawned agent.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import {
  createAgentServerState,
  createToolExecutorForMode,
  registerAgentRpcMethods,
} from '../server';
import { registries, resetRegistriesForTest } from '@lace/agent/plugins';
import { registerExecDirInto } from '../tools/exec/register-exec';
import { registerBuiltinTools } from '../tools/builtins';
import {
  createE2EContext,
  spawnAgentProcess,
  withTimeout,
  defaultInitializeParams,
} from './helpers';

// A tiny exec-tool that advertises request_credential (with the credentials
// capability) and, on invoke, echoes the context block it received so the test
// can inspect role + socket forwarding. Mirrors the real binary's protocol.
const FIXTURE_SCRIPT = `#!/usr/bin/env node
const mode = process.argv[2];
if (mode === 'lace-tool-schema') {
  process.stdout.write(JSON.stringify({
    name: 'request_credential',
    description: 'fixture credential exec-tool',
    inputSchema: { type: 'object', properties: {} },
    capabilities: ['credentials'],
  }));
  process.exit(0);
}
let buf = '';
process.stdin.on('data', (d) => { buf += d; });
process.stdin.on('end', () => {
  const env = JSON.parse(buf || '{}');
  process.stdout.write(JSON.stringify({ content: JSON.stringify(env.context ?? {}) }));
  process.exit(0);
});
`;

function makeFixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lace-cred-integration-fixture-'));
  const bin = join(dir, 'request-credential');
  writeFileSync(bin, FIXTURE_SCRIPT);
  chmodSync(bin, 0o755);
  return dir;
}

function createPairedPeers(register: (peer: JsonRpcPeer) => void) {
  const aToB = new PassThrough();
  const bToA = new PassThrough();
  const clientTransport = createNdjsonStdioTransport({ readable: bToA, writable: aToB });
  const serverTransport = createNdjsonStdioTransport({ readable: aToB, writable: bToA });
  const client = new JsonRpcPeer(clientTransport, { idPrefix: 'c_' });
  const server = new JsonRpcPeer(serverTransport, { idPrefix: 'a_' });
  register(server);
  return { client, server };
}

describe('Part B credential integration (lace wiring + subagent path)', () => {
  // (i)-(iii) drive an in-process agent server over paired peers; (iv) spawns a
  // real subagent child process. Both touch the process-global tool registry, so
  // this file runs serial (--no-file-parallelism, per the lace src/__tests__ convention).

  describe('(i) request_credential is advertised only to a persona that lists it', () => {
    let fixtureDir: string;

    beforeEach(() => {
      resetRegistriesForTest();
      registerBuiltinTools();
      fixtureDir = makeFixtureDir();
      // Global, trusted registration — exactly what initialize.ts does from
      // credentialToolsPaths (owner 'credential' carves the reserved-name throw).
      registerExecDirInto(fixtureDir, { owner: 'credential', trustedCredentialProvenance: true });
    });

    afterEach(() => {
      rmSync(fixtureDir, { recursive: true, force: true });
      resetRegistriesForTest();
    });

    it('survives executor construction and is advertised when toolScope lists it', async () => {
      expect(registries.tools.has('request_credential')).toBe(true);

      // A box-worker persona's toolScope lists request_credential → advertised.
      const { toolsForProvider } = await createToolExecutorForMode(
        'execute',
        undefined,
        undefined,
        undefined,
        ['bash', 'request_credential']
      );
      expect(toolsForProvider.map((t) => t.name)).toContain('request_credential');
    });

    it('is NOT advertised to a persona whose toolScope omits it', async () => {
      // core-like persona: lists tools but not request_credential. The broker is
      // the real boundary, but availability gating still must not surface it here.
      const { toolsForProvider } = await createToolExecutorForMode(
        'execute',
        undefined,
        undefined,
        undefined,
        ['bash', 'file_read']
      );
      expect(toolsForProvider.map((t) => t.name)).not.toContain('request_credential');
    });
  });

  describe('(ii) untrusted provenance does not forward the broker socket', () => {
    let fixtureDir: string;

    beforeEach(() => {
      fixtureDir = makeFixtureDir();
    });

    afterEach(() => {
      rmSync(fixtureDir, { recursive: true, force: true });
      resetRegistriesForTest();
    });

    const invokeAndReadContext = async (): Promise<Record<string, unknown>> => {
      const { executor } = await createToolExecutorForMode('execute');
      const result = await executor.execute(
        { id: 't1', name: 'request_credential', arguments: {} },
        {
          activeSessionId: 'sess-1',
          persona: 'engineer',
          credentialBrokerSocket: '/run/cred.sock',
          roleEnvironment: 'prod',
        }
      );
      const text = result.content.map((b) => b.text ?? '').join('');
      return JSON.parse(text) as Record<string, unknown>;
    };

    it('forwards the socket with trusted provenance, withholds it without', async () => {
      resetRegistriesForTest();
      registerBuiltinTools();
      registerExecDirInto(fixtureDir, { owner: 'credential', trustedCredentialProvenance: true });
      const trustedCtx = await invokeAndReadContext();
      expect(trustedCtx.credentialBrokerSocket).toBe('/run/cred.sock');

      resetRegistriesForTest();
      registerBuiltinTools();
      // Same dir, same self-declared credentials capability — but NOT trusted.
      registerExecDirInto(fixtureDir, { owner: 'credential' });
      const untrustedCtx = await invokeAndReadContext();
      expect(untrustedCtx.credentialBrokerSocket).toBeUndefined();
    });
  });

  describe('(iii) the main-agent envelope carries credentialBrokerSocket + role', () => {
    let originalLaceDir: string | undefined;
    let tempDir: string;
    let fixtureDir: string;

    beforeEach(() => {
      resetRegistriesForTest();
      originalLaceDir = process.env.LACE_DIR;
      tempDir = mkdtempSync(join(tmpdir(), 'lace-cred-mainagent-'));
      process.env.LACE_DIR = tempDir;
      fixtureDir = makeFixtureDir();
    });

    afterEach(() => {
      if (originalLaceDir === undefined) delete process.env.LACE_DIR;
      else process.env.LACE_DIR = originalLaceDir;
      rmSync(tempDir, { recursive: true, force: true });
      rmSync(fixtureDir, { recursive: true, force: true });
      resetRegistriesForTest();
    });

    it('stamps the initialize-config socket and a role into the credential tool envelope', async () => {
      const state = createAgentServerState();
      const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

      await client.request('initialize', {
        ...defaultInitializeParams({
          config: { credentialBrokerSocket: '/run/role.sock' },
        }),
        credentialToolsPaths: [fixtureDir],
      });

      // Invoke the registered credential tool with a session-stamped role +
      // broker socket (the runner's effectiveConfig provides both). The fixture
      // echoes the envelope context back as its tool result.
      const { executor } = await createToolExecutorForMode('execute');
      const result = await executor.execute(
        { id: 't1', name: 'request_credential', arguments: {} },
        {
          activeSessionId: 'sess-1',
          persona: 'persistent-box-worker',
          credentialBrokerSocket: '/run/role.sock',
          roleEnvironment: 'persistent-box',
        }
      );
      const text = result.content.map((b) => b.text ?? '').join('');
      const envelopeContext = JSON.parse(text) as Record<string, unknown>;

      expect(envelopeContext.credentialBrokerSocket).toBe('/run/role.sock');
      // The role is stamped from session state, not model args — a prompt-injected
      // persona cannot forge it.
      expect(envelopeContext.role).toBe('persistent-box-worker');

      client.close();
      server.close();
    });
  });

  describe('(iv) subagent child path — the W5c gap (spawned agent process)', () => {
    const ctx = createE2EContext({ prefix: 'lace-cred-subagent' });
    let fixtureDir: string;

    beforeEach(() => {
      ctx.setup();
      fixtureDir = makeFixtureDir();
    });

    afterEach(async () => {
      await ctx.teardown();
      rmSync(fixtureDir, { recursive: true, force: true });
    });

    it(
      'a delegated child registers request_credential and its envelope forwards the broker socket',
      { timeout: 20_000 },
      async () => {
        ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

        const updates: Array<Record<string, unknown>> = [];
        let delegateJobId: string | undefined;

        ctx.agent.peer.onRequest('session/update', async (params) => {
          const p = params as Record<string, unknown>;
          updates.push(p);
          if (p.type === 'job_started' && p.jobType === 'delegate' && typeof p.jobId === 'string') {
            delegateJobId = p.jobId;
          }
          return undefined;
        });
        ctx.agent.peer.onRequest('session/request_permission', async () => ({ decision: 'allow' }));

        await withTimeout(
          ctx.agent.peer.request('initialize', {
            ...defaultInitializeParams({
              config: {
                credentialBrokerSocket: '/run/child-role.sock',
                approvalMode: 'dangerouslySkipPermissions',
              },
            }),
            credentialToolsPaths: [fixtureDir],
          }),
          5_000,
          'initialize'
        );
        await withTimeout(
          ctx.agent.peer.request('session/new', { cwd: ctx.workDir, mcpServers: [] }),
          5_000,
          'session/new'
        );

        // The parent delegates; the child receives "request credential linear-api-key"
        // and calls request_credential. The child only has that tool if its own
        // initialize received credentialToolsPaths (C2) and re-registered it.
        await withTimeout(
          ctx.agent.peer.request('session/prompt', {
            content: [{ type: 'text', text: 'delegate request credential linear-api-key' }],
          }),
          10_000,
          'session/prompt'
        );

        await withTimeout(
          new Promise<void>((resolve) => {
            const interval = setInterval(() => {
              if (!delegateJobId) return;
              const finished = updates.find(
                (u) => u.type === 'job_finished' && u.jobId === delegateJobId
              );
              if (finished) {
                clearInterval(interval);
                resolve();
              }
            }, 10);
          }),
          12_000,
          'delegate job completion'
        );

        const output = (await withTimeout(
          ctx.agent.peer.request('ent/job/output', { jobId: delegateJobId }),
          5_000,
          'ent/job/output'
        )) as { status: string; output: string };

        expect(output.status).toBe('completed');
        // The child's request_credential tool result is the echoed envelope context.
        // Its presence proves the child registered the tool (C2 forwarded the dir);
        // the socket value proves the child stamped it (broker socket reached the child).
        const childContext = extractCredentialEnvelopeContext(output.output);
        expect(childContext.credentialBrokerSocket).toBe('/run/child-role.sock');
      }
    );
  });
});

// The subagent's job output embeds the fixture's echoed envelope-context JSON in
// a "[tool_result: request_credential → {…}]" segment. Parse that first complete
// JSON object (the output also repeats it in a trailing "Result:\n{…}" summary).
function extractCredentialEnvelopeContext(output: string): Record<string, unknown> {
  const marker = 'request_credential → ';
  const at = output.indexOf(marker);
  const start = at === -1 ? output.indexOf('{') : output.indexOf('{', at);
  if (start === -1) throw new Error(`no JSON object in subagent output: ${output}`);
  let depth = 0;
  for (let i = start; i < output.length; i++) {
    if (output[i] === '{') depth++;
    else if (output[i] === '}') {
      depth--;
      if (depth === 0) return JSON.parse(output.slice(start, i + 1)) as Record<string, unknown>;
    }
  }
  throw new Error(`unterminated JSON object in subagent output: ${output}`);
}
