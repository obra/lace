import { posix, resolve as resolveHostPath } from 'node:path';
import type {
  ContainerHandle,
  ContainerLifecycleHooks,
  ContainerSpec,
} from '../../containers/spec';
import type { ExecStreamHandle, ExecStreamOptions } from '../../containers/types';
import { streamToString } from './container-exec-shared';
import { ContainerExecFileSystem } from './container-exec-fs';
import { ContainerExecNetworkClient } from './container-exec-network';
import {
  RuntimeSecretResolutionError,
  type RuntimeSecretResolver,
  redactSecretReference,
  resolveSecretEnv,
} from './secrets';
import type {
  RuntimeFileSystem,
  RuntimeNetworkClient,
  RuntimePath,
  RuntimePathService,
  RuntimeProcessHandle,
  RuntimeProcessOptions,
  RuntimeProcessResult,
  RuntimeProcessRunner,
  RuntimeSecretReference,
  ToolRuntime,
  ToolRuntimeDescriptor,
} from './types';

type ContainerToolRuntimeDescriptor = Extract<ToolRuntimeDescriptor, { type: 'container' }>;

export type ProjectedContainerToolRuntimeDescriptor = Omit<ContainerToolRuntimeDescriptor, 'type'>;

const CONTAINER_PLANE_SELECTOR_FIELDS = ['parentSession', 'childSession', 'jobId'] as const;
const CONTAINER_BROKER_SELECTOR_FIELDS = ['parentSessionId', 'childSessionId'] as const;
const CONTAINER_AUTHORITY_FIELDS = [
  'containerId',
  'ports',
  'restartPolicy',
  'sysctls',
  'capAdd',
  'network',
  'gatewayRoute',
] as const;

interface ProjectedContainerSecretContext {
  runtimeId: string;
  sessionId?: string;
  secretResolver?: RuntimeSecretResolver;
}

interface ProjectedHostMount {
  hostPath: string;
  containerPath: string;
  readonly: boolean;
}

export interface ProjectedContainerManager {
  materialize(spec: ContainerSpec, hooks?: ContainerLifecycleHooks): Promise<ContainerHandle>;
  execStream(specName: string, options: ExecStreamOptions): Promise<ExecStreamHandle>;
}

function containerPathIsInside(root: string, path: string): boolean {
  return root === '/' || path === root || path.startsWith(`${root}/`);
}

function normalizeContainerPath(inputPath: string, cwd: string): string {
  if (posix.isAbsolute(inputPath)) {
    return posix.resolve(inputPath);
  }
  return posix.resolve(cwd, inputPath);
}

function pathRelativeToMount(containerPath: string, runtimePath: string): string {
  if (containerPath === '/') {
    return runtimePath.slice(1);
  }
  return posix.relative(containerPath, runtimePath);
}

function abortErrorFromSignal(signal: AbortSignal | undefined): Error {
  if (signal?.reason instanceof Error) {
    return signal.reason;
  }

  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

function definedEnvironment(
  base: Record<string, string> | undefined,
  override: NodeJS.ProcessEnv | undefined
): Record<string, string> | undefined {
  const environment: Record<string, string> = { ...(base ?? {}) };

  for (const [key, value] of Object.entries(override ?? {})) {
    if (value !== undefined) {
      environment[key] = value;
    }
  }

  return Object.keys(environment).length > 0 ? environment : undefined;
}

function hasDefinedField(value: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field) && value[field] !== undefined;
}

function hasPlaneSelector(value: Record<string, unknown>): boolean {
  const hasBrokerSelector = CONTAINER_BROKER_SELECTOR_FIELDS.some((field) =>
    hasDefinedField(value, field)
  );
  return (
    CONTAINER_PLANE_SELECTOR_FIELDS.some((field) => hasDefinedField(value, field)) ||
    (hasDefinedField(value, 'persona') && !hasBrokerSelector)
  );
}

function hasContainerSelector(value: Record<string, unknown>): boolean {
  return (
    hasDefinedField(value, 'persona') ||
    CONTAINER_PLANE_SELECTOR_FIELDS.some((field) => hasDefinedField(value, field)) ||
    CONTAINER_BROKER_SELECTOR_FIELDS.some((field) => hasDefinedField(value, field))
  );
}

function assertNoMixedSelectorAuthority(
  spec: ProjectedContainerToolRuntimeDescriptor['spec']
): void {
  const record = spec as Record<string, unknown>;
  const hasSelector = hasPlaneSelector(record);
  const hasAuthority = CONTAINER_AUTHORITY_FIELDS.some((field) => hasDefinedField(record, field));
  if (!hasSelector || !hasAuthority) return;

  throw new Error('Container selector fields cannot be combined with docker authority fields');
}

