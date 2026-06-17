// ABOUTME: Tests for the pure head+tail tool-result digest function.

import { describe, expect, it } from 'vitest';
import { digestToolResultText, TOOL_RESULT_RIDE_WHOLE_BYTES } from '../result-digest';

describe('tools/result-digest', () => {
  it('rides a result at or below the ride-whole budget back unchanged', () => {
    const full = 'line one\nline two\nline three\n';
    const result = digestToolResultText(full, 'tc_1');
    expect(result.text).toBe(full);
    expect(result.elidedBytes).toBe(0);
    expect(result.totalBytes).toBe(Buffer.byteLength(full, 'utf8'));
  });

  it('rides a result exactly at the budget unchanged', () => {
    const full = 'x'.repeat(TOOL_RESULT_RIDE_WHOLE_BYTES);
    const result = digestToolResultText(full, 'tc_edge');
    expect(result.text).toBe(full);
    expect(result.elidedBytes).toBe(0);
  });

  it('digests an oversized result into head + marker + tail', () => {
    const lines: string[] = [];
    for (let i = 0; i < 2000; i++) {
      lines.push(`this is line number ${i} with some padding text to add bytes`);
    }
    const full = lines.join('\n') + '\n';
    const totalBytes = Buffer.byteLength(full, 'utf8');
    expect(totalBytes).toBeGreaterThan(TOOL_RESULT_RIDE_WHOLE_BYTES);

    const result = digestToolResultText(full, 'tc_big');

    // Far smaller than the input.
    expect(Buffer.byteLength(result.text, 'utf8')).toBeLessThan(totalBytes / 4);
    // Marker reports exact elided byte count and references the tool_call_id.
    expect(result.totalBytes).toBe(totalBytes);
    expect(result.elidedBytes).toBeGreaterThan(0);
    expect(result.text).toContain(`${result.elidedBytes} bytes elided`);
    expect(result.text).toContain('tc_big');
    expect(result.text).toContain('read_tool_result');
    // Head and tail content is preserved.
    expect(result.text.startsWith('this is line number 0')).toBe(true);
    expect(result.text).toContain('this is line number 1999');
  });

  it('cuts head and tail on line boundaries (no partial lines)', () => {
    const lines: string[] = [];
    for (let i = 0; i < 2000; i++) {
      lines.push(`AAAA-${i}-BBBB padding padding padding padding padding`);
    }
    const full = lines.join('\n') + '\n';
    const result = digestToolResultText(full, 'tc_lines');

    const markerStart = result.text.indexOf('\n…[');
    const head = result.text.slice(0, markerStart);
    // The head must end at a complete line — last char before the marker is a newline.
    expect(head.endsWith('\n')).toBe(true);

    const markerEnd = result.text.indexOf(']…\n');
    const tail = result.text.slice(markerEnd + 3);
    // The tail must begin at the start of a complete line.
    expect(tail.startsWith('AAAA-')).toBe(true);
  });

  it('does not produce broken UTF-8 when multibyte chars sit near the cut', () => {
    // Build a payload where multibyte sequences straddle the head/tail byte cuts.
    const filler = 'café 🎉 résumé naïve façade '.repeat(50); // multibyte per line
    const lines: string[] = [];
    for (let i = 0; i < 1000; i++) {
      lines.push(`${filler}${i}`);
    }
    const full = lines.join('\n') + '\n';
    const result = digestToolResultText(full, 'tc_utf8');

    expect(result.elidedBytes).toBeGreaterThan(0);
    // Round-trip: re-encoding the text must be byte-identical (no replacement chars
    // introduced by a mid-codepoint cut).
    const roundTripped = Buffer.from(result.text, 'utf8').toString('utf8');
    expect(roundTripped).toBe(result.text);
    expect(result.text).not.toContain('�');
  });
});
