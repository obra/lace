// ABOUTME: Shared E2E test context - handles temp dirs, env vars, cleanup

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Any resource that can be shut down.
 */
export interface Shutdownable {
  shutdown(): Promise<void>;
}

/**
 * HTTP server that can be closed.
 */
export interface Closeable {
  close(): Promise<void>;
}

export interface E2ETestContext {
  /** Temporary LACE_DIR for this test */
  readonly laceDir: string;
  /** Temporary working directory for this test */
  readonly workDir: string;
  /** Resource to shutdown (SupervisorAgentProcess, Supervisor, etc.) */
  resource: Shutdownable | undefined;
  /** HTTP server to close */
  server: Closeable | undefined;
  /** Call in beforeEach */
  setup(): void;
  /** Call in afterEach */
  teardown(): Promise<void>;
}

export interface E2EContextOptions {
  /** Prefix for temp directory names (default: 'lace-supervisor-e2e') */
  prefix?: string;
  /** Whether to enable test provider (default: true) */
  enableTestProvider?: boolean;
}

/**
 * Create an E2E test context that manages temp dirs and env vars.
 *
 * @example
 * ```typescript
 * const ctx = createE2EContext();
 * beforeEach(() => ctx.setup());
 * afterEach(() => ctx.teardown());
 *
 * it('test', async () => {
 *   ctx.resource = new Supervisor({ storeDir: ctx.laceDir, ... });
 *   // ...
 * });
 * ```
 */
export function createE2EContext(options?: E2EContextOptions): E2ETestContext {
  const prefix = options?.prefix ?? 'lace-supervisor-e2e';
  const enableTestProvider = options?.enableTestProvider ?? true;

  let laceDir = '';
  let workDir = '';
  let resource: Shutdownable | undefined;
  let server: Closeable | undefined;
  let savedEnv: {
    LACE_DIR?: string;
    LACE_AGENT_TEST_PROVIDER?: string;
  } = {};

  return {
    get laceDir() {
      return laceDir;
    },
    get workDir() {
      return workDir;
    },
    get resource() {
      return resource;
    },
    set resource(r: Shutdownable | undefined) {
      resource = r;
    },
    get server() {
      return server;
    },
    set server(s: Closeable | undefined) {
      server = s;
    },

    setup() {
      // Save current env
      savedEnv = {
        LACE_DIR: process.env.LACE_DIR,
        LACE_AGENT_TEST_PROVIDER: process.env.LACE_AGENT_TEST_PROVIDER,
      };

      // Create temp directories
      laceDir = mkdtempSync(join(tmpdir(), `${prefix}-store-`));
      workDir = mkdtempSync(join(tmpdir(), `${prefix}-wd-`));

      // Set env vars
      process.env.LACE_DIR = laceDir;
      if (enableTestProvider) {
        process.env.LACE_AGENT_TEST_PROVIDER = '1';
      }
    },

    async teardown() {
      // Close server if running
      if (server) {
        await server.close();
        server = undefined;
      }

      // Shutdown resource if running
      if (resource) {
        await resource.shutdown();
        resource = undefined;
      }

      // Restore env vars
      if (savedEnv.LACE_DIR === undefined) delete process.env.LACE_DIR;
      else process.env.LACE_DIR = savedEnv.LACE_DIR;

      if (savedEnv.LACE_AGENT_TEST_PROVIDER === undefined) {
        delete process.env.LACE_AGENT_TEST_PROVIDER;
      } else {
        process.env.LACE_AGENT_TEST_PROVIDER = savedEnv.LACE_AGENT_TEST_PROVIDER;
      }

      // Cleanup temp directories
      rmSync(laceDir, { recursive: true, force: true });
      rmSync(workDir, { recursive: true, force: true });
    },
  };
}
