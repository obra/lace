// ABOUTME: Regression test for a session permanently losing its MCP tools when a turn
// ABOUTME: builds the cached tool executor while an MCP server is still 'starting'.
// ABOUTME: Real MCPServerManager + real stdio MCP server subprocess; no protocol mocks.
//
// The production shape: session/resume arms the reminder scheduler, a cron reminder
// fires while the persona's MCP servers are still connecting, and the turn it starts
// builds the session's executor. Discovery only registers 'running' servers, so that
// executor has no MCP tools — and it is cached for the life of the process.

import { describe, it, expect, afterEach } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import type { MCPServerConfig } from '@lace/agent/config/mcp-types';
import { HostToolRuntime } from '@lace/agent/tools/runtime/host';
import {
  createAgentServerState,
  createToolExecutorForMode,
  getOrCreateSessionToolExecutor,
  registerAgentRpcMethods,
} from '../server';
import type { AgentServerState } from '../server-types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER = path.join(__dirname, '..', 'mcp', '__examples__', 'base64-codec-server.mjs');
const SERVER_ID = 'base64-codec';
const MCP_TOOL = `${SERVER_ID}/base64_encode`;
const SESSION_ID = 'sess_mcp_startup';

function registerOnLoopbackPeer(state: AgentServerState): void {
  const aToB = new PassThrough();
  const bToA = new PassThrough();
  const serverTransport = createNdjsonStdioTransport({ readable: aToB, writable: bToA });
  registerAgentRpcMethods(new JsonRpcPeer(serverTransport, { idPrefix: 'a_' }), state);
}

function sessionToolNames(state: AgentServerState): Promise<string[]> {
  return getOrCreateSessionToolExecutor(state.toolExecutorCache, SESSION_ID, 'execute', () =>
    createToolExecutorForMode('execute', state.mcpServerManager)
  ).then(({ executor }) => executor.getAvailableToolNames());
}

describe('session tool executor cache across MCP server startup (e2e)', () => {
  let state: AgentServerState | undefined;

  afterEach(async () => {
    await state?.mcpServerManager.shutdown();
    state = undefined;
  });

  it('rebuilds a cached executor once a server that was still starting reaches running', async () => {
    state = createAgentServerState();
    registerOnLoopbackPeer(state);

    const config: MCPServerConfig = {
      command: process.execPath,
      args: [SERVER],
      enabled: true,
      tools: {},
      placement: 'host',
    };

    // Deliberately not awaited yet: the server is 'starting' while the turn below runs.
    const started = state.mcpServerManager.startServer({
      serverId: SERVER_ID,
      config,
      runtime: new HostToolRuntime({ id: 'test:mcp-startup', cwd: process.cwd() }),
      hostCwd: process.cwd(),
    });
    expect(state.mcpServerManager.getAllServers().map((s) => s.status)).toEqual(['starting']);

    // A turn that begins mid-startup sees no MCP tools. That one turn is degraded;
    // the defect under test is that the degradation must not outlive it.
    expect(await sessionToolNames(state)).not.toContain(MCP_TOOL);

    await started;
    expect(state.mcpServerManager.getAllServers().map((s) => s.status)).toEqual(['running']);

    // The next turn for the same session must see the server's tools.
    expect(await sessionToolNames(state)).toContain(MCP_TOOL);
  });
});
