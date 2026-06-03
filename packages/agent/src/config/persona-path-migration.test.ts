// ABOUTME: Scenario test - verifies bundled personas still render byte-identically
// ABOUTME: after migrating from {{include:...}} to @path. Diffs against the committed baseline.

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { TemplateEngine } from './template-engine';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bundledPersonasDir = path.resolve(__dirname, '../../config/agent-personas');
const baselineDir = path.resolve(
  __dirname,
  '../../../../tests/scenarios/persona-path-migration-baseline'
);

describe('@path migration scenario', () => {
  const personaFiles = fs.readdirSync(bundledPersonasDir).filter((name) => name.endsWith('.md'));

  it('discovers the expected set of bundled personas', () => {
    expect(personaFiles.sort()).toEqual(
      ['coding-agent.md', 'helper-agent.md', 'lace.md', 'session-summary.md'].sort()
    );
  });

  it('no persona file still uses the legacy {{include:...}} syntax', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && entry.name.endsWith('.md')) {
          const text = fs.readFileSync(full, 'utf-8');
          if (text.includes('{{include:')) offenders.push(full);
        }
      }
    };
    walk(bundledPersonasDir);
    expect(offenders).toEqual([]);
  });

  for (const file of personaFiles) {
    it(`renders ${file} byte-identically to the pre-migration baseline`, () => {
      const engine = new TemplateEngine([bundledPersonasDir]);
      const rendered = engine.render(file, {});
      const baselinePath = path.join(baselineDir, file);
      const expected = fs.readFileSync(baselinePath, 'utf-8');
      expect(rendered).toBe(expected);
    });
  }
});
