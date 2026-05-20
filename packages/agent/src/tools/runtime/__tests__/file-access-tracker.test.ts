import { describe, expect, it } from 'vitest';
import { FileAccessTracker } from '../file-access-tracker';

describe('FileAccessTracker', () => {
  it('tracks canonical runtime path keys', () => {
    const tracker = new FileAccessTracker();
    const path = {
      original: 'src/a.ts',
      runtimePath: '/runtime/src/a.ts',
      displayPath: 'src/a.ts',
    };

    tracker.markRead(path, 'container:rt_1:/runtime/src/a.ts');

    expect(tracker.hasRead(path, 'container:rt_1:/runtime/src/a.ts')).toBe(true);
    expect(tracker.hasRead(path, 'container:rt_2:/runtime/src/a.ts')).toBe(false);
  });
});
