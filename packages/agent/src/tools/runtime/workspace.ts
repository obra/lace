import { isAbsolute, relative, resolve, sep } from 'node:path';
import { HostToolRuntime } from './host';
import type {
  RuntimeFileSystem,
  RuntimeNetworkClient,
  RuntimePath,
  RuntimePathService,
  RuntimeProcessRunner,
  ToolRuntime,
} from './types';

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

function mappedCwd(input: { cwd: string; projectRoot: string; workspaceRoot: string }): string {
  const resolvedCwd = isAbsolute(input.cwd)
    ? resolve(input.cwd)
    : resolve(input.workspaceRoot, input.cwd);

  if (pathIsInside(input.workspaceRoot, resolvedCwd)) {
    return resolvedCwd;
  }

  if (pathIsInside(input.projectRoot, resolvedCwd)) {
    return resolve(input.workspaceRoot, relative(input.projectRoot, resolvedCwd));
  }

  throw new Error(`Access denied: cwd resolves outside workspace root: ${input.cwd}`);
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
    const cwd = mappedCwd({
      cwd: input.cwd,
      projectRoot,
      workspaceRoot,
    });

    const hostRuntime = new HostToolRuntime({
      id: input.id,
      cwd,
      env: input.env,
    });

    this.cwd = cwd;
    this.paths = new WorkspacePathService(projectRoot, workspaceRoot, cwd, input.id);
    this.fs = hostRuntime.fs;
    this.process = hostRuntime.process;
    this.network = hostRuntime.network;
  }

  readonly id: string;
  readonly cwd: string;
}
