import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// NOTE ON TEST PARALLELISM
// The tests under `src/__tests__/` (plus the three Docker integration tests) each
// spawn a real subprocess — a child lace-agent over stdio, or a Docker container.
// Running many of them in parallel oversubscribes the CPU and makes their internal
// request timeouts flake nondeterministically. They must run with file parallelism
// disabled. This CANNOT be expressed here as a per-project `fileParallelism: false`:
// vitest schedules all projects through one shared worker pool and interleaves their
// files, so a "serial" project still runs concurrently with the parallel one. The
// serialization is therefore done in the package.json `test` script, which runs the
// fast unit tests in parallel first, then the subprocess-heavy tests in a second
// `vitest run --no-file-parallelism` pass.
//
// Those same tests must NOT inherit vitest's 5s default `testTimeout`: at the
// concurrency a fully parallel run produces, the child agent's cold boot alone
// eats most of that budget, and the test dies before its own `withTimeout`
// guards — the ones that name which call hung — can fire. They declare
// `E2E_TEST_TIMEOUT_MS` on their describe instead (see
// src/__tests__/helpers/agent-process.ts), which keeps the ordering
// 5s default < AGENT_BOOT_TIMEOUT_MS < E2E_TEST_TIMEOUT_MS. The default is left
// alone here so the ~3900 fast unit tests keep their tight guard. A new
// agent-spawning test file has to opt in the same way.

export default defineConfig({
  root: __dirname,
  resolve: {
    alias: {
      '@lace/agent': resolve(__dirname, 'src'),
    },
  },
  test: {
    include: [
      'src/**/__tests__/**/*.{test,spec}.{ts,tsx}',
      'src/__tests__/**/*.{test,spec}.{ts,tsx}',
      'src/**/*.{test,spec}.{ts,tsx}',
    ],
    environment: 'node',
    setupFiles: [],
  },
});
