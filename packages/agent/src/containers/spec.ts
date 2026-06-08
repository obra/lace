// ABOUTME: Generic container spec types — name, image, mounts, env, ports
// ABOUTME: Consumed by ContainerManager; built by domain-specific spec factories

import type { ContainerMount, ContainerState, PortMapping } from './types';

export type { PortMapping };

export interface ContainerSpec {
  name: string;
  image: string;
  workingDirectory: string;
  mounts: ContainerMount[];
  env: Record<string, string>;
  // Docker object labels forwarded to ContainerConfig.labels (→ `--label`).
  // Docker object labels stamped on the spec at create.
  labels?: Record<string, string>;

  // Shared selector field. It is a selector only, never an authority source:
  // the privileged runtime validates it and rebuilds the full container spec.
  persona?: string;

  // The spawned persona's role name. Carried alongside `persona` (the
  // environment) so PlaneRuntime can forward it for credential-helper authz.
  role?: string;

  // Privileged-runtime selector fields, carried alongside `persona`.
  // Docker/apple runtimes ignore them.
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
