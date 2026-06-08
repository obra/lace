// ABOUTME: Full-chain test that the credentialBrokerSocket supplied at initialize config flows
// through session/new → prompt → runner → exec-tool adapter into the credential tool's invocation
// envelope. Exercises the real agent process end to end; a getEffectiveConfig-in-isolation test
// would give a false green because session/new builds session config by explicit field enumeration.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createE2EContext,
  spawnAgentProcess,
  withTimeout,
  defaultInitializeParams,
} from './helpers';

// A tiny exec-tool that answers `lace-tool-schema` with a request_credential descriptor
// (declaring the credentials capability) and, on `lace-tool-invoke`, echoes back the context
// block it received as its tool result content so the test can inspect socket forwarding.
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
  const dir = mkdtempSync(join(tmpdir(), 'lace-cred-chain-fixture-'));
  const bin = join(dir, 'request-credential');
  writeFileSync(bin, FIXTURE_SCRIPT);
  chmodSync(bin, 0o755);
  return dir;
}

describe('credentialBrokerSocket full chain (initialize → session/new → prompt → envelope)', () => {
  const ctx = createE2EContext({ prefix: 'lace-cred-chain' });
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
    'stamps the initialize-config broker socket into the credential tool envelope',
    { timeout: 20_000 },
    async () => {
      ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });

      const updates: Array<Record<string, unknown>> = [];
      ctx.agent.peer.onRequest('session/update', async (params) => {
        updates.push(params as Record<string, unknown>);
        return undefined;
      });

      await withTimeout(
        ctx.agent.peer.request('initialize', {
          ...defaultInitializeParams({
            config: {
              credentialBrokerSocket: '/tmp/x.sock',
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

      const promptResult = (await withTimeout(
        ctx.agent.peer.request('session/prompt', {
          content: [{ type: 'text', text: 'request credential linear-api-key' }],
        }),
        10_000,
        'session/prompt'
      )) as { turnId: string };

      await withTimeout(
        new Promise<void>((resolve) => {
          const interval = setInterval(() => {
            const match = updates.find(
              (p) =>
                p?.type === 'tool_use' &&
                p?.name === 'request_credential' &&
                p?.status === 'completed' &&
                p?.turnId === promptResult.turnId
            );
            if (match) {
              clearInterval(interval);
              resolve();
            }
          }, 10);
        }),
        8_000,
        'tool_use stream for request_credential'
      );

      const toolUse = updates.find(
        (p) =>
          p?.type === 'tool_use' &&
          p?.name === 'request_credential' &&
          p?.status === 'completed' &&
          p?.turnId === promptResult.turnId
      );
      expect(toolUse).toBeDefined();

      const result = (toolUse?.result as { content?: Array<{ text?: string }> }) ?? {};
      const text = (result.content ?? []).map((b) => b.text ?? '').join('');
      const envelopeContext = JSON.parse(text) as Record<string, unknown>;

      expect(envelopeContext.credentialBrokerSocket).toBe('/tmp/x.sock');
    }
  );
});
