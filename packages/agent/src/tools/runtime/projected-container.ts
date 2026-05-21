import { posix } from 'node:path';
import { resolve as resolveHostPath } from 'node:path';
import type { Readable } from 'node:stream';
import type { ExecStreamHandle, ExecStreamOptions } from '../../containers/types';
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

export interface ProjectedContainerManager {
  execStream(containerId: string, options: ExecStreamOptions): Promise<ExecStreamHandle>;
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

function helperNotInstalled(): never {
  throw new Error('Projected container filesystem helper is not installed');
}

class ProjectedContainerPathService implements RuntimePathService {
  private readonly mounts: Array<{
    hostPath: string;
    containerPath: string;
  }>;

  constructor(
    private readonly runtimeId: string,
    private readonly cwd: string,
    mounts: ProjectedContainerToolRuntimeDescriptor['spec']['mounts']
  ) {
    this.mounts = mounts
      .map((mount) => ({
        hostPath: resolveHostPath(mount.hostPath),
        containerPath: normalizeContainerPath(mount.containerPath, '/'),
      }))
      .sort((left, right) => right.containerPath.length - left.containerPath.length);
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
  async stat(
    _path: RuntimePath
  ): Promise<{ type: 'file' | 'directory'; size: number; mtime: Date }> {
    helperNotInstalled();
  }

  async readTextFile(_path: RuntimePath): Promise<string> {
    helperNotInstalled();
  }

  async writeTextFile(_path: RuntimePath, _content: string): Promise<void> {
    helperNotInstalled();
  }

  async mkdir(_path: RuntimePath, _opts?: { recursive?: boolean }): Promise<void> {
    helperNotInstalled();
  }

  async readdir(_path: RuntimePath): Promise<Array<{ name: string; type: 'file' | 'directory' }>> {
    helperNotInstalled();
  }
}

class ProjectedContainerProcessRunner implements RuntimeProcessRunner {
  constructor(
    private readonly descriptor: ProjectedContainerToolRuntimeDescriptor,
    private readonly containerManager: ProjectedContainerManager
  ) {}

  private containerId(): string {
    return this.descriptor.spec.containerId ?? this.descriptor.spec.name;
  }

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
      environment: definedEnvironment(this.descriptor.spec.env, opts.env),
    };
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

    const containerHandle = await this.containerManager.execStream(
      this.containerId(),
      this.optionsFor(command, opts)
    );

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
  async fetch(_url: string, _opts?: RuntimeFetchOptions): Promise<RuntimeFetchResult> {
    throw new Error('Projected container network fetch is not implemented');
  }
}

export class ProjectedContainerToolRuntime implements ToolRuntime {
  readonly kind = 'container' as const;
  readonly label = 'Projected Container';
  readonly paths: RuntimePathService;
  readonly fs: RuntimeFileSystem;
  readonly process: RuntimeProcessRunner;
  readonly network = new ProjectedContainerNetworkClient();

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
    this.fs = new ProjectedContainerFileSystem();
    this.process = new ProjectedContainerProcessRunner(
      { ...input.descriptor, cwd: this.cwd },
      input.containerManager
    );
  }

  readonly id: string;
  readonly cwd: string;
}
