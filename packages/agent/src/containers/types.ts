// ABOUTME: Container system type definitions and interfaces
// ABOUTME: Defines container lifecycle, configuration, and runtime contracts

import type { Readable, Writable } from 'node:stream';

export interface PortMapping {
  host: number;
  container: number;
}

export interface ContainerConfig {
  // Container identification (optional - will be generated if not provided)
  id?: string;
  name?: string;

  // Image to run. Required: every container must know its image at create time.
  image: string;

  // Filesystem configuration
  workingDirectory: string;
  mounts: ContainerMount[];

  // Process configuration
  command?: string[];
  environment?: Record<string, string>;

  // Host->container port publishing. Optional; runtimes that lack a port concept
  // may ignore (see AppleContainerRuntime).
  ports?: PortMapping[];

  // Resource limits (optional for now)
  memory?: number; // bytes
  cpuShares?: number;

  // Docker --restart policy. Only 'unless-stopped' is supported in v1; used by
  // persistent container runtimes so the daemon resurrects them after host reboot.
  // Absent ⇒ no restart flag emitted (default no-restart behavior).
  restartPolicy?: 'unless-stopped';

  // Linux kernel sysctls forwarded to `docker create --sysctl key=value`.
  // Absent or empty ⇒ no --sysctl flag emitted. PRI-1790: sen-browser needs
  // `net.ipv6.conf.lo.disable_ipv6=0` so chrome's port-availability check
  // can bind to `::1`.
  sysctls?: Record<string, string>;

  // Linux capabilities forwarded to `docker create --cap-add <cap>` per entry.
  // Absent or empty ⇒ no --cap-add flags emitted. PRI-1919: persona containers
  // need NET_ADMIN to replace the default route via the transparent egress gateway.
  capAdd?: string[];

  // Docker network name forwarded to `docker create --network <name>`.
  // Absent ⇒ no --network flag emitted (docker default). PRI-1919: persona
  // containers join the quarantine network for transparent egress.
  network?: string;

  // IPv4 address of the egress gateway. When set, a privileged one-shot
  // sidecar container is launched into the persona's network namespace after
  // `docker start` to replace the default route:
  //   ip route replace default via <gatewayRoute>
  // The persona container itself does NOT need NET_ADMIN — the sidecar holds
  // the privilege and exits immediately. PRI-1919 transparent egress gateway.
  gatewayRoute?: string;

  // Docker object labels stamped at create (`docker create --label key=value`).
  // Absent or empty ⇒ no --label flags. PRI-2012: the spawn broker stamps
  // `sen.broker.*` identity labels so it can rebuild its ownership record from
  // `docker inspect` after a broker restart (survives without persisted state).
  labels?: Record<string, string>;

  // PRI-2012 spawn-broker SELECTOR fields (copied from ContainerSpec by
  // materializeOnce). The SpawnBrokerContainerRuntime client reads these at
  // create() to format the wire spawn request. SELECTOR ONLY — never an authority
  // source (the broker rebuilds the full config from its own catalog using only
  // persona). The docker/apple runtimes ignore them.
  persona?: string;
  parentSessionId?: string;
  childSessionId?: string;
}

export interface ContainerMount {
  source: string; // Host path
  target: string; // Container path
  readonly?: boolean;
}

export interface ContainerInfo {
  id: string;
  state: ContainerState;
  mounts?: ContainerMount[];
  pid?: number;
  startedAt?: Date;
  stoppedAt?: Date;
  exitCode?: number;
  // Docker object labels read back from `docker inspect` (.Config.Labels).
  // PRI-2012: the spawn broker reads its `sen.broker.*` identity labels here to
  // reconstruct + re-validate ownership when adopting a container after restart.
  labels?: Record<string, string>;
}

export type ContainerState = 'created' | 'running' | 'stopped' | 'failed';
export type ExecEnvironmentMode = 'inherit' | 'replace';

export interface ExecOptions {
  command: string[];
  workingDirectory?: string;
  environment?: Record<string, string>;
  environmentMode?: ExecEnvironmentMode;
  stdin?: string;
  timeout?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ExecStreamOptions {
  command: string[];
  workingDirectory?: string;
  environment?: Record<string, string>;
  environmentMode?: ExecEnvironmentMode;
}

export interface ExecStreamHandle {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  wait(): Promise<{ exitCode: number }>;
  kill(signal?: NodeJS.Signals): void;
}

export interface ContainerRuntime {
  // Lifecycle management
  create(config: ContainerConfig): string | Promise<string>; // Returns container ID
  start(containerId: string): Promise<void>;
  stop(containerId: string, timeout?: number): Promise<void>;
  remove(containerId: string): Promise<void>;

  // Execution
  exec(containerId: string, options: ExecOptions): Promise<ExecResult>;
  execStream(containerId: string, options: ExecStreamOptions): Promise<ExecStreamHandle>;

  // Information
  inspect(containerId: string): ContainerInfo | Promise<ContainerInfo>;
  list(): ContainerInfo[] | Promise<ContainerInfo[]>;

  /**
   * Live-inspect against the daemon (not the in-process cache). Returns null
   * when the container does not exist on the daemon side. Used by
   * ContainerManager to adopt boxes that survived a parent restart.
   *
   * Distinct from sync `inspect()`: the latter reads only the in-memory cache.
   * Subclasses may fall back to the cached inspect when the daemon-side
   * concept does not apply (e.g. AppleContainerRuntime).
   */
  daemonInspect(containerId: string): Promise<ContainerInfo | null>;

  /**
   * Register an existing daemon-side container into the runtime's in-process
   * caches so subsequent start/exec calls work. Idempotent and no-op when the
   * runtime has no caches to populate.
   */
  adopt(config: ContainerConfig, state: ContainerState): Promise<void>;

  /**
   * Resolve the container's IPv4 address on the named docker network, or
   * undefined when unavailable (network absent, container gone, daemon error,
   * or the runtime has no network concept — e.g. AppleContainerRuntime).
   * Optional: only runtimes backing the PRI-1919 transparent egress gateway
   * implement it; ContainerManager treats its absence as "no source IP".
   */
  inspectNetworkIp?(containerId: string, networkName: string): Promise<string | undefined>;

  // Path translation
  translateToContainer(hostPath: string, containerId: string): string;
  translateToHost(containerPath: string, containerId: string): string;
}

export class ContainerError extends Error {
  constructor(
    message: string,
    public readonly containerId?: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ContainerError';
  }
}

export class ContainerNotFoundError extends ContainerError {
  constructor(containerId: string) {
    super(`Container not found: ${containerId}`, containerId);
    this.name = 'ContainerNotFoundError';
  }
}

export class ContainerExecError extends ContainerError {
  constructor(
    containerId: string,
    public readonly exitCode: number,
    public readonly stderr: string
  ) {
    super(`Container exec failed with exit code ${exitCode}`, containerId);
    this.name = 'ContainerExecError';
  }
}
