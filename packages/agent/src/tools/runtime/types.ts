import type { Readable, Writable } from 'node:stream';

export type RuntimeBindingSchemaVersion = 1;
export type RuntimeSecretNamespace = 'session' | 'project' | 'host-service';
export type ToolRuntimeKind = 'local' | 'workspace' | 'container';
export type AgentPlacement = 'host' | 'container';

export interface RuntimeSecretReference {
  namespace: RuntimeSecretNamespace;
  name: string;
}

export interface RuntimeBindingIdentity {
  runtimeId: string;
}

export interface RuntimeMountDescriptor {
  hostPath: string;
  containerPath: string;
  readonly: boolean;
}

export interface RuntimePortDescriptor {
  host: number;
  container: number;
}

export interface RuntimeHelperDescriptor {
  mode: 'copy' | 'mount' | 'image';
  hostPath?: string;
  containerPath: string;
  command: string[];
}

export type ToolRuntimeDescriptor =
  | { type: 'local'; cwd: string }
  | {
      type: 'workspace';
      projectRoot: string;
      workspaceRoot: string;
      cwd: string;
    }
  | {
      type: 'container';
      spec: {
        name: string;
        containerId?: string;
        requestedImage: string;
        resolvedImageDigest: string;
        imagePlatform: string;
        workingDirectory: string;
        mounts: RuntimeMountDescriptor[];
        env?: Record<string, string>;
        secretEnv?: Record<string, RuntimeSecretReference>;
        ports?: RuntimePortDescriptor[];
        restartPolicy?: 'unless-stopped';
      };
      cwd: string;
      helper?: RuntimeHelperDescriptor;
    };

export interface RuntimeExecutionBinding {
  schemaVersion: RuntimeBindingSchemaVersion;
  identity: RuntimeBindingIdentity;
  toolRuntime: ToolRuntimeDescriptor;
  agentPlacement: AgentPlacement;
}

export interface RuntimePath {
  original: string;
  runtimePath: string;
  hostPath?: string;
  displayPath: string;
}

export interface RuntimePathService {
  resolve(inputPath: string): Promise<RuntimePath>;
  canonicalKey(path: RuntimePath): string;
}

export interface RuntimeFileSystem {
  stat(path: RuntimePath): Promise<{ type: 'file' | 'directory'; size: number; mtime: Date }>;
  readTextFile(path: RuntimePath): Promise<string>;
  writeTextFile(path: RuntimePath, content: string): Promise<void>;
  mkdir(path: RuntimePath, opts?: { recursive?: boolean }): Promise<void>;
  readdir(path: RuntimePath): Promise<Array<{ name: string; type: 'file' | 'directory' }>>;
}

export interface RuntimeProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export interface RuntimeProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RuntimeProcessHandle {
  pid?: number;
  stdin?: Writable;
  stdout?: Readable;
  stderr?: Readable;
  kill(signal?: NodeJS.Signals): void;
  completion: Promise<{ exitCode: number | null; signal?: NodeJS.Signals }>;
}

export interface RuntimeProcessRunner {
  exec(command: string[], opts?: RuntimeProcessOptions): Promise<RuntimeProcessResult>;
  start(command: string[], opts?: RuntimeProcessOptions): Promise<RuntimeProcessHandle>;
}

export interface RuntimeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface RuntimeFetchResult {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

export interface RuntimeNetworkClient {
  fetch(url: string, opts?: RuntimeFetchOptions): Promise<RuntimeFetchResult>;
}

export interface ToolRuntime {
  readonly id: string;
  readonly kind: ToolRuntimeKind;
  readonly cwd: string;
  readonly label: string;
  readonly paths: RuntimePathService;
  readonly fs: RuntimeFileSystem;
  readonly process: RuntimeProcessRunner;
  readonly network: RuntimeNetworkClient;
}
