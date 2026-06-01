// ABOUTME: Tests for the spawn-broker execStream binary frame codec (shared by server + client)
// ABOUTME: Frames multiplex stdin/stdout/stderr/exit over one dedicated unix-socket connection

import { describe, it, expect } from 'vitest';
import {
  StreamId,
  MAX_FRAME_PAYLOAD_BYTES,
  encodeFrame,
  encodeExitFrame,
  FrameDecoder,
  FrameDecodeError,
} from '../spawn-broker-stream-frames';

describe('encodeFrame / FrameDecoder round-trip', () => {
  it('round-trips a single stdout frame', () => {
    const payload = Buffer.from('hello world', 'utf8');
    const decoder = new FrameDecoder();
    const frames = decoder.push(encodeFrame(StreamId.STDOUT, payload));
    expect(frames).toHaveLength(1);
    expect(frames[0].streamId).toBe(StreamId.STDOUT);
    expect(frames[0].payload.toString('utf8')).toBe('hello world');
  });

  it('reassembles a frame split across multiple chunks', () => {
    const frame = encodeFrame(StreamId.STDERR, Buffer.from('partial', 'utf8'));
    const decoder = new FrameDecoder();
    // Split mid-header and mid-payload.
    expect(decoder.push(frame.subarray(0, 2))).toEqual([]);
    expect(decoder.push(frame.subarray(2, 7))).toEqual([]);
    const frames = decoder.push(frame.subarray(7));
    expect(frames).toHaveLength(1);
    expect(frames[0].streamId).toBe(StreamId.STDERR);
    expect(frames[0].payload.toString('utf8')).toBe('partial');
  });

  it('emits multiple frames delivered in one chunk', () => {
    const combined = Buffer.concat([
      encodeFrame(StreamId.STDOUT, Buffer.from('a')),
      encodeFrame(StreamId.STDOUT, Buffer.from('bb')),
      encodeFrame(StreamId.STDIN, Buffer.from('ccc')),
    ]);
    const frames = new FrameDecoder().push(combined);
    expect(frames.map((f) => f.payload.toString('utf8'))).toEqual(['a', 'bb', 'ccc']);
    expect(frames.map((f) => f.streamId)).toEqual([
      StreamId.STDOUT,
      StreamId.STDOUT,
      StreamId.STDIN,
    ]);
  });

  it('supports zero-length payloads (e.g. an empty write / EOF marker)', () => {
    const frames = new FrameDecoder().push(encodeFrame(StreamId.STDOUT, Buffer.alloc(0)));
    expect(frames).toHaveLength(1);
    expect(frames[0].payload).toHaveLength(0);
  });
});

describe('exit frame', () => {
  it('round-trips a zero exit code', () => {
    const frames = new FrameDecoder().push(encodeExitFrame(0));
    expect(frames).toHaveLength(1);
    expect(frames[0].streamId).toBe(StreamId.EXIT);
    expect(frames[0].payload.readInt32BE(0)).toBe(0);
  });

  it('round-trips a non-zero exit code', () => {
    const frames = new FrameDecoder().push(encodeExitFrame(137));
    expect(frames[0].payload.readInt32BE(0)).toBe(137);
  });
});

describe('FrameDecoder DoS guard', () => {
  it('throws when a frame declares a payload length over the cap', () => {
    // Hand-craft a header claiming a payload one byte over the cap.
    const header = Buffer.alloc(5);
    header.writeUInt8(StreamId.STDIN, 0);
    header.writeUInt32BE(MAX_FRAME_PAYLOAD_BYTES + 1, 1);
    expect(() => new FrameDecoder().push(header)).toThrow(FrameDecodeError);
  });

  it('throws on an unknown stream id', () => {
    const header = Buffer.alloc(5);
    header.writeUInt8(99, 0);
    header.writeUInt32BE(0, 1);
    expect(() => new FrameDecoder().push(header)).toThrow(FrameDecodeError);
  });
});
