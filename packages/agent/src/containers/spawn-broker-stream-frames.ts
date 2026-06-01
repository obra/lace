// ABOUTME: Binary frame codec for the spawn-broker execStream dedicated connection.
// ABOUTME: Multiplexes stdin/stdout/stderr/exit over one unix-socket connection so the
// ABOUTME: broker and its client can distinguish the streams unambiguously (vs raw stdio).

// Wire frame: [1-byte streamId][4-byte big-endian uint32 payloadLength][payload].
// The leading execStream control frame (the JSON request) is sent BEFORE any of
// these frames and is handled by the caller, not this codec.

export enum StreamId {
  // caller -> broker
  STDIN = 0,
  // broker -> caller
  STDOUT = 1,
  STDERR = 2,
  // broker -> caller, always the LAST frame; payload = int32 exit code.
  EXIT = 3,
}

const VALID_STREAM_IDS: ReadonlySet<number> = new Set([
  StreamId.STDIN,
  StreamId.STDOUT,
  StreamId.STDERR,
  StreamId.EXIT,
]);

const HEADER_BYTES = 5;

// Cap a single frame's payload. The stdin path is driven by the (adversarial)
// caller, so an unbounded declared length is a memory-DoS vector; reject it.
// 1 MiB comfortably covers any real tool-call stdin/stdout chunk.
export const MAX_FRAME_PAYLOAD_BYTES = 1024 * 1024;

export interface StreamFrame {
  streamId: StreamId;
  payload: Buffer;
}

export class FrameDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrameDecodeError';
  }
}

/** Encode a frame. payload may be empty (a zero-length frame is valid). */
export function encodeFrame(streamId: StreamId, payload: Buffer): Buffer {
  if (payload.length > MAX_FRAME_PAYLOAD_BYTES) {
    throw new FrameDecodeError(
      `frame payload ${payload.length} exceeds cap ${MAX_FRAME_PAYLOAD_BYTES}`
    );
  }
  const header = Buffer.allocUnsafe(HEADER_BYTES);
  header.writeUInt8(streamId, 0);
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

/** Encode the terminal exit frame carrying a signed int32 exit code. */
export function encodeExitFrame(exitCode: number): Buffer {
  const payload = Buffer.allocUnsafe(4);
  payload.writeInt32BE(exitCode, 0);
  return encodeFrame(StreamId.EXIT, payload);
}

/**
 * Incremental decoder. Feed it socket chunks via push(); it returns whatever
 * complete frames are now available, buffering any partial trailing frame for
 * the next push. Throws FrameDecodeError on an unknown stream id or an
 * over-cap declared payload length (fail closed — the connection should be torn
 * down by the caller).
 */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): StreamFrame[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const frames: StreamFrame[] = [];

    for (;;) {
      if (this.buffer.length < HEADER_BYTES) break;
      const streamId = this.buffer.readUInt8(0);
      const payloadLength = this.buffer.readUInt32BE(1);
      if (!VALID_STREAM_IDS.has(streamId)) {
        throw new FrameDecodeError(`unknown stream id ${streamId}`);
      }
      if (payloadLength > MAX_FRAME_PAYLOAD_BYTES) {
        throw new FrameDecodeError(
          `declared payload ${payloadLength} exceeds cap ${MAX_FRAME_PAYLOAD_BYTES}`
        );
      }
      const frameEnd = HEADER_BYTES + payloadLength;
      if (this.buffer.length < frameEnd) break; // wait for the rest of the payload
      const payload = this.buffer.subarray(HEADER_BYTES, frameEnd);
      frames.push({ streamId, payload });
      this.buffer = this.buffer.subarray(frameEnd);
    }

    return frames;
  }
}
