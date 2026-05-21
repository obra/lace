// ABOUTME: End-to-end test ensuring all env keys from MCP server config reach the spawned subprocess.
// ABOUTME: Regression coverage for kata #47 — persona-declared multi-key env blocks were truncated.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCPServerManager } from './server-manager';
import type { MCPServerConfig } from '@lace/agent/config/mcp-types';
import { reconcileMcpServersForActiveSession } from '../rpc/handlers/mcp-servers';
import type { AgentServerState } from '../server-types';
import type { LoadedSession, SessionState } from '../storage/session-store';
import { writeSessionMeta, writeSessionState, ensureSessionFiles } from '../storage/session-store';
import { HostToolRuntime } from '../tools/runtime/host';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HELPER = path.join(__dirname, '__fixtures__', 'env-dump-mcp-server.mjs');

// POSIX-only: the SDK's default-inherited env list differs on Windows and the
// test asserts specifically against the POSIX allowlist.
const skipOnWindows = process.platform === 'win32';

interface ToolCallResultContent {
  type: string;
  text?: string;
}
interface ToolCallResult {
  content: ToolCallResultContent[];
}

async function readSubprocessEnv(
  manager: MCPServerManager,
  serverId: string
): Promise<Record<string, string>> {
  const client = manager.getClient(serverId);
  if (!client) throw new Error('client missing');
  const result = (await client.callTool({ name: 'dump_env', arguments: {} })) as ToolCallResult;
  const text = result.content[0]?.text;
  if (typeof text !== 'string') throw new Error('no text content');
  return JSON.parse(text) as Record<string, string>;
}

async function startHostServer(
  manager: MCPServerManager,
  serverId: string,
  config: MCPServerConfig,
  cwd: string
): Promise<void> {
  await manager.startServer({
    serverId,
    config: { ...config, placement: config.placement ?? 'host' },
    runtime: new HostToolRuntime({ id: `test:${serverId}`, cwd }),
    hostCwd: cwd,
  });
}

async function startRuntimeServer(
  manager: MCPServerManager,
  serverId: string,
  config: MCPServerConfig,
  cwd: string
): Promise<void> {
  await manager.startServer({
    serverId,
    config: { ...config, placement: 'toolRuntime' },
    runtime: new HostToolRuntime({ id: `test:${serverId}`, cwd }),
    hostCwd: cwd,
  });
}

describe.skipIf(skipOnWindows)('MCPServerManager env propagation (kata #47)', () => {
  let manager: MCPServerManager;

  beforeEach(() => {
    manager = new MCPServerManager();
  });

  afterEach(async () => {
    await manager.shutdown();
  });

  it('delivers ALL declared env keys to the spawned MCP subprocess', async () => {
    const config: MCPServerConfig = {
      command: process.execPath, // node
      args: [HELPER],
      env: {
        KATA47_KEY_A: 'alpha',
        KATA47_KEY_B: 'bravo',
        KATA47_KEY_C: 'charlie',
      },
      enabled: true,
      tools: {},
    };

    await startHostServer(manager, 'env-dump', config, process.cwd());
    const env = await readSubprocessEnv(manager, 'env-dump');

    expect(env.KATA47_KEY_A).toBe('alpha');
    expect(env.KATA47_KEY_B).toBe('bravo');
    expect(env.KATA47_KEY_C).toBe('charlie');
  });

  it('does not leak the parent process env into the subprocess (only allowlist + declared)', async () => {
    // Pick a sentinel var that exists in our test process but is NOT in the
    // POSIX default-inherited allowlist [HOME, LOGNAME, PATH, SHELL, TERM, USER].
    const sentinelName = 'KATA47_PARENT_ONLY_SENTINEL';
    process.env[sentinelName] = 'should-not-leak';

    try {
      const config: MCPServerConfig = {
        command: process.execPath,
        args: [HELPER],
        env: { KATA47_DECLARED: 'visible' },
        enabled: true,
        tools: {},
      };

      await startHostServer(manager, 'env-dump', config, process.cwd());
      const env = await readSubprocessEnv(manager, 'env-dump');

      expect(env.KATA47_DECLARED).toBe('visible');
      expect(env[sentinelName]).toBeUndefined();
    } finally {
      delete process.env[sentinelName];
    }
  });

  it('with no env block, exposes only the SDK default allowlist', async () => {
    const config: MCPServerConfig = {
      command: process.execPath,
      args: [HELPER],
      enabled: true,
      tools: {},
    };

    await startHostServer(manager, 'env-dump', config, process.cwd());
    const env = await readSubprocessEnv(manager, 'env-dump');

    // At minimum HOME and PATH should be passed through (always present in CI).
    expect(env.PATH).toBeDefined();
    // Nothing of our own should leak.
    expect(env.LACE_DIR).toBeUndefined();
  });

  it('preserves a single env key (regression guard for the "first key only" bug)', async () => {
    const config: MCPServerConfig = {
      command: process.execPath,
      args: [HELPER],
      env: { KATA47_SOLO: 'lone' },
      enabled: true,
      tools: {},
    };

    await startHostServer(manager, 'env-dump', config, process.cwd());
    const env = await readSubprocessEnv(manager, 'env-dump');

    expect(env.KATA47_SOLO).toBe('lone');
  });

  it('runtime placement does not leak parent env through host-backed runtimes', async () => {
    const sentinelName = 'KATA47_RUNTIME_PARENT_ONLY_SENTINEL';
    process.env[sentinelName] = 'should-not-leak';

    try {
      const config: MCPServerConfig = {
        command: process.execPath,
        args: [HELPER],
        env: { KATA47_RUNTIME_DECLARED: 'visible' },
        enabled: true,
        tools: {},
      };

      await startRuntimeServer(manager, 'env-dump', config, process.cwd());
      const env = await readSubprocessEnv(manager, 'env-dump');

      expect(env.KATA47_RUNTIME_DECLARED).toBe('visible');
      expect(env[sentinelName]).toBeUndefined();
    } finally {
      delete process.env[sentinelName];
    }
  });
});

