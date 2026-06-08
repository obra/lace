import type { Readable, Writable } from 'node:stream';

export type RuntimeBindingSchemaVersion = 1;
export type RuntimeSecretNamespace = 'session' | 'project' | 'host-service';
export type ToolRuntimeKind = 'host' | 'boundedHost' | 'container';

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
  | { type: 'host'; cwd: string }
  | {
      type: 'boundedHost';
      root: string;
      cwd: string;
    }
  | {
      type: 'container';
      spec: {
        name: string;
        containerId?: string;
        // Persona-declared image reference. Passed verbatim to docker create —
        // may be a tag, a RepoDigest, or anything else docker accepts.
        image: string;
        workingDirectory: string;
        mounts: RuntimeMountDescriptor[];
        env?: Record<string, string>;
        secretEnv?: Record<string, RuntimeSecretReference>;
        ports?: RuntimePortDescriptor[];
        restartPolicy?: 'unless-stopped';
        // Generic projected-container docker authority fields. Persona
        // projected specs built by lace intentionally omit these; the plane
        // rebuilds persona docker authority from selectors/persona config.
        sysctls?: Record<string, string>;
        // Generic projected-container docker authority fields. Persona
        // projected specs built by lace intentionally omit these.
        capAdd?: string[];
        // Generic projected-container docker authority fields. Persona
        // projected specs built by lace intentionally omit these.
        network?: string;
        // IPv4 address of the egress gateway broker.
        gatewayRoute?: string;
        // Shared selector field. It is a selector only, never an authority
        // source: the selected privileged runtime re-validates it.
        persona?: string;
        // The spawned persona's role name, carried alongside `persona` (the
        // environment) for the credential helper's egress source-IP → role authz.
        role?: string;
        // Spawn-broker selector fields. Carried verbatim across the
        // ContainerSpec -> RuntimeSpec -> ContainerSpec round-trip.
        parentSessionId?: string;
        childSessionId?: string;
        // PlaneRuntime selector fields. create() emits
        // `spawn <persona> <parent> <child> <jobId>`.
        parentSession?: string;
        childSession?: string;
        jobId?: string;
      };
      cwd: string;
      helper?: RuntimeHelperDescriptor;
    };

export interface RuntimeExecutionBinding {
  schemaVersion: RuntimeBindingSchemaVersion;
  identity: RuntimeBindingIdentity;
  toolRuntime: ToolRuntimeDescriptor;
  // Present on persona container bindings; absent on host/bounded-host bindings.
  // Lets post-exit handlers (Chunk E) branch on lifecycle without inspecting
  // toolRuntime internals.
  containerSharing?: 'per_invocation' | 'persistent';
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
  envMode?: 'inherit' | 'replace';
  detached?: boolean;
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
  redirect?: 'follow' | 'manual';
  maxBytes?: number;
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

export class RuntimeFetchSizeLimitError extends Error {
  readonly name = 'RuntimeFetchSizeLimitError';

  constructor(
    public readonly limit: number,
    public readonly bytesRead: number
  ) {
    super(`Response size (${bytesRead} bytes) exceeds maximum allowed size (${limit} bytes)`);
  }
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
