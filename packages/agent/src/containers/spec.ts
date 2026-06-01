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
  ports?: PortMapping[];
  // Verbatim container id used by the daemon. When set, ContainerManager
  // bypasses the `lace-` prefix and uses this id directly. Used by the box
  // runtime so the daemon-side container id (e.g. `sen-box-shell`) is stable
  // across agent restarts and avoids the startup reaper's `lace-` scan.
  containerId?: string;
  // Forwarded to ContainerConfig.restartPolicy. Used by boxes so the daemon
  // auto-restarts them after host reboot.
  restartPolicy?: 'unless-stopped';
  // Linux kernel sysctls forwarded to `docker create --sysctl key=value`.
  // Personas declare these in `runtime.sysctls`; PRI-1790 added support so
  // sen-browser can enable `net.ipv6.conf.lo.disable_ipv6=0` for the chrome
  // launcher's port-availability check.
  sysctls?: Record<string, string>;

  // Linux capabilities forwarded to `docker create --cap-add <cap>` per entry.
  // PRI-1919: persona containers need NET_ADMIN to replace the default route
  // via the transparent egress gateway.
  capAdd?: string[];

  // Docker network name forwarded to `docker create --network <name>`.
  // PRI-1919: persona containers join the quarantine network.
  network?: string;

  // IPv4 address of the egress gateway. When set, a privileged one-shot sidecar
  // sets the persona's default route after `docker start`. PRI-1919.
  gatewayRoute?: string;

  // PRI-2002: when true, this is a quarantined browser-driver spec. The
  // SEN_BROWSER_CDP_SOCKET env is injected at spec-build time (the in-container
  // relay listens there); ContainerManager.notifyNetworkAttached emits the
  // matching browserCdpSocketPath so the credential helper can reach the
  // persona's Chrome CDP over the shared sen-browser-cdp unix socket.
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
