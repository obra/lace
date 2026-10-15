// ABOUTME: composeSkillDirs orders persona-first, then plugin, then core, then embedder/workDir.
import { describe, it, expect, beforeEach } from 'vitest';
import { resetContributedDirsForTest, addSkillDir } from '@lace/agent/plugins';
import { composeSkillDirs } from '../compose-skill-dirs';

describe('composeSkillDirs', () => {
  beforeEach(() => resetContributedDirsForTest());
  it('persona dir first, then plugin dirs, then core, then embedder/workDir tier', () => {
    addSkillDir('acme', '/plugin/skills');
    const dirs = composeSkillDirs({ skillDirs: ['/embedder/skills'] }, '/persona/skills', {
      coreDir: '/core/skills',
    });
    expect(dirs).toEqual([
      '/persona/skills',
      { dir: '/plugin/skills', namespace: 'acme' },
      '/core/skills',
      '/embedder/skills',
    ]);
  });
  it('keeps embedder namespaces and order', () => {
    const dirs = composeSkillDirs(
      {
        skillDirs: [
          { dir: '/local', namespace: 'local' },
          '/bare',
          { dir: '/org', namespace: 'org-acme' },
        ],
      },
      null,
      {}
    );
    expect(dirs).toEqual([
      { dir: '/local', namespace: 'local' },
      '/bare',
      { dir: '/org', namespace: 'org-acme' },
    ]);
  });
  it('omits a null persona dir and an absent core dir', () => {
    const dirs = composeSkillDirs({ skillDirs: ['/e'] }, null, {});
    expect(dirs).toEqual(['/e']);
  });
});
