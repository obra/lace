// ABOUTME: Client transport for the spawn-broker socket (used by SpawnBrokerContainerRuntime).
// ABOUTME: JSON request/response for lifecycle verbs; binary frame-bridge for execStream.
// ABOUTME: The mirror of spawn-broker-server's connection handling, on the caller side.

import net from 'node:net';
import { PassThrough, Writable } from 'node:stream';
import type { ExecStreamHandle } from './types';
import {
  StreamId,
  encodeFrame,
  FrameDecoder,
  type StreamFrame,
} from './spawn-broker-stream-frames';

// The control frame for an execStream: the JSON the broker parses, minus the
// stdin bytes that follow as frames. (Shape mirrors the protocol's execStream
// request; the caller — SpawnBrokerContainerRuntime — builds it.)
export interface ExecStreamControlFrame {
  op: 'execStream';
  containerName: string;
  command: string[];
  environment?: Record<string, string>;
  workingDirectory?: string;
  environmentMode?: 'inherit' | 'replace';
  jobId?: string;
}

export class SpawnBrokerClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpawnBrokerClientError';
  }
}

/**
 * One round-trip JSON request over the broker socket: connect, write the control
 * frame as a newline-delimited JSON line, resolve the first newline-delimited
 * JSON response. Used for every lifecycle verb (spawn/stop/destroy/status/adopt/
 * list). Mirrors the helper's admin-socket framing.
 */
export function brokerRequestJson(
  socketPath: string,
  request: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = '';
    let settled = false;
    socket.setEncoding('utf8');

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };

    socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const nl = buffer.indexOf('\n');
      if (nl === -1) return;
      const line = buffer.slice(0, nl);
      settle(() => {
        socket.end();
        try {
          const parsed = JSON.parse(line) as unknown;
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            reject(new SpawnBrokerClientError('broker_malformed_response'));
            return;
          }
          resolve(parsed as Record<string, unknown>);
        } catch {
          reject(new SpawnBrokerClientError('broker_malformed_response'));
        }
      });
    });
    socket.once('end', () =>
      settle(() => reject(new SpawnBrokerClientError('broker_incomplete_response')))
    );
    socket.once('error', () =>
      settle(() => reject(new SpawnBrokerClientError('broker_socket_error')))
    );
  });
}

/**
 * Open an execStream over the broker socket and return an ExecStreamHandle whose
 * stdin/stdout/stderr/wait/kill bridge to the broker's binary frame protocol:
 * the control frame goes first (newline JSON), then stdin writes become STDIN
 * frames, the broker's STDOUT/STDERR frames feed the handle's readables, and the
 * terminal EXIT frame resolves wait(). Closing/kill destroys the connection,
 * which the broker treats as "kill the exec".
 */
export function brokerExecStream(
  socketPath: string,
  control: ExecStreamControlFrame
): ExecStreamHandle {
  const socket = net.createConnection(socketPath);
  // Write the control frame SYNCHRONOUSLY (not in a 'connect' handler): Node
  // buffers pre-connect writes in call order, so this guarantees the control
  // frame is the FIRST thing on the wire — before any stdin frames the caller
  // writes synchronously after we return. (Deferring it to 'connect' let stdin
  // frames jump ahead, and the broker then read binary frame bytes as the
  // control line.)
  socket.write(`${JSON.stringify(control)}\n`);
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const decoder = new FrameDecoder();

  let exitCode: number | undefined;
  let waitResolve: ((value: { exitCode: number }) => void) | undefined;
  let waitReject: ((reason: Error) => void) | undefined;
  let settled = false;

  const finishWait = (): void => {
    if (settled) return;
    settled = true;
    if (exitCode !== undefined) waitResolve?.({ exitCode });
    else waitReject?.(new SpawnBrokerClientError('execStream ended without an exit frame'));
  };

  socket.on('data', (chunk: Buffer) => {
    let frames: StreamFrame[];
    try {
      frames = decoder.push(chunk);
    } catch {
      socket.destroy();
      return;
    }
    for (const frame of frames) {
      if (frame.streamId === StreamId.STDOUT) stdout.write(frame.payload);
      else if (frame.streamId === StreamId.STDERR) stderr.write(frame.payload);
      else if (frame.streamId === StreamId.EXIT) exitCode = frame.payload.readInt32BE(0);
      // STDIN frames never arrive from the broker; ignore defensively.
    }
  });

  socket.once('close', () => {
    stdout.end();
    stderr.end();
    finishWait();
  });
  socket.once('error', () => {
    if (!settled) {
      settled = true;
      waitReject?.(new SpawnBrokerClientError('broker_socket_error'));
    }
  });

  // Caller stdin → STDIN frames. A zero-length frame signals EOF to the broker.
  const stdin = new Writable({
    write(chunk: Buffer, _enc, cb): void {
      socket.write(
        encodeFrame(StreamId.STDIN, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      );
      cb();
    },
    final(cb): void {
      socket.write(encodeFrame(StreamId.STDIN, Buffer.alloc(0)));
      cb();
    },
  });

  return {
    stdin,
    stdout,
    stderr,
    wait: () =>
      new Promise<{ exitCode: number }>((resolve, reject) => {
        if (settled) {
          if (exitCode !== undefined) resolve({ exitCode });
          else reject(new SpawnBrokerClientError('execStream ended without an exit frame'));
          return;
        }
        waitResolve = resolve;
        waitReject = reject;
      }),
    kill: (): void => {
      socket.destroy();
    },
  };
}
