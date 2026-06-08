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
