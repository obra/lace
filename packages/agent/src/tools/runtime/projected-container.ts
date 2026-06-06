import {
  cp,
  lstat,
  mkdtemp,
  mkdir as mkdirHost,
  readdir as readdirHost,
  readFile,
  realpath,
  stat as statHost,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve as resolveHostPath,
  sep,
} from 'node:path';
import type { Readable, Writable } from 'node:stream';
import type {
  ContainerHandle,
  ContainerLifecycleHooks,
  ContainerSpec,
} from '../../containers/spec';
import type { ExecStreamHandle, ExecStreamOptions } from '../../containers/types';
import { decodeHelperResponse, encodeHelperRequest, type HelperRequest } from './helper-protocol';
import {
  RuntimeSecretResolutionError,
  type RuntimeSecretResolver,
  redactSecretReference,
  resolveSecretEnv,
} from './secrets';
import type {
  RuntimeFileSystem,
  RuntimeFetchOptions,
  RuntimeFetchResult,
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

interface NodeError extends Error {
  code?: string;
}

interface ProjectedHostMount {
  hostPath: string;
  containerPath: string;
  readonly: boolean;
  realHostPath?: Promise<string>;
}

export interface ProjectedContainerManager {
  materialize(spec: ContainerSpec, hooks?: ContainerLifecycleHooks): Promise<ContainerHandle>;
  execStream(specName: string, options: ExecStreamOptions): Promise<ExecStreamHandle>;
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as NodeError).code === 'ENOENT';
}

function containerPathIsInside(root: string, path: string): boolean {
  return root === '/' || path === root || path.startsWith(`${root}/`);
}

function hostPathIsInside(root: string, path: string): boolean {
  const relativePath = relative(root, path);
  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath))
  );
}

function requireHostPathInside(root: string, path: string, message: string): void {
  if (!hostPathIsInside(root, path)) {
    throw new Error(message);
  }
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

function streamToString(stream: Readable | undefined): Promise<string> {
  if (!stream) return Promise.resolve('');

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function writeStreamAndClose(stream: Writable, content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.once('error', reject);
    stream.end(content, 'utf8', resolve);
  });
}

