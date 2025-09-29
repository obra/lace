// ABOUTME: Container system type definitions and interfaces
// ABOUTME: Defines container lifecycle, configuration, and runtime contracts

export interface ContainerConfig {
  // Container identification (optional - will be generated if not provided)
  id?: string;
  name?: string;

  // Filesystem configuration
  workingDirectory: string;
  mounts: ContainerMount[];

  // Process configuration
  command?: string[];
  environment?: Record<string, string>;

  // Resource limits (optional for now)
  memory?: number; // bytes
  cpuShares?: number;
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

export interface ExecOptions {
  command: string[];
  workingDirectory?: string;
  environment?: Record<string, string>;
  stdin?: string;
  timeout?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ContainerRuntime {
  // Lifecycle management
  create(config: ContainerConfig): string | Promise<string>; // Returns container ID
  start(containerId: string): Promise<void>;
  stop(containerId: string, timeout?: number): Promise<void>;
  remove(containerId: string): Promise<void>;

  // Execution
  exec(containerId: string, options: ExecOptions): Promise<ExecResult>;

  // Information
  inspect(containerId: string): ContainerInfo | Promise<ContainerInfo>;
  list(): ContainerInfo[] | Promise<ContainerInfo[]>;

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