async function containerSpecFromDescriptor(
  descriptor: ProjectedContainerToolRuntimeDescriptor,
  secretContext: ProjectedContainerSecretContext
): Promise<ContainerSpec> {
  assertNoMixedSelectorAuthority(descriptor.spec);
  const secretEntries = Object.entries(descriptor.spec.secretEnv ?? {});
  const resolvedSecrets =
    secretEntries.length === 0
      ? {}
      : await resolveProjectedContainerSecrets(descriptor, secretContext, secretEntries);
  const mounts: ContainerSpec['mounts'] = descriptor.spec.mounts.map((mount) => ({
    source: mount.hostPath,
    target: mount.containerPath,
    readonly: mount.readonly,
  }));
  const spec: ContainerSpec = {
    name: descriptor.spec.name,
    image: descriptor.spec.image,
    workingDirectory: descriptor.spec.workingDirectory,
    mounts,
    env: { ...(descriptor.spec.env ?? {}), ...resolvedSecrets },
  };

  if (descriptor.spec.containerId) {
    spec.containerId = descriptor.spec.containerId;
  }
  const hasPlaneSelectors = hasPlaneSelector(descriptor.spec as Record<string, unknown>);
  if (!hasPlaneSelectors) {
    if (descriptor.spec.ports) {
      spec.ports = descriptor.spec.ports;
    }
    if (descriptor.spec.restartPolicy) {
      spec.restartPolicy = descriptor.spec.restartPolicy;
    }
    if (descriptor.spec.sysctls) {
      spec.sysctls = descriptor.spec.sysctls;
    }
    if (descriptor.spec.capAdd) {
      spec.capAdd = descriptor.spec.capAdd;
    }
    if (descriptor.spec.network) {
      spec.network = descriptor.spec.network;
    }
    if (descriptor.spec.gatewayRoute) {
      spec.gatewayRoute = descriptor.spec.gatewayRoute;
    }
  }
  // Selector fields — carried through to the ContainerSpec so the selected
  // runtime can read its own dialect.
  if (descriptor.spec.persona) {
    spec.persona = descriptor.spec.persona;
  }
  if (descriptor.spec.role) {
    spec.role = descriptor.spec.role;
  }
  if (descriptor.spec.parentSession) {
    spec.parentSession = descriptor.spec.parentSession;
  }
  if (descriptor.spec.childSession) {
    spec.childSession = descriptor.spec.childSession;
  }
  if (descriptor.spec.jobId) {
    spec.jobId = descriptor.spec.jobId;
  }
  if (descriptor.spec.parentSessionId) {
    spec.parentSessionId = descriptor.spec.parentSessionId;
  }
  if (descriptor.spec.childSessionId) {
    spec.childSessionId = descriptor.spec.childSessionId;
  }

  return spec;
}

async function resolveProjectedContainerSecrets(
  descriptor: ProjectedContainerToolRuntimeDescriptor,
  context: ProjectedContainerSecretContext,
  secretEntries: Array<[string, RuntimeSecretReference]>
): Promise<Record<string, string>> {
  const sessionId = context.sessionId ?? 'unknown';
  if (!context.secretResolver) {
    const [, reference] = secretEntries[0]!;
    throw new RuntimeSecretResolutionError(
      `Secret unavailable or unauthorized: ${redactSecretReference(reference)}`,
      {
        reference,
        runtimeId: context.runtimeId,
        sessionId,
      }
    );
  }

  return await resolveSecretEnv({
    secretEnv: descriptor.spec.secretEnv,
    resolver: context.secretResolver,
    runtimeId: context.runtimeId,
    sessionId,
  });
}

class ProjectedContainerPathService implements RuntimePathService {
  private readonly mounts: ProjectedHostMount[];

  constructor(
    private readonly runtimeId: string,
    private readonly cwd: string,
    mounts: ProjectedContainerToolRuntimeDescriptor['spec']['mounts']
  ) {
    this.mounts = normalizeHostMounts(mounts);
  }

  async resolve(inputPath: string): Promise<RuntimePath> {
    const runtimePath = normalizeContainerPath(inputPath, this.cwd);
    const mount = this.mounts.find((candidate) =>
      containerPathIsInside(candidate.containerPath, runtimePath)
    );
    const resolvedPath: RuntimePath = {
      original: inputPath,
      runtimePath,
      displayPath: inputPath,
    };

    if (mount) {
      resolvedPath.hostPath = resolveHostPath(
        mount.hostPath,
        pathRelativeToMount(mount.containerPath, runtimePath)
      );
    }

    return resolvedPath;
  }

  canonicalKey(path: RuntimePath): string {
    return `container:${this.runtimeId}:${posix.resolve(path.runtimePath)}`;
  }
}

