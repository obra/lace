import { describe, it, expect } from 'vitest';
import { nodeErrorFromExec } from '../container-exec-shared';

describe('nodeErrorFromExec', () => {
  it('maps "No such file or directory" to ENOENT', () => {
    const e = nodeErrorFromExec(1, 'cat: /sen/x: No such file or directory', 'read', '/sen/x');
    expect((e as NodeJS.ErrnoException).code).toBe('ENOENT');
  });
  it('maps "Permission denied" to EACCES', () => {
    const e = nodeErrorFromExec(
      1,
      'sh: 1: cannot create /sen/ro/x: Permission denied',
      'write',
      '/sen/ro/x'
    );
    expect((e as NodeJS.ErrnoException).code).toBe('EACCES');
  });
  it('maps "Read-only file system" to EACCES (RO mount write)', () => {
    const e = nodeErrorFromExec(
      1,
      'sh: cannot create x: Read-only file system',
      'write',
      '/sen/core-identity/x'
    );
    expect((e as NodeJS.ErrnoException).code).toBe('EACCES');
  });
  it('falls back to a generic error with the stderr when unmatched', () => {
    const e = nodeErrorFromExec(2, 'some other failure', 'stat', '/sen/x');
    expect((e as NodeJS.ErrnoException).code).toBeUndefined();
    expect(e.message).toContain('some other failure');
  });
});
