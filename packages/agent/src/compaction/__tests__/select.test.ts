// ABOUTME: Tests for compactionBreakpointsForSession — default and persona-override paths
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Breakpoint } from '../select';

// Mock the two external dependencies so we don't need real files or a registry
vi.mock('@lace/agent/storage/event-log', () => ({
  personaForSessionDir: vi.fn(),
  invalidatePersonaCache: vi.fn(),
}));
vi.mock('@lace/agent/config/persona-registry', () => ({
  personaRegistry: {
    parsePersona: vi.fn(),
  },
}));
vi.mock('@lace/agent/utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { personaForSessionDir } from '@lace/agent/storage/event-log';
import { personaRegistry } from '@lace/agent/config/persona-registry';
import { logger } from '@lace/agent/utils/logger';
import {
  compactionBreakpointsForSession,
  compactionStrategyNameForSession,
  DEFAULT_BREAKPOINTS,
} from '../select';

const mockPersonaForSessionDir = vi.mocked(personaForSessionDir);
const mockParsePersona = vi.mocked(personaRegistry.parsePersona);
const mockWarn = vi.mocked(logger.warn);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('compactionBreakpointsForSession', () => {
  it('returns default breakpoints when there is no persona', () => {
    mockPersonaForSessionDir.mockReturnValue(null);
    expect(compactionBreakpointsForSession('/some/dir')).toEqual(DEFAULT_BREAKPOINTS);
    expect(mockParsePersona).not.toHaveBeenCalled();
  });

  it('returns default breakpoints when persona has no compaction field', () => {
    mockPersonaForSessionDir.mockReturnValue('minimal');
    mockParsePersona.mockReturnValue({ config: {}, body: '' } as any);
    expect(compactionBreakpointsForSession('/some/dir')).toEqual(DEFAULT_BREAKPOINTS);
  });

  it('returns default breakpoints when persona has compaction but no breakpoints', () => {
    mockPersonaForSessionDir.mockReturnValue('no-bp');
    mockParsePersona.mockReturnValue({
      config: { compaction: { strategy: 'track-based' } },
      body: '',
    } as any);
    expect(compactionBreakpointsForSession('/some/dir')).toEqual(DEFAULT_BREAKPOINTS);
  });

  it('returns default breakpoints when persona has empty breakpoints array', () => {
    mockPersonaForSessionDir.mockReturnValue('empty-bp');
    mockParsePersona.mockReturnValue({
      config: { compaction: { breakpoints: [] } },
      body: '',
    } as any);
    expect(compactionBreakpointsForSession('/some/dir')).toEqual(DEFAULT_BREAKPOINTS);
  });

  it('returns persona breakpoints when configured with notify action', () => {
    const personaBps: Breakpoint[] = [
      { at: 0.7, action: 'notify' },
      { at: 0.95, action: 'compact' },
    ];
    mockPersonaForSessionDir.mockReturnValue('custom-notify');
    mockParsePersona.mockReturnValue({
      config: { compaction: { breakpoints: personaBps } },
      body: '',
    } as any);
    expect(compactionBreakpointsForSession('/some/dir')).toEqual(personaBps);
  });

  it('returns persona breakpoints when configured with compact-only actions', () => {
    const personaBps: Breakpoint[] = [
      { at: 0.5, action: 'compact' },
      { at: 0.8, action: 'compact' },
    ];
    mockPersonaForSessionDir.mockReturnValue('custom-compact');
    mockParsePersona.mockReturnValue({
      config: { compaction: { breakpoints: personaBps } },
      body: '',
    } as any);
    expect(compactionBreakpointsForSession('/some/dir')).toEqual(personaBps);
  });

  it('returns default breakpoints when personaForSessionDir throws', () => {
    mockPersonaForSessionDir.mockImplementation(() => {
      throw new Error('broken');
    });
    expect(compactionBreakpointsForSession('/some/dir')).toEqual(DEFAULT_BREAKPOINTS);
  });

  it('returns default breakpoints when parsePersona throws', () => {
    mockPersonaForSessionDir.mockReturnValue('bad-persona');
    mockParsePersona.mockImplementation(() => {
      throw new Error('parse failed');
    });
    expect(compactionBreakpointsForSession('/some/dir')).toEqual(DEFAULT_BREAKPOINTS);
  });
});

describe('compactionStrategyNameForSession', () => {
  it('returns track-based when there is no persona', () => {
    mockPersonaForSessionDir.mockReturnValue(null);
    expect(compactionStrategyNameForSession('/some/dir')).toBe('track-based');
  });

  it('returns track-based when persona has no compaction.strategy', () => {
    mockPersonaForSessionDir.mockReturnValue('minimal');
    mockParsePersona.mockReturnValue({ config: {}, body: '' } as any);
    expect(compactionStrategyNameForSession('/some/dir')).toBe('track-based');
  });

  it('returns custom strategy from persona', () => {
    mockPersonaForSessionDir.mockReturnValue('custom');
    mockParsePersona.mockReturnValue({
      config: { compaction: { strategy: 'my-strategy' } },
      body: '',
    } as any);
    expect(compactionStrategyNameForSession('/some/dir')).toBe('my-strategy');
  });
});

// ---------------------------------------------------------------------------
// PRI-2943: a persona that cannot be resolved must not degrade in silence.
//
// cadence-sen ran 203 consecutive compactions on `track-based` while her
// persona asked for `sen-multiconv`, because `personaRegistry.parsePersona`
// threw (her instance had no `$LACE_DIR/agent-personas`) and this module
// swallowed the throw with a bare `catch`. Nothing logged. The fallback itself
// is correct — compaction must not become fatal on a live coworker — but it
// has to be OBSERVABLE, and the strategy side needs the same coverage the
// breakpoint side already had.
// ---------------------------------------------------------------------------
describe('persona resolution failure is loud (PRI-2943)', () => {
  it('still falls back to track-based when parsePersona throws', () => {
    mockPersonaForSessionDir.mockReturnValue('core');
    mockParsePersona.mockImplementation(() => {
      throw new Error("Persona 'core' not found. Available personas: lace");
    });
    expect(compactionStrategyNameForSession('/some/dir')).toBe('track-based');
  });

  it('warns when a named persona cannot be parsed for its strategy', () => {
    mockPersonaForSessionDir.mockReturnValue('core');
    mockParsePersona.mockImplementation(() => {
      throw new Error("Persona 'core' not found. Available personas: lace");
    });
    compactionStrategyNameForSession('/some/dir');
    expect(mockWarn).toHaveBeenCalled();
  });

  it('names the persona and the session dir in the warning', () => {
    mockPersonaForSessionDir.mockReturnValue('core');
    mockParsePersona.mockImplementation(() => {
      throw new Error('boom');
    });
    compactionStrategyNameForSession('/instances/cadence/state/lace/agent-sessions/sess_x');
    const logged = JSON.stringify(mockWarn.mock.calls);
    expect(logged).toContain('core');
    expect(logged).toContain('sess_x');
  });

  it('warns when a named persona cannot be parsed for its breakpoints', () => {
    mockPersonaForSessionDir.mockReturnValue('core');
    mockParsePersona.mockImplementation(() => {
      throw new Error('boom');
    });
    compactionBreakpointsForSession('/some/dir');
    expect(mockWarn).toHaveBeenCalled();
  });

  it('stays quiet on the legitimate no-persona path', () => {
    mockPersonaForSessionDir.mockReturnValue(null);
    expect(compactionStrategyNameForSession('/some/dir')).toBe('track-based');
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('stays quiet when a parsed persona simply configures no strategy', () => {
    mockPersonaForSessionDir.mockReturnValue('minimal');
    mockParsePersona.mockReturnValue({ config: {}, body: '' } as any);
    expect(compactionStrategyNameForSession('/some/dir')).toBe('track-based');
    expect(mockWarn).not.toHaveBeenCalled();
  });
});
