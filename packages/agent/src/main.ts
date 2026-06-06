import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import {
  createAgentServerState,
  registerAgentRpcMethods,
  shutdownReminders,
  emitSubagentExitedIfNeeded,
} from './server';
import { getLaceDir } from '@lace/agent/config/lace-dir';
import { closeRecallIndex, getRecallIndex } from './storage/recall/index-db';
import { backfillIndex } from './storage/recall/backfill';
import { PassThrough, Writable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './utils/logger';
import { runStartupReaper } from './containers/startup-reaper';
import { fileURLToPath } from 'url';
import { loadPlugins, PluginLoadError } from './plugins';
import { registerBuiltinTools } from './tools/builtins';
import { registerCoreExecTools } from './tools/exec/register-exec';
import { registerBuiltinCompaction } from './compaction/strategy';
import {
  registerBuiltinRuntimes,
  createDefaultContainerManager,
} from './containers/manager-factory';

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

// Pipe stdin into a PassThrough tee. A PassThrough buffers while nothing
// consumes it and only flows once a `data` listener (or pipe) attaches.
// We intentionally DO NOT attach any consumer here — the protocol-log `data`
// listener is attached inside boot() AFTER the plugin-load await, so frames
// that arrive during the (possibly slow) import buffer in the tee and are
// delivered in order once the peer wires. This resolves the existing H15 race.
const stdinTee = new PassThrough();
process.stdin.pipe(stdinTee);
const readable = stdinTee;

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

// Promoted to module scope so shutdown() can guard with ?.
let peer: JsonRpcPeer | undefined;

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    // FIRST, before any later await that can hang: dispose every per_invocation
    // child workspace this process tracks — destroy each container, then rm
    // /work. No parent-id arg: a process can't know its parent; its own tracked
    // entries are exactly what must be freed. (Belt; the Part 4 sweep is the
    // SIGKILL backstop.) releaseAllTracked is per-entry try/catch, never rejects.
    await state.workspaceReaper.releaseAllTracked();
    await shutdownReminders(state);
    await emitSubagentExitedIfNeeded(state);
  } catch {
    // Best-effort; never block process exit on reminder bookkeeping.
  }
  peer?.close();
  await state.mcpServerManager.shutdown();
  try {
    closeRecallIndex();
  } catch {
    // Best-effort; never block process exit on FTS handle teardown.
  }
  process.exit(0);
};

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
process.stdin.on('end', () => void shutdown());

async function boot(): Promise<void> {
  // Register built-ins BEFORE plugins so a plugin dup of a built-in name is fatal.
  registerBuiltinTools();
  const coreExecDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../config/agent-exec-tools'
  );
  registerCoreExecTools(coreExecDir);
  registerBuiltinCompaction();
  registerBuiltinRuntimes();

  try {
    const res = await loadPlugins(process.env.LACE_PLUGINS);
    if (res.loaded.length) {
      logger.info(`plugins: loaded ${res.loaded.map((p) => p.name).join(', ')}`);
    }
  } catch (err) {
    logger.error(
      `plugins: fatal load failure: ${err instanceof PluginLoadError ? err.message : String(err)}`
    );
    // Fatal before any frame — LaceSupervisor respawns; a persistent misconfig is a
    // respawn loop = config error.
    process.exit(1);
  }

  // Runtimes registry is now populated — build the container manager.
  const manager = createDefaultContainerManager();
  state.containerManager = manager;
  // The workspace reaper routes per_invocation teardown to the shim via the
  // container manager, so it needs the live container manager now that it exists.
  state.workspaceReaper.bindRuntime(manager);
  // Orphan-container reap: destroys orphan lace-* containers via the runtime. The
  // shim owns workspace reaping on the plane, so lace does not run a workspace
  // sweep here (the removed owner marker defeats its liveness gates). Best-effort;
  // runs its own try/catch.
  await runStartupReaper(manager);

  // Safe to attach the stdin consumer NOW — frames that arrived during the plugin
  // await were buffered in the tee and will be delivered in order once the peer wires.
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

  const transport = createNdjsonStdioTransport({ readable, writable });
  peer = new JsonRpcPeer(transport, { idPrefix: 'a_' });
  state.peer = peer;
  // manager is set above, so the network-lifecycle observer will be installed.
  registerAgentRpcMethods(peer, state);

  // Catch the FTS index up to anything that landed in JSONL before write-through
  // indexing shipped, or while the process was down. Deferred to the next event
  // loop tick so the JSON-RPC peer above is fully wired up before we touch the
  // FTS index. Failures must never break startup; the JSONL files are source of truth.
  setImmediate(() => {
    try {
      const stats = backfillIndex(getRecallIndex(), laceDir);
      logger.info(`recall: backfill scanned=${stats.scanned} inserted=${stats.inserted}`);
    } catch (err) {
      logger.error(`recall: backfill failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

void boot();
