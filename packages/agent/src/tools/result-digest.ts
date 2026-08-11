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

  // A line longer than the half budget leaves a cut mid-line. The visible text
  // then shows a PARTIAL record abutting the marker — for a structured list,
  // item 1's prefix and item N's suffix read as one malformed record unless
  // the marker says so explicitly.
  const headCutMidLine = headEnd > 0 && buf[headEnd - 1] !== 0x0a;
  const tailCutMidLine = tailStart > 0 && buf[tailStart - 1] !== 0x0a;

  // Line count of the elided middle, so a structured list can't silently lose
  // records: "3 items visible, marker says 1 line elided" is checkable. When
  // the head was cut mid-line, the middle's first newline merely terminates
  // the visible (PARTIAL-flagged) head fragment's line — it is not an elided
  // line, so skip it. The tail-side fragment has no terminating newline inside
  // the middle, so newline-counting already excludes it.
  let elidedLines = 0;
  for (let i = headEnd; i < tailStart; i++) {
    if (buf[i] === 0x0a) elidedLines++;
  }
  if (headCutMidLine && elidedLines > 0) elidedLines--;
  const partialNote = headCutMidLine
    ? tailCutMidLine
      ? '; the lines before AND after this marker are PARTIAL (cut mid-line)'
      : '; the line before this marker is PARTIAL (cut mid-line)'
    : tailCutMidLine
      ? '; the line after this marker is PARTIAL (cut mid-line)'
      : '';

  const marker =
    `\n…[${elidedLines} lines, ${elidedBytes} bytes elided of ${totalBytes} total${partialNote} — recover with ` +
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
