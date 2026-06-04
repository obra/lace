// ABOUTME: Plugin persona dirs resolve as <ns>:<entry>; precedence user>plugin>bundled;
// ABOUTME: render is source-scoped (a plugin persona's @sections include comes from ITS dir).
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersonaRegistry } from '../persona-registry';
import { addPersonaDir, resetContributedDirsForTest } from '@lace/agent/plugins';

describe('PersonaRegistry file-dir sources', () => {
  beforeEach(() => resetContributedDirsForTest());

  it('resolves a plugin persona as <ns>:<entry> with a real path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pp-acme-'));
    writeFileSync(join(dir, 'scout.md'), 'You are Scout. {{system.os}}');
    addPersonaDir('acme', dir);
    const reg = new PersonaRegistry({ bundledPersonasPath: '/nonexistent', userPersonasPaths: [] });
    expect(reg.hasPersona('acme:scout')).toBe(true);
    expect(reg.parsePersona('acme:scout').body).toContain('Scout');
    const info = reg.listAvailablePersonas().find((p) => p.name === 'acme:scout');
    expect(info?.path).toBe(join(dir, 'scout.md'));
  });

  it('renders a plugin persona source-scoped (include from its own dir)', () => {
    const root = mkdtempSync(join(tmpdir(), 'pp-acme-'));
    mkdirSync(join(root, 'sections'), { recursive: true });
    writeFileSync(join(root, 'sections', 'role.md'), 'ROLE-FROM-PLUGIN');
    writeFileSync(join(root, 'docs.md'), 'persona @sections/role.md');
    addPersonaDir('acme', root);
    const reg = new PersonaRegistry({ bundledPersonasPath: '/nonexistent', userPersonasPaths: [] });
    expect(reg.renderPersona('acme:docs', {})).toContain('ROLE-FROM-PLUGIN');
  });

  it('exposes personaToolsDir / personaSkillsDir as real dirs when present', () => {
    const root = mkdtempSync(join(tmpdir(), 'pp-acme-'));
    writeFileSync(join(root, 'scout.md'), 'x');
    mkdirSync(join(root, 'scout', 'tools'), { recursive: true });
    addPersonaDir('acme', root);
    const reg = new PersonaRegistry({ bundledPersonasPath: '/nonexistent', userPersonasPaths: [] });
    expect(reg.personaToolsDir('acme:scout')).toBe(join(root, 'scout', 'tools'));
    expect(reg.personaSkillsDir('acme:scout')).toBeNull();
  });
});
