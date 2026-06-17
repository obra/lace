// ABOUTME: Pure head+tail digest for oversized tool-result text. Keeps the result
// ABOUTME: navigable in context while the full payload lives in a sidecar.

export const TOOL_RESULT_RIDE_WHOLE_BYTES = 8 * 1024;
export const TOOL_RESULT_DIGEST_HALF_BYTES = 1024;

export interface ToolResultDigest {
  text: string; // either the whole input (ride-whole) or head+marker+tail
  elidedBytes: number; // 0 when ridden whole
  totalBytes: number; // byte length of the full input
}

export function digestToolResultText(
  full: string,
  toolCallId: string,
  opts?: { rideWholeBytes?: number; digestHalfBytes?: number }
): ToolResultDigest {
  const rideWhole = opts?.rideWholeBytes ?? TOOL_RESULT_RIDE_WHOLE_BYTES;
  const half = opts?.digestHalfBytes ?? TOOL_RESULT_DIGEST_HALF_BYTES;
  const totalBytes = Buffer.byteLength(full, 'utf8');
  if (totalBytes <= rideWhole) return { text: full, elidedBytes: 0, totalBytes };

  const buf = Buffer.from(full, 'utf8');
  // Head: first `half` bytes, trimmed back to the last newline so we don't cut a line.
  let headEnd = Math.min(half, buf.length);
  const lastNlInHead = buf.lastIndexOf(0x0a, headEnd - 1);
  if (lastNlInHead > 0) headEnd = lastNlInHead + 1;
  // A line longer than `half` leaves headEnd mid-line; back it off any partial
  // UTF-8 codepoint so the head never ends inside a multibyte sequence.
  headEnd = backOffToCodepointBoundary(buf, headEnd);
  // Tail: last `half` bytes, trimmed forward to the first newline.
  let tailStart = Math.max(buf.length - half, headEnd);
  const firstNlInTail = buf.indexOf(0x0a, tailStart);
  if (firstNlInTail >= 0 && firstNlInTail + 1 < buf.length) tailStart = firstNlInTail + 1;
  // Same guard for the tail start (a line longer than `half` may leave it
  // mid-codepoint), advancing forward to the next clean boundary.
  tailStart = advanceToCodepointBoundary(buf, tailStart);

  const head = buf.subarray(0, headEnd).toString('utf8');
  const tail = buf.subarray(tailStart).toString('utf8');
  const elidedBytes =
    totalBytes - Buffer.byteLength(head, 'utf8') - Buffer.byteLength(tail, 'utf8');
  const marker =
    `\n…[${elidedBytes} bytes elided of ${totalBytes} total — recover with ` +
    `read_tool_result(tool_call_id="${toolCallId}", head_lines=…, tail_lines=…, grep="…")]…\n`;
  return { text: head + marker + tail, elidedBytes, totalBytes };
}

/** A UTF-8 continuation byte is `10xxxxxx` (0x80–0xBF). */
function isContinuationByte(b: number): boolean {
  return (b & 0xc0) === 0x80;
}

/** Move `index` left until it is not in the middle of a multibyte sequence. */
export function backOffToCodepointBoundary(buf: Buffer, index: number): number {
  let i = index;
  while (i > 0 && i < buf.length && isContinuationByte(buf[i])) i--;
  return i;
}

/** Move `index` right until it is not in the middle of a multibyte sequence. */
export function advanceToCodepointBoundary(buf: Buffer, index: number): number {
  let i = index;
  while (i < buf.length && isContinuationByte(buf[i])) i++;
  return i;
}
