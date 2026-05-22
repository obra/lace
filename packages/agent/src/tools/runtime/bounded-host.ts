import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { HostToolRuntime } from './host';
import type {
  RuntimeFileSystem,
  RuntimeNetworkClient,
  RuntimePath,
  RuntimePathService,
  RuntimeProcessHandle,
  RuntimeProcessOptions,
  RuntimeProcessResult,
  RuntimeProcessRunner,
  ToolRuntime,
} from './types';

interface NodeError extends Error {
  code?: string;
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as NodeError).code === 'ENOENT';
}

function pathIsInside(root: string, path: string): boolean {
  const relativePath = relative(root, path);
  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath))
  );
}

function requireInside(root: string, path: string, message: string): void {
  if (!pathIsInside(root, path)) {
    throw new Error(message);
  }
}

class BoundedHostContainment {
  private realRoot?: Promise<string>;

  constructor(private readonly root: string) {}

  private assertLexicalInside(hostPath: string): string {
    const resolvedPath = resolve(hostPath);
    requireInside(
      this.root,
      resolvedPath,
      `Access denied: path resolves outside bounded host root: ${hostPath}`
    );
    return resolvedPath;
  }

  private async assertRealInside(realPath: string, originalPath: string): Promise<void> {
    this.realRoot ??= realpath(this.root);
    const root = await this.realRoot;
    if (!pathIsInside(root, realPath)) {
      throw new Error(`Access denied: path resolves outside bounded host root: ${originalPath}`);
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
      if (parent === candidate) throw new Error(`Path does not exist: ${hostPath}`);
      candidate = parent;
    }
  }

  async requireExistingPath(hostPath: string): Promise<void> {
    const resolvedPath = this.assertLexicalInside(hostPath);
    const realPath = await realpath(resolvedPath);
    await this.assertRealInside(realPath, hostPath);
  }

  async requireWritablePath(hostPath: string): Promise<void> {
    const resolvedPath = this.assertLexicalInside(hostPath);

    try {
      const realTarget = await realpath(resolvedPath);
      await this.assertRealInside(realTarget, hostPath);
      return;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }

    try {
      const targetStat = await lstat(resolvedPath);
      if (targetStat.isSymbolicLink()) {
        throw new Error(`Access denied: path resolves outside bounded host root: ${hostPath}`);
      }
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }

    const realParent = await this.nearestExistingRealPath(dirname(resolvedPath));
    await this.assertRealInside(realParent, hostPath);
  }

  async requireCreatableDirectory(hostPath: string): Promise<void> {
    const resolvedPath = this.assertLexicalInside(hostPath);

    try {
      const realTarget = await realpath(resolvedPath);
      await this.assertRealInside(realTarget, hostPath);
      return;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }

    const realAncestor = await this.nearestExistingRealPath(dirname(resolvedPath));
    await this.assertRealInside(realAncestor, hostPath);
  }
}

class BoundedHostPathService implements RuntimePathService {
  constructor(
    private readonly root: string,
    private readonly cwd: string,
    private readonly runtimeId: string
  ) {}

  async resolve(inputPath: string): Promise<RuntimePath> {
    const runtimePath = isAbsolute(inputPath) ? resolve(inputPath) : resolve(this.cwd, inputPath);
    requireInside(
      this.root,
      runtimePath,
      `Access denied: path resolves outside bounded host root: ${inputPath}`
    );

    return {
      original: inputPath,
      runtimePath,
      hostPath: runtimePath,
      displayPath: inputPath,
    };
  }

  canonicalKey(path: RuntimePath): string {
    return `boundedHost:${this.runtimeId}:${resolve(path.runtimePath)}`;
  }
}

class BoundedHostFileSystem implements RuntimeFileSystem {
  constructor(
    private readonly delegate: RuntimeFileSystem,
    private readonly containment: BoundedHostContainment
  ) {}

  private hostPath(path: RuntimePath): string {
    return path.hostPath ?? path.runtimePath;
  }

  async stat(
    path: RuntimePath
  ): Promise<{ type: 'file' | 'directory'; size: number; mtime: Date }> {
    await this.containment.requireExistingPath(this.hostPath(path));
    return await this.delegate.stat(path);
  }

  async readTextFile(path: RuntimePath): Promise<string> {
    await this.containment.requireExistingPath(this.hostPath(path));
    return await this.delegate.readTextFile(path);
  }

  async writeTextFile(path: RuntimePath, content: string): Promise<void> {
    await this.containment.requireWritablePath(this.hostPath(path));
    await this.delegate.writeTextFile(path, content);
  }

  async mkdir(path: RuntimePath, opts?: { recursive?: boolean }): Promise<void> {
    await this.containment.requireCreatableDirectory(this.hostPath(path));
    await this.delegate.mkdir(path, opts);
  }

  async readdir(path: RuntimePath): Promise<Array<{ name: string; type: 'file' | 'directory' }>> {
    await this.containment.requireExistingPath(this.hostPath(path));
    return await this.delegate.readdir(path);
  }
}

class BoundedHostProcessRunner implements RuntimeProcessRunner {
  constructor(
    private readonly delegate: RuntimeProcessRunner,
    private readonly root: string,
    private readonly cwd: string,
    private readonly containment: BoundedHostContainment
  ) {}

  private async optionsFor(opts: RuntimeProcessOptions = {}): Promise<RuntimeProcessOptions> {
    if (!opts.cwd) {
      await this.containment.requireExistingPath(this.cwd);
      return opts;
    }

    const cwd = isAbsolute(opts.cwd) ? resolve(opts.cwd) : resolve(this.cwd, opts.cwd);
    requireInside(
      this.root,
      cwd,
      `Access denied: process cwd resolves outside bounded host root: ${opts.cwd}`
    );
    await this.containment.requireExistingPath(cwd);
    return { ...opts, cwd };
  }

  async exec(command: string[], opts: RuntimeProcessOptions = {}): Promise<RuntimeProcessResult> {
    return await this.delegate.exec(command, await this.optionsFor(opts));
  }

  async start(command: string[], opts: RuntimeProcessOptions = {}): Promise<RuntimeProcessHandle> {
    return await this.delegate.start(command, await this.optionsFor(opts));
  }
}

export class BoundedHostToolRuntime implements ToolRuntime {
  readonly kind = 'boundedHost' as const;
  readonly label = 'Bounded Host';
  readonly paths: RuntimePathService;
  readonly fs: RuntimeFileSystem;
  readonly process: RuntimeProcessRunner;
  readonly network: RuntimeNetworkClient;

  constructor(input: { id: string; root: string; cwd: string; env?: NodeJS.ProcessEnv }) {
    this.id = input.id;
    const root = resolve(input.root);
    const cwd = resolve(input.cwd);
    requireInside(root, cwd, `Access denied: cwd resolves outside bounded host root: ${input.cwd}`);

    const containment = new BoundedHostContainment(root);
    const hostRuntime = new HostToolRuntime({
      id: input.id,
      cwd,
      env: input.env,
    });

    this.cwd = cwd;
    this.paths = new BoundedHostPathService(root, cwd, input.id);
    this.fs = new BoundedHostFileSystem(hostRuntime.fs, containment);
    this.process = new BoundedHostProcessRunner(hostRuntime.process, root, cwd, containment);
    this.network = hostRuntime.network;
  }

  readonly id: string;
  readonly cwd: string;
}
