// ABOUTME: Tests for the provider-independent tool-name sanitizer that fixes MCP names
// ABOUTME: like 'private-journal/process_thoughts' before they hit any LLM provider API.

import { describe, expect, it } from 'vitest';
import {
  sanitizeToolName,
  buildSanitizedToolNames,
  unsanitizeToolName,
} from '@lace/agent/providers/tool-name-sanitizer';

describe('sanitizeToolName', () => {
  it('passes through names that already match [a-zA-Z0-9_-]', () => {
    expect(sanitizeToolName('send_slack_message')).toBe('send_slack_message');
    expect(sanitizeToolName('list-channels')).toBe('list-channels');
  });

  it("replaces '/' with '_'", () => {
    expect(sanitizeToolName('private-journal/process_thoughts')).toBe(
      'private-journal_process_thoughts'
    );
  });

  it('collapses consecutive underscores', () => {
    expect(sanitizeToolName('foo//bar')).toBe('foo_bar');
    expect(sanitizeToolName('foo.bar.baz')).toBe('foo_bar_baz');
  });

  it('throws on empty / all-underscore results', () => {
    expect(() => sanitizeToolName('')).toThrow();
    expect(() => sanitizeToolName('////')).toThrow();
  });
});

describe('buildSanitizedToolNames', () => {
  it('returns parallel arrays and a mapping', () => {
    const { names, mapping } = buildSanitizedToolNames([
      'send_slack_message',
      'private-journal/process_thoughts',
    ]);
    expect(names).toEqual(['send_slack_message', 'private-journal_process_thoughts']);
    expect(mapping.get('send_slack_message')).toBe('send_slack_message');
    expect(mapping.get('private-journal_process_thoughts')).toBe(
      'private-journal/process_thoughts'
    );
  });

  it('disambiguates collisions with numeric suffixes', () => {
    const { names } = buildSanitizedToolNames(['foo/bar', 'foo.bar']);
    expect(names[0]).toBe('foo_bar');
    expect(names[1]).toBe('foo_bar_2');
  });

  it('respects the 64-char universal cap', () => {
    const long = 'a'.repeat(80);
    const { names } = buildSanitizedToolNames([long]);
    expect(names[0]!.length).toBeLessThanOrEqual(64);
  });
});

describe('unsanitizeToolName', () => {
  it('recovers original names from the mapping', () => {
    const { names, mapping } = buildSanitizedToolNames(['private-journal/process_thoughts']);
    expect(unsanitizeToolName(names[0]!, mapping)).toBe('private-journal/process_thoughts');
  });

  it('passes through names not in the mapping', () => {
    expect(unsanitizeToolName('send_slack_message', new Map())).toBe('send_slack_message');
  });
});
