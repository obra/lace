// ABOUTME: Verifies session/new (and resume) materializes a container runtime binding
// ABOUTME: for the MAIN session when the persona declares a container environment.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
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

const CONTAINER_PERSONA_BAD_ENV = `---
runtime:
  type: container
  environment: does-not-exist
---
You declare a box whose environment is missing.
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
    writeFileSync(join(personasDir, 'boxed-broken.md'), CONTAINER_PERSONA_BAD_ENV);
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

  // SECURITY REGRESSION: a persona that DECLARES a container environment whose
  // environment can't resolve must FAIL session creation — never silently fall
  // back to a host-bound (unboxed) session.
  it('fails closed when a container persona references a missing environment', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    try {
      await client.request('initialize', initParams());

      await expect(
        client.request('session/new', {
          cwd: workDir,
          mcpServers: [],
          persona: 'boxed-broken',
        })
      ).rejects.toThrow(/does-not-exist/);

      // Assert no host-bound session leaked through: every persisted session for
      // this persona must NOT carry a boundedHost/host binding. We scan the lace
      // sessions dir; either no session was created, or none is host-bound.
      const sessionsRoot = join(tempDir, 'sessions');
      let created: string[] = [];
      try {
        created = readdirSync(sessionsRoot).filter((name) => name.startsWith('sess_'));
      } catch {
        created = [];
      }
      for (const sessionId of created) {
        const statePath = join(getSessionDir(sessionId), 'state.json');
        let raw: string;
        try {
          raw = readFileSync(statePath, 'utf8');
        } catch {
          continue;
        }
        const parsed = JSON.parse(raw) as {
          config?: { personaName?: string; runtimeBinding?: { toolRuntime: { type: string } } };
        };
        if (parsed.config?.personaName === 'boxed-broken') {
          const type = parsed.config.runtimeBinding?.toolRuntime.type;
          expect(type).not.toBe('boundedHost');
          expect(type).not.toBe('host');
        }
      }
    } finally {
      client.close();
      server.close();
    }
  });

  it('preserves a container binding across resume', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    try {
      await client.request('initialize', initParams());
      const result = (await client.request('session/new', {
        cwd: workDir,
        mcpServers: [],
        persona: 'boxed',
      })) as { sessionId: string };

      expect(readPersistedRuntimeBinding(result.sessionId).toolRuntime.type).toBe('container');

      await client.request('session/resume', {
        sessionId: result.sessionId,
        cwd: workDir,
        mcpServers: [],
      });

      // The active (persisted) binding still resolves to a container after resume.
      expect(readPersistedRuntimeBinding(result.sessionId).toolRuntime.type).toBe('container');
    } finally {
      client.close();
      server.close();
    }
  });

  it('resumes with persisted container binding even when env file is gone (lazy resolution)', async () => {
    // Create the session while the env file is present — persists a container binding.
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    let sessionId: string;
    try {
      await client.request('initialize', initParams());
      const result = (await client.request('session/new', {
        cwd: workDir,
        mcpServers: [],
        persona: 'boxed',
      })) as { sessionId: string };
      sessionId = result.sessionId;
      expect(readPersistedRuntimeBinding(sessionId).toolRuntime.type).toBe('container');
    } finally {
      client.close();
      server.close();
    }

    // Remove the environment definition file — simulates a transiently broken env.
    rmSync(join(environmentsDir, 'boxed-env.md'));

    // Resume in a fresh server instance (no warm state). The persona's env can no
    // longer be resolved from disk, but the persisted container binding is valid.
    // Resume MUST succeed and the active binding MUST remain type:container.
    const state2 = createAgentServerState();
    const { client: client2, server: server2 } = createPairedPeers((peer) =>
      registerAgentRpcMethods(peer, state2)
    );
    try {
      await client2.request('initialize', initParams());
      // Must NOT throw even though resolvePersonaContainerBinding would fail.
      await expect(
        client2.request('session/resume', {
          sessionId,
          cwd: workDir,
          mcpServers: [],
        })
      ).resolves.toBeDefined();

      // The persisted binding is still container — did not downgrade to host.
      expect(readPersistedRuntimeBinding(sessionId).toolRuntime.type).toBe('container');
    } finally {
      client2.close();
      server2.close();
    }
  });

  it('lets an explicit runtimeBinding override persona container resolution', async () => {
    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) => registerAgentRpcMethods(peer, state));
    try {
      await client.request('initialize', initParams());
      const result = (await client.request('session/new', {
        cwd: workDir,
        mcpServers: [],
        persona: 'boxed',
        config: {
          runtimeBinding: {
            schemaVersion: 1,
            identity: { runtimeId: 'explicit-host' },
            toolRuntime: { type: 'host', cwd: workDir },
          },
        },
      })) as { sessionId: string };

      // Explicit host binding wins over the persona's declared container env.
      expect(readPersistedRuntimeBinding(result.sessionId).toolRuntime.type).toBe('host');
    } finally {
      client.close();
      server.close();
    }
  });
});
