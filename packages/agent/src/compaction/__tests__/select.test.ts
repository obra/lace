// ABOUTME: Tests for compactionStrategyNameForPersona and compactionBreakpointsForPersona —
// ABOUTME: persona-configured values, defaults, and the loud-fallback contract (PRI-2943).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Breakpoint } from '../select';

// Mock the two external dependencies so we don't need real files or a registry
vi.mock('@lace/agent/config/persona-registry', () => ({
  personaRegistry: {
    parsePersona: vi.fn(),
  },
}));
vi.mock('@lace/agent/utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { personaRegistry } from '@lace/agent/config/persona-registry';
import { logger } from '@lace/agent/utils/logger';
import {
  compactionBreakpointsForPersona,
  compactionStrategyNameForPersona,
  DEFAULT_BREAKPOINTS,
} from '../select';

const mockParsePersona = vi.mocked(personaRegistry.parsePersona);
const mockWarn = vi.mocked(logger.warn);

beforeEach(() => {
  vi.clearAllMocks();
});

const resolver = (config: unknown) => ({
  parsePersona: vi.fn().mockReturnValue({ config, body: '' }),
});
const throwingResolver = (msg: string) => ({
  parsePersona: vi.fn().mockImplementation(() => {
    throw new Error(msg);
  }),
});

describe('compactionStrategyNameForPersona', () => {
  it('returns the persona-configured strategy', () => {
    const reg = resolver({ compaction: { strategy: 'sen-multiconv' } });
    expect(compactionStrategyNameForPersona('core', reg as never)).toBe('sen-multiconv');
  });

  it('defaults to track-based when the session has no persona', () => {
    const reg = resolver({});
    expect(compactionStrategyNameForPersona(null, reg as never)).toBe('track-based');
    expect(reg.parsePersona).not.toHaveBeenCalled();
  });

  it('defaults to track-based when the persona configures no strategy', () => {
    expect(compactionStrategyNameForPersona('minimal', resolver({}) as never)).toBe('track-based');
  });

  it('resolves through the SUPPLIED registry — there is no singleton default', () => {
    const reg = resolver({ compaction: { strategy: 'from-session-registry' } });
    expect(compactionStrategyNameForPersona('core', reg as never)).toBe('from-session-registry');
    expect(reg.parsePersona).toHaveBeenCalledWith('core');
  });
});

describe('compactionBreakpointsForPersona', () => {
  it('returns persona breakpoints when configured', () => {
    const bps = [
      { at: 0.55, action: 'notify' as const },
      { at: 0.9, action: 'compact' as const },
    ];
    expect(
      compactionBreakpointsForPersona(
        'core',
        resolver({ compaction: { breakpoints: bps } }) as never
      )
    ).toEqual(bps);
  });

  it('falls back to defaults with no persona, no stanza, or an empty list', () => {
    expect(compactionBreakpointsForPersona(null, resolver({}) as never)).toEqual(
      DEFAULT_BREAKPOINTS
    );
    expect(compactionBreakpointsForPersona('x', resolver({}) as never)).toEqual(
      DEFAULT_BREAKPOINTS
    );
    expect(
      compactionBreakpointsForPersona('x', resolver({ compaction: { breakpoints: [] } }) as never)
    ).toEqual(DEFAULT_BREAKPOINTS);
  });
});

// PRI-2943: the fallback must stay, but it must never be silent.
describe('persona resolution failure is loud', () => {
  it('falls back to track-based when the registry cannot parse the persona', () => {
    expect(
      compactionStrategyNameForPersona(
        'core',
        throwingResolver("Persona 'core' not found.") as never
      )
    ).toBe('track-based');
  });

  it('warns, naming the persona and the session', () => {
    compactionStrategyNameForPersona('core', throwingResolver('boom') as never, {
      sessionDir: '/instances/cadence/state/lace/agent-sessions/sess_x',
    });
    const logged = JSON.stringify(mockWarn.mock.calls);
    expect(logged).toContain('core');
    expect(logged).toContain('sess_x');
  });

  it('warns on the breakpoint path too', () => {
    compactionBreakpointsForPersona('core', throwingResolver('boom') as never);
    expect(mockWarn).toHaveBeenCalled();
  });

  it('stays quiet on the legitimate no-persona path', () => {
    expect(compactionStrategyNameForPersona(null, resolver({}) as never)).toBe('track-based');
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('stays quiet when a parsed persona simply configures nothing', () => {
    expect(compactionStrategyNameForPersona('minimal', resolver({}) as never)).toBe('track-based');
    expect(mockWarn).not.toHaveBeenCalled();
  });
});
