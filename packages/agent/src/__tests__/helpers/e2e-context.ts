// ABOUTME: Shared E2E test context - handles temp dirs, env vars, cleanup

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpawnedAgent } from './agent-process';

export interface E2ETestContext {
  /** Temporary LACE_DIR for this test */
  readonly laceDir: string;
  /** Temporary working directory for this test */
  readonly workDir: string;
  /** The spawned agent (set by test, cleaned up automatically) */
  agent: SpawnedAgent | undefined;
  /** Call in beforeEach */
  setup(): void;
  /** Call in afterEach */
  teardown(): Promise<void>;
}

export interface E2EContextOptions {
  /** Prefix for temp directory names (default: 'lace-e2e') */
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
 *   ctx.agent = spawnAgentProcess({ laceDir: ctx.laceDir });
 *   // ...
 * });
 * ```
 */
export function createE2EContext(options?: E2EContextOptions): E2ETestContext {
  const prefix = options?.prefix ?? 'lace-e2e';
  const enableTestProvider = options?.enableTestProvider ?? true;

  let laceDir = '';
  let workDir = '';
  let agent: SpawnedAgent | undefined;
  let savedEnv: {
    LACE_DIR?: string;
    LACE_AGENT_TEST_PROVIDER?: string;
    LACE_AGENT_TEST_PROVIDER_STRICT_CONFIG?: string;
  } = {};

  return {
    get laceDir() {
      return laceDir;
    },
    get workDir() {
      return workDir;
    },
    get agent() {
      return agent;
    },
    set agent(a: SpawnedAgent | undefined) {
      agent = a;
    },

    setup() {
      // Save current env
      savedEnv = {
        LACE_DIR: process.env.LACE_DIR,
        LACE_AGENT_TEST_PROVIDER: process.env.LACE_AGENT_TEST_PROVIDER,
        LACE_AGENT_TEST_PROVIDER_STRICT_CONFIG: process.env.LACE_AGENT_TEST_PROVIDER_STRICT_CONFIG,
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
      // Shutdown agent if running
      if (agent) {
        await agent.shutdown();
        agent = undefined;
      }

      // Restore env vars
      if (savedEnv.LACE_DIR === undefined) delete process.env.LACE_DIR;
      else process.env.LACE_DIR = savedEnv.LACE_DIR;

      if (savedEnv.LACE_AGENT_TEST_PROVIDER === undefined) {
        delete process.env.LACE_AGENT_TEST_PROVIDER;
      } else {
        process.env.LACE_AGENT_TEST_PROVIDER = savedEnv.LACE_AGENT_TEST_PROVIDER;
      }

      if (savedEnv.LACE_AGENT_TEST_PROVIDER_STRICT_CONFIG === undefined) {
        delete process.env.LACE_AGENT_TEST_PROVIDER_STRICT_CONFIG;
      } else {
        process.env.LACE_AGENT_TEST_PROVIDER_STRICT_CONFIG = savedEnv.LACE_AGENT_TEST_PROVIDER_STRICT_CONFIG;
      }

      // Cleanup temp directories
      rmSync(laceDir, { recursive: true, force: true });
      rmSync(workDir, { recursive: true, force: true });
    },
  };
}
