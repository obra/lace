// ABOUTME: Generic container spec types — name, image, mounts, env, ports
// ABOUTME: Consumed by ContainerManager; built by domain-specific spec factories

import type { ContainerMount, ContainerState, PortMapping } from './types';

export type { PortMapping };

// PRI-2002: the credential helper and the quarantined browser-driver share one
// host dir (the `sen-browser-cdp` named mount, container path `/sen-browser-cdp`);
// each container gets a uniquely-named socket on it. A TOP-LEVEL path (NOT under
// `/run`, which is itself the `sen-cred` mount) — a nested mount target inside
// another mount's destination fails at container init ("read-only file system").
// Single source of truth for that path so the SEN_BROWSER_CDP_SOCKET env injected
// at spec-build time and the lifecycle browserCdpSocketPath cannot drift.
const BROWSER_CDP_SOCKET_DIR = '/sen-browser-cdp';

export function browserCdpSocketPath(containerName: string): string {
  return `${BROWSER_CDP_SOCKET_DIR}/${containerName}.sock`;
}

export interface ContainerSpec {
  name: string;
  image: string;
  workingDirectory: string;
  mounts: ContainerMount[];
  env: Record<string, string>;
  // Docker object labels forwarded to ContainerConfig.labels (→ `--label`).
  // PRI-2012: the spawn broker stamps `sen.broker.*` identity labels on the spec
  // so it can rebuild + re-validate its ownership record from `docker inspect`
  // after a broker restart.
  labels?: Record<string, string>;

  // Shared selector field. It is a selector only, never an authority source:
  // the privileged runtime validates it and rebuilds the full container spec.
  persona?: string;

  // Spawn-broker selector fields. The SpawnBrokerContainerRuntime client uses
  // these to format its `{persona,parentSessionId,childSessionId,jobId}` wire
  // request. Docker/apple runtimes ignore them.
  parentSessionId?: string;
  childSessionId?: string;

  // PlaneRuntime selector fields. Its create() emits the closed
  // `spawn <persona> <parent> <child> <jobId>` command. Docker/apple runtimes
  // ignore them.
  parentSession?: string;
  childSession?: string;
  jobId?: string;
  ports?: PortMapping[];
  // Verbatim container id used by the daemon. When set, ContainerManager
  // bypasses the `lace-` prefix and uses this id directly. Used by the box
  // runtime so the daemon-side container id is stable across agent restarts
  // and avoids the startup reaper's `lace-` scan.
  containerId?: string;
  // Forwarded to ContainerConfig.restartPolicy. Used by boxes so the daemon
  // auto-restarts them after host reboot.
  restartPolicy?: 'unless-stopped';
  // Linux kernel sysctls forwarded to `docker create --sysctl key=value`.
  // Personas declare these in `runtime.sysctls`; the browser persona may need
  // `net.ipv6.conf.lo.disable_ipv6=0` for the chrome launcher's port-availability check.
  sysctls?: Record<string, string>;

  // Linux capabilities forwarded to `docker create --cap-add <cap>` per entry.
  // Used by direct docker container specs that need extra kernel authority.
  capAdd?: string[];

  // Docker network name forwarded to `docker create --network <name>`.
  network?: string;

  // IPv4 address of the egress gateway broker.
  gatewayRoute?: string;

  // PRI-2002: when true, this is a quarantined browser-driver spec. The
  // SEN_BROWSER_CDP_SOCKET env is injected at spec-build time (the in-container
  // relay listens there); the spawn broker re-registers the persona's identity
  // with the matching browserCdpSocketPath after the container materializes so
  // the credential helper can reach the persona's Chrome CDP over the shared
  // sen-browser-cdp unix socket.
  browserCdpSocket?: boolean;

  // Mount target namespaces owned by Lace. When adopting a daemon-side
  // persistent container, ContainerManager rejects stale extra mounts under
  // these prefixes so an old container cannot expose paths the new spec no
  // longer advertises.
  managedMountTargetPrefixes?: string[];
}

export interface ContainerHandle {
  spec: ContainerSpec;
  containerId: string;
  state: ContainerState;
}

/**
 * Lifecycle hooks for ContainerManager.materialize / destroy.
 *
 * The two hooks are intentionally asymmetric:
 *
 * - `beforeCreate` fires ONLY when `materialize` actually creates a new
 *   container. Idempotent re-materialize calls (existing container found,
 *   running or stopped) SKIP this hook — it is for one-time setup that
 *   accompanies container creation.
 *
 * - `afterDestroy` fires UNCONDITIONALLY when `destroy()` is invoked, even if
 *   no container existed in the runtime. Callers use this for caller-owned
 *   cleanup (tempdir removal, marker files) that should run whenever the
 *   caller declares the container gone — not contingent on prior runtime
 *   state.
 */
export interface ContainerLifecycleHooks {
  beforeCreate?: () => Promise<void>;
  afterDestroy?: () => Promise<void>;
}
