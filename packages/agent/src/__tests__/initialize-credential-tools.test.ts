// ABOUTME: Tests that the initialize handler registers embedder-supplied credentialToolsPaths
// exec-dirs globally with trusted provenance, persists them on state, and that only a
// trusted-provenance registration forwards the credential broker socket to the binary.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../server';
import { defaultInitializeParams } from './helpers/initialize';
import { registries, resetRegistriesForTest } from '@lace/agent/plugins';
import { registerExecDirInto } from '../tools/exec/register-exec';
import { registerBuiltinTools } from '../tools/builtins';
import { ToolExecutor } from '../tools/executor';

// A tiny exec-tool that answers `lace-tool-schema` with a request_credential descriptor
// (declaring the credentials capability) and, on `lace-tool-invoke`, echoes back the
// context block it received so the test can inspect socket forwarding.
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
  const dir = mkdtempSync(join(tmpdir(), 'lace-cred-fixture-'));
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

describe('initialize credentialToolsPaths', () => {
  let originalLaceDir: string | undefined;
  let tempDir: string;
  let fixtureDir: string;

  beforeEach(() => {
    resetRegistriesForTest();
    originalLaceDir = process.env.LACE_DIR;
    tempDir = mkdtempSync(join(tmpdir(), 'lace-agent-credtools-'));
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

  it('registers the dir globally, keeps the reserved name, and persists the paths', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    // (a) initialize (which builds the tool executor) does NOT throw despite
    // request_credential being a reserved per-session builtin name.
    await client.request('initialize', {
      ...defaultInitializeParams(),
      credentialToolsPaths: [fixtureDir],
    });

    // (b) request_credential is registered in the global tool registry.
    expect(registries.tools.has('request_credential')).toBe(true);
    expect(registries.tools.owner('request_credential')).toBe('credential');

    // (d) the paths are persisted on state.
    expect(state.credentialToolsPaths).toEqual([fixtureDir]);

    client.close();
    server.close();
  });

  it('defaults credentialToolsPaths to [] when omitted', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));

    await client.request('initialize', defaultInitializeParams());

    expect(state.credentialToolsPaths).toEqual([]);
    expect(registries.tools.has('request_credential')).toBe(false);

    client.close();
    server.close();
  });

  it('forwards the broker socket only when the dir is registered with trusted provenance', async () => {
    // (c) Trusted provenance forwards credentialBrokerSocket; untrusted does not,
    // even though the binary self-declares the credentials capability.
    const invokeAndReadContext = async (): Promise<Record<string, unknown>> => {
      const executor = new ToolExecutor();
      executor.registerAllAvailableTools();
      const tool = executor.getTool('request_credential');
      expect(tool).toBeDefined();
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

    resetRegistriesForTest();
    registerBuiltinTools();
    registerExecDirInto(fixtureDir, { owner: 'credential', trustedCredentialProvenance: true });
    const trustedCtx = await invokeAndReadContext();
    expect(trustedCtx.credentialBrokerSocket).toBe('/run/cred.sock');

    resetRegistriesForTest();
    registerBuiltinTools();
    registerExecDirInto(fixtureDir, { owner: 'credential' });
    const untrustedCtx = await invokeAndReadContext();
    expect(untrustedCtx.credentialBrokerSocket).toBeUndefined();
  });
});
