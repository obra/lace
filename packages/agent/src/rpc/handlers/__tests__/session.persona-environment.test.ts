// ABOUTME: Verifies session/new (and resume) materializes a container runtime binding
// ABOUTME: for the MAIN session when the persona declares a container environment.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../../../server';
import { defaultInitializeParams } from '../../../__tests__/helpers/initialize';
import { getSessionDir } from '../../../storage/session-store';

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

const CONTAINER_PERSONA = `---
runtime:
  type: container
  environment: boxed-env
---
You run in a box.
`;

const HOST_PERSONA = `---
model: anthropic/claude-3-5-haiku
---
You run on the host.
`;

const CONTAINER_ENV = `---
runtime:
  type: container
  containerSharing: persistent
  image: sen-persistent-box:dev
  workingDirectory: /home/sen
  mounts:
    - knowledge
---
`;

function readPersistedRuntimeBinding(sessionId: string): {
  toolRuntime: { type: string };
} {
  const statePath = join(getSessionDir(sessionId), 'state.json');
  const parsed = JSON.parse(readFileSync(statePath, 'utf8')) as {
    config?: { runtimeBinding?: { toolRuntime: { type: string } } };
  };
  if (!parsed.config?.runtimeBinding) {
    throw new Error('no runtimeBinding persisted');
  }
  return parsed.config.runtimeBinding;
}

describe('session/new honors a persona container environment', () => {
  let originalLaceDir: string | undefined;
  let originalTestProvider: string | undefined;
  let tempDir: string;
  let workDir: string;
  let personasDir: string;
  let environmentsDir: string;

  beforeEach(() => {
    originalLaceDir = process.env.LACE_DIR;
    originalTestProvider = process.env.LACE_AGENT_TEST_PROVIDER;

    tempDir = mkdtempSync(join(tmpdir(), 'lace-persona-env-'));
    workDir = mkdtempSync(join(tmpdir(), 'lace-persona-env-wd-'));
    process.env.LACE_DIR = tempDir;
    process.env.LACE_AGENT_TEST_PROVIDER = '1';

    personasDir = join(tempDir, 'personas');
    environmentsDir = join(tempDir, 'environments');
    mkdirSync(personasDir, { recursive: true });
    mkdirSync(environmentsDir, { recursive: true });
    writeFileSync(join(personasDir, 'boxed.md'), CONTAINER_PERSONA);
    writeFileSync(join(personasDir, 'plain.md'), HOST_PERSONA);
    writeFileSync(join(environmentsDir, 'boxed-env.md'), CONTAINER_ENV);
  });

  afterEach(() => {
    if (originalLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = originalLaceDir;
    if (originalTestProvider === undefined) delete process.env.LACE_AGENT_TEST_PROVIDER;
    else process.env.LACE_AGENT_TEST_PROVIDER = originalTestProvider;

    rmSync(tempDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  function initParams() {
    return {
      ...defaultInitializeParams(
        {},
        {
          userPersonasPaths: [personasDir],
          containerMounts: {
            knowledge: {
              hostPath: workDir,
              containerPath: '/knowledge',
              readonly: true,
            },
          },
        }
      ),
      userEnvironmentsPaths: [environmentsDir],
    };
  }

  it('persists a container binding for a container persona', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    try {
      await client.request('initialize', initParams());
      const result = (await client.request('session/new', {
        cwd: workDir,
        mcpServers: [],
        persona: 'boxed',
      })) as { sessionId: string };

      const binding = readPersistedRuntimeBinding(result.sessionId);
      expect(binding.toolRuntime.type).toBe('container');
    } finally {
      client.close();
      server.close();
    }
  });

  it('persists a boundedHost binding for a host persona', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    try {
      await client.request('initialize', initParams());
      const result = (await client.request('session/new', {
        cwd: workDir,
        mcpServers: [],
        persona: 'plain',
      })) as { sessionId: string };

      const binding = readPersistedRuntimeBinding(result.sessionId);
      expect(binding.toolRuntime.type).toBe('boundedHost');
    } finally {
      client.close();
      server.close();
    }
  });

  it('persists a boundedHost binding when no persona is supplied', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    try {
      await client.request('initialize', initParams());
      const result = (await client.request('session/new', {
        cwd: workDir,
        mcpServers: [],
      })) as { sessionId: string };

      const binding = readPersistedRuntimeBinding(result.sessionId);
      expect(binding.toolRuntime.type).toBe('boundedHost');
    } finally {
      client.close();
      server.close();
    }
  });
});