describe.skipIf(skipOnWindows)(
  'reconcileMcpServersForActiveSession env propagation (kata #47)',
  () => {
    let tmpRoot: string;
    let mcpServerManager: MCPServerManager;

    beforeEach(() => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kata47-reconcile-'));
      mcpServerManager = new MCPServerManager();
    });

    afterEach(async () => {
      await mcpServerManager.shutdown();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    function buildState(sessionState: SessionState): AgentServerState {
      const sessionId = 'sess_kata47_reconcile';
      const sessionDir = path.join(tmpRoot, sessionId);
      fs.mkdirSync(sessionDir, { recursive: true });
      writeSessionMeta(sessionDir, {
        sessionId,
        workDir: tmpRoot,
        created: new Date().toISOString(),
      });
      writeSessionState(sessionDir, sessionState);
      ensureSessionFiles(sessionDir);

      const loaded: LoadedSession = {
        meta: { sessionId, workDir: tmpRoot, created: new Date().toISOString() },
        dir: sessionDir,
        state: sessionState,
      };

      // Build the smallest AgentServerState reconcileMcpServersForActiveSession touches.
      return {
        activeSession: loaded,
        mcpServerManager,
        toolExecutorCache: new Map(),
      } as unknown as AgentServerState;
    }

    it('delivers ALL declared env keys to the subprocess via the full reconcile path', async () => {
      const state = buildState({
        nextEventSeq: 1,
        nextStreamSeq: 1,
        config: {
          mcpServers: [
            {
              name: 'env-dump',
              command: process.execPath,
              args: [HELPER],
              env: {
                KATA47_RECONCILE_A: 'alpha',
                KATA47_RECONCILE_B: 'bravo',
                KATA47_RECONCILE_C: 'charlie',
              },
              enabled: true,
              tools: {},
            },
          ],
        },
      });

      await reconcileMcpServersForActiveSession(state);
      const env = await readSubprocessEnv(mcpServerManager, 'env-dump');

      expect(env.KATA47_RECONCILE_A).toBe('alpha');
      expect(env.KATA47_RECONCILE_B).toBe('bravo');
      expect(env.KATA47_RECONCILE_C).toBe('charlie');
    });

    it('rejects non-local runtime bindings during MCP reconciliation', async () => {
      const state = buildState({
        nextEventSeq: 1,
        nextStreamSeq: 1,
        config: {
          runtimeBinding: {
            schemaVersion: 1,
            identity: { runtimeId: 'rt_workspace_reconcile' },
            agentPlacement: 'host',
            toolRuntime: {
              type: 'workspace',
              projectRoot: tmpRoot,
              workspaceRoot: tmpRoot,
              cwd: tmpRoot,
            },
          },
          mcpServers: [
            {
              name: 'env-dump',
              command: process.execPath,
              args: [HELPER],
              enabled: true,
              tools: {},
            },
          ],
        },
      });

      await expect(reconcileMcpServersForActiveSession(state)).rejects.toThrow(
        'MCP runtime placement only supports local runtime bindings'
      );
      expect(mcpServerManager.getAllServers()).toEqual([]);
    });
  }
);
