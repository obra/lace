// ABOUTME: Tests for compactionBreakpointsForSession — default and persona-override paths
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

import { personaForSessionDir } from '@lace/agent/storage/event-log';
import { personaRegistry } from '@lace/agent/config/persona-registry';
import {
  compactionBreakpointsForSession,
  compactionStrategyNameForSession,
  DEFAULT_BREAKPOINTS,
} from '../select';

const mockPersonaForSessionDir = vi.mocked(personaForSessionDir);
const mockParsePersona = vi.mocked(personaRegistry.parsePersona);

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
