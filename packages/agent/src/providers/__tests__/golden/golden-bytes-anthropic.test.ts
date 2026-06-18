// ABOUTME: Pins the LITERAL Anthropic request-body bytes for the shared fixture
// corpus as committed golden snapshots. This is the refactor-equivalence gate:
// later session-state refactors must reproduce these exact bytes. Each fixture
// is captured twice in one run and asserted byte-equal first, to catch any
// body-level nondeterminism immediately before the snapshot compare.

import { describe, it, expect } from 'vitest';
import { captureAnthropicBody } from './_capture-request-body';
import { FIXTURES } from './_fixtures';

describe('golden-bytes: Anthropic request body is pinned', () => {
  for (const fixture of FIXTURES) {
    it(`pins the Anthropic body for "${fixture.name}"`, async () => {
      // Intra-run determinism: two captures of the same fixture must be byte-equal.
      const a = await captureAnthropicBody(fixture);
      const b = await captureAnthropicBody(fixture);
      expect(a).toBe(b);

      // Refactor-equivalence gate: the body must match the committed golden bytes.
      await expect(a).toMatchFileSnapshot(`./anthropic-${fixture.name}.json`);
    });
  }
});
