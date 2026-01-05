import { describe, it, expect } from 'vitest';
import { parseArgs } from '../args';

describe('parseArgs', () => {
  it('parses defaults', () => {
    const parsed = parseArgs([]);
    if (parsed.kind !== 'ok') throw new Error('expected ok');
    expect(parsed.args.workDir.length).toBeGreaterThan(0);
    expect(parsed.args.explicitNew).toBe(false);
  });

  it('parses --agent-cmd', () => {
    const parsed = parseArgs(['--agent-cmd', 'lace-agent']);
    if (parsed.kind !== 'ok') throw new Error('expected ok');
    expect(parsed.args.agentCmd).toBe('lace-agent');
  });

  it('parses --workdir', () => {
    const parsed = parseArgs(['--workdir', '/tmp']);
    if (parsed.kind !== 'ok') throw new Error('expected ok');
    expect(parsed.args.workDir).toBe('/tmp');
  });

  it('parses --load', () => {
    const parsed = parseArgs(['--load', 'sess_123']);
    if (parsed.kind !== 'ok') throw new Error('expected ok');
    expect(parsed.args.loadSessionId).toBe('sess_123');
  });

  it('parses --new', () => {
    const parsed = parseArgs(['--new']);
    if (parsed.kind !== 'ok') throw new Error('expected ok');
    expect(parsed.args.explicitNew).toBe(true);
  });

  it('returns help', () => {
    const parsed = parseArgs(['--help']);
    expect(parsed.kind).toBe('help');
    if (parsed.kind !== 'help') throw new Error('expected help');
    expect(parsed.exitCode).toBe(0);
    expect(parsed.text).toContain('Usage:');
  });

  it('rejects unknown flags', () => {
    expect(() => parseArgs(['--nope'])).toThrow('Unknown arg: --nope');
  });

  it('validates --timeout-ms', () => {
    expect(() => parseArgs(['--timeout-ms'])).toThrow('--timeout-ms requires a number');
    expect(() => parseArgs(['--timeout-ms', '0'])).toThrow(
      '--timeout-ms must be a positive number'
    );
    expect(() => parseArgs(['--timeout-ms', 'nope'])).toThrow(
      '--timeout-ms must be a positive number'
    );
  });
});
