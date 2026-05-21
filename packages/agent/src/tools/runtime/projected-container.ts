import {
  lstat,
  mkdir as mkdirHost,
  readdir as readdirHost,
  readFile,
  realpath,
  stat as statHost,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, posix, relative, resolve as resolveHostPath, sep } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import type { ContainerHandle, ContainerSpec } from '../../containers/spec';
import type { ExecStreamHandle, ExecStreamOptions } from '../../containers/types';
import { decodeHelperResponse, encodeHelperRequest, type HelperRequest } from './helper-protocol';
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
  ToolRuntime,
  ToolRuntimeDescriptor,
} from './types';

type ContainerToolRuntimeDescriptor = Extract<ToolRuntimeDescriptor, { type: 'container' }>;

export type ProjectedContainerToolRuntimeDescriptor = Omit<ContainerToolRuntimeDescriptor, 'type'>;

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
  materialize(spec: ContainerSpec): Promise<ContainerHandle>;
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

function containerSpecFromDescriptor(
  descriptor: ProjectedContainerToolRuntimeDescriptor
): ContainerSpec {
  const spec: ContainerSpec = {
    name: descriptor.spec.name,
    image: descriptor.spec.resolvedImageDigest,
    workingDirectory: descriptor.spec.workingDirectory,
    mounts: descriptor.spec.mounts.map((mount) => ({
      source: mount.hostPath,
      target: mount.containerPath,
      readonly: mount.readonly,
    })),
    env: descriptor.spec.env ?? {},
  };

  if (descriptor.spec.containerId) {
    spec.containerId = descriptor.spec.containerId;
  }
  if (descriptor.spec.ports) {
    spec.ports = descriptor.spec.ports;
  }
  if (descriptor.spec.restartPolicy) {
    spec.restartPolicy = descriptor.spec.restartPolicy;
  }

  return spec;
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
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'number')) {
    return new Uint8Array(value);
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
    private readonly containerManager: ProjectedContainerManager
  ) {}

  private optionsFor(command: string[], opts: RuntimeProcessOptions = {}): ExecStreamOptions {
    if (command.length === 0) {
      throw new Error('runtime process command is empty');
    }

    return {
      command,
      workingDirectory: normalizeContainerPath(
        opts.cwd ?? this.descriptor.cwd,
        this.descriptor.cwd
      ),
      environment: definedEnvironment(
        opts.envMode === 'replace' ? undefined : this.descriptor.spec.env,
        opts.env
      ),
      environmentMode: opts.envMode ?? 'inherit',
    };
  }

  private async ensureMaterialized(): Promise<void> {
    if (this.materialized) {
      await this.materialized;
      return;
    }

    const materialized = this.containerManager
      .materialize(containerSpecFromDescriptor(this.descriptor))
      .then(() => undefined);
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

    const abortHandler = () => containerHandle.kill();
    opts.signal?.addEventListener('abort', abortHandler, { once: true });

    const completion = containerHandle.wait().then((result) => ({
      exitCode: result.exitCode,
      signal: undefined,
    }));
    void completion.then(
      () => opts.signal?.removeEventListener('abort', abortHandler),
      () => opts.signal?.removeEventListener('abort', abortHandler)
    );

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
        },
        opts.signal
      )
    );
  }
}

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

    const handle = await this.processRunner.start(helper.command, {
      cwd: this.descriptor.cwd,
      signal,
    });
    if (!handle.stdin || !handle.stdout) {
      handle.kill();
      throw new Error('Projected runtime helper stream unavailable');
    }

    const stdout = streamToString(handle.stdout);
    const stderr = streamToString(handle.stderr);
    await writeStreamAndClose(handle.stdin, encodeHelperRequest(request));

    const [stdoutOutput, stderrOutput, completion] = await Promise.all([
      stdout,
      stderr,
      handle.completion,
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
      input.containerManager
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
