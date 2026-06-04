// ABOUTME: Broker-side reproduction of sen-core's buildContainerMounts host-path layout
// ABOUTME: The spawn broker runs in a different container than sen-core, so it resolves persona mount names to HOST paths itself

import path from 'node:path';
import type { MountRegistryEntry } from '@lace/agent/server-types';

/**
 * Boot-time inputs the broker needs to resolve persona mount names to host
 * bind-mount sources. All are deployment-static; the caller (adversarial
 * main-sen) never supplies any of them — they come from the broker's own boot
 * environment.
 */
export interface BrokerMountEnv {
  // SEN_INSTANCE_HOST_PATH — host path to the instance root (e.g. /mnt/data/ada-sen).
  instanceHostPath: string;
  // SEN_CREDENTIAL_HELPER_SOCKET_HOST_PATH — host path to the subagent credential
  // socket. Its DIRECTORY becomes the `sen-cred` mount source (A3b narrows this
  // to state/sockets/ once the deploy relocates the socket). When absent the
  // credential mounts are omitted entirely (non-broker deployments).
  credentialHelperSocketHostPath?: string;
  // SEN_CREDENTIAL_HELPER_CA_STORE_HOST_PATH — host path to the CA-cert dir.
  credentialCaStoreHostPath?: string;
  // SEN_BROWSER_CDP_HOST_PATH — host path to the shared browser-CDP socket dir.
  browserCdpHostPath?: string;
}

/**
 * Build the embedder mount registry (name → {hostPath, containerPath, readonly}) the broker
 * feeds to buildPersonaContainerSpec. Mirrors sen-core `buildContainerMounts`
 * (src/instance/paths.ts layout + src/main.ts:1141-1215) — KEEP IN SYNC with
 * that layout. The broker computes host paths directly from the instance host
 * root rather than translating sen-core-internal paths, because it runs in its
 * own container and only ever needs the host side for `docker create -v`.
 *
 * The credential mounts (sen-cred/sen-ca/sen-browser-cdp) are included whenever
 * a credential socket host path is configured — i.e. for the credential-broker
 * deployment. Mount presence is a request channel, not a grant (the arbiter +
 * policy gate issuance), so an always-present socket/cert is not an escalation.
 */
export function buildBrokerContainerMounts(
  env: BrokerMountEnv
): Record<string, MountRegistryEntry> {
  const root = env.instanceHostPath;
  const at = (...segments: string[]): string => path.join(root, ...segments);

  const mounts: Record<string, MountRegistryEntry> = {
    scratch: { hostPath: at('state', 'scratch'), containerPath: '/work', readonly: false },
    knowledge: { hostPath: at('user', 'knowledge'), containerPath: '/knowledge', readonly: true },
    identity: { hostPath: at('user', 'identity'), containerPath: '/sen/identity', readonly: true },
    home: { hostPath: at('user', 'home'), containerPath: '/home/sen', readonly: false },
  };

  const socketHostPath = env.credentialHelperSocketHostPath;
  if (socketHostPath && socketHostPath.length > 0) {
    // A3b (C3): the `sen-cred` mount source is the socket's DIRECTORY, so the
    // persona sees only the subagent socket — not a broader tree. The deploy
    // places the subagent socket under state/sockets/ (a dir that holds only that
    // socket), so dirname() narrows to exactly it. Before A3b the socket lived in
    // run/ alongside sen-browser-cdp/, which dirname() over-exposed; the relocation
    // is what fixes that. No logic change here — the broker tracks wherever the
    // socket lives; correctness depends on the deploy placing it in a narrow dir.
    mounts['sen-cred'] = {
      hostPath: path.dirname(socketHostPath),
      containerPath: '/run',
      readonly: true,
    };

    mounts['sen-ca'] = {
      hostPath:
        env.credentialCaStoreHostPath && env.credentialCaStoreHostPath.length > 0
          ? env.credentialCaStoreHostPath
          : at('state', 'credential-helper'),
      containerPath: '/etc/sen-credential-proxy-ca',
      readonly: true,
    };

    // Writable: the in-container relay creates the per-job CDP socket here.
    mounts['sen-browser-cdp'] = {
      hostPath:
        env.browserCdpHostPath && env.browserCdpHostPath.length > 0
          ? env.browserCdpHostPath
          : at('state', 'browser-cdp'),
      containerPath: '/sen-browser-cdp',
      readonly: false,
    };
  }

  return mounts;
}