function normalizeHostMounts(
  mounts: ProjectedContainerToolRuntimeDescriptor['spec']['mounts']
): ProjectedHostMount[] {
  return mounts
    .map((mount) => ({
      hostPath: resolveHostPath(mount.hostPath),
      containerPath: normalizeContainerPath(mount.containerPath, '/'),
      readonly: mount.readonly,
    }))
    .sort((left, right) => right.containerPath.length - left.containerPath.length);
}

class ProjectedContainerProcessRunner implements RuntimeProcessRunner {
  private materialized?: Promise<void>;

  constructor(
    private readonly descriptor: ProjectedContainerToolRuntimeDescriptor,
    private readonly containerManager: ProjectedContainerManager,
    private readonly secretContext: ProjectedContainerSecretContext
  ) {}

  private optionsFor(command: string[], opts: RuntimeProcessOptions = {}): ExecStreamOptions {
    if (command.length === 0) {
      throw new Error('runtime process command is empty');
    }

    const selectorBacked = hasContainerSelector(this.descriptor.spec as Record<string, unknown>);
    const baseEnvironment = selectorBacked ? this.descriptor.spec.env : undefined;

    return {
      command,
      workingDirectory: normalizeContainerPath(
        opts.cwd ?? this.descriptor.cwd,
        this.descriptor.cwd
      ),
      environment: definedEnvironment(baseEnvironment, opts.env),
      environmentMode: opts.envMode ?? 'inherit',
    };
  }

  private async ensureMaterialized(): Promise<void> {
    if (this.materialized) {
      await this.materialized;
      return;
    }

    const materialized = (async () => {
      const spec = await containerSpecFromDescriptor(this.descriptor, this.secretContext);
      await this.containerManager.materialize(spec);
    })();
    this.materialized = materialized;

    try {
      await materialized;
    } catch (error) {
      if (this.materialized === materialized) {
        this.materialized = undefined;
      }
      throw error;
    }
  }

  async exec(command: string[], opts: RuntimeProcessOptions = {}): Promise<RuntimeProcessResult> {
    const handle = await this.start(command, opts);
    const [stdout, stderr, completion] = await Promise.all([
      streamToString(handle.stdout),
      streamToString(handle.stderr),
      handle.completion,
    ]);
    return {
      exitCode: completion.exitCode ?? 0,
      stdout,
      stderr,
    };
  }

  async start(command: string[], opts: RuntimeProcessOptions = {}): Promise<RuntimeProcessHandle> {
    if (opts.signal?.aborted) {
      opts.signal.throwIfAborted();
    }

    await this.ensureMaterialized();

    if (opts.signal?.aborted) {
      opts.signal.throwIfAborted();
    }

    const containerHandle = await this.containerManager.execStream(
      this.descriptor.spec.name,
      this.optionsFor(command, opts)
    );

    if (opts.signal?.aborted) {
      containerHandle.kill();
      opts.signal.throwIfAborted();
    }

    let aborted = false;
    const abortHandler = () => {
      aborted = true;
      containerHandle.kill();
    };
    opts.signal?.addEventListener('abort', abortHandler, { once: true });

    const completion = containerHandle
      .wait()
      .then((result) => {
        if (aborted) {
          throw abortErrorFromSignal(opts.signal);
        }
        return {
          exitCode: result.exitCode,
          signal: undefined,
        };
      })
      .finally(() => opts.signal?.removeEventListener('abort', abortHandler));

    return {
      stdin: containerHandle.stdin,
      stdout: containerHandle.stdout,
      stderr: containerHandle.stderr,
      kill: (signal?: NodeJS.Signals) => containerHandle.kill(signal),
      completion,
    };
  }
}

export class ProjectedContainerToolRuntime implements ToolRuntime {
  readonly kind = 'container' as const;
  readonly label = 'Projected Container';
  readonly paths: RuntimePathService;
  readonly fs: RuntimeFileSystem;
  readonly process: RuntimeProcessRunner;
  readonly network: RuntimeNetworkClient;

  constructor(input: {
    id: string;
    containerManager: ProjectedContainerManager;
    descriptor: ProjectedContainerToolRuntimeDescriptor;
    sessionId?: string;
    secretResolver?: RuntimeSecretResolver;
  }) {
    this.id = input.id;
    this.cwd = normalizeContainerPath(input.descriptor.cwd, input.descriptor.spec.workingDirectory);
    this.paths = new ProjectedContainerPathService(
      input.id,
      this.cwd,
      input.descriptor.spec.mounts
    );
    this.process = new ProjectedContainerProcessRunner(
      { ...input.descriptor, cwd: this.cwd },
      input.containerManager,
      {
        runtimeId: input.id,
        sessionId: input.sessionId,
        secretResolver: input.secretResolver,
      }
    );
    this.fs = new ContainerExecFileSystem(this.process);
    this.network = new ContainerExecNetworkClient(this.process);
  }

  readonly id: string;
  readonly cwd: string;
}
