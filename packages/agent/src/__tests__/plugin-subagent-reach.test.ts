// ABOUTME: E2E — a child lace process inherits LACE_PLUGINS and loads the same plugins
// ABOUTME: Proves subagent-reach: env-inheritance makes child registries identical to parent
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

const PROBE = path.resolve(__dirname, '../plugins/__fixtures__/loader-probe.ts');

describe('subagent plugin reach (env inheritance)', () => {
  it('a child process with LACE_PLUGINS inherited registers the plugin', () => {
    // The probe runs loader-probe.ts which calls loadPlugins(process.env.LACE_PLUGINS).
    // The loader does dynamic import(specifier) from src/plugins/loader.ts, so
    // './__fixtures__/reach-plugin' resolves to src/plugins/__fixtures__/reach-plugin.ts.
    const res = spawnSync(process.execPath, ['--import', 'tsx', PROBE], {
      env: { ...process.env, LACE_PLUGINS: './__fixtures__/reach-plugin' },
      cwd: __dirname,
      encoding: 'utf8',
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('reach-persona');
  });
});
