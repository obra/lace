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
}

export interface ContainerMount {
  source: string; // Host path
  target: string; // Container path
  readonly?: boolean;
}

export interface ContainerInfo {
  id: string;
  state: ContainerState;
  pid?: number;
  startedAt?: Date;
  stoppedAt?: Date;
  exitCode?: number;
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
