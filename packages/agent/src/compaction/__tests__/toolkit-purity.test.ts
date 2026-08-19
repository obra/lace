// ABOUTME: The toolkit is imported across checkouts by plugin strategies, so its
// ABOUTME: header promises it is self-contained. That promise is only worth
// ABOUTME: anything if something checks it: a stray import of the storage layer
// ABOUTME: drags better-sqlite3 (a native module) in behind it, and a plugin
// ABOUTME: whose node_modules resolves a differently-built copy fails at import.

import { describe, it, expect } from 'vitest';

describe('compaction toolkit stays importable on its own', () => {
  it('does not pull a native database module in behind it', async () => {
    await import('../toolkit');
    const loaded = Object.keys(require.cache ?? {});
    const native = loaded.filter((m) => m.includes('better-sqlite3'));
    expect(native, `toolkit dragged in: ${native.join(', ')}`).toEqual([]);
  });
});
