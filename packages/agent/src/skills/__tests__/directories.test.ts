// ABOUTME: Tests for skill directory resolution with precedence ordering

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';
import { getSkillDirectories } from '../directories';

describe('getSkillDirectories', () => {
  beforeEach(() => {
    // Mock homedir to have a consistent test environment
    vi.spyOn(os, 'homedir').mockReturnValue('/home/testuser');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns directories in correct precedence order', () => {
    const result = getSkillDirectories('/projects/my-app');

    expect(result).toEqual([
      '/projects/my-app/.lace/skills/',
      '/projects/my-app/.claude/skills/',
      '/home/testuser/.lace/skills/',
      '/home/testuser/.claude/skills/',
    ]);
  });

  it('excludes project directories when projectDir is undefined', () => {
    const result = getSkillDirectories(undefined);

    expect(result).toEqual(['/home/testuser/.lace/skills/', '/home/testuser/.claude/skills/']);
  });

  it('excludes project directories when projectDir is empty', () => {
    const result = getSkillDirectories('');

    expect(result).toEqual(['/home/testuser/.lace/skills/', '/home/testuser/.claude/skills/']);
  });
});
