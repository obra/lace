// ABOUTME: Tests for markdown rendering of compacted track blocks

import { describe, it, expect } from 'vitest';
import { renderCompactionPrefix } from '../track-render';
import type { TrackBlock } from '../track-compaction';

describe('renderCompactionPrefix', () => {
  it('emits the header and the per-section blocks in fixed order', () => {
    const blocks: TrackBlock[] = [
      {
        trackId: 'slack:T:C1:1.0',
        body: '### slack:T:C1:1.0\n- They said: hi',
        estimatedTokens: 10,
      },
      { trackId: 'job:job_a', body: '- job:job_a ✓ completed: IP check', estimatedTokens: 8 },
    ];
    const out = renderCompactionPrefix({
      blocks,
      scheduler: { alarmsPending: 2, remindersPending: 1 },
    });
    expect(out).toContain('[Earlier conversation, compacted by track]');
    expect(out).toContain('## Slack threads');
    expect(out).toContain('### slack:T:C1:1.0');
    expect(out).toContain('## Subagent jobs');
    expect(out).toContain('- job:job_a ✓ completed: IP check');
    expect(out).toContain('## Scheduler');
    expect(out).toMatch(/2 alarms pending, 1 reminder pending/);
  });

  it('skips empty sections', () => {
    const out = renderCompactionPrefix({
      blocks: [{ trackId: 'job:a', body: '- job:a ✓ completed: x', estimatedTokens: 5 }],
      scheduler: { alarmsPending: 0, remindersPending: 0 },
    });
    expect(out).not.toContain('## Slack threads');
    expect(out).toContain('## Subagent jobs');
    expect(out).not.toContain('## Scheduler');
  });

  it('emits system events section only if any present', () => {
    const blocks: TrackBlock[] = [
      {
        trackId: 'system:idle-errors',
        body: '3 idle-error reports since last compaction.',
        estimatedTokens: 6,
      },
    ];
    const out = renderCompactionPrefix({
      blocks,
      scheduler: { alarmsPending: 0, remindersPending: 0 },
    });
    expect(out).toContain('## System events');
    expect(out).toContain('3 idle-error reports');
  });

  it('renders unknown track prefixes under ## Other section', () => {
    // A future track type (e.g. webhook:) or a typo must not silently fall out
    // of the rendered output — it should appear under ## Other.
    const blocks: TrackBlock[] = [
      {
        trackId: 'webhook:foo',
        body: '### webhook:foo\n- event received',
        estimatedTokens: 5,
      },
    ];
    const out = renderCompactionPrefix({
      blocks,
      scheduler: { alarmsPending: 0, remindersPending: 0 },
    });
    expect(out).toContain('## Other');
    expect(out).toContain('### webhook:foo');
    expect(out).toContain('event received');
    // Should not appear under any known-prefix section
    expect(out).not.toContain('## Slack threads');
    expect(out).not.toContain('## Subagent jobs');
    expect(out).not.toContain('## System events');
  });
});
