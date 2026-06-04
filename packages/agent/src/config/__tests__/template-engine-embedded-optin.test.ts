// ABOUTME: TemplateEngine embedded-lookup is opt-in; FS-only engines never read embedded files.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TemplateEngine } from '../template-engine';

describe('TemplateEngine embedded opt-in', () => {
  it('an FS-only engine renders the FS file and its includes from its own dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'te-'));
    mkdirSync(join(dir, 'sections'), { recursive: true });
    writeFileSync(join(dir, 'sections', 'foo.md'), 'SECTION-FS');
    writeFileSync(join(dir, 'p.md'), 'body @sections/foo.md {{x}}');
    const engine = new TemplateEngine([dir]); // default: embedded NOT used
    const out = engine.render('p.md', { x: 'X' });
    expect(out).toContain('SECTION-FS');
    expect(out).toContain('X');
  });

  it('exposes a flag to enable embedded-first (bundled source only)', () => {
    const engine = new TemplateEngine([], { useEmbedded: true });
    expect(engine.usesEmbedded).toBe(true);
    const fsEngine = new TemplateEngine([]);
    expect(fsEngine.usesEmbedded).toBe(false);
  });
});
