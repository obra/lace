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

  it('marker states how many lines were elided', () => {
    const lines: string[] = [];
    for (let i = 0; i < 2000; i++) {
      lines.push(`this is line number ${i} with some padding text to add bytes`);
    }
    const full = lines.join('\n') + '\n';
    const result = digestToolResultText(full, 'tc_linecount');

    const marker = result.text.match(/…\[(\d+) lines, \d+ bytes elided of \d+ total/);
    expect(marker).not.toBeNull();
    const statedElidedLines = Number(marker![1]);

    // The stated count must equal the lines actually missing from the digest.
    const markerStart = result.text.indexOf('\n…[');
    const markerEnd = result.text.indexOf(']…\n');
    // slice up to markerStart: the head's own trailing newline is inside the
    // slice; the marker's leading newline (at markerStart) is not a head line.
    const visibleHeadLines = result.text.slice(0, markerStart).split('\n').length - 1;
    const visibleTailLines = result.text.slice(markerEnd + 3).split('\n').length - 1;
    expect(statedElidedLines).toBe(2000 - visibleHeadLines - visibleTailLines);
    expect(statedElidedLines).toBeGreaterThan(0);
  });

  it('flags both boundaries as partial when items are longer than the half budget', () => {
    // The PRI-2865 failure: a 3-item list of single-line records, each larger
    // than the 1 KiB half budget. The head ends inside item 1 and the tail
    // begins inside item 3, so item 1's prefix and item 3's suffix read as ONE
    // malformed record unless the marker says both sides are partial.
    const item = (n: number) => `{"reminder":${n},"prompt":"${'x'.repeat(3000)}"}`;
    const full = `${item(1)}\n${item(2)}\n${item(3)}\n`;
    const result = digestToolResultText(full, 'tc_midrecord');

    expect(result.elidedBytes).toBeGreaterThan(0);
    expect(result.text).toContain('PARTIAL');
    expect(result.text).toContain('before');
    expect(result.text).toContain('after');
    // Exactly ONE record (item 2) is entirely absent; items 1 and 3 are
    // partial fragments, flagged as such — they must not inflate the count.
    expect(result.text).toContain('…[1 lines,');
  });

  it('does not claim partial lines when the cuts landed on line boundaries', () => {
    const lines: string[] = [];
    for (let i = 0; i < 2000; i++) {
      lines.push(`AAAA-${i}-BBBB padding padding padding padding padding`);
    }
    const full = lines.join('\n') + '\n';
    const result = digestToolResultText(full, 'tc_clean');
    expect(result.elidedBytes).toBeGreaterThan(0);
    expect(result.text).not.toContain('PARTIAL');
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
