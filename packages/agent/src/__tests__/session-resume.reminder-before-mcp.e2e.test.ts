// ABOUTME: Regression test: session/resume must not arm the reminder scheduler until the
// ABOUTME: session's MCP servers are up, or an overdue reminder starts a turn with no MCP tools.
// ABOUTME: Real RPC peers, real stdio MCP server subprocess, real ReminderStore on disk.
//
// The production shape: a coworker's process restarts with a reminder due. The scheduler
// fires it on its first tick, inside session/resume, and the turn it starts cannot reach
// Slack because the persona's MCP servers are still connecting.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from '../server';
import type { AgentServerState } from '../server-types';
import { defaultInitializeParams } from './helpers/initialize';
import { getSessionDir } from '../storage/session-store';
import { ReminderStore } from '../reminders/store';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER = path.join(__dirname, '..', 'mcp', '__examples__', 'base64-codec-server.mjs');
const MCP_SERVERS = [{ name: 'base64-codec', command: process.execPath, args: [SERVER] }];

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

async function waitFor(condition: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function shutdownAgent(state: AgentServerState): Promise<void> {
  await state.reminderScheduler?.stop();
  await state.mcpServerManager.shutdown();
}

describe('session/resume with an overdue reminder and MCP servers (e2e)', () => {
  const saved = {
    LACE_DIR: process.env.LACE_DIR,
    LACE_AGENT_TEST_PROVIDER: process.env.LACE_AGENT_TEST_PROVIDER,
    TZ: process.env.TZ,
  };
  let laceDir: string;
  let workDir: string;
  const agents: AgentServerState[] = [];

  beforeEach(() => {
    laceDir = mkdtempSync(path.join(tmpdir(), 'lace-resume-reminder-'));
    workDir = mkdtempSync(path.join(tmpdir(), 'lace-resume-reminder-wd-'));
    process.env.LACE_DIR = laceDir;
    process.env.LACE_AGENT_TEST_PROVIDER = '1';
    process.env.TZ = 'UTC';
  });

  afterEach(async () => {
    for (const state of agents.splice(0)) await shutdownAgent(state);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(laceDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  it('does not start the reminder turn until the MCP server is running', async () => {
    // First process: create the session, then exit with a reminder already due.
    const first = createAgentServerState();
    agents.push(first);
    const firstPeers = createPairedPeers((peer) => registerAgentRpcMethods(peer, first));
    firstPeers.client.onRequest('session/update', async () => undefined);
    await firstPeers.client.request('initialize', defaultInitializeParams());
    const { sessionId } = (await firstPeers.client.request('session/new', {
      cwd: workDir,
      mcpServers: MCP_SERVERS,
    })) as { sessionId: string };
    await shutdownAgent(first);

    const now = Date.now();
    new ReminderStore(getSessionDir(sessionId)).save([
      {
        id: 'reminder_0123456789ab',
        created_at: now - 60_000,
        next_fire_at: now - 1_000,
        prompt: 'post the standup summary to slack',
        recurs: null,
        fired_at: null,
        fire_count: 0,
      },
    ]);

    // Second process: resume. Record the order of the two things that race.
    const second = createAgentServerState();
    agents.push(second);
    const order: string[] = [];
    second.mcpServerManager.on('server-status-changed', (_id: string, status: string) => {
      order.push(`mcp:${status}`);
    });
    const secondPeers = createPairedPeers((peer) => registerAgentRpcMethods(peer, second));
    secondPeers.client.onRequest('session/update', async (params) => {
      const type = (params as { type?: string }).type;
      if (type === 'turn_start') order.push('turn_start');
      return undefined;
    });
    await secondPeers.client.request('initialize', defaultInitializeParams());
    await secondPeers.client.request('session/resume', {
      sessionId,
      cwd: workDir,
      mcpServers: MCP_SERVERS,
    });

    await waitFor(() => order.includes('turn_start'), 'the overdue reminder to start a turn');
    await waitFor(() => second.activeTurn === null, 'the reminder turn to finish');

    expect(order).toContain('mcp:running');
    expect(order.indexOf('mcp:running')).toBeLessThan(order.indexOf('turn_start'));
  });
});
