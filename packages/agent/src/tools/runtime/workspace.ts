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

function mapWorkspaceCwd(input: {
  cwd: string;
  projectRoot: string;
  workspaceRoot: string;
  baseCwd: string;
}): string {
  if (!isAbsolute(input.cwd)) {
    const resolvedCwd = resolve(input.baseCwd, input.cwd);
    requireInside(
      input.workspaceRoot,
      resolvedCwd,
      `Access denied: cwd resolves outside workspace root: ${input.cwd}`
    );
    return resolvedCwd;
  }

  const resolvedCwd = resolve(input.cwd);

  if (pathIsInside(input.workspaceRoot, resolvedCwd)) {
    return resolvedCwd;
  }

  if (pathIsInside(input.projectRoot, resolvedCwd)) {
    return resolve(input.workspaceRoot, relative(input.projectRoot, resolvedCwd));
  }

  throw new Error(`Access denied: cwd resolves outside workspace root: ${input.cwd}`);
}

class WorkspaceContainment {
  private realWorkspaceRoot?: Promise<string>;

  constructor(private readonly workspaceRoot: string) {}

  private assertLexicalInside(hostPath: string): string {
    const resolvedPath = resolve(hostPath);
    requireInside(
      this.workspaceRoot,
      resolvedPath,
      `Access denied: path resolves outside workspace root: ${hostPath}`
    );
    return resolvedPath;
  }

  private async assertRealInside(realPath: string, originalPath: string): Promise<void> {
    this.realWorkspaceRoot ??= realpath(this.workspaceRoot);
    const root = await this.realWorkspaceRoot;
    if (!pathIsInside(root, realPath)) {
      throw new Error(`Access denied: path resolves outside workspace root: ${originalPath}`);
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
        throw new Error(`Access denied: path resolves outside workspace root: ${hostPath}`);
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

class WorkspacePathService implements RuntimePathService {
  constructor(
    private readonly projectRoot: string,
    private readonly workspaceRoot: string,
    private readonly cwd: string,
    private readonly runtimeId: string
  ) {}

  async resolve(inputPath: string): Promise<RuntimePath> {
    if (isAbsolute(inputPath)) {
      const projectPath = resolve(inputPath);
      requireInside(
        this.projectRoot,
        projectPath,
        `Access denied: path is outside workspace project root: ${inputPath}`
      );

      const runtimePath = resolve(this.workspaceRoot, relative(this.projectRoot, projectPath));
      requireInside(
        this.workspaceRoot,
        runtimePath,
        `Access denied: path resolves outside workspace root: ${inputPath}`
      );

      return {
        original: inputPath,
        runtimePath,
        hostPath: runtimePath,
        displayPath: inputPath,
      };
    }

    const runtimePath = resolve(this.cwd, inputPath);
    requireInside(
      this.workspaceRoot,
      runtimePath,
      `Access denied: path resolves outside workspace root: ${inputPath}`
    );

    return {
      original: inputPath,
      runtimePath,
      hostPath: runtimePath,
      displayPath: inputPath,
    };
  }

  canonicalKey(path: RuntimePath): string {
    return `workspace:${this.runtimeId}:${resolve(path.runtimePath)}`;
  }
}

class WorkspaceFileSystem implements RuntimeFileSystem {
  constructor(
    private readonly delegate: RuntimeFileSystem,
    private readonly containment: WorkspaceContainment
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

class WorkspaceProcessRunner implements RuntimeProcessRunner {
  constructor(
    private readonly delegate: RuntimeProcessRunner,
    private readonly projectRoot: string,
    private readonly workspaceRoot: string,
    private readonly cwd: string,
    private readonly containment: WorkspaceContainment
  ) {}

  private async optionsFor(opts: RuntimeProcessOptions = {}): Promise<RuntimeProcessOptions> {
    if (!opts.cwd) {
      await this.containment.requireExistingPath(this.cwd);
      return opts;
    }

    const cwd = mapWorkspaceCwd({
      cwd: opts.cwd,
      projectRoot: this.projectRoot,
      workspaceRoot: this.workspaceRoot,
      baseCwd: this.cwd,
    });
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

export class WorkspaceToolRuntime implements ToolRuntime {
  readonly kind = 'workspace' as const;
  readonly label = 'Workspace';
  readonly paths: RuntimePathService;
  readonly fs: RuntimeFileSystem;
  readonly process: RuntimeProcessRunner;
  readonly network: RuntimeNetworkClient;

  constructor(input: {
    id: string;
    projectRoot: string;
    workspaceRoot: string;
    cwd: string;
    env?: NodeJS.ProcessEnv;
  }) {
    this.id = input.id;

    const projectRoot = resolve(input.projectRoot);
    const workspaceRoot = resolve(input.workspaceRoot);
    const cwd = mapWorkspaceCwd({
      cwd: input.cwd,
      projectRoot,
      workspaceRoot,
      baseCwd: workspaceRoot,
    });
    const containment = new WorkspaceContainment(workspaceRoot);

    const hostRuntime = new HostToolRuntime({
      id: input.id,
      cwd,
      env: input.env,
    });

    this.cwd = cwd;
    this.paths = new WorkspacePathService(projectRoot, workspaceRoot, cwd, input.id);
    this.fs = new WorkspaceFileSystem(hostRuntime.fs, containment);
    this.process = new WorkspaceProcessRunner(
      hostRuntime.process,
      projectRoot,
      workspaceRoot,
      cwd,
      containment
    );
    this.network = hostRuntime.network;
  }

  readonly id: string;
  readonly cwd: string;
}
