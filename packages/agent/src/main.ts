import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import {
  createAgentServerState,
  registerAgentRpcMethods,
  shutdownAlarms,
  emitSubagentExitedIfNeeded,
} from './server';
import { getLaceDir } from '@lace/agent/config/lace-dir';
import { PassThrough, Writable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './utils/logger';
import { createContainerManagerForPlatform, runStartupReaper } from './containers/startup-reaper';

const state = createAgentServerState();
const laceDir = getLaceDir();

function openLogStream(name: string) {
  const sessionDir = process.env.LACE_SESSION_DIR;
  const baseDir = sessionDir || laceDir;
  try {
    fs.mkdirSync(baseDir, { recursive: true });
  } catch {
    // ignore
  }
  const filePath = path.join(baseDir, name);
  const stream = fs.createWriteStream(filePath, { flags: 'a' });
  // createWriteStream errors are async; swallow to avoid crashing the process.
  stream.on('error', () => {});
  return stream;
}

const protocolLog = openLogStream('ent-protocol.log');

// Ensure the logger writes somewhere by default; keep it out of stdout to avoid protocol noise.
const agentLogPath = path.join(process.env.LACE_SESSION_DIR || laceDir, 'agent.log');
logger.configure('debug', agentLogPath, true);

const stdinTee = new PassThrough();
process.stdin.pipe(stdinTee);
const readable = stdinTee;
readable.on('data', (chunk) => {
  const lines = chunk
    .toString()
    .split(/\n/)
    .filter((l: string) => l.trim().length > 0);
  if (protocolLog) {
    for (const line of lines) {
      protocolLog.write(`${new Date().toISOString()} IN ${line}\n`);
    }
  }
});

const writable = new Writable({
  write(chunk, _enc, cb) {
    const lines = chunk
      .toString()
      .split(/\n/)
      .filter((l: string) => l.trim().length > 0);
    if (protocolLog) {
      for (const line of lines) {
        protocolLog.write(`${new Date().toISOString()} OUT ${line}\n`);
      }
    }
    process.stdout.write(chunk, cb);
  },
});

// Best-effort orphan reap is kicked off in the background. It runs its own
// try/catch and never throws. Boot does not wait for it because the stdin
// tee at line 34 is in flowing mode the moment the protocol-logging data
// listener attaches — blocking startup here drops in-flight bytes from
// early callers before the JSON-RPC peer is wired up.
void runStartupReaper(createContainerManagerForPlatform());

const transport = createNdjsonStdioTransport({ readable, writable });
const peer = new JsonRpcPeer(transport, { idPrefix: 'a_' });
registerAgentRpcMethods(peer, state);

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await shutdownAlarms(state);
    emitSubagentExitedIfNeeded(state);
  } catch {
    // Best-effort; never block process exit on alarm bookkeeping.
  }
  peer.close();
  await state.mcpServerManager.shutdown();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
process.stdin.on('end', () => void shutdown());
