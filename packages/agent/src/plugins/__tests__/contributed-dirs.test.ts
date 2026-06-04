// ABOUTME: Plugin-contributed persona/skill dirs accumulate by namespace and reset for tests.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  addPersonaDir,
  personaDirs,
  addSkillDir,
  skillDirs,
  resetContributedDirsForTest,
} from '../contributed-dirs';

describe('contributed dirs', () => {
  beforeEach(() => resetContributedDirsForTest());
  it('records persona dirs with their namespace, in order', () => {
    addPersonaDir('acme', '/a/personas');
    addPersonaDir('beta', '/b/personas');
    expect(personaDirs()).toEqual([
      { namespace: 'acme', dir: '/a/personas' },
      { namespace: 'beta', dir: '/b/personas' },
    ]);
  });
  it('records skill dirs and resets', () => {
    addSkillDir('acme', '/a/skills');
    expect(skillDirs()).toEqual([{ namespace: 'acme', dir: '/a/skills' }]);
    resetContributedDirsForTest();
    expect(skillDirs()).toEqual([]);
    expect(personaDirs()).toEqual([]);
  });
});