function abortErrorFromSignal(signal: AbortSignal | undefined): Error {
  if (signal?.reason instanceof Error) {
    return signal.reason;
  }

  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

function firstResponseLine(output: string): string {
  const line = output.split(/\r?\n/, 1)[0];
  if (!line) {
    throw new Error('Projected runtime helper returned no response');
  }
  return line;
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
): Promise<{ spec: ContainerSpec; hooks?: ContainerLifecycleHooks }> {
  assertNoMixedSelectorAuthority(descriptor.spec);
  const secretEntries = Object.entries(descriptor.spec.secretEnv ?? {});
  const resolvedSecrets =
    secretEntries.length === 0
      ? {}
      : await resolveProjectedContainerSecrets(descriptor, secretContext, secretEntries);
  const helper = await helperMaterialization(descriptor.helper);
  const mounts: ContainerSpec['mounts'] = descriptor.spec.mounts.map((mount) => ({
    source: mount.hostPath,
    target: mount.containerPath,
    readonly: mount.readonly,
  }));
  if (helper.mount) {
    mounts.push(helper.mount);
  }
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

  return helper.hooks ? { spec, hooks: helper.hooks } : { spec };
}

async function helperMaterialization(
  helper: ProjectedContainerToolRuntimeDescriptor['helper']
): Promise<{ mount?: ContainerSpec['mounts'][number]; hooks?: ContainerLifecycleHooks }> {
  if (!helper || helper.mode === 'image') {
    return {};
  }

  const target = normalizeContainerPath(helper.containerPath, '/');
  const hostPath = requireHelperHostPath(helper);

  if (helper.mode === 'mount') {
    return {
      mount: {
        source: hostPath,
        target,
        readonly: true,
      },
    };
  }

  const copyRoot = await mkdtemp(join(tmpdir(), 'lace-runtime-helper-'));
  const copyPath = join(copyRoot, basename(hostPath) || 'helper');
  return {
    mount: {
      source: copyPath,
      target,
      readonly: true,
    },
    hooks: {
      beforeCreate: async () => {
        await cp(hostPath, copyPath, { recursive: true, force: true });
      },
    },
  };
}

function requireHelperHostPath(
  helper: NonNullable<ProjectedContainerToolRuntimeDescriptor['helper']>
): string {
  if (!helper.hostPath) {
    throw new Error(`Projected runtime helper ${helper.mode} mode requires hostPath`);
  }
  return resolveHostPath(helper.hostPath);
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

function helperUnavailable(): never {
  throw new Error('Projected runtime helper unavailable');
}

function ensureRecord(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid helper ${context} response`);
  }
  return value as Record<string, unknown>;
}

function parseFileType(value: unknown, context: string): 'file' | 'directory' {
  if (value === 'file' || value === 'directory') return value;
  throw new Error(`Invalid helper ${context} response`);
}

function parseStringRecord(value: unknown, context: string): Record<string, string> {
  const record = ensureRecord(value, context);
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => {
      if (typeof entry !== 'string') {
        throw new Error(`Invalid helper ${context} response`);
      }
      return [key, entry];
    })
  );
}

function parseStatValue(value: unknown): { type: 'file' | 'directory'; size: number; mtime: Date } {
  const record = ensureRecord(value, 'stat');
  if (typeof record.size !== 'number') {
    throw new Error('Invalid helper stat response');
  }
  const mtime = new Date(record.mtime as string | number | Date);
  if (Number.isNaN(mtime.getTime())) {
    throw new Error('Invalid helper stat response');
  }
  return {
    type: parseFileType(record.type, 'stat'),
    size: record.size,
    mtime,
  };
}

function parseReaddirValue(value: unknown): Array<{ name: string; type: 'file' | 'directory' }> {
  if (!Array.isArray(value)) {
    throw new Error('Invalid helper readdir response');
  }
  return value.map((entry) => {
    const record = ensureRecord(entry, 'readdir');
    if (typeof record.name !== 'string') {
      throw new Error('Invalid helper readdir response');
    }
    return {
      name: record.name,
      type: parseFileType(record.type, 'readdir'),
    };
  });
}

function parseFetchBody(value: unknown): Uint8Array {
  if (typeof value === 'string') {
    return new Uint8Array(Buffer.from(value, 'base64'));
  }
  throw new Error('Invalid helper fetch response');
}

function parseFetchValue(value: unknown): RuntimeFetchResult {
  const record = ensureRecord(value, 'fetch');
  if (typeof record.status !== 'number') {
    throw new Error('Invalid helper fetch response');
  }
  return {
    status: record.status,
    headers: parseStringRecord(record.headers ?? {}, 'fetch'),
    body: parseFetchBody(record.body ?? ''),
  };
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

class ProjectedContainerFileSystem implements RuntimeFileSystem {
  constructor(
    private readonly helper: ProjectedContainerRuntimeHelper,
    private readonly hostAccess: ProjectedContainerHostAccess
  ) {}

  async stat(
    path: RuntimePath
  ): Promise<{ type: 'file' | 'directory'; size: number; mtime: Date }> {
    if (path.hostPath) {
      const hostPath = await this.hostAccess.requireExistingPath(path);
      const result = await statHost(hostPath);
      return {
        type: result.isDirectory() ? 'directory' : 'file',
        size: result.size,
        mtime: result.mtime,
      };
    }

    return parseStatValue(await this.helper.request({ op: 'stat', path: path.runtimePath }));
  }

  async readTextFile(path: RuntimePath): Promise<string> {
    if (path.hostPath) {
      return await readFile(await this.hostAccess.requireExistingPath(path), 'utf8');
    }

    const value = await this.helper.request({ op: 'readTextFile', path: path.runtimePath });
    if (typeof value !== 'string') {
      throw new Error('Invalid helper readTextFile response');
    }
    return value;
  }

  async writeTextFile(path: RuntimePath, content: string): Promise<void> {
    if (path.hostPath) {
      await writeFile(await this.hostAccess.requireWritablePath(path), content, 'utf8');
      return;
    }

    await this.helper.request({ op: 'writeTextFile', path: path.runtimePath, content });
  }

  async mkdir(path: RuntimePath, opts?: { recursive?: boolean }): Promise<void> {
    if (path.hostPath) {
      await mkdirHost(await this.hostAccess.requireCreatableDirectory(path), {
        recursive: opts?.recursive,
      });
      return;
    }

    await this.helper.request({ op: 'mkdir', path: path.runtimePath, recursive: opts?.recursive });
  }

  async readdir(path: RuntimePath): Promise<Array<{ name: string; type: 'file' | 'directory' }>> {
    if (path.hostPath) {
      const entries = await readdirHost(await this.hostAccess.requireExistingPath(path), {
        withFileTypes: true,
      });
      return entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
      }));
    }

    return parseReaddirValue(await this.helper.request({ op: 'readdir', path: path.runtimePath }));
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

class ProjectedContainerHostAccess {
  private readonly mounts: ProjectedHostMount[];

  constructor(mounts: ProjectedContainerToolRuntimeDescriptor['spec']['mounts']) {
    this.mounts = normalizeHostMounts(mounts);
  }

  private mountedHostPath(path: RuntimePath): { mount: ProjectedHostMount; hostPath: string } {
    if (!path.hostPath) {
      throw new Error(
        `Access denied: path is not backed by a projected host mount: ${path.displayPath}`
      );
    }

    const mount = this.mounts.find((candidate) =>
      containerPathIsInside(candidate.containerPath, path.runtimePath)
    );
    if (!mount) {
      throw new Error(`Access denied: path is outside projected host mounts: ${path.displayPath}`);
    }

    const hostPath = resolveHostPath(path.hostPath);
    requireHostPathInside(
      mount.hostPath,
      hostPath,
      `Access denied: path resolves outside projected host mount: ${path.displayPath}`
    );
    return { mount, hostPath };
  }

  private async assertRealInside(
    mount: ProjectedHostMount,
    realHostPath: string,
    originalPath: string
  ): Promise<void> {
    mount.realHostPath ??= realpath(mount.hostPath);
    const realRoot = await mount.realHostPath;
    if (!hostPathIsInside(realRoot, realHostPath)) {
      throw new Error(`Access denied: path resolves outside projected host mount: ${originalPath}`);
    }
  }

  private async nearestExistingRealPath(hostPath: string): Promise<string> {
    let candidate = hostPath;

    for (;;) {
      try {
        return await realpath(candidate);
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
      }

      const parent = dirname(candidate);
      if (parent === candidate) {
        throw new Error(`Path does not exist: ${hostPath}`);
      }
      candidate = parent;
    }
  }

  async requireExistingPath(path: RuntimePath): Promise<string> {
    const { mount, hostPath } = this.mountedHostPath(path);
    const realHostPath = await realpath(hostPath);
    await this.assertRealInside(mount, realHostPath, path.displayPath);
    return hostPath;
  }

  async requireWritablePath(path: RuntimePath): Promise<string> {
    const { mount, hostPath } = this.mountedHostPath(path);
    if (mount.readonly) {
      throw new Error(`Access denied: projected host mount is read-only: ${path.displayPath}`);
    }

    try {
      const realTarget = await realpath(hostPath);
      await this.assertRealInside(mount, realTarget, path.displayPath);
      return hostPath;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }

    try {
      const targetStat = await lstat(hostPath);
      if (targetStat.isSymbolicLink()) {
        throw new Error(
          `Access denied: path resolves outside projected host mount: ${path.displayPath}`
        );
      }
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }

    const realParent = await this.nearestExistingRealPath(dirname(hostPath));
    await this.assertRealInside(mount, realParent, path.displayPath);
    return hostPath;
  }

  async requireCreatableDirectory(path: RuntimePath): Promise<string> {
    const { mount, hostPath } = this.mountedHostPath(path);
    if (mount.readonly) {
      throw new Error(`Access denied: projected host mount is read-only: ${path.displayPath}`);
    }

    try {
      const realTarget = await realpath(hostPath);
      await this.assertRealInside(mount, realTarget, path.displayPath);
      return hostPath;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }

    const realAncestor = await this.nearestExistingRealPath(dirname(hostPath));
    await this.assertRealInside(mount, realAncestor, path.displayPath);
    return hostPath;
  }
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
      const materialization = await containerSpecFromDescriptor(
        this.descriptor,
        this.secretContext
      );
      if (materialization.hooks) {
        await this.containerManager.materialize(materialization.spec, materialization.hooks);
      } else {
        await this.containerManager.materialize(materialization.spec);
      }
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

class ProjectedContainerNetworkClient implements RuntimeNetworkClient {
  constructor(private readonly helper: ProjectedContainerRuntimeHelper) {}

  async fetch(url: string, opts: RuntimeFetchOptions = {}): Promise<RuntimeFetchResult> {
    return parseFetchValue(
      await this.helper.request(
        {
          op: 'fetch',
          url,
          method: opts.method,
          headers: opts.headers,
          body: opts.body,
          redirect: opts.redirect,
          maxBytes: opts.maxBytes,
        },
        opts.signal
      )
    );
  }
}

const DEFAULT_HELPER_REQUEST_TIMEOUT_MS = 30_000;

class ProjectedContainerRuntimeHelper {
  constructor(
    private readonly descriptor: ProjectedContainerToolRuntimeDescriptor,
    private readonly processRunner: RuntimeProcessRunner
  ) {}

  async request(request: HelperRequest, signal?: AbortSignal): Promise<unknown> {
    const helper = this.descriptor.helper;
    if (!helper) {
      helperUnavailable();
    }

    const timeoutController = new AbortController();
    const timeout = setTimeout(
      () => timeoutController.abort(new Error('Projected runtime helper request timed out')),
      DEFAULT_HELPER_REQUEST_TIMEOUT_MS
    );
    timeout.unref?.();
    const effectiveSignal = signal ?? timeoutController.signal;

    try {
      const handle = await this.processRunner.start(helper.command, {
        cwd: this.descriptor.cwd,
        signal: effectiveSignal,
      });
      if (!handle.stdin || !handle.stdout) {
        handle.kill();
        throw new Error('Projected runtime helper stream unavailable');
      }

      const stdout = streamToString(handle.stdout);
      const stderr = streamToString(handle.stderr);
      await writeStreamAndClose(handle.stdin, encodeHelperRequest(request));

      // Prevent unhandled rejection if the race resolves to the data side
      // before this rejection is awaited.
      const timeoutRejection = new Promise<never>((_, reject) => {
        const onAbort = () => {
          handle.kill('SIGKILL');
          reject(timeoutController.signal.reason as Error);
        };
        if (timeoutController.signal.aborted) {
          onAbort();
          return;
        }
        timeoutController.signal.addEventListener('abort', onAbort, { once: true });
      });
      timeoutRejection.catch(() => undefined);

      const [stdoutOutput, stderrOutput, completion] = await Promise.race([
        Promise.all([stdout, stderr, handle.completion]),
        timeoutRejection,
      ]);

      if (completion.exitCode !== 0) {
        const message =
          stderrOutput.trim() || `Projected runtime helper exited ${completion.exitCode}`;
        throw new Error(message);
      }

      const response = decodeHelperResponse(firstResponseLine(stdoutOutput));
      if (!response.ok) {
        throw new Error(response.error.message);
      }
      return response.value;
    } finally {
      clearTimeout(timeout);
    }
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
    const helper = new ProjectedContainerRuntimeHelper(
      { ...input.descriptor, cwd: this.cwd },
      this.process
    );
    this.fs = new ProjectedContainerFileSystem(
      helper,
      new ProjectedContainerHostAccess(input.descriptor.spec.mounts)
    );
    this.network = new ProjectedContainerNetworkClient(helper);
  }

  readonly id: string;
  readonly cwd: string;
}
