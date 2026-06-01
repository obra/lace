// ABOUTME: Boot factory + entrypoint for the persona-spawn broker sidecar.
// ABOUTME: Wires DockerContainerRuntime + catalog + identity into a SpawnBrokerServer
// ABOUTME: from the broker's own boot env (never caller-supplied), then listens.

import { DockerContainerRuntime } from './docker-container';
import { BrokerPersonaCatalog } from './spawn-broker-personas';
import { SpawnBrokerIdentity } from './spawn-broker-identity';
import { SpawnBrokerServer } from './spawn-broker-server';
import { logger } from '@lace/agent/utils/logger';

// Boot env the broker MUST have. All are deployment-static facts the broker reads
// from its OWN environment — none is ever caller-supplied (the closed-spec property
// extends to every host path: the broker derives them, the caller cannot influence
// them).
export const REQUIRED_BROKER_ENV = [
  // Unix socket the broker listens on (mounted into main-sen so it can reach it).
  'SEN_SPAWN_BROKER_SOCKET',
  // Instance root host path → resolves persona mount host paths.
  'SEN_INSTANCE_HOST_PATH',
  // Helper subagent socket → register_runtime target + the sen-cred mount source.
  'SEN_CREDENTIAL_HELPER_SOCKET_HOST_PATH',
  // RO-mounted persona directory the catalog parses.
  'SEN_PERSONA_DIR',
  // Per-invocation scratch base host path (broker derives <base>/<childSessionId>).
  'SEN_BROKER_WORK_BASE_HOST_PATH',
] as const;

type BrokerEnv = Record<string, string | undefined>;

function requireEnv(env: BrokerEnv, key: string): string {
  const value = env[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`spawn-broker: required env ${key} is missing or empty`);
  }
  return value;
}

/**
 * Construct a SpawnBrokerServer from the broker's boot env. Throws clearly on any
 * missing/empty required var (fail loud at boot rather than mis-spawn later).
 */
export function buildBrokerFromEnv(env: BrokerEnv): SpawnBrokerServer {
  const socketPath = requireEnv(env, 'SEN_SPAWN_BROKER_SOCKET');
  const instanceHostPath = requireEnv(env, 'SEN_INSTANCE_HOST_PATH');
  const credentialHelperSocketHostPath = requireEnv(env, 'SEN_CREDENTIAL_HELPER_SOCKET_HOST_PATH');
  const personasDir = requireEnv(env, 'SEN_PERSONA_DIR');
  const workBaseHostPath = requireEnv(env, 'SEN_BROKER_WORK_BASE_HOST_PATH');

  const caStore = env.SEN_CREDENTIAL_HELPER_CA_STORE_HOST_PATH;
  const browserCdp = env.SEN_BROWSER_CDP_HOST_PATH;

  const catalog = new BrokerPersonaCatalog({
    personasDir,
    workBaseHostPath,
    mountEnv: {
      instanceHostPath,
      credentialHelperSocketHostPath,
      ...(caStore && caStore.length > 0 ? { credentialCaStoreHostPath: caStore } : {}),
      ...(browserCdp && browserCdp.length > 0 ? { browserCdpHostPath: browserCdp } : {}),
    },
  });

  const identity = new SpawnBrokerIdentity({ helperSocketPath: credentialHelperSocketHostPath });
  const runtime = new DockerContainerRuntime();

  return new SpawnBrokerServer({ runtime, catalog, identity, socketPath });
}

/** Entrypoint: build from process.env and listen. Kept tiny + side-effect-only. */
export async function main(): Promise<void> {
  const server = buildBrokerFromEnv(process.env);
  await server.listen();
  logger.info('spawn-broker listening', { socket: process.env.SEN_SPAWN_BROKER_SOCKET });
}

// Run when invoked directly (the sidecar's entrypoint), not when imported.
if (process.argv[1] && process.argv[1].endsWith('spawn-broker-entrypoint.js')) {
  main().catch((error: unknown) => {
    logger.error('spawn-broker failed to start', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  });
}
