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
  ports?: PortMapping[];
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
