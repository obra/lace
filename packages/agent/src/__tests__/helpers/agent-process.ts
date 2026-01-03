import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';

export type SpawnedAgent = {
  peer: JsonRpcPeer;
  proc: ChildProcessWithoutNullStreams;
  shutdown: () => Promise<void>;
  stderr: () => string;
};

export function spawnAgentProcess(options: {
  laceDir: string;
  env?: Record<string, string>;
}): SpawnedAgent {
  const agentMainPath = fileURLToPath(new URL('../../../dist/main.js', import.meta.url));
  const agentCwd = fileURLToPath(new URL('../../../', import.meta.url));

  let stderrBuffer = '';

  const proc = spawn(process.execPath, [agentMainPath], {
    cwd: agentCwd,
    env: { ...process.env, LACE_DIR: options.laceDir, ...(options.env || {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (chunk) => {
    stderrBuffer += chunk;
  });

  const transport = createNdjsonStdioTransport({ readable: proc.stdout, writable: proc.stdin });
  const peer = new JsonRpcPeer(transport, { idPrefix: 'c_' });

  const shutdown = async () => {
    if (proc.exitCode !== null) {
      peer.close();
      return;
    }

    proc.kill('SIGTERM');

    await new Promise<void>((resolve, reject) => {
      const onExit = () => resolve();
      const onError = (err: unknown) => reject(err);

      proc.once('exit', onExit);
      proc.once('error', onError);
    });

    peer.close();
  };

  return {
    peer,
    proc,
    shutdown,
    stderr: () => stderrBuffer,
  };
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const guard = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`Timed out after ${ms}ms: ${label}`)), ms);
  });

  try {
    return await Promise.race([promise, guard]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
