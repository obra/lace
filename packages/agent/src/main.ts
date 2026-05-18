import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from './server';
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

// Best-effort orphan reap runs before we wire up JSON-RPC so that any inbound
// requests during the (possibly slow) reap pause on the stdin tee buffer rather
// than landing on a peer with no methods registered. Failures inside the reaper
// are swallowed and logged; they never block boot.
await runStartupReaper(createContainerManagerForPlatform());

const transport = createNdjsonStdioTransport({ readable, writable });
const peer = new JsonRpcPeer(transport, { idPrefix: 'a_' });
registerAgentRpcMethods(peer, state);

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  peer.close();
  await state.mcpServerManager.shutdown();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
process.stdin.on('end', () => void shutdown());
